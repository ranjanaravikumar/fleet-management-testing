"""
cases.py — cases: the plugin's queue of things for Flow 1 to work on.

A case starts from one of three places, and each one starts Flow 1:
  - a customer request: POST /api/customer-requests, a customer note in the TMS,
    or the older POST /api/portal/cases / POST /api/cases
  - the detector finding a new problem on an active shipment (channel "monitor")
  - the TMS reporting a submitted order (category "new_order")

The case API is the one Flow 1 already calls (claim, messages, status), so
the flows only need their base URL changed. What the customer should see
is written into the TMS as a customer-visible note on the shipment or order;
customer replies come back the same way.
"""
import json
import re
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from plugin import config, qubi, tms_client
from plugin.auth import require_api_key
from plugin.clock import PHOENIX, parse, stamp
from plugin.store import get_db, row, rows, write_lock

cases = APIRouter(prefix="/api/cases", tags=["Cases (Flow 1)"])
portal = APIRouter(prefix="/api/portal/cases", tags=["Customer requests"])
requests_router = APIRouter(prefix="/api/customer-requests", tags=["Customer requests"])

CATEGORIES = {
    "status_update":   "Where is my shipment?",
    "truck_number":    "Need the truck number",
    "change_request":  "Change a delivery detail",
    "quote_question":  "Question about my quote",
    "other":           "Something else",
    "new_order":       "New order review",
}
Category = Literal["status_update", "truck_number", "change_request", "quote_question", "other", "new_order"]
Status = Literal["new", "customer_replied", "in_progress", "awaiting_carrier", "awaiting_customer",
                 "needs_human", "resolved"]
Channel = Literal["portal", "email", "phone", "chat", "monitor"]
OPEN = ("new", "customer_replied", "in_progress", "awaiting_carrier", "awaiting_customer", "needs_human")
# Statuses the agent picks up: a brand-new case, or one where the customer answered the agent.
READY_FOR_AGENT = ("new", "customer_replied")

# What the customer would be told for each status.
CUSTOMER_STATUS = {
    "new": "We're looking into it",
    "customer_replied": "We're looking into it",
    "in_progress": "We're looking into it",
    "awaiting_carrier": "Checking with the carrier",
    "awaiting_customer": "Waiting for your reply",
    "needs_human": "Our operations team is on it",
    "resolved": "Resolved",
}

# The notes watcher only reads notes a customer wrote themselves (action "note").
# It skips the TMS's automatic ones (e.g. "order_submitted") and the ones the
# plugin writes for the customer's side of a case ("case_request", "case_reply").
CUSTOMER_NOTE_ACTION = "note"

_customer_cache: dict[str, dict | None] = {}


def _notify(event: str, case: dict) -> None:
    """Hand a case event to whoever works it (Flow 1, or the plugin for order cases)."""
    from plugin import dispatch   # late import: dispatch imports this module
    dispatch.route(event, case)


# ── helpers ──────────────────────────────────────────────────────────

def _customer(code: str | None) -> dict | None:
    if not code:
        return None
    if code not in _customer_cache:
        _customer_cache[code] = tms_client.customer(code)
    return _customer_cache[code]


def _contact(code: str | None) -> str:
    return (_customer(code) or {}).get("contact") or "Customer"


def _next_id(conn) -> str:
    n = conn.execute("SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) FROM cases").fetchone()[0]
    return f"CASE-{(n or 1000) + 1}"


def _messages(conn, case_id):
    out = []
    for m in rows(conn, "SELECT * FROM case_messages WHERE case_id = ? ORDER BY id", case_id):
        m["form"] = json.loads(m["form"]) if m["form"] else None
        m["form_response"] = json.loads(m["form_response"]) if m["form_response"] else None
        out.append(m)
    return out


