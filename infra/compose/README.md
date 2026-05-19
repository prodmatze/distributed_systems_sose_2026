# compose

Docker Compose stack for local development. Brings up the full system on a single developer machine.

## Current services

This is the **infrastructure-only** skeleton. Application services land in follow-up tickets.

| Service | Image | Host ports | Purpose |
|---|---|---|---|
| `postgres` | `postgres:16` | `5432` | Durable storage. Source of truth for users, channels, messages. |
| `redis` | `redis:7-alpine` | `6379` | Pub/sub fanout, cache, presence (TTL keys). |
| `migrate` | built from `backend/shared/` | — | One-shot: runs `alembic upgrade head` against Postgres, then exits 0. |
| `traefik` | `traefik:v3.1` | `8080` (HTTP entry), `8081` (dashboard) | API gateway / load balancer. Reads Docker labels. |

Postgres and Redis use named volumes (`postgres_data`, `redis_data`) so data survives `docker compose down`. To wipe state, use `docker compose down -v`.

The `migrate` service is a [one-shot job pattern](https://docs.docker.com/compose/how-tos/lifecycle/): `restart: "no"`, exits as soon as `alembic upgrade head` completes. App services declare `depends_on: migrate: condition: service_completed_successfully` so they don't start until the schema is current.

## Planned additions

Application services from later tickets, to plug into the same Compose network:

- `api-service` × 2 — REST tier (#3).
- `chat-service` × 2 — WebSocket tier (#4).
- `frontend` — Next.js dev server on `:3000` (#5).

The two-replica defaults for the backend services are what exercises the multi-node fanout path during local development. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.1.

## Usage

All commands are run from the repository root.

**First-time setup.** Copy the env template and fill in any values you want to override:

```bash
cp infra/compose/.env.example infra/compose/.env
```

The defaults in `.env.example` are safe for local dev. Never commit `.env`.

**Start the stack** (foreground, prints logs):

```bash
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up
```

Or detached:

```bash
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up -d
```

**Stop the stack** (preserves volumes):

```bash
docker compose -f infra/compose/docker-compose.yml down
```

**Stop and wipe persisted data**:

```bash
docker compose -f infra/compose/docker-compose.yml down -v
```

**Tail logs of a single service**:

```bash
docker compose -f infra/compose/docker-compose.yml logs -f postgres
```

## Verifying it works

After `up`, all three should respond:

```bash
# Postgres
psql -h localhost -U chorus -d chorus           # password from .env

# Redis
redis-cli -h localhost ping                     # → PONG

# Traefik dashboard
xdg-open http://localhost:8081/dashboard/       # browser
curl http://localhost:8081/api/rawdata          # JSON dump
```

## Notes

- Traefik runs with `--api.insecure=true`. This is fine for local dev; in production we would put the dashboard behind auth or disable it entirely.
- Service-to-service DNS works automatically inside the Compose network: from one container, `postgres`, `redis`, and `traefik` resolve to the corresponding service.
