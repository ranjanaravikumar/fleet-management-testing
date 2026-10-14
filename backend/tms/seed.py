"""
seed.py — resets the TMS database to the demo starting state.

Run from the project root:   python -m backend.tms.seed
Or call:                     POST /api/admin/reset

Times for live shipments are set relative to the moment of the reset,
so the demo situations (an overdue delivery, a missing truck ID) are
always "happening now" whenever you reset. The TMS itself doesn't flag
them; the plugin's detector finds them through the API.
"""
import csv
import json
import os
import re
from datetime import datetime, timedelta

from backend.tms.db import PHOENIX, create_schema, get_db, iso, now
from backend.tms.milestones import default_label, status_for

HERE = os.path.dirname(__file__)
MOCK_DATA = os.path.join(HERE, "fixtures", "mock_data.json")
ORDERS_CSV = os.environ.get("TMS_ORDERS_CSV", os.path.join(HERE, "..", "..", "orders.csv"))

# Demo mailboxes. Set these to the inboxes you control so emails reach you.
CUSTOMER_EMAIL = os.environ.get("DEMO_CUSTOMER_EMAIL", "northfield-shipping@example.com")
CARRIER_EMAIL = os.environ.get("DEMO_CARRIER_EMAIL", "carrier-dispatch@example.com")

OWN_FLEET = "TruckerPath Fleet Dispatch"

# The demo customer for Acts 1, 2 and 4. None of the three mock companies has a
# usable email address, so the demo needs one customer it can actually email.
DEMO_CUSTOMER = {
    "code": "NFAS", "name": "Northfield Auto Supply", "type": "RET",
    "address": "2450 S 7th St", "city": "Phoenix", "province": "AZ", "postal": "85034",
    "country": "USA", "phone": "(602) 555-0147", "email": CUSTOMER_EMAIL,
    "contact": "Maria Lopez", "on_hold": 0, "hold_reason": None,
    "appt_required": 1, "rec_type": "LTL", "terms": "N30",
}


def _round5(dt: datetime) -> datetime:
    return dt.replace(minute=dt.minute - dt.minute % 5)


def _parse_mock_time(text: str, year: int) -> str:
    """'May 29 · 10:14 AM' -> ISO time in Phoenix time."""
    dt = datetime.strptime(f"{text.replace('·', '').strip()} {year}", "%b %d  %I:%M %p %Y")
    return iso(dt.replace(tzinfo=PHOENIX))


def _code_for_label(label: str) -> str | None:
    """Map the portal's free-text event labels to milestone codes."""
    rules = [
        (r"^Order Confirmed", "BOOKED"),
        (r"^Picked up", "PICK"),
        (r"^(Departed|In Transit|Cleared Inspection)", "INTRANSIT"),
        (r"^Arrived", "ARRCONSIGNEE"),
        (r"^Delivered", "DELV"),
        (r"^POD", "POD"),
    ]
    for pattern, code in rules:
        if re.match(pattern, label):
            return code
    return None  # e.g. "Estimated Arrival" is a forecast, not an event


def _insert_shipment(conn, s: dict, events: list[tuple[str, str, str | None, str]]) -> None:
    """events: (code, label, location, event_time)."""
    codes = [e[0] for e in events]
    s = {**s, "status": status_for(codes), "updated_at": iso(now())}
    cols = ", ".join(s)
    conn.execute(f"INSERT INTO shipments ({cols}) VALUES ({', '.join(':' + k for k in s)})", s)
    for code, label, location, event_time in events:
        conn.execute(
            "INSERT INTO milestones (shipment_id, code, label, location, event_time, source, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'system', ?)",
            (s["id"], code, label, location, event_time, event_time),
        )


