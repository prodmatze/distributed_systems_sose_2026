# api-service

FastAPI REST service. Stateless — any replica can serve any request.

**Responsibilities** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.2):

- `POST /api/auth/register`, `POST /api/auth/login` — JWT issuance.
- `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/join` — channel CRUD.
- `GET /api/channels/{id}/messages` — paginated history.
- `GET /api/users/me` — profile.

Scaffolding lands in #3. No application code yet.
