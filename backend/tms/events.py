"""
events.py — outbound events: the TMS tells a subscriber when something happens.

Like the webhooks most TMS products offer. One subscriber URL, set with
TMS_EVENTS_URL (the plugin's /events/tms endpoint). Each delivery is a POST:

    {"event": "order.submitted", "sent_at": "...", "data": {...}}

with the shared secret in the X-Event-Secret header (TMS_EVENTS_SECRET).
Without TMS_EVENTS_URL nothing is sent.
"""
import json
import os
import urllib.request
from collections import deque

from backend.tms.db import stamp

EVENTS_URL = os.environ.get("TMS_EVENTS_URL", "").strip()
EVENTS_SECRET = os.environ.get("TMS_EVENTS_SECRET", "").strip()

_deliveries: deque = deque(maxlen=20)   # recent attempts, for GET /api/events/status


def send(event: str, data: dict) -> None:
    """Deliver one event. Never raises: a subscriber being down must not break the TMS."""
    if not EVENTS_URL:
        return
    body = json.dumps({"event": event, "sent_at": stamp(), "data": data}).encode()
    req = urllib.request.Request(EVENTS_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Event-Secret": EVENTS_SECRET,
        "ngrok-skip-browser-warning": "1"})
    attempt = {"at": stamp(), "event": event, "ref": data.get("order_id") or data.get("shipment_id")}
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            attempt["result"] = f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001 — record any failure, never raise
        attempt["result"] = f"failed: {e}"
    _deliveries.appendleft(attempt)
    print(f"[tms event] {attempt}")


def status() -> dict:
    return {"configured": bool(EVENTS_URL), "url": EVENTS_URL or None,
            "secret_set": bool(EVENTS_SECRET), "recent": list(_deliveries)}
