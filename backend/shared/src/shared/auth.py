from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from shared.settings import settings
import jwt

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

def hash_password(pwd_cleartext:str) -> str:
    pwd_hashed = pwd_context.hash(pwd_cleartext)
    return pwd_hashed

def verify_password(user_input:str, pwd_hashed:str) -> bool:
    is_match = pwd_context.verify(user_input, pwd_hashed)
    return is_match

"""
A jwt(json-web-token) consists of 3 base64-encoded pieces, joined by dots:
header.payload.signature

header = which algorithm signed this? (for us: HS256)

payload = the claim - small json object with whatever you want to store. typically:
        - sub (subject=user id)
        - exp(expiry timestamp)
        - iat(issued-at)

signature = HMAC_SHA256(header + "." + payload, SECRET)... anyone with secret can verify the signature, noone without the secret can generate a valid signature
"""
def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': str(user_id),
        'iat': now,
        'exp': now + timedelta(minutes=settings.jwt_expiry_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
