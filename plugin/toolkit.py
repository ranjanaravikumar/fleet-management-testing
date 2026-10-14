"""
toolkit.py — the checks and fixes Flow 1 calls: /api/agent-tools/...

Same paths and answers as the agent-integrated TMS had, so the Qubi flows
are unchanged. The difference is underneath: every read and every fix goes
through the TMS's normal API.
"""
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from plugin import checks, config, tms_client
from plugin.auth import require_api_key
from plugin.cases import load_case, post_to_customer, set_status
from plugin.clock import iso, now
from plugin.store import get_db, write_lock

tools = APIRouter(prefix="/api/agent-tools", tags=["Toolkit"])
orders = APIRouter(prefix="/api/orders", tags=["Toolkit"])


# ── Shipments ────────────────────────────────────────────────────────

def shipment_check(shipment_id: str, sender: str | None = None, s: dict | None = None) -> dict:
    s = s or tms_client.shipment(shipment_id)
    return checks.check_shipment(s, s["milestones"], s["customer"], s["load"], s["driver"], sender)


@tools.get("/shipments/{shipment_id}/check", summary="What should the agent do about this shipment?")
def check_shipment(shipment_id: str,
                   sender: Optional[str] = Query(None, description="Email address the request came from")):
    return shipment_check(shipment_id, sender)


class ApplyFixesIn(BaseModel):
    source_ref: Optional[str] = Field(None, description="e.g. the case ID, saved with the change")


@tools.post("/shipments/{shipment_id}/apply-fixes", dependencies=[Depends(require_api_key)],
            summary="Apply the safe fixes the shipment check found in other TMS records")
def apply_shipment_fixes(shipment_id: str, body: Optional[ApplyFixesIn] = None):
    result = shipment_check(shipment_id)
    fixes = [f for f in result["internal_fixes"] if f["fix_class"] == "auto"]
    shipment = None
    if fixes:
        shipment = tms_client.update_shipment(
            shipment_id, {f["field"]: f["value"] for f in fixes},
            f"Filled in from TMS records. {fixes[0]['evidence']}", body.source_ref if body else None)
    return {"applied": {f["field"]: f["value"] for f in fixes},
            "shipment": shipment or tms_client.shipment(shipment_id)}


# ── Orders ───────────────────────────────────────────────────────────

@tools.get("/orders/data-quality", summary="Sweep every order and report all findings")
def data_quality_report():
    all_orders = sorted(tms_client.all_orders(), key=lambda o: o["id"])
    issues = [i for o in all_orders for i in checks.check_order(o)]
    unassigned = sum(1 for o in all_orders if not (o["driver_id"] or "").strip())
    return {
        "checked_at": iso(now()), "orders_checked": len(all_orders),
        "orders_with_issues": len({i["order_id"] for i in issues}),
        **checks.summarize_order_issues(issues),
        "info": {"orders_without_driver": unassigned},
        "issues": issues,
    }


@tools.get("/orders/{order_id}/check", summary="Data-quality findings for one order")
def check_order(order_id: str):
    issues = checks.check_order(tms_client.order(order_id))
    return {"order_id": order_id, "recommendation": checks.order_recommendation(issues), "issues": issues}


# Fields the toolkit may write on an order through the TMS API.
ORDER_WRITABLE = {"origin_country", "dest_country", "origin_zip", "dest_zip", "origin_state", "dest_state",
                  "weight_lbs", "pallet_count", "skid_dims", "freight_class", "fuel_surcharge_percent",
                  "status", "quote"}


@tools.post("/orders/apply-safe-fixes", dependencies=[Depends(require_api_key)],
            summary="Apply every 'auto' fix across all orders (dry_run=true only previews)")
