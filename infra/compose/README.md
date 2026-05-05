# compose

Docker Compose stack for local development. Brings up the full system on a single developer machine.

**Planned services** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.1):

- `traefik` — gateway, dashboard on `:8081`, HTTP entry on `:8080`.
- `postgres` — durable storage, named volume.
- `redis` — pub/sub + cache + presence, named volume.
- `api-service` × 2 — REST tier.
- `chat-service` × 2 — WebSocket tier.
- `frontend` — Next.js dev server on `:3000`.

The two-replica defaults for the backend services exercise the multi-node fanout path during local development.

Compose file lands in #2. No configuration yet.
