# api-service

FastAPI REST service for the channel and message domain. Stateless — any replica can serve any request, verifying the JWT per request (auth tokens are issued by the separate [`auth-service`](../auth/)).

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.3):

- `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/join` — channel CRUD.
- `GET /api/channels/{id}/messages?before=<id>&limit=50` — paginated history.
- `GET /api/users/me` — profile.
- `GET /api/health` — liveness.

## Layout

All endpoints above are implemented and used by the frontend:

- `src/api/main.py` — `FastAPI()` app; mounts the routers + `/api/health`.
- `src/api/dependencies.py` — `get_current_user` (verifies the JWT via `shared.auth.decode_access_token` and loads the `User`; 401 on failure). The single auth chokepoint every protected route reuses.
- `src/api/routers/channels.py` — channel create/list/join + paginated message history.
- `src/api/routers/users.py` — `GET /api/users/me`.
- `src/api/schemas.py` — request/response models.

DB access goes through `shared.db.get_session` and `shared.models`.

For how endpoints are structured in this repo (layout rules, route anatomy, routers, JWT, the WebSocket shape), see [`learning-docs/05-fastapi-development-guide.md`](../../learning-docs/05-fastapi-development-guide.md).
