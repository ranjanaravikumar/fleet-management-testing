"""
cases.py — customer cases: one queue of requests, whatever channel they came in on.

  Portal (customer, no key):   /api/portal/...   open a case, reply in a case
  Agent and ops (X-API-Key):   /api/cases/...    claim, reply, change status
  Anyone may read:             GET /api/cases, GET /api/cases/{id}

When a case is opened, or a customer replies, the TMS can notify Qubi straight
away by calling a Qubi trigger's callback URL (set QUBI_WEBHOOK_URL and
QUBI_TRIGGER_SECRET). Without those settings, Qubi can poll GET /api/cases?status=new.
"""
import json
import os
import urllib.request
from collections import deque
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from backend.tms import checks
from backend.tms.auth import require_api_key
from backend.tms.db import get_db, iso, now, stamp

portal = APIRouter(prefix="/api/portal", tags=["Customer portal"])
cases = APIRouter(prefix="/api/cases", tags=["Cases"])

AGENT = "SMART API Agent"
QUBI_WEBHOOK_URL = os.environ.get("QUBI_WEBHOOK_URL", "").strip()
QUBI_TRIGGER_SECRET = os.environ.get("QUBI_TRIGGER_SECRET", "").strip()

CATEGORIES = {
    "status_update":   "Where is my shipment?",
    "truck_number":    "Need the truck number",
    "change_request":  "Change a delivery detail",
    "quote_question":  "Question about my quote",
    "other":           "Something else",
}
Category = Literal["status_update", "truck_number", "change_request", "quote_question", "other"]
Status = Literal["new", "customer_replied", "in_progress", "awaiting_carrier", "awaiting_customer",
                 "needs_human", "resolved"]
OPEN = ("new", "customer_replied", "in_progress", "awaiting_carrier", "awaiting_customer", "needs_human")
# Statuses the agent picks up: a brand-new case, or one where the customer answered the agent.
READY_FOR_AGENT = ("new", "customer_replied")

# What the customer sees for each status.
CUSTOMER_STATUS = {
    "new": "We're looking into it",
    "customer_replied": "We're looking into it",
    "in_progress": "We're looking into it",
    "awaiting_carrier": "Checking with the carrier",
    "awaiting_customer": "Waiting for your reply",
    "needs_human": "Our operations team is on it",
    "resolved": "Resolved",
}
# Case status -> agent_status on the shipment or order (shown in the ops console).
MIRROR = {"awaiting_carrier": "awaiting_carrier", "awaiting_customer": "awaiting_customer",
          "needs_human": "needs_human"}

_deliveries: deque = deque(maxlen=20)   # recent webhook attempts, for GET /api/cases/webhook-status


# ── helpers ──────────────────────────────────────────────────────────

def _row(conn, sql, *args):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def _rows(conn, sql, *args):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def _note(conn, entity_type, entity_id, action, message, source_ref=None, author=AGENT):
    conn.execute(
        "INSERT INTO notes (entity_type, entity_id, author, action, message, source_ref, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (entity_type, entity_id, author, action, message, source_ref, stamp()),
    )


def _next_id(conn) -> str:
    n = conn.execute("SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) FROM cases").fetchone()[0]
    return f"CASE-{(n or 1000) + 1}"


def _messages(conn, case_id):
    out = []
    for m in _rows(conn, "SELECT * FROM case_messages WHERE case_id = ? ORDER BY id", case_id):
        m["form"] = json.loads(m["form"]) if m["form"] else None
        m["form_response"] = json.loads(m["form_response"]) if m["form_response"] else None
        out.append(m)
    return out


def _case(conn, case_id) -> dict:
    c = _row(conn, "SELECT * FROM cases WHERE id = ?", case_id)
    if not c:
        raise HTTPException(404, f"Case {case_id} not found.")
    c["category_label"] = CATEGORIES.get(c["category"], c["category"])
    c["customer_status"] = CUSTOMER_STATUS[c["status"]]
    c["customer_name"] = (_row(conn, "SELECT name FROM customers WHERE code = ?", c["customer_code"]) or {}).get("name")
    c["messages"] = _messages(conn, case_id)
    c["record_type"] = "shipment" if c["shipment_id"] else "order"
    c["record_id"] = c["shipment_id"] or c["order_id"]
    answers = [m["form_response"] for m in c["messages"] if m["author_type"] == "customer" and m["form_response"]]
    c["latest_form_response"] = answers[-1] if answers else None
    return c


def _entity(c) -> tuple[str, str]:
    return ("shipment", c["shipment_id"]) if c["shipment_id"] else ("order", c["order_id"])


def _add_message(conn, case_id, author_type, author_name, body, form=None, form_response=None):
    conn.execute(
        "INSERT INTO case_messages (case_id, author_type, author_name, body, form, form_response, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (case_id, author_type, author_name, body,
         json.dumps(form) if form else None, json.dumps(form_response) if form_response else None, stamp()),
    )
    conn.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (stamp(), case_id))


