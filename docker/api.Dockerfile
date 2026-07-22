FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/packages:/app/packages/rating_engine:/app/packages/shared/python:/app/apps/api

WORKDIR /app

RUN groupadd --system scoutboy && useradd --system --gid scoutboy --create-home scoutboy

COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir ".[postgres]"

COPY alembic.ini ./
COPY apps/api ./apps/api
COPY configs ./configs
COPY data/sample ./data/sample
COPY db/migrations ./db/migrations
COPY packages ./packages

RUN chown -R scoutboy:scoutboy /app
USER scoutboy

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "apps/api", "--host", "0.0.0.0", "--port", "8000"]
