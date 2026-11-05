# Puts a "zcord" shortcut with the zcord icon on the Desktop (Windows).
# Run with -Force to recreate it (for example after moving the zcord folder).
param([switch]$Force)

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'zcord.lnk'
if ((Test-Path $link) -and -not $Force) { exit 0 }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = Join-Path $root 'node_modules\electron\dist\electron.exe'
$s.Arguments = '"' + $root + '"'
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root 'build\icon.ico') + ',0'
$s.Description = 'zcord screen recorder'
$s.Save()
Write-Host 'Added a zcord shortcut to your Desktop.'
