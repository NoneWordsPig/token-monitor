# 开机自启（登录 Windows 后自动启动 Token Monitor Lite）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\enable-autostart.ps1
# 也可以指定程序路径：
#   powershell -ExecutionPolicy Bypass -File scripts\enable-autostart.ps1 -TargetExe "D:\Apps\Token Monitor Lite.exe"

param(
  [string]$TargetExe = ''
)

$scriptDir = $PSScriptRoot
$repoRoot = Split-Path $scriptDir -Parent

if (-not $TargetExe) {
  $candidates = @(
    (Join-Path $repoRoot 'runtime-test\Token-Monitor-Lite\Token Monitor.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Token Monitor Lite\Token Monitor Lite.exe')
  )
  $TargetExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $TargetExe -or -not (Test-Path $TargetExe)) {
  Write-Host "找不到程序，请用 -TargetExe 指定：enable-autostart.ps1 -TargetExe `"完整路径\xxx.exe`"" -ForegroundColor Red
  exit 1
}
$TargetExe = (Get-Item $TargetExe).FullName

$startupDir = [Environment]::GetFolderPath('Startup')
if (-not (Test-Path $startupDir)) { New-Item -ItemType Directory -Path $startupDir -Force | Out-Null }
$lnkPath = Join-Path $startupDir 'Token Monitor Lite.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $TargetExe
$shortcut.WorkingDirectory = Split-Path $TargetExe -Parent
$shortcut.Description = 'Token Monitor Lite'
$shortcut.Save()

Write-Host "已启用开机自启：$lnkPath -> $TargetExe" -ForegroundColor Green
Write-Host '任务管理器 -> 启动应用 里也能看到并管理它。'
