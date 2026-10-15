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

OWN_FLEET = "Qubiway Fleet Dispatch"

# The demo customer for Acts 1, 2 and 4. None of the three mock companies has a
# usable email address, so the demo needs one customer it can actually email.
DEMO_CUSTOMER = {
    "code": "NFAS", "name": "Northfield Auto Supply", "type": "RET",
    "address": "2450 S 7th St", "city": "Phoenix", "province": "AZ", "postal": "85034",
    "country": "USA", "phone": "(602) 555-0147", "email": CUSTOMER_EMAIL,
    "contact": "Maria Lopez", "on_hold": 0, "hold_reason": None,
    "appt_required": 1, "rec_type": "LTL", "terms": "N30",
}


EXTRA_CUSTOMERS = [
    {"code": "SHG", "name": "Sonoran Home Goods", "type": "RET", "address": "1840 W University Dr",
     "city": "Tempe", "province": "AZ", "postal": "85281", "country": "USA", "phone": "(480) 555-0192",
     "email": "logistics@sonoranhome.example.com", "contact": "Dana Whitfield", "on_hold": 0,
     "hold_reason": None, "appt_required": 1, "rec_type": "FTL", "terms": "N30"},
    {"code": "RGP", "name": "Rio Grande Produce Co.", "type": "WHS", "address": "9100 Gateway Blvd E",
     "city": "El Paso", "province": "TX", "postal": "79907", "country": "USA", "phone": "(915) 555-0133",
     "email": "dispatch@riograndeproduce.example.com", "contact": "Luis Herrera", "on_hold": 0,
     "hold_reason": None, "appt_required": 0, "rec_type": "FTL", "terms": "N15"},
]

# insurance_days: days from the reset until the carrier's insurance certificate expires.
CARRIERS = [
    {"code": "TPF", "name": OWN_FLEET, "mc_number": "MC-781204", "dot_number": "3184402",
     "contact": "Fleet dispatch desk", "phone": "(602) 555-0100", "email": CARRIER_EMAIL,
     "home_base": "Phoenix, AZ", "equipment": "Dry van", "insurance_days": 210, "status": "Active",
     "on_time_pct": 96, "own_fleet": 1},
    {"code": "PLF", "name": "Prairie Line Freight", "mc_number": "MC-554310", "dot_number": "2290417",
     "contact": "Kim Alvarez", "phone": "(312) 555-0161", "email": CARRIER_EMAIL,
     "home_base": "Joliet, IL", "equipment": "Dry van, reefer", "insurance_days": 140, "status": "Active",
     "on_time_pct": 91, "own_fleet": 0},
    {"code": "DSX", "name": "Desert Sun Express", "mc_number": "MC-902266", "dot_number": "3551870",
     "contact": "Priya Shah", "phone": "(520) 555-0118", "email": "dispatch@desertsunexpress.example.com",
     "home_base": "Tucson, AZ", "equipment": "Reefer, dry van", "insurance_days": 21, "status": "Active",
     "on_time_pct": 94, "own_fleet": 0},
    {"code": "GLT", "name": "Great Lakes Transport", "mc_number": "MC-447812", "dot_number": "1987345",
     "contact": "Tom Kowalski", "phone": "(216) 555-0175", "email": "loads@greatlakestransport.example.com",
     "home_base": "Cleveland, OH", "equipment": "Flatbed, step deck", "insurance_days": 300, "status": "Active",
     "on_time_pct": 89, "own_fleet": 0},
    {"code": "MRL", "name": "Mesa Ridge Logistics", "mc_number": "MC-668091", "dot_number": "3012876",
     "contact": "Ben Ortega", "phone": "(480) 555-0157", "email": "ops@mesaridge.example.com",
     "home_base": "Mesa, AZ", "equipment": "Dry van", "insurance_days": -12, "status": "Do not use",
     "on_time_pct": 78, "own_fleet": 0},
]

EXTRA_DRIVERS = [
    {"id": 5, "name": "Angela Brooks", "location": "Phoenix, AZ", "status": "available", "truck": "TRUCK-018", "hos": 8.5},
    {"id": 6, "name": "Omar Haddad", "location": "Glendale, AZ", "status": "available", "truck": "TRUCK-021", "hos": 10.0},
]