def load_case(conn, case_id) -> dict:
    c = row(conn, "SELECT * FROM cases WHERE id = ?", case_id)
    if not c:
        raise HTTPException(404, f"Case {case_id} not found.")
    c["category_label"] = CATEGORIES.get(c["category"], c["category"])
    c["customer_status"] = CUSTOMER_STATUS[c["status"]]
    c["customer_name"] = (_customer(c["customer_code"]) or {}).get("name")
    c["messages"] = _messages(conn, case_id)
    c["record_type"] = "shipment" if c["shipment_id"] else "order"
    c["record_id"] = c["shipment_id"] or c["order_id"]
    answers = [m["form_response"] for m in c["messages"] if m["author_type"] == "customer" and m["form_response"]]
    c["latest_form_response"] = answers[-1] if answers else None
    return c


def get_case(case_id: str) -> dict:
    conn = get_db()
    try:
        return load_case(conn, case_id)
    finally:
        conn.close()


def _entity(c) -> tuple[str, str]:
    return ("shipment", c["shipment_id"]) if c["shipment_id"] else ("order", c["order_id"])


def _insert_message(conn, case_id, author_type, author_name, body, form=None, form_response=None,
                    tms_note_id=None):
    conn.execute(
        "INSERT INTO case_messages (case_id, author_type, author_name, body, form, form_response, "
        "tms_note_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (case_id, author_type, author_name, body, json.dumps(form) if form else None,
         json.dumps(form_response) if form_response else None, tms_note_id, stamp()),
    )
    conn.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (stamp(), case_id))


def _note_text(body: str, form: dict | None) -> str:
    """The message as the customer reads it in the TMS Notes tab, with any questions spelled out."""
    if not form or not form.get("fields"):
        return body
    lines = "\n".join(f"{f['label']}: " for f in form["fields"])
    return f"{body}\n\nPlease add a note with:\n{lines}"


def post_to_customer(conn, c: dict, author_type: str, body: str, form=None, author_name=None):
    """Write an agent or ops message into the TMS (customer-visible note), then into the case."""
    name = author_name or {"agent": config.SUPPORT_NAME, "ops": config.OPS_NAME,
                           "system": "Qubiway"}[author_type]
    kind, ent_id = _entity(c)
    note = tms_client.add_note(kind, ent_id, _note_text(body, form), action="message", visibility="customer",
                               author=name, author_type="integration" if author_type == "agent" else "staff",
                               source_ref=c["id"])
    _insert_message(conn, c["id"], author_type, name, body, form=form, tms_note_id=note["id"])


def add_system_message(conn, case_id: str, body: str, author_name: str = "Qubiway") -> None:
    """A line in the case's own history (not shown to the customer)."""
    _insert_message(conn, case_id, "system", author_name, body)


# What a customer who asked is told when their case changes hands. Shipment cases only: order
# cases already get their own messages, and a case the detector found has no customer to tell.
CUSTOMER_ACK = {
    "needs_human": "Thanks. Our operations team is looking at this and will reply here.",
    "awaiting_carrier": "We're checking with the carrier and will update you here.",
}


def _when(iso_text: str | None) -> str:
    if not iso_text:
        return "not scheduled"
    return parse(iso_text).astimezone(PHOENIX).strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _change_brief(c: dict) -> str:
    """For operations: what the customer asked to change, and who the carrier is if it goes ahead.

    The agent never contacts the carrier about a change: a person decides first.
    """
    asked = next((m["body"] for m in c["messages"] if m["author_type"] == "customer"), None)
    try:
        s = tms_client.shipment(c["shipment_id"])
    except Exception:  # noqa: BLE001 — the brief is a courtesy; never block the handoff on it
        return ""
    carrier = s.get("carrier_name") or "no carrier recorded"
    if s.get("carrier_email"):
        carrier += f" <{s['carrier_email']}>"
    return (f" The customer asked: \"{asked}\"." if asked else "") + \
           f" Shipment {s['id']}: {s['origin']} to {s['destination']}, delivery window " \
           f"{_when(s.get('delivery_appt_start'))} to {_when(s.get('delivery_appt_end'))}. Carrier: {carrier}." \
           " Nothing has been changed or sent. If the change is agreed, the carrier is the next call."


