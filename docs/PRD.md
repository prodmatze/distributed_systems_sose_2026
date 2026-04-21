# Product Requirements Document — Chorus

**Course**: Distributed Systems, Summer Semester 2026
**Team**: Mathieu Wassmuth (584486), Lam Tuan Khanh Nguyen (0596535)
**Status**: Planning — Week 1–2
**Last updated**: April 2026

---

## 1. Problem statement

Community chat platforms like Discord are ubiquitous in modern online communities, yet they are genuinely hard distributed systems behind the scenes. A single chat message must be durably persisted, ordered consistently, and delivered in real time to potentially many recipients connected through different servers, without any single server being a point of failure. Adding drop-in voice rooms on top of that baseline — where users hop between channels and expect sub-second audio — raises the bar further.

We are building **Chorus**: a pragmatic, scope-controlled Discord-style community chat application whose primary goal is to exercise the distributed systems concepts covered in this course — WebSockets, load balancing, horizontal scaling, caching, publish/subscribe messaging, service boundaries, and fault tolerance — on a codebase small enough for a two-person team to ship within one semester. The long-term product vision is a community space with persistent text channels, drop-in voice channels, direct messages, and rich media; the semester deliverable focuses on making the text-first baseline genuinely distributed, with voice features framed as an explicit future direction.

## 2. Goals

The project has two equal-weight goals:

### 2.1 Product goal
Deliver a demo-ready chat application in which two or more users can register, join a public channel, and exchange messages in real time — with a visible backend architecture that clearly runs on multiple nodes and survives the loss of any single chat service instance.

### 2.2 Learning goal
Each deliberate architectural choice should map to a course topic and be defensible in the final presentation. We want to be able to walk the instructor through *why* we chose a particular pattern (e.g. Redis pub/sub for cross-node fanout, Postgres monotonic IDs as the ordering source of truth) rather than just *that* we used it.

## 3. Target users

For the purposes of the demo the user population is the two team members plus the instructor. Conceptually the user personas are:

| Persona | Description | Primary needs |
|---|---|---|
| **Team member** | Member of a small team using the app to chat about work | Register, log in, join channels, send and receive messages in real time, see history when reconnecting |
| **Operator** | The team itself, wearing their "running the service" hat | Start multiple chat instances, scale them horizontally, survive a node failure, observe the system |
| **Instructor / reviewer** | The final-presentation audience | Understand the architecture, see the distributed behavior live, follow the consistency and failure-mode reasoning |

## 4. Scope — three tiers

The project is divided into three strictly-ordered tiers. Each tier is self-contained — the project is shippable at the end of any tier. Tier work only promotes upward when the tier below is fully solid.

### 4.1 Tier 1 — Base MVP (must-have, carries the grade)

**The minimum that proves the distributed architecture works end-to-end.**

**User-facing features:**
- User registration and login with JWT-based session tokens.
- Public channels — create, list, join.
- Send and receive text messages in a channel in real time.
- Message history on channel open and on reconnect.
- Basic user profile (username).
- Minimal web frontend (login, channel list, chat view).

**Architectural properties:**
- Chat service runs as N horizontally-scaled instances behind a load balancer.
- Cross-node message fanout via Redis pub/sub.
- Postgres as the single durable source of truth, with monotonic IDs as the message-order authority.
- Traefik as the API gateway and load balancer.
- Docker Compose for local development.
- Kubernetes manifests (targeting k3d or minikube) for the final deployment demo.
- GitHub Actions CI running build + tests on every push.
- Demonstrable "kill a node" behavior — any single chat service instance can be terminated mid-conversation and message delivery continues.

### 4.2 Tier 2 — V2 (in-semester polish, if MVP lands early)

**Chat-app polish plus one new distributed-systems pattern.**

**User-facing features:**
- 1:1 direct messages (implemented as 2-person private channels).
- Online presence indicators.
- Typing indicators.
- @mentions with email notifications.
- File and image attachments.
- Voice notes.
- Message search.
- Message editing and deletion.
- Read receipts on direct messages.
- User avatars.

**Architectural additions:**
- RabbitMQ introduced for durable, retryable async work (email notifications, file processing). This adds a *second* distributed-systems pattern to the project — durable/acked/retryable messaging — that is distinct from the ephemeral/fire-and-forget pattern of Redis pub/sub.
- MinIO (S3-compatible object storage) for blob uploads.
- Structured logging across services.
- Prometheus metrics and a simple Grafana dashboard.
- Rate limiting at the Traefik gateway.
- Live demonstration of `kubectl scale` adjusting chat service replicas under load.

