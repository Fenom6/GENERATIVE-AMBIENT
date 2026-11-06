@echo off
setlocal
node "%~dp0tools\serve.mjs" 8787 --open
if errorlevel 1 pause
