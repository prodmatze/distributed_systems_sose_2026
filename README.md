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
| API gateway / load balancer | Traefik |
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
│   ├── shared/               # Internal package: SQLAlchemy models, Alembic, settings, JWT helpers
│   ├── api/                  # FastAPI REST service (scaffolding in #3)
│   └── chat/                 # FastAPI WebSocket service (scaffolding in #4)
├── frontend/                 # Next.js application (scaffolding in #5)
└── infra/
    ├── compose/              # Docker Compose stack for local dev
    └── k8s/                  # Kubernetes manifests (deployment demo)
```

## Running locally

The infrastructure stack (Postgres, Redis, Traefik) plus the one-shot `migrate` service that applies the schema runs today. Application services land in upcoming issues (#3, #4, #5).

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up
```

On `up`, the `migrate` service waits for Postgres, runs `alembic upgrade head` against it, then exits 0. Application services will declare `depends_on: migrate: condition: service_completed_successfully` so they boot against a known-good schema.

Expected endpoints:

- Frontend: `http://localhost:3000` *(once #5 lands)*
- API (via Traefik): `http://localhost:8080` *(once #3 lands)*
- Traefik dashboard: `http://localhost:8081`

See [`infra/compose/README.md`](./infra/compose/README.md) for the full lifecycle (start, stop, wipe, log tailing, smoke tests).

## Course context

- **Course**: Distributed Systems, Summer Semester 2026
- **Institution**: [HTW - Berlin]
- **Instructor**: Elyess Eleuch
