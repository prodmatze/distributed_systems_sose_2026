# compose

Docker Compose stack for local development. Brings up the backend system on a single developer machine.

## Services

| Service | Image | Host ports | Purpose |
|---|---|---|---|
| `postgres` | `postgres:16` | `5432` | Durable storage. Source of truth for users, channels, messages. |
| `redis` | `redis:7-alpine` | `6379` | Pub/sub fanout (used by the chat service), cache, presence (TTL keys). |
| `migrate` | built from `backend/shared/` | — | One-shot: runs `alembic upgrade head` against Postgres, then exits 0. |
| `auth` | built from `backend/auth/` | — (via gateway) | Auth service: register, login, JWT issuance. |
| `api` | built from `backend/api/` | — (via gateway) | REST service: channels, history, profiles. |
| `chat` | built from `backend/chat/` | — (via gateway) | WebSocket service: real-time message fanout via Redis pub/sub. |
| `gateway` | `nginx:alpine` | `8080` | Single ingress. Routes `/auth/*`, `/api/*`, and `/ws` (with the WebSocket upgrade); handles CORS. Config mounted from [`../nginx/nginx.conf`](../nginx/nginx.conf). |

The `auth`, `api`, and `chat` services use `expose: 8000` (internal network only), **not** host `ports` — they are reachable only through the gateway. Postgres and Redis use named volumes (`postgres_data`, `redis_data`) so data survives `docker compose down`. To wipe state, use `docker compose down -v`.

The `migrate` service is a [one-shot job pattern](https://docs.docker.com/compose/how-tos/lifecycle/): `restart: "no"`, exits as soon as `alembic upgrade head` completes. `auth`, `api`, and `chat` declare `depends_on: migrate: condition: service_completed_successfully` so they don't start until the schema is current.

## Not in this stack

- **`frontend`** — the Next.js dev server runs on the host (`cd frontend && pnpm dev` on `:3000`) for fast hot-reload, not in Compose. It talks to the stack through the gateway on `:8080`. Packaging it for deployment is tracked separately (#26).

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.1.

## Usage

All commands are run from the repository root.

**First-time setup.** Copy the env template and fill in any values you want to override:

```bash
cp infra/compose/.env.example infra/compose/.env
```

The defaults in `.env.example` are safe for local dev. Never commit `.env`.

**Start the stack** (foreground, prints logs; `--build` rebuilds changed service images):

```bash
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up --build
```

Or detached:

```bash
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up -d --build
```

**Stop the stack** (preserves volumes):

```bash
docker compose -f infra/compose/docker-compose.yml down
```

**Stop and wipe persisted data** (needed after a migration change so the schema is rebuilt cleanly):

```bash
docker compose -f infra/compose/docker-compose.yml down -v
```

**Tail logs of a single service**:

```bash
docker compose -f infra/compose/docker-compose.yml logs -f chat
```

**Check service status** (note `migrate` should show `Exited (0)`):

```bash
docker compose -f infra/compose/docker-compose.yml ps -a
```

**Scale the chat tier** (exercises multi-node Redis fanout):

```bash
docker compose -f infra/compose/docker-compose.yml up -d --scale chat=2
```

## Verifying it works

After `up`, everything should respond through the gateway on `:8080`:

```bash
# Health checks
curl http://localhost:8080/auth/health      # → {"ok":true,"service":"auth"}
curl http://localhost:8080/api/health       # → {"ok":true}
curl http://localhost:8080/ws/health        # → {"ok":true,"service":"chat"}

# Register a user (returns a JWT)
curl -X POST http://localhost:8080/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"secret"}'

# Log in
curl -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"secret"}'
```

Live chat goes over the WebSocket at `ws://localhost:8080/ws?token=<jwt>` (the frontend handles this).

Infra directly (bypassing the gateway, for debugging):

```bash
psql -h localhost -U chorus -d chorus       # password from .env
redis-cli -h localhost ping                 # → PONG
```

## Notes

- Service-to-service DNS works automatically inside the Compose network: from one container, `postgres`, `redis`, `auth`, `api`, and `chat` resolve to the corresponding service.
- The gateway is the only service that publishes an HTTP port to the host. This mirrors production: clients reach the system through one ingress, never a backend directly.
