# Application Hub

A job-application tracker I built to run as a small web app — one service you can host once and open from your laptop or phone. It keeps track of where each
application stands, and uses the Anthropic API (with your own key, kept on the server) to match your resume against a job description, pull out keywords, check
what the posting says about visa sponsorship, and draft cover letters.

## What it does

- **Applications board** — move roles through Saved → Applied → Interview → Offer, filter by priority/level/sponsorship/platform, search, and keep details per rol (contacts, comp, dates, posting link, notes).
- **Resume match** — attach a resume (PDF/DOCX/TXT) to a role and get a coverage score against the JD, which keywords are present vs missing, format checks, and tailoring suggestions. There's an "apply suggestions" step that turns those into concrete before/after bullet rewrites.
- **Sponsorship check** — the analysis pulls out, word for word, anything the JD says about sponsorship or work authorization, so you can read it and decide.
- **Cover letters** — generate a draft from your actual resume for a given role.
- **JD Keywords tab** — paste any JD to get the keywords worth mirroring, or add a resume to compare the two. (The resume here is just for the session.)
- **Notes** — simple rich-text notes (headings, bold, bullets) you can add, edit, and delete.
- **Excel export** — download all your applications as a spreadsheet.
- **Password** — optionally lock the whole thing behind one shared password before putting it online.

## How it's put together

- **Backend** — FastAPI. It proxies Anthropic so the key never reaches the browser, stores everything in a database, holds uploaded resume files, and serves the built frontend in production (so it's all one service at one URL).
- **Frontend** — React + Vite. It calls the API at `/api/...`, which works the same in local dev (Vite proxies it) and in production (same origin), so there's no CORS to deal with.
- **Database** — same code, one env var: SQLite locally, Postgres when hosted.

## Running it locally

Two terminals, both with hot reload:

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # put your key in .env
uvicorn main:app --reload --port 8787

# frontend
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Health check: http://localhost:8787/api/health

One gotcha: `--reload` only watches `.py` files, so if you change `.env` you have to restart uvicorn for it to take effect.

## Running it as one service (like production, but local)

```bash
cd frontend && npm install && npm run build      # builds into frontend/dist
cd ../backend && source .venv/bin/activate
STATIC_DIR=../frontend/dist uvicorn main:app --port 8787
```

Everything's then at http://localhost:8787.

## With Docker

```bash
# one container (SQLite inside it — fine to try, but wiped on restart)
docker build -t job-hub .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... job-hub

# app + a Postgres database (data sticks around)
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

The image builds the frontend and serves it from FastAPI, and it respects the platform's `$PORT`, so it works on Render, Railway, Fly.io, a VPS, etc. without changes.

## Putting it online (and using it on your phone)

It's a website, so once it's deployed you just open the URL anywhere. Rough steps:

1. Push the repo to GitHub.
2. Make a service on Render/Railway/Fly from the repo (they read the Dockerfile).
3. Add a managed Postgres and set `DATABASE_URL` to it. This is what lets your
   laptop and phone see the same data — don't rely on SQLite in a container, a
   restart wipes it.
4. Set `ANTHROPIC_API_KEY`, `APP_PASSWORD`, and `DATABASE_URL` in the host's env.
5. Deploy, open the URL, enter the password once, and your data's there.

There's no live sync, so refresh after switching devices to pull the latest. Saves write the whole list at once, so don't edit on two devices at the exact same time.

## Environment variables

Set these in `backend/.env` locally, or in the host's settings when deployed.

| Variable | Default | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Your Anthropic key. Stays on the server. |
| `APP_PASSWORD` | empty | Password to get into the app. Empty means no login. Set it before going public. |
| `DATABASE_URL` | `sqlite:///./jobhub.db` | Use a `postgresql://...` URL for hosted, shared storage. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Which model the proxy uses. |
| `MAX_TOKENS_CAP` | `1500` | Caps the response size. |
| `ALLOWED_ORIGINS` | `*` | CORS — only matters if the frontend is on a different origin. |
| `STATIC_DIR` | empty | Folder of the built frontend to serve (Docker sets this). |

## A note on the API key

The key only lives in the backend environment (`.env` locally, host env vars in production) and is git-ignored, so it never ends up in the frontend or the repo.
When `APP_PASSWORD` is set, every `/api` request needs it, so a stranger who finds the URL can't use your key. The proxy also pins the model and caps the response size server-side.

If `claude-sonnet-4-6` ever goes away, set a current model in `ANTHROPIC_MODEL`
(see the Anthropic models page).
