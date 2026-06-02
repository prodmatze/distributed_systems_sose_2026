# Architecture — Chorus

**Companion to** [`PRD.md`](./PRD.md). This document describes the system design, service boundaries, data flows, consistency model, deployment topology, and the reasoning behind the stack choices.

---

## 1. Design principles

Five principles drive every design decision in this system. They were agreed at the start of planning and are treated as non-negotiable.

1. **The multi-node story is load-bearing from day one.** A chat app that ticks the feature boxes as a single process would undersell a distributed systems project. Every MVP feature must work correctly across N chat service instances.
2. **The broker narrative drives technology choices.** Redis pub/sub in MVP, RabbitMQ in V2 for durable async work, Kafka only if V3 federation becomes the story. Never pick a broker before the narrative it serves exists.
3. **"Kill a node" is the keystone demo.** Every architectural decision preserves the property that a random chat service instance can be killed mid-conversation and messages continue to flow.
4. **Avoid premature distributed-systems optimization.** No sharding, no consensus protocols, no geo-distribution at MVP scale. Articulate their absence explicitly — that is itself a deliverable.
5. **Eventual consistency is a feature, articulated.** The pub/sub fanout path is eventually consistent; Postgres history is strongly consistent. Each data flow in this document names its consistency model explicitly.

## 2. System overview

```mermaid
flowchart TB
    subgraph Clients[Clients]
        B1[Browser A]
        B2[Browser B]
    end

    GW[nginx<br/>Gateway / Reverse Proxy]

    subgraph REST["Stateless REST tier (N replicas)"]
        AUTH[auth-service]
        API[api-service]
    end

    subgraph WSTier["WebSocket tier (stateful, N replicas)"]
        WS1[chat-service #1]
        WS2[chat-service #2]
        WS3[chat-service #3]
    end

    subgraph Storage[Storage tier]
        PG[(PostgreSQL<br/>durable state)]
        RD[(Redis<br/>pub/sub + presence + cache)]
    end

    B1 -->|HTTPS REST| GW
    B2 -->|HTTPS REST| GW
    B1 -.->|WSS| GW
    B2 -.->|WSS| GW

    GW -->|/auth/*| AUTH
    GW -->|/api/*| API
    GW -.->|/ws| WS1
    GW -.->|/ws| WS2
    GW -.->|/ws| WS3

    AUTH --> PG
    API --> PG
    WS1 --> PG
    WS2 --> PG
    WS3 --> PG

    WS1 <-->|pub/sub| RD
    WS2 <-->|pub/sub| RD
    WS3 <-->|pub/sub| RD
    API --> RD
```

**Two service *classes*, three services.** The split is by scaling characteristic, not by feature:

- **Stateless REST tier** — `auth-service` and `api-service`. No per-process state; any replica serves any request after verifying the JWT. Scales with HTTP request volume, with zero coordination. These are *two services in one class*: they are deployed and scaled the same way, but kept separate because `auth-service` is a **security boundary** (see §3.2) — it is the only service that holds password material and mints tokens.
- **Stateful WebSocket tier** — `chat-service`. Terminates WebSocket connections, holds a socket per connected client, and subscribes to Redis pub/sub for message fanout. Scales with concurrent connections.

This split gives the project two distinct scaling stories rather than one, and the WebSocket-vs-REST boundary is a natural place to discuss stateful versus stateless service design in the final presentation. The further split of `auth` out of `api` is a deliberate, defensible choice — argued in §3.2 — rather than premature decomposition: the two share a class and a database, but isolating credential handling limits the blast radius of a compromise in the larger, more frequently-changed `api-service`.

## 3. Services and responsibilities

### 3.1 nginx (API gateway and reverse proxy)

- The single ingress point on `:8080`; frontends and external clients never talk to backend services directly. In Compose the backend services use `expose` (internal-network-only), not `ports`, so the gateway is the *only* way in.
- Routes by path prefix: `/auth/*` → `auth-service`, `/api/*` → `api-service`, and (when it lands) `/ws` → `chat-service`.
- Handles CORS centrally: echoes the allowed dev origin (`http://localhost:3000`) and answers `OPTIONS` preflight, so backend services never deal with CORS themselves.
- Terminates TLS in the deployment demo.
- In V2, enforces rate limits.

