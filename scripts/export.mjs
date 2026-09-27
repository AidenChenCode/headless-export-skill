#!/usr/bin/env node
/* =====================================================================
   导出层：Node.js + puppeteer-core（CDP 走 ws WebSocket）驱动本机 Chrome 无头模式，把页面逐帧截成 PNG 序列
     · 页面只需实现契约：window.__ready / __meta / __seek(frame)，可选 __renderAudioWav()（见 references/page-contract.md）
     · 输出：<out>/frames/f_0000.png …、<out>/audio.wav（页面有音乐层时）、<out>/meta.json（给 ffmpeg-encode / video-verify 用）
     · 编码交给 ffmpeg-encode skill（scripts/encode.py），本脚本不碰 ffmpeg

   用法
     node export.mjs <page.html> [--out build] [--parallel 3] [--step N] [--from A --to B] [--test 45,255] [--audio-only] [--no-audio]
       --parallel 3     3 个无头 Chrome 分段并行（约快 2 倍）
       --step 3         每 3 帧取 1 帧做快速预览（编码时帧率用 FPS/3）
       --from/--to      只渲染一段帧（改了某个场景后局部重渲）
       --test 45,255    只把指定帧渲到 <out>/test_XXXX.png（看效果）
       --audio-only     只渲染音频；--no-audio 跳过音频
   环境变量 CHROME 可指定浏览器路径。
   ===================================================================== */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const VALUED = new Set(['--out', '--parallel', '--step', '--from', '--to', '--test']);
let pageArg = null;
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { if (VALUED.has(args[i])) i++; continue; } pageArg = args[i]; break; }
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = k => args.includes(k);
if (!pageArg) { console.error('用法: node export.mjs <page.html> [--out build] [--parallel N] [--step N] [--from A --to B] [--test f1,f2] [--audio-only] [--no-audio]'); process.exit(1); }
const PAGE = path.resolve(pageArg);
const OUT = path.resolve(opt('--out') || path.join(path.dirname(PAGE), 'build'));
const FR = path.join(OUT, 'frames'), WAV = path.join(OUT, 'audio.wav'), META = path.join(OUT, 'meta.json');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const testFrames = opt('--test')?.split(',').map(Number) ?? null;
const step = Math.max(1, +(opt('--step') ?? 1));
const parallel = Math.max(1, +(opt('--parallel') ?? 1));
const isChild = has('--child');
fs.mkdirSync(FR, { recursive: true });
const pad4 = n => String(n).padStart(4, '0');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage() {
  if (!CHROME) throw new Error('未找到 Chrome，请设置环境变量 CHROME=<可执行文件路径>');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required',
           '--enable-unsafe-swiftshader', '--disable-lcd-text', '--font-render-hinting=none', '--disable-background-timer-throttling'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => log('PAGE ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') log('CONSOLE', m.text()); });
  await page.goto(pathToFileURL(PAGE).href + '?export=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
  const meta = await page.evaluate(() => window.__meta);
  if (!meta || !meta.W || !meta.FPS || !meta.FRAMES) throw new Error('页面的 window.__meta 缺少 W/H/FPS/FRAMES');
  await page.setViewport({ width: meta.W, height: meta.H, deviceScaleFactor: 1 });
  fs.writeFileSync(META, JSON.stringify({ ...meta, step, page: PAGE, generated: new Date().toISOString() }, null, 2));
  log(`page ready · ${meta.title || path.basename(PAGE)} · ${meta.W}×${meta.H} @${meta.FPS} · ${meta.FRAMES} frames (${meta.DUR}s) · audio=${!!meta.hasAudio}`);
  const cdp = await page.createCDPSession();
  return { browser, page, cdp, meta };
}
// 长时间渲染后 Chrome 偶尔要几分钟才退出；关不掉就强杀，最后显式退出 Node
async function closeBrowser(browser) {
  const proc = browser.process();
  await Promise.race([browser.close().catch(() => {}), sleep(15000)]);
  if (proc && proc.exitCode === null) { try { proc.kill('SIGKILL'); } catch {} }
}
async function exitNow(code = 0) { await new Promise(r => process.stdout.write('', r)); process.exit(code); }
async function grab(cdp, meta, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: meta.W, height: meta.H, scale: 1 }, captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}
async function renderAudio(page, meta) {
  if (!meta.hasAudio) { log('page has no audio layer (meta.hasAudio=false) — skipping audio'); return; }
  log(`rendering audio offline (OfflineAudioContext, 48 kHz, ${meta.DUR} s)…`);
  const t = Date.now();
  const b64 = await page.evaluate(() => window.__renderAudioWav());
  fs.writeFileSync(WAV, Buffer.from(b64, 'base64'));
  log(`audio.wav written (${(fs.statSync(WAV).size / 1e6).toFixed(2)} MB) in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
function runChild(from, to) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), PAGE, '--out', OUT, '--from', String(from), '--to', String(to), '--step', String(step), '--no-audio', '--child'], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', d => process.stdout.write(String(d).split('\n').filter(Boolean).map(l => `[${pad4(from)}-${pad4(to)}] ${l}\n`).join('')));
    p.on('exit', c => c === 0 ? res() : rej(new Error(`child ${from}-${to} exited ${c}`)));
  });
}

(async () => {
  const { browser, page, cdp, meta } = await openPage();
  const last = meta.FRAMES - 1;
  try {
    if (has('--audio-only')) { await renderAudio(page, meta); return; }
    if (testFrames) {
      for (const f of testFrames) { await page.evaluate(f => window.__seek(f), f); const file = path.join(OUT, `test_${pad4(f)}.png`); await grab(cdp, meta, file); log('test frame', f, '→', file); }
      return;
    }
    let from = +(opt('--from') ?? 0), to = +(opt('--to') ?? last);
    from = Math.ceil(from / step) * step; to = Math.min(to, last);
    if (parallel > 1 && !isChild) {
      if (!has('--no-audio')) await renderAudio(page, meta);
      await closeBrowser(browser);
      const total = Math.floor((to - from) / step) + 1, per = Math.ceil(total / parallel), jobs = [];
      for (let k = 0; k < parallel; k++) { const a = from + k * per * step, b = Math.min(to, from + ((k + 1) * per - 1) * step); if (a <= b) jobs.push(runChild(a, b)); }
      const t0 = Date.now(); await Promise.all(jobs);
      log(`all ${total} frames done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${FR}`);
      return;
    }
    if (from === 0 && !isChild && !has('--no-audio')) await renderAudio(page, meta);
    const t0 = Date.now(); let done = 0;
    for (let f = from; f <= to; f += step) {
      await page.evaluate(f => window.__seek(f), f);
      await grab(cdp, meta, path.join(FR, `f_${pad4(f / step)}.png`));
      done++;
      if (done % 30 === 0 || f + step > to) { const el = (Date.now() - t0) / 1000, rate = done / el; log(`frame ${pad4(f)} / ${last} · ${rate.toFixed(1)} fps · ETA ${(((to - f) / step) / rate).toFixed(0)} s`); }
    }
    log(`frames done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${FR}`);
  } finally {
    if (browser.connected) await closeBrowser(browser);
  }
  if (!isChild) log(`next: python3 <ffmpeg-encode>/scripts/encode.py --meta ${META} --out out/${(meta.title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4 --web`);
})().then(() => exitNow(0)).catch(e => { console.error(e); exitNow(1); });
