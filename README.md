# Token Monitor Lite

轻量版 Token Monitor：**保留原有 tokscale 后端**，把渲染层换成一个小型悬浮窗 UI，降低内存占用。

基于已安装的 Token Monitor 的 `src/` 后端原样保留，仅替换/改进了渲染层
（`src/electron/renderer/index.html`、`styles.css`、`app.js`）与共享采集修复
（`src/shared/collector.js`、`hermesShadow.js`）。

## 功能

- **日 / 周 / 月统计（同一界面，纵向三行）**：DAY / WEEK / MONTH 每行显示完整 token 数与费用
  （千分位整数，不做 K/M/万缩写），点某一行可切换下方明细区间；底部显示 TOTAL（历史累计）。
- **按工具 + 使用模型常驻同屏**：上半区“按工具”，下半区“使用模型”，各自最多 4 行，超出显示 `+N more` 展开。
- **周统计口径**：本周(周一→今天) = 每日历史归档 + 实时“今天”，随采集推送实时重算，
  保证 WEEK ≥ DAY（周一相等）；与“本月”窗口独立。
- **使用额度**：按服务商展示额度窗口（用量 / 上限 / 百分比 / 重置时间 / 余额），超 70% 变黄、超 85% 变红。
- 首次打开加速：同日数据缓存到 localStorage 首帧即渲染；加载期显示 Loading 而非闪 0；
  窗口每 60 秒静默轮询一次最新快照（不强制重扫，托盘隐藏时跳过）。
- UI 风格：白色高透明毛玻璃、深色文字、薄荷绿强调色。

## 运行

免安装直接运行：双击根目录的 `启动 Token Monitor Lite.cmd`（或直接运行
`runtime-test\Token-Monitor-Lite\Token Monitor.exe`）。数据来自 tokscale 后端采集。

从源码运行（需要 Node.js >= 22.15）：

```bash
npm install
npm start        # 等价于 electron .
```

## 打包成安装包（Windows Setup.exe）

本仓库的 `runtime-test\Token-Monitor-Lite\` 已经是完整的“绿色版”应用目录，压缩后即可分发；
要生成“双击安装、带开始菜单/桌面快捷方式/卸载程序”的安装包，需要一台装有 Node.js（>=20）且能联网的电脑：

```bash
npm install
npm run dist:win
```

产物在 `dist\`：

- `Token-Monitor-Lite-Setup-0.1.0.exe` —— 安装包（NSIS，可选安装目录，逐用户安装）
- `Token-Monitor-Lite-0.1.0.exe` —— 免安装便携单文件
- `win-unpacked\` —— 绿色目录

首次运行会联网下载 Electron 43 与 NSIS 工具（数百 MB，之后有本地缓存）。未签名，Windows SmartScreen
可能提示“更多信息 → 仍要运行”。

## 开机自启动

在应用内：本 Lite 悬浮窗未内置“登录时启动”开关（设置面板不在此窗口），推荐用下面两种方式之一：

- 一条命令（推荐）：仓库内执行
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\enable-autostart.ps1
  ```
  脚本默认指向 `runtime-test\Token-Monitor-Lite\Token Monitor.exe`（若已用安装包装到
  `%LOCALAPPDATA%\Programs\Token Monitor Lite\` 也会自动找到）；也可 `-TargetExe "完整路径"` 指定。
  取消：`scripts\disable-autostart.ps1`。
- 手动：`Win+R` → 输入 `shell:startup` → 把“Token Monitor Lite.exe”的快捷方式放进去。

之后可在 `任务管理器 → 启动应用` 里看到并管理。

## 调试

- 渲染页带 `liteDebug=1` 查询参数时会暴露 `window.__liteDebug`，可注入模拟数据预览 UI：
  ```js
  window.__liteDebug.setSettings({ currency: 'USD', compactTokenUnits: 'western', language: 'en' });
  window.__liteDebug.setStats({ periods: { today: {...}, month: {...}, allTime: {...} }, limits: {...} });
  ```
