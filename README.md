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
├── CLAUDE.md                 # Contribution policy notes
├── docs/
│   ├── PRD.md                # Product requirements, user stories, scope tiers
│   └── ARCHITECTURE.md       # System design, service boundaries, data flows
└── (backend, frontend, infra — coming as issues land)
```

## Running locally

> *Not yet implemented — scaffolding is the first wave of MVP issues.*

Once scaffolding lands:

```bash
docker compose up --build
```

Expected endpoints:

- Frontend: `http://localhost:3000`
- API (via Traefik): `http://localhost:8080`
- Traefik dashboard: `http://localhost:8081`

## Course context

- **Course**: Distributed Systems, Summer Semester 2026
- **Institution**: [HTW - Berlin]
- **Instructor**: Elyess Eleuch
