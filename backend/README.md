# backend

Python services for Chorus. Three FastAPI applications live here, deployed independently, in **two service classes**:

**Stateless REST tier** — scale with request volume, any replica serves any request:

- [`auth/`](./auth/) — auth service: registration, login, JWT issuance. The security boundary — the only service that handles raw passwords and mints tokens.
- [`api/`](./api/) — application REST service: channel CRUD, history queries, user profiles.

**Stateful WebSocket tier** — scales with concurrent connections:

- [`chat/`](./chat/) — real-time message fanout over WebSockets via Redis pub/sub. Holds a socket per connected client; the target of the "kill a node" demo.

All three depend on:

- [`shared/`](./shared/) — internal Python package: SQLAlchemy models, async DB engine, settings loader, password/JWT helpers (`shared.auth`). Also owns the Alembic migration history and the `migrate` Compose service that applies schema changes to Postgres on `docker compose up`.

Each service declares `chorus-shared` as a dependency in its `pyproject.toml`, so the dependency relationship is explicit (not just implied by Docker build order).

The two-classes / three-services split is described in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2–§3. The rationale for one shared package over per-service duplication is in §7.