def _set_status(conn, c: dict, status: str, reason: str | None):
    resolved_at = stamp() if status == "resolved" else None
    conn.execute("UPDATE cases SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
                 (status, stamp(), resolved_at, c["id"]))
    table, ent_id = ("shipments", c["shipment_id"]) if c["shipment_id"] else ("orders", c["order_id"])
    conn.execute(f"UPDATE {table} SET agent_status = ? WHERE id = ?", (MIRROR.get(status), ent_id))
    kind, _ = _entity(c)
    _note(conn, kind, ent_id, "case_status",
          f"{c['id']}: {status.replace('_', ' ')}" + (f". {reason}" if reason else ""), c["subject"])


def _notify_qubi(event: str, case: dict):
    """Tell Qubi about a case event. Runs after the response is sent; never blocks the customer."""
    if not QUBI_WEBHOOK_URL:
        return
    body = json.dumps({"event": event, "case_id": case["id"], "case": case}).encode()
    req = urllib.request.Request(QUBI_WEBHOOK_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Trigger-Secret": QUBI_TRIGGER_SECRET})
    attempt = {"at": stamp(), "event": event, "case_id": case["id"]}
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            attempt["result"] = f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001 — record any failure, never raise
        attempt["result"] = f"failed: {e}"
    _deliveries.appendleft(attempt)
    print(f"[qubi webhook] {attempt}")


def _alert_for(check: dict) -> str | None:
    """Customer-facing wording for a problem the TMS can see on its own."""
    codes = {o["code"] for o in check["overdue_milestones"]}
    if codes & {"ARRCONSIGNEE", "DELV"}:
        return "Delivery not confirmed yet"
    if codes & {"ARRSHIP", "PICK"}:
        return "Pickup not confirmed yet"
    return None


def _open_case_summary(conn, field, value):
    c = _row(conn, f"SELECT id, category, status, updated_at FROM cases WHERE {field} = ? "
                   f"AND status IN {OPEN} ORDER BY updated_at DESC LIMIT 1", value)
    if c:
        c["customer_status"] = CUSTOMER_STATUS[c["status"]]
        c["category_label"] = CATEGORIES.get(c["category"], c["category"])
    return c


def _create_case(conn, *, customer_code, shipment_id, order_id, channel, category,
                 message, subject=None, sender_email=None, external_ref=None, author_name=None):
    if bool(shipment_id) == bool(order_id):
        raise HTTPException(422, "Give exactly one of shipment_id or order_id.")
    if shipment_id:
        rec = _row(conn, "SELECT id, customer_code FROM shipments WHERE id = ?", shipment_id)
    else:
        rec = _row(conn, "SELECT id, customer_code FROM orders WHERE id = ?", order_id)
    if not rec:
        raise HTTPException(404, f"{shipment_id or order_id} not found.")
    if customer_code and rec["customer_code"] != customer_code:
        raise HTTPException(403, f"{rec['id']} does not belong to customer {customer_code}.")
    customer_code = rec["customer_code"]

    # One open case per record and topic: a second click returns the same case.
    field, value = ("shipment_id", shipment_id) if shipment_id else ("order_id", order_id)
    existing = _row(conn, f"SELECT id FROM cases WHERE {field} = ? AND category = ? AND status IN {OPEN}",
                    value, category)
    if existing:
        return existing["id"], False

    case_id = _next_id(conn)
    subject = subject or f"{CATEGORIES[category]} ({rec['id']})"
    t = stamp()
    conn.execute(
        "INSERT INTO cases (id, customer_code, shipment_id, order_id, channel, category, subject, status, "
        "sender_email, external_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (case_id, customer_code, shipment_id, order_id, channel, category, subject, "new",
         sender_email, external_ref, t, t),
    )
    contact = _row(conn, "SELECT contact FROM customers WHERE code = ?", customer_code)
    _add_message(conn, case_id, "customer", author_name or (contact or {}).get("contact") or "Customer",
                 message or CATEGORIES[category])
    _add_message(conn, case_id, "system", "TruckerPath",
                 f"Case {case_id} opened. Our team is on it; updates will appear here.")
    kind = "shipment" if shipment_id else "order"
    _note(conn, kind, rec["id"], "case_opened",
          f"Customer opened {case_id} via {channel}: {CATEGORIES[category]}"
          + (f" ({message})" if message else ""), subject,
          author=(contact or {}).get("contact") or "Customer")
    return case_id, True


# ── portal (customer) ────────────────────────────────────────────────

