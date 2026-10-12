"""
routes.py — the TMS API the SMART API Agent (Qubi) and the web pages use.

  /api/...              TMS data: read open, writes need X-API-Key
  /api/agent-tools/...  rule-based checks the agent calls before deciding what to do
"""
import re
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.tms import checks
from backend.tms.auth import require_api_key
from backend.tms.db import get_db, iso, now, parse, stamp
from backend.tms.milestones import MILESTONES, REPEATABLE, default_label, status_for, step
from backend.tms.seed import reset_demo

router = APIRouter(prefix="/api", tags=["TMS"])
tools = APIRouter(prefix="/api/agent-tools", tags=["Agent tools"])

AGENT = "SMART API Agent"
AgentStatus = Optional[Literal["awaiting_carrier", "awaiting_customer", "needs_human", "resolved"]]


# ── helpers ──────────────────────────────────────────────────────────

def _row(conn, sql, *args) -> dict | None:
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def _rows(conn, sql, *args) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


FIELD_WORDS = {
    "truck_id": "truck", "driver_name": "driver", "agent_status": "agent status",
    "delivery_appt_start": "delivery window start", "delivery_appt_end": "delivery window end",
    "origin_zip": "origin postal code", "dest_zip": "destination postal code",
    "origin_country": "origin country", "dest_country": "destination country",
    "fuel_surcharge_percent": "fuel surcharge %", "skid_dims": "pallet dimensions",
    "skid_details": "pallet details", "freight_class": "freight class", "weight_lbs": "weight (lb)",
}


def _friendly_time(value: str) -> str:
    dt = parse(value)
    return dt.strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _friendly_value(field: str, value) -> str:
    if value in (None, ""):
        return "empty"
    if field.endswith("_appt_start") or field.endswith("_appt_end"):
        return _friendly_time(value)
    if field == "agent_status":
        return str(value).replace("_", " ")
    return str(value)


def _diff(before: dict, changes: dict) -> str:
    return "; ".join(f"{FIELD_WORDS.get(k, k)}: {_friendly_value(k, before.get(k))} → "
                     f"{_friendly_value(k, v)}" for k, v in changes.items())


def _norm(ref: str) -> str:
    """'SHP-1042', 'shp 1042', 'SHP1042' all become 'SHP1042'."""
    return re.sub(r"[^A-Z0-9]", "", ref.upper())


def _note(conn, entity_type, entity_id, action, message, source_ref=None, author=AGENT):
    conn.execute(
        "INSERT INTO notes (entity_type, entity_id, author, action, message, source_ref, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (entity_type, entity_id, author, action, message, source_ref, stamp()),
    )


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


def _refresh_status(conn, shipment_id):
    codes = [m["code"] for m in _milestones(conn, shipment_id)]
    conn.execute("UPDATE shipments SET status = ?, updated_at = ? WHERE id = ?",
                 (status_for(codes), stamp(), shipment_id))


# ── lookup ───────────────────────────────────────────────────────────

@router.get("/lookup", summary="Find a shipment or order from any reference in an email")
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
    finally:
        conn.close()
    raise HTTPException(404, f"No shipment or order matches {ref!r}.")


# ── shipments ────────────────────────────────────────────────────────

@router.get("/shipments", summary="All shipments with their milestones (optionally one customer's)")
def list_shipments(customer_code: Optional[str] = None):
    sql, args = "SELECT * FROM shipments", []
    if customer_code:
        sql, args = sql + " WHERE customer_code = ?", [customer_code]
    conn = get_db()
    try:
        out = []
        for s in _rows(conn, sql + " ORDER BY pickup_appt_start DESC", *args):
            ms = _milestones(conn, s["id"])
            out.append({**s, "milestones": ms, "last_milestone": ms[-1] if ms else None})
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
        return {
            **s,
            "customer": _row(conn, "SELECT * FROM customers WHERE code = ?", s["customer_code"]),
            "load": load, "driver": driver,
            "milestones": _milestones(conn, shipment_id),
            "notes": _rows(conn, "SELECT * FROM notes WHERE entity_type = 'shipment' AND entity_id = ? "
                                 "ORDER BY id DESC", shipment_id),
        }
    finally:
        conn.close()


