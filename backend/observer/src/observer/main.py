"""observer-service — read-only telemetry hub for the Chorus stack.

Producers (supervised asyncio tasks) tap docker, redis, postgres and the
gateway's access log, and emit a unified envelope onto the Redis Stream
``obs:events``. Browsers connect to /observer/ws and receive:
snapshot -> history replay -> coalesced live tail. See
docs/superpowers/specs/2026-07-07-observability-layer-design.md.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from observer.bus import Bus
from observer.hub import Hub
from observer.producers.docker_ import run_docker_events, run_docker_poll
from observer.producers.pg_stats import run_pg_stats
from observer.producers.redis_stats import run_redis_stats
from observer.producers.redis_tap import run_redis_tap
from observer.settings import settings
from observer.state import WorldState
from observer.supervisor import supervise

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("observer.main")


def _make_redis() -> Redis:
    """Factory indirection so tests can substitute fakeredis."""
    return Redis.from_url(settings.redis_url, decode_responses=True, client_name="observer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = _make_redis()
    bus = Bus(redis, stream=settings.stream, maxlen=settings.stream_maxlen)
    world = WorldState()
    hub = Hub(bus, world, replay_count=settings.replay_count)

    app.state.redis = redis
    app.state.bus = bus
    app.state.world = world
    app.state.hub = hub

    tasks = [asyncio.create_task(hub.run(), name="hub")]
    tasks.append(
        asyncio.create_task(
            supervise("redis_tap", lambda: run_redis_tap(_make_redis, bus), bus),
            name="producer-redis_tap",
        )
    )
    tasks.append(asyncio.create_task(
        supervise("docker_events", lambda: run_docker_events(bus), bus),
        name="producer-docker-events"))
    tasks.append(asyncio.create_task(
        supervise("docker_poll", lambda: run_docker_poll(bus), bus),
        name="producer-docker-poll"))
    tasks.append(asyncio.create_task(
        supervise("redis_stats", lambda: run_redis_stats(_make_redis, bus), bus),
        name="producer-redis-stats"))
    if settings.database_url:
        tasks.append(asyncio.create_task(
            supervise("pg_stats", lambda: run_pg_stats(bus), bus),
            name="producer-pg-stats"))
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await redis.aclose()


app = FastAPI(title="Chorus Observer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/observer/health")
async def health_check():
    return {"ok": True, "service": "observer"}


@app.websocket("/observer/ws")
async def ws_endpoint(ws: WebSocket, resume_from: str | None = None):
    await ws.accept()
    hub: Hub = ws.app.state.hub
    bus: Bus = ws.app.state.bus

    client = await hub.register(resume_from)
    try:
        await ws.send_json({"type": "snapshot", "state": hub.state.snapshot()})

        if resume_from:
            missed = await bus.tail(resume_from, block_ms=1)
            if missed:
                await ws.send_json(
                    {"type": "batch", "events": [e.model_dump() for e in missed], "elided": 0}
                )
        else:
            history = await bus.history(hub.replay_count)
            if history:
                await ws.send_json(
                    {"type": "batch", "events": [e.model_dump() for e in history], "elided": 0}
                )

        while True:
            frame = await client.drain()
            if frame is not None:
                await ws.send_json(frame)
    except WebSocketDisconnect:
        pass
    except Exception:  # dead socket mid-send — client is gone, that's fine
        logger.info("observer ws client dropped")
    finally:
        hub.unregister(client)
