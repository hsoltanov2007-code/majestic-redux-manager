@echo off
setlocal
cd /d "%~dp0.."

set /p VERSION=Version, example 0.1.50: 
set /p URL=Installer URL: 
set /p SIGNATURE=Signature: 
set /p NOTES=Notes [Hardy MODS Update]: 

if "%NOTES%"=="" set NOTES=Hardy MODS Update

npm.cmd run release:manifest -- --version "%VERSION%" --url "%URL%" --signature "%SIGNATURE%" --notes "%NOTES%"
pause
