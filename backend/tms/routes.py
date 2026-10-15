"""
routes.py — the TMS API: shipments, tracking, orders, quote requests and notes.

A plain TMS. It has no knowledge of the SMART API Agent; the plugin
(plugin/) reads and writes through this same API like any other client.

  /api/...         TMS data: reading is open, writes need X-API-Key
  /api/portal/...  what the customer portal shows and does (no key; demo customer)
"""
import base64
import html
import random
import re
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from backend.tms import events
from backend.tms.auth import require_api_key
from backend.tms.db import get_db, iso, now, parse, stamp
from backend.tms.milestones import MILESTONES, REPEATABLE, default_label, status_for, step
from backend.tms.seed import reset_demo

router = APIRouter(prefix="/api", tags=["TMS"])
portal = APIRouter(prefix="/api/portal", tags=["Customer portal"])

STAFF = "TruckerPath Operations"
AuthorType = Literal["customer", "staff", "carrier", "integration", "system"]
Visibility = Literal["internal", "customer"]


# ── helpers ──────────────────────────────────────────────────────────

def _row(conn, sql, *args) -> dict | None:
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def _rows(conn, sql, *args) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


FIELD_WORDS = {
    "truck_id": "truck", "driver_name": "driver",
    "delivery_appt_start": "delivery window start", "delivery_appt_end": "delivery window end",
    "origin_zip": "origin postal code", "dest_zip": "destination postal code",
    "origin_state": "origin state", "dest_state": "destination state",
    "origin_country": "origin country", "dest_country": "destination country",
    "fuel_surcharge_percent": "fuel surcharge %", "skid_dims": "pallet dimensions",
    "skid_details": "pallet details", "pallet_count": "pallet count",
    "freight_class": "freight class", "weight_lbs": "weight (lb)",
    "pickup_appt_start": "pickup window start", "pickup_appt_end": "pickup window end",
    "carrier_name": "carrier", "carrier_email": "carrier email", "carrier_code": "carrier code",
    "po_number": "PO number", "pro_number": "PRO number", "customer_ref": "customer reference",
    "trailer": "trailer type",
}


def _friendly_time(value: str) -> str:
    dt = parse(value)
    return dt.strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _friendly_value(field: str, value) -> str:
    if value in (None, ""):
        return "empty"
    if field.endswith("_appt_start") or field.endswith("_appt_end"):
        return _friendly_time(value)
    return str(value)


def _diff(before: dict, changes: dict) -> str:
    return "; ".join(f"{FIELD_WORDS.get(k, k)}: {_friendly_value(k, before.get(k))} → "
                     f"{_friendly_value(k, v)}" for k, v in changes.items())


def _norm(ref: str) -> str:
    """'SHP-1042', 'shp 1042', 'SHP1042' all become 'SHP1042'."""
    return re.sub(r"[^A-Z0-9]", "", ref.upper())


def _note(conn, entity_type, entity_id, action, message, source_ref=None, author=STAFF,
          author_type="staff", visibility="internal") -> int:
    cur = conn.execute(
        "INSERT INTO notes (entity_type, entity_id, author, author_type, visibility, action, message, "
        "source_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (entity_type, entity_id, author, author_type, visibility, action, message, source_ref, stamp()),
    )
    return cur.lastrowid


def _shipment_or_404(conn, shipment_id: str) -> dict:
    s = _row(conn, "SELECT * FROM shipments WHERE id = ?", shipment_id)
    if not s:
        raise HTTPException(404, f"Shipment {shipment_id} not found.")
    return s


def _order_or_404(conn, order_id: str) -> dict:
    o = _row(conn, "SELECT * FROM orders WHERE id = ?", order_id)
    if not o:
        raise HTTPException(404, f"Order {order_id} not found.")
    return o


def _milestones(conn, shipment_id):
    return _rows(conn, "SELECT * FROM milestones WHERE shipment_id = ? ORDER BY event_time, id",
                 shipment_id)


def _notes(conn, entity_type, entity_id, customer_only=False):
    sql = "SELECT * FROM notes WHERE entity_type = ? AND entity_id = ?"
    if customer_only:
        sql += " AND visibility = 'customer'"
    return _rows(conn, sql + " ORDER BY id DESC", entity_type, entity_id)


def _refresh_status(conn, shipment_id):
    codes = [m["code"] for m in _milestones(conn, shipment_id)]
    conn.execute("UPDATE shipments SET status = ?, updated_at = ? WHERE id = ?",
                 (status_for(codes), stamp(), shipment_id))


def _tracking_alert(s: dict, milestones: list[dict]) -> str | None:
    """The standard TMS exception flag: an appointment window has passed without the milestone."""
    if s["status"] == "Delivered":
        return None
    codes = {m["code"] for m in milestones}
    t = now()
    if s["delivery_appt_end"] and t > parse(s["delivery_appt_end"]) and "DELV" not in codes:
        return "Delivery overdue"
    if s["pickup_appt_end"] and t > parse(s["pickup_appt_end"]) and "PICK" not in codes:
        return "Pickup overdue"
    return None


def _num(text) -> float | None:
    try:
        return float(re.sub(r"[^\d.\-]", "", str(text or "")))
    except ValueError:
        return None


def _quote_status(o: dict) -> str:
    amount = _num(o["quote"]) if (o["quote"] or "").strip() else None
    return f"Quoted ${amount:,.2f}" if amount is not None else "Quote pending"


# ── lookup ───────────────────────────────────────────────────────────

@router.get("/lookup", summary="Find a shipment or order from any reference (ID, BOL, PO, PRO, any format)")
def lookup(ref: str = Query(..., description="Shipment ID, BOL or order number, any format")):
    key = _norm(ref)
    conn = get_db()
    try:
        for s in _rows(conn, "SELECT id, bol FROM shipments"):
            if key in (_norm(s["id"]), _norm(s["bol"] or "")):
                return {"found": True, "type": "shipment", "id": s["id"]}
        for o in _rows(conn, "SELECT id FROM orders"):
            if key == _norm(o["id"]):
                return {"found": True, "type": "order", "id": o["id"]}
        for s in _rows(conn, "SELECT id, po_number, pro_number, customer_ref FROM shipments"):
            if key in {_norm(s[f] or "") for f in ("po_number", "pro_number", "customer_ref")} - {""}:
                return {"found": True, "type": "shipment", "id": s["id"]}
    finally:
        conn.close()
    raise HTTPException(404, f"No shipment or order matches {ref!r}.")