def apply_safe_fixes(dry_run: bool = True, source_ref: Optional[str] = None):
    applied, remaining = [], []
    for o in sorted(tms_client.all_orders(), key=lambda o: o["id"]):
        issues = checks.check_order(o)
        auto = {i["field"]: i["suggested"] for i in issues
                if i["fix_class"] == "auto" and i["suggested"] is not None and i["field"] in ORDER_WRITABLE}
        remaining += [i for i in issues if i["fix_class"] != "auto"]
        if auto:
            applied.append({"order_id": o["id"], "changes": {k: {"from": o[k], "to": v} for k, v in auto.items()}})
            if not dry_run:
                tms_client.update_order(o["id"], auto, "Data sweep: safe automatic fix", source_ref)
    return {
        "dry_run": dry_run,
        "orders_fixed": len(applied),
        "fields_fixed": sum(len(a["changes"]) for a in applied),
        "applied": applied,
        "still_open": checks.summarize_order_issues(remaining),
        "ask_customer": [i for i in remaining if i["fix_class"] == "ask_customer"],
        "needs_human": [i for i in remaining if i["fix_class"] == "needs_human"],
    }


class ApproveFixIn(BaseModel):
    field: Literal["origin_country", "dest_country", "origin_zip", "dest_zip", "origin_state", "dest_state",
                   "weight_lbs", "pallet_count", "skid_dims", "freight_class"]
    value: str
    approved_by: str = "Operations"


@orders.post("/{order_id}/approve-fix", dependencies=[Depends(require_api_key)],
             summary="A person approves a suggested fix (e.g. from an ActionHub task)")
def approve_fix(order_id: str, body: ApproveFixIn):
    return tms_client.update_order(order_id, {body.field: body.value}, "Approved suggestion",
                                   author=body.approved_by)


# ── New order review ─────────────────────────────────────────────────

# Fields the agent can ask the customer for, as form fields.
FORM_FIELDS = {
    "skid_dims": ("dims", "Pallet size, L x W x H in inches"),
    "pallet_count": ("pallets", "Number of pallets"),
    "weight_lbs": ("weight", "Total weight (lb)"),
    "origin_zip": ("origin_zip", "Pickup postal code"),
    "dest_zip": ("dest_zip", "Delivery postal code"),
    "origin_state": ("origin_state", "Pickup state or province"),
    "dest_state": ("dest_state", "Delivery state or province"),
    "origin_country": ("origin_country", "Pickup country"),
    "dest_country": ("dest_country", "Delivery country"),
}
FORM_TO_FIELD = {form_name: field for field, (form_name, _) in FORM_FIELDS.items()}
LABELS = {"origin_country": "pickup country", "dest_country": "delivery country",
          "origin_zip": "pickup postal code", "dest_zip": "delivery postal code",
          "origin_state": "pickup state", "dest_state": "delivery state", "weight_lbs": "weight",
          "pallet_count": "pallet count", "skid_dims": "pallet size", "freight_class": "freight class"}
REVIEW_WRITABLE = set(FORM_FIELDS) | {"freight_class"}


def _describe_fix(a: dict) -> str:
    """One fix in customer words: 'pickup state arizona → AZ', 'added delivery state QC'."""
    label = LABELS.get(a["field"], a["field"])
    to = a["to"]
    if a["field"] == "weight_lbs":
        to = f"{float(to):,.0f} lb"
    elif a["field"] == "skid_dims":
        to = f"{to.replace('x', ' x ')} in"
    if not a["from"]:
        return f"added the {label} ({to})"
    if a["field"] == "weight_lbs" and re.sub(r"[\s,]", "", a["from"]).lower() == re.sub(r"[\s,]", "", to).lower():
        return ""   # only a storage format change; nothing the customer would notice
    return f"{label} \"{a['from']}\" → {to}"


