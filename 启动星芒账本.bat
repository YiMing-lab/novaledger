@echo off
cd /d "%~dp0"
chcp 65001 >nul
title 星芒账本 · NovaLedger (Material Design 3 桌面端)

echo =========================================================
echo   ✧ 星芒账本 · NovaLedger (Material Design 3 桌面版)
echo   正在启动原生桌面窗口，请稍候...
echo =========================================================

set "PYTHON_EXE="
if exist "%USERPROFILE%\.agent-reach-venv\Scripts\python.exe" (
    set "PYTHON_EXE=%USERPROFILE%\.agent-reach-venv\Scripts\python.exe"
)
if not defined PYTHON_EXE if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
)
if not defined PYTHON_EXE (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=python"
    )
)

if not defined PYTHON_EXE (
    echo [错误] 未检测到 Python 运行环境，请先配置 Python！
    pause
    exit /b 1
)

"%PYTHON_EXE%" "%~dp0run.py" --mode desktop
if %errorlevel% neq 0 (
    echo.
    echo [提示] 桌面端运行退出，退出代码: %errorlevel%
    pause
)
