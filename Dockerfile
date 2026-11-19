# InterAct as one service: the backend API and the built web app on one address.
# Used by the Render blueprint (render.yaml); see docs/deployment.md.

# 1. Build the web app.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The backend, serving the built app from /app/frontend-dist.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    FRONTEND_DIST=/app/frontend-dist \
    UPLOAD_DIR=/tmp/interact-uploads \
    INTERACT_ENV_FILE=""
WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 interact
COPY --from=web /web/dist /app/frontend-dist
USER interact
EXPOSE 8000
# Migrations run before each start, so the database always matches the code.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