@portal.get("/shipments", summary="A customer's shipments, with alerts and open cases")
def portal_shipments(customer_code: str = "NFAS"):
    conn = get_db()
    try:
        out = []
        for s in _rows(conn, "SELECT * FROM shipments WHERE customer_code = ? "
                             "ORDER BY pickup_appt_start DESC", customer_code):
            ms = _rows(conn, "SELECT * FROM milestones WHERE shipment_id = ? ORDER BY event_time, id", s["id"])
            alert = None
            if s["status"] != "Delivered":
                customer = _row(conn, "SELECT * FROM customers WHERE code = ?", s["customer_code"])
                alert = _alert_for(checks.check_shipment(s, ms, customer, None, None, None))
            out.append({**s, "milestones": ms, "alert": alert,
                        "open_case": _open_case_summary(conn, "shipment_id", s["id"])})
        return out
    finally:
        conn.close()


PORTAL_ORDER_COUNT = 12
FEATURED_ORDERS = ["SHP45342"]   # always shown: the Act 4 order


@portal.get("/orders", summary="A customer's recent orders and quote status")
def portal_orders(customer_code: str = "NFAS"):
    conn = get_db()
    try:
        rows = _rows(conn, "SELECT * FROM orders WHERE customer_code = ? ORDER BY created_at DESC",
                     customer_code)
        featured = [o for o in rows if o["id"] in FEATURED_ORDERS]
        recent = [o for o in rows if o["id"] not in FEATURED_ORDERS][:PORTAL_ORDER_COUNT - len(featured)]
        out = []
        for o in featured + recent:
            amount = checks._num(o["quote"]) if (o["quote"] or "").strip() else None
            out.append({**o, "quote_status": f"Quoted ${amount:,.2f}" if amount is not None else "Quote pending",
                        "open_case": _open_case_summary(conn, "order_id", o["id"])})
        return out
    finally:
        conn.close()


class PortalCaseIn(BaseModel):
    customer_code: str = "NFAS"
    shipment_id: Optional[str] = None
    order_id: Optional[str] = None
    category: Category
    message: Optional[str] = Field(None, max_length=2000)


@portal.post("/cases", status_code=201, summary="Customer opens a case from the portal")
def portal_open_case(body: PortalCaseIn, background: BackgroundTasks, response: Response):
    conn = get_db()
    try:
        case_id, created = _create_case(
            conn, customer_code=body.customer_code, shipment_id=body.shipment_id,
            order_id=body.order_id, channel="portal", category=body.category,
            message=(body.message or "").strip() or None)
        conn.commit()
        c = _case(conn, case_id)
    finally:
        conn.close()
    if created:
        background.add_task(_notify_qubi, "case.created", c)
    else:
        response.status_code = 200   # an open case on this topic already exists
    return {**c, "existing": not created}


class PortalReplyIn(BaseModel):
    body: str = Field("", max_length=2000)
    form_response: Optional[dict] = None


@portal.post("/cases/{case_id}/messages", status_code=201, summary="Customer replies in a case")
def portal_reply(case_id: str, body: PortalReplyIn, background: BackgroundTasks):
    if not body.body.strip() and not body.form_response:
        raise HTTPException(422, "Write a message or fill in the form.")
    conn = get_db()
    try:
        c = _case(conn, case_id)
        if c["status"] == "resolved":
            raise HTTPException(409, f"{case_id} is resolved. Open a new case instead.")
        contact = _row(conn, "SELECT contact FROM customers WHERE code = ?", c["customer_code"])
        text = body.body.strip() or "; ".join(f"{k}: {v}" for k, v in body.form_response.items())
        _add_message(conn, case_id, "customer", (contact or {}).get("contact") or "Customer",
                     text, form_response=body.form_response)
        if c["status"] == "awaiting_customer":
            # Hand the case back to the agent: it fetches new and customer_replied cases.
            _set_status(conn, c, "customer_replied", "Customer replied")
        kind, ent_id = _entity(c)
        _note(conn, kind, ent_id, "customer_replied", f"Customer replied in {case_id}: {text}", c["subject"],
              author=(contact or {}).get("contact") or "Customer")
        conn.commit()
        c = _case(conn, case_id)
    finally:
        conn.close()
    background.add_task(_notify_qubi, "case.customer_replied", c)
    return c


# ── cases (read for all; write for agent and ops) ────────────────────

@cases.get("", summary="Cases, newest first, filtered by status or record")
def list_cases(status: Optional[str] = Query(None, description="A status, several separated by commas "
                                            "(e.g. new,customer_replied), or 'open' for all unresolved"),
               shipment_id: Optional[str] = None, order_id: Optional[str] = None,
               customer_code: Optional[str] = None, limit: int = Query(50, le=200)):
    sql, args = "SELECT id FROM cases WHERE 1=1", []
    if status == "open":
        sql += f" AND status IN {OPEN}"
    elif status:
        wanted = [x.strip() for x in status.split(",") if x.strip()]
        sql += f" AND status IN ({', '.join('?' for _ in wanted)})"
        args += wanted
    for field, value in (("shipment_id", shipment_id), ("order_id", order_id), ("customer_code", customer_code)):
        if value:
            sql, args = sql + f" AND {field} = ?", args + [value]
    conn = get_db()
    try:
        ids = [r["id"] for r in _rows(conn, sql + " ORDER BY created_at DESC LIMIT ?", *args, limit)]
        return [_case(conn, i) for i in ids]
    finally:
        conn.close()


