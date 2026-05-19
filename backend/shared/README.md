# shared

Internal Python package shared by `backend/api/` and `backend/chat/`. Contains everything that would drift dangerously if duplicated:

- `src/shared/models.py` — SQLAlchemy 2.0 ORM models (the source of truth for the DB schema).
- `src/shared/db.py` — async engine and `AsyncSession` factory.
- `src/shared/settings.py` — Pydantic-based environment loader (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`).
- `alembic/` — schema migrations driven off `models.py`.

The `Dockerfile` here builds the **migrate service** in `infra/compose/docker-compose.yml`: a one-shot container that runs `alembic upgrade head` against Postgres before api/chat start. See `docs/ARCHITECTURE.md` §3.4 for schema rationale.

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

A per-service-DB / per-service-models approach was rejected — see `docs/ARCHITECTURE.md` §7. With one Postgres and two services hitting the same tables, duplicating model definitions is a drift hazard the team cannot absorb.