**Why nginx and not Traefik.** The project initially used Traefik (label-based service discovery off the Docker socket). At a three-service scale its autodiscovery added moving parts — a mounted Docker socket, a pinned Docker API version, and routing rules scattered across container labels — for little benefit. nginx replaces it with a **single, explicit `nginx.conf`**: the entire routing and CORS story is legible in one file you can point at in the presentation. Routing transparency beats autodiscovery convenience at this scale. The rationale is expanded in §7.

### 3.2 auth-service (FastAPI)

The identity and credentials service, and a deliberate **security boundary**.

- REST endpoints:
  - `POST /auth/register` — create a user (409 on duplicate username/email), hash the password, issue a JWT.
  - `POST /auth/login` — verify credentials (401 on failure, without leaking whether the user exists), issue a JWT.
  - `GET /auth/health` — liveness.
- Stateless: no per-process state; horizontally scalable with zero coordination.
- It is the **only** service that handles raw passwords (bcrypt hashing) and the **only** service that mints tokens. Every other service merely *verifies* tokens with the shared secret. Isolating credential handling here limits the blast radius if the larger `api-service` is compromised, and lets the credential path be deployed independently of feature work.

### 3.3 api-service (FastAPI)

- REST endpoints (channel and message domain; JWT-verified per request):
  - `GET /api/channels`, `POST /api/channels`, `POST /api/channels/{id}/join` — channel CRUD.
  - `GET /api/channels/{id}/messages?before=<id>&limit=50` — paginated history.
  - `GET /api/users/me` — profile.
  - `GET /api/health` — liveness.
- Stateless: every request stands alone with JWT verification (using `shared.auth`); no session store.
- Horizontally scalable with zero coordination.
- *Current state:* scaffolded — `/api/health` and a stub `/api/channels` list. The endpoints above are the target surface.

### 3.4 chat-service (FastAPI WebSocket endpoint)

- Endpoint: `/ws` (WebSocket upgrade).
- On connection: verifies JWT, registers the socket in an in-memory map, subscribes the socket's process to the Redis pub/sub channels for the user's joined channels.
- Handles inbound message events: validates, writes to Postgres (which assigns the monotonic ID), publishes to the relevant Redis channel, acks the sender with the canonical message.
- Handles outbound fanout: receives from Redis pub/sub, delivers to all locally-connected sockets subscribed to that channel.
- Handles reconnect with `last_seen_message_id`: replays missed messages from Postgres before resuming live stream.

### 3.5 PostgreSQL (durable storage)

The source of truth for all persistent state.

**Schema (MVP draft):**

```sql
users (
  id            bigserial primary key,
  username      text unique not null,
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz default now()
);

channels (
  id          bigserial primary key,
  name        text unique not null,
  description text,
  created_by  bigint references users(id),
  created_at  timestamptz default now()
);

channel_members (
  channel_id bigint references channels(id),
  user_id    bigint references users(id),
  joined_at  timestamptz default now(),
  primary key (channel_id, user_id)
);

messages (
  id         bigserial primary key,   -- monotonic ID: THE ordering authority
  channel_id bigint references channels(id),
  sender_id  bigint references users(id),
  body       text not null,
  created_at timestamptz default now()
);

-- Key indexes
create index on messages (channel_id, id desc);   -- history queries
create index on channel_members (user_id);        -- "which channels does user X belong to?"
```

**Why the `messages.id` monotonic `bigserial` matters:** Postgres assigns IDs strictly increasing inside a single database process. This is the system's ordering authority. Clients sort by this ID, never by wall-clock timestamps, which avoids clock-skew and concurrency ordering issues.

### 3.6 Redis (cache, pub/sub, presence)

Redis wears three hats at MVP scale.

**Pub/sub — cross-node message fanout.** One Redis channel per chat channel, keyed `chan:<channel_id>`. When chat-service-A writes a message to Postgres, it publishes the canonical message onto `chan:<channel_id>`. All chat-service instances subscribed to that key receive the payload and push it to their locally-connected clients. Fire-and-forget semantics — durability is already provided by Postgres.

**Presence.** Key per online user, `presence:<user_id>`, with a short TTL (default 30 s) refreshed by a WebSocket heartbeat. Expiry handles disconnects automatically — no explicit "go offline" call needed.

**Cache.** User profile lookups, channel metadata, JWT blacklist (if logout is implemented).

### 3.7 Next.js frontend

- Server-rendered for the marketing/login pages (if any); client-side for the chat view.
- Uses `react-query` (or similar) for REST data.
- Thin WebSocket client wrapper that handles: connect, auth handshake, reconnect with backoff, `last_seen_message_id` bookkeeping, event dispatch.
- Renders messages sorted by server-assigned ID, never by local timestamp.