def reset_demo() -> dict:
    with open(MOCK_DATA, encoding="utf-8") as f:
        mock = json.load(f)

    t0 = _round5(now())

    def at(hours: float) -> str:
        return iso(t0 + timedelta(hours=hours))

    conn = get_db()
    try:
        create_schema(conn)

        # ── Customers ────────────────────────────────────────────────
        conn.execute(
            "INSERT INTO customers VALUES (:code, :name, :type, :address, :city, :province, :postal, "
            ":country, :phone, :email, :contact, :on_hold, :hold_reason, :appt_required, :rec_type, :terms)",
            DEMO_CUSTOMER,
        )
        for c in mock["COMPANIES"]:
            conn.execute(
                "INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (c["Code"], c["Name"], c.get("Type"), c.get("Address"), c.get("City"),
                 c.get("Province"), c.get("Postal"), c.get("Country"), c.get("Phone"),
                 c.get("Email"), c.get("Contact"), int(bool(c.get("onHold"))),
                 c.get("holdReason") or None, int(bool(c.get("Appt-Rqd"))),
                 c.get("Rec-Type"), c.get("Termcode")),
            )

        # ── Drivers and loads ────────────────────────────────────────
        for d in mock["DRIVERS"]:
            conn.execute(
                "INSERT INTO drivers VALUES (?,?,?,?,?,?)",
                (d["id"], d["name"], f"(602) 555-01{d['id']:02d}", d.get("location"),
                 d.get("status"), d.get("truck")),
            )
        for ld in mock["INITIAL_LOADS"]:
            status = "assigned" if ld["id"] == 308 else ld.get("status")  # load 308 is on the road in Act 2
            conn.execute(
                "INSERT INTO loads VALUES (?,?,?,?,?,?,?,?)",
                (ld["id"], ld.get("pickup"), ld.get("delivery"), ld.get("cargo"), ld.get("weight"),
                 status, ld.get("driverId"), ld.get("company")),
            )

        # ── Delivered history from the portal mock data ──────────────
        for s in mock["USER_SHIPMENTS"]:
            if s["id"] == "SHP-1042":
                continue  # rebuilt below as Act 1
            year = int(s["pickupDate"][-4:])
            events = []
            for e in s["events"]:
                code = _code_for_label(e["label"])
                if code and e.get("done"):
                    events.append((code, e["label"], None, _parse_mock_time(e["time"], year)))
            pick = next((t for c, _, _, t in events if c == "PICK"), None)
            delv = next((t for c, _, _, t in events if c == "DELV"), None)
            pick_dt, delv_dt = (datetime.fromisoformat(pick) if pick else None,
                                datetime.fromisoformat(delv) if delv else None)
            _insert_shipment(conn, {
                "id": s["id"], "customer_code": "NFAS", "load_id": s.get("loadId"),
                "origin": s["origin"], "destination": s["dest"], "commodity": s["commodity"],
                "weight_lbs": int(s["weight"].replace(",", "").split()[0]), "trailer": s["trailer"],
                "amount": s.get("amount"),
                "bol": s["bol"], "truck_id": s["truck"], "driver_name": s["driver"],
                "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL,
                "pickup_appt_start": iso(pick_dt - timedelta(hours=1)) if pick_dt else None,
                "pickup_appt_end": iso(pick_dt + timedelta(hours=1)) if pick_dt else None,
                "delivery_appt_start": iso(delv_dt - timedelta(hours=1)) if delv_dt else None,
                "delivery_appt_end": iso(delv_dt + timedelta(hours=1)) if delv_dt else None,
                            }, events)

        # ── Act 1: missing milestones, needs the carrier ─────────────
        # Delivery appointment was 4 h ago; nothing recorded since Kansas City.
        _insert_shipment(conn, {
            "id": "SHP-1042", "customer_code": "NFAS", "load_id": None,
            "origin": "Chicago, IL", "destination": "Dallas, TX", "commodity": "Electronics",
            "weight_lbs": 18400, "trailer": "Dry Van", "amount": "$3,240", "bol": "BOL-88421",
            "truck_id": "PLF-2207", "driver_name": "D. Morgan",
            "carrier_name": "Prairie Line Freight", "carrier_email": CARRIER_EMAIL,
            "pickup_appt_start": at(-50), "pickup_appt_end": at(-48),
            "delivery_appt_start": at(-4), "delivery_appt_end": at(-2),
        }, [
            ("BOOKED", default_label("BOOKED"), None, at(-74)),
            ("ARRSHIP", "Arrived at shipper — Chicago, IL", "Chicago, IL", at(-49.75)),
            ("PICK", "Picked up in Chicago, IL", "Chicago, IL", at(-48.25)),
            ("INTRANSIT", "Departed Chicago terminal", "Chicago, IL", at(-45)),
            ("INTRANSIT", "In Transit — Kansas City, MO", "Kansas City, MO", at(-20)),
        ])

        # ── Act 2: missing truck ID; load 308 has the answer ─────────
        # Shipment has no truck or driver, but load 308 -> driver 4 -> TRUCK-015.
        _insert_shipment(conn, {
            "id": "SHP-2048", "customer_code": "NFAS", "load_id": 308,
            "origin": "Phoenix, AZ", "destination": "Denver, CO", "commodity": "Electronics",
            "weight_lbs": 8200, "trailer": "Dry Van", "amount": "$2,980", "bol": "BOL-89107",
            "truck_id": None, "driver_name": None,
            "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL,
            "pickup_appt_start": at(-6), "pickup_appt_end": at(-4),
            "delivery_appt_start": at(20), "delivery_appt_end": at(22),
        }, [
            ("BOOKED", default_label("BOOKED"), None, at(-30)),
            ("ARRSHIP", "Arrived at shipper — Phoenix, AZ", "Phoenix, AZ", at(-5.83)),
            ("PICK", "Picked up in Phoenix, AZ", "Phoenix, AZ", at(-4.58)),
            ("INTRANSIT", "In Transit — Flagstaff, AZ", "Flagstaff, AZ", at(-1)),
        ])

        # ── Act 3: guardrail, customer on hold with unusable contact ─
        _insert_shipment(conn, {
            "id": "SHP-2051", "customer_code": "111", "load_id": None,
            "origin": "Toronto, ON", "destination": "Buffalo, NY", "commodity": "General Freight",
            "weight_lbs": 6200, "trailer": "Dry Van", "amount": "$1,450", "bol": "BOL-89140",
            "truck_id": "TRUCK-012", "driver_name": "Raj P.",
            "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL,
            "pickup_appt_start": at(-22), "pickup_appt_end": at(-20),
            "delivery_appt_start": at(3), "delivery_appt_end": at(5),
        }, [
            ("BOOKED", default_label("BOOKED"), None, at(-28)),
            ("ARRSHIP", "Arrived at shipper — Toronto, ON", "Toronto, ON", at(-21.67)),
            ("PICK", "Picked up in Toronto, ON", "Toronto, ON", at(-20.92)),
            ("INTRANSIT", "Crossed border — Fort Erie, ON", "Fort Erie, ON", at(-3)),
        ])

        # ── A normal, on-time shipment for contrast ──────────────────
        _insert_shipment(conn, {
            "id": "SHP-2049", "customer_code": "NFAS", "load_id": None,
            "origin": "Tucson, AZ", "destination": "El Paso, TX", "commodity": "Retail",
            "weight_lbs": 12200, "trailer": "Dry Van", "amount": "$1,920", "bol": "BOL-89112",
            "truck_id": "TRUCK-009", "driver_name": "Lisa R.",
            "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL,
            "pickup_appt_start": at(-8), "pickup_appt_end": at(-6),
            "delivery_appt_start": at(2), "delivery_appt_end": at(4),
        }, [
            ("BOOKED", default_label("BOOKED"), None, at(-20)),
            ("ARRSHIP", "Arrived at shipper — Tucson, AZ", "Tucson, AZ", at(-7.75)),
            ("PICK", "Picked up in Tucson, AZ", "Tucson, AZ", at(-6.83)),
            ("INTRANSIT", "In Transit — Lordsburg, NM", "Lordsburg, NM", at(-2)),
        ])

        # ── Orders from orders.csv (Acts 4 and 5), loaded exactly as-is ──
        # The CSV has no customer column; for the demo every order belongs to NFAS.
        with open(ORDERS_CSV, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        cols = ["id", "customer_code", "origin_zip", "dest_zip", "weight_lbs", "status", "freight_class",
                "base_rate_per_mile_cwt", "fuel_surcharge_percent", "accessorial_charges", "driver_id",
                "vendor_id", "created_at", "last_updated_timestamp", "skid_details", "is_stackable",
                "is_urgent", "delivery_appointment", "origin_country", "dest_country", "quote", "skid_dims",
                "source"]
        sql = f"INSERT INTO orders ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})"
        for r in rows:
            conn.execute(sql, (
                r["shipment_id"], "NFAS", r["origin_zip"], r["dest_zip"], r["weight_lbs"],
                r["status"], r["freight_class"], r["base_rate_per_mile_cwt"],
                r["fuel_surcharge_percent"], r["accessorial_charges"], r["driver_id"],
                r["vendor_id"], r["created_at"], r["last_updated_timestamp"], r["skid_details"],
                r["is_stackable"], r["is_urgent"], r["delivery_appointment"],
                r["origin_country"], r["dest_country"], r["Quote"], r["skid_dims"], "csv"))


        conn.commit()
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                  for t in ("customers", "drivers", "loads", "shipments", "milestones", "orders")}
    finally:
        conn.close()
    return {"reset_at": iso(t0), "counts": counts}


if __name__ == "__main__":
    print(reset_demo())
