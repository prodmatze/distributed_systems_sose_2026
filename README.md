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

The **Status** column separates what the code uses today from what [`docs/PRD.md`](./docs/PRD.md) plans. Anything marked *planned* is a commitment, not a dependency you need installed.

| Layer | Choice | Status |
|---|---|---|
| Backend services | Python 3.12 + FastAPI | in use |
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui | in use |
| Frontend package manager | pnpm 10 | in use |
| Durable storage | PostgreSQL 16 | in use |
| Cache / pub-sub / presence | Redis 7 | in use |
| API gateway / reverse proxy | nginx (alpine) | in use |
| Observability | `backend/observer` + `/observability` dashboard | in use — dev-only, opt-in profile |
| Distributed tracing | Jaeger | **container runs, receives nothing** — no service is instrumented yet |
| Async / durable jobs | RabbitMQ | **planned (V2)** — no code, no container |
| Deployment target | Kubernetes (k3d / minikube) | **planned** — `infra/k8s/` holds only a README |
| CI/CD | GitHub Actions | **in flight** — draft PR #38, not on this branch |

## Scope (three tiers)

- **MVP** — Auth, public text channels, realtime messaging, multi-node fanout via Redis, history on reconnect, "kill a node" fault-tolerance demo.
- **V2** — 1:1 DMs, online presence, typing indicators, @mentions with email notifications, file/image share, voice notes, message search, structured logs + metrics.
- **V3 (ambitious menu)** — 1:1 voice/video calls (WebRTC), screen share, group calls, **Discord-style drop-in voice channels**, end-to-end encryption for DMs, federation. Pick 1–2 if V1 + V2 land early.

Full requirements, user stories, and tier rationale in [`docs/PRD.md`](./docs/PRD.md). System design and data flows in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Repository layout

```
.
├── Makefile                  # Task runner — `make` lists every target
├── README.md                 # This file
├── skills-lock.json          # Pinned agent-skill sources (tooling, not runtime)
├── docs/
│   ├── PRD.md                # Product requirements, user stories, scope tiers
│   ├── ARCHITECTURE.md       # System design, service boundaries, data flows
│   └── observability/        # Observer runbook + notes on the files it touches
├── backend/
│   ├── shared/               # Internal package: SQLAlchemy models, Alembic, settings, auth/JWT helpers
│   ├── auth/                 # FastAPI auth service: register, login, JWT issuance
│   ├── api/                  # FastAPI REST service: channels, history, membership, profile
│   ├── chat/                 # FastAPI WebSocket service: realtime fanout via Redis pub/sub
│   └── observer/             # FastAPI dev-only service: taps the stack, republishes one event stream
├── frontend/                 # Next.js app (login, register, channel chat, /observability dashboard)
└── infra/
    ├── nginx/                # Gateway config (nginx.conf) for the Compose stack
    ├── compose/              # Docker Compose stack for local dev
    └── k8s/                  # Kubernetes manifests — placeholder, see Tech stack
```

The backend is split into **two service classes** — a stateless REST tier (`auth` + `api`) and a stateful WebSocket tier (`chat`) — behind a single nginx gateway. The auth/api split and the gateway choice are explained in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §2–§3. `observer` sits outside both: it is a pure consumer, never on a request path, and only starts when you ask for it.

## Running locally

Prerequisites: Docker with Compose v2, pnpm 10, and **Node 26** — `frontend/package.json` pins `engines: >=26 <27` and `frontend/.npmrc` sets `engine-strict=true`, so pnpm refuses any other version outright instead of warning. Use fnm or nvm to switch.

```bash
make setup     # create infra/compose/.env from the example (edit JWT_SECRET + POSTGRES_PASSWORD)
make dev       # backend stack detached (chat scaled to 3), then the Next.js dev server
```

`make` on its own lists every target. The most-used ones:

| Target | Does |
|---|---|
| `make backend` | build + start the Compose stack in the background, `--scale chat=3` |
| `make frontend` | Next.js dev server on `:3000`, pointed at the gateway |
| `make logs` / `make ps` | follow backend logs / show container status |
| `make health` | curl both gateway health endpoints |
| `make ports` | print the host ports this invocation will publish |
| `make down` / `make clean` | stop containers / stop **and delete the data volumes** |

Add `ALTPORTS=1` to any target to shift every host-published port into a high range (gateway 18080, postgres 15432, redis 16379, observer 18090, jaeger 18686), leaving the defaults free for another project on the same machine. Only the host side moves; nothing inside the stack needs reconfiguring.

On `up`, the `migrate` service waits for Postgres, runs `alembic upgrade head`, then exits 0. The app services declare `depends_on: migrate: condition: service_completed_successfully`, so they only boot against a known-good schema.

### Endpoints

| What | Address |
|---|---|
| Frontend | `http://localhost:3000` — `/`, `/login`, `/register`, `/chat`, `/observability` |
| Gateway (single ingress) | `http://localhost:8080` |
| Observer | `http://127.0.0.1:8090` — localhost-only by design |
| Jaeger UI | `http://127.0.0.1:16686` — localhost-only |

| Method | Path | Service |
|---|---|---|
| `POST` | `/auth/register` | auth |
| `POST` | `/auth/login` | auth |
| `GET` | `/auth/health` | auth |
| `GET` `POST` | `/api/channels` | api |
| `GET` | `/api/channels/{channel_id}/messages` | api |
| `POST` | `/api/channels/{channel_id}/join` | api |
| `GET` | `/api/users/me` | api |
| `GET` | `/api/health` | api |
| `WS` | `/ws?token=<jwt>&uid=<user-id>&last_seen_id=<n>` | chat |
| `GET` | `/ws/health` | chat |
| `GET` | `/observer/health` | observer |
| `WS` | `/observer/ws?resume_from=<stream-id>` | observer |

