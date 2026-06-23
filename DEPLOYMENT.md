# AHLink Express OS deployment plan

AHLink Express OS is separate from the old AHLink Delivery Manager project. Do not deploy it into the old Firebase/Cloud SQL setup.

## Database

Use the dedicated Neon project for AHLink Express OS.

- Store the connection string as a secret/environment variable named `DATABASE_URL`.
- Do not commit `neon-env.cmd` or any file containing the database password.
- Rotate the Neon password if it was pasted into chat, screenshots, logs, or shared documents.

Expected environment variable:

```cmd
DATABASE_URL=postgresql://neondb_owner:REAL_PASSWORD@REAL_HOST/neondb?sslmode=verify-full&channel_binding=require
```

The app creates the `app_state` table automatically on startup.

## Hosting/server

This app is a Node.js server, not a static-only Firebase Hosting site. Deploy it to a Node-capable host such as:

- Render
- Railway
- Fly.io
- Google Cloud Run
- Azure App Service

Required deployment settings:

- Node.js 20 or newer
- Build/install command: `npm install`
- Start command: `npm start`
- Environment secret: `DATABASE_URL`
- Public port: use the host-provided `PORT` variable

## Recommended first public host: Render

This repository now includes `render.yaml`.

Steps:

1. Push only the `ahlink-express-os` project to a GitHub repository, or connect the parent repository and set the service root to `ahlink-express-os`.
2. In Render, choose **New > Blueprint** or **New > Web Service**.
3. Select the repository.
4. Use:
   - Build command: `npm install`
   - Start command: `npm start`
   - Root directory: `ahlink-express-os` if the repo contains more than this app.
5. Add an environment variable named `DATABASE_URL`.
6. Paste the real Neon connection string as the value.
7. Deploy.

After deployment, Render will give a public URL such as:

```text
https://ahlink-express-os.onrender.com
```

## Local production-style start

From Command Prompt:

```cmd
cd /d C:\Users\USER\Desktop\AHLink_intelligence_graphs_premium\ahlink-express-os
set "DATABASE_URL=postgresql://neondb_owner:REAL_PASSWORD@REAL_HOST/neondb?sslmode=verify-full&channel_binding=require"
npm.cmd start
```

Use `start-ahlink-express-os.cmd` for local convenience on port `6062`.

## Separation rule

Keep these separate:

- AHLink Delivery Manager: old project, old database/Firebase path.
- AHLink Express OS: this folder, dedicated Neon database, Node server deployment.