### 4.3 Tier 3 — V3 (ambitious menu, optional)

**A buffet of standalone, substantial features. If the team completes V1 and V2 and still has runway, pick one or two.**

- 1:1 WebRTC audio calls (signaling via the existing WebSocket channel; STUN/TURN for NAT traversal).
- 1:1 WebRTC video + screen sharing (cheap extension once audio calls work).
- Group voice/video calls (requires a Selective Forwarding Unit such as mediasoup or Janus; significantly harder).
- **Discord-style drop-in voice channels** — persistent, always-on voice rooms users can hop between; reuses the group-call SFU infrastructure with a different UX model and is the most on-brand V3 item for a Discord-style product.
- End-to-end encryption for direct messages (X3DH + Double Ratchet).
- Federation between multiple server instances (Matrix-style).
- Kafka migration for replay and event sourcing (justifies federation).
- Mobile clients.
- Bots and integrations.

These are explicitly **not promised** in the project plan. They are listed so the architecture decisions in MVP and V2 can be justified with an eye toward where the system would naturally evolve.

## 5. User stories

Stories are numbered for traceability from issues and PRs. Format: `US-xxx`.

### 5.1 Tier 1 — MVP stories

#### Authentication and identity

- **US-001** — As a new user, I want to register an account with a username, email, and password so that I can start using the chat.
  *Acceptance:* `POST /api/auth/register` returns 201 with a JWT; duplicate username returns 409; password is stored hashed, never plain.
- **US-002** — As a returning user, I want to log in with my credentials and receive a session token so that I can resume my conversations.
  *Acceptance:* `POST /api/auth/login` returns 200 with JWT on correct credentials; 401 on wrong credentials.
- **US-003** — As a logged-in user, I want my session to persist across page refreshes so that I don't have to log in repeatedly.
  *Acceptance:* JWT stored in httpOnly cookie or secure storage; valid for a configurable duration (default 24h).

#### Channels and messaging

- **US-010** — As a user, I want to create a new public channel with a name and description so that I can start a conversation around a topic.
  *Acceptance:* `POST /api/channels` returns 201; duplicate names rejected.
- **US-011** — As a user, I want to see a list of all public channels so that I can discover where conversations are happening.
  *Acceptance:* `GET /api/channels` returns all channels with member counts.
- **US-012** — As a user, I want to join a channel so that I can see its messages and participate.
  *Acceptance:* `POST /api/channels/{id}/join` adds membership; channel visible in user's channel list thereafter.
- **US-013** — As a user, I want to send a text message to a channel so that other members can read it.
  *Acceptance:* WebSocket `send` event writes to Postgres with monotonic ID; server echoes the canonical message back with its ID and timestamp.
- **US-014** — As a user, I want messages I send to appear instantly in other participants' browsers so that conversation feels natural.
  *Acceptance:* End-to-end delivery latency p95 < 500 ms at demo scale; delivery works even when sender and recipient are connected to different chat service instances.
- **US-015** — As a user, I want to see the history of a channel when I open it so that I have context for the ongoing conversation.
  *Acceptance:* On channel open, frontend fetches the most recent N messages (default 50) ordered by monotonic ID ascending.

#### Reliability

- **US-020** — As a user, I want my WebSocket connection to automatically reconnect after a transient network failure so that I don't have to refresh the page.
  *Acceptance:* Client implements exponential backoff reconnect; UI shows connection status.
- **US-021** — As a user, I want messages that arrived while I was disconnected to be delivered on reconnect so that I don't silently miss anything.
  *Acceptance:* On reconnect, client sends `last_seen_message_id`; server replays `id > last_seen_message_id` from Postgres before resuming live stream.

#### Operations

- **US-030** — As an operator, I want to run multiple chat service instances in parallel so that the system can scale horizontally.
  *Acceptance:* `docker compose up --scale chat-service=3` starts three replicas; all are healthy and accept connections.
- **US-031** — As an operator, I want a message sent via one chat instance to be delivered to clients connected to any other instance so that horizontal scaling is transparent to users.
  *Acceptance:* With replicas A, B, C and two users on different replicas, messages flow bidirectionally.
