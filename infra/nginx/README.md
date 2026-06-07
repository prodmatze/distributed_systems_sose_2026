# nginx — API gateway

`nginx.conf` is the single ingress for the Compose stack. The frontend and any external client talk to **one** origin (`http://localhost:8080`); nginx forwards each request to the right backend service. The backend services are published with `expose` (internal network only), so the gateway is the only way in.

## What it does

1. **Path-based routing.**
   - `/auth/*` → `auth-service` (`auth:8000`)
   - `/api/*` → `api-service` (`api:8000`)
   - `/ws` → `chat-service` (added when chat lands)
2. **CORS.** The browser calls the gateway from the Next.js dev server on `:3000`, a different origin. nginx echoes the allowed origin back (`Access-Control-Allow-Origin`) and answers `OPTIONS` preflight with `204`, so the backend services never deal with CORS. The allowed origin is whitelisted via a `map` — only `http://localhost:3000` is echoed; anything else gets an empty origin (blocked).
3. **Proxy headers.** Forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` so backends see the real client.

## Why nginx (and not Traefik)

The project started on Traefik for its label-based autodiscovery, but at three services that model cost more than it returned — a mounted Docker socket, a pinned Docker API version, routing scattered across container labels. nginx states the entire routing + CORS surface in this one readable file, which is easier to reason about and to explain. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.1 and §7.

## Editing

`nginx.conf` is mounted read-only into the `gateway` container (`infra/compose/docker-compose.yml`). After editing, restart the gateway:

```bash
docker compose -f infra/compose/docker-compose.yml restart gateway
```

When the chat service lands, add a `/ws` `location` block with `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` to support the WebSocket protocol switch.
