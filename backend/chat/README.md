# chat-service

FastAPI WebSocket service. Stateful at the connection level — each replica holds the sockets of its locally connected clients and subscribes to Redis pub/sub for cross-node fanout.

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.4):

- `/ws` — WebSocket upgrade. Handles JWT verification, inbound message validation, Postgres write, Redis publish, outbound fanout to local sockets.
- Reconnect with `last_seen_message_id` triggers Postgres backlog replay before resuming the live stream.

Scaffolding lands in #4. No application code yet.
