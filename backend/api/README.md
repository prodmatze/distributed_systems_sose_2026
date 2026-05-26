# api-service

FastAPI REST service. Stateless — any replica can serve any request.

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.2):

- `POST /api/auth/register`, `POST /api/auth/login` — JWT issuance.
- `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/join` — channel CRUD.
- `GET /api/channels/{id}/messages` — paginated history.
- `GET /api/users/me` — profile.

## Current state

Scaffolded, not yet feature-complete.

- `src/api/main.py` — `FastAPI()` app with `/api/health`, a stub `/api/channels` list, and a stub `/api/auth/register` that defines the request/response shape but does not yet persist or hash.
- `src/api/schemas.py` — `RegisterRequest`, `LoginRequest`, `UserResponse`, `TokenResponse` Pydantic models.
- DB access through `shared.db.get_session` and `shared.models` (already wired in the shared package).
- JWT + password helpers in `shared.auth` are **not yet implemented** — the next blocker for landing real auth.

For how to add endpoints in this repo (layout rules, route anatomy, routers, JWT, WebSocket shape), see [`learning-docs/05-fastapi-development-guide.md`](../../learning-docs/05-fastapi-development-guide.md).