class ShipmentUpdate(BaseModel):
    truck_id: Optional[str] = None
    driver_name: Optional[str] = None
    delivery_appt_start: Optional[str] = Field(None, description="ISO time, e.g. 2026-10-14T13:00:00-07:00")
    delivery_appt_end: Optional[str] = None
    agent_status: AgentStatus = None
    clear_agent_status: bool = Field(False, description="Set true to clear agent_status")
    reason: str = Field(..., description="Why the change is made; saved as a note")
    source_ref: Optional[str] = Field(None, description="Email subject or ID that led to the change")


@router.patch("/shipments/{shipment_id}", dependencies=[Depends(require_api_key)],
              summary="Change allowed shipment fields (logged as a note)")
def update_shipment(shipment_id: str, body: ShipmentUpdate):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        changes = body.model_dump(exclude_none=True,
                                  exclude={"reason", "source_ref", "clear_agent_status"})
        if body.clear_agent_status:
            changes["agent_status"] = None
        for f in ("delivery_appt_start", "delivery_appt_end"):
            if f in changes:
                try:
                    parse(changes[f])
                except ValueError:
                    raise HTTPException(422, f"{f} must be an ISO date-time.")
        if not changes:
            raise HTTPException(422, "Nothing to change.")
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        conn.execute(f"UPDATE shipments SET {sets}, updated_at = :u WHERE id = :id",
                     {**changes, "u": stamp(), "id": shipment_id})
        _note(conn, "shipment", shipment_id, "update", f"{body.reason} ({_diff(s, changes)})", body.source_ref)
        conn.commit()
    finally:
        conn.close()
    return get_shipment(shipment_id)


class MilestoneIn(BaseModel):
    code: Literal["ARRSHIP", "PICK", "INTRANSIT", "ARRCONSIGNEE", "DELV", "POD"]
    event_time: str = Field(..., description="When it happened, ISO time, e.g. 2026-10-14T14:05:00-07:00")
    location: Optional[str] = None
    label: Optional[str] = Field(None, description="Text shown on the timeline; defaults from the code")
    source: Literal["carrier", "customer", "agent", "system"] = "carrier"
    reason: str = Field(..., description="How the agent learned this; saved as a note")
    source_ref: Optional[str] = None


@router.post("/shipments/{shipment_id}/milestones", status_code=201,
             dependencies=[Depends(require_api_key)],
             summary="Record a milestone (also updates the shipment status)")
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
              f"{default_label(body.code)} at {_friendly_time(iso(when))}. {body.reason}", body.source_ref)
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


# ── orders (orders.csv) ──────────────────────────────────────────────

@router.get("/orders", summary="Orders, paged")
def list_orders(limit: int = Query(50, le=500), offset: int = 0):
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        items = _rows(conn, "SELECT * FROM orders ORDER BY id LIMIT ? OFFSET ?", limit, offset)
    finally:
        conn.close()
    return {"total": total, "items": items}


@router.get("/orders/{order_id}", summary="One order with its notes")
def get_order(order_id: str):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        o["notes"] = _rows(conn, "SELECT * FROM notes WHERE entity_type = 'order' AND entity_id = ? "
                                 "ORDER BY id DESC", order_id)
        return o
    finally:
        conn.close()


ORDER_FIELDS = ["origin_zip", "dest_zip", "origin_country", "dest_country", "status",
                "fuel_surcharge_percent", "quote", "skid_dims", "skid_details",
                "freight_class", "weight_lbs"]


class OrderUpdate(BaseModel):
    origin_zip: Optional[str] = None
    dest_zip: Optional[str] = None
    origin_country: Optional[str] = None
    dest_country: Optional[str] = None
    status: Optional[str] = None
    fuel_surcharge_percent: Optional[str] = None
    quote: Optional[str] = None
    skid_dims: Optional[str] = Field(None, description="e.g. 48x40x50")
    skid_details: Optional[str] = Field(None, description="e.g. 2 pallets, stackable")
    freight_class: Optional[str] = None
    weight_lbs: Optional[str] = None
    agent_status: AgentStatus = None
    clear_agent_status: bool = False
    reason: str
    source_ref: Optional[str] = None


