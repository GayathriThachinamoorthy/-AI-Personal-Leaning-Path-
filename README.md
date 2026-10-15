# LearnPath AI

Personalized AI learning roadmaps. This repository is being reorganized toward the frontend/backend layout below. The current complete app remains available in the root Express server and `public/`; the new React and Flask folders are the migration foundation, so the legacy routes and screens are still the production implementation.

## Structure

```text
frontend/                 React + TypeScript + Vite + Tailwind foundation
  src/components/         Reusable UI components
  src/pages/              Route-level pages
  src/layouts/            App shell and layouts
  src/services/           API services
  src/stores/             Zustand state
  src/hooks/              React hooks
  src/types/              TypeScript interfaces
  src/lib/                Utilities and API client
  public/                 Static assets
backend/                  Flask API foundation
  app/routes/             Blueprint route handlers
  app/services/           Business logic
  app/ai/                  Gemini integration
  app/research/            Research helpers
  app/schemas/             Request and response schemas
  app/utils/               Shared utilities
  migrations/              Backend migrations
  tests/                   Backend test suite
supabase/                  Database config and RLS migrations
  migrations/
  seed.sql                 Optional seed data (add when needed)
public/                    Existing LearnPath app (kept working during migration)
server.js                 Existing Express API (kept working during migration)
```

## Run the existing app

The existing app still uses Node.js 18+, Express, and Gemini. Set `GEMINI_API_KEY` in the root `.env`, then run:

```powershell
npm.cmd install
npm.cmd start
```

Open http://localhost:3000. Do not commit `.env` or API keys.

## Deploy frontend to Vercel and API to Render

This app's API runs in `server.js` on Render. Vercel serves the static files in `public/` and proxies `/api/*` requests to Render, so the Gemini key stays on the backend.

### Render API service

- Root directory: repository root
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Environment variables: set `GEMINI_API_KEY` to the Gemini API key in the Render service's **Environment** settings. For direct browser-to-Render access, also set `ALLOWED_ORIGINS` to `https://ai-personal-leaning-path.vercel.app` (include any custom domain; no path or trailing slash). The included Vercel proxy does not require browser CORS configuration.
- Save and deploy/redeploy after adding the variables. The local `.env` file is ignored by Git and is not uploaded to Render.

### Vercel static frontend

- Project root: repository root
- Keep the checked-in `vercel.json`; it builds the frontend from `public/`.
- The Vercel rewrite in `vercel.json` forwards `/api/*` to `https://ai-personal-leaning-path.onrender.com/api/*`. No Gemini key or API URL environment variable is needed on Vercel. If the Render URL changes, update the rewrite destination and redeploy.

After deploying the updated code, open both `https://ai-personal-leaning-path.onrender.com/api/health` and `https://ai-personal-leaning-path.vercel.app/api/health`. Both should report `aiConfigured: true` and `aiAvailable: true`. If Render reports `aiConfigured: false`, add `GEMINI_API_KEY` to the **Render web service** environment and redeploy; adding it to Vercel or only to your local `.env` will not configure the Render process. The Vercel API route should match Render through the rewrite.

Render environment variables are configured in the service dashboard and become active on deploy; Vercel environment variable changes apply to new deployments. See [Render's environment variables guide](https://render.com/docs/configure-environment-variables) and [Vercel's environment variables guide](https://vercel.com/docs/environment-variables).

## Start the new frontend foundation

```powershell
cd frontend
npm install
npm run dev
```

The frontend API client reads `VITE_API_URL` (defaults to `http://localhost:5000`). The initial screen links to the existing app while routes and features are migrated.

## Prepare the Flask backend

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

The Flask API and persistence migration are not yet wired to the existing endpoints. Keep using the root Express server until those routes are ported.

## Supabase

Apply `supabase/migrations/202610150001_initial_schema.sql` to a Supabase project to create profile/roadmap tables and user-scoped RLS policies. Set the Supabase URL and keys in the backend environment. The service role key must remain server-side; never add it to `frontend` variables.
