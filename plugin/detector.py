"""
detector.py — the plugin's two background jobs.

Detector (every DETECTOR_INTERVAL_SECONDS, 60 by default):
    Reads the active shipments from the TMS, runs the shipment check on each,
    and starts Flow 1 once for every problem it hasn't reported before:
      overdue milestone     → case "Where is my shipment?" (status_update)
      truck/driver missing  → case "Need the truck number" (truck_number)
    A problem is remembered by key (e.g. SHP-1042:overdue:DELV), so it is
    reported once. A later problem on the same shipment is new and is reported.

Notes watcher (every NOTES_POLL_SECONDS, 5 by default):
    Reads new customer notes from the TMS. A note on a record with a case
    waiting for the customer is their reply; any other note is a new request.
"""
import threading
import traceback

from plugin import cases, config, qubi, store, tms_client
from plugin.clock import stamp
from plugin.toolkit import shipment_check

_stop = threading.Event()
_threads: list[threading.Thread] = []
_last = {"detector": None, "notes": None}


# ── Detector ─────────────────────────────────────────────────────────

def problems_for(check: dict) -> list[dict]:
    """The problems in one shipment check, each with a stable key and the case topic it opens."""
    sid = check["shipment_id"]
    out = [{"key": f"{sid}:overdue:{o['code']}", "category": "status_update",
            "text": f"{o['label']} overdue by {o['overdue_minutes']} min"}
           for o in check["overdue_milestones"]]
    missing = [f["field"] for f in check["internal_fixes"]] + [u["field"] for u in check["unresolved_fields"]]
    out += [{"key": f"{sid}:missing:{field}", "category": "truck_number",
             "text": f"{'Truck' if field == 'truck_id' else 'Driver'} not recorded on the shipment"}
            for field in dict.fromkeys(missing)]
    return out


def run_detector() -> dict:
    """One pass over the active shipments. Returns what it found and which cases it opened."""
    found, opened = [], []
    conn = store.get_db()
    try:
        seen = {r["key"] for r in store.rows(conn, "SELECT key FROM detected_problems")}
    finally:
        conn.close()

    for s in tms_client.active_shipments():
        full = tms_client.shipment(s["id"])
        check = shipment_check(s["id"], s=full)
        new = [p for p in problems_for(check) if p["key"] not in seen]
        found += [{**p, "shipment_id": s["id"]} for p in problems_for(check)]
        by_topic: dict[str, list[dict]] = {}
        for p in new:
            by_topic.setdefault(p["category"], []).append(p)
        for category, problems in by_topic.items():
            found_text = "Detected by monitoring: " + "; ".join(p["text"] for p in problems) + "."
            message = f"{found_text} {check['summary']}"
            case_id, created = cases.create_case(
                customer_code=None, shipment_id=s["id"], order_id=None, channel="monitor", category=category,
                message=message, author_name="TruckerPath monitoring", author_type="system")
            conn = store.get_db()
            try:
                for p in problems:
                    conn.execute("INSERT OR IGNORE INTO detected_problems (key, shipment_id, problem, case_id, "
                                 "first_seen) VALUES (?,?,?,?,?)", (p["key"], s["id"], p["text"], case_id, stamp()))
                conn.commit()
            finally:
                conn.close()
            if created:
                tms_client.add_note("shipment", s["id"], f"{found_text} Opened {case_id} for the agent.",
                                    action="problem_detected", source_ref=case_id)
                qubi.notify("case.created", cases.get_case(case_id))
                opened.append(case_id)
    _last["detector"] = {"at": stamp(), "problems": len(found), "opened": opened}
    return {"checked_at": stamp(), "problems": found, "opened_cases": opened}


# ── Customer notes watcher ───────────────────────────────────────────

def run_notes_watcher() -> list[dict]:
    """Pick up customer notes written since the last pass."""
    cursor = store.kv_get("notes_cursor")
    latest = tms_client.latest_note_id()
    if cursor is None:
        # First run: start from now; older notes are history, not new requests.
        store.kv_set("notes_cursor", str(latest))
        return []
    if latest < int(cursor):
        # The TMS was reset on its own (note IDs started again). Its old cases and
        # problems point at data that's gone, so start over, as POST /api/admin/reset does.
        store.reset()
        cases._customer_cache.clear()
        store.kv_set("notes_cursor", str(latest))
        return []
    handled = []
    for note in tms_client.customer_notes_after(int(cursor)):
        try:
            result = cases.handle_customer_note(note)
            if result:
                event, case_id = result
                qubi.notify(event, cases.get_case(case_id))
                handled.append({"note_id": note["id"], "event": event, "case_id": case_id})
        except Exception:  # noqa: BLE001 — one bad note must not stop the others
            traceback.print_exc()
        store.kv_set("notes_cursor", str(note["id"]))
    _last["notes"] = {"at": stamp(), "handled": handled}
    return handled


# ── Background loop ──────────────────────────────────────────────────

def _loop(name: str, interval: int, job):
    while not _stop.is_set():
        try:
            job()
        except Exception as e:  # noqa: BLE001 — keep running; the TMS may just be restarting
            _last[name] = {"at": stamp(), "error": str(getattr(e, "detail", e))}
            print(f"[{name}] {_last[name]}")
        _stop.wait(interval)


def start() -> None:
    _stop.clear()
    jobs = []
    if config.DETECTOR_ENABLED:
        jobs.append(("detector", config.DETECTOR_INTERVAL_SECONDS, run_detector))
    if config.WATCH_CUSTOMER_NOTES:
        jobs.append(("notes", config.NOTES_POLL_SECONDS, run_notes_watcher))
    for name, interval, job in jobs:
        t = threading.Thread(target=_loop, args=(name, interval, job), name=name, daemon=True)
        t.start()
        _threads.append(t)


def stop() -> None:
    _stop.set()


def status() -> dict:
    return {
        "detector": {"enabled": config.DETECTOR_ENABLED, "interval_seconds": config.DETECTOR_INTERVAL_SECONDS,
                     "last_run": _last["detector"]},
        "notes_watcher": {"enabled": config.WATCH_CUSTOMER_NOTES, "interval_seconds": config.NOTES_POLL_SECONDS,
                          "cursor": store.kv_get("notes_cursor"), "last_run": _last["notes"]},
    }
