"""
auth.py — API key for plugin endpoints that change data (X-API-Key: <PLUGIN_API_KEY>).
"""
import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from plugin import config

_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(key: str | None = Security(_header)) -> None:
    if not key or not secrets.compare_digest(key, config.PLUGIN_API_KEY):
        raise HTTPException(status_code=401, detail="Missing or wrong X-API-Key header.")
