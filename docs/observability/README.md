# Chorus Observability Layer

A dev-only, opt-in service (`backend/observer`) that watches the running
Chorus stack — containers, Redis pub/sub, Postgres, the gateway's access log
— and republishes everything it sees as one unified event stream, live, over
a WebSocket. It exists to make the distributed system's invisible behavior
visible: request fanout across chat replicas, presence transitions, a killed
node dying and healing. It is a pure consumer: every producer taps an
existing signal (docker events, `chan:*` pub/sub, `pg_stat_*`, nginx's access
log) without touching `auth`/`api`/`chat` code, so it can never be the thing
that breaks the chat app it's watching.

## Architecture

```
┌────────────────────────────── PRODUCERS ───────────────────────────────────┐
│ auth/api/chat ─► OTel auto-instrumentation (FastAPI + asyncpg + redis)     │
│     │            ├─► RedisSpanExporter ──► XADD obs:events                 │
│     │            └─► OTLP ──► Jaeger all-in-one (fallback UI)              │
│     └─► traceparent injected into chan:* payloads (cross-replica traces)   │
│                                                                            │
│ OBSERVER-INTERNAL taps (zero code in core services):                       │
│   • docker events + stats        (via socket-proxy)                        │
│   • PSUBSCRIBE chan:*            (every chat message in flight)            │
│   • keyspace notifications       (presence:* → online/offline)             │
│   • pg_stat_* pollers            (1–2 s diffs)                             │
│   • nginx JSON access-log tail   (gateway hop, $request_id)                │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   ▼
                Redis Stream obs:events (XADD MAXLEN ~2000)
                = bus + ring buffer + replay cursor in one primitive
                                   ▼
                ┌────────────────────────────────────┐
                │ backend/observer (FastAPI)         │
                │ • XREVRANGE → replay history       │
                │ • XREAD BLOCK → live tail          │
                │ • world-state snapshot (topology)  │
                │ • rate-limit / coalesce per client │
                │ • actions API (chaos + synthetic)  │
                └───────────────┬────────────────────┘
                                ▼ WebSocket (127.0.0.1:8090)
                frontend /observability (mission control + tabs)
```

