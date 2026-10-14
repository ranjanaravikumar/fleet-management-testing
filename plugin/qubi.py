"""
qubi.py — starts Flow 1 in Qubi by calling its trigger's callback URL.

Same body the agent-integrated TMS sent, so Flow 1 needs no changes:

    {"event": "case.created" | "case.customer_replied", "case_id": "CASE-1002", "case": {...}}

with the secret in the X-Trigger-Secret header. Without QUBI_WEBHOOK_URL,
Flow 1 can poll GET /api/cases?status=new,customer_replied instead.
"""
import json
import urllib.request
from collections import deque

from plugin import config
from plugin.clock import stamp

_deliveries: deque = deque(maxlen=20)   # recent attempts, for GET /api/cases/webhook-status


def notify(event: str, case: dict) -> None:
    """Tell Qubi about a case event. Never raises."""
    if not config.QUBI_WEBHOOK_URL:
        return
    body = json.dumps({"event": event, "case_id": case["id"], "case": case}).encode()
    req = urllib.request.Request(config.QUBI_WEBHOOK_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Trigger-Secret": config.QUBI_TRIGGER_SECRET})
    attempt = {"at": stamp(), "event": event, "case_id": case["id"], "channel": case.get("channel")}
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            attempt["result"] = f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001 — record any failure, never raise
        attempt["result"] = f"failed: {e}"
    _deliveries.appendleft(attempt)
    print(f"[qubi webhook] {attempt}")


def status() -> dict:
    return {"configured": bool(config.QUBI_WEBHOOK_URL), "url": config.QUBI_WEBHOOK_URL or None,
            "secret_set": bool(config.QUBI_TRIGGER_SECRET), "recent": list(_deliveries)}
