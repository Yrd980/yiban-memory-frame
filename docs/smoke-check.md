# Smoke Check

This project does not include test code in the current MVP. Use these commands after backend changes.

```bash
uv sync --extra ai
python -m compileall services edge
docker compose -f deploy/docker-compose.yml up -d
REDIS_URL=redis://localhost:6380/0 AI_ENABLE_REAL_MODELS=false uv run python -m services.api_server
```

In another shell:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/ready
curl -X POST http://localhost:8080/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"text":"小宝又长高了，像他妈妈小时候。","photoId":"photo-demo-1"}'
curl -X POST http://localhost:8080/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"text":"这段别告诉孩子，我只是自己想一想。","photoId":"photo-demo-1"}'
curl -X POST http://localhost:8080/api/summaries/generate \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expected:

- `/api/health` returns `{"status":"ok"}`.
- `/api/ready` reports database, Redis, and MinIO as available.
- Normal conversations produce an elder turn, an AI turn, and a shareable memory.
- Privacy phrases such as `这段别告诉孩子` produce `sharePolicy=local_only` and the AI reply confirms it will not be shared.
- Summaries do not use `local_only` turns as sources.
