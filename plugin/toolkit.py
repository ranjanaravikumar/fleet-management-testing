"""
toolkit.py — the checks and fixes Flow 1 calls: /api/agent-tools/...

Same paths and answers as the agent-integrated TMS had, so the Qubi flows
are unchanged. The difference is underneath: every read and every fix goes
through the TMS's normal API.
"""
import json
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from plugin import cases as case_store, checks, config, tms_client
from plugin.auth import require_api_key
from plugin.cases import load_case, post_to_customer, set_status
from plugin.clock import PHOENIX, iso, now, parse, stamp
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


def _tell_customer_of_fix(case_id: str, shipment_id: str, applied: dict) -> bool:
    """When a customer asked, say what was filled in. A case the detector found says nothing."""
    parts = [f"{label} {applied[field]}" for field, label in (("truck_id", "truck"), ("driver_name", "driver"))
             if field in applied]
    if not parts:
        return False
    with write_lock:
        conn = get_db()
        try:
            try:
                c = load_case(conn, case_id)
            except HTTPException:
                return False
            if c["channel"] == "monitor" or c["shipment_id"] != shipment_id:
                return False
            post_to_customer(conn, c, "agent", f"We've updated shipment {shipment_id}: {', '.join(parts)}.")
            conn.commit()
            return True
        finally:
            conn.close()


@tools.post("/shipments/{shipment_id}/apply-fixes", dependencies=[Depends(require_api_key)],
            summary="Apply the safe fixes the shipment check found in other TMS records")
def apply_shipment_fixes(shipment_id: str, body: Optional[ApplyFixesIn] = None):
    result = shipment_check(shipment_id)
    fixes = [f for f in result["internal_fixes"] if f["fix_class"] == "auto"]
    ref = body.source_ref if body else None
    shipment, notified = None, False
    if fixes:
        shipment = tms_client.update_shipment(
            shipment_id, {f["field"]: f["value"] for f in fixes},
            f"Filled in from TMS records. {fixes[0]['evidence']}", ref)
        if ref and ref.startswith("CASE-"):
            notified = _tell_customer_of_fix(ref, shipment_id, {f["field"]: f["value"] for f in fixes})
    return {"applied": {f["field"]: f["value"] for f in fixes}, "customer_notified": notified,
            "shipment": shipment or tms_client.shipment(shipment_id)}


# ── Deciding what to do with a case ──────────────────────────────────
#
# The AI classifier in Flow 1 reads the customer's words and says what they want.
# This is where the decision is made: a fixed set of rules that no model can
# talk its way around. The classifier can only pick a topic; it can't pick an action.

# Topics a person always handles, whatever the shipment looks like.
HUMAN_ONLY = {
    "change_request": "Changing a delivery or other commitment is a person's call.",
    "quote_question": "Prices and quotes go through a person.",
}


def _blank_to_none(value):
    """A flow sends '', 'null' or 'none' for a value it doesn't have."""
    if isinstance(value, str) and value.strip().lower() in ("", "null", "none", "undefined"):
        return None
    return value


class DecideIn(BaseModel):
    category: Optional[str] = Field(None, description="The classifier's pick: status_update, truck_number, "
                                    "change_request, quote_question or other")
    confidence: Optional[float] = Field(None, description="How sure the classifier is, 0 to 1")
    sender: Optional[str] = Field(None, description="Email address the request came from")

    @field_validator("category", "confidence", "sender", mode="before")
    @classmethod
    def _blank(cls, value):
        return _blank_to_none(value)

    @model_validator(mode="before")
    @classmethod
    def _unwrap(cls, data):
        """If the whole classifier output arrived as JSON text in `category`, read the fields out of it."""
        if isinstance(data, dict) and isinstance(data.get("category"), str) and data["category"].strip().startswith(("{", "`")):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", data["category"].strip()).strip()
            try:
                inner = json.loads(text)
            except ValueError:
                return data
            if isinstance(inner, dict):
                given = _blank_to_none(data.get("confidence"))
                data = {**data, "category": inner.get("category"),
                        "confidence": given if given is not None else inner.get("confidence")}
        return data


