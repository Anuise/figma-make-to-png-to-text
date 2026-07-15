FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.9 /uv /uvx /usr/local/bin/

WORKDIR /app

COPY apps/ai-worker/pyproject.toml apps/ai-worker/uv.lock apps/ai-worker/
RUN cd apps/ai-worker && uv sync --frozen --no-dev --no-install-project

COPY packages/database/migrations packages/database/migrations
COPY apps/ai-worker/src apps/ai-worker/src
RUN cd apps/ai-worker && uv sync --frozen --no-dev

WORKDIR /app/apps/ai-worker

CMD ["uv", "run", "--no-sync", "python", "-m", "ai_worker.main"]
