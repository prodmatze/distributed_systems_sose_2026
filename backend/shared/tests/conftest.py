"""Test environment for the shared package.

``shared.settings`` instantiates ``Settings()`` eagerly at import time, which
requires ``DATABASE_URL``, ``REDIS_URL`` and ``JWT_SECRET`` to be present. Set
harmless offline values before any test module imports ``shared.*``. These
tests never open a network connection — the URLs are placeholders only.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
# ≥64 bytes so pyjwt raises no InsecureKeyLengthWarning, even for HS512
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-" + "x" * 33)
