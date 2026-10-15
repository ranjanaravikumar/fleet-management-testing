"""
db.py — SQLite storage for the TMS: shipments, tracking, orders and notes.

Kept in its own file (tms.db), separate from the marketplace database.
"""
import os
import sqlite3
from datetime import datetime, timedelta, timezone

DB_PATH = os.environ.get("TMS_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "tms.db"))

# All demo times use Phoenix time (MST, UTC-7, no daylight saving).
PHOENIX = timezone(timedelta(hours=-7), "MST")


def now() -> datetime:
    """Current time in Phoenix time, to the minute."""
    return datetime.now(PHOENIX).replace(second=0, microsecond=0)


def stamp() -> str:
    """Current time to the second, for notes and 'updated at' fields."""
    return datetime.now(PHOENIX).replace(microsecond=0).isoformat()


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA = """
DROP TABLE IF EXISTS case_messages;   -- left over from the agent-integrated version
DROP TABLE IF EXISTS cases;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS charges;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS milestones;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS loads;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS trucks;
DROP TABLE IF EXISTS carriers;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
    code            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT,
    address         TEXT,
    city            TEXT,
    province        TEXT,
    postal          TEXT,
    country         TEXT,
    phone           TEXT,
    email           TEXT,
    contact         TEXT,
    on_hold         INTEGER NOT NULL DEFAULT 0,
    hold_reason     TEXT,
    appt_required   INTEGER NOT NULL DEFAULT 0,
    rec_type        TEXT,
    terms           TEXT
);

CREATE TABLE carriers (
    code                TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    mc_number           TEXT,
    dot_number          TEXT,
    contact             TEXT,
    phone               TEXT,
    email               TEXT,
    home_base           TEXT,
    equipment           TEXT,
    insurance_expires   TEXT,           -- ISO date
    status              TEXT NOT NULL DEFAULT 'Active',   -- Active | Do not use
    on_time_pct         INTEGER,
    own_fleet           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE drivers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT,
    location        TEXT,
    status          TEXT,
    truck_id        TEXT,
    license         TEXT,
    hos_remaining   REAL,           -- driving hours left today
    home_terminal   TEXT
);

CREATE TABLE trucks (
    id              TEXT PRIMARY KEY,   -- unit number, e.g. TRUCK-015
    make            TEXT,
    model           TEXT,
    year            INTEGER,
    plate           TEXT,
    status          TEXT,               -- In service | In shop
    location        TEXT,
    odometer        INTEGER,
    next_service    TEXT,               -- ISO date
    issue           TEXT
);

CREATE TABLE loads (
    id              INTEGER PRIMARY KEY,
    pickup          TEXT,
    delivery        TEXT,
    cargo           TEXT,
    weight_lbs      INTEGER,
    status          TEXT,
    driver_id       INTEGER REFERENCES drivers(id),
    customer_code   TEXT REFERENCES customers(code)
);

CREATE TABLE shipments (
    id                      TEXT PRIMARY KEY,
    customer_code           TEXT REFERENCES customers(code),
    load_id                 INTEGER REFERENCES loads(id),
    origin                  TEXT,
    destination             TEXT,
    status                  TEXT,
    commodity               TEXT,
    weight_lbs              INTEGER,
    trailer                 TEXT,
    amount                  TEXT,
    bol                     TEXT,
    truck_id                TEXT,
    driver_name             TEXT,
    carrier_name            TEXT,
    carrier_email           TEXT,
    pickup_appt_start       TEXT,
    pickup_appt_end         TEXT,
    delivery_appt_start     TEXT,
    delivery_appt_end       TEXT,
    updated_at              TEXT,
    carrier_code            TEXT REFERENCES carriers(code),
    po_number               TEXT,
    pro_number              TEXT,
    customer_ref            TEXT,
    shipper_name            TEXT,
    shipper_address         TEXT,
    consignee_name          TEXT,
    consignee_address       TEXT,
    miles                   INTEGER,
    order_id                TEXT,
    invoice_status          TEXT NOT NULL DEFAULT 'Not invoiced',   -- Not invoiced | Invoiced | Paid
    invoice_number          TEXT,
    invoiced_at             TEXT
);

CREATE TABLE milestones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id     TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    label           TEXT NOT NULL,
    location        TEXT,
    event_time      TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'system',
    created_at      TEXT NOT NULL
);

CREATE TABLE orders (
    id                      TEXT PRIMARY KEY,
    customer_code           TEXT REFERENCES customers(code),
    origin_zip              TEXT,
    dest_zip                TEXT,
    weight_lbs              TEXT,
    status                  TEXT,
    freight_class           TEXT,
    base_rate_per_mile_cwt  TEXT,
    fuel_surcharge_percent  TEXT,
    accessorial_charges     TEXT,
    driver_id               TEXT,
    vendor_id               TEXT,
    created_at              TEXT,
    last_updated_timestamp  TEXT,
    skid_details            TEXT,
    is_stackable            TEXT,
    is_urgent               TEXT,
    delivery_appointment    TEXT,
    origin_country          TEXT,
    dest_country            TEXT,
    quote                   TEXT,
    skid_dims               TEXT,
    origin_state            TEXT,
    dest_state              TEXT,
    pallet_count            TEXT,
    commodity               TEXT,
    source                  TEXT NOT NULL DEFAULT 'csv',  -- csv (sample data) | portal (quote request from a customer)
    shipment_id             TEXT                          -- set when the order is booked as a shipment
);

CREATE TABLE notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,           -- shipment | order | customer
    entity_id       TEXT NOT NULL,
    author          TEXT NOT NULL,           -- display name
    author_type     TEXT NOT NULL DEFAULT 'staff',   -- customer | staff | carrier | integration | system
    visibility      TEXT NOT NULL DEFAULT 'internal', -- internal (staff only) | customer (also shown in the portal)
    action          TEXT NOT NULL,           -- short tag: note, update, milestone, order_submitted, ...
    message         TEXT NOT NULL,
    source_ref      TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id     TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    doc_type        TEXT NOT NULL,      -- BOL | POD | Rate confirmation | Invoice | Other
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size            INTEGER NOT NULL,
    content         BLOB NOT NULL,
    uploaded_by     TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE charges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id     TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    side            TEXT NOT NULL,      -- customer (what we bill) | carrier (what we pay)
    type            TEXT NOT NULL,      -- Linehaul | Fuel surcharge | Detention | Lumper | Accessorial | Carrier pay
    description     TEXT,
    amount          REAL NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX idx_milestones_shipment ON milestones(shipment_id);
CREATE INDEX idx_documents_shipment ON documents(shipment_id);
CREATE INDEX idx_charges_shipment ON charges(shipment_id);
CREATE INDEX idx_notes_entity ON notes(entity_type, entity_id);
"""


def create_schema(conn: sqlite3.Connection) -> None:
    """Drop and recreate every TMS table. Only called by the demo reset."""
    conn.executescript(SCHEMA)
