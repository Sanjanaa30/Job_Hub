# ---- Stage 1: build the frontend ----
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend + serve the built frontend ----
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /fe/dist ./static
ENV STATIC_DIR=/app/static
ENV PORT=8787
EXPOSE 8787
# Honour the platform's $PORT (Render/Railway/Fly set this); default 8787.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
