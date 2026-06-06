# Application Hub

A job-application tracker (tracking, JD keywords, resume match, cover letters)
that runs as a proper web app — one service you can host anywhere and open from
any device. Uses your own Anthropic API key, kept server-side.

## Architecture

- **Backend (FastAPI)** — proxies Anthropic (key never reaches the browser),
  stores data in a database, and **serves the built frontend** in production so
  the whole app is one service at one URL.
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

## Making data accessible "anywhere"

Data lives in whatever `DATABASE_URL` points at:

- `sqlite:///./jobhub.db` — a local file (default). Fine for one machine; not
  shared across hosts or container restarts.
- `postgresql://user:pass@host:5432/db` — a hosted Postgres (e.g. a managed
  instance, or the `db` service in docker-compose). This is what lets you open
  the app from your laptop and phone and see the same data. **No code change —
  just set the env var.**

Export a spreadsheet snapshot any time with the **Export Excel** button.

## Key safety

- The key lives only in the backend environment (`.env` locally, host env vars in
  production) and is git-ignored. It never appears in the frontend bundle.
- The proxy overrides the model and caps `max_tokens` server-side, so the client
  can't switch models or request oversized responses. Tune via env vars.

## Notes

- If `claude-sonnet-4-6` is ever retired, set a current model string in
  `ANTHROPIC_MODEL` (https://docs.claude.com/en/docs/about-claude/models/overview).
- For a hosted deploy, point `DATABASE_URL` at managed Postgres and set
  `ANTHROPIC_API_KEY` in the host's environment — that's the whole checklist.
