# 打包安装程序：Token Monitor Lite (Windows x64)
# 用法（需要 Node.js 18+ 且能联网，首次会自动下载 Electron 与 NSIS 工具）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
# 产物：
#   dist\Token-Monitor-Lite-Setup-0.1.0.exe   双击安装的安装包
#   dist\Token-Monitor-Lite-0.1.0.exe         免安装便携单文件
#   另外 dist\win-unpacked\ 是绿色目录，可直接运行

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command node)) {
  Write-Host '未找到 node。请先安装 Node.js (>=20)：https://nodejs.org/ 安装后重开终端。' -ForegroundColor Red
  exit 1
}
if (-not (Test-Command npm)) {
  Write-Host '未找到 npm。请确认 Node.js 安装完整（勾选 Add to PATH）。' -ForegroundColor Red
  exit 1
}

Write-Host '[1/3] 安装依赖（含 electron-builder）...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }

Write-Host '[2/3] 打包 win-unpacked（验证 app 可打包）...' -ForegroundColor Cyan
npm run pack:win:dir
if ($LASTEXITCODE -ne 0) { throw '打包 win-unpacked 失败' }

Write-Host '[3/3] 生成安装包 + 便携 exe ...' -ForegroundColor Cyan
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw '生成安装包失败' }

Write-Host ''
Write-Host '完成！产物：' -ForegroundColor Green
Get-ChildItem dist -File | Where-Object { $_.Extension -eq '.exe' } | ForEach-Object { Write-Host "  $($_.FullName)" }

# 若已有一份 win-unpacked（例如 runtime-test\Token-Monitor-Lite），可用它直接出安装包而不用下载 Electron：
#   npx electron-builder --prepackaged "runtime-test\Token-Monitor-Lite" --win nsis --x64 --publish never
