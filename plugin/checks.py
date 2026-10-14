"""
checks.py — the rule-based checks behind the toolkit and the detector.

The AI in Qubi reads emails and writes replies. Decisions that must be
exact (is a milestone overdue? is this ZIP valid?) are made here in code,
so the agent gets the same answer every time. Everything here works on
plain records as the TMS API returns them; nothing here talks to the TMS.

Every finding has a fix_class:
    auto          the agent may fix it itself (the right value is certain)
    ask_carrier   only the carrier knows the answer
    ask_customer  only the customer knows the answer
    needs_human   risky or price-affecting: a person decides
    info          worth knowing, no action
"""
import difflib
import re
from datetime import timedelta

from plugin.clock import iso, now, parse
from plugin.milestones import (ARRIVAL_GRACE_MINUTES, LOADING_WINDOW_HOURS,
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


# ── Orders ──────────────────────────────────────────────

VALID_FREIGHT_CLASSES = [50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150,
                         175, 200, 250, 300, 400, 500]
COUNTRY_CODES = {"US": "US", "USA": "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US",
                 "AMERICA": "US", "CA": "CA", "CAN": "CA", "CANADA": "CA"}
# Full names used to suggest a likely country when the value is a typo.
COUNTRY_NAMES = {"UNITED STATES": "US", "CANADA": "CA", "AMERICA": "US"}

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "PR": "Puerto Rico", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
CA_PROVINCES = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador", "NS": "Nova Scotia", "NT": "Northwest Territories",
    "NU": "Nunavut", "ON": "Ontario", "PE": "Prince Edward Island", "QC": "Quebec",
    "SK": "Saskatchewan", "YT": "Yukon",
}
# The first digit of a US ZIP code fixes its region (USPS national areas).
US_ZIP_REGION = {
    "0": {"CT", "MA", "ME", "NH", "NJ", "PR", "RI", "VT"}, "1": {"DE", "NY", "PA"},
    "2": {"DC", "MD", "NC", "SC", "VA", "WV"}, "3": {"AL", "FL", "GA", "MS", "TN"},
    "4": {"IN", "KY", "MI", "OH"}, "5": {"IA", "MN", "MT", "ND", "SD", "WI"},
    "6": {"IL", "KS", "MO", "NE"}, "7": {"AR", "LA", "OK", "TX"},
    "8": {"AZ", "CO", "ID", "NM", "NV", "UT", "WY"}, "9": {"AK", "CA", "HI", "OR", "WA"},
}
# The first letter of a Canadian postal code fixes its province.
CA_POSTAL_PROVINCE = {
    "A": {"NL"}, "B": {"NS"}, "C": {"PE"}, "E": {"NB"}, "G": {"QC"}, "H": {"QC"}, "J": {"QC"},
    "K": {"ON"}, "L": {"ON"}, "M": {"ON"}, "N": {"ON"}, "P": {"ON"}, "R": {"MB"}, "S": {"SK"},
    "T": {"AB"}, "V": {"BC"}, "X": {"NT", "NU"}, "Y": {"YT"},
}
REGION_NAMES = {code: name for code, name in {**US_STATES, **CA_PROVINCES}.items()}

# Density-based freight classes: (minimum lb per cubic foot, class), densest first.
DENSITY_CLASSES = [(50, 50), (35, 55), (30, 60), (22.5, 65), (15, 70), (13.5, 77.5), (12, 85),
                   (10.5, 92.5), (9, 100), (8, 110), (7, 125), (6, 150), (5, 175), (4, 200),
                   (3, 250), (2, 300), (1, 400), (0, 500)]
MAX_LTL_PALLETS = 12
MAX_PALLET_SIDE_IN = 96       # wider or longer than this doesn't fit a pallet position
MAX_PALLET_HEIGHT_IN = 100
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


def _country_code(raw: str) -> str | None:
    key = re.sub(r"\s+", " ", raw.replace(".", "")).strip().upper()
    return COUNTRY_CODES.get(key)


