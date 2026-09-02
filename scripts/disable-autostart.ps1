# 取消开机自启（删除上一步在“启动”文件夹创建的快捷方式）

$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startupDir 'Token Monitor Lite.lnk'
if (Test-Path $lnkPath) {
  Remove-Item -LiteralPath $lnkPath -Force
  Write-Host '已取消开机自启。' -ForegroundColor Green
} else {
  Write-Host '未找到自启快捷方式（可能本来就没启用）。' -ForegroundColor Yellow
}
