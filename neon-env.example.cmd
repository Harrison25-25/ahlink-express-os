@echo off
rem Copy this file to neon-env.cmd, then replace the placeholder with your Neon connection string.
rem Keep neon-env.cmd private because it contains the database password.

set DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
set PORT=6062