@cases.get("/webhook-status", summary="Is the Qubi webhook set up, and what happened recently?")
def webhook_status():
    return {"configured": bool(QUBI_WEBHOOK_URL), "url": QUBI_WEBHOOK_URL or None,
            "secret_set": bool(QUBI_TRIGGER_SECRET), "recent": list(_deliveries)}


@cases.get("/{case_id}", summary="One case with its conversation")
def get_case(case_id: str):
    conn = get_db()
    try:
        return _case(conn, case_id)
    finally:
        conn.close()


class CaseIn(BaseModel):
    customer_code: Optional[str] = None
    shipment_id: Optional[str] = None
    order_id: Optional[str] = None
    channel: Literal["portal", "email", "phone"] = "email"
    category: Category
    message: str = Field(..., max_length=5000)
    subject: Optional[str] = None
    sender_email: Optional[str] = None
    external_ref: Optional[str] = Field(None, description="Email message ID, for threading replies")
    author_name: Optional[str] = None


@cases.post("", status_code=201, dependencies=[Depends(require_api_key)],
            summary="Open a case from any channel (e.g. a Qubi email-intake workflow)")
def open_case(body: CaseIn, background: BackgroundTasks, response: Response):
    conn = get_db()
    try:
        case_id, created = _create_case(
            conn, customer_code=body.customer_code, shipment_id=body.shipment_id,
            order_id=body.order_id, channel=body.channel, category=body.category,
            message=body.message, subject=body.subject, sender_email=body.sender_email,
            external_ref=body.external_ref, author_name=body.author_name)
        conn.commit()
        c = _case(conn, case_id)
    finally:
        conn.close()
    if created:
        background.add_task(_notify_qubi, "case.created", c)
    else:
        response.status_code = 200   # an open case on this topic already exists
    return {**c, "existing": not created}


@cases.post("/{case_id}/claim", dependencies=[Depends(require_api_key)],
            summary="Take a case so no one else works it (new or customer_replied → in_progress)")
def claim_case(case_id: str):
    conn = get_db()
    try:
        cur = conn.execute("UPDATE cases SET status = 'in_progress', updated_at = ? "
                           f"WHERE id = ? AND status IN {READY_FOR_AGENT}", (stamp(), case_id))
        if cur.rowcount == 0:
            c = _case(conn, case_id)
            raise HTTPException(409, f"{case_id} is already {c['status'].replace('_', ' ')}.")
        conn.commit()
        return _case(conn, case_id)
    finally:
        conn.close()


class MessageIn(BaseModel):
    author_type: Literal["agent", "ops", "system"] = "agent"
    author_name: Optional[str] = None
    body: str = Field(..., max_length=5000)
    form: Optional[dict] = Field(None, description='Ask the customer to fill in fields, e.g. '
                                 '{"fields": [{"name": "pallets", "label": "Number of pallets"}]}')
    status: Optional[Status] = Field(None, description="Optionally change the case status in the same call")


@cases.post("/{case_id}/messages", status_code=201, dependencies=[Depends(require_api_key)],
            summary="Agent or ops writes in a case (shown to the customer in the portal)")
def add_message(case_id: str, body: MessageIn):
    conn = get_db()
    try:
        c = _case(conn, case_id)
        name = body.author_name or {"agent": "TruckerPath Support", "ops": "TruckerPath Operations",
                                    "system": "TruckerPath"}[body.author_type]
        _add_message(conn, case_id, body.author_type, name, body.body, form=body.form)
        kind, ent_id = _entity(c)
        _note(conn, kind, ent_id, "replied_customer", f"Replied in {case_id}: {body.body}", c["subject"],
              author=AGENT if body.author_type == "agent" else name)
        if body.status and body.status != c["status"]:
            _set_status(conn, c, body.status, None)
        conn.commit()
        return _case(conn, case_id)
    finally:
        conn.close()


class CaseUpdate(BaseModel):
    status: Status
    reason: Optional[str] = None


@cases.patch("/{case_id}", dependencies=[Depends(require_api_key)],
             summary="Change a case's status (also updates the shipment or order)")
def update_case(case_id: str, body: CaseUpdate):
    conn = get_db()
    try:
        c = _case(conn, case_id)
        if body.status != c["status"]:
            _set_status(conn, c, body.status, body.reason)
            conn.commit()
        return _case(conn, case_id)
    finally:
        conn.close()
