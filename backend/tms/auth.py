"""
auth.py — API key for endpoints that change data.

Reading is open so the TMS web pages can poll without a secret.
Anything that writes (PATCH, POST) needs the header:  X-API-Key: <TMS_API_KEY>
"""
import os
import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

API_KEY = os.environ.get("TMS_API_KEY", "dev-key-change-me")

_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(key: str | None = Security(_header)) -> None:
    if not key or not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=401, detail="Missing or wrong X-API-Key header.")