def set_status(conn, c: dict, status: str, reason: str | None, notify: bool = True):
    """Change a case's status. Pass notify=False when the caller has just told the customer itself."""
    changed = status != c["status"]
    resolved_at = stamp() if status == "resolved" else None
    conn.execute("UPDATE cases SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
                 (status, stamp(), resolved_at, c["id"]))
    if status == "needs_human" and c["status"] != "needs_human":
        # Staff work in the TMS, so the handoff is left where they'll see it.
        kind, ent_id = _entity(c)
        brief = _change_brief(c) if c["category"] == "change_request" and c["shipment_id"] else ""
        tms_client.add_note(kind, ent_id,
                            f"Needs a person: {CATEGORIES.get(c['category'], c['category'])} ({c['id']})."
                            + (f" {reason}" if reason else "") + brief,
                            action="handoff", source_ref=c["id"])
    if notify and changed and status in CUSTOMER_ACK and c["shipment_id"] and c["channel"] != "monitor":
        post_to_customer(conn, c, "agent", CUSTOMER_ACK[status])


def _record(shipment_id: str | None, order_id: str | None) -> dict:
    if bool(shipment_id) == bool(order_id):
        raise HTTPException(422, "Give exactly one of shipment_id or order_id.")
    return tms_client.shipment(shipment_id) if shipment_id else tms_client.order(order_id)


def create_case(*, customer_code, shipment_id, order_id, channel, category, message,
                subject=None, sender_email=None, external_ref=None, author_name=None,
                author_type="customer", tms_note_id=None, record_note=False) -> tuple[str, bool]:
    """Open a case, or return the open one on the same record and topic. Returns (case_id, created)."""
    rec = _record(shipment_id, order_id)
    if customer_code and rec["customer_code"] != customer_code:
        raise HTTPException(403, f"{rec['id']} does not belong to customer {customer_code}.")
    customer_code = rec["customer_code"]
    field, value = ("shipment_id", shipment_id) if shipment_id else ("order_id", order_id)
    kind = "shipment" if shipment_id else "order"

    with write_lock:
        conn = get_db()
        try:
            # One open case per record and topic: a repeat request returns the same case.
            existing = row(conn, f"SELECT id FROM cases WHERE {field} = ? AND category = ? AND status IN {OPEN}",
                           value, category)
            if existing:
                return existing["id"], False

            if record_note and author_type == "customer":
                # A request from outside the TMS (email, phone, chat): keep it on the record too.
                note = tms_client.add_note(kind, rec["id"], message, action="case_request", visibility="customer",
                                           author=author_name or _contact(customer_code), author_type="customer",
                                           source_ref=external_ref or channel)
                tms_note_id = note["id"]

            case_id = _next_id(conn)
            subject = subject or f"{CATEGORIES[category]} ({rec['id']})"
            t = stamp()
            conn.execute(
                "INSERT INTO cases (id, customer_code, shipment_id, order_id, channel, category, subject, status, "
                "sender_email, external_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (case_id, customer_code, shipment_id, order_id, channel, category, subject, "new",
                 sender_email, external_ref, t, t),
            )
            name = author_name or (_contact(customer_code) if author_type == "customer" else "Qubiway")
            _insert_message(conn, case_id, author_type, name, message or CATEGORIES[category],
                            tms_note_id=tms_note_id)
            _insert_message(conn, case_id, "system", "Qubiway",
                            f"Case {case_id} opened. Our team is on it; updates will appear here.")
            conn.commit()
            return case_id, True
        finally:
            conn.close()


