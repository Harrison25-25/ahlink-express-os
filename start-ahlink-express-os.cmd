@echo off
cd /d "%~dp0"
if "%DATABASE_URL%"=="" (
  echo AHLink Express OS now uses Neon/PostgreSQL only.
  echo.
  echo Please set DATABASE_URL first:
  echo set "DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full^&channel_binding=require"
  echo.
  echo Then run start-ahlink-express-os.cmd again.
  exit /b 1
)
set PORT=6062
npm.cmd start
