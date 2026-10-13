"""
checks.py — the rule-based checks the SMART API Agent calls as tools.

The AI in Qubi reads emails and writes replies. Decisions that must be
exact (is a milestone overdue? is this ZIP valid?) are made here in code,
so the agent gets the same answer every time.

Every finding has a fix_class:
    auto          the agent may fix it itself (the right value is certain)
    ask_carrier   only the carrier knows the answer
    ask_customer  only the customer knows the answer
    needs_human   risky or price-affecting: a person decides
    info          worth knowing, no action
"""
import re
from datetime import timedelta

from backend.tms.db import iso, now, parse
from backend.tms.milestones import (ARRIVAL_GRACE_MINUTES, LOADING_WINDOW_HOURS,
                                    UNLOADING_WINDOW_HOURS, default_label, step)

# ── Shipments ────────────────────────────────────────────────────────

FIELD_WORDS = {"truck_id": "truck", "driver_name": "driver"}


def _expected_milestones(s: dict, recorded: dict) -> list[dict]:
    """Due time for each core milestone, from the appointments and the 2-hour windows."""
    pickup_start = parse(s["pickup_appt_start"])
    delivery_start = parse(s["delivery_appt_start"])
    grace = timedelta(minutes=ARRIVAL_GRACE_MINUTES)
    out = []
    if pickup_start:
        out.append(("ARRSHIP", pickup_start + grace))
        arrived = recorded.get("ARRSHIP") or pickup_start
        out.append(("PICK", arrived + timedelta(hours=LOADING_WINDOW_HOURS)))
    if delivery_start:
        out.append(("ARRCONSIGNEE", delivery_start + grace))
        arrived = recorded.get("ARRCONSIGNEE") or delivery_start
        out.append(("DELV", arrived + timedelta(hours=UNLOADING_WINDOW_HOURS)))
    return [{"code": c, "label": default_label(c), "due_by": d} for c, d in out]


