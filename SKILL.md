---
name: headless-export
description: "导出层：Node.js + puppeteer-core（CDP 走 ws WebSocket）驱动本机 Chrome 无头模式，把任何实现了页面契约（window.__seek / __meta / __ready）的网页动画逐帧截成 PNG 序列，并取出页面离线渲染的音频 WAV；支持多进程并行、抽帧预览、局部重渲、跳帧快速版。当用户要'把网页/canvas/WebGL/three.js 动画导出成视频''逐帧截图''无头浏览器渲染''puppeteer 录动画''HTML 动画转 MP4''录屏太卡想逐帧出'等时触发。不要用录屏或 MediaRecorder 方案代替——那样帧率和确定性都没保证。"
---

# 无头 Chrome 逐帧导出

目标：把一个"第 N 帧只依赖 N"的页面变成 `frames/f_0000.png …` 序列（+ `audio.wav` + `meta.json`）。逐帧 `__seek(f)` 再 `Page.captureScreenshot`，所以帧率精确、无掉帧，可以多进程分段并行。编码不在这一层，交给 `ffmpeg-encode`。

## 上下游

- 上游：任何满足 `references/page-contract.md` 的页面——`webgl-canvas-scene` 的模板已满足；自写的 three.js / p5 / 纯 Canvas 页面实现 `__ready / __meta / __seek` 即可。
- 下游：`ffmpeg-encode`（读 `meta.json` 自动取帧率、帧目录、音频）→ `video-verify`。

## 工作流

```bash
cd <skill>/scripts && npm install                     # 只需一次（puppeteer-core + ws）
node <skill>/scripts/export.mjs <page.html> --test 45,255         # 先抽几帧看效果 → build/test_*.png（用 Read 打开看）
node <skill>/scripts/export.mjs <page.html> --parallel 3          # 完整导出 → build/frames/ + build/audio.wav + build/meta.json
python3 <ffmpeg-encode>/scripts/encode.py --meta <dir>/build/meta.json --out <dir>/out/name.mp4 --web
```

常用选项：
- `--out DIR` 输出目录（默认页面同目录的 `build/`）
- `--parallel 3` 三个无头 Chrome 分段并行，1080p 约 2.5 帧/秒/进程 → 30 s 片约 2.5 分钟
- `--step 3` 每 3 帧取 1（快速预览版，编码时帧率自动变 FPS/3）
- `--from A --to B` 只重渲一段（改了某幕之后），再 `encode.py` 重新编码
- `--audio-only` / `--no-audio`
- 环境变量 `CHROME` 指定浏览器路径（默认找 macOS Google Chrome / Chromium、Linux google-chrome / chromium、Windows 默认路径）

导出耗时长，放后台跑，同时做别的。

## 页面契约（摘要）

`window.__ready === true` 表示资源就绪；`window.__meta = { title, W, H, FPS, DUR, FRAMES, hasAudio }`；`window.__seek(frame)` 同步画出该帧并在两次 rAF 后 resolve；可选 `window.__renderAudioWav()` 返回 base64 WAV。页面用 `?export=1` 打开时应去掉缩放、隐藏按钮。细节与自写页面的最小实现见 `references/page-contract.md`。

## 常见问题

- **找不到 Chrome**：`CHROME=/path/to/chrome node export.mjs …`；Linux 无头可能需在 `puppeteer.launch` 的 `args` 加 `--no-sandbox`。
- **`__ready` 超时**：页面有异步资源没加载完（图片路径、字体），或页面报错——脚本会打印 `PAGE ERROR`，先在浏览器里开控制台看。
- **截到空帧 / 黑帧**：WebGL 上下文没开 `preserveDrawingBuffer: true`，或 `__seek` 没等 rAF。
- **帧之间不连贯 / 并行后画面撕裂**：页面不是纯函数（用了 `Math.random()`、逐帧累积状态）。
- **渲完不退出**：脚本已内置"关闭超时 15 s → SIGKILL → process.exit"；自己改脚本时保留。
- **速度**：截图是瓶颈，`--parallel` 与 `--step` 是主要手段；不要为了快去降分辨率截图再放大。