def _final_category(c: dict, body: DecideIn) -> tuple[str, str, str | None]:
    """The topic to act on, where it came from, and a reason to hand over if the classifier is unsure."""
    if c["channel"] == "monitor":                       # the detector already knows what's wrong
        return c["category"], "detector", None
    ai = (body.category or "").strip().lower()
    if ai not in case_store.CATEGORIES or ai == "new_order":
        return c["category"], "rules", None             # nothing usable: keep the keyword reading
    confidence = body.confidence
    if confidence is not None and confidence > 1:
        confidence /= 100                               # a percentage
    if confidence is not None and confidence < config.CLASSIFIER_MIN_CONFIDENCE:
        return ai, "ai", f"The request classifier was unsure ({confidence:.2f})."
    return ai, "ai", None


@tools.post("/cases/{case_id}/decide", dependencies=[Depends(require_api_key)],
            summary="What should the agent do with this case? Combines the shipment check with the request topic")
def decide_case(case_id: str, body: Optional[DecideIn] = None):
    body = body or DecideIn()
    conn = get_db()
    try:
        c = load_case(conn, case_id)
    finally:
        conn.close()

    if c["record_type"] != "shipment":
        reason = "Flow 1 works on shipments; order cases are handled by the plugin."
        return {"case_id": case_id, "shipment_id": None, "recommendation": "needs_human", "summary": reason,
                "overdue_milestones": [], "internal_fixes": [], "unresolved_fields": [],
                "guardrails": [{"flag": "not_a_shipment_case", "reason": reason}],
                "category": c["category"], "category_source": "detector"}

    shipment = tms_client.shipment(c["shipment_id"])
    result = shipment_check(c["shipment_id"], sender=body.sender, s=shipment)
    category, source, unsure = _final_category(c, body)

    # What the customer asked decides what matters. A truck or driver question is answered by
    # the TMS when both are on record, even if a milestone is overdue (that is a question for the carrier).
    if (category == "truck_number" and result["recommendation"] == "ask_carrier"
            and shipment.get("truck_id") and shipment.get("driver_name")):
        result["recommendation"] = "answer_from_tms"
        result["summary"] = "The truck and driver are on record; answer from the TMS."

    guardrails = list(result["guardrails"])
    if unsure:
        guardrails.append({"flag": "classifier_unsure", "reason": unsure})
    if category in HUMAN_ONLY:
        guardrails.append({"flag": f"policy_{category}", "reason": HUMAN_ONLY[category]})
    if len(guardrails) > len(result["guardrails"]):
        result["guardrails"] = guardrails
        result["recommendation"] = "needs_human"
        result["summary"] = "Do not act alone: " + " ".join(g["reason"] for g in guardrails)

    if source == "ai":   # keep the classification on the record: the case, and a note staff can read
        with write_lock:
            conn = get_db()
            try:
                if category != c["category"]:
                    conn.execute("UPDATE cases SET category = ?, updated_at = ? WHERE id = ?",
                                 (category, stamp(), case_id))
                label = case_store.CATEGORIES[category]
                confidence = f" (confidence {body.confidence})" if body.confidence is not None else ""
                case_store.add_system_message(conn, case_id, f"Request read as \"{label}\"{confidence}. "
                                              f"Decision: {result['recommendation']}.", "Qubiway classifier")
                conn.commit()
            finally:
                conn.close()
        tms_client.add_note("shipment", c["shipment_id"],
                            f"Request read as \"{label}\"{confidence}. Decision: {result['recommendation']}.",
                            action="classified", source_ref=case_id)

    return {**result, "case_id": case_id, "category": category,
            "category_label": case_store.CATEGORIES[category], "category_source": source}


# ── A carrier's reply (Flow 2) ───────────────────────────────────────

class CarrierReplyIn(BaseModel):
    case_id: Optional[str] = Field(None, description="Left empty, the shipment's case waiting on the carrier is used")
    arrived_at: Optional[str] = Field(None, description="Arrival at the consignee, ISO 8601 with a time zone")
    delivered_at: Optional[str] = Field(None, description="Delivery time, ISO 8601 with a time zone")
    signed_by: Optional[str] = None
    summary: Optional[str] = Field(None, description="One sentence on what the carrier said")
    source_ref: Optional[str] = Field(None, description="e.g. the email subject")

    @field_validator("*", mode="before")
    @classmethod
    def _blank(cls, value):
        return _blank_to_none(value)


