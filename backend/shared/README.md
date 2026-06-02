# shared

Internal Python package (`chorus-shared`) shared by `backend/auth/`, `backend/api/`, and `backend/chat/`. Contains everything that would drift dangerously if duplicated:

- `src/shared/models.py` — SQLAlchemy 2.0 ORM models (the source of truth for the DB schema).
- `src/shared/db.py` — async engine and `AsyncSession` factory + `get_session()` dependency.
- `src/shared/settings.py` — Pydantic-based environment loader (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, JWT algorithm/expiry).
- `src/shared/auth.py` — password hashing (bcrypt via passlib) and JWT issue/verify helpers (`hash_password`, `verify_password`, `create_access_token`, `decode_access_token`).
- `alembic/` — schema migrations driven off `models.py`.

The `Dockerfile` here builds the **migrate service** in `infra/compose/docker-compose.yml`: a one-shot container that runs `alembic upgrade head` against Postgres before the app services start. See `docs/ARCHITECTURE.md` §3.5 for schema rationale.

## Layout

```
shared/
├── Dockerfile             # migrate-service image
├── pyproject.toml         # package + deps
├── alembic.ini
├── alembic/
│   ├── env.py             # async migration runner
│   ├── script.py.mako
│   └── versions/          # generated migration files
└── src/
    └── shared/            # importable: `from shared.models import User`
        ├── __init__.py
        ├── settings.py
        ├── db.py
        ├── auth.py
        └── models.py
```

## Migrations workflow

After editing `src/shared/models.py`:

```bash
cd backend/shared
DATABASE_URL=postgresql+asyncpg://chorus:<pw>@localhost:5432/chorus \
  alembic revision --autogenerate -m "short description"
```

Inspect the generated file in `alembic/versions/`, then commit it.

Apply migrations:

```bash
# Locally:
DATABASE_URL=... alembic upgrade head

# Via Compose: the `migrate` service does this automatically on `docker compose up`.
```

## Why a single shared package

A per-service-DB / per-service-models approach was rejected — see `docs/ARCHITECTURE.md` §7. With one Postgres and three services hitting the same tables, duplicating model definitions is a drift hazard the team cannot absorb. The services that need this code declare `chorus-shared` as a dependency, so the coupling is explicit in their `pyproject.toml`.