- **US-032** — As an operator, I want to kill any single chat service instance without breaking active conversations so that the system is fault-tolerant.
  *Acceptance:* With three replicas running and active chats, killing one causes no message loss for users on the surviving replicas; users on the killed replica reconnect and backfill within 5 s.
- **US-033** — As a developer, I want every push to run tests and build containers automatically so that regressions are caught early.
  *Acceptance:* GitHub Actions workflow runs on push and PR; builds backend and frontend images; runs unit and integration tests.

### 5.2 Tier 2 — V2 stories

- **US-100** — As a user, I want to send a direct message to another user so that I can have a private 1:1 conversation.
- **US-101** — As a user, I want to see which other users are currently online so that I know who is available.
- **US-102** — As a user, I want to see a "X is typing…" indicator when someone is composing a message so that I know a response is coming.
- **US-103** — As a user, I want to @mention another user in a message so that they are notified.
- **US-104** — As a user, I want to receive an email when I am @mentioned and not currently active so that I don't miss important pings.
- **US-105** — As a user, I want to upload and share files and images in a channel so that we can collaborate on documents and visual content.
- **US-106** — As a user, I want to record and send a short voice note so that I can communicate asynchronously without typing.
- **US-107** — As a user, I want to search messages by keyword so that I can find past discussions.
- **US-108** — As a user, I want to edit or delete my own messages so that I can correct mistakes.
- **US-109** — As a user, I want to set a profile avatar so that other users can recognize me visually.
- **US-110** — As a user, I want read receipts on my direct messages so that I know the recipient has seen them.
- **US-120** — As an operator, I want structured logs from every service so that I can debug issues.
- **US-121** — As an operator, I want Prometheus metrics (request count, WS connection count, latency histograms) so that I can observe system health.
- **US-122** — As an operator, I want to horizontally scale chat service instances with `kubectl scale` so that I can adapt to load.
- **US-123** — As an operator, I want the gateway to rate-limit abusive clients so that one bad actor cannot exhaust the system.

### 5.3 Tier 3 — V3 stories (optional)

- **US-200** — 1:1 voice call (WebRTC).
- **US-201** — 1:1 video call with optional screen sharing.
- **US-202** — Group voice/video calls (via SFU).
- **US-203** — Discord-style persistent voice channels (drop-in voice rooms).
- **US-204** — End-to-end encrypted direct messages.
- **US-205** — Federation with a peer server.

## 6. Non-functional requirements

| ID | Category | Target |
|---|---|---|
| NFR-1 | End-to-end message latency | p95 < 500 ms at demo scale (≤ 20 concurrent users) |
| NFR-2 | Concurrent WebSocket connections per chat instance | ≥ 500 |
| NFR-3 | Channel history fetch (50 messages) | p95 < 500 ms |
| NFR-4 | Availability during single-instance failure | No user-visible outage on surviving instances |
| NFR-5 | Reconnect + backfill after transient disconnect | Missed messages delivered within 5 s of reconnect |
| NFR-6 | Cold-start time (zero to running locally) | Under 2 minutes via `docker compose up` |
| NFR-7 | CI pipeline duration | Under 10 minutes end-to-end |
| NFR-8 | Password storage | Hashed with a modern KDF (bcrypt/argon2id) |
| NFR-9 | Transport security | TLS terminated at the gateway in the deployment demo |

## 7. Success criteria — final demo

The final presentation will show, in sequence:

1. **Realtime bidirectional chat** — two browsers, same channel, messages flow both ways with no visible lag.
2. **History backfill** — third browser opens, fetches history, and sees the existing conversation.
3. **Reconnect backfill** — close one browser; send messages from the other; reopen and verify the missed messages appear.
4. **Multi-instance fanout** — show `kubectl get pods` listing three chat-service replicas; send and receive messages from two browsers that are provably connected to different replicas (e.g., via a debug header showing which pod served the connection).
5. **Kill-a-node fault tolerance** — `kubectl delete pod chat-service-xxx` on one replica mid-conversation; surviving replicas keep delivering; the browser on the killed replica reconnects and backfills.
6. **CI pipeline** — show a recent GitHub Actions run demonstrating automated build and test.
7. **Architecture walkthrough** — present the system diagram from `docs/ARCHITECTURE.md` and narrate the message-send and reconnect data flows with explicit consistency-model commentary.

## 8. Out of scope (explicit non-goals)

