# Token Bubble 余量浮窗

**简体中文** · [English](README.en.md)

Token Bubble 是一个本地优先的 Codex 额度与 Token 用量桌面浮窗。它将额度、Token 分布、估算花费和近期用量放在一个可调整、可固定的轻量面板中。

Token Bubble 基于 **Quota Float** 开发，并集成 **CodexScope** 的本地用量验证功能。原项目版权及许可证归各自作者所有，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 下载

- [下载最新版安装包](https://github.com/h17612764275-cloud/token-bubble/releases/latest)
- 当前版本：`v0.2.3`
- Windows 用户下载 Release 中的 `.exe` 安装包。

## v0.2.3 修复更新（2026-08-29）

- **截图结束不再出现缩小动效**：Windows 截图窗口禁用系统过渡，完成或取消截图时不再播放明显的缩小动画。
- **新截图不再记忆上次标注工具**：复用截图窗口时自动清空箭头、画笔等工具选择；新截图默认恢复选区移动操作。

## v0.2.2 功能更新（2026-08-11）

> 以下是 `v0.2.2` 的主要更新；安装包与源码版本保持一致。

- **Windows 本地截图与贴图**：从面板相机按钮配置截图，再按全局快捷键（默认 `Ctrl+P`）开始；支持框选、移动、八方向缩放、矩形、圆形、箭头、画笔、马赛克和文字标注。当前截图、剪贴板复制和贴图仅支持 Windows。
- **保存、剪贴板与置顶**：完成后自动保存 PNG 并复制到剪贴板，也可以另存为或把选区作为可拖动、可缩放的置顶贴图。
- **截图设置**：可以修改全局快捷键、选择默认保存文件夹，并直接打开截图目录。
- **额度异常自动恢复**：短暂断网时保留最后一次有效额度，30 秒后自动重试；异常浮窗悬停可立即刷新，托盘与浮窗会同步恢复结果。
- **响应顺序保护**：较旧的成功额度响应不会覆盖更新额度或较新的已退出状态，也不会污染每日用量基线。

## 界面预览

最新主面板截图由当前 `main` 界面和内置模拟数据生成，不包含真实账号或个人用量数据。

### 当前主面板

![Token Bubble 当前主面板，包含截图设置入口](docs/images/token-bubble-panel.png?v=2026-08-11)

### 两款面板皮肤

Token Bubble 提供肥皂泡皮肤（Bubble）和玻璃瓶皮肤（Glass）。面板与浮窗会同步使用所选皮肤的材质和视觉样式。

| 肥皂泡皮肤（Bubble） | 玻璃瓶皮肤（Glass） |
| --- | --- |
| ![Token Bubble 肥皂泡皮肤面板和浮窗](docs/images/token-bubble-skin-bubble-overview.png?v=0.2.0) | ![Token Bubble 玻璃瓶皮肤面板和浮窗](docs/images/token-bubble-skin-glass-overview.png?v=0.2.0) |

### 两款皮肤均可自由取色

Bubble 和 Glass 两款面板都支持取色换色。打开取色器后，可以使用色板、色相条或 RGB 数值设置喜欢的界面颜色。

![Token Bubble 面板取色器](docs/images/token-bubble-color-picker.png?v=0.2.0)

### 今日、近7天和近30天

点击用量范围可以在今日、近7天和近30天之间切换。面板会同步更新 Token 总量、柱状图、Token 类型分布和估算花费。

| 今日 | 近7天 | 近30天 |
| --- | --- | --- |
| ![Token Bubble 今日 Token 用量](docs/images/token-bubble-skin-bubble-today.png?v=0.2.0) | ![Token Bubble 近7天 Token 用量](docs/images/token-bubble-skin-bubble-7d.png?v=0.2.0) | ![Token Bubble 近30天 Token 用量](docs/images/token-bubble-skin-bubble-30d.png?v=0.2.0) |

### 浮窗样式

浮窗会匹配 Bubble 或 Glass 皮肤，可调整尺寸、固定位置并保持置顶。点击浮窗可以打开完整面板。

| Bubble 浮窗 | Glass 浮窗 |
| --- | --- |
| ![Token Bubble Bubble 浮窗](docs/images/token-bubble-orb-bubble.png?v=0.2.0) | ![Token Bubble Glass 浮窗](docs/images/token-bubble-orb-glass.png?v=0.2.0) |

### 本地实时中英文语音输入

按一次自定义快捷键开启持续识别，再按一次关闭。语音会边说边显示文字，支持中文、英文及中英混说，并通过本地模型自动补充标点。快捷键、麦克风设备和识别灵敏度均可设置。

![Token Bubble 本地语音输入状态](docs/images/token-bubble-voice-states.png?v=0.2.0)

## 主要功能

- 显示 Codex 周期剩余额度、刷新时间和额度状态。
- 切换今日、近7天、近30天的 Token 用量。
- 展示输入、缓存、输出和推理 Token 的分布。
- 根据本地 Token 用量估算花费。
- 使用柱状图和近90天热力图查看使用趋势。
- 切换 Bubble 与 Glass 面板皮肤，并为两款皮肤自由取色。
- 调整浮窗大小、固定浮窗位置并保持窗口置顶。
- 设置会员续费日期并显示距离续费还有多少天。
- 从托盘快速刷新、显示或隐藏面板和浮窗。
- 使用完全本地的中英文实时语音输入、自动标点和语音活动检测。
- 统计今日语音输入字数，并在近90天热力图中查看语音用量。
- 在 Windows 上使用本地截图工具完成区域选择、标注、保存、复制和置顶贴图。
- 在网络恢复后自动刷新额度，并在托盘面板与浮窗之间同步成功结果。

## 使用说明

1. 安装并启动 Token Bubble。
2. 确保本机 Codex Desktop 已登录。
3. 点击面板中的用量范围，在今日、近7天和近30天之间切换。
4. 使用右侧控制按钮切换 Bubble/Glass 皮肤、打开取色器、调整尺寸或固定浮窗。
5. 点击顶部续费日期设置会员续费时间。
6. 在语音栏设置快捷键、输入设备和灵敏度；按一次快捷键开启识别，再按一次关闭。
7. Windows 用户可点击顶部相机按钮配置截图快捷键和保存目录；按快捷键框选区域，完成后保存、复制或置顶。

## 数据与隐私

Token Bubble 在本机读取现有 Codex Desktop 登录状态，以只读方式查询额度。Token 用量历史、语音字数统计、界面设置、截图设置和会员续费日期保存在本地。语音识别、标点恢复和截图处理均在本机运行。

- 不上传提示词、聊天内容或本地用量历史。
- 不记录遥测、分析数据或崩溃报告。
- 不兑换重置额度，也不修改账户设置。
- 本地 Token 统计用于历史和验证视图，不会替代服务端返回的真实额度。
- 麦克风音频不会上传或保存；仅最终识别字数用于本地统计。
- 屏幕内容只会在用户主动截图时读取；截图不会上传，由用户保存到本地并复制到系统剪贴板。

完整边界请查看 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 来源与授权

Token Bubble 是独立的衍生项目，并非 Quota Float 或 CodexScope 的官方版本。

- **Quota Float**：提供了基础桌面浮窗架构与 Codex 额度展示能力。
- **CodexScope**：提供了本地 Token 用量验证相关组件。
- **sherpa-onnx / Paraformer**：提供本地中英文流式识别和中英文标点恢复运行时及模型。
- **Token Bubble**：在上述基础上增加了新的面板、皮肤、时间范围、Token 分布、估算花费、浮窗控制、会员续费设置和本地语音输入。

许可证和第三方声明见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 本地开发

需要 Node.js 20+、Rust stable 和 Tauri 2 对应的系统依赖。

```bash
npm install
npm run models:fetch
npm run test
npm run build
npm run tauri dev
```

构建安装包：

```bash
npm run tauri build
```

## 反馈

请通过 [GitHub Issues](https://github.com/h17612764275-cloud/token-bubble/issues) 提交问题或建议。发布截图和日志前，请移除令牌、账号信息、邮箱和本地文件路径。
