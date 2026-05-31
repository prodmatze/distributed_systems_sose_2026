# chat-service

FastAPI WebSocket service. Stateful at the connection level — each replica holds the sockets of its locally connected clients and subscribes to Redis pub/sub for cross-node fanout.

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.3):

- `/ws` — WebSocket upgrade. Handles JWT verification, inbound message validation, Postgres write, Redis publish, outbound fanout to local sockets.
- Reconnect with `last_seen_id` triggers Postgres backlog replay before resuming the live stream.

## WebSocket protocol

Connect (the browser can't set headers on a WS handshake, so the JWT rides in the query string):

```
ws://localhost:8080/ws?token=<JWT>&last_seen_id=<int>
```

`last_seen_id` is optional (defaults to `0` = no replay). All frames are JSON with a `type` discriminator.

**Client → server**

| frame | meaning |
|---|---|
| `{"type":"message","channel_id":1,"body":"hi"}` | send a message to a channel the user belongs to |
| `{"type":"ping"}` | heartbeat; refreshes presence TTL |

**Server → client**

| frame | meaning |
|---|---|
| `{"type":"ready","channels":[1,2]}` | sent once after connect + backlog replay; live stream follows |
| `{"type":"message","id":42,"channel_id":1,"sender_id":3,"sender_username":"alice","body":"hi","created_at":"…"}` | a message (backlog or live) — sort by `id` |
| `{"type":"pong"}` | heartbeat reply |
| `{"type":"error","detail":"…"}` | validation / authorization error (the socket stays open) |

The sender receives their own message back through the same pub/sub fanout, so every client sees one identically-ordered stream — there is no separate ack.

## Module layout

| module | role |
|---|---|
| `main.py` | FastAPI app, lifespan (Redis + pub/sub listener), `/ws` endpoint, `/ws/health` |
| `auth.py` | verify the JWT from the `?token=` query param |
| `connections.py` | `ConnectionManager` — local `channel_id → sockets` registry |
| `pubsub.py` | `PubSubBridge` — `PSUBSCRIBE chan:*` listener + `publish` |
| `repo.py` | Postgres access: membership, insert, backlog replay |
| `schemas.py` | Pydantic envelopes for the wire protocol |

## Tests

Two layers — offline unit tests, and an online end-to-end smoke test.

**Unit tests** (no Postgres/Redis needed) cover the fanout registry and the wire
schemas. They only import `chat.*`, so a minimal venv is enough:

```bash
# from this directory (backend/chat)
python -m venv .venv && . .venv/bin/activate
pip install fastapi pydantic pytest pytest-asyncio
PYTHONPATH=src pytest tests -v
```

**Smoke test** (`scripts/ws_smoke.py`) proves real cross-node fanout against a
running stack: it seeds two users + a shared channel, opens two WebSockets, sends
from one, and asserts both receive the same server-assigned message id. It seeds
the DB directly and mints JWTs via `shared.auth` (channel CRUD isn't in the REST
api-service yet). See the script's docstring for the exact run commands;
`--cleanup` removes its fixtures.

## Known MVP limitations

- **Channel membership is cached at connect.** Joining a new channel via the REST api-service mid-session is not reflected until the client reconnects. Acceptable for MVP; a `{"type":"subscribe"}` control frame (re-checking membership in the DB) is the V2 fix.
- **JWT in the query string** can leak into proxy access logs. Fine for the course demo; a first-message auth handshake is the leak-free alternative.
- **Pattern subscription (`chan:*`)** means every replica receives every channel's traffic and filters locally. Negligible at demo scale; see `pubsub.py` for the per-channel scaling path.
- **Backlog replay is capped at 200 messages per connection.** A client that missed more gets the oldest 200; since `last_seen_id` advances, the gap self-heals on the next reconnect (not within one session).
