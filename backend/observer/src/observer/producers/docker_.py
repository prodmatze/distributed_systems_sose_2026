"""Docker introspection via the socket-proxy (never the raw socket).

Hybrid pattern per the research: /events streaming for instant transitions
(die/start/health flips reach the bus within milliseconds — this is what makes
the kill-a-node demo visible live), a 2.5s /containers/json resync loop as
authoritative truth that heals any missed events, and 1Hz one-shot stats per
running container aggregated into a single docker.stats event (measured cost
~11ms per call; aggregation keeps the bus quiet).

CPU% uses Docker's canonical delta formula between consecutive samples —
a single sample cannot yield a percentage.
"""

import asyncio
import logging

import aiodocker

from observer.bus import Bus
from observer.settings import settings

logger = logging.getLogger("observer.producers.docker")

_RESYNC_EVERY_TICKS = 3          # stats tick = 1s; resync every 3rd tick ≈ 3s
_LABEL_PROJECT = "com.docker.compose.project"
_LABEL_SERVICE = "com.docker.compose.service"


# ── pure translation helpers (unit-tested) ──────────────────────────────

def translate_event(ev: dict, project: str) -> tuple[str, str, dict] | None:
    if ev.get("Type") != "container":
        return None
    attrs = (ev.get("Actor") or {}).get("Attributes") or {}
    if attrs.get(_LABEL_PROJECT) != project:
        return None
    payload = {
        "action": ev.get("Action", ""),
        "container": attrs.get("name", ""),
        "service": attrs.get(_LABEL_SERVICE, ""),
    }
    if "exitCode" in attrs:
        payload["exit_code"] = attrs["exitCode"]
    return "docker.event", "docker", payload


def summarize_containers(raw: list[dict], project: str) -> dict:
    containers = []
    for c in raw:
        labels = c.get("Labels") or {}
        if labels.get(_LABEL_PROJECT) != project:
            continue
        status = c.get("Status", "")
        health = None
        if "(" in status and ")" in status:
            inner = status[status.rfind("(") + 1 : status.rfind(")")]
            if inner in ("healthy", "unhealthy", "health: starting"):
                health = inner
        containers.append({
            "name": (c.get("Names") or ["/?"])[0].lstrip("/"),
            "service": labels.get(_LABEL_SERVICE),
            "state": c.get("State"),
            "health": health,
            "status": status,
        })
    return {"containers": containers}


def compute_cpu_pct(cur: dict, prev: dict | None) -> float:
    if not prev:
        return 0.0
    try:
        cur_cpu = cur["cpu_stats"]["cpu_usage"]["total_usage"]
        prev_cpu = prev["cpu_stats"]["cpu_usage"]["total_usage"]
        cur_sys = cur["cpu_stats"]["system_cpu_usage"]
        prev_sys = prev["cpu_stats"]["system_cpu_usage"]
        online = cur["cpu_stats"].get("online_cpus", 1) or 1
    except (KeyError, TypeError):
        return 0.0
    cpu_d, sys_d = cur_cpu - prev_cpu, cur_sys - prev_sys
    if cpu_d <= 0 or sys_d <= 0:
        return 0.0
    return round(cpu_d / sys_d * online * 100.0, 2)


def _summarize_stats(cur: dict, prev: dict | None) -> dict:
    mem = cur.get("memory_stats", {})
    usage = mem.get("usage", 0) or 0
    limit = mem.get("limit", 0) or 0
    nets = cur.get("networks") or {}
    rx = sum(n.get("rx_bytes", 0) for n in nets.values())
    tx = sum(n.get("tx_bytes", 0) for n in nets.values())
    return {
        "cpu_pct": compute_cpu_pct(cur, prev),
        "mem_mb": round(usage / 1048576, 1),
        "mem_pct": round(usage / limit * 100.0, 1) if limit else 0.0,
        "rx_kb": round(rx / 1024, 1),
        "tx_kb": round(tx / 1024, 1),
    }


# ── supervised loops ────────────────────────────────────────────────────

async def run_docker_events(bus: Bus) -> None:
    docker = aiodocker.Docker(url=settings.docker_host)
    try:
        subscriber = docker.events.subscribe(
            filters={"label": [f"{_LABEL_PROJECT}={settings.compose_project}"]}
        )
        logger.info("docker events subscribed via %s", settings.docker_host)
        while True:
            ev = await subscriber.get()
            if ev is None:                      # stream closed — let supervisor restart us
                raise ConnectionError("docker event stream closed")
            out = translate_event(ev, settings.compose_project)
            if out:
                type_, service, payload = out
                await bus.emit(type=type_, service=service, payload=payload)
    finally:
        await docker.close()


async def run_docker_poll(bus: Bus) -> None:
    docker = aiodocker.Docker(url=settings.docker_host)
    prev_samples: dict[str, dict] = {}
    tick = 0
    try:
        while True:
            containers = await docker.containers.list(
                all=True,
                filters={"label": [f"{_LABEL_PROJECT}={settings.compose_project}"]},
            )
            raw = [c._container for c in containers]

            if tick % _RESYNC_EVERY_TICKS == 0:
                await bus.emit(type="docker.containers", service="docker",
                               payload=summarize_containers(raw, settings.compose_project))

            stats: dict[str, dict] = {}
            for c in containers:
                info = c._container
                if info.get("State") != "running":
                    continue
                name = (info.get("Names") or ["/?"])[0].lstrip("/")
                try:
                    sample_list = await c.stats(stream=False)
                    sample = sample_list[0] if isinstance(sample_list, list) else sample_list
                except Exception:  # noqa: BLE001 — container may vanish mid-poll
                    continue
                stats[name] = _summarize_stats(sample, prev_samples.get(name))
                prev_samples[name] = sample
            if stats:
                await bus.emit(type="docker.stats", service="docker",
                               payload={"stats": stats})

            tick += 1
            await asyncio.sleep(1.0)
    finally:
        await docker.close()
