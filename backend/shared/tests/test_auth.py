"""Unit tests for the auth helpers: bcrypt password hashing + HS256 JWTs.

Offline — no Postgres, no Redis. The JWT secret comes from the test env set in
``conftest.py``. Every service trusts these helpers (auth issues tokens, api and
chat verify them on every request/handshake), so regressions here break login
across the whole system.
"""

from datetime import datetime, timezone

import jwt
import pytest

from shared.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from shared.settings import settings


# --- passwords ---------------------------------------------------------------

def test_password_roundtrip():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)


def test_wrong_password_rejected():
    hashed = hash_password("correct horse battery staple")
    assert not verify_password("Tr0ub4dor&3", hashed)


def test_same_password_hashes_differently():
    # bcrypt salts every hash — equal inputs must not produce equal hashes
    assert hash_password("hunter2") != hash_password("hunter2")


# --- tokens ------------------------------------------------------------------

def test_token_roundtrip_carries_user_id():
    payload = decode_access_token(create_access_token(42))
    assert payload["sub"] == "42"


def test_token_expiry_matches_settings():
    payload = decode_access_token(create_access_token(1))
    assert payload["exp"] - payload["iat"] == settings.jwt_expiry_minutes * 60
    assert payload["iat"] <= datetime.now(timezone.utc).timestamp()


def test_expired_token_rejected(monkeypatch):
    monkeypatch.setattr(settings, "jwt_expiry_minutes", -1)
    token = create_access_token(1)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)


def test_tampered_signature_rejected():
    token = create_access_token(1)
    header, payload, signature = token.split(".")
    forged = f"{header}.{payload}.{signature[:-2]}xx"
    with pytest.raises(jwt.InvalidSignatureError):
        decode_access_token(forged)


def test_token_signed_with_other_secret_rejected():
    stranger = jwt.encode({"sub": "1"}, "not-our-secret-" + "y" * 49, algorithm=settings.jwt_algorithm)
    with pytest.raises(jwt.InvalidSignatureError):
        decode_access_token(stranger)


def test_algorithm_confusion_rejected():
    # decode must pin the allowed algorithms, not trust the token header
    hs512 = jwt.encode({"sub": "1"}, settings.jwt_secret, algorithm="HS512")
    with pytest.raises(jwt.InvalidAlgorithmError):
        decode_access_token(hs512)
