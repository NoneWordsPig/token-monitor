# Token Monitor Lite

轻量版 Token Monitor：**保留原有 tokscale 后端**，把渲染层换成一个小型悬浮窗 UI，降低内存占用。

基于已安装的 Token Monitor（v0.46.0，依赖 tokscale 4.13）的 `src/` 后端原样保留，仅替换了渲染层三个文件：
`src/electron/renderer/index.html`、`styles.css`、`app.js`。

## 功能

- **日 / 周 / 月统计（同一界面）**：DAY / WEEK / MONTH 三张卡片，显示 token 数与费用；底部显示 TOTAL（历史累计）。
- **不同 AI 工具用量**：按工具列出 token 用量、费用与占比条。
- **不同 LLM 模型用量**：点击标题栏 `◈` 按钮可切换为按模型展示（会保存到设置 `breakdownMode`），其余两块保持不变。
- **使用额度**：按服务商展示额度窗口（用量 / 上限 / 百分比 / 重置时间 / 余额），超 70% 变黄、超 85% 变红。
- 点击 DAY / WEEK / MONTH 卡片可切换明细统计区间；周统计由本地历史归档（`dashboard:getHistory`）推导，并叠加实时今日数据避免重复计数。
- UI 风格：白色高透明毛玻璃（约 90% 透明度）、深色文字、薄荷绿强调色，尽量贴近参考版布局。

## 运行

免安装直接运行：双击根目录的 `启动 Token Monitor Lite.cmd`（或直接运行
`runtime-test\Token-Monitor-Lite\Token Monitor.exe`）。首次启动会自动居中显示，
窗口无边框、不占任务栏，数据来自 tokscale 后端采集。

从源码运行：

需要 Node.js >= 22.15。

```bash
npm install
npm start        # 等价于 electron .
```

首次运行会自动通过 tokscale 采集本机 Claude Code / Codex / Hermes / Copilot 等工具的使用记录。

## 调试

- 渲染页带 `liteDebug=1` 查询参数时会暴露 `window.__liteDebug`，可注入模拟数据预览 UI：
  ```js
  window.__liteDebug.setSettings({ currency: 'USD', compactTokenUnits: 'western', language: 'en', breakdownMode: 'tool' });
  window.__liteDebug.setStats({ periods: { today: {...}, month: {...}, allTime: {...} }, limits: {...} });
  ```
- 主进程日志在终端输出，采集过程可通过 `[collector]` / `[window]` 前缀观察。

## 与参考版的差异

- 保留：`src/electron/main.js`（窗口、采集调度、IPC、托盘）、`src/shared/*`（tokscale 后端）、`src/hub/*`。
- 替换：渲染层三件套，不再加载原来的 45 个渲染脚本（约 700KB 的 `app.js`、461KB 的 `i18n.js` 等），渲染进程内存显著下降。
- 精简：`package.json` 去掉打包/发布脚本，仅保留开发启动；产品名 `Token Monitor Lite`，独立 `userData`，不会与完整版互相覆盖设置。

## 目录说明

- `runtime-test/`：本机快速试运行目录（gitignore），使用已安装版 Token Monitor 的 Electron 外壳 + 本项目 `resources/app`，可直接双击 `runtime-test\Token-Monitor-Lite\Token Monitor.exe` 运行。
- `参考/`：参考源码仓库（gitignore）。