def customer_reply(case_id: str, text: str, form_response: dict | None = None,
                   tms_note_id: int | None = None) -> dict:
    """Add the customer's message to a case; hands it back to the agent if it was waiting on them."""
    with write_lock:
        conn = get_db()
        try:
            c = load_case(conn, case_id)
            if c["status"] == "resolved":
                raise HTTPException(409, f"{case_id} is resolved. Open a new request instead.")
            if tms_note_id is None:
                kind, ent_id = _entity(c)
                tms_note_id = tms_client.add_note(kind, ent_id, text, action="case_reply", visibility="customer",
                                                  author=_contact(c["customer_code"]), author_type="customer",
                                                  source_ref=case_id)["id"]
            _insert_message(conn, case_id, "customer", _contact(c["customer_code"]), text,
                            form_response=form_response, tms_note_id=tms_note_id)
            if c["status"] == "awaiting_customer":
                set_status(conn, c, "customer_replied", "Customer replied")
            conn.commit()
            return load_case(conn, case_id)
        finally:
            conn.close()


# ── Reading a customer's words ───────────────────────────────────────

_TOPIC_WORDS = [
    ("change_request", r"\b(change|reschedul\w*|instead|redirect|different (address|dock|time|day)|move the "
                       r"(appointment|delivery)|cancel\w*|deliver (it )?to)\b"),
    ("truck_number",   r"\b(truck\s*(number|no\.?|#|id)|which truck|driver('?s)? (name|number|phone)|"
                       r"who('?s| is) (driving|the driver))\b"),
    ("quote_question", r"\b(quote|quoted|price|pricing|rate|cost|how much|invoice)\b"),
    ("status_update",  r"\b(where|status|update|eta|arriv\w*|deliver\w*|when|track\w*|late|delay\w*)\b"),
]


def classify(text: str, record_type: str) -> str:
    """Pick the request topic from a customer's own words (the same topics the portal offered)."""
    t = text.lower()
    for category, pattern in _TOPIC_WORDS:
        if re.search(pattern, t):
            if category == "quote_question" and record_type == "shipment":
                continue
            return category
    return "other"


def parse_form_response(form: dict | None, text: str) -> dict | None:
    """Turn a free-text reply into answers for the fields the agent asked for.

    Understands 'Label: value' or 'name: value' lines, or, failing that, one
    answer per line or comma in the order the questions were asked.
    """
    if not form or not form.get("fields"):
        return None
    fields = form["fields"]
    by_key = {}
    for f in fields:
        by_key[f["name"].lower()] = f["name"]
        by_key[f["label"].lower()] = f["name"]
    answers = {}
    for line in re.split(r"[\n;]", text):
        if ":" in line:
            key, value = line.split(":", 1)
            name = by_key.get(key.strip().lower())
            if name is None:   # also accept a shortened label, e.g. "Pallet size"
                name = next((f["name"] for f in fields if f["label"].lower().startswith(key.strip().lower())
                             and key.strip()), None)
            if name and value.strip():
                answers[name] = value.strip()
    if answers:
        return answers
    parts = [p.strip() for p in re.split(r"[\n,]", text) if p.strip()]
    if len(parts) == len(fields):
        return {f["name"]: p for f, p in zip(fields, parts)}
    return None


def _open_form(c: dict) -> dict | None:
    """The agent's latest question in this case, if the customer hasn't answered it yet."""
    msgs = c["messages"]
    idx = max((i for i, m in enumerate(msgs) if m["form"]), default=-1)
    if idx < 0 or any(m["form_response"] for m in msgs[idx + 1:]):
        return None
    return msgs[idx]["form"]


_repeated_answers = 0  # how many times we reused a resolved case answer this session


def _last_agent_message(conn, case_id: str) -> str | None:
    """The most recent agent/ops message body in a case, or None."""
    m = row(conn, "SELECT body FROM case_messages WHERE case_id = ? AND author_type IN ('agent','ops') "
                  "ORDER BY id DESC LIMIT 1", case_id)
    return m["body"] if m else None