def _apply_order_changes(conn, order: dict, changes: dict, reason: str, source_ref=None):
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    conn.execute(f"UPDATE orders SET {sets}, last_updated_timestamp = :u WHERE id = :id",
                 {**changes, "u": stamp(), "id": order["id"]})
    _note(conn, "order", order["id"], "update", f"{reason} ({_diff(order, changes)})", source_ref)


@router.patch("/orders/{order_id}", dependencies=[Depends(require_api_key)],
              summary="Change allowed order fields (logged as a note)")
def update_order(order_id: str, body: OrderUpdate):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
        changes = body.model_dump(exclude_none=True,
                                  exclude={"reason", "source_ref", "clear_agent_status"})
        if body.clear_agent_status:
            changes["agent_status"] = None
        if not changes:
            raise HTTPException(422, "Nothing to change.")
        _apply_order_changes(conn, o, changes, body.reason, body.source_ref)
        conn.commit()
    finally:
        conn.close()
    return get_order(order_id)


# ── notes (the agent's activity log) ─────────────────────────────────

class NoteIn(BaseModel):
    entity_type: Literal["shipment", "order", "customer"]
    entity_id: str
    action: str = Field(..., description="Short tag, e.g. 'email_received', 'asked_carrier', 'handoff'")
    message: str
    source_ref: Optional[str] = None
    author: str = AGENT


@router.post("/notes", status_code=201, dependencies=[Depends(require_api_key)],
             summary="Add a note to the activity log")
def add_note(body: NoteIn):
    conn = get_db()
    try:
        _note(conn, body.entity_type, body.entity_id, body.action, body.message,
              body.source_ref, body.author)
        conn.commit()
        return _row(conn, "SELECT * FROM notes ORDER BY id DESC LIMIT 1")
    finally:
        conn.close()


@router.get("/notes", summary="Recent activity, newest first (optionally for one record)")
def list_notes(entity_type: Optional[str] = None, entity_id: Optional[str] = None,
               limit: int = Query(50, le=500)):
    sql, args = "SELECT * FROM notes WHERE 1=1", []
    if entity_type:
        sql, args = sql + " AND entity_type = ?", args + [entity_type]
    if entity_id:
        sql, args = sql + " AND entity_id = ?", args + [entity_id]
    conn = get_db()
    try:
        return _rows(conn, sql + " ORDER BY id DESC LIMIT ?", *args, limit)
    finally:
        conn.close()


# ── admin ────────────────────────────────────────────────────────────

@router.post("/admin/reset", dependencies=[Depends(require_api_key)],
             summary="Reset all TMS data to the demo starting state")
def reset():
    return reset_demo()


@router.get("/stats", summary="Numbers for the Agent Activity page")
def stats():
    conn = get_db()
    try:
        def by_status(table):
            return {r["agent_status"]: r["n"] for r in _rows(
                conn, f"SELECT agent_status, COUNT(*) AS n FROM {table} "
                      "WHERE agent_status IS NOT NULL GROUP BY agent_status")}
        open_exceptions = []
        for s in _rows(conn, "SELECT * FROM shipments WHERE status != 'Delivered' "
                             "ORDER BY pickup_appt_start DESC"):
            customer = _row(conn, "SELECT * FROM customers WHERE code = ?", s["customer_code"])
            load = _row(conn, "SELECT * FROM loads WHERE id = ?", s["load_id"]) if s["load_id"] else None
            driver = (_row(conn, "SELECT * FROM drivers WHERE id = ?", load["driver_id"])
                      if load and load["driver_id"] else None)
            result = checks.check_shipment(s, _milestones(conn, s["id"]), customer, load, driver, None)
            if result["recommendation"] != "answer_from_tms":
                open_exceptions.append({"shipment_id": s["id"], "route": f"{s['origin']} → {s['destination']}",
                                        "recommendation": result["recommendation"],
                                        "summary": result["summary"], "agent_status": s["agent_status"]})
        orders = _rows(conn, "SELECT * FROM orders")
        order_issues = [i for o in orders for i in checks.check_order(o)]
        return {
            "as_of": iso(now()),
            "notes_total": conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0],
            "shipments_updated": conn.execute(
                "SELECT COUNT(DISTINCT entity_id) FROM notes WHERE entity_type = 'shipment'").fetchone()[0],
            "orders_updated": conn.execute(
                "SELECT COUNT(DISTINCT entity_id) FROM notes WHERE entity_type = 'order'").fetchone()[0],
            "shipments_by_agent_status": by_status("shipments"),
            "orders_by_agent_status": by_status("orders"),
            "open_exceptions": open_exceptions,
            "order_data_quality": checks.summarize_order_issues(order_issues)["by_fix_class"],
        }
    finally:
        conn.close()