def _friendly(iso_text: str) -> str:
    return parse(iso_text).astimezone(PHOENIX).strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _waiting_case(shipment_id: str) -> str | None:
    conn = get_db()
    try:
        r = conn.execute("SELECT id FROM cases WHERE shipment_id = ? AND status = 'awaiting_carrier' "
                         "ORDER BY updated_at DESC LIMIT 1", (shipment_id,)).fetchone()
        return r["id"] if r else None
    finally:
        conn.close()


@tools.post("/shipments/{shipment_id}/carrier-reply", dependencies=[Depends(require_api_key)],
            summary="Record what a carrier's email said: milestones, notes, the customer's update and the case")
def carrier_reply(shipment_id: str, body: CarrierReplyIn):
    s = tms_client.shipment(shipment_id)
    have = {m["code"] for m in s["milestones"]}
    ref = body.source_ref or body.case_id
    recorded, skipped, problems = [], [], []

    def record(code: str, when: str, label: str | None = None):
        if code in have:
            skipped.append(code)
            return
        try:
            tms_client.write("POST", f"/api/shipments/{shipment_id}/milestones", {
                "code": code, "event_time": when, "location": s["destination"], "label": label,
                "source": "carrier", "reason": "Carrier confirmed by email", "source_ref": ref,
                "author": config.AGENT_NAME})
        except HTTPException as e:
            if e.status_code == 409:
                skipped.append(code)
            else:   # a time that doesn't fit the timeline, or one in the future: a person looks at it
                problems.append(f"{code}: {e.detail}")
            return
        recorded.append(code)
        have.add(code)

    if body.arrived_at:
        record("ARRCONSIGNEE", body.arrived_at)
    if body.delivered_at:
        record("DELV", body.delivered_at, f"Delivered, signed by {body.signed_by}" if body.signed_by else None)

    carrier = s.get("carrier_name") or "The carrier"
    place = s["destination"]
    if problems or not (recorded or skipped):
        outcome, customer_text = "needs_human", None
    elif "DELV" in have:
        outcome = "resolved"
        when = f" at {_friendly(body.delivered_at)}" if body.delivered_at and "DELV" in recorded else ""
        signed = f", signed by {body.signed_by}" if body.signed_by else ""
        customer_text = f"{carrier} confirmed delivery in {place}{when}{signed}." if "DELV" in recorded else None
    else:
        outcome = "awaiting_carrier"   # arrived, not yet delivered
        customer_text = (f"{carrier} confirmed arrival in {place} at {_friendly(body.arrived_at)}."
                         if "ARRCONSIGNEE" in recorded else None)

    said = body.summary or "Carrier replied."
    detail = (f" Recorded {', '.join(recorded)}." if recorded else "") + \
             (f" Already recorded: {', '.join(skipped)}." if skipped else "") + \
             (f" Could not record: {'; '.join(problems)}." if problems else "") + \
             ("" if (recorded or skipped or problems) else " It gave no arrival or delivery time.")
    tms_client.add_note("shipment", shipment_id, f"Carrier reply: {said}{detail}", action="carrier_reply",
                        author=carrier, author_type="carrier", source_ref=ref)

    case_id = body.case_id or _waiting_case(shipment_id)
    case_status = None
    if case_id:
        with write_lock:
            conn = get_db()
            try:
                c = load_case(conn, case_id)
                if customer_text:
                    post_to_customer(conn, c, "agent", customer_text)
                if outcome != c["status"]:
                    set_status(conn, c, outcome, "; ".join(problems) or (
                        "The carrier's reply had no arrival or delivery time." if outcome == "needs_human" else None),
                        notify=customer_text is None)
                conn.commit()
                case_status = outcome
            finally:
                conn.close()

    return {"shipment_id": shipment_id, "recorded": recorded, "skipped": skipped, "problems": problems,
            "case_id": case_id, "case_status": case_status, "customer_message": customer_text,
            "shipment_status": tms_client.shipment(shipment_id)["status"]}


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
