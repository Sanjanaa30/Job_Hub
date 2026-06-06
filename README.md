# Application Hub

A personal job-application tracker that runs as a proper web app — one service
you can host anywhere and open from any device (laptop or phone). It tracks your
applications, and uses **your own Anthropic API key** (kept server-side) to
match your resume against job descriptions, surface keywords, flag visa
sponsorship, and draft cover letters.

## Features

- **Applications board** — track roles through stages (Saved → Applied →
  Interview → Offer); filter by priority, level, sponsorship, and platform;
  search; per-role details (contacts, comp, dates, posting link, notes).
- **Resume match (per role)** — attach a resume (PDF / DOCX / TXT) to each
  application and get an AI **coverage score** vs the JD, present/missing
  keywords, resume format checks, and honest **tailoring suggestions**.
- **ATS-friendly rewrites** — turn the suggestions into concrete before→after
  bullet rewrites, a skills line, and ATS formatting fixes (never inventing
  experience).
- **Visa-sponsorship scan** — the analysis quotes, verbatim, everything the JD
  says about sponsorship / work authorization so you can decide for yourself.
- **Cover letters** — generate a tailored draft per role from your real resume.
- **JD Keywords tab** — paste any JD to extract the keywords worth mirroring, or
  add a resume to compare resume ↔ JD. (This tab's resume is session-only and
  clears on refresh.)
- **Notes tab** — rich-text notes (headings, bold, bullets) with create / edit /
  delete.
- **Re-analyze all** — bulk-refresh every role's match score in one click.
- **Excel export** — download all applications as a spreadsheet.
- **Optional password gate** — protect the whole app (and your API key) with a
  single shared password before deploying publicly.

## Architecture

- **Backend (FastAPI)** — proxies Anthropic (key never reaches the browser),
  stores data in a database, stores uploaded resume files, and **serves the
  built frontend** in production so the whole app is one service at one URL.
- **Frontend (React + Vite)** — calls the API at a relative `/api/...` path, so
  it works the same in local dev (via Vite's proxy) and in production
  (same origin). No CORS to fight.
- **Database** — one env var, same code: SQLite locally, Postgres when hosted.

---

## Local development (two servers, hot reload)

```bash
# 1) backend
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # paste your key into .env
uvicorn main:app --reload --port 8787

# 2) frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :8787)
```

Health check: http://localhost:8787/api/health

> Note: changes to `.env` are **not** picked up by `--reload` (it only watches
> `.py` files). Restart uvicorn after editing `.env`.

---

## Run it as one service (production-style, locally)

```bash
cd frontend && npm install && npm run build      # outputs frontend/dist
cd ../backend && source .venv/bin/activate
STATIC_DIR=../frontend/dist uvicorn main:app --port 8787
```

Now the whole app is at http://localhost:8787 — frontend and API together.

---

## Run anywhere with Docker

```bash
# single container (SQLite inside the container — fine to try, but ephemeral)
docker build -t job-hub .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... job-hub

# full stack with a Postgres database (data persists in a volume)
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

Open http://localhost:8787. The image builds the frontend and serves everything
from FastAPI, honouring the platform's `$PORT` — so it drops onto Render,
Railway, Fly.io, a VPS, or any container host unchanged.

---

## Deploy it (use from your phone, anywhere)

The app is a website — once deployed, open the URL on any device. The checklist:

1. Push this repo to GitHub.
2. Create a service on **Render / Railway / Fly.io** from the repo (they read the
   `Dockerfile`).
3. Add a **managed Postgres** database and set `DATABASE_URL` to it. *(This is
   what lets your laptop and phone share the same data — don't rely on SQLite in
   a container; a restart can wipe it.)*
4. Set environment variables: `ANTHROPIC_API_KEY`, `APP_PASSWORD`, and
   `DATABASE_URL`.
5. Deploy → you get an `https://…` URL. Open it on your phone, enter the
   password once, and your data is there.

> The host provides HTTPS automatically, so the password and data are encrypted
> in transit. On your phone you can "Add to Home Screen" for an app-like icon.

**A note on multi-device use:** data is shared via the one Postgres database, but
there is no live sync — refresh after switching devices to pull the latest. Saves
write the whole list at once, so avoid editing on two devices at the exact same
moment.

---

## Environment variables

Set these in `backend/.env` locally, or in the host's environment in production.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (required) | Your Anthropic key. Used server-side only. |
| `APP_PASSWORD` | _(empty)_ | Shared password to access the app. Empty = no login. **Set this before deploying publicly.** |
| `DATABASE_URL` | `sqlite:///./jobhub.db` | `postgresql://user:pass@host:5432/db` for hosted, shared-across-devices storage. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model the proxy uses (server-owned). |
| `MAX_TOKENS_CAP` | `1500` | Hard ceiling on response size (cost control). |
| `ALLOWED_ORIGINS` | `*` | CORS — only matters if frontend is a different origin. |
| `STATIC_DIR` | _(empty)_ | Folder of the built frontend to serve (Docker sets this). |
| `VITE_API_BASE` | _(empty)_ | Frontend only — set if the API is on a different origin. |

---

## Security

- **Your API key** lives only in the backend environment (`.env` locally, host
  env vars in production) and is git-ignored. It never appears in the frontend
  bundle.
- **Password gate** — when `APP_PASSWORD` is set, every `/api/*` call (data, the
  AI proxy, file upload, export) requires it via the `X-App-Password` header.
  Without it, no API call works, so a stranger with the URL can't burn your API
  credits. The frontend stores the password per device (enter once) and there's
  a **Lock** button to clear it.
- **Proxy guardrails** — the server overrides the model and caps `max_tokens`,
  so the client can't switch models or request oversized responses.

Cost is roughly **1–2¢ per AI action** (match, cover letter, rewrites) on your
own key — see the model's pricing for current rates.

---

## Notes

- If `claude-sonnet-4-6` is ever retired, set a current model string in
  `ANTHROPIC_MODEL` (https://docs.claude.com/en/docs/about-claude/models/overview).
- For a hosted deploy, point `DATABASE_URL` at managed Postgres and set
  `ANTHROPIC_API_KEY` (+ `APP_PASSWORD`) in the host's environment — that's the
  whole checklist.