# ── shipments and tracking ───────────────────────────────────────────

@router.get("/shipments", summary="Shipments with their milestones")
def list_shipments(customer_code: Optional[str] = None,
                   status: Optional[str] = Query(None, description="'active' (not delivered), 'delivered', "
                                                                   "or an exact status such as 'In Transit'"),
                   carrier_code: Optional[str] = None):
    sql, args = ("SELECT s.*, c.name AS customer_name FROM shipments s "
                 "LEFT JOIN customers c ON c.code = s.customer_code WHERE 1=1"), []
    if customer_code:
        sql, args = sql + " AND s.customer_code = ?", args + [customer_code]
    if carrier_code:
        sql, args = sql + " AND s.carrier_code = ?", args + [carrier_code]
    if status == "active":
        sql += " AND s.status != 'Delivered'"
    elif status == "delivered":
        sql += " AND s.status = 'Delivered'"
    elif status:
        sql, args = sql + " AND s.status = ?", args + [status]
    conn = get_db()
    try:
        out = []
        for s in _rows(conn, sql + " ORDER BY s.pickup_appt_start DESC", *args):
            ms = _milestones(conn, s["id"])
            out.append({**s, "milestones": ms, "last_milestone": ms[-1] if ms else None,
                        "tracking_alert": _tracking_alert(s, ms)})
        return out
    finally:
        conn.close()


@router.get("/shipments/{shipment_id}", summary="One shipment with milestones, customer, load, driver and notes")
def get_shipment(shipment_id: str):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        load = _row(conn, "SELECT * FROM loads WHERE id = ?", s["load_id"]) if s["load_id"] else None
        driver = (_row(conn, "SELECT * FROM drivers WHERE id = ?", load["driver_id"])
                  if load and load["driver_id"] else None)
        ms = _milestones(conn, shipment_id)
        return {
            **s,
            "customer": _row(conn, "SELECT * FROM customers WHERE code = ?", s["customer_code"]),
            "carrier": _row(conn, "SELECT * FROM carriers WHERE code = ?", s.get("carrier_code")),
            "load": load, "driver": driver,
            "milestones": ms, "tracking_alert": _tracking_alert(s, ms),
            "notes": _notes(conn, "shipment", shipment_id),
        }
    finally:
        conn.close()


class ShipmentUpdate(BaseModel):
    truck_id: Optional[str] = None
    driver_name: Optional[str] = None
    delivery_appt_start: Optional[str] = Field(None, description="ISO time, e.g. 2026-10-14T13:00:00-07:00")
    delivery_appt_end: Optional[str] = None
    pickup_appt_start: Optional[str] = None
    pickup_appt_end: Optional[str] = None
    carrier_code: Optional[str] = Field(None, description="Changes the carrier; name and email come from the carrier record")
    po_number: Optional[str] = None
    pro_number: Optional[str] = None
    customer_ref: Optional[str] = None
    trailer: Optional[str] = None
    reason: str = Field(..., description="Why the change is made; saved as a note")
    source_ref: Optional[str] = Field(None, description="Email subject, ticket or other reference")
    author: Optional[str] = Field(None, description="Who made the change, for the note")


@router.patch("/shipments/{shipment_id}", dependencies=[Depends(require_api_key)],
              summary="Change allowed shipment fields (logged as a note)")
