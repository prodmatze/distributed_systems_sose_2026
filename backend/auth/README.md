# auth-service

FastAPI REST service handling identity and credentials. Stateless — any replica can serve any request.

This service is a deliberate **security boundary**: it is the only service that handles raw passwords (bcrypt hashing) and the only one that mints JWTs. Every other service merely *verifies* tokens with the shared secret. Isolating credential handling here limits the blast radius if the larger `api-service` is ever compromised. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.2.

## Endpoints

- `POST /auth/register` — create a user. Hashes the password, persists the user, returns a JWT + the user record. `409` on duplicate username/email.
- `POST /auth/login` — verify credentials and return a JWT + user record. `401` on bad credentials (same error whether the user is missing or the password is wrong — does not leak which).
- `GET /auth/health` — liveness check.

## Layout

```
auth/
├── Dockerfile
├── pyproject.toml          # depends on chorus-shared, fastapi, uvicorn
└── src/
    └── auth/
        ├── __init__.py
        ├── main.py         # FastAPI app + routes
        └── schemas.py      # RegisterRequest, LoginRequest, UserResponse, TokenResponse
```

Password hashing and JWT issuance live in `shared.auth`; DB access goes through `shared.db.get_session` and `shared.models`. This service owns only the request/response schemas and the route logic.

## Running

Reachable through the nginx gateway at `http://localhost:8080/auth/*` once the Compose stack is up. See [`infra/compose/README.md`](../../infra/compose/README.md).
