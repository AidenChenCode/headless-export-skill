# 页面契约：画面层 ↔ 导出层

任何动画页面只要实现下面几个东西，就能被 headless-export skill 逐帧导出、被 webaudio-score 配乐、被 ffmpeg-encode 编码、被 video-verify 核对。engine-visual.js 已经实现了它；用 three.js / p5.js / 纯 Canvas / SVG 自己写的页面照此实现即可。

## 必需

| 名称 | 类型 | 含义 |
|---|---|---|
| `window.__ready` | boolean | 字体、图片等异步资源加载完成后置 `true`；导出脚本会等它 |
| `window.__meta` | object | `{ title, W, H, FPS, DUR, FRAMES, hasAudio?, verify?, primary? }`——画幅、帧率、时长（秒）、总帧数 |
| `window.__seek(frame)` | `(int) → Promise<void>` | **同步**把第 `frame` 帧画到屏幕上，等两次 `requestAnimationFrame` 后 resolve（保证合成器已呈现） |

URL 参数：`?export=1` 去掉缩放、隐藏按钮（画布 1:1 铺在左上角）；`?frame=N` 打开即显示第 N 帧（调试用）。

## 可选（音乐层）

| 名称 | 含义 |
|---|---|
| `window.__renderAudioWav()` | `() → Promise<string>`，用 `OfflineAudioContext` 渲染整曲，返回 base64 的 16-bit 48 kHz 立体声 WAV |
| `__meta.hasAudio` | 有音轨时为 `true`，导出脚本据此决定是否取音频 |

## 确定性要求

导出会并行、分段、随机访问地调用 `__seek`，所以：
- 第 N 帧的画面只能依赖 N（或 `t = N / FPS`），不能依赖"上一帧画了什么"。
- 不用 `Math.random()` / `Date.now()` / `performance.now()`；随机用带种子的生成器，在加载时生成一次数据表。
- 有物理感的运动写成闭式（`x = f(t)`），或者在 `__seek` 里从 0 重放到 N（慢，但确定）。
- 用 `preserveDrawingBuffer: true` 创建 WebGL 上下文，否则截图可能拿到空帧。

## DOM 约定（engine-visual.js 用；自写页面可不同）

```html
<div id="stage"><canvas id="gl"></canvas><canvas id="ui"></canvas><button id="play">▶ PLAY</button></div>
```
`#gl` 是 WebGL2 光效层（底），`#ui` 是 Canvas2D 图形层（顶），截图取两层合成后的画面。

## 自写页面的最小实现

```html
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const FPS = 30, DUR = 8, ctx = document.getElementById('c').getContext('2d');
function draw(t) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1920, 1080); ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(960 + 400 * Math.sin(t), 540, 40, 0, 6.283); ctx.fill(); }
window.__meta = { title: 'mini', W: 1920, H: 1080, FPS, DUR, FRAMES: DUR * FPS };
window.__seek = f => { draw(f / FPS); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };
window.__ready = true; draw(0);
</script>
```
