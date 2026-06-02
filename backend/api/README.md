# api-service

FastAPI REST service for the channel and message domain. Stateless — any replica can serve any request, verifying the JWT per request (auth tokens are issued by the separate [`auth-service`](../auth/)).

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.3):

- `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/join` — channel CRUD.
- `GET /api/channels/{id}/messages?before=<id>&limit=50` — paginated history.
- `GET /api/users/me` — profile.
- `GET /api/health` — liveness.

## Current state

Scaffolded, not yet feature-complete.

- `src/api/main.py` — `FastAPI()` app with `/api/health` and a stub `/api/channels` that returns a hardcoded list. The endpoints above are the target surface.
- DB access will go through `shared.db.get_session` and `shared.models`; JWT verification through `shared.auth.decode_access_token`. These helpers already exist in the shared package — the work remaining is wiring the channel/message/profile endpoints on top of them.

For how to add endpoints in this repo (layout rules, route anatomy, routers, JWT, the WebSocket shape), see [`learning-docs/05-fastapi-development-guide.md`](../../learning-docs/05-fastapi-development-guide.md).