# service_days: days from the reset until the next scheduled service.
TRUCKS = [
    {"id": "TRUCK-007", "make": "Freightliner", "model": "Cascadia", "year": 2019, "plate": "AZ 4KT-207",
     "status": "In shop", "location": "Tucson, AZ", "odometer": 612480, "service_days": -4,
     "issue": "Tire pressure 67 PSI on axle 2; annual inspection overdue"},
    {"id": "TRUCK-009", "make": "Kenworth", "model": "T680", "year": 2021, "plate": "AZ 4KT-209",
     "status": "In service", "location": "Mesa, AZ", "odometer": 318920, "service_days": 18, "issue": None},
    {"id": "TRUCK-012", "make": "Volvo", "model": "VNL 760", "year": 2022, "plate": "AZ 4KT-212",
     "status": "In service", "location": "Phoenix, AZ", "odometer": 241305, "service_days": 9, "issue": None},
    {"id": "TRUCK-015", "make": "Freightliner", "model": "Cascadia", "year": 2023, "plate": "AZ 4KT-215",
     "status": "In service", "location": "Scottsdale, AZ", "odometer": 98744, "service_days": 41, "issue": None},
    {"id": "TRUCK-018", "make": "Peterbilt", "model": "579", "year": 2020, "plate": "AZ 4KT-218",
     "status": "In service", "location": "Phoenix, AZ", "odometer": 402117, "service_days": 3, "issue": None},
    {"id": "TRUCK-021", "make": "International", "model": "LT625", "year": 2022, "plate": "AZ 4KT-221",
     "status": "In service", "location": "Glendale, AZ", "odometer": 187560, "service_days": 27, "issue": None},
    {"id": "TRUCK-024", "make": "Kenworth", "model": "T680", "year": 2024, "plate": "AZ 4KT-224",
     "status": "In service", "location": "Phoenix, AZ", "odometer": 41230, "service_days": 60, "issue": None},
]

# Shipper or consignee at each city: (name, street address).
SITES = {
    "Chicago, IL": ("Midwest Components Inc.", "1200 W 35th St, Chicago, IL 60609"),
    "Dallas, TX": ("Northfield Auto Supply, Dallas DC", "4800 Irving Blvd, Dallas, TX 75247"),
    "Phoenix, AZ": ("Northfield Auto Supply", "2450 S 7th St, Phoenix, AZ 85034"),
    "Denver, CO": ("Front Range Parts Depot", "5400 Washington St, Denver, CO 80216"),
    "Toronto, ON": ("ABC Trucking Yard", "75 Bermondsey Rd, Toronto, ON M4B 1Z5"),
    "Buffalo, NY": ("Niagara Frontier Distribution", "1100 Niagara St, Buffalo, NY 14213"),
    "Tucson, AZ": ("Sun Corridor Retail DC", "3900 E Valencia Rd, Tucson, AZ 85706"),
    "El Paso, TX": ("Rio Grande Produce Co.", "9100 Gateway Blvd E, El Paso, TX 79907"),
    "Atlanta, GA": ("Peachtree Auto Parts", "1650 Murphy Ave SW, Atlanta, GA 30310"),
    "Miami, FL": ("Bayside Auto Distributors", "7200 NW 32nd Ave, Miami, FL 33147"),
    "Los Angeles, CA": ("Harbor Freight Consolidators", "2200 E Washington Blvd, Los Angeles, CA 90021"),
    "Seattle, WA": ("Cascade Parts Supply", "5800 1st Ave S, Seattle, WA 98108"),
    "Mesa, AZ": ("Sonoran Home Goods, Mesa DC", "7300 E Ray Rd, Mesa, AZ 85212"),
    "Albuquerque, NM": ("High Desert Home Center", "3500 Broadway Blvd SE, Albuquerque, NM 87105"),
    "Columbus, OH": ("Buckeye Industrial Supply", "2600 Westbelt Dr, Columbus, OH 43228"),
    "Las Vegas, NV": ("Northfield Auto Supply, Las Vegas", "4400 W Sunset Rd, Las Vegas, NV 89118"),
    "Tempe, AZ": ("Sonoran Home Goods", "1840 W University Dr, Tempe, AZ 85281"),
    "San Diego, CA": ("Pacific Coast Furniture", "6150 Nancy Ridge Dr, San Diego, CA 92121"),
    "Flagstaff, AZ": ("Ponderosa Woodworks", "2100 E Huntington Dr, Flagstaff, AZ 86004"),
}

