"""
tms_client.py — the plugin's only way into the TMS: its normal HTTP API.
"""
import httpx
from fastapi import HTTPException

from plugin import config

_client = httpx.Client(base_url=config.TMS_URL, timeout=10.0,
                       headers={"ngrok-skip-browser-warning": "1"})


def _check(r: httpx.Response):
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except ValueError:
            detail = r.text
        # Pass the TMS's own status and reason straight back to the caller.
        raise HTTPException(r.status_code, detail)
    return r.json()


def get(path: str, **params):
    try:
        return _check(_client.get(path, params={k: v for k, v in params.items() if v is not None}))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Can't reach the TMS at {config.TMS_URL}: {e}") from e


def write(method: str, path: str, body: dict | None = None, **params):
    try:
        return _check(_client.request(method, path, json=body, params=params or None,
                                      headers={"X-API-Key": config.TMS_API_KEY}))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Can't reach the TMS at {config.TMS_URL}: {e}") from e


def raw(method: str, path: str, *, params, headers: dict, content: bytes) -> httpx.Response:
    """Forward a request unchanged (used by the pass-through routes)."""
    return _client.request(method, path, params=params, headers=headers, content=content)


# ── Convenience calls ────────────────────────────────────────────────

def shipment(shipment_id: str) -> dict:
    return get(f"/api/shipments/{shipment_id}")


def active_shipments() -> list[dict]:
    return get("/api/shipments", status="active")


def order(order_id: str) -> dict:
    return get(f"/api/orders/{order_id}")


def all_orders() -> list[dict]:
    items, offset = [], 0
    while True:
        page = get("/api/orders", limit=500, offset=offset)
        items += page["items"]
        offset += len(page["items"])
        if not page["items"] or offset >= page["total"]:
            return items


def customer(code: str) -> dict | None:
    try:
        return get(f"/api/customers/{code}")
    except HTTPException as e:
        if e.status_code == 404:
            return None
        raise


def add_note(entity_type: str, entity_id: str, message: str, *, action: str = "note",
             visibility: str = "internal", author: str = config.AGENT_NAME,
             author_type: str = "integration", source_ref: str | None = None) -> dict:
    return write("POST", "/api/notes", {
        "entity_type": entity_type, "entity_id": entity_id, "message": message, "action": action,
        "visibility": visibility, "author": author, "author_type": author_type, "source_ref": source_ref})


def update_shipment(shipment_id: str, changes: dict, reason: str, source_ref: str | None = None) -> dict:
    return write("PATCH", f"/api/shipments/{shipment_id}",
                 {**changes, "reason": reason, "source_ref": source_ref, "author": config.AGENT_NAME})


def update_order(order_id: str, changes: dict, reason: str, source_ref: str | None = None,
                 author: str = config.AGENT_NAME) -> dict:
    return write("PATCH", f"/api/orders/{order_id}",
                 {**changes, "reason": reason, "source_ref": source_ref, "author": author})


def customer_notes_after(note_id: int, limit: int = 100) -> list[dict]:
    return get("/api/notes", author_type="customer", after_id=note_id, order="asc", limit=limit)


def latest_note_id() -> int:
    notes = get("/api/notes", limit=1)
    return notes[0]["id"] if notes else 0
