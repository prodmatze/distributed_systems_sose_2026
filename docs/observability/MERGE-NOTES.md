# Observability layer — edits to pre-existing files

Every file the observability-layer branch touches that existed before it,
with rationale. New files (backend/observer/**, frontend/app/observability/**,
docs/observability/**) are not listed.

| File | Change | Conflict risk |
|---|---|---|
| `infra/nginx/nginx.conf` | Added `log_format obs_json` + `access_log /dev/stdout obs_json` in `http{}`; added `proxy_set_header X-Request-ID $request_id;` to /auth/, /api/, /ws locations; added `http://localhost:3001` to the `$cors_origin` map (frontend can run on 3001 in local dev) | Low — different region from PR #37's `chat_upstream` block |
| `infra/compose/docker-compose.yml` | `command:` flags on postgres (pg_stat_statements preload) and redis (keyspace notifications) — inert for the app; `deploy.replicas: 3` added to the `chat:` service; every published host port parameterized as `${VAR:-default}` (POSTGRES_PORT/REDIS_PORT/GATEWAY_PORT/OBSERVER_PORT/JAEGER_PORT — defaults unchanged); three new profile-gated services (socket-proxy, observer, jaeger) appended | Low — additive; existing service blocks otherwise untouched |
| `Makefile` | Appended obs-up/obs-down/obs-logs/obs-smoke + `ports` targets + .PHONY; added the `ALTPORTS` host-port override block (exports the port vars, points frontend + health at the chosen gateway port) | Low — additive |
| `backend/observer/scripts/obs_smoke.py` | Reads `OBSERVER_PORT`/`GATEWAY_PORT` from env (defaults 8090/8080) so `make obs-smoke` follows `ALTPORTS` | None — observer-local script |

## Additional notes from the live integration pass (Task 9)

- **`chat:` service now carries `deploy.replicas: 3`.** nginx's `chat_upstream`
  block hard-codes `chorus-chat-1`, `chorus-chat-2`, `chorus-chat-3` as named
  peers (see the comment in `infra/nginx/nginx.conf`) and the gateway fails to
  route `/ws` traffic if any of them is missing. Previously only the
  Makefile's `--scale chat=$(CHAT_REPLICAS)` guaranteed 3 replicas; a bare
  `docker compose up` (no `--scale`) would start just one `chat` container and
  break the gateway. `deploy.replicas: 3` makes that the compose-file default
  so `docker compose up` alone is now also safe. Confirmed no conflict between
  the two knobs: `docker compose config` shows `replicas: 3` and `make obs-up`
  (which still passes `--scale chat=3`) starts exactly 3 replicas — the CLI
  `--scale` flag and `deploy.replicas` agree at the same value, and either one
  alone is now sufficient.

- **nginx config edits require a hard recreate of the gateway, not a
  reload/restart.** `infra/nginx/nginx.conf` is bind-mounted into the gateway
  container as a *single file* (`../nginx/nginx.conf:/etc/nginx/nginx.conf:ro`).
  Editing the file on the host changes its inode; the bind mount inside a
  container that was started against the old inode keeps pointing at the
  now-unlinked old file, so `docker exec gateway nginx -s reload` (or
  `docker compose restart gateway`) silently keeps serving the stale config.
  We hit this live in Task 8. The fix is always:
  ```
  docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env \
    up -d --force-recreate --no-deps gateway
  ```
  `--no-deps` avoids also recreating api/auth/chat just to pick up one config
  file. This is now the standing procedure for any nginx.conf change.

- **Gateway crash-loop backoff after replica recreation.** When the chat
  replicas are recreated (e.g. by `make obs-up` recreating the whole stack,
  or by scaling), the gateway container can come up *before* all three named
  `chorus-chat-*` upstreams exist and resolve, land nginx in a failed start,
  and then sit in Docker's restart backoff window rather than retrying
  immediately. Symptom: `docker compose ps` shows `gateway` `Restarting` or
  `Exited` well after the rest of the stack is healthy. Fix: once the chat
  replicas are confirmed up, `docker restart chorus-gateway-1` to force an
  immediate retry instead of waiting out the backoff.

- **General rule: nginx caches upstream DNS at startup, so ANY backend
  container recreation can leave a *still-running* gateway stale — not just
  the two cases above.** Live-discovered in Task 9: running `make obs-up`
  routinely recreates api/auth/chat containers (fresh container IDs, fresh
  IPs) while the gateway container itself keeps running unchanged. nginx
  resolved the upstream hostnames once at its own startup and cached the old
  IPs, so it silently keeps sending traffic to addresses that no longer
  answer — no crash, no restart loop, no config edit, just quiet 404/502s
  that look like an application bug. The fix is the same
  `--force-recreate --no-deps gateway` as the nginx.conf case, or a plain
  `docker restart chorus-gateway-1` when only the upstream IPs moved (no
  config content changed). **Rule of thumb: after recreating *any* backend
  container (api, auth, chat, or a fresh `make obs-up`), always recreate or
  restart the gateway too — don't assume "the gateway didn't change" means
  "the gateway is fine."**

  Symptom table — three distinct triggers, same-looking gateway misbehavior:

  | Trigger | Root cause | Fix |
  |---|---|---|
  | `nginx.conf` edited on host | Bind-mounted single file; edit changes the inode, running container keeps the old unlinked file open | `restart`/`reload` insufficient — must `up -d --force-recreate --no-deps gateway` |
  | Backend container recreated (api/auth/chat, e.g. via `make obs-up`) | Gateway resolved upstream DNS once at its own startup; recreated backends get new IPs the running gateway never re-resolves | `--force-recreate --no-deps gateway`, or `docker restart chorus-gateway-1` if only IPs changed |
  | Gateway itself recreated before all 3 `chorus-chat-*` upstreams exist | nginx fails its own start, lands in Docker's restart backoff window | `docker restart chorus-gateway-1` once chat replicas are confirmed up, to force an immediate retry |

- **postgres/redis are recreated by the `command:` change, not just
  restarted.** Compose treats a changed `command:` as a config diff, so
  `make obs-up` (and any subsequent `up`) recreates both containers. Named
  volumes (`postgres_data`, `redis_data`) persist across recreation — no data
  loss. `migrate` re-runs against the recreated postgres and is idempotent,
  so this is expected and safe, just worth knowing so a fresh container ID /
  brief "Restarting" blip during `obs-up` isn't mistaken for a failure.

- **Image tags pinned in the brief needed adjustment** — see the report for
  exact versions chosen and why (`tecnativa/docker-socket-proxy` has no bare
  `0.4` tag on Docker Hub; `cr.jaegertracing.io/jaegertracing/jaeger:2.19.0`
  pulled as specified).

- **Local-dev host-port override (`ALTPORTS`).** Every host-published port is
  now `${VAR:-default}` in compose (defaults identical to before), and the
  Makefile adds a single flag: `make obs-up ALTPORTS=1` shifts gateway→18080,
  postgres→15432, redis→16379, observer→18090, jaeger→18686 so the conventional
  ports stay free for another app on the same machine. Only the HOST side of
  each mapping moves — container-internal wiring (service DNS, `gateway:80`,
  `postgres:5432`) is unchanged, so nothing inside the stack reconfigures. The
  Makefile also points the frontend (`NEXT_PUBLIC_API_URL`) and `make health` /
  `make obs-smoke` at the chosen gateway/observer port automatically. `make
  ports` (add `ALTPORTS=1`) previews the mapping. Note: switching between
  default and alt ports recreates the affected containers (new host binding) —
  volumes persist, so no data loss.

Planned for Plan C (not yet applied): `backend/shared/pyproject.toml` (+OTel deps),
new `shared/telemetry.py`, 2-line init in each service main.py, ~4 call-site
lines in `chat/pubsub.py`, `application_name` in `shared/db.py`, socket-proxy
POST widening for chaos actions.
