"""observer-service — read-only telemetry hub for the Chorus stack.

Producers (supervised asyncio tasks) tap docker, redis, postgres and the
gateway's access log, and emit a unified envelope onto the Redis Stream
``obs:events``. Browsers connect to /observer/ws and receive:
snapshot -> history replay -> coalesced live tail. See
docs/superpowers/specs/2026-07-07-observability-layer-design.md.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from observer.settings import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("observer.main")

app = FastAPI(title="Chorus Observer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/observer/health")
async def health_check():
    return {"ok": True, "service": "observer"}
