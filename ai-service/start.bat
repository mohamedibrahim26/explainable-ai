@echo off
echo.
echo  =========================================
echo   Orion AI Service  ^|  Python FastAPI
echo  =========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)

:: Create venv if it doesn't exist
if not exist "venv\" (
    echo [1/3] Creating virtual environment...
    python -m venv venv
)

:: Activate
call venv\Scripts\activate.bat

:: Install deps
echo [2/3] Installing dependencies...
pip install -r requirements.txt --quiet

:: Copy .env if missing
if not exist ".env" (
    echo [!] No .env found — copying from .env.example
    copy .env.example .env
    echo [!] IMPORTANT: Edit ai-service\.env and add your API keys before continuing.
    notepad .env
    pause
)

:: Start service
echo [3/3] Starting Orion AI service on port 8000...
echo.
python main.py
pause