## 4. Data flow walkthroughs

### 4.1 Login

```mermaid
sequenceDiagram
    actor U as User browser
    participant GW as nginx gateway
    participant AUTH as auth-service (any replica)
    participant PG as PostgreSQL

    U->>GW: POST /auth/login {username, password}
    GW->>AUTH: forward
    AUTH->>PG: SELECT users WHERE username = ?
    PG-->>AUTH: row with password_hash
    AUTH->>AUTH: verify password (bcrypt), sign JWT
    AUTH-->>GW: 200 {jwt}
    GW-->>U: 200 {jwt}
    U->>U: store JWT
```

**Consistency:** strongly consistent (Postgres read). Stateless: any auth-service replica can serve this.

### 4.2 Sending a message (multi-node fanout)

```mermaid
sequenceDiagram
    actor A as Alice browser
    actor B as Bob browser
    participant WSA as chat-service A
    participant WSB as chat-service B
    participant PG as PostgreSQL
    participant RD as Redis pub/sub

    Note over A,WSA: Alice connected to WSA
    Note over B,WSB: Bob connected to WSB

    A->>WSA: WS send {channel: "general", body: "hi"}
    WSA->>WSA: validate JWT, check membership
    WSA->>PG: INSERT INTO messages RETURNING id
    PG-->>WSA: {id: 42, created_at: ...}
    WSA->>RD: PUBLISH chan:general {id: 42, sender: alice, body: "hi", ...}
    WSA-->>A: WS ack {id: 42}
    RD->>WSB: deliver {id: 42, ...}
    WSB->>B: WS push {id: 42, body: "hi", sender: alice}
```

**Key observation:** Alice and Bob are on *different* chat-service instances, yet message delivery works. The coupling between instances is Redis pub/sub — neither instance needs to know the other exists.

**Consistency:**
- Postgres write: strongly consistent; the message and its ID are durable and ordered before fanout begins.
- Redis pub/sub fanout: eventually consistent, fire-and-forget. If a subscriber briefly misses a publish, the next history fetch or reconnect replay from Postgres will surface it. The combination gives us real-time delivery *plus* durability — neither property alone is sufficient.

### 4.3 Reconnect with backlog replay

```mermaid
sequenceDiagram
    actor U as User browser
    participant WS as chat-service
    participant PG as PostgreSQL
    participant RD as Redis pub/sub

    Note over U,WS: Active session with last_seen at 100
    Note over U: Network disconnects
    Note over U: Backoff reconnect

    U->>WS: WS connect {jwt, last_seen_id 100}
    WS->>WS: verify JWT
    WS->>PG: SELECT messages WHERE channel_id in user_channels AND id newer than 100
    PG-->>WS: rows 101 to 105
    WS->>U: WS push backlog 101..105
    WS->>RD: SUBSCRIBE chan for each user channel
    Note over U,WS: Live stream resumed
```

**Why this is the architecture, not an afterthought:** Without `last_seen_id` bookkeeping and Postgres replay, a user who disconnects for five seconds would silently lose any messages that were only published via Redis pub/sub during that window. Redis pub/sub does not retain messages. Postgres is the durability anchor that makes real-time delivery correct.

### 4.4 Kill a chat-service instance

```mermaid
sequenceDiagram
    actor A as Alice
    actor B as Bob
    participant WSA as chat-service A
    participant WSB as chat-service B
    participant RD as Redis

    Note over A,WSA: Alice connected to WSA
    Note over B,WSB: Bob connected to WSB
    A->>WSA: send "hello"
    WSA->>RD: publish
    RD->>WSB: fanout
    WSB->>B: deliver "hello"

    Note over WSA: kubectl delete pod chat-service-A
    WSA--xA: connection drops
    Note over A: reconnect routed by the gateway to WSB or a new replica
    A->>WSB: WS connect {last_seen_id}
    WSB->>A: backlog replay, then live stream
    B->>WSB: send "and now?"
    Note over WSB: Redis has no WSA subscriber anymore - no wasted delivery
    WSB->>B: local delivery to Bob
    WSB->>A: delivery via Alice's new connection
```

No messages lost, no users stuck. This is the "kill-a-node" moment of the final demo.

## 5. Consistency model — summary table