def handle_customer_note(note: dict) -> tuple[str, str] | None:
    """A customer wrote a note in the TMS. Reply in an open case, or open a new one.

    Returns (event, case_id) for the Qubi webhook, or None if there's nothing to do.
    """
    global _repeated_answers
    if note["author_type"] != "customer" or note["action"] != CUSTOMER_NOTE_ACTION \
            or note["entity_type"] not in ("shipment", "order"):
        return None
    conn = get_db()
    try:
        if row(conn, "SELECT id FROM case_messages WHERE tms_note_id = ?", note["id"]):
            return None   # already part of a case
        field = "shipment_id" if note["entity_type"] == "shipment" else "order_id"
        open_cases = [load_case(conn, r["id"]) for r in rows(
            conn, f"SELECT id FROM cases WHERE {field} = ? AND status IN {OPEN} ORDER BY updated_at DESC",
            note["entity_id"])]
        resolved_cases = [load_case(conn, r["id"]) for r in rows(
            conn, f"SELECT id FROM cases WHERE {field} = ? AND status = 'resolved' ORDER BY updated_at DESC",
            note["entity_id"])]
    finally:
        conn.close()

    text = note["message"].strip()
    category = classify(text, note["entity_type"])
    waiting = next((c for c in open_cases if c["status"] == "awaiting_customer"), None)
    same_topic = next((c for c in open_cases if c["category"] == category), None)
    target = waiting or same_topic
    if target:
        c = customer_reply(target["id"], text, parse_form_response(_open_form(target), text), note["id"])
        return "case.customer_replied", c["id"]

    # Check if the shipment can be answered from TMS data (e.g. it's delivered) and a
    # resolved case already answered the same question. If so, repost the answer directly
    # rather than opening a new case.
    if resolved_cases and note["entity_type"] == "shipment":
        from plugin.toolkit import shipment_check  # local import to avoid circular dep
        try:
            check = shipment_check(note["entity_id"])
        except Exception:
            check = None
        if check and check.get("recommendation") == "answer_from_tms":
            prior = resolved_cases[0]
            conn = get_db()
            try:
                last_body = _last_agent_message(conn, prior["id"])
            finally:
                conn.close()
            if last_body:
                tms_client.add_note(
                    note["entity_type"], note["entity_id"],
                    f"To follow up on your earlier question: {last_body}",
                    action="message", visibility="customer",
                    author=config.SUPPORT_NAME, author_type="integration",
                    source_ref=prior["id"],
                )
                _repeated_answers += 1
                print(f"[notes] repeated question answered from resolved case {prior['id']} "
                      f"(shipment {note['entity_id']}, total reused: {_repeated_answers})")
                return None

    case_id, created = create_case(
        customer_code=None, shipment_id=note["entity_id"] if field == "shipment_id" else None,
        order_id=note["entity_id"] if field == "order_id" else None, channel="portal", category=category,
        message=text, author_name=note["author"], tms_note_id=note["id"])
    return ("case.created", case_id) if created else None


def repeated_answers_count() -> int:
    return _repeated_answers


# ── Customer requests ────────────────────────────────────────────────

class CustomerRequestIn(BaseModel):
    ref: Optional[str] = Field(None, description="Any shipment, BOL or order reference; used when "
                                                 "shipment_id and order_id are both empty")
    shipment_id: Optional[str] = None
    order_id: Optional[str] = None
    customer_code: Optional[str] = None
    category: Optional[Category] = Field(None, description="Left empty, it's worked out from the message")
    message: str = Field(..., min_length=1, max_length=5000)
    channel: Literal["portal", "email", "phone", "chat"] = "email"
    subject: Optional[str] = None
    sender_email: Optional[str] = None
    external_ref: Optional[str] = Field(None, description="Email message ID, for threading replies")
    author_name: Optional[str] = None


