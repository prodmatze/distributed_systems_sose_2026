"""Gateway request feed: tail nginx's JSON access log via the docker logs API.

Zero app code involved — nginx already sees every request, we just read its
stdout through the same socket-proxy the docker producer uses. $request_id is
the correlation id; PR #37's named replicas mean $upstream_addr attributes
each /ws request to a specific chat replica for free.
"""

import json
import logging

import aiodocker

from observer.bus import Bus
from observer.settings import settings

logger = logging.getLogger("observer.producers.nginx_log")


def parse_line(line: str) -> tuple[str, str, dict, str | None] | None:
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        rec = json.loads(line)
        uri = rec["uri"]
        payload = {
            "method": rec["method"],
            "uri": uri,
            "status": int(rec["status"]),
            "rt_ms": round(float(rec["rt"]) * 1000, 1),
            "upstream": rec.get("upstream", ""),
            "remote": rec.get("remote", ""),
        }
    except (ValueError, TypeError, KeyError):
        return None

    if uri.startswith("/auth"):
        service = "auth"
    elif uri.startswith("/api"):
        service = "api"
    elif uri.startswith("/ws"):
        service = "chat"
    else:
        service = "gateway"
    return "http.request", service, payload, rec.get("request_id")


async def run_nginx_log(bus: Bus) -> None:
    docker = aiodocker.Docker(url=settings.docker_host)
    try:
        container = await docker.containers.get(settings.gateway_container)
        logger.info("tailing %s access log", settings.gateway_container)
        async for line in container.log(stdout=True, stderr=False, follow=True, tail=0):
            out = parse_line(line)
            if out is None:
                continue
            type_, service, payload, corr = out
            await bus.emit(type=type_, service=service, payload=payload, corr=corr)
        raise ConnectionError("gateway log stream ended")   # supervisor restarts
    finally:
        await docker.close()
