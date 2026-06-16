# Chorus

A real-time community chat application built as the team project for **Distributed Systems, Summer Semester 2026**.

## Team

- Mathieu Wassmuth (584486)
- Lam Tuan Khanh Nguyen (0596535)

## What this is

A Discord-style community chat app designed to exercise the distributed-systems concepts from the course: horizontal scaling, load balancing, caching, realtime messaging via WebSockets, fault tolerance, and containerized deployment.

The focus is on building an architecture that is genuinely distributed from day one — multiple stateless API instances and stateful WebSocket nodes behind a load balancer, with Redis pub/sub tying everything together for cross-node message fanout. The system is designed so that any single chat node can fail without disrupting users.

Long-term product direction is a community platform with persistent text channels, drop-in voice channels, direct messages, and rich media — though only the text-first distributed baseline is promised this semester. Voice and video features sit in the V3 menu and are pulled in only if V1 and V2 land early.

## Tech stack

| Layer | Choice |
|---|---|
| Backend services | Python + FastAPI |
| Frontend | Next.js + Tailwind + shadcn/ui |
| Durable storage | PostgreSQL |
| Cache / pub-sub / presence | Redis |
| Async jobs (V2+) | RabbitMQ |
| API gateway / reverse proxy | nginx (Compose) · Ingress (Kubernetes) |
| Local dev | Docker Compose |
| Deployment target | Kubernetes (k3d / minikube) |
| CI/CD | GitHub Actions |

## Scope (three tiers)

- **MVP** — Auth, public text channels, realtime messaging, multi-node fanout via Redis, history on reconnect, "kill a node" fault-tolerance demo.
- **V2** — 1:1 DMs, online presence, typing indicators, @mentions with email notifications, file/image share, voice notes, message search, structured logs + metrics.
- **V3 (ambitious menu)** — 1:1 voice/video calls (WebRTC), screen share, group calls, **Discord-style drop-in voice channels**, end-to-end encryption for DMs, federation. Pick 1–2 if V1 + V2 land early.

Full requirements, user stories, and tier rationale in [`docs/PRD.md`](./docs/PRD.md). System design and data flows in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Repository layout

```
.
├── README.md                 # This file
├── docs/
│   ├── PRD.md                # Product requirements, user stories, scope tiers
│   └── ARCHITECTURE.md       # System design, service boundaries, data flows
├── backend/
│   ├── shared/               # Internal package: SQLAlchemy models, Alembic, settings, auth/JWT helpers
│   ├── auth/                 # FastAPI auth service: register, login, JWT issuance
│   ├── api/                  # FastAPI REST service: channels, history, profiles
│   └── chat/                 # FastAPI WebSocket service: realtime fanout via Redis pub/sub
├── frontend/                 # Next.js application (login/register + channel chat)
└── infra/
    ├── nginx/                # Gateway config (nginx.conf) for the Compose stack
    ├── compose/              # Docker Compose stack for local dev
    └── k8s/                  # Kubernetes manifests (deployment demo)
```

The backend is split into **two service classes** — a stateless REST tier (`auth` + `api`) and a stateful WebSocket tier (`chat`) — behind a single nginx gateway. The auth/api split and the gateway choice are explained in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §2–§3.

## Running locally

The backend stack — Postgres, Redis, the one-shot `migrate` job, the `auth`/`api`/`chat` services, and the nginx gateway — runs with one command:

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up --build
```

On `up`, the `migrate` service waits for Postgres, runs `alembic upgrade head`, then exits 0. The app services declare `depends_on: migrate: condition: service_completed_successfully`, so they only boot against a known-good schema.

The frontend runs on the host for fast hot-reload:

```bash
cd frontend && pnpm install && pnpm dev
```

Endpoints:

- Frontend: `http://localhost:3000`
- Gateway (single ingress): `http://localhost:8080`
  - `POST /auth/register`, `POST /auth/login` → auth-service
  - `GET/POST /api/channels`, `GET /api/channels/{id}/messages`, `GET /api/users/me` → api-service
  - `GET /ws` (WebSocket) → chat-service

Smoke test the gateway:

```bash
curl http://localhost:8080/auth/health   # {"ok":true,"service":"auth"}
curl http://localhost:8080/api/health    # {"ok":true}
```

See [`infra/compose/README.md`](./infra/compose/README.md) for the full lifecycle (start, stop, wipe, log tailing, smoke tests).

## Course context

- **Course**: Distributed Systems, Summer Semester 2026
- **Institution**: [HTW - Berlin]
- **Instructor**: Elyess Eleuch
