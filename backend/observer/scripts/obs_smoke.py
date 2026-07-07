# backend/observer/scripts/obs_smoke.py
"""Live smoke test against a running `make obs-up` stack.

Asserts, over ws://127.0.0.1:8090/observer/ws:
  1. snapshot frame arrives with >= 6 chorus containers
  2. docker.stats / redis.stats / db.stats events flow within 10s
  3. an http.request event appears after we curl the gateway
Run:  make obs-smoke        (stack must already be up)
"""

import asyncio
import json
import os
import sys
import urllib.request

from websockets.asyncio.client import connect  # provided by uvicorn[standard]'s websockets

# Ports follow the Makefile's ALTPORTS override (exported into the environment).
WS = f"ws://127.0.0.1:{os.environ.get('OBSERVER_PORT', '8090')}/observer/ws"
GATEWAY = f"http://localhost:{os.environ.get('GATEWAY_PORT', '8080')}/api/health"


async def main() -> int:
    seen: set[str] = set()
    async with connect(WS) as ws:
        snapshot = json.loads(await ws.recv())
        assert snapshot["type"] == "snapshot", snapshot
        n = len(snapshot["state"]["containers"])
        print(f"snapshot OK — {n} containers, replicas={snapshot['state']['replicas']}")

        urllib.request.urlopen(GATEWAY, timeout=5).read()   # provoke http.request

        async def collect():
            while True:
                frame = json.loads(await ws.recv())
                if frame["type"] != "batch":
                    continue
                for e in frame["events"]:
                    seen.add(e["type"])

        try:
            await asyncio.wait_for(collect(), timeout=10)
        except asyncio.TimeoutError:
            pass

    required = {"docker.stats", "redis.stats", "db.stats", "http.request"}
    missing = required - seen
    print(f"event types seen: {sorted(seen)}")
    if n < 6:
        print(f"FAIL: expected >=6 containers in snapshot, got {n}")
        return 1
    if missing:
        print(f"FAIL: missing {sorted(missing)}")
        return 1
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
