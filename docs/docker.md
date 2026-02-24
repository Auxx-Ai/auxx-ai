# Docker

## Compose Files

### `docker-compose.yml` — Local Development

Runs only infrastructure services (Postgres with pgvector, Redis). Apps run on the host via `pnpm dev`.

```bash
# Start infrastructure
docker compose up -d

# Stop infrastructure
docker compose down

# Reset data
docker compose down -v
```

### `docker-compose.self-hosted.yml` — Self-Hosted Deployment

Full production stack using pre-built GHCR images with Traefik reverse proxy and auto SSL.

Services: Traefik, Postgres, Redis, migrate (init), web, api, worker, lambda.

```bash
# Start
docker compose -f docker-compose.self-hosted.yml up -d

# Stop
docker compose -f docker-compose.self-hosted.yml down
```

Required environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Your domain (e.g. `example.com`) |
| `ACME_EMAIL` | Email for Let's Encrypt SSL certs |
| `DATABASE_PASSWORD` | Postgres password |
| `REDIS_PASSWORD` | Redis password |
| `BETTER_AUTH_SECRET` | Auth secret |
| `WORKFLOW_CREDENTIAL_ENCRYPTION_KEY` | Credential encryption key |
| `PUBLIC_WORKFLOW_JWT_SECRET` | Workflow JWT secret |
| `API_KEY_SALT` | API key salt |
| `LAMBDA_INVOKE_SECRET` | Lambda invoke secret |
| `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 storage credentials |
| `S3_PUBLIC_BUCKET`, `S3_PRIVATE_BUCKET` | S3 bucket names |

Run `./setup.sh --self-hosted` to generate secrets.

## Docker Images

Images are built in CI (`.github/workflows/docker-images.yml`) and published to GHCR.

| Image | Dockerfile | Registry |
|-------|-----------|----------|
| web | `apps/web/Dockerfile` | `ghcr.io/auxx-ai/web` |
| api | `apps/api/Dockerfile` | `ghcr.io/auxx-ai/api` |
| worker | `apps/worker/Dockerfile` | `ghcr.io/auxx-ai/worker` |
| build | `apps/build/Dockerfile` | `ghcr.io/auxx-ai/build` |
| lambda | `apps/lambda/Dockerfile` | `ghcr.io/auxx-ai/lambda` |
| lambda-server | `apps/lambda/Dockerfile.server` | `ghcr.io/auxx-ai/lambda-server` |

### CI Triggers

- **Pull requests to main** — builds images to validate (no publish)
- **Manual dispatch** — builds and optionally publishes to GHCR with `latest` + `sha-<commit>` tags

## Useful Commands

```bash
# Access database
docker compose exec postgres psql -U postgres -d auxx-ai

# View resource usage
docker stats

# Check service health
docker compose ps
```