Postgres (`:5432`) and Redis (`:6379`) are published to the host for inspection. `api`, `auth`, and `chat` are **not** — they are reachable only through the gateway.

```bash
make health
# auth: {"ok":true,"service":"auth"}
# api:  {"ok":true}
```

See [`infra/compose/README.md`](./infra/compose/README.md) for the full lifecycle (start, stop, wipe, log tailing).

## The chat tier runs as three nodes

`docker-compose.yml` carries `deploy.replicas: 3` on the `chat` service, and `make backend` additionally passes `--scale chat=3`. Both knobs agree and either alone is sufficient, so a bare `docker compose up` also gets three.

This is not cosmetic. `infra/nginx/nginx.conf` addresses the replicas as **explicitly named peers** (`chorus-chat-1`, `-2`, `-3`) rather than through the rotating `chat` DNS record, because nginx's `hash` balancer needs individually addressable upstreams. If a named peer does not exist, the gateway fails to route `/ws`. **Keep the replica count and that peer list in sync.**

### Session affinity

`/ws` is balanced with `hash $arg_uid` — every socket carrying the same `uid` query parameter lands on the same replica, across reconnects and new tabs. Measured: six connections with `uid=77` all went to `chorus-chat-1`; nine distinct uids spread 2 / 5 / 2 across the three.

That unevenness is the accepted trade-off. Plain `hash` (not `consistent`) favours putting a handful of users on distinct replicas over minimising remapping when the replica count changes. `uid` is a routing hint only — never trusted for authorization; the chat service verifies the JWT on every connection regardless.

### Killing a node

```bash
docker kill chorus-chat-2      # SIGKILL → the container stays down
docker start chorus-chat-2     # bring it back
```

`docker kill` counts as a manual stop, so `restart: unless-stopped` deliberately does **not** resurrect it — the node stays dead until you say otherwise, which is what you want when demonstrating this.

Failover works, but it is not instantaneous, and this file will not pretend otherwise. There is no active health check on the chat upstream: connections hashed onto the dead peer hang until they time out, and only then does nginx mark it down. Measured immediately after a kill, 4 of 9 new connections succeeded; roughly a minute later, 9 of 9 did. Clients that were already connected reconnect with `last_seen_id` and replay their backlog (see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §4.3).

> [!IMPORTANT]
> nginx resolves its upstreams **once, at startup**, and caches the result. Recreating any backend container — or editing `nginx.conf`, which is bind-mounted as a single file — can leave a still-running gateway serving stale routing. `restart gateway` is not enough. Always:
> ```bash
> docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env \
>   up -d --force-recreate --no-deps gateway
> ```

## Observability

An opt-in, dev-only layer that makes the distributed behaviour visible: request fanout across chat replicas, presence transitions, a node dying and healing.

```bash
make obs-up      # the stack plus observer, socket-proxy and jaeger
make obs-logs    # follow the observer's own logs
make obs-smoke   # assert live events actually arrive on the observer WebSocket
make obs-down    # stop everything, observability services included
```

`obs-smoke` needs a dev venv once: `cd backend/observer && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`.

Five producers tap signals that already exist — Docker events and stats (through a read-only socket proxy), `PSUBSCRIBE chan:*`, Redis keyspace notifications for presence, `pg_stat_*` pollers, and the gateway's JSON access log. Everything lands in the Redis stream `obs:events`, which doubles as bus, ring buffer and replay cursor, and the observer republishes it over one WebSocket. **None of those producers needs a line of code in `auth`, `api` or `chat`.** The one deliberate exception is the WebSocket hop itself, which nothing outside the chat process can observe: chat announces `ws.connect` / `ws.message` / `ws.disconnect` onto the stream via `shared/obs.py`, fire-and-forget — every failure is swallowed, so a dead Redis degrades to a quieter dashboard, never to a failed chat message.

The dashboard lives at `http://localhost:3000/observability`. Its **START SIMULATION** button swaps the live observer socket for a deterministic 60-second scripted feed — same frame protocol, same envelope shapes, including a scripted `chorus-chat-2` death and recovery. Useful for working on the UI without Docker running, and for rehearsing the failure demo. While it runs, every number on screen comes from the recording and a SIMULATION pill says so. `?mock=1` still works as the initial state for tests and bookmarks.

Motion on the topology is one comet per real event, not decoration on a timer: a blue comet is a request crossing the gateway to whichever service handled it, and three pink comets leaving Redis at once are a single `PUBLISH` reaching all three replicas. Sending a chat message draws its full journey — browser → gateway → the replica that accepted it → Redis (from chat's own `ws.message` announcement, since the frame travels over an already-open socket the gateway never logs) — followed by the three-comet fanout back out. Above ~50 events/s the view drops to flow mode, since tracing individual events stops being readable.

Nothing is drawn where the event stream cannot genuinely attribute the traffic. The `*→postgres` wires stay quiet on purpose: the gateway's access log stops at its own hop, the `chan:*` tap cannot say which replica performed an `INSERT`, and every service connects to Postgres without an `application_name`. Quiet is the accurate rendering, not a missing feature.

Full protocol, event envelope, security posture and operational traps: [`docs/observability/README.md`](./docs/observability/README.md).

## Branches

`observability-layer` currently contains both `main` and `develop` in full, so the intended integration is `observability-layer` → `develop` → `main`, and both steps are fast-forwards. Committing to `develop` or `main` in the meantime breaks that and turns the merges into real ones.

`feature/sticky-sessions` (draft PR #37) is the origin of the named-peer gateway config described above and is already merged into this branch.

## Course context

- **Course**: Distributed Systems, Summer Semester 2026
- **Institution**: HTW Berlin
- **Instructor**: Elyess Eleuch