def _likely(raw: str, choices: dict) -> str | None:
    """A likely match for a typo, e.g. 'Untied States' -> 'US'. Only ever a suggestion."""
    key = re.sub(r"\s+", " ", raw.replace(".", "")).strip().upper()
    hit = difflib.get_close_matches(key, list(choices), n=1, cutoff=0.75)
    return choices[hit[0]] if hit else None


def _region_code(raw: str) -> str | None:
    """'az', 'AZ', 'Arizona', 'ontario' -> 'AZ' / 'ON'."""
    key = raw.strip().upper()
    if key in REGION_NAMES:
        return key
    by_name = {name.upper(): code for code, name in REGION_NAMES.items()}
    return by_name.get(re.sub(r"\s+", " ", key))


def _parse_weight(text: str) -> float | None:
    """'1,200 lbs', '1200 lb', '545 kg' -> pounds."""
    m = re.fullmatch(r"\s*([\d,]+(?:\.\d+)?)\s*(lbs?|pounds?|#|kgs?|kilos?|kilograms?)?\s*", text or "", re.I)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "lb").lower()
    return round(value * 2.20462, 1) if unit.startswith("k") else value


def _parse_dims(text: str) -> tuple[int, int, int] | None:
    """'48 x 40 x 50 in', '48X40X50', '48*40*50', '48 by 40 by 50' -> (48, 40, 50)."""
    cleaned = re.sub(r"(?i)(?<=\d)\s*(inches|inch|in)\b|\b(inches|inch|in)\b|[\"″]", " ", (text or "").strip()).strip()
    parts = re.split(r"\s*(?:x|\*|by|×)\s*", cleaned, flags=re.I)
    if len(parts) != 3:
        return None
    try:
        dims = tuple(int(round(float(p))) for p in parts)
    except ValueError:
        return None
    return dims if all(d > 0 for d in dims) else None


def density_class(weight_lb: float, pallets: int, dims: tuple[int, int, int]) -> tuple[float, float]:
    """(density in lb/ft³, freight class) for the whole shipment."""
    cubic_ft = pallets * dims[0] * dims[1] * dims[2] / 1728
    density = weight_lb / cubic_ft
    return round(density, 1), next(c for minimum, c in DENSITY_CLASSES if density >= minimum)


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
        country = _country_code(country_raw)
        postal_country = _postal_country(postal)

        if country is None:
            likely = _likely(country_raw, COUNTRY_NAMES) if country_raw else None
            if likely:
                add(cf, f"Unknown country value; likely {likely}", country_raw, likely, "suggested")
            elif not country_raw and o.get("source") == "portal":
                add(cf, "Country missing", country_raw, postal_country, "auto" if postal_country else "ask_customer")
            else:
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
    portal_blank_class = o.get("source") == "portal" and not (o["freight_class"] or "").strip()
    if not portal_blank_class and (fc is None or fc not in VALID_FREIGHT_CLASSES):
        nearest = (min(VALID_FREIGHT_CLASSES, key=lambda v: abs(v - fc)) if fc is not None else None)
        add("freight_class", "Not a standard freight class", o["freight_class"],
            str(nearest) if nearest is not None else None, "needs_human")

    # Weight: understand units ("1,200 lbs", "545 kg"), then check the LTL range.
    w = _num(o["weight_lbs"])
    if w is None:
        w = _parse_weight(o["weight_lbs"])
        if w is not None:
            add("weight_lbs", "Weight written with units or commas", o["weight_lbs"], f"{w:.1f}", "auto")
    if w is None:
        add("weight_lbs", "Weight is not a number", o["weight_lbs"], None,
            "ask_customer" if o.get("source") == "portal" else "needs_human")
    elif w < MIN_WEIGHT_LBS or w > MAX_LTL_WEIGHT_LBS:
        add("weight_lbs", f"Weight outside {MIN_WEIGHT_LBS:,}-{MAX_LTL_WEIGHT_LBS:,} lb LTL range",
            o["weight_lbs"], None, "needs_human")

    if o.get("source") == "portal":
        issues += _intake_checks(o, w, add)
    return issues


