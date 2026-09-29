<!--suppress HtmlDeprecatedAttribute -->

<div align="center" style="text-align: center; margin-top: 10px;">
 <img src="documents/assets/logo.png" style="align-self: center; width: 150px; margin-bottom: 0;" alt="Logo" />
 <h3 style="margin-top: 0; text-align: center;">MySekaiStoryteller-API</h3>
 <p style="text-align: center;">无头纯 API 的 Project SEKAI 风格 Live2D 视频渲染框架</p>
 <div style="display: flex; justify-content: center;">
  <img src="documents/assets/live2d-badge.svg" alt="Live2D Badge" style="margin-top: 0; margin-right: 5px;"/>
  <img src="https://img.shields.io/badge/typescript-20B2AA?logoColor=ffffff&style=for-the-badge&logo=typescript" alt="TypeScript" style="margin-top: 0; margin-right: 5px;" />
  <img src="https://img.shields.io/badge/node-20B2AA?style=for-the-badge&logoColor=white&logo=nodedotjs" alt="Node.js" style="margin-top: 0; margin-right: 5px;" />
  <img src="https://img.shields.io/badge/playwright-20B2AA?style=for-the-badge&logoColor=white&logo=playwright" alt="Playwright" style="margin-top: 0; margin-right: 5px;" />
 </div>

 <p>
  <a href="#项目简介">项目简介</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#api-接口">API 接口</a> ·
  <a href="#故事文件格式">故事文件格式</a> ·
  <a href="#资源导入指南">资源导入</a> ·
  <a href="#tts--bgm-配置">TTS / BGM</a> ·
  <a href="#导出模式">导出模式</a> ·
  <a href="#部署">部署</a> ·
  <a href="#项目结构">项目结构</a> ·
  <a href="#故障排除">故障排除</a> ·
  <a href="#相关项目">相关项目</a>
 </p>
</div>

