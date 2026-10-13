"""App lock: one counsellor password (bcrypt) and a signed, http-only login cookie."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

import bcrypt

from . import prefs

COOKIE = "verbatim_auth"
LIFETIME_SEC = 12 * 3600  # stay signed in for a working day
MIN_PASSWORD = 8


def has_password() -> bool:
    return prefs.load().password_hash is not None


def set_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"Use at least {MIN_PASSWORD} characters.")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    # A new secret also signs out every existing login.
    prefs.update(password_hash=hashed, secret=secrets.token_hex(32))


def check_password(password: str) -> bool:
    stored = prefs.load().password_hash
    if not stored:
        return False
    return bcrypt.checkpw(password.encode(), stored.encode())


def _sign(payload: str) -> str:
    return hmac.new(prefs.load().secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    payload = f"{int(time.time()) + LIFETIME_SEC}.{secrets.token_hex(8)}"
    return f"{payload}.{_sign(payload)}"


def token_valid(token: str | None) -> bool:
    if not token or token.count(".") != 2:
        return False
    expires, nonce, sig = token.split(".")
    if not hmac.compare_digest(sig, _sign(f"{expires}.{nonce}")):
        return False
    try:
        return int(expires) > time.time()
    except ValueError:
        return False
