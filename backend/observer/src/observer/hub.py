"""Fanout hub: one broadcaster tail-reads the stream, folds world-state, and
feeds bounded per-client queues.

Backpressure contract: a slow dashboard NEVER slows the bus or other clients.
Its queue drops oldest (it can re-sync from the snapshot at any time) and the
next batch frame carries ``elided: n`` so the UI can say "n events elided".
Batches coalesce over ~150 ms — one frame per tick, not one per event.

Resilience contract: ``run()`` is a forever-loop with the same posture as
chat's listener — it must never die. Both ``bus.tail()`` and the per-envelope
fold+push are guarded: a poison event (one that makes ``state.apply`` raise)
is logged and skipped, never killing the broadcaster task. ``last_id`` is
advanced before folding so a poison event is never re-read on the next tick.
"""

import asyncio
import logging

from observer.bus import Bus, Envelope
from observer.state import WorldState

logger = logging.getLogger("observer.hub")


class Client:
    def __init__(self, queue_max: int, coalesce_ms: int) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=queue_max)
        self.dropped = 0
        self._coalesce_s = coalesce_ms / 1000

    async def drain(self) -> dict | None:
        """Collect everything queued within one coalesce window into one frame."""
        try:
            first = await asyncio.wait_for(self.queue.get(), timeout=self._coalesce_s)
        except asyncio.TimeoutError:
            return None
        await asyncio.sleep(self._coalesce_s)   # let a burst accumulate
        events = [first]
        while not self.queue.empty():
            events.append(self.queue.get_nowait())
        frame = {"type": "batch", "events": events, "elided": self.dropped}
        self.dropped = 0
        return frame


class Hub:
    def __init__(
        self,
        bus: Bus,
        state: WorldState,
        *,
        replay_count: int,
        coalesce_ms: int = 150,
        queue_max: int = 500,
    ) -> None:
        self.bus = bus
        self.state = state
        self.replay_count = replay_count
        self._coalesce_ms = coalesce_ms
        self._queue_max = queue_max
        self._clients: set[Client] = set()

    async def register(self, resume_from: str | None) -> Client:
        client = Client(self._queue_max, self._coalesce_ms)
        self._clients.add(client)
        return client

    def unregister(self, client: Client) -> None:
        self._clients.discard(client)

    def _push(self, client: Client, event_dict: dict) -> None:
        while True:
            try:
                client.queue.put_nowait(event_dict)
                return
            except asyncio.QueueFull:
                client.queue.get_nowait()      # drop oldest
                client.dropped += 1

    async def run(self) -> None:
        """Broadcaster: resilient forever-loop (same posture as chat's listener).

        Starts tailing from the beginning of the stream ("0"), not "$". Two
        reasons: (1) ``$`` resolves to "the tip at the moment this XREAD call
        actually executes" — since the broadcaster is an asyncio task, it does
        not run until its creator yields, so any event emitted before that
        first yield would resolve *before* the cursor and be silently,
        permanently missed (a fixed low cursor like "0" has no such race:
        XREAD with a concrete ID returns everything already present,
        regardless of call-time ordering). (2) WorldState is meant to reflect
        true current state the moment a dashboard opens (see state.py), which
        requires folding full history on boot, not just events since the
        broadcaster started. The bounded stream (``maxlen``) keeps this cheap.
        """
        last_id = "0"
        while True:
            try:
                events = await self.bus.tail(last_id, block_ms=1000)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("hub tail error; backing off")
                await asyncio.sleep(1.0)
                continue
            for env in events:
                last_id = env.id  # advance first: a poison event is never re-read
                try:
                    self._fold_and_push(env)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("hub failed to fold/push envelope %s; skipping", env.id)

    def _fold_and_push(self, env: Envelope) -> None:
        self.state.apply(env)
        dumped = env.model_dump()
        for client in self._clients:
            self._push(client, dumped)