def _intake_checks(o: dict, weight: float | None, add) -> list:
    """Extra checks for orders a customer entered in the portal."""
    # States and provinces, and whether they agree with the postal code.
    for side, label in (("origin", "Pickup"), ("dest", "Delivery")):
        state_raw = (o.get(f"{side}_state") or "").strip()
        postal = (o[f"{side}_zip"] or "").strip()
        postal_country = _postal_country(postal)
        expected = None
        if postal_country == "US":
            expected = US_ZIP_REGION.get(postal[0])
        elif postal_country == "CA":
            expected = CA_POSTAL_PROVINCE.get(postal[0].upper())

        if not state_raw:
            if expected and len(expected) == 1:
                add(f"{side}_state", f"{label} province missing; the postal code says {next(iter(expected))}",
                    "", next(iter(expected)), "auto")
            else:
                add(f"{side}_state", f"{label} state or province missing", "", None, "ask_customer")
            continue
        code = _region_code(state_raw)
        if code is None:
            likely = _likely(state_raw, {**{n.upper(): c for c, n in REGION_NAMES.items()},
                                         **{c: c for c in REGION_NAMES}})
            if likely:
                add(f"{side}_state", f"Unknown state or province; likely {likely} ({REGION_NAMES[likely]})",
                    state_raw, likely, "suggested")
            else:
                add(f"{side}_state", "Unknown state or province", state_raw, None, "ask_customer")
            continue
        if code != state_raw:
            add(f"{side}_state", "State or province not written as its 2-letter code", state_raw, code, "auto")
        if expected and code not in expected:
            add(f"{side}_state", f"{label} postal code {postal} is in {', '.join(sorted(expected))}, "
                                 f"not {code}", state_raw, None, "ask_customer")

    # Pallet count.
    pallets = None
    count_raw = (o.get("pallet_count") or "").strip()
    m = re.fullmatch(r"(\d+)(?:\s*(?:pallets?|skids?|plts?))?", count_raw, re.I)
    if not count_raw:
        add("pallet_count", "Number of pallets missing", "", None, "ask_customer")
    elif not m or int(m.group(1)) == 0:
        add("pallet_count", "Number of pallets is not a whole number", count_raw, None, "ask_customer")
    else:
        pallets = int(m.group(1))
        if str(pallets) != count_raw:
            add("pallet_count", "Number of pallets written with extra words", count_raw, str(pallets), "auto")
        if pallets > MAX_LTL_PALLETS:
            add("pallet_count", f"More than {MAX_LTL_PALLETS} pallets is usually a full truckload, not LTL",
                count_raw, None, "needs_human")

    # Pallet size: understood in common formats, then checked for sense.
    dims = None
    dims_raw = (o["skid_dims"] or "").strip()
    if dims_raw and dims_raw.lower() != "unknown":
        dims = _parse_dims(dims_raw)
        if dims is None:
            add("skid_dims", "Pallet size not understood (expected L x W x H in inches)", dims_raw, None,
                "ask_customer")
        else:
            normal = "x".join(str(d) for d in dims)
            if normal != dims_raw:
                add("skid_dims", "Pallet size written in a non-standard way", dims_raw, normal, "auto")
            if max(dims[0], dims[1]) > MAX_PALLET_SIDE_IN or dims[2] > MAX_PALLET_HEIGHT_IN:
                add("skid_dims", "Pallet size too large for a standard pallet position; please confirm",
                    dims_raw, None, "ask_customer")
                dims = None

    # Freight class from density: suggested if missing, flagged if it disagrees.
    if weight and pallets and dims:
        density, cls = density_class(weight, pallets, dims)
        given = _num(o["freight_class"])
        if not (o["freight_class"] or "").strip():
            add("freight_class", f"Freight class missing; density {density} lb/ft³ suggests class {cls:g}",
                "", f"{cls:g}", "suggested")
        elif given in VALID_FREIGHT_CLASSES:
            tiers = [c for _, c in DENSITY_CLASSES]
            if abs(tiers.index(given) - tiers.index(cls)) > 1:
                add("freight_class", f"Class {given:g} entered, but density {density} lb/ft³ suggests "
                                     f"class {cls:g}", o["freight_class"], f"{cls:g}", "needs_human")
    return []


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
    for rec in ("needs_human", "suggested", "ask_customer", "auto"):
        if rec in classes:
            return rec
    return "no_issues"
