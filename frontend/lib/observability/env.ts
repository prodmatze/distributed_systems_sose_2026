// The observer binds to localhost only; with `make obs-up ALTPORTS=1` the
// host port shifts 8090 → 18090. Set NEXT_PUBLIC_OBSERVER_WS_URL in
// frontend/.env.local to follow (see docs/observability/README.md).
export function observerWsUrl(): string {
  return process.env.NEXT_PUBLIC_OBSERVER_WS_URL ?? "ws://127.0.0.1:8090/observer/ws"
}
