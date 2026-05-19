# backend

Python services for Chorus. Two FastAPI applications live here, deployed independently:

- [`api/`](./api/) — stateless REST service: auth, channel CRUD, history queries, user profiles.
- [`chat/`](./chat/) — stateful WebSocket service: real-time message fanout via Redis pub/sub.

Both depend on:

- [`shared/`](./shared/) — internal Python package: SQLAlchemy models, async DB engine, settings loader, JWT helpers. Also owns the Alembic migration history and the `migrate` Compose service that applies schema changes to Postgres on `docker compose up`.

The split between api and chat is described in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2–§3. The rationale for one shared package over per-service duplication is in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §7.