LANE_MILES = {
    ("Chicago, IL", "Dallas, TX"): 925, ("Phoenix, AZ", "Denver, CO"): 821,
    ("Toronto, ON", "Buffalo, NY"): 101, ("Tucson, AZ", "El Paso, TX"): 317,
    ("Atlanta, GA", "Miami, FL"): 662, ("Los Angeles, CA", "Phoenix, AZ"): 372,
    ("Seattle, WA", "Denver, CO"): 1316, ("Phoenix, AZ", "Los Angeles, CA"): 372,
    ("Mesa, AZ", "Albuquerque, NM"): 422, ("El Paso, TX", "Phoenix, AZ"): 430,
    ("Chicago, IL", "Columbus, OH"): 355, ("Phoenix, AZ", "Las Vegas, NV"): 300,
    ("Tempe, AZ", "San Diego, CA"): 355, ("Denver, CO", "Phoenix, AZ"): 821,
    ("Phoenix, AZ", "Tucson, AZ"): 116, ("Flagstaff, AZ", "Phoenix, AZ"): 145,
}

# Customer PO, carrier PRO and the customer's own reference for each shipment.
SHIPMENT_EXTRAS = {
    "SHP-1042": {"po_number": "PO-48812", "pro_number": "PLF-7741902", "customer_ref": "NF-DAL-0412"},
    "SHP-2048": {"po_number": "PO-49107", "pro_number": "TPF-30871", "customer_ref": "NF-DEN-0233"},
    "SHP-2051": {"po_number": "ABT-11840", "pro_number": "TPF-30874", "customer_ref": "ABT-BUF-77"},
    "SHP-2049": {"po_number": "PO-49112", "pro_number": "TPF-30868", "customer_ref": "NF-ELP-0190"},
    "SHP-1039": {"po_number": "PO-46021", "pro_number": "TPF-29903", "customer_ref": "NF-MIA-0088"},
    "SHP-1034": {"po_number": "PO-45577", "pro_number": "TPF-29741", "customer_ref": "NF-PHX-0712"},
    "SHP-1028": {"po_number": "PO-44960", "pro_number": "TPF-29522", "customer_ref": "NF-DEN-0219"},
}