@requests_router.post("", status_code=201, summary="A customer asks for something: opens a case and starts Flow 1")
def customer_request(body: CustomerRequestIn, background: BackgroundTasks, response: Response):
    shipment_id, order_id = body.shipment_id, body.order_id
    if not shipment_id and not order_id:
        if not body.ref:
            raise HTTPException(422, "Give shipment_id, order_id or ref.")
        hit = tms_client.get("/api/lookup", ref=body.ref)
        shipment_id, order_id = (hit["id"], None) if hit["type"] == "shipment" else (None, hit["id"])
    category = body.category or classify(body.message, "shipment" if shipment_id else "order")
    case_id, created = create_case(
        customer_code=body.customer_code, shipment_id=shipment_id, order_id=order_id, channel=body.channel,
        category=category, message=body.message, subject=body.subject, sender_email=body.sender_email,
        external_ref=body.external_ref, author_name=body.author_name, record_note=True)
    c = get_case(case_id)
    if created:
        background.add_task(_notify, "case.created", c)
    else:
        response.status_code = 200   # an open case on this topic already exists
    return {**c, "existing": not created}


# ── Older portal endpoints (kept so existing callers still work) ─────

class PortalCaseIn(BaseModel):
    customer_code: str = "NFAS"
    shipment_id: Optional[str] = None
    order_id: Optional[str] = None
    category: Category
    message: Optional[str] = Field(None, max_length=2000)


@portal.post("", status_code=201, summary="Customer opens a case (older portal endpoint)")
def portal_open_case(body: PortalCaseIn, background: BackgroundTasks, response: Response):
    message = (body.message or "").strip() or CATEGORIES[body.category]
    case_id, created = create_case(
        customer_code=body.customer_code, shipment_id=body.shipment_id, order_id=body.order_id,
        channel="portal", category=body.category, message=message, record_note=True)
    c = get_case(case_id)
    if created:
        background.add_task(_notify, "case.created", c)
    else:
        response.status_code = 200
    return {**c, "existing": not created}


class PortalReplyIn(BaseModel):
    body: str = Field("", max_length=2000)
    form_response: Optional[dict] = None


@portal.post("/{case_id}/messages", status_code=201, summary="Customer replies in a case")
def portal_reply(case_id: str, body: PortalReplyIn, background: BackgroundTasks):
    if not body.body.strip() and not body.form_response:
        raise HTTPException(422, "Write a message or fill in the form.")
    text = body.body.strip() or "\n".join(f"{k}: {v}" for k, v in body.form_response.items())
    c = customer_reply(case_id, text, body.form_response)
    background.add_task(_notify, "case.customer_replied", c)
    return c


# ── Cases: what Flow 1 calls ─────────────────────────────────────────

@cases.get("", summary="Cases, newest first, filtered by status or record")
def list_cases(status: Optional[str] = Query(None, description="A status, several separated by commas "
                                            "(e.g. new,customer_replied), or 'open' for all unresolved"),
               shipment_id: Optional[str] = None, order_id: Optional[str] = None,
               customer_code: Optional[str] = None, channel: Optional[str] = None,
               limit: int = Query(50, le=200)):
    sql, args = "SELECT id FROM cases WHERE 1=1", []
    if status == "open":
        sql += f" AND status IN {OPEN}"
    elif status:
        wanted = [x.strip() for x in status.split(",") if x.strip()]
        sql += f" AND status IN ({', '.join('?' for _ in wanted)})"
        args += wanted
    for field, value in (("shipment_id", shipment_id), ("order_id", order_id),
                         ("customer_code", customer_code), ("channel", channel)):
        if value:
            sql, args = sql + f" AND {field} = ?", args + [value]
    conn = get_db()
    try:
        ids = [r["id"] for r in rows(conn, sql + " ORDER BY created_at DESC, id DESC LIMIT ?", *args, limit)]
        return [load_case(conn, i) for i in ids]
    finally:
        conn.close()