As of this task (Plan A), the bus, the observer service, and five zero-touch
producers (docker, redis tap, redis stats, pg stats, nginx log) are live. The
OTel span exporter, `/observability` frontend, and the actions API (chaos +
synthetic bots) are Plan B/C — not yet built; see [Links](#links).

## Running it

```bash
make obs-up      # backend stack + observer, socket-proxy, jaeger (--profile observability)
make obs-logs    # follow the observer's own logs
make obs-smoke   # live WS smoke test — asserts snapshot + required event types flow
make obs-down    # stop everything, including the observability services
```

Before running `make obs-smoke`, ensure the dev venv exists:
```bash
builtin cd backend/observer && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
```

`docker-compose.yml` carries `deploy.replicas: 3` on the `chat:` service, so
a plain `docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env up`
(no `--scale`, no `--profile`) is now also safe — the gateway's named
upstreams (`chorus-chat-1..3`) always resolve. `make backend` (or
`make obs-up`) stays the canonical entry point: it pins `--scale chat=3`
explicitly, and the two knobs agree (`docker compose config` shows
`replicas: 3` regardless of which one wins).

| Endpoint | Address | Notes |
|---|---|---|
| Observer health | `http://127.0.0.1:8090/observer/health` | `{"ok": true, "service": "observer"}` |
| Observer WS | `ws://127.0.0.1:8090/observer/ws` | snapshot → history → live tail |
| Jaeger UI | `http://127.0.0.1:16686` | span waterfalls once OTel lands (Plan C) |
| Gateway | `http://localhost:8080` | unchanged — `/auth`, `/api`, `/ws` |
| Frontend | `http://localhost:3000` | unchanged — `/observability` route lands in Plan B |

## The event envelope

Every producer emits the same shape (`observer/bus.py::Envelope`):

```jsonc
{
  "id": "1720374000123-0",        // Redis stream ID = monotonic cursor (resume)
  "type": "http.request | chat.message | chat.message.summary | docker.event | docker.stats |
           docker.containers | presence.online | presence.offline | db.stats | redis.stats |
           observer.health | span | ...",
  "service": "api | auth | chat | gateway | postgres | redis | docker | observer",
  "ts": "2026-07-07T18:30:00.123Z",
  "corr": "trace_id | $request_id | null",   // cross-plane correlation
  "payload": { /* type-specific */ }
}
```

Three real shapes, taken from the producers that emit them today:

**`docker.event`** (die, exit code 137 — the kill-a-node moment):
```json
{"id":"1720374008137-0","type":"docker.event","service":"docker","ts":"2026-07-07T18:42:08.137Z","corr":null,"payload":{"action":"die","container":"chorus-chat-2","service":"chat","exit_code":"137"}}
```

**`chat.message`** (from the `chan:*` tap — `redis_tap.py`, wraps chat's own
`ChatMessage` schema verbatim):
```json
{"id":"1720374008501-0","type":"chat.message","service":"chat","ts":"2026-07-07T18:42:08.501Z","corr":null,"payload":{"channel_id":3,"message":{"type":"message","id":142,"channel_id":3,"sender_id":7,"sender_username":"alice","body":"hey bob!","created_at":"2026-07-07T18:42:08.480000+00:00"}}}
```

**`http.request`** (from the nginx `obs_json` access-log tail — `nginx_log.py`;
`corr` is `$request_id`, also forwarded upstream as `X-Request-ID`):
```json
{"id":"1720374008512-0","type":"http.request","service":"api","ts":"2026-07-07T18:42:08.512Z","corr":"c3f1a9e2-6b7d-4a10-9e21-5f8e2b1d0a44","payload":{"method":"GET","uri":"/api/channels","status":200,"rt_ms":12.4,"upstream":"172.19.0.6:8000","remote":"172.19.0.1"}}
```

## Consuming the feed

`ws://127.0.0.1:8090/observer/ws[?resume_from=<stream-id>]` — a fresh connect
gets, in order: (1) `{"type": "snapshot", "state": {...}}` — current
world-state (containers, online users, per-type rates, replica count,
`last_event_id`), folded from the entire bus history at connect time, so a
dashboard opened mid-demo is instantly complete, not empty-then-filling; (2)
one `{"type": "batch", "events": [...], "elided": 0}` frame — either the last
`replay_count` (300) events via `XREVRANGE`, or, on reconnect with
`resume_from` set, everything since that exact ID via `XREAD`; (3) live tail
in the same batch shape, one frame per ~150 ms coalesce window, forever.

`resume_from` is the last `id` a client saw; passing it back on reconnect delivers everything since that ID.
**Important:** events between WS registration and the replay fetch can be delivered twice; consumers **MUST** dedupe by envelope `id`.
A single resume read covers at most 500 missed events (max ~2000 by stream retention); longer disconnects mean a gap — reconnect without `resume_from` for a full snapshot+history instead.
Deliberately the same shape as chat's own `last_seen_id` reconnect protocol (`docs/ARCHITECTURE.md` §4.3).

Backpressure is per-client: a bounded queue drops the *oldest* event when a
slow consumer falls behind (never blocks the bus or other clients), and the
next batch frame's `elided` field reports how many were dropped, so the UI
can render "n events elided" and always re-sync from a fresh snapshot rather
than chase a queue it can't drain.

## Security posture

The observer is a control plane for the whole Docker host — nothing about
that is safe to expose past `localhost`, so every layer assumes it never will
be:

- **Localhost bind.** `ports: ["127.0.0.1:8090:8000"]` — unreachable from
  outside the host, not routed through the gateway. CORS pinned to
  `http://localhost:3000`.
- **Profile gate.** Observer, socket-proxy, and Jaeger all carry
  `profiles: ["observability"]`. A bare `docker compose up` (no `--profile`)
  starts none of them — behavior is byte-identical to before this layer
  existed.
- **Socket-proxy is read-only.** `docker.sock` never mounts into the
  observer directly — a raw `:ro` bind mount on the socket is security
  theater, since the Docker Engine API doesn't check the mount's read-only
  flag; the socket is a full RPC channel and whoever holds it can issue
  arbitrary write calls regardless of how it's mounted. Instead
  `tecnativa/docker-socket-proxy:v0.4.2` holds the real socket, and the
  observer only ever talks to `socket-proxy:2375`, configured with
  `CONTAINERS: 1` (list/inspect/logs/stats only) and `POST: 0` — every
  mutating verb 403s. Proof, run live against `make obs-up`:

  ```bash
  docker exec chorus-observer-1 python -c "
  import urllib.request, urllib.error
  urllib.request.urlopen('http://socket-proxy:2375/containers/json?all=1', timeout=5)
  print('GET  /containers/json -> 200 (read allowed)')
  req = urllib.request.Request('http://socket-proxy:2375/containers/prune', method='POST')
  try:
      urllib.request.urlopen(req, timeout=5)
  except urllib.error.HTTPError as e:
      print('POST /containers/prune ->', e.code, e.read().decode().strip())
  "
  ```
  ```
  GET  /containers/json -> 200 (read allowed)
  POST /containers/prune -> 403 <html><body><h1>403 Forbidden</h1>
  Request forbidden by administrative rules.
  </body></html>
  ```
  (`POST` widens minimally in Plan C — only `kill`/`stop`/`restart`/`start`,
  the verbs chaos actions need — behind an observer-side protected set of
  `{postgres, redis, socket-proxy, observer}` that stays untouchable.)
- **No auth in MVP, by design.** The control plane inherits the trust of the
  machine it binds to; it is never deployed past a developer's laptop.
- **Chat visibility.** The observer's `chan:*` subscription tap sees full chat message bodies on the bus.
  This is acceptable for this dev-only, localhost-bound tool and is a deliberate, documented trade-off.

## Failure isolation contract

The one invariant that matters more than anything else here: **observability
must never break the observed.**

- `Bus.emit()` is fire-and-forget by contract (`bus.py`): `XADD` wrapped in a
  bare `try/except`; a dropped write is a logged warning, never an exception
  reaching a producer's loop.
- Every producer runs as an independent asyncio task under `supervise()`
  (`supervisor.py`): a crash is caught, reported onto the bus itself as an
  `observer.health` event (`{"producer": name, "status": "restarting",
  "error": ...}`) — the observer observes its own failures — backed off
  exponentially (1s → 30s cap, reset after 60s healthy), and retried forever.
  One dead producer never takes down the others.
- Live-verified today: `docker kill chorus-observer-1` mid-conversation, then
  `backend/chat/scripts/ws_smoke.py` through the gateway — cross-node message
  fanout via Redis pub/sub PASSED with the observer dead. `make obs-smoke`
  PASSED again immediately after `docker start chorus-observer-1`, with no
  state corruption from the kill. Chat cannot tell the observer exists.

## Operational gotchas

Carried over from `docs/observability/MERGE-NOTES.md`. The standing fix for
any gateway staleness:

```bash
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env \
  up -d --force-recreate --no-deps gateway
```

| Trigger | Root cause | Fix |
|---|---|---|
| `nginx.conf` edited on host | Bind-mounted as a single file; editing changes the inode, so a running gateway keeps the old unlinked file open — `reload`/`restart` silently serve stale config | `--force-recreate --no-deps gateway` (above) |
| Backend container recreated (api/auth/chat, e.g. via `make obs-up`) | nginx resolves upstream DNS once at its own startup; recreated backends get new IPs the running gateway never re-resolves — quiet 404/502s, no crash | Same fix, or `docker restart chorus-gateway-1` if only IPs moved |
| Gateway itself recreated before all 3 `chorus-chat-*` upstreams exist | nginx fails its own start, lands in Docker's restart backoff window | `docker restart chorus-gateway-1` once chat replicas are up, to force an immediate retry |

Rule of thumb: after recreating *any* backend container, recreate or restart
the gateway too — "the gateway didn't change" doesn't mean "the gateway is
fine."

**postgres/redis get recreated, not just restarted, by `make obs-up`.** Their
`command:` flags changed (pg_stat_statements preload, keyspace
notifications), and Compose treats that as a config diff requiring
recreation. Named volumes persist, `migrate` re-runs idempotently; a brief
"Restarting" blip during `obs-up` is expected, not a failure.

## Report-worthy talking points

- **Replay-then-tail mirrors chat's own reconnect story.** The bus's
  `XREVRANGE` → `XREAD BLOCK` shape and the WS's snapshot → history → live
  tail sequence are a direct generalization of chat's `last_seen_id` /
  Postgres-backlog reconnect pattern (`docs/ARCHITECTURE.md` §4.3): same
  problem (a late-connecting client must not miss and must not duplicate),
  same answer, reused rather than reinvented, on a different transport
  (Redis Stream vs. Postgres). One pattern, two data planes.
- **The NUMPAT story.** The spec's original design assumed `PUBSUB NUMPAT`
  would double as a live replica counter — the natural first instinct for
  "how many chat nodes are subscribed right now." Task 9's kill-a-node dry
  run (`docker kill chorus-chat-2` → wait → `docker start`) falsified that
  live: `redis.stats.numpat` sat flat at `2` through the whole cycle, never
  dipping 3→2→3 as predicted. The cause is a category error, not a bug —
  `PUBSUB NUMPAT` counts distinct *pattern strings* subscribed, not the
  clients holding them. All three chat replicas `PSUBSCRIBE` the identical
  literal pattern `chan:*` — one pattern string no matter how many replicas
  hold it — plus the observer's own `__keyevent@0__:*` tap = 2, always. The
  fix derives the real per-replica count from `CLIENT LIST` instead: rows
  where `psub > 0` and `name != "observer"` (every observer-owned connection
  sets `client_name="observer"` for exactly this reason). Surfaced as
  `chat_subscribers`; `numpat` stays in the payload too, honestly labeled as
  raw data rather than a replica count. A live-observed correction to the
  design, during the design's own integration test — the observability layer
  doing its job on itself.
- **Backpressure by design, not by accident.** Three mechanisms compound:
  producer-side token buckets on floody types (`chat.message` capped at 20/s
  burst 40, overflow folded into periodic `chat.message.summary` counts
  rather than dropped silently); per-client coalescing into one batch frame
  per ~150 ms instead of one per event; and a bounded per-client queue that
  drops the *oldest* entry under sustained overload, reporting the count via
  `elided`. A dashboard that falls behind degrades to lossy-but-honest, never
  to a memory leak or a stalled bus, and resynchronizes instantly from a
  fresh snapshot.

## Links

- Merge notes (every pre-existing file touched, with rationale): [`docs/observability/MERGE-NOTES.md`](./MERGE-NOTES.md)
- System design and data flows: [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