| Data path | Store | Consistency | Rationale |
|---|---|---|---|
| User credentials | Postgres | Strongly consistent | Auth must be correct; writes are rare |
| Channel metadata and membership | Postgres | Strongly consistent | Source of truth for access control |
| Message history and ordering | Postgres, monotonic `id` | Strongly consistent | Single authority for order; avoids clock skew |
| Live message delivery across nodes | Redis pub/sub | Eventually consistent | Fire-and-forget, complemented by Postgres replay on reconnect |
| Presence (online status) | Redis with TTL | Eventually consistent | Small staleness window acceptable (30 s) |
| Authentication tokens | JWT (stateless) | N/A | No server-side session state |

## 6. Deployment topology

### 6.1 Local development — Docker Compose

```mermaid
flowchart LR
    subgraph Host["Developer machine"]
        FE["next.js dev server"]
        subgraph DC["docker-compose network"]
            GW["nginx gateway"]
            AUTH["auth-service"]
            API["api-service"]
            WS["chat-service"]
            MIG["migrate (one-shot)"]
            PG["postgres"]
            RD["redis"]
        end
    end

    Dev["Developer<br/>localhost"] -->|":3000"| FE
    FE -->|":8080"| GW
    GW --> AUTH
    GW --> API
    GW -.-> WS
    MIG --> PG
    AUTH --> PG
    API --> PG
    WS --> PG
    API --> RD
    WS <--> RD
```

- Backend stack brought up with a single `docker compose up --build`; the Next.js dev server runs on the host (`pnpm dev`) for fast hot-reload and talks to the stack through the gateway on `:8080`.
- A one-shot `migrate` service applies the schema (`alembic upgrade head`) and exits before the app services start (`depends_on: condition: service_completed_successfully`).
- Backend services are reachable only through the gateway — they use `expose`, not host `ports`.
- `chat-service` can be scaled (`docker compose up --scale chat-service=3`) to exercise the multi-node Redis fanout path during development.
- Data volumes persist Postgres and Redis across restarts (`docker compose down -v` to wipe).

### 6.2 Deployment demo — Kubernetes (k3d)

```mermaid
flowchart TB
    subgraph Cluster["k3d cluster"]
        Ing["Ingress<br/>(k3d's bundled Traefik controller)"]

        subgraph NS["chat namespace"]
            AUTHD["auth-service Deployment<br/>replicas 2"]
            APID["api-service Deployment<br/>replicas 2"]
            WSD["chat-service Deployment<br/>replicas 3"]
            PGSS["postgres StatefulSet<br/>replicas 1"]
            RDSS["redis StatefulSet<br/>replicas 1"]
            FEDP["frontend Deployment<br/>replicas 1"]

            AUTHS["auth-service Service"]
            APIS["api-service Service"]
            WSS["chat-service Service"]
            PGS["postgres Service"]
            RDS["redis Service"]
            FES["frontend Service"]
        end

        Ing -->|"/auth/*"| AUTHS
        Ing -->|"/api/*"| APIS
        Ing -->|"/ws"| WSS
        Ing -->|"/"| FES

        AUTHS --> AUTHD
        APIS --> APID
        WSS --> WSD
        PGS --> PGSS
        RDS --> RDSS
        FES --> FEDP

        AUTHD --> PGS
        APID --> PGS
        APID --> RDS
        WSD --> PGS
        WSD --> RDS
    end
```

- Manifests live in `infra/k8s/`.
- The Compose gateway (nginx) is replaced by a Kubernetes **Ingress** resource. k3d ships Traefik as its default ingress controller, so the Ingress is satisfied without installing anything — a clean illustration that "gateway" is a *role* fulfilled differently by each orchestrator (an explicit nginx container in Compose, a platform-native Ingress in Kubernetes).
- Postgres and Redis as StatefulSets with persistent volume claims.
- auth-service, api-service, and chat-service as Deployments — `kubectl scale` demonstrably increases replicas.
- Liveness and readiness probes on every backend Deployment.
- A `NOTES.md` in the manifests directory documents the demo commands (`kubectl get pods`, `kubectl delete pod`, etc.).

## 7. Tech stack rationale

### Backend — Python + FastAPI

Both team members have prior experience with FastAPI from previous coursework. FastAPI's native async and WebSocket support are sufficient at the demo scale targeted by the NFRs. The alternative of splitting out a Go WebSocket gateway would add deployment and integration complexity that is not justified until we know where the bottlenecks actually are. All-Python for MVP is the pragmatic default.