The following are intentionally **not** part of this project. Saying so explicitly is itself a deliverable — it shows conscious scope control.

- **Workspaces** — a single global namespace of channels and users is sufficient for the course.
- **Private channels** — all channels in MVP are public.
- **Threads and replies** — messages are flat.
- **Reactions and emoji** — text-only message body in MVP.
- **Admin roles and moderation** — all users are peers.
- **Mobile-responsive polish** — desktop web is the supported target.
- **Localization** — English only.
- **Database sharding / multi-region deployment** — single Postgres, single region.
- **Consensus protocols (Raft / Paxos)** — not needed at this scale; we will justify this explicitly in the presentation rather than hand-wave around it.
- **Anti-abuse / spam prevention** — not required for demo scale.

## 9. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | WebSocket reconnect and backlog-replay is trickier than it looks | High | MVP slip | Build and test early with deliberate network interruption (`docker network disconnect`); pair-program the WS layer |
| R-2 | Message ordering conflicts across instances (two users send simultaneously on different nodes) | Medium | User-visible out-of-order messages | Postgres monotonic ID is the single ordering authority; frontend orders by server-issued ID only, never by wall-clock timestamps |
| R-3 | Presence state becomes stale or wrong at scale | Medium | Incorrect online indicators | Redis keys with short TTL (≈30 s) refreshed by WS heartbeat; accept a small staleness window rather than try to make it perfectly consistent |
| R-4 | Over-engineering for imagined scale | High | MVP slip | Strict tier gating; no V2 work begins until MVP is complete and demo-ready |
| R-5 | Kubernetes setup consumes a week | Medium | Delayed deployment demo | Use k3d (lighter than minikube); target K8s for the final demo only, not for daily development |
| R-6 | Frontend state management complexity (optimistic updates, reconnect, history, live stream) | Medium | Buggy UI | Use a proven pattern (React Query + a thin WebSocket client wrapper with typed events); do not invent a custom state machine |
| R-7 | One team member blocked by another's unfinished work | Medium | Velocity loss | Interface contracts (REST schemas, WS event shapes) agreed before implementation; use mocks/stubs to unblock frontend from backend |

## 10. Tech stack summary

A brief summary — full rationale for each choice lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md#tech-stack-rationale).

| Layer | Choice | Key reason |
|---|---|---|
| Backend | Python + FastAPI | Team has prior experience; async support is sufficient at demo scale |
| Frontend | Next.js + Tailwind + shadcn/ui | Team has prior experience; fast component scaffolding |
| Durable storage | PostgreSQL | ACID guarantees; monotonic IDs for ordering |
| Cache + pub/sub + presence | Redis | Single tool covers three distinct roles at MVP scale |
| Async / durable jobs (V2) | RabbitMQ | Acknowledged, retryable queues for notification and file-processing work |
| API gateway | Traefik | Declarative, Docker-native, doubles as Kubernetes ingress |
| Local dev | Docker Compose | Single-command spin-up |
| Deployment | Kubernetes (k3d) | Demonstrates orchestration and self-healing |
| CI/CD | GitHub Actions | Standard, free for this scale |

## 11. Timeline sketch

A rough, aggressive-but-feasible plan. Re-baselined after Week 3.

| Phase | Weeks | Deliverables |
|---|---|---|
| Planning | 1–2 | This PRD, `ARCHITECTURE.md`, GitHub project board populated with MVP issues, skeleton repo structure |
| MVP foundation | 3–5 | Auth service, channel CRUD, single-node WebSocket chat, minimal frontend |
| MVP distributed | 6–7 | Multi-node Redis fanout, Traefik load balancer, reconnect + backfill, kill-a-node proof |
| MVP polish | 8 | CI green, Kubernetes manifests, end-to-end deployment dry run |
| V2 | 9–11 | Selected V2 features (prioritized against remaining time) |
| Presentation prep | 12–14 | Demo script, slides, architecture walkthrough rehearsal |

## 12. Appendix — Post-semester roadmap

Although not part of the deliverable, the system is designed with the following evolution in mind. This informs MVP and V2 architectural choices (e.g., why Redis pub/sub and not in-process only; why a clean service boundary between REST and WebSocket layers):

- Group voice/video (SFU).
- End-to-end encryption for direct messages.
- Federation across multiple servers.
- Event-sourced audit log (Kafka).
- Mobile clients and push notifications.