def update_shipment(shipment_id: str, body: ShipmentUpdate):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        changes = body.model_dump(exclude_none=True, exclude={"reason", "source_ref", "author"})
        for f in ("delivery_appt_start", "delivery_appt_end", "pickup_appt_start", "pickup_appt_end"):
            if f in changes:
                try:
                    parse(changes[f])
                except ValueError:
                    raise HTTPException(422, f"{f} must be an ISO date-time.")
        merged = {**s, **changes}
        for kind in ("pickup", "delivery"):
            start, end = merged[f"{kind}_appt_start"], merged[f"{kind}_appt_end"]
            if start and end and parse(end) < parse(start):
                raise HTTPException(422, f"The {kind} window ends before it starts.")
        if "carrier_code" in changes:
            carrier = _carrier_or_422(conn, changes["carrier_code"])
            changes.update(carrier_name=carrier["name"], carrier_email=carrier["email"])
        if not changes:
            raise HTTPException(422, "Nothing to change.")
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        conn.execute(f"UPDATE shipments SET {sets}, updated_at = :u WHERE id = :id",
                     {**changes, "u": stamp(), "id": shipment_id})
        _note(conn, "shipment", shipment_id, "update", f"{body.reason} ({_diff(s, changes)})",
              body.source_ref, author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return get_shipment(shipment_id)


class MilestoneIn(BaseModel):
    code: Literal["ARRSHIP", "PICK", "INTRANSIT", "ARRCONSIGNEE", "DELV", "POD"]
    event_time: str = Field(..., description="When it happened, ISO time, e.g. 2026-10-14T14:05:00-07:00")
    location: Optional[str] = None
    label: Optional[str] = Field(None, description="Text shown on the timeline; defaults from the code")
    source: Literal["carrier", "customer", "agent", "system", "staff"] = "carrier"
    reason: str = Field(..., description="How this was learned; saved as a note")
    source_ref: Optional[str] = None
    author: Optional[str] = None


@router.post("/shipments/{shipment_id}/milestones", status_code=201,
             dependencies=[Depends(require_api_key)],
             summary="Record a tracking milestone (also updates the shipment status)")
def add_milestone(shipment_id: str, body: MilestoneIn):
    conn = get_db()
    try:
        _shipment_or_404(conn, shipment_id)
        try:
            when = parse(body.event_time)
        except ValueError:
            raise HTTPException(422, "event_time must be an ISO date-time.")
        if when.tzinfo is None:
            raise HTTPException(422, "event_time needs a time zone, e.g. -07:00.")
        if when > now() + timedelta(minutes=5):
            raise HTTPException(422, "event_time is in the future; milestones record what already happened.")
        recorded = _milestones(conn, shipment_id)
        if body.code in {m["code"] for m in recorded} and body.code not in REPEATABLE:
            raise HTTPException(409, f"{body.code} is already recorded for {shipment_id}.")
        # Milestones must stay in order: nothing earlier in the journey can be later in time.
        for m in recorded:
            other = parse(m["event_time"])
            if step(m["code"]) < step(body.code) and other > when:
                raise HTTPException(422, f"{body.code} at {iso(when)} would be before {m['code']} "
                                         f"recorded at {m['event_time']}. Check the time.")
            if step(m["code"]) > step(body.code) and other < when:
                raise HTTPException(422, f"{body.code} at {iso(when)} would be after {m['code']} "
                                         f"recorded at {m['event_time']}. Check the time.")
        label = body.label or default_label(body.code) + (f" — {body.location}" if body.location else "")
        conn.execute(
            "INSERT INTO milestones (shipment_id, code, label, location, event_time, source, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (shipment_id, body.code, label, body.location, iso(when), body.source, stamp()),
        )
        _refresh_status(conn, shipment_id)
        _note(conn, "shipment", shipment_id, "milestone",
              f"{default_label(body.code)} at {_friendly_time(iso(when))}. {body.reason}", body.source_ref,
              author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return get_shipment(shipment_id)


# ── customers, loads, drivers ────────────────────────────────────────

@router.get("/customers/{code}", summary="One customer account")
def get_customer(code: str):
    conn = get_db()
    try:
        c = _row(conn, "SELECT * FROM customers WHERE code = ?", code)
    finally:
        conn.close()
    if not c:
        raise HTTPException(404, f"Customer {code} not found.")
    return c


@router.get("/loads/{load_id}", summary="One load")
def get_load(load_id: int):
    conn = get_db()
    try:
        ld = _row(conn, "SELECT * FROM loads WHERE id = ?", load_id)
    finally:
        conn.close()
    if not ld:
        raise HTTPException(404, f"Load {load_id} not found.")
    return ld


@router.get("/drivers/{driver_id}", summary="One driver")
def get_driver(driver_id: int):
    conn = get_db()
    try:
        d = _row(conn, "SELECT * FROM drivers WHERE id = ?", driver_id)
    finally:
        conn.close()
    if not d:
        raise HTTPException(404, f"Driver {driver_id} not found.")
    return d


def _carrier_or_422(conn, code: str) -> dict:
    c = _row(conn, "SELECT * FROM carriers WHERE code = ?", code)
    if not c:
        raise HTTPException(422, f"Carrier {code} not found.")
    if c["status"] != "Active":
        raise HTTPException(422, f"{c['name']} is marked {c['status']!r} "
                                 f"(insurance expired {c['insurance_expires']}). Choose another carrier.")
    return c


# ── customers list and account changes ───────────────────────────────

@router.get("/customers", summary="Customer accounts with shipment, order and balance counts")
def list_customers():
    conn = get_db()
    try:
        out = []
        for c in _rows(conn, "SELECT * FROM customers ORDER BY name"):
            code = c["code"]
            c["active_shipments"] = conn.execute(
                "SELECT COUNT(*) FROM shipments WHERE customer_code = ? AND status != 'Delivered'", (code,)).fetchone()[0]
            c["total_shipments"] = conn.execute(
                "SELECT COUNT(*) FROM shipments WHERE customer_code = ?", (code,)).fetchone()[0]
            c["open_orders"] = conn.execute(
                "SELECT COUNT(*) FROM orders WHERE customer_code = ? AND shipment_id IS NULL", (code,)).fetchone()[0]
            c["open_balance"] = conn.execute(
                "SELECT COALESCE(SUM(ch.amount), 0) FROM charges ch JOIN shipments s ON s.id = ch.shipment_id "
                "WHERE s.customer_code = ? AND ch.side = 'customer' AND s.invoice_status = 'Invoiced'",
                (code,)).fetchone()[0]
            out.append(c)
        return out
    finally:
        conn.close()


class CustomerUpdate(BaseModel):
    on_hold: Optional[bool] = None
    hold_reason: Optional[str] = None
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    terms: Optional[str] = None
    reason: str = Field(..., description="Why the change is made; saved as a note")
    author: Optional[str] = None


@router.patch("/customers/{code}", dependencies=[Depends(require_api_key)],
              summary="Change a customer account, e.g. put it on hold (logged as a note)")
def update_customer(code: str, body: CustomerUpdate):
    conn = get_db()
    try:
        c = _row(conn, "SELECT * FROM customers WHERE code = ?", code)
        if not c:
            raise HTTPException(404, f"Customer {code} not found.")
        changes = body.model_dump(exclude_none=True, exclude={"reason", "author"})
        if "on_hold" in changes:
            changes["on_hold"] = int(changes["on_hold"])
            if not changes["on_hold"]:
                changes["hold_reason"] = None
        if not changes:
            raise HTTPException(422, "Nothing to change.")
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        conn.execute(f"UPDATE customers SET {sets} WHERE code = :code", {**changes, "code": code})
        words = {"on_hold": "on hold", "hold_reason": "hold reason"}
        diff = "; ".join(f"{words.get(k, k)}: {_friendly_value(k, c.get(k))} → {_friendly_value(k, v)}"
                         for k, v in changes.items())
        _note(conn, "customer", code, "update", f"{body.reason} ({diff})", author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return get_customer(code)


# ── carriers, drivers, trucks ────────────────────────────────────────

def _carrier_summary(conn, c: dict) -> dict:
    c["active_shipments"] = conn.execute(
        "SELECT COUNT(*) FROM shipments WHERE carrier_code = ? AND status != 'Delivered'", (c["code"],)).fetchone()[0]
    c["total_shipments"] = conn.execute(
        "SELECT COUNT(*) FROM shipments WHERE carrier_code = ?", (c["code"],)).fetchone()[0]
    expires = parse(c["insurance_expires"] + "T00:00:00-07:00") if c["insurance_expires"] else None
    c["insurance_days_left"] = (expires - now()).days if expires else None
    return c


@router.get("/carriers", summary="Carriers with insurance status and shipment counts")
def list_carriers():
    conn = get_db()
    try:
        return [_carrier_summary(conn, c) for c in _rows(conn, "SELECT * FROM carriers ORDER BY own_fleet DESC, name")]
    finally:
        conn.close()


@router.get("/carriers/{code}", summary="One carrier, with its notes")
def get_carrier(code: str):
    conn = get_db()
    try:
        c = _row(conn, "SELECT * FROM carriers WHERE code = ?", code)
        if not c:
            raise HTTPException(404, f"Carrier {code} not found.")
        c = _carrier_summary(conn, c)
        c["notes"] = _notes(conn, "carrier", code)
        return c
    finally:
        conn.close()


def _current_shipment(conn, truck_id: str | None) -> dict | None:
    if not truck_id:
        return None
    return _row(conn, "SELECT id, origin, destination, status, delivery_appt_start, delivery_appt_end "
                      "FROM shipments WHERE truck_id = ? AND status != 'Delivered' "
                      "ORDER BY pickup_appt_start LIMIT 1", truck_id)


@router.get("/drivers", summary="Drivers with their truck and current shipment")
def list_drivers():
    conn = get_db()
    try:
        out = []
        for d in _rows(conn, "SELECT * FROM drivers ORDER BY name"):
            d["current_shipment"] = _current_shipment(conn, d["truck_id"])
            out.append(d)
        return out
    finally:
        conn.close()


@router.get("/trucks", summary="Trucks with their driver and current shipment")
def list_trucks():
    conn = get_db()
    try:
        out = []
        for t in _rows(conn, "SELECT * FROM trucks ORDER BY id"):
            t["driver"] = _row(conn, "SELECT id, name, status FROM drivers WHERE truck_id = ?", t["id"])
            t["current_shipment"] = _current_shipment(conn, t["id"])
            out.append(t)
        return out
    finally:
        conn.close()


# ── documents ────────────────────────────────────────────────────────

DocType = Literal["BOL", "POD", "Rate confirmation", "Invoice", "Lumper receipt", "Other"]
MAX_DOC_BYTES = 5 * 1024 * 1024


class DocumentIn(BaseModel):
    doc_type: DocType
    filename: str = Field(..., max_length=200)
    content_type: str = Field("application/octet-stream", max_length=100)
    content_base64: str = Field(..., description="The file's bytes, base64-encoded")
    author: Optional[str] = None


@router.get("/shipments/{shipment_id}/documents", summary="Documents on a shipment (without file contents)")
def list_documents(shipment_id: str):
    conn = get_db()
    try:
        _shipment_or_404(conn, shipment_id)
        return _rows(conn, "SELECT id, shipment_id, doc_type, filename, content_type, size, uploaded_by, created_at "
                           "FROM documents WHERE shipment_id = ? ORDER BY id DESC", shipment_id)
    finally:
        conn.close()


@router.post("/shipments/{shipment_id}/documents", status_code=201, dependencies=[Depends(require_api_key)],
             summary="Attach a document (BOL, POD, rate confirmation...) to a shipment")
def add_document(shipment_id: str, body: DocumentIn):
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except ValueError:
        raise HTTPException(422, "content_base64 is not valid base64.")
    if not content:
        raise HTTPException(422, "The file is empty.")
    if len(content) > MAX_DOC_BYTES:
        raise HTTPException(413, "Files must be 5 MB or smaller.")
    conn = get_db()
    try:
        _shipment_or_404(conn, shipment_id)
        who = body.author or STAFF
        cur = conn.execute(
            "INSERT INTO documents (shipment_id, doc_type, filename, content_type, size, content, uploaded_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (shipment_id, body.doc_type, body.filename, body.content_type, len(content), content, who, stamp()))
        _note(conn, "shipment", shipment_id, "document", f"{body.doc_type} attached: {body.filename}.", author=who)
        conn.commit()
        return _row(conn, "SELECT id, shipment_id, doc_type, filename, content_type, size, uploaded_by, created_at "
                          "FROM documents WHERE id = ?", cur.lastrowid)
    finally:
        conn.close()


@router.get("/documents/{doc_id}/file", summary="Download a document")
def download_document(doc_id: int):
    conn = get_db()
    try:
        d = _row(conn, "SELECT * FROM documents WHERE id = ?", doc_id)
    finally:
        conn.close()
    if not d:
        raise HTTPException(404, f"Document {doc_id} not found.")
    safe = re.sub(r'[^\w.\- ]', '_', d["filename"])
    return Response(d["content"], media_type=d["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{safe}"'})


# ── printable paperwork ──────────────────────────────────────────────

PRINT_CSS = """
body { font-family: 'IBM Plex Sans', Arial, sans-serif; color: #15212D; margin: 32px; font-size: 13px; }
h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #4B5A69; margin-bottom: 18px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th, td { border: 1px solid #9AA6B2; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #EEF1F4; font-weight: 600; width: 22%; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; }
.sign div { border-top: 1px solid #15212D; padding-top: 4px; color: #4B5A69; }
@media print { body { margin: 12mm; } .noprint { display: none; } }
"""


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
                        f"<style>{PRINT_CSS}</style></head><body>"
                        f"<p class='noprint'><button onclick='window.print()'>Print</button></p>{body}</body></html>")


def _cells(pairs) -> str:
    return "".join(f"<tr><th>{html.escape(k)}</th><td>{html.escape(str(v or ''))}</td></tr>" for k, v in pairs)


@router.get("/shipments/{shipment_id}/print/bol", response_class=HTMLResponse, summary="Printable bill of lading")
def print_bol(shipment_id: str):
    s = get_shipment(shipment_id)
    c = s["customer"] or {}
    body = (f"<h1>Straight bill of lading</h1><div class='sub'>{html.escape(s['bol'] or '')} for shipment "
            f"{html.escape(s['id'])}</div><table>"
            + _cells([("Shipper", f"{s['shipper_name'] or ''}, {s['shipper_address'] or s['origin']}"),
                      ("Consignee", f"{s['consignee_name'] or ''}, {s['consignee_address'] or s['destination']}"),
                      ("Bill to", f"{c.get('name', '')}, {c.get('address') or ''} {c.get('city') or ''}"),
                      ("Carrier", f"{s['carrier_name']} ({(s.get('carrier') or {}).get('mc_number', '')})"),
                      ("PO number", s["po_number"]), ("PRO number", s["pro_number"]),
                      ("Pickup window", f"{s['pickup_appt_start'] or ''} to {s['pickup_appt_end'] or ''}"),
                      ("Delivery window", f"{s['delivery_appt_start'] or ''} to {s['delivery_appt_end'] or ''}"),
                      ("Commodity", s["commodity"]), ("Weight", f"{s['weight_lbs'] or ''} lb"),
                      ("Equipment", s["trailer"]), ("Truck / driver", f"{s['truck_id'] or ''} / {s['driver_name'] or ''}")])
            + "</table><div class='sign'><div>Shipper signature and date</div>"
              "<div>Carrier signature and date</div><div>Consignee signature and date</div>"
              "<div>Pieces received in good order</div></div>")
    return _page(f"BOL {s['bol']}", body)


@router.get("/shipments/{shipment_id}/print/rate-confirmation", response_class=HTMLResponse,
            summary="Printable carrier rate confirmation")
def print_rate_confirmation(shipment_id: str):
    s = get_shipment(shipment_id)
    ch = shipment_charges(shipment_id)
    cr = s.get("carrier") or {}
    pay = "".join(f"<tr><td>{html.escape(i['type'])}</td><td>{html.escape(i['description'] or '')}</td>"
                  f"<td style='text-align:right'>${i['amount']:,.2f}</td></tr>" for i in ch["items"] if i["side"] == "carrier")
    body = (f"<h1>Rate confirmation</h1><div class='sub'>Shipment {html.escape(s['id'])}, "
            f"{html.escape(s['origin'])} to {html.escape(s['destination'])}</div><table>"
            + _cells([("Carrier", s["carrier_name"]), ("MC / DOT", f"{cr.get('mc_number', '')} / {cr.get('dot_number', '')}"),
                      ("Carrier contact", f"{cr.get('contact', '')}, {cr.get('phone', '')}, {s['carrier_email'] or ''}"),
                      ("Pickup", f"{s['shipper_name'] or ''}, {s['shipper_address'] or s['origin']}"),
                      ("Pickup window", f"{s['pickup_appt_start'] or ''} to {s['pickup_appt_end'] or ''}"),
                      ("Delivery", f"{s['consignee_name'] or ''}, {s['consignee_address'] or s['destination']}"),
                      ("Delivery window", f"{s['delivery_appt_start'] or ''} to {s['delivery_appt_end'] or ''}"),
                      ("Equipment", s["trailer"]), ("Commodity / weight", f"{s['commodity']} / {s['weight_lbs']} lb"),
                      ("Reference", f"BOL {s['bol']}, PO {s['po_number'] or ''}")])
            + "</table><table><tr><th>Charge</th><th>Description</th><th style='text-align:right'>Amount</th></tr>"
            + pay + f"<tr><th colspan='2'>Total carrier pay</th><th style='text-align:right'>${ch['carrier_total']:,.2f}</th></tr></table>"
            "<p>Carrier must send check calls daily and the signed POD within 24 hours of delivery.</p>"
            "<div class='sign'><div>Carrier signature and date</div><div>TruckerPath Operations</div></div>")
    return _page(f"Rate confirmation {s['id']}", body)


# ── charges and invoicing ────────────────────────────────────────────

ChargeSide = Literal["customer", "carrier"]


@router.get("/shipments/{shipment_id}/charges", summary="What we bill the customer, what we pay the carrier, and the margin")
def shipment_charges(shipment_id: str):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        items = _rows(conn, "SELECT * FROM charges WHERE shipment_id = ? ORDER BY side DESC, id", shipment_id)
    finally:
        conn.close()
    billed = round(sum(i["amount"] for i in items if i["side"] == "customer"), 2)
    paid = round(sum(i["amount"] for i in items if i["side"] == "carrier"), 2)
    return {"shipment_id": shipment_id, "items": items, "customer_total": billed, "carrier_total": paid,
            "margin": round(billed - paid, 2), "margin_pct": round((billed - paid) / billed * 100, 1) if billed else None,
            "invoice_status": s["invoice_status"], "invoice_number": s["invoice_number"], "invoiced_at": s["invoiced_at"]}


class ChargeIn(BaseModel):
    side: ChargeSide
    type: str = Field(..., max_length=40, description="e.g. Linehaul, Fuel surcharge, Detention, Lumper")
    description: Optional[str] = Field(None, max_length=200)
    amount: float = Field(..., description="In US dollars; negative for a credit")
    author: Optional[str] = None


def _billing_locked(s: dict, side: str) -> None:
    if side == "customer" and s["invoice_status"] != "Not invoiced":
        raise HTTPException(409, f"{s['id']} is already invoiced ({s['invoice_number']}); customer charges are locked.")


@router.post("/shipments/{shipment_id}/charges", status_code=201, dependencies=[Depends(require_api_key)],
             summary="Add a charge to a shipment")
def add_charge(shipment_id: str, body: ChargeIn):
    if body.amount == 0:
        raise HTTPException(422, "Amount can't be zero.")
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        _billing_locked(s, body.side)
        conn.execute("INSERT INTO charges (shipment_id, side, type, description, amount, created_at) VALUES (?,?,?,?,?,?)",
                     (shipment_id, body.side, body.type.strip(), (body.description or "").strip() or None,
                      round(body.amount, 2), stamp()))
        who = "customer" if body.side == "customer" else "carrier"
        _note(conn, "shipment", shipment_id, "charge", f"{body.type} of ${body.amount:,.2f} added to {who} charges.",
              author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return shipment_charges(shipment_id)


@router.delete("/charges/{charge_id}", dependencies=[Depends(require_api_key)], summary="Remove a charge")
def delete_charge(charge_id: int, author: Optional[str] = None):
    conn = get_db()
    try:
        ch = _row(conn, "SELECT * FROM charges WHERE id = ?", charge_id)
        if not ch:
            raise HTTPException(404, f"Charge {charge_id} not found.")
        s = _shipment_or_404(conn, ch["shipment_id"])
        _billing_locked(s, ch["side"])
        conn.execute("DELETE FROM charges WHERE id = ?", (charge_id,))
        _note(conn, "shipment", s["id"], "charge", f"{ch['type']} of ${ch['amount']:,.2f} removed.", author=author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return shipment_charges(ch["shipment_id"])


class InvoiceIn(BaseModel):
    author: Optional[str] = None


@router.post("/shipments/{shipment_id}/invoice", dependencies=[Depends(require_api_key)],
             summary="Invoice the customer for a delivered shipment")
def create_invoice(shipment_id: str, body: InvoiceIn):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        if s["status"] != "Delivered":
            raise HTTPException(422, f"{shipment_id} isn't delivered yet; invoice after delivery.")
        _billing_locked(s, "customer")
        total = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM charges WHERE shipment_id = ? AND side = 'customer'",
                             (shipment_id,)).fetchone()[0]
        if total <= 0:
            raise HTTPException(422, "Add the customer charges before invoicing.")
        last = conn.execute("SELECT MAX(CAST(SUBSTR(invoice_number, 5) AS INTEGER)) FROM shipments "
                            "WHERE invoice_number LIKE 'INV-%'").fetchone()[0] or 10500
        number = f"INV-{last + 1}"
        conn.execute("UPDATE shipments SET invoice_status = 'Invoiced', invoice_number = ?, invoiced_at = ?, "
                     "updated_at = ? WHERE id = ?", (number, stamp(), stamp(), shipment_id))
        _note(conn, "shipment", shipment_id, "invoice", f"Invoice {number} for ${total:,.2f} sent.",
              author=body.author or STAFF, visibility="customer")
        conn.commit()
    finally:
        conn.close()
    return shipment_charges(shipment_id)


@router.post("/shipments/{shipment_id}/invoice/paid", dependencies=[Depends(require_api_key)],
             summary="Record that the customer paid the invoice")
def mark_invoice_paid(shipment_id: str, body: InvoiceIn):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        if s["invoice_status"] != "Invoiced":
            raise HTTPException(409, f"{shipment_id} has no open invoice (status: {s['invoice_status']}).")
        conn.execute("UPDATE shipments SET invoice_status = 'Paid', updated_at = ? WHERE id = ?", (stamp(), shipment_id))
        _note(conn, "shipment", shipment_id, "invoice", f"Payment received for {s['invoice_number']}.",
              author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return shipment_charges(shipment_id)


# ── orders ───────────────────────────────────────────────────────────

@router.get("/orders", summary="Orders, paged, newest first")
def list_orders(limit: int = Query(50, le=500), offset: int = 0,
                customer_code: Optional[str] = None,
                source: Optional[Literal["csv", "portal"]] = None):
    sql, args = "FROM orders WHERE 1=1", []
    if customer_code:
        sql, args = sql + " AND customer_code = ?", args + [customer_code]
    if source:
        sql, args = sql + " AND source = ?", args + [source]
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) " + sql, args).fetchone()[0]
        items = _rows(conn, "SELECT * " + sql + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
                      *args, limit, offset)
    finally:
        conn.close()
    for o in items:
        o["quote_status"] = _quote_status(o)
    return {"total": total, "items": items}


@router.get("/orders/{order_id}", summary="One order with its notes")
def get_order(order_id: str):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        o["quote_status"] = _quote_status(o)
        o["notes"] = _notes(conn, "order", order_id)
        return o
    finally:
        conn.close()


class OrderUpdate(BaseModel):
    origin_zip: Optional[str] = None
    origin_state: Optional[str] = None
    origin_country: Optional[str] = None
    dest_zip: Optional[str] = None
    dest_state: Optional[str] = None
    dest_country: Optional[str] = None
    status: Optional[str] = None
    fuel_surcharge_percent: Optional[str] = None
    quote: Optional[str] = None
    pallet_count: Optional[str] = None
    skid_dims: Optional[str] = Field(None, description="e.g. 48x40x50")
    skid_details: Optional[str] = Field(None, description="e.g. 2 pallets, stackable")
    freight_class: Optional[str] = None
    weight_lbs: Optional[str] = None
    commodity: Optional[str] = None
    reason: str
    source_ref: Optional[str] = None
    author: Optional[str] = None


@router.patch("/orders/{order_id}", dependencies=[Depends(require_api_key)],
              summary="Change allowed order fields (logged as a note)")
def update_order(order_id: str, body: OrderUpdate):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        changes = body.model_dump(exclude_none=True, exclude={"reason", "source_ref", "author"})
        if not changes:
            raise HTTPException(422, "Nothing to change.")
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        conn.execute(f"UPDATE orders SET {sets}, last_updated_timestamp = :u WHERE id = :id",
                     {**changes, "u": stamp(), "id": order_id})
        _note(conn, "order", order_id, "update", f"{body.reason} ({_diff(o, changes)})", body.source_ref,
              author=body.author or STAFF)
        conn.commit()
    finally:
        conn.close()
    return get_order(order_id)



class BookIn(BaseModel):
    origin: str = Field(..., max_length=80, description="Pickup city, e.g. 'Phoenix, AZ'")
    destination: str = Field(..., max_length=80)
    pickup_appt_start: str
    pickup_appt_end: str
    delivery_appt_start: str
    delivery_appt_end: str
    carrier_code: str
    truck_id: str = Field(..., min_length=1, max_length=40)
    driver_name: str = Field(..., min_length=1, max_length=80)
    trailer: str = "Dry Van"
    po_number: Optional[str] = None
    carrier_rate: Optional[float] = Field(None, description="What we pay the carrier, if known")
    author: Optional[str] = None


@router.post("/orders/{order_id}/book", status_code=201, dependencies=[Depends(require_api_key)],
             summary="Book a quoted order as a shipment")
def book_order(order_id: str, body: BookIn):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        if o.get("shipment_id"):
            raise HTTPException(409, f"Order {order_id} is already booked as {o['shipment_id']}.")
        quote = _num(o["quote"]) if (o["quote"] or "").strip() else None
        if not quote:
            raise HTTPException(422, f"Order {order_id} has no quote yet; quote it before booking.")
        carrier = _carrier_or_422(conn, body.carrier_code)
        try:
            ps, pe, ds, de = (parse(getattr(body, f)) for f in
                              ("pickup_appt_start", "pickup_appt_end", "delivery_appt_start", "delivery_appt_end"))
        except ValueError:
            raise HTTPException(422, "Appointment times must be ISO date-times.")
        if any(t.tzinfo is None for t in (ps, pe, ds, de)):
            raise HTTPException(422, "Appointment times need a time zone, e.g. -07:00.")
        if pe < ps or de < ds:
            raise HTTPException(422, "An appointment window ends before it starts.")
        if ds < ps:
            raise HTTPException(422, "Delivery can't be before pickup.")
        if pe < now():
            raise HTTPException(422, "The pickup window has already passed.")
        last = conn.execute("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) FROM shipments WHERE id GLOB 'SHP-[0-9]*'"
                            ).fetchone()[0] or 2000
        sid = f"SHP-{last + 1}"
        while True:
            bol = f"BOL-{random.randint(90000, 99999)}"
            if not _row(conn, "SELECT id FROM shipments WHERE bol = ?", bol):
                break
        weight_num = _num(o["weight_lbs"])
        t = stamp()
        values = {
            "id": sid, "customer_code": o["customer_code"], "load_id": None,
            "origin": body.origin.strip(), "destination": body.destination.strip(), "status": "Booked",
            "commodity": o["commodity"] or "General Freight", "weight_lbs": int(weight_num) if weight_num else None,
            "trailer": body.trailer, "amount": f"${quote:,.0f}", "bol": bol,
            "truck_id": body.truck_id.strip(), "driver_name": body.driver_name.strip(),
            "carrier_name": carrier["name"], "carrier_email": carrier["email"], "carrier_code": carrier["code"],
            "pickup_appt_start": iso(ps), "pickup_appt_end": iso(pe),
            "delivery_appt_start": iso(ds), "delivery_appt_end": iso(de), "updated_at": t,
            "po_number": (body.po_number or "").strip() or None, "order_id": order_id,
            "shipper_name": None, "shipper_address": f"{o['origin_zip'] or ''} {o['origin_state'] or ''}".strip(),
            "consignee_name": None, "consignee_address": f"{o['dest_zip'] or ''} {o['dest_state'] or ''}".strip(),
        }
        conn.execute(f"INSERT INTO shipments ({', '.join(values)}) VALUES ({', '.join(':' + k for k in values)})", values)
        conn.execute("INSERT INTO milestones (shipment_id, code, label, location, event_time, source, created_at) "
                     "VALUES (?, 'BOOKED', ?, NULL, ?, 'staff', ?)", (sid, default_label("BOOKED"), iso(now()), t))
        conn.execute("INSERT INTO charges (shipment_id, side, type, description, amount, created_at) VALUES (?,?,?,?,?,?)",
                     (sid, "customer", "Linehaul", f"Quoted on order {order_id}", round(quote, 2), t))
        if body.carrier_rate:
            conn.execute("INSERT INTO charges (shipment_id, side, type, description, amount, created_at) VALUES (?,?,?,?,?,?)",
                         (sid, "carrier", "Fleet cost" if carrier["own_fleet"] else "Carrier pay", carrier["name"],
                          round(body.carrier_rate, 2), t))
        conn.execute("UPDATE orders SET status = 'booked', shipment_id = ?, last_updated_timestamp = ? WHERE id = ?",
                     (sid, t, order_id))
        who = body.author or STAFF
        _note(conn, "order", order_id, "booked", f"Booked as shipment {sid} with {carrier['name']}.",
              author=who, visibility="customer")
        _note(conn, "shipment", sid, "booked", f"Booked from order {order_id}. Pickup {_friendly_time(iso(ps))}, "
                                               f"delivery {_friendly_time(iso(ds))}.", author=who, visibility="customer")
        conn.commit()
    finally:
        conn.close()
    return get_shipment(sid)


# ── notes ────────────────────────────────────────────────────────────

class NoteIn(BaseModel):
    entity_type: Literal["shipment", "order", "customer", "carrier"]
    entity_id: str
    message: str = Field(..., max_length=5000)
    action: str = Field("note", description="Short tag, e.g. 'note', 'email_received', 'handoff'")
    visibility: Visibility = Field("internal", description="'customer' also shows the note in the portal")
    author: str = STAFF
    author_type: AuthorType = "staff"
    source_ref: Optional[str] = None


def _entity_exists(conn, entity_type, entity_id) -> bool:
    table, key = {"shipment": ("shipments", "id"), "order": ("orders", "id"),
                  "customer": ("customers", "code"), "carrier": ("carriers", "code")}[entity_type]
    return bool(_row(conn, f"SELECT 1 AS x FROM {table} WHERE {key} = ?", entity_id))


@router.post("/notes", status_code=201, dependencies=[Depends(require_api_key)],
             summary="Add a note to a shipment, order, customer or carrier")
def add_note(body: NoteIn):
    conn = get_db()
    try:
        if not _entity_exists(conn, body.entity_type, body.entity_id):
            raise HTTPException(404, f"{body.entity_type} {body.entity_id} not found.")
        note_id = _note(conn, body.entity_type, body.entity_id, body.action, body.message,
                        body.source_ref, body.author, body.author_type, body.visibility)
        conn.commit()
        return _row(conn, "SELECT * FROM notes WHERE id = ?", note_id)
    finally:
        conn.close()


@router.get("/notes", summary="Notes, newest first (or oldest first with order=asc)")
def list_notes(entity_type: Optional[str] = None, entity_id: Optional[str] = None,
               author_type: Optional[str] = None, visibility: Optional[str] = None,
               action: Optional[str] = None,
               after_id: Optional[int] = Query(None, description="Only notes with a higher id"),
               order: Literal["asc", "desc"] = "desc",
               limit: int = Query(50, le=500)):
    sql, args = "SELECT * FROM notes WHERE 1=1", []
    for field, value in (("entity_type", entity_type), ("entity_id", entity_id),
                         ("author_type", author_type), ("visibility", visibility), ("action", action)):
        if value:
            sql, args = sql + f" AND {field} = ?", args + [value]
    if after_id is not None:
        sql, args = sql + " AND id > ?", args + [after_id]
    conn = get_db()
    try:
        return _rows(conn, sql + f" ORDER BY id {order.upper()} LIMIT ?", *args, limit)
    finally:
        conn.close()


# ── admin ────────────────────────────────────────────────────────────

@router.post("/admin/reset", dependencies=[Depends(require_api_key)],
             summary="Reset all TMS data to the demo starting state")
def reset():
    return reset_demo()


@router.get("/auth/check", dependencies=[Depends(require_api_key)],
            summary="Is this API key valid? (used by the operations sign-in)")
def auth_check():
    return {"ok": True}


@router.get("/meta/milestone-codes", summary="Milestone codes and labels")
def milestone_codes():
    return [{"code": c, "label": v[1], "status_when_reached": v[2]} for c, v in MILESTONES.items()]


@router.get("/events/status", summary="Outbound event subscription and recent deliveries")
def events_status():
    return events.status()


# ── customer portal ──────────────────────────────────────────────────

def _customer_or_404(conn, code):
    c = _row(conn, "SELECT * FROM customers WHERE code = ?", code)
    if not c:
        raise HTTPException(404, f"Customer {code} not found.")
    return c


@portal.get("/shipments", summary="A customer's shipments")
def portal_shipments(customer_code: str = "NFAS"):
    return list_shipments(customer_code=customer_code, status=None)


@portal.get("/shipments/{shipment_id}", summary="One of the customer's shipments, with customer-visible notes")
def portal_shipment(shipment_id: str, customer_code: str = "NFAS"):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        if s["customer_code"] != customer_code:
            raise HTTPException(404, f"Shipment {shipment_id} not found.")
        ms = _milestones(conn, shipment_id)
        return {**s, "milestones": ms, "tracking_alert": _tracking_alert(s, ms),
                "notes": _notes(conn, "shipment", shipment_id, customer_only=True)}
    finally:
        conn.close()


@portal.get("/orders", summary="A customer's orders and quote requests, newest first")
def portal_orders(customer_code: str = "NFAS", limit: int = Query(25, le=200)):
    return list_orders(limit=limit, offset=0, customer_code=customer_code, source=None)


@portal.get("/orders/{order_id}", summary="One of the customer's orders, with customer-visible notes")
def portal_order(order_id: str, customer_code: str = "NFAS"):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        if o["customer_code"] != customer_code:
            raise HTTPException(404, f"Order {order_id} not found.")
        o["quote_status"] = _quote_status(o)
        o["notes"] = _notes(conn, "order", order_id, customer_only=True)
        return o
    finally:
        conn.close()


class QuoteRequestIn(BaseModel):
    customer_code: str = "NFAS"
    origin_zip: str = Field(..., max_length=20)
    origin_state: str = Field("", max_length=40)
    origin_country: str = Field("", max_length=40)
    dest_zip: str = Field(..., max_length=20)
    dest_state: str = Field("", max_length=40)
    dest_country: str = Field("", max_length=40)
    weight: str = Field(..., max_length=30, description="As typed, e.g. '1,200 lbs'")
    pallet_count: str = Field("", max_length=20)
    pallet_size: str = Field("", max_length=40, description="As typed, e.g. '48 x 40 x 50 in'")
    freight_class: str = Field("", max_length=10)
    commodity: str = Field("", max_length=80)
    stackable: bool = False
    urgent: bool = False
    appointment: bool = False
    notes: str = Field("", max_length=2000, description="Anything else, saved as a note on the order")


@portal.post("/orders", status_code=201, summary="Request a quote: the customer submits a new order")
def portal_new_order(body: QuoteRequestIn, background: BackgroundTasks):
    conn = get_db()
    try:
        customer = _customer_or_404(conn, body.customer_code)
        while True:
            order_id = f"SHP{random.randint(10000, 99999)}"
            if not _row(conn, "SELECT id FROM orders WHERE id = ?", order_id):
                break
        t = stamp()
        values = {
            "id": order_id, "customer_code": body.customer_code,
            "origin_zip": body.origin_zip.strip(), "origin_state": body.origin_state.strip(),
            "origin_country": body.origin_country.strip(), "dest_zip": body.dest_zip.strip(),
            "dest_state": body.dest_state.strip(), "dest_country": body.dest_country.strip(),
            "weight_lbs": body.weight.strip(), "pallet_count": body.pallet_count.strip(),
            "skid_dims": body.pallet_size.strip(), "freight_class": body.freight_class.strip(),
            "commodity": body.commodity.strip(), "is_stackable": str(body.stackable),
            "is_urgent": str(body.urgent), "delivery_appointment": str(body.appointment),
            "status": "pending", "base_rate_per_mile_cwt": "0.1", "fuel_surcharge_percent": "20.0",
            "accessorial_charges": "0.0", "driver_id": "", "vendor_id": "", "skid_details": "",
            "quote": "", "created_at": t, "last_updated_timestamp": t, "source": "portal",
        }
        conn.execute(f"INSERT INTO orders ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
                     list(values.values()))
        who = customer["contact"] or "Customer"
        _note(conn, "order", order_id, "order_submitted", "Quote request submitted through the portal.",
              author=who, author_type="customer", visibility="customer")
        if body.notes.strip():
            _note(conn, "order", order_id, "order_instructions", body.notes.strip(),
                  author=who, author_type="customer", visibility="customer")
        conn.commit()
    finally:
        conn.close()
    order = get_order(order_id)
    # Tell subscribers (the plugin) about the new order. Runs after the response is sent.
    background.add_task(events.send, "order.submitted",
                        {"order_id": order_id, "customer_code": body.customer_code, "order": order})
    return order


class PortalNoteIn(BaseModel):
    customer_code: str = "NFAS"
    entity_type: Literal["shipment", "order"]
    entity_id: str
    message: str = Field(..., min_length=1, max_length=2000)


@portal.post("/notes", status_code=201, summary="Customer adds a note to one of their shipments or orders")
def portal_add_note(body: PortalNoteIn):
    conn = get_db()
    try:
        customer = _customer_or_404(conn, body.customer_code)
        table = "shipments" if body.entity_type == "shipment" else "orders"
        rec = _row(conn, f"SELECT customer_code FROM {table} WHERE id = ?", body.entity_id)
        if not rec or rec["customer_code"] != body.customer_code:
            raise HTTPException(404, f"{body.entity_type} {body.entity_id} not found.")
        note_id = _note(conn, body.entity_type, body.entity_id, "note", body.message.strip(),
                        author=customer["contact"] or "Customer", author_type="customer",
                        visibility="customer")
        conn.commit()
        return _row(conn, "SELECT * FROM notes WHERE id = ?", note_id)
    finally:
        conn.close()