@router.get("/meta/milestone-codes", summary="Milestone codes and labels")
def milestone_codes():
    return [{"code": c, "label": v[1], "status_when_reached": v[2]} for c, v in MILESTONES.items()]


# ── agent tools ──────────────────────────────────────────────────────

@tools.get("/shipments/{shipment_id}/check",
           summary="What should the agent do about this shipment?")
def check_shipment(shipment_id: str,
                   sender: Optional[str] = Query(None, description="Email address the request came from")):
    conn = get_db()
    try:
        s = _shipment_or_404(conn, shipment_id)
        customer = _row(conn, "SELECT * FROM customers WHERE code = ?", s["customer_code"])
        load = _row(conn, "SELECT * FROM loads WHERE id = ?", s["load_id"]) if s["load_id"] else None
        driver = (_row(conn, "SELECT * FROM drivers WHERE id = ?", load["driver_id"])
                  if load and load["driver_id"] else None)
        return checks.check_shipment(s, _milestones(conn, shipment_id), customer, load, driver, sender)
    finally:
        conn.close()


@tools.get("/orders/{order_id}/check", summary="Data-quality findings for one order")
def check_order(order_id: str):
    conn = get_db()
    try:
        o = _order_or_404(conn, order_id)
    finally:
        conn.close()
    issues = checks.check_order(o)
    return {"order_id": order_id, "recommendation": checks.order_recommendation(issues),
            "issues": issues}


@tools.get("/orders/data-quality", summary="Sweep every order and report all findings")
def data_quality_report():
    conn = get_db()
    try:
        orders = _rows(conn, "SELECT * FROM orders ORDER BY id")
    finally:
        conn.close()
    issues = [i for o in orders for i in checks.check_order(o)]
    unassigned = sum(1 for o in orders if not (o["driver_id"] or "").strip())
    return {
        "checked_at": iso(now()), "orders_checked": len(orders),
        "orders_with_issues": len({i["order_id"] for i in issues}),
        **checks.summarize_order_issues(issues),
        "info": {"orders_without_driver": unassigned},
        "issues": issues,
    }


@tools.post("/orders/apply-safe-fixes", dependencies=[Depends(require_api_key)],
            summary="Apply every 'auto' fix across all orders (dry_run=true only previews)")
def apply_safe_fixes(dry_run: bool = True, source_ref: Optional[str] = None):
    conn = get_db()
    try:
        orders = _rows(conn, "SELECT * FROM orders ORDER BY id")
        applied, remaining = [], []
        for o in orders:
            issues = checks.check_order(o)
            auto = {i["field"]: i["suggested"] for i in issues
                    if i["fix_class"] == "auto" and i["suggested"] is not None}
            remaining += [i for i in issues if i["fix_class"] != "auto"]
            if auto:
                applied.append({"order_id": o["id"],
                                "changes": {k: {"from": o[k], "to": v} for k, v in auto.items()}})
                if not dry_run:
                    _apply_order_changes(conn, o, auto, "Data sweep: safe automatic fix", source_ref)
        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    return {
        "dry_run": dry_run,
        "orders_fixed": len(applied),
        "fields_fixed": sum(len(a["changes"]) for a in applied),
        "applied": applied,
        "still_open": checks.summarize_order_issues(remaining),
        "ask_customer": [i for i in remaining if i["fix_class"] == "ask_customer"],
        "needs_human": [i for i in remaining if i["fix_class"] == "needs_human"],
    }
