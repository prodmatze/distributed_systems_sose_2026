"""Producer supervision: crash-only design.

Every producer runs under ``supervise``; a crash is logged, reported onto the
bus as an ``observer.health`` event (the observer observes itself), backed off
exponentially, and retried forever. One dead producer never takes down the
others, and shutdown (CancelledError) always propagates cleanly.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from observer.bus import Bus

logger = logging.getLogger("observer.supervisor")

_BACKOFF_INITIAL_S = 1.0
_BACKOFF_CAP_S = 30.0
_HEALTHY_RESET_S = 60.0


async def supervise(name: str, factory: Callable[[], Awaitable[None]], bus: Bus) -> None:
    backoff = _BACKOFF_INITIAL_S
    while True:
        started = time.monotonic()
        try:
            await factory()
            # A producer returning at all is unexpected; treat like a crash.
            raise RuntimeError("producer returned unexpectedly")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — supervision boundary
            if time.monotonic() - started > _HEALTHY_RESET_S:
                backoff = _BACKOFF_INITIAL_S
            logger.exception("producer %s crashed; restarting in %.1fs", name, backoff)
            await bus.emit(
                type="observer.health",
                service="observer",
                payload={"producer": name, "status": "restarting", "error": str(exc)},
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _BACKOFF_CAP_S)
