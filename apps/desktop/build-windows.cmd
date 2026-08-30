@echo off
setlocal
call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
if errorlevel 1 exit /b %errorlevel%
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
corepack pnpm --filter @nodra/desktop tauri build
