"""
db.py — SQLite storage for the TMS data the SMART API Agent works with.

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
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS milestones;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS loads;
DROP TABLE IF EXISTS drivers;
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

CREATE TABLE drivers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT,
    location        TEXT,
    status          TEXT,
    truck_id        TEXT
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
    agent_status            TEXT,
    updated_at              TEXT
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
    agent_status            TEXT
);

CREATE TABLE notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    author          TEXT NOT NULL,
    action          TEXT NOT NULL,
    message         TEXT NOT NULL,
    source_ref      TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX idx_milestones_shipment ON milestones(shipment_id);
CREATE INDEX idx_notes_entity ON notes(entity_type, entity_id);
"""


def create_schema(conn: sqlite3.Connection) -> None:
    """Drop and recreate every TMS table. Only called by the demo reset."""
    conn.executescript(SCHEMA)