# Ordinary traffic. Hours are relative to the reset; events are (code, label or None, location, hours).
BACKGROUND_SHIPMENTS = [
    {"id": "SHP-2052", "customer_code": "NFAS", "load_id": None, "origin": "Phoenix, AZ",
     "destination": "Los Angeles, CA", "commodity": "Auto Parts", "weight_lbs": 14600, "trailer": "Dry Van",
     "amount": "$1,860", "bol": "BOL-89151", "truck_id": "TRUCK-018", "driver_name": "Angela B.",
     "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL, "carrier_code": "TPF",
     "po_number": "PO-49140", "pro_number": "TPF-30880", "customer_ref": "NF-LAX-0301",
     "pickup": (6, 8), "delivery": (20, 22), "events": [("BOOKED", None, None, -18)]},
    {"id": "SHP-2053", "customer_code": "SHG", "load_id": None, "origin": "Mesa, AZ",
     "destination": "Albuquerque, NM", "commodity": "Home Goods", "weight_lbs": 9800, "trailer": "Dry Van",
     "amount": "$1,540", "bol": "BOL-89155", "truck_id": "DSX-118", "driver_name": "T. Nguyen",
     "carrier_name": "Desert Sun Express", "carrier_email": "dispatch@desertsunexpress.example.com",
     "carrier_code": "DSX", "po_number": "SHG-20417", "pro_number": "DSX-551203", "customer_ref": "SHG-ABQ-14",
     "pickup": (18, 20), "delivery": (30, 32), "events": [("BOOKED", None, None, -10)]},
    {"id": "SHP-2054", "customer_code": "RGP", "load_id": None, "origin": "El Paso, TX",
     "destination": "Phoenix, AZ", "commodity": "Fresh Produce", "weight_lbs": 38500, "trailer": "Reefer",
     "amount": "$2,450", "bol": "BOL-89133", "truck_id": "DSX-104", "driver_name": "M. Alvarez",
     "carrier_name": "Desert Sun Express", "carrier_email": "dispatch@desertsunexpress.example.com",
     "carrier_code": "DSX", "po_number": "RGP-7731", "pro_number": "DSX-551188", "customer_ref": "RGP-PHX-209",
     "consignee_name": "Valley Fresh Market DC", "consignee_address": "4320 W Buckeye Rd, Phoenix, AZ 85043",
     "pickup": (-10, -8), "delivery": (8, 10), "events": [
         ("BOOKED", None, None, -30), ("ARRSHIP", "Arrived at shipper — El Paso, TX", "El Paso, TX", -9.8),
         ("PICK", "Picked up in El Paso, TX", "El Paso, TX", -8.6),
         ("INTRANSIT", "In Transit — Las Cruces, NM", "Las Cruces, NM", -7),
         ("INTRANSIT", "In Transit — Tucson, AZ", "Tucson, AZ", -2.5)]},
    {"id": "SHP-2055", "customer_code": "ABC", "load_id": None, "origin": "Chicago, IL",
     "destination": "Columbus, OH", "commodity": "Machinery Parts", "weight_lbs": 22000, "trailer": "Flatbed",
     "amount": "$1,780", "bol": "BOL-89129", "truck_id": "GLT-331", "driver_name": "K. Novak",
     "carrier_name": "Great Lakes Transport", "carrier_email": "loads@greatlakestransport.example.com",
     "carrier_code": "GLT", "po_number": "ABC-30922", "pro_number": "GLT-118204", "customer_ref": "ABC-CMH-5",
     "pickup": (-14, -12), "delivery": (10, 12), "events": [
         ("BOOKED", None, None, -40), ("ARRSHIP", "Arrived at shipper — Chicago, IL", "Chicago, IL", -13.7),
         ("PICK", "Picked up in Chicago, IL", "Chicago, IL", -12.4),
         ("INTRANSIT", "In Transit — Indianapolis, IN", "Indianapolis, IN", -5)]},
    {"id": "SHP-2056", "customer_code": "NFAS", "load_id": None, "origin": "Phoenix, AZ",
     "destination": "Las Vegas, NV", "commodity": "Auto Parts", "weight_lbs": 11200, "trailer": "Dry Van",
     "amount": "$1,380", "bol": "BOL-89160", "truck_id": "TRUCK-021", "driver_name": "Omar H.",
     "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL, "carrier_code": "TPF",
     "po_number": "PO-49166", "pro_number": "TPF-30885", "customer_ref": "NF-LAS-0057",
     "pickup": (26, 28), "delivery": (36, 38), "events": [("BOOKED", None, None, -4)]},
    {"id": "SHP-2057", "customer_code": "SHG", "load_id": None, "origin": "Tempe, AZ",
     "destination": "San Diego, CA", "commodity": "Furniture", "weight_lbs": 16400, "trailer": "Dry Van",
     "amount": "$1,690", "bol": "BOL-89163", "truck_id": "PLF-2214", "driver_name": "R. Castillo",
     "carrier_name": "Prairie Line Freight", "carrier_email": CARRIER_EMAIL, "carrier_code": "PLF",
     "po_number": "SHG-20431", "pro_number": "PLF-7742218", "customer_ref": "SHG-SAN-03",
     "pickup": (30, 32), "delivery": (44, 46), "events": [("BOOKED", None, None, -2)]},
    {"id": "SHP-2043", "customer_code": "NFAS", "load_id": None, "origin": "Denver, CO",
     "destination": "Phoenix, AZ", "commodity": "Auto Parts", "weight_lbs": 20100, "trailer": "Dry Van",
     "amount": "$2,640", "bol": "BOL-89021", "truck_id": "PLF-2190", "driver_name": "J. Webb",
     "carrier_name": "Prairie Line Freight", "carrier_email": CARRIER_EMAIL, "carrier_code": "PLF",
     "po_number": "PO-48990", "pro_number": "PLF-7741655", "customer_ref": "NF-PHX-0731",
     "pickup": (-74, -72), "delivery": (-50, -48), "events": [
         ("BOOKED", None, None, -96), ("ARRSHIP", "Arrived at shipper — Denver, CO", "Denver, CO", -73.8),
         ("PICK", "Picked up in Denver, CO", "Denver, CO", -72.5),
         ("INTRANSIT", "In Transit — Albuquerque, NM", "Albuquerque, NM", -60),
         ("ARRCONSIGNEE", "Arrived at consignee — Phoenix, AZ", "Phoenix, AZ", -49.6),
         ("DELV", "Delivered, signed by R. Diaz", "Phoenix, AZ", -48.7), ("POD", None, None, -46)]},
    {"id": "SHP-2044", "customer_code": "RGP", "load_id": None, "origin": "Los Angeles, CA",
     "destination": "Phoenix, AZ", "commodity": "Fresh Produce", "weight_lbs": 36000, "trailer": "Reefer",
     "amount": "$1,920", "bol": "BOL-89058", "truck_id": "DSX-104", "driver_name": "M. Alvarez",
     "carrier_name": "Desert Sun Express", "carrier_email": "dispatch@desertsunexpress.example.com",
     "carrier_code": "DSX", "po_number": "RGP-7702", "pro_number": "DSX-551140", "customer_ref": "RGP-PHX-204",
     "consignee_name": "Valley Fresh Market DC", "consignee_address": "4320 W Buckeye Rd, Phoenix, AZ 85043",
     "pickup": (-40, -38), "delivery": (-30, -28), "events": [
         ("BOOKED", None, None, -60), ("ARRSHIP", "Arrived at shipper — Los Angeles, CA", "Los Angeles, CA", -39.8),
         ("PICK", "Picked up in Los Angeles, CA", "Los Angeles, CA", -38.9),
         ("ARRCONSIGNEE", "Arrived at consignee — Phoenix, AZ", "Phoenix, AZ", -29.7),
         ("DELV", "Delivered, signed by A. Kim", "Phoenix, AZ", -28.9)]},
    {"id": "SHP-2045", "customer_code": "NFAS", "load_id": None, "origin": "Phoenix, AZ",
     "destination": "Tucson, AZ", "commodity": "Auto Parts", "weight_lbs": 7400, "trailer": "Dry Van",
     "amount": "$780", "bol": "BOL-89102", "truck_id": "TRUCK-018", "driver_name": "Angela B.",
     "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL, "carrier_code": "TPF",
     "po_number": "PO-49098", "pro_number": "TPF-30860", "customer_ref": "NF-TUS-0144",
     "pickup": (-9, -7), "delivery": (-4, -2), "events": [
         ("BOOKED", None, None, -24), ("ARRSHIP", "Arrived at shipper — Phoenix, AZ", "Phoenix, AZ", -8.8),
         ("PICK", "Picked up in Phoenix, AZ", "Phoenix, AZ", -7.9),
         ("ARRCONSIGNEE", "Arrived at consignee — Tucson, AZ", "Tucson, AZ", -3.9),
         ("DELV", "Delivered, signed by P. Morales", "Tucson, AZ", -3.2)]},
    {"id": "SHP-2046", "customer_code": "SHG", "load_id": None, "origin": "Flagstaff, AZ",
     "destination": "Phoenix, AZ", "commodity": "Home Goods", "weight_lbs": 9100, "trailer": "Dry Van",
     "amount": "$690", "bol": "BOL-89080", "truck_id": "TRUCK-012", "driver_name": "Raj P.",
     "carrier_name": OWN_FLEET, "carrier_email": CARRIER_EMAIL, "carrier_code": "TPF",
     "po_number": "SHG-20388", "pro_number": "TPF-30842", "customer_ref": "SHG-PHX-22",
     "consignee_name": "Sonoran Home Goods, Phoenix store", "consignee_address": "2525 E Camelback Rd, Phoenix, AZ 85016",
     "pickup": (-46, -44), "delivery": (-40, -38), "events": [
         ("BOOKED", None, None, -70), ("ARRSHIP", "Arrived at shipper — Flagstaff, AZ", "Flagstaff, AZ", -45.8),
         ("PICK", "Picked up in Flagstaff, AZ", "Flagstaff, AZ", -44.9),
         ("ARRCONSIGNEE", "Arrived at consignee — Phoenix, AZ", "Phoenix, AZ", -39.7),
         ("DELV", "Delivered, signed by S. Grant", "Phoenix, AZ", -39.1), ("POD", None, None, -37)]},
]

