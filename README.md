# LearnPath AI

Personalized AI learning roadmaps. Pick any subject, tell the app your level, goal, daily study time and duration, and Gemini builds a week-by-week plan with daily tasks, resources and progress checkboxes. Your profile, roadmap and progress are saved so you can come back anytime.

**Stack:** HTML, CSS, vanilla JavaScript, Node.js (Express), Gemini API.
The Gemini key lives only in `.env` on the server. The browser never sees it.

## Project structure

```
learnpath-ai/
├── server.js          Express server, storage and Gemini calls
├── package.json
├── .env.example       Copy to .env and add your key
├── .gitignore
├── README.md
├── data/              Created automatically (saved users.json)
└── public/            Only this folder is served to the browser
    ├── index.html
    ├── style.css
    └── script.js
```

## Install and run in Windows PowerShell

1. **Install Node.js 18 or newer** from https://nodejs.org (check with `node -v`).
2. **Get a Gemini API key** (free tier available) at https://aistudio.google.com/apikey.
3. **Open the folder in VS Code:** File > Open Folder > `learnpath-ai`.
4. **Open the terminal:** Terminal > New Terminal (or press Ctrl+`).
5. **Install dependencies** (use `npm.cmd` if PowerShell blocks `npm.ps1`):
   ```bash
   npm.cmd install
   ```
6. **Create your `.env` file:**
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   Replace `your_gemini_api_key_here` with your key from https://aistudio.google.com/apikey, save the file, and close Notepad. Keep the key in `.env`; never put it in `public/script.js` or `public/index.html`. `GEMINI_MODEL` defaults to `gemini-2.5-flash`; after one retry, transient 503 overloads automatically fall back to `gemini-3.5-flash-lite`. Both model settings can be changed if needed.
7. **Start the server:**
   ```powershell
   npm.cmd start
   ```
8. **Open the app:**
   ```powershell
   Start-Process http://localhost:3000
   ```

Check the server and Gemini model/key access from another PowerShell terminal:
```powershell
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json
```
The response includes `ok`, `model`, `aiConfigured`, `aiAvailable`, and `aiStatus`. `aiAvailable: true` means the server verified that the key can access a model supporting `generateContent`.

Run the JavaScript syntax checks with `npm.cmd run check`.

## How to use

1. Click **Create My Path** on the homepage.
2. Fill in your profile: any domain you like, skill level, goal, daily study hours and duration.
3. Click **Save My Profile**. This stores your profile without generating a roadmap.
4. Click **Generate My Path**. Gemini creates the roadmap from the saved profile. Replacing an existing roadmap requires confirmation because progress will reset.
5. Open each week to see daily tasks, checkpoints, and resources. Tick tasks as you finish them.
6. Ask a question from your roadmap for a current answer with Google Search-grounded sources.
7. Come back later on the same browser and your profile, roadmap and progress are restored.

## API endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/state/:id` | Load profile, roadmap and progress |
| PUT | `/api/profile/:id` | Validate and save the profile |
| POST | `/api/roadmap/:id` | Generate a roadmap from the saved profile (resets progress) |
| POST | `/api/ask/:id` | Answer a learner question using Gemini Google Search grounding |
| PUT | `/api/progress/:id` | Save checked tasks |
| GET | `/api/health` | Check the server and whether a key is set |

## How saving works

On first visit the browser creates a random ID (kept in `localStorage`). Everything is stored on the server in `data/users.json` under that ID. Clearing browser data or switching browsers starts a fresh account. There are no logins, so this is meant for personal or local use.

## Security notes

- `.env` and `data/` are in `.gitignore`. Never commit your key.
- The server only serves `public/`, so `server.js` and `.env` cannot be downloaded.
- All AI text is inserted with `textContent`, never as HTML, and resource links are search queries rather than AI-invented URLs.
- Before deploying publicly, add user accounts and rate limiting to `/api/roadmap`, since each call uses your Gemini quota.

## Troubleshooting

- **"Can't reach the server"**: the backend is not running, or you opened the HTML file directly. In the VS Code terminal run `npm install`, then `npm start`, and open **http://localhost:3000**. The page also detects a server on port 3000 if you use Live Server, and shows a banner when none is found.
- **Gemini is unavailable**: inspect `/api/health`; verify the `.env` key, model access, and quota, then restart the server after changing `.env`.
- **"Gemini returned an error (400/403)"**: the key is wrong or restricted. Create a new one in AI Studio.
- **Error 404 for the model**: set `GEMINI_MODEL` in `.env` to a model your key can use, such as `gemini-2.5-flash`.
- **Quota or network errors**: wait and retry; generation does not show placeholder plans when Gemini fails.
- **Port in use**: change `PORT` in `.env`.