> [!IMPORTANT]
> 本项目基于 [Untitled-Story/MySekaiStoryteller](https://github.com/Untitled-Story/MySekaiStoryteller) **二次开发**，
> 将其从 **Electron 桌面应用**重构为**无头纯 API 渲染框架**。
> 如需桌面编辑器，请访问原项目。感谢原作者 [GuangChen2333](https://github.com/GuangChen2333) 与
> [Untitled-Story](https://github.com/Untitled-Story) 组织。

## 项目简介

接收 `*.sekai-story.json` 故事剧本，用 Live2D（Project SEKAI 风格）渲染并导出为 MP4 视频，
通过 HTTP API 对外提供服务。渲染宿主不依赖 Electron 与桌面环境，可部署在本机、局域网服务器或
任意能跑无头 Chrome 的机器上；配合官方 [AstrBot 插件](https://github.com/yonglanws/astrbot_plugin_msst)
即可实现 QQ/Telegram 机器人的 AI 剧本生成与视频自动发送。

| 特性     | 说明                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 渲染引擎 | PixiJS + Live2D 跑在无头 Chrome/Edge 里（Playwright 渲染池，每页独立 WebGL 上下文） |
| 表演系统 | 角色滑入/滑出登场退场、台词内时序动作与表情、听者反应、按语音音量包络驱动的口型 |
| 导出管线 | `record`（默认，MediaRecorder 墙钟录制）或 `fast`（虚拟时钟逐帧渲染）          |
| 视频编码 | ffmpeg 自动探测 NVENC / AMF / QSV 硬件编码，失败自动回退 CPU                 |
| 音频     | 内置 BGM + GPT-SoVITS 语音合成（无 TTS 时自动跳过配音，导出不受影响）        |
| 队列管理 | 任务排队、可配置并发导出、IP 限流、过期文件自动清理                          |
| 统一配置 | 单个 `config.yaml`，全字段中文注释，`MSS_*` 环境变量可覆盖                   |

## 快速开始

```bash
git clone https://github.com/yonglanws/MySekaiStoryteller-API.git
cd MySekaiStoryteller-API

# 1. 安装依赖（ffmpeg 无需手动装，npm 包 ffmpeg-static 会自动带上）
npm ci

# 2. 无系统浏览器时再装 Playwright 自带的 Chromium
#    Windows 一般自带 Edge，macOS/Linux 有 Chrome/Edge 也可跳过
npx playwright install chromium

# 3. 生成配置文件（每项都有中文注释，按需修改）
cp config.example.yaml config.yaml

# 4. 准备渲染资源（仓库不附带，见下文「资源准备」）

# 5. 构建（类型检查 + webrenderer + 宿主）
npm run build

# 6. 启动
npm start
```

**启动验证**

```bash
curl http://127.0.0.1:9881/api/v1/health
# renderPool.webglRenderers 应显示真实 GPU（如 NVIDIA / Intel），而非 SwiftShader
```

**全链路验证**（需先完成资源准备）

```bash
npm run e2e                        # 示例故事导出 + 产物断言（编码/分辨率/时长/音轨）
node scripts/test-parallel.mjs 2   # 并发导出验证
```

### 资源准备

**本仓库不附带渲染资源**：仓库只保留目录结构，资源需自行放入（详见
[resources/README.md](resources/README.md)）：

```
resources/
├─ models/       Live2D 模型包（<角色>/<变体>/，含 model3.json；根下 models.yaml 为登记表）
├─ images/       背景图 / 卡面（根下 images.yaml 为画面描述表，供 AI 选图）
├─ voices/       故事语音（.wav，故事 JSON 按文件名引用）
├─ audio/bgm/    BGM
└─ stories/      *.sekai-story.json 剧本
```

资源根不强制叫 `resources/`：可在 `config.yaml` 的 `paths.resources` 或环境变量
`MSS_RESOURCE_DIR` 指向任意目录。

## API 接口

渲染宿主启动后提供 HTTP API（默认 `http://0.0.0.0:9881`）：

| 端点                             | 方法 | 说明                 |
| -------------------------------- | ---- | -------------------- |
| `/api/v1/export`                 | POST | 提交故事导出视频     |
| `/api/v1/export/:taskId/status`  | GET  | 查询任务状态         |
| `/api/v1/export/:taskId/cancel`  | POST | 取消任务             |
| `/api/v1/download/:filename`     | GET  | 下载导出的视频       |
| `/api/v1/files`                  | GET  | 分页列出导出文件     |
| `/api/v1/resources`              | GET  | 资源目录（模型/动作/表情/背景清单，供 AI 侧构建提示词与校验白名单） |
| `/api/v1/cleanup`                | POST | 触发过期文件清理     |
| `/api/v1/cleanup/stats`          | GET  | 清理统计             |
| `/api/v1/health`                 | GET  | 健康检查（含渲染池/GPU 状态） |
| `/api/v1/status`                 | GET  | 队列状态             |

提交导出只需把完整故事 JSON 作为请求体：

```bash
curl -X POST http://127.0.0.1:9881/api/v1/export \
  -H "Content-Type: application/json" \
  -d @resources/stories/multi-character-demo.sekai-story.json
```

宿主会自动把请求留档一份到 `apifile/`，便于排查。

## 故事文件格式

故事通过 `*.sekai-story.json` 文件定义，包含 `models`、`images` 和 `snippets` 三个字段。
下面是一场完整短戏的骨架（字段与当前版本一致）：

```json
{
  "models": [
    {"id": 1, "model": "20mizuki/20mizuki_normal/20mizuki_normal.model3.json",
     "normal_scale": 2.1, "small_scale": 1.8, "anchor": 0.5}
  ],
  "images": [
    {"id": 1, "image": "bg_c000101.jpg"}
  ],
  "snippets": [
    {"type": "ChangeLayoutMode", "wait": false, "delay": 0, "data": {"mode": "Normal"}},
    {"type": "BlackOut", "wait": true, "delay": 0, "data": {"duration": 500}},
    {"type": "ChangeBackgroundImage", "wait": true, "delay": 0, "data": {"imageId": 1}},
    {"type": "BlackIn", "wait": true, "delay": 0, "data": {"duration": 800}},
    {"type": "LayoutAppear", "wait": true, "delay": 0,
     "data": {"modelId": 1, "from": {"side": "Left", "offset": -100}, "to": {"side": "Left", "offset": 0},
              "motion": "w-normal-greeting01", "facial": "face_smile_01", "facialFirst": true,
              "moveSpeed": "Normal"}},
    {"type": "Talk", "wait": false, "delay": 0,
     "data": {"speaker": "晓山瑞希", "content": "你好！", "ttsText": "こんにちは！",
              "modelId": 1, "voice": ""}},
    {"type": "HideTalk", "wait": true, "delay": 0.2},
    {"type": "LayoutClear", "wait": true, "delay": 0.1,
     "data": {"modelId": 1, "from": {"side": "Left", "offset": 0}, "to": {"side": "Left", "offset": -100},
              "motion": "w-normal-nod01", "moveSpeed": "Normal"}},
    {"type": "BlackOut", "wait": true, "delay": 0, "data": {"duration": 600}}
  ]
}
```

- 故事内的 `model` / `image` 路径相对于**资源根** `resources/`，宿主通过 `/resources/*` 提供访问
- 指令片段（`snippets`）的完整类型定义见 `src/common/types/Story.ts`；
  `resources/stories/` 下附带的示例剧本可直接参考或改造

### 登场与退场（滑入滑出 + 入场退场动作）

`LayoutAppear` / `LayoutClear` 各自承载两种舞台动画：

- `from` 与 `to` **不同**时做滑动：角色从 `from` 位置滑到 `to` 位置，`moveSpeed` 控制时长
  （Slow 700ms / Normal 500ms / Fast 300ms / Immediate 瞬移），滑入滑出全程同步播放入场/退场动作
  （`motion` + `facial`），入场动作播完前剧情不会继续
- `from` 与 `to` **相同**时原地淡入/淡出，适合黑暗中现身等特殊演出
- `offset` 是相对槽位的水平像素偏移（正值向右）：给同侧槽位写 `-100` / `+100`，
  角色就会从槽位旁侧短距离滑入/滑出，配合入场/退场动作构成完整的登场/退场表演

### 台词中的连续动作与听者反应

`Talk.data.actions` 在本条台词内调度动作和表情，`at` 为实际台词时长的比例（0 到 1），
而不是秒数。`modelId` 可以是说话者，也可以是当前在场的听话者；不在场角色的事件不会让角色重新出现。
动作和表情独立更新，省略的通道保持原状态。同一角色可以按时间连续切换；渲染层最多 24 个事件
（AstrBot 插件生成的剧本会更克制，且插件侧有自己的数量与间隔校验）。

```json
{
  "type": "Talk", "wait": true, "delay": 0,
  "data": {
    "speaker": "晓山瑞希", "modelId": 1, "content": "先别着急，听我慢慢说。",
    "actions": [
      {"at": 0, "modelId": 1, "motion": "w-normal-default01", "facial": "face_smile_01"},
      {"at": 0.4, "modelId": 2, "facial": "face_smile_01"},
      {"at": 0.7, "modelId": 1, "facial": "face_smile_01"}
    ]
  }
}
```

动作名和表情名必须以该角色的资源目录为准。旧的 `Talk.data.motion` / `facial` 仍在台词开始时生效；
新的事件只覆盖指定通道。不要用 `Talk(wait:false)` 后接 `Motion` 来模拟导出时的并行动作。
独立 `Motion.data.actions` 可用于无声连续表演，`data.duration` 为秒数（默认 2，最大 120）。

口型优先从当前台词音频提取音量包络，静音和语音结束后闭嘴；无音频时按文字和标点产生确定性节奏。
两人同屏、滑入滑出换角等舞台规则属于 AstrBot 插件生成规则，渲染 API 不强制这些限制。

## 资源导入指南

### 新增 Live2D 角色（模型）

1. 把模型包整个拷到 `resources/models/<角色>/<变体>/`，目录内需含 `model3.json`
   （动作 `motions/*.motion3.json` 是模型包的一部分，由 model3.json 的
   `FileReferences.Motions` 索引——**动作文件跟着模型走，不需要单独登记**）
2. 在 `resources/models/models.yaml` 登记一行（`id` 全表唯一、`name` 角色全名、
   `shortName` 简称、`path` 以磁盘实际文件名为准）
3. 完成。宿主 30 秒内自动识别，提示词中的角色对照表、动作/表情清单、校验白名单
   **全部自动更新，无需改任何代码**；AstrBot 插件 5 分钟内自动感知（可发 `/mssadmin resources` 确认）

### 新增背景图

1. 把图片放到 `resources/images/`（jpg / jpeg / png / webp）
2. 在 `resources/images/images.yaml` 登记一行（`file` 与磁盘文件名一致、`name` 短名、`description` 画面内容与适用场景）
3. 完成。宿主 30 秒内自动识别，AstrBot 插件提示词会带上描述，由 AI 按剧情自行选图

### 语音 / BGM

| 资源   | 存放位置               | 如何生效                                                    |
| ------ | ---------------------- | ----------------------------------------------------------- |
| 背景图 | `resources/images/`    | 放入图片后在 `images.yaml` 写 name/description，AI 按描述选图 |
| 故事语音 | `resources/voices/`  | 故事 JSON 的 `voice` 字段按文件名引用                       |
| BGM    | `resources/audio/bgm/` | 在宿主 `config.yaml` 的 `bgm.path` 指定（如 `audio/bgm/bg1.mp3`） |

## TTS / BGM 配置

全部在 `config.yaml` 中完成（见 `config.example.yaml` 的 `tts:` / `bgm:` 节）：

1. 启动 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)（默认端口 `9880`），
   把地址填入 `tts.apiBaseUrl`
2. 在 `tts.characters` 下为每个角色配置参考音频（`refAudioPath` 为 **GPT-SoVITS 服务端**可访问的路径）
   与提示文本
3. BGM 放在 `resources/audio/bgm/` 下，`bgm.path` 填相对资源根的路径（如 `audio/bgm/bg1.mp3`）
4. `tts.enabled: false` 可整体关闭配音；无 TTS 时导出仍会成功，只是没有角色配音

## 导出模式

`config.yaml` 的 `video.exportMode`（环境变量 `MSS_EXPORT_MODE`）在两条管线间切换，默认 `record`。

| 模式     | 怎么出片 | 耗时怎么涨 
| -------- | -------- | ---------- |
| `record` | 无头页用 MediaRecorder 墙钟录制画布，ffmpeg 合流（可选流拷贝或二次转码） | 至少等于视频时长 + 合流 |
| `fast`   | 虚拟时钟按时间轴逐帧推进动画，页内 WebCodecs 直编或帧序列交 ffmpeg 硬编 | 跟「帧数 x 每帧 GPU 读回」成正比，不再跟视频时长 1:1 |`record` |

`record` 的合流路径由 `video.recordStreamCopy` 决定：

- `off`（默认）：浏览器录 webm，宿主全量重编码合流
- `auto` / `on`：浏览器支持直录 h264/mp4 时按目标码率录制、宿主 `-c:v copy` 流拷贝合流，
  省掉二次编码；配合 `recordTargetSizeMb`（按估算时长反推码率控制成片体积）、
  `recordBitrateOvershoot`、`recordKeyframeIntervalSec`、`recordCaptureFps`（0 跟随 `video.fps`）微调
- 浏览器不支持 mp4 直录时自动回到重编码路径，导出不受影响

`fast` 的时间轴、TTS 落点和 `record` 同一套：台词时长仍按 TTS 波形 + 尾垫，音频离线混进 WAV 后再 mux。
`video.exportFastEncoder`（`auto` / `webcodecs` / `frames`）决定页内直编还是「JPEG 帧序列 + ffmpeg 硬编」，
`video.exportBitrate` 控制 fast 模式码率。WebCodecs 探测失败或 fast 整条失败时，会自动回退 `record`。

## 部署

宿主是普通 Node 进程，**Windows / Linux / macOS 都可以跑**，不依赖 Electron，也不强制要桌面环境。
字段说明、环境变量与 Linux systemd 单元见 **[docs/host-deployment.md](docs/host-deployment.md)**。

Live2D 渲染和 MP4 编码是两条独立的 GPU 路径，可以分别成功或失败：

| 路径       | 谁在干活                         | 成功标志                                                     | 失败时                                      |
| ---------- | -------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| WebGL 渲染 | 无头 Chrome / Edge（Playwright） | `GET /api/v1/health` 的 `webglRenderers[].renderer` 含真实 GPU 名 | `SwiftShader` / `llvmpipe`，导出慢 5–10 倍 |
| 视频编码   | ffmpeg                           | 导出日志出现 `using encoder: h264_nvenc` / `h264_amf` / `h264_qsv` | 自动回退 `libx264`（CPU）                   |

`health` 里的 `ffmpegEncoder` 是**配置值**（`auto` / `nvidia` / `amd` / `intel` / `libx264`），不是 ffmpeg 实际选中的编码器。

### 按平台

| 平台    | 浏览器                                         | WebGL                                                        | 编码（`video.encoder`，默认 `auto`）            |
| ------- | ---------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Windows | 系统 Edge（默认探测 `msedge` → `chrome`）      | 独显 / 核显通常开箱即用                                      | NVIDIA→`h264_nvenc`，AMD→`h264_amf`，Intel→`h264_qsv` |
| Linux   | 系统 Chrome / Chromium；没有再 `playwright install` | 无桌面也可以。NVIDIA **无 X** 时不要用 `--use-angle=gl`（会去开 X，失败掉 SwiftShader），改为 `linuxGpuAngle: false` 且 `extraChromeArgs: "--use-angle=vulkan"` | 同上；ffmpeg 需带对应硬件编码器                 |
| macOS   | 系统 Chrome / Edge                             | 走 Apple GPU / AMD 即可                                      | 当前不探测 VideoToolbox，`auto` 会落到 `libx264` |

无独立 GPU 时：渲染走核显即可，编码显式设 `video.encoder: libx264`。

### 常驻运行

```bash
npm run build
npm start          # node out-host/host/main.js，工作目录必须是仓库根
```

Linux 可用 `deploy/mysekai-host.service` 交给 systemd（改 `User` / `WorkingDirectory` 后 `daemon-reload`）。
Windows 用任务计划程序或 [NSSM](https://nssm.cc/) 跑同一条命令；macOS 用 launchd / tmux 即可。
不要用 Docker 跑渲染宿主（无头 Chrome 的 GPU 透传收益差，还多一层排障）。

升级代码：`git pull` → 依赖变了再 `npm ci` → `npm run build` → 重启进程。`config.yaml` 与 `resources/` 不入库，不会被覆盖。

## 项目结构

```
config.example.yaml   统一配置样例（复制为 config.yaml 使用，config.yaml 不入库）
src/host/             Node 宿主：API 服务 / 静态托管 / 桥接层 / 渲染池 / ffmpeg 编码
src/webrender/        渲染工作进程页面（无头浏览器加载，构建产物在 out/webrenderer/）
src/renderer/         渲染引擎（PixiJS + Live2D + 导出管线）
src/common/           宿主与渲染侧共享的故事类型定义（Story.ts）
src/shared/           宿主与渲染侧共享的 ffmpeg 模块
resources/            资源根：models/ images/ voices/ audio/bgm/ stories/（不入库，见 resources/README.md）
out-host/             宿主编译产物（npm run build:host 生成）
docs/                 部署文档；deploy/ systemd 单元；scripts/ 测试与工具脚本
```

## 故障排除

**Q: 启动报 "Failed to launch any browser"**

系统没有 Edge/Chrome 且未下载 playwright 浏览器。执行 `npx playwright install chromium`
或安装系统 Chrome/Edge。

**Q: health 里 WebGL renderer 显示 SwiftShader / llvmpipe**

WebGL 落到了软件渲染，导出会慢 5–10 倍，并可能音画不同步。按平台改 `render.extraChromeArgs`
（或 `MSS_CHROME_ARGS`），详见 [docs/host-deployment.md](docs/host-deployment.md)：

- Linux + NVIDIA、无桌面 / 无 X：`linuxGpuAngle: false`，`extraChromeArgs: "--use-angle=vulkan"`
- Linux 有可用的 X11 / GLX：可试 `--use-angle=gl`（这也是 `linuxGpuAngle: true` 的默认追加项）
- Windows / macOS：一般不用额外参数；确认走的是系统 Edge/Chrome，而不是 Playwright 的 headless-shell

**Q: 视频导出失败或卡住**

- 查看宿主日志中的 ffmpeg / 渲染错误
- 尝试降低 `render.workers`（显存/内存不足时）
- 确认 `video.encoder` 对应的硬件在当前机器可用（失败会自动回退 CPU）。
  取值是 `auto` / `nvidia` / `amd` / `intel` / `libx264`，不是 ffmpeg 的 `nvenc` 字符串
- `record` 流拷贝在浏览器不支持 mp4 直录或合并失败时，会自动回到重编码路径
- `exportMode: fast` 失败时会自动回退 `record`；日志里会出现 `Fast export failed ... falling back to record mode`

**Q: 开了 fast 反而更慢**

fast 每一帧都要把 WebGL 画布读回给编码器，核显上这一步可能比「等墙钟录完」还贵。短片继续用 `record`；长片或独显再开 `fast`。也可把 `renderScale` 从 `1.5` 降到 `1.0` 减轻读回。

## 相关项目

- [astrbot_plugin_msst](https://github.com/yonglanws/astrbot_plugin_msst) ——
  官方 AstrBot 插件：AI 剧本生成、队列调度与机器人视频回传，通过 HTTP API 与本宿主交互

## 许可证

本项目基于 [Untitled-Story/MySekaiStoryteller](https://github.com/Untitled-Story/MySekaiStoryteller)
二次开发，沿用 **[GNU GPL v3](LICENSE)** 许可证开源；导出视频的使用另受原项目中的
[VIDEO-LICENSE-CN.md](VIDEO-LICENSE-CN.md) 约束。

## 致谢

- [Untitled-Story/MySekaiStoryteller](https://github.com/Untitled-Story/MySekaiStoryteller)
- [Sekai-World/sekai-viewer](https://github.com/Sekai-World/sekai-viewer)
- [lezzthanthree/SEKAI-Stories](https://github.com/lezzthanthree/SEKAI-Stories)
