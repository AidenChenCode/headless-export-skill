# headless-export — 导出层 Claude Code Skill

> Export layer of a code-generated video pipeline: Node.js + puppeteer-core (CDP over ws) drives a local headless Chrome, seeks any page that implements the small page contract (`__ready / __meta / __seek`) frame by frame, captures a PNG sequence plus the page's offline-rendered audio, and writes `meta.json` for the encode and verify steps. Parallel workers, test-frame previews, partial re-renders, frame-skipping quick versions.

技术栈五层里的**导出**层。不录屏、不用 MediaRecorder——逐帧 `__seek` 再截图，帧率精确、可并行、可随机访问。

## 安装

```bash
git clone https://github.com/AidenChenCode/headless-export-skill.git ~/.claude/skills/headless-export
cd ~/.claude/skills/headless-export/scripts && npm install
```
需要本机 Google Chrome（或设 `CHROME=<路径>`）。

## 使用

```bash
node ~/.claude/skills/headless-export/scripts/export.mjs page.html --test 45,255      # 抽帧看效果
node ~/.claude/skills/headless-export/scripts/export.mjs page.html --parallel 3       # 完整导出 → build/frames + audio.wav + meta.json
```
然后交给 [ffmpeg-encode](https://github.com/AidenChenCode/ffmpeg-encode-skill) 编码。任何页面只要实现 `references/page-contract.md` 里的三个接口就能导出——three.js、p5.js、纯 Canvas 都行。

## 结构

```
SKILL.md                      工作流、选项、常见问题
scripts/export.mjs            导出脚本（--parallel / --step / --from --to / --test / --audio-only）
scripts/package.json          依赖：puppeteer-core、ws
references/page-contract.md   页面契约与最小实现示例
```

## 同一套技术栈的其它 skill

| 层 | 仓库 |
|---|---|
| 画面 | [webgl-canvas-scene-skill](https://github.com/AidenChenCode/webgl-canvas-scene-skill) |
| 音乐 | [webaudio-score-skill](https://github.com/AidenChenCode/webaudio-score-skill) |
| 导出 | headless-export-skill（本仓库） |
| 编码 | [ffmpeg-encode-skill](https://github.com/AidenChenCode/ffmpeg-encode-skill) |
| 核对 | [video-verify-skill](https://github.com/AidenChenCode/video-verify-skill) |
| 组合体 | [motion-graphics-skill](https://github.com/AidenChenCode/motion-graphics-skill) |