def check_shipment(s: dict, milestones: list[dict], customer: dict | None,
                   load: dict | None, driver: dict | None, sender: str | None) -> dict:
    t = now()
    recorded = {}
    for m in milestones:
        recorded.setdefault(m["code"], parse(m["event_time"]))
    furthest = max((step(c) for c in recorded), default=-1)

    # 1. Overdue milestones. A missing milestone only counts if nothing later was
    #    recorded (a recorded delivery implies the arrival happened).
    overdue = []
    for e in _expected_milestones(s, recorded):
        if e["code"] in recorded or step(e["code"]) < furthest:
            continue
        if t > e["due_by"]:
            overdue.append({**e, "due_by": iso(e["due_by"]),
                            "overdue_minutes": int((t - e["due_by"]).total_seconds() // 60),
                            "fix_class": "ask_carrier"})

    # 2. Missing fields, and whether another TMS record holds the answer.
    missing, internal_fixes = [], []
    for field in ("truck_id", "driver_name"):
        if not s.get(field):
            missing.append(field)
    if missing:
        if load and driver:
            evidence = (f"Shipment {s['id']} is on load {load['id']}, assigned to driver "
                        f"{driver['name']}, who drives {driver['truck_id']}.")
            if "truck_id" in missing and driver.get("truck_id"):
                internal_fixes.append({"field": "truck_id", "value": driver["truck_id"],
                                       "evidence": evidence, "fix_class": "auto"})
            if "driver_name" in missing:
                internal_fixes.append({"field": "driver_name", "value": driver["name"],
                                       "evidence": evidence, "fix_class": "auto"})
    fixed_fields = {f["field"] for f in internal_fixes}
    unresolved_fields = [{"field": f, "fix_class": "ask_carrier"}
                         for f in missing if f not in fixed_fields]

    # 3. Guardrails: reasons the agent must not act alone.
    guardrails = []
    if customer:
        if customer["on_hold"]:
            guardrails.append({"flag": "customer_on_hold",
                               "reason": f"Account {customer['code']} is on hold "
                                         f"({customer['hold_reason'] or 'no reason recorded'})."})
        email = (customer["email"] or "").strip()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            guardrails.append({"flag": "customer_email_invalid",
                               "reason": f"Customer email on file is unusable: {email!r}."})
        if sender and email and sender.strip().lower() != email.lower():
            guardrails.append({"flag": "sender_not_on_file",
                               "reason": f"Email came from {sender}, but the customer's "
                                         f"address on file is {email!r}."})

    # 4. Recommendation, most cautious first.
    if guardrails:
        rec = "needs_human"
    elif overdue or unresolved_fields:
        rec = "ask_carrier"
    elif internal_fixes:
        rec = "fix_internally"
    else:
        rec = "answer_from_tms"

    summary = {
        "needs_human": "Do not act alone: " + " ".join(g["reason"] for g in guardrails),
        "ask_carrier": "Ask the carrier: " + ", ".join(
            [f"{o['label']} overdue by {o['overdue_minutes']} min" for o in overdue] +
            [f"{FIELD_WORDS[u['field']]} missing" for u in unresolved_fields]) + ".",
        "fix_internally": "Fill in from TMS records: " + ", ".join(
            f"{FIELD_WORDS[f['field']]} {f['value']}" for f in internal_fixes) + ".",
        "answer_from_tms": "Everything is on track; answer from the TMS.",
    }[rec]

    return {
        "shipment_id": s["id"], "status": s["status"], "checked_at": iso(t),
        "recommendation": rec, "summary": summary,
        "overdue_milestones": overdue, "internal_fixes": internal_fixes,
        "unresolved_fields": unresolved_fields, "guardrails": guardrails,
    }


# ── Orders (orders.csv) ──────────────────────────────────────────────

VALID_FREIGHT_CLASSES = [50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150,
                         175, 200, 250, 300, 400, 500]
COUNTRY_CODES = {"US": "US", "USA": "US", "UNITED STATES": "US",
                 "CA": "CA", "CANADA": "CA"}
US_ZIP = re.compile(r"^\d{5}(-\d{4})?$")
CA_POSTAL = re.compile(r"^([A-Za-z]\d[A-Za-z]) ?(\d[A-Za-z]\d)$")
MIN_WEIGHT_LBS = 10
MAX_LTL_WEIGHT_LBS = 20000


def _postal_country(code: str) -> str | None:
    if US_ZIP.match(code):
        return "US"
    if CA_POSTAL.match(code):
        return "CA"
    return None


def _num(text: str) -> float | None:
    try:
        return float(str(text).replace("$", "").replace(",", ""))
    except ValueError:
        return None


def check_order(o: dict) -> list[dict]:
    """Every data-quality finding for one order."""
    issues = []

    def add(field, problem, current, suggested, fix_class):
        issues.append({"order_id": o["id"], "field": field, "problem": problem,
                       "current": current, "suggested": suggested, "fix_class": fix_class})

    # Countries and postal codes, origin and destination.
    for side in ("origin", "dest"):
        cf, zf = f"{side}_country", f"{side}_zip"
        country_raw, postal = (o[cf] or "").strip(), (o[zf] or "").strip()
        country = COUNTRY_CODES.get(country_raw.upper())
        postal_country = _postal_country(postal)

        if country is None:
            add(cf, "Unknown country value", country_raw, None, "needs_human")
        elif postal_country and postal_country != country:
            add(cf, f"Country says {country}, but {postal} is a "
                    f"{'Canadian' if postal_country == 'CA' else 'US'} postal code",
                country_raw, postal_country, "auto")
        elif country_raw != country:
            add(cf, "Non-standard country value", country_raw, country, "auto")

        if postal_country is None:
            add(zf, "Not a valid US ZIP or Canadian postal code", postal, None, "ask_customer")
        elif postal_country == "CA":
            m = CA_POSTAL.match(postal)
            formatted = f"{m.group(1)} {m.group(2)}".upper()
            if postal != formatted:
                add(zf, "Canadian postal code not in standard format", postal, formatted, "auto")

    # Fuel surcharge stored as a fraction (0.2) instead of a percent (20.0).
    fsc = _num(o["fuel_surcharge_percent"])
    if fsc is not None and 0 < fsc < 1:
        add("fuel_surcharge_percent", "Looks like a fraction, not a percent",
            o["fuel_surcharge_percent"], f"{fsc * 100:.1f}", "auto")

    # Status spelling.
    status = (o["status"] or "").strip()
    normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", status).lower().replace(" ", "_")
    if status and status != normalized:
        add("status", "Non-standard status spelling", status, normalized, "auto")

    # Pallet dimensions and quote. "unknown" counts as missing. It only blocks
    # anything when there's no quote yet; otherwise it's just worth knowing.
    dims_raw = (o["skid_dims"] or "").strip()
    dims_missing = dims_raw.lower() in ("", "unknown")
    quote = (o["quote"] or "").strip()
    if dims_missing:
        if quote:
            add("skid_dims", "Pallet dimensions not recorded", dims_raw, None, "info")
        else:
            add("skid_dims", "Pallet dimensions missing", dims_raw, None, "ask_customer")
    if not quote:
        add("quote", "No quote" + (" (blocked by missing pallet dimensions)" if dims_missing
                                   else " (needs pricing)"),
            "", None, "ask_customer" if dims_missing else "needs_human")
    elif not quote.startswith("$"):
        value = _num(quote)
        if value is not None:
            pretty = f"${value:.2f}" if value != int(value) else f"${int(value)}"
            add("quote", "Quote not in the standard $ format", quote, pretty, "auto")

    # Freight class must be a standard NMFC class; changing it changes the price.
    fc = _num(o["freight_class"])
    if fc is None or fc not in VALID_FREIGHT_CLASSES:
        nearest = (min(VALID_FREIGHT_CLASSES, key=lambda v: abs(v - fc)) if fc is not None else None)
        add("freight_class", "Not a standard freight class", o["freight_class"],
            str(nearest) if nearest is not None else None, "needs_human")

    # Weight outside what makes sense for an LTL shipment.
    w = _num(o["weight_lbs"])
    if w is None or w < MIN_WEIGHT_LBS or w > MAX_LTL_WEIGHT_LBS:
        add("weight_lbs", f"Weight outside {MIN_WEIGHT_LBS:,}-{MAX_LTL_WEIGHT_LBS:,} lb LTL range",
            o["weight_lbs"], None, "needs_human")

    return issues


def summarize_order_issues(issues: list[dict]) -> dict:
    by_class: dict[str, int] = {}
    by_problem: dict[str, int] = {}
    for i in issues:
        by_class[i["fix_class"]] = by_class.get(i["fix_class"], 0) + 1
        key = f"{i['field']}: {i['problem']}"
        by_problem[key] = by_problem.get(key, 0) + 1
    return {"total_issues": len(issues), "by_fix_class": by_class,
            "by_problem": dict(sorted(by_problem.items(), key=lambda kv: -kv[1]))}


def order_recommendation(issues: list[dict]) -> str:
    classes = {i["fix_class"] for i in issues}
    for rec in ("needs_human", "ask_customer", "auto"):
        if rec in classes:
            return rec
    return "no_issues"
