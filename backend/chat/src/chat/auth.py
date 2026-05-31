"""WebSocket authentication.

Browsers cannot set an ``Authorization`` header on the WebSocket handshake, so
the JWT is passed as the ``token`` query parameter: ``/ws?token=<jwt>``.

Tradeoff: query-string tokens can land in proxy/access logs. Acceptable for the
course demo. The leak-free alternative is a first-message auth handshake
(client sends ``{"type":"auth","token":...}`` on an otherwise-anonymous socket);
worth doing in V2 if log hygiene matters.
"""

import logging

from shared.auth import decode_access_token

logger = logging.getLogger("chat.auth")


def verify_token(token: str | None) -> int | None:
    """Return the authenticated user id, or ``None`` if the token is missing,
    malformed, expired, or signed with the wrong key."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        return int(payload["sub"])
    except Exception:  # noqa: BLE001 — any decode failure is an auth failure
        logger.debug("token verification failed", exc_info=True)
        return None
