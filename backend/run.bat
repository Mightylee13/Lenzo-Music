@echo off
REM Lenzo Music backup backend - starts the yt-dlp fallback API on port 8765
cd /d "%~dp0"
if not exist venv (
  py -3.12 -m venv venv
  venv\Scripts\python -m pip install -r requirements.txt
)
venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8765