def review_order(order_id: str, case_id: str | None) -> dict:
    o = tms_client.order(order_id)
    c = None
    if case_id:
        conn = get_db()
        try:
            c = load_case(conn, case_id)
        finally:
            conn.close()
        if c["order_id"] != order_id:
            raise HTTPException(422, f"{case_id} is not about order {order_id}.")
    applied = []

    def write(changes: dict, why: str, author=config.AGENT_NAME):
        nonlocal o
        if changes:
            o = tms_client.update_order(order_id, changes, why, case_id, author=author)

    # 1. The customer's answers to an earlier question, taken as typed (then checked like everything else).
    answers = (c or {}).get("latest_form_response") or {}
    from_customer = {FORM_TO_FIELD[k]: str(v).strip() for k, v in answers.items()
                     if k in FORM_TO_FIELD and str(v).strip() and str(v).strip() != (o.get(FORM_TO_FIELD[k]) or "")}
    write(from_customer, "Customer's answers recorded", author="Customer")

    # 2. Safe fixes, repeated in case one fix makes another possible (e.g. a country, then a province).
    for _ in range(3):
        fixes = {i["field"]: i["suggested"] for i in checks.check_order(o)
                 if i["fix_class"] == "auto" and i["suggested"] is not None and i["field"] in REVIEW_WRITABLE}
        if not fixes:
            break
        for field, value in fixes.items():
            applied.append({"field": field, "from": o.get(field) or "", "to": value})
        write(fixes, "Order review: safe automatic fix")

    # 3. What's left decides the next step. The quote waits on pricing, so it doesn't count here.
    open_issues = [i for i in checks.check_order(o) if i["field"] != "quote" and i["fix_class"] != "info"]
    ask = [i for i in open_issues if i["fix_class"] == "ask_customer"]
    person = [i for i in open_issues if i["fix_class"] in ("needs_human", "suggested")]

    tidy = ""
    visible = [a for a in applied if _describe_fix(a)]
    if visible:
        tidy = "We tidied up a few details: " + "; ".join(_describe_fix(a) for a in visible) + ". "
    if ask:
        fields, seen = [], set()
        for i in ask:
            if i["field"] in FORM_FIELDS and i["field"] not in seen:
                seen.add(i["field"])
                fields.append({"name": FORM_FIELDS[i["field"]][0], "label": FORM_FIELDS[i["field"]][1]})
        next_step, status = "ask_customer", "awaiting_customer"
        needs = "; ".join(f"the {LABELS.get(i['field'], i['field'])}" if "missing" in i["problem"].lower()
                          else f"you to check the {LABELS.get(i['field'], i['field'])} "
                               f"({i['problem'][0].lower() + i['problem'][1:]})" for i in ask)
        message = (f"Thanks for order {order_id}. {tidy}To finish your order we need {needs}. "
                   + ("Please reply with the details below." if fields else "Please reply here."))
        form = {"fields": fields} if fields else None
    elif person:
        next_step, status, form = "needs_person", "needs_human", None
        topics = list(dict.fromkeys(LABELS.get(i["field"], i["field"]) for i in person))
        message = (f"Thanks, order {order_id} is in. {tidy}Our team is confirming the "
                   + (" and ".join(topics) if len(topics) <= 2 else ", ".join(topics[:-1]) + " and " + topics[-1])
                   + " and will update you here.")
    else:
        next_step, status, form = "confirmed", "needs_human", None
        message = f"Thanks, order {order_id} is confirmed. {tidy}Our pricing team will send your quote shortly."
    message = message.replace("  ", " ").strip()

    if c:
        with write_lock:
            conn = get_db()
            try:
                post_to_customer(conn, c, "agent", message, form=form)
                c = load_case(conn, case_id)
                if c["status"] != status:
                    set_status(conn, c, status, None)
                conn.commit()
            finally:
                conn.close()
    return {"order_id": order_id, "next_step": next_step, "applied": applied, "message": message,
            "form": form, "open_issues": open_issues}


class ReviewIn(BaseModel):
    case_id: Optional[str] = Field(None, description="The order's case; the review writes its message there")


@tools.post("/orders/{order_id}/review", dependencies=[Depends(require_api_key)],
            summary="Review an order: use the customer's answers, apply safe fixes, then ask, hand over or confirm")
def review(order_id: str, body: Optional[ReviewIn] = None):
    return review_order(order_id, body.case_id if body else None)