# Delivered shipments that are already billed: id -> (status, invoice number, hours since the reset).
INVOICES = {
    "SHP-1039": ("Paid", "INV-10388", None), "SHP-1034": ("Paid", "INV-10342", None),
    "SHP-1028": ("Paid", "INV-10291", None), "SHP-2043": ("Paid", "INV-10457", -40),
    "SHP-2046": ("Invoiced", "INV-10462", -30),
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
    """events: (code, label, location, event_time). Adds references, stops, miles and charges."""
    codes = [e[0] for e in events]
    extra = SHIPMENT_EXTRAS.get(s["id"], {})
    s = {**s, **extra, "status": status_for(codes), "updated_at": iso(now())}
    s.setdefault("carrier_code", "PLF" if s["carrier_name"] == "Prairie Line Freight" else "TPF")
    s.setdefault("shipper_name", SITES.get(s["origin"], ("", ""))[0])
    s.setdefault("shipper_address", SITES.get(s["origin"], ("", ""))[1])
    if s["destination"] == "Phoenix, AZ" and s["customer_code"] == "NFAS":
        s.setdefault("consignee_name", "Northfield Auto Supply")
        s.setdefault("consignee_address", "2450 S 7th St, Phoenix, AZ 85034")
    s.setdefault("consignee_name", SITES.get(s["destination"], ("", ""))[0])
    s.setdefault("consignee_address", SITES.get(s["destination"], ("", ""))[1])
    s.setdefault("miles", LANE_MILES.get((s["origin"], s["destination"])))
    cols = ", ".join(s)
    conn.execute(f"INSERT INTO shipments ({cols}) VALUES ({', '.join(':' + k for k in s)})", s)
    for code, label, location, event_time in events:
        conn.execute(
            "INSERT INTO milestones (shipment_id, code, label, location, event_time, source, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'system', ?)",
            (s["id"], code, label, location, event_time, event_time),
        )
    _insert_charges(conn, s)


def _insert_charges(conn, s: dict) -> None:
    """What we bill the customer and what we pay the carrier, from the shipment value."""
    try:
        total = float(re.sub(r"[^\d.]", "", s.get("amount") or ""))
    except ValueError:
        return
    linehaul = round(total * 0.84, 2)
    cost_type = "Fleet cost" if s["carrier_code"] == "TPF" else "Carrier pay"
    for side, typ, desc, amount in (
        ("customer", "Linehaul", f"{s['origin']} to {s['destination']}", linehaul),
        ("customer", "Fuel surcharge", "Per fuel schedule", round(total - linehaul, 2)),
        ("carrier", cost_type, s["carrier_name"], round(total * 0.78, 2)),
    ):
        conn.execute("INSERT INTO charges (shipment_id, side, type, description, amount, created_at) "
                     "VALUES (?,?,?,?,?,?)", (s["id"], side, typ, desc, amount, s["updated_at"]))


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
        for c in EXTRA_CUSTOMERS:
            conn.execute(
                "INSERT INTO customers VALUES (:code, :name, :type, :address, :city, :province, :postal, "
                ":country, :phone, :email, :contact, :on_hold, :hold_reason, :appt_required, :rec_type, :terms)",
                c,
            )

        # ── Carriers and trucks ──────────────────────────────────────
        for c in CARRIERS:
            c = dict(c)
            c["insurance_expires"] = (t0 + timedelta(days=c.pop("insurance_days"))).date().isoformat()
            conn.execute(f"INSERT INTO carriers ({', '.join(c)}) VALUES ({', '.join(':' + k for k in c)})", c)
        for tr in TRUCKS:
            tr = dict(tr)
            tr["next_service"] = (t0 + timedelta(days=tr.pop("service_days"))).date().isoformat()
            conn.execute(f"INSERT INTO trucks ({', '.join(tr)}) VALUES ({', '.join(':' + k for k in tr)})", tr)

        # ── Drivers and loads ────────────────────────────────────────
        for d in mock["DRIVERS"] + EXTRA_DRIVERS:
            conn.execute(
                "INSERT INTO drivers VALUES (?,?,?,?,?,?,?,?,?)",
                (d["id"], d["name"], f"(602) 555-01{d['id']:02d}", d.get("location"),
                 d.get("status"), d.get("truck"), "CDL-A", d.get("hos"), "Phoenix, AZ"),
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

        # ── Everyday traffic around the demo shipments ───────────────
        # Every active one has a truck, a driver and appointments in the future,
        # so the plugin's detector still finds only the demo problems above.
        for b in BACKGROUND_SHIPMENTS:
            b = dict(b)
            p0, p1 = b.pop("pickup"); d0, d1 = b.pop("delivery")
            events = [(code, label or default_label(code), loc, at(h)) for code, label, loc, h in b.pop("events")]
            _insert_shipment(conn, {**b, "pickup_appt_start": at(p0), "pickup_appt_end": at(p1),
                                    "delivery_appt_start": at(d0), "delivery_appt_end": at(d1)}, events)

        # ── Invoices on delivered shipments ──────────────────────────
        for sid, (inv_status, number, hours) in INVOICES.items():
            when = at(hours) if hours is not None else None
            conn.execute("UPDATE shipments SET invoice_status = ?, invoice_number = ?, invoiced_at = ? WHERE id = ?",
                         (inv_status, number, when, sid))

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
                  for t in ("customers", "carriers", "drivers", "trucks", "loads", "shipments",
                            "milestones", "charges", "orders")}
    finally:
        conn.close()
    return {"reset_at": iso(t0), "counts": counts}


if __name__ == "__main__":
    print(reset_demo())
