@echo off
chcp 65001 >nul
title VINOH! Finanzas
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Para usar VINOH! Finanzas hace falta instalar Node.js ^(es gratis^).
  echo   Te abro la pagina: descarga la version "LTS", instalala y despues
  echo   volve a hacer doble clic en este archivo.
  echo.
  start "" "https://nodejs.org/es/download"
  pause
  exit /b 1
)
node scripts\iniciar.mjs
echo.
echo   VINOH! se cerro. Podes cerrar esta ventana.
pause
