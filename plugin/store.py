"""
store.py — the plugin's own SQLite database (plugin.db).

Holds what the TMS doesn't: cases and their conversations, which problems
the detector has already reported, and where the notes watcher is up to.
"""
import sqlite3
import threading

from plugin import config

# Case creation reads the highest ID, then inserts; the lock keeps the API,
# the detector and the notes watcher from picking the same ID.
write_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    id              TEXT PRIMARY KEY,
    customer_code   TEXT,
    shipment_id     TEXT,
    order_id        TEXT,
    channel         TEXT NOT NULL,           -- portal | email | phone | monitor
    category        TEXT NOT NULL,
    subject         TEXT NOT NULL,
    status          TEXT NOT NULL,           -- new | customer_replied | in_progress | awaiting_carrier | awaiting_customer | needs_human | resolved
    sender_email    TEXT,
    external_ref    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS case_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id         TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author_type     TEXT NOT NULL,           -- customer | agent | ops | system
    author_name     TEXT NOT NULL,
    body            TEXT NOT NULL,
    form            TEXT,                    -- JSON: fields the agent asks the customer to fill in
    form_response   TEXT,                    -- JSON: what the customer filled in
    tms_note_id     INTEGER,                 -- the TMS note this message came from or was posted as
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS detected_problems (
    key             TEXT PRIMARY KEY,        -- e.g. SHP-1042:overdue:DELV
    shipment_id     TEXT NOT NULL,
    problem         TEXT NOT NULL,
    case_id         TEXT,
    first_seen      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
    key             TEXT PRIMARY KEY,
    value           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_case_messages_case ON case_messages(case_id);
"""


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(config.PLUGIN_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init() -> None:
    conn = get_db()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def reset() -> None:
    """Forget every case and detected problem (used with the TMS demo reset)."""
    with write_lock:
        conn = get_db()
        try:
            conn.executescript("DROP TABLE IF EXISTS case_messages; DROP TABLE IF EXISTS cases; "
                               "DROP TABLE IF EXISTS detected_problems; DROP TABLE IF EXISTS kv;")
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()


def row(conn, sql, *args) -> dict | None:
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def rows(conn, sql, *args) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def kv_get(key: str) -> str | None:
    conn = get_db()
    try:
        r = row(conn, "SELECT value FROM kv WHERE key = ?", key)
        return r["value"] if r else None
    finally:
        conn.close()


def kv_set(key: str, value: str) -> None:
    conn = get_db()
    try:
        conn.execute("INSERT INTO kv (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
        conn.commit()
    finally:
        conn.close()