### Database — PostgreSQL, shared across services

A single shared Postgres instance rather than a database-per-service is a deliberate departure from strict microservices orthodoxy. The per-service-DB pattern creates migration complexity and cross-service consistency problems that a two-person team cannot address well in one semester. Sharing Postgres is simpler, correct, and the right call at this scale. If a specific service genuinely needs isolation later, it can be split.

### Cache and pub/sub — Redis

Redis fills three roles cleanly at MVP scale: cache, ephemeral state with TTL (presence), and publish/subscribe for cross-node fanout. Using one tool for three roles simplifies operations. Redis pub/sub is the right fanout primitive here specifically because durability is not a requirement for this path — Postgres already owns durability. Fire-and-forget semantics are a feature, not a limitation.

### Message broker — staged introduction

- **MVP uses Redis only.** No RabbitMQ, no Kafka. The one broker need in MVP (cross-node chat fanout) is solved by Redis pub/sub.
- **V2 introduces RabbitMQ** once there is genuine async durable work (emailing on @mention, processing file uploads). RabbitMQ adds durable queues, acks, and retries — a distinctly different distributed pattern from Redis pub/sub, which is what makes it worth introducing as a teaching moment rather than just an operational addition.
- **Kafka is a V3-only consideration** in the context of federation or event sourcing, which are not in the deliverable scope.

### Gateway — nginx (Compose) / Ingress (Kubernetes)

The gateway is a *role* — single ingress, path-based routing, CORS, TLS termination, later rate limiting — fulfilled by different tools in each environment.

In Docker Compose the gateway is **nginx** with a single explicit `nginx.conf`. We initially used Traefik, attracted by its label-based autodiscovery, but at a three-service scale that model cost more than it returned: a mounted Docker socket, a pinned Docker API version, and routing rules scattered across container labels rather than stated in one place. nginx inverts that trade-off — the whole routing and CORS surface is one readable file, which matters for a project that has to *explain* its gateway, not just run it. Kong would be heavier for no benefit at this scale; a custom FastAPI gateway would mean implementing routing, auth-forwarding, and rate-limiting from scratch, none of which teaches anything specific to distributed systems.

In Kubernetes the gateway role is filled by a native **Ingress** resource. k3d bundles Traefik as its default ingress controller, so no extra component is installed. The Compose-to-Kubernetes shift in how the *same* gateway role is implemented is itself a point worth narrating in the presentation.

### Service discovery — platform-native

Docker Compose's internal DNS resolves service names in development; Kubernetes Services handle it in the deployment demo. A dedicated service registry like Consul is unnecessary at this scale and is explicitly rejected as over-engineering.

### Frontend — Next.js + Tailwind + shadcn/ui

Reuses the stack both team members know from prior coursework. Next.js's SSR capabilities are mostly unused for a client-heavy chat SPA, but the component and tooling familiarity outweighs theoretical elegance. Shipping velocity is the primary consideration.

### Orchestration — Docker Compose → Kubernetes (k3d)

Docker Compose is the daily-driver development environment. Kubernetes is the deployment-demo target because the course syllabus covers orchestration and scaling concepts that Compose cannot demonstrate. k3d is chosen over minikube for a smaller footprint and faster iteration. This Compose-to-Kubernetes transition is itself a distributed systems lesson worth narrating in the final presentation.

### CI/CD — GitHub Actions

Free for public repos of this size, well-integrated with GitHub Issues and PRs, and sufficient for build-plus-test on every push.

## 8. Things this design intentionally does not do

It is as important to articulate what the system does *not* do, and why:

- **No consensus protocol (Raft / Paxos).** There is no replicated state requiring leader election. Postgres is a single writer; Redis is a single writer. When those become bottlenecks (they will not at demo scale), the answer is primary-replica replication, not consensus.
- **No database sharding.** A single Postgres instance trivially handles the NFR-1 through NFR-5 targets.
- **No geo-distribution.** Single-region deployment only.
- **No message queue durability in MVP.** Chat messages are durable via Postgres; live delivery is best-effort via Redis pub/sub; the combination is sufficient because reconnect-with-backfill closes the gap.
- **No custom protocol.** JSON over WebSocket for realtime, plain REST for everything else. Binary protocols, protobuf, and similar optimizations are irrelevant at this scale.

Each of these absences is justifiable in the final presentation with a concrete reason tied to the NFR targets, rather than hand-waving.