@cases.get("/webhook-status", summary="Is the Qubi webhook set up, and what happened recently?")
def webhook_status():
    return qubi.status()


@cases.get("/{case_id}", summary="One case with its conversation")
def read_case(case_id: str):
    return get_case(case_id)


class CaseIn(BaseModel):
    customer_code: Optional[str] = None
    shipment_id: Optional[str] = None
    order_id: Optional[str] = None
    channel: Channel = "email"
    category: Category
    message: str = Field(..., max_length=5000)
    subject: Optional[str] = None
    sender_email: Optional[str] = None
    external_ref: Optional[str] = Field(None, description="Email message ID, for threading replies")
    author_name: Optional[str] = None


@cases.post("", status_code=201, dependencies=[Depends(require_api_key)],
            summary="Open a case from any channel (e.g. a Qubi email-intake workflow)")
def open_case(body: CaseIn, background: BackgroundTasks, response: Response):
    case_id, created = create_case(
        customer_code=body.customer_code, shipment_id=body.shipment_id, order_id=body.order_id,
        channel=body.channel, category=body.category, message=body.message, subject=body.subject,
        sender_email=body.sender_email, external_ref=body.external_ref, author_name=body.author_name,
        author_type="system" if body.channel == "monitor" else "customer",
        record_note=body.channel != "monitor")
    c = get_case(case_id)
    if created:
        background.add_task(_notify, "case.created", c)
    else:
        response.status_code = 200
    return {**c, "existing": not created}


@cases.post("/{case_id}/claim", dependencies=[Depends(require_api_key)],
            summary="Take a case so no one else works it (new or customer_replied → in_progress)")
def claim_case(case_id: str):
    with write_lock:
        conn = get_db()
        try:
            cur = conn.execute("UPDATE cases SET status = 'in_progress', updated_at = ? "
                               f"WHERE id = ? AND status IN {READY_FOR_AGENT}", (stamp(), case_id))
            if cur.rowcount == 0:
                c = load_case(conn, case_id)
                raise HTTPException(409, f"{case_id} is already {c['status'].replace('_', ' ')}.")
            conn.commit()
            return load_case(conn, case_id)
        finally:
            conn.close()


class MessageIn(BaseModel):
    author_type: Literal["agent", "ops", "system"] = "agent"
    author_name: Optional[str] = None
    body: str = Field(..., max_length=5000)
    form: Optional[dict] = Field(None, description='Ask the customer for details, e.g. '
                                 '{"fields": [{"name": "pallets", "label": "Number of pallets"}]}')
    status: Optional[Status] = Field(None, description="Optionally change the case status in the same call")


@cases.post("/{case_id}/messages", status_code=201, dependencies=[Depends(require_api_key)],
            summary="Write to the customer (posted as a customer-visible note on the TMS record)")
def add_message(case_id: str, body: MessageIn):
    with write_lock:
        conn = get_db()
        try:
            c = load_case(conn, case_id)
            if body.author_type == "system":
                _insert_message(conn, case_id, "system", body.author_name or "Qubiway", body.body)
            else:
                post_to_customer(conn, c, body.author_type, body.body, form=body.form,
                                 author_name=body.author_name)
            if body.status and body.status != c["status"]:
                set_status(conn, c, body.status, None, notify=body.author_type == "system")
            conn.commit()
            return load_case(conn, case_id)
        finally:
            conn.close()


class CaseUpdate(BaseModel):
    status: Status
    reason: Optional[str] = None


@cases.patch("/{case_id}", dependencies=[Depends(require_api_key)], summary="Change a case's status")
def update_case(case_id: str, body: CaseUpdate):
    with write_lock:
        conn = get_db()
        try:
            c = load_case(conn, case_id)
            if body.status != c["status"]:
                set_status(conn, c, body.status, body.reason)
                conn.commit()
            return load_case(conn, case_id)
        finally:
            conn.close()
