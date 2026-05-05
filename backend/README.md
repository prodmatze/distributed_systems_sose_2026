# backend

Python services for Chorus. Two FastAPI applications live here, deployed independently:

- [`api/`](./api/) — stateless REST service: auth, channel CRUD, history queries, user profiles.
- [`chat/`](./chat/) — stateful WebSocket service: real-time message fanout via Redis pub/sub.

The split is described in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2–§3.
