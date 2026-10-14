"""
smoke_test.py — checks the TMS + plugin demo end to end, against the running services.

Start the TMS (port 8000) and the plugin (port 8100) first, then (venv active):
    python -m plugin.smoke_test
Optional: PLUGIN_URL (default http://localhost:8100), TMS_URL (default
http://localhost:8000) and TMS_API_KEY.

It plays the part of the Qubi flows, calling the plugin exactly as they do.
WARNING: this resets all demo data, and leaves it reset at the end.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PLUGIN = os.environ.get("PLUGIN_URL", "http://localhost:8100").rstrip("/")
TMS = os.environ.get("TMS_URL", "http://localhost:8000").rstrip("/")
KEY = os.environ.get("TMS_API_KEY", "dev-key-change-me")
CUSTOMER = os.environ.get("DEMO_CUSTOMER_EMAIL", "northfield-shipping@example.com")


def call(method, path, body=None, params=None, base=PLUGIN, auth=False):
    url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    req.add_header("ngrok-skip-browser-warning", "1")
    if auth:
        req.add_header("X-API-Key", KEY)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


results = []


def expect(name, actual, wanted):
    ok = actual == wanted
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {actual!r}" + ("" if ok else f" (expected {wanted!r})"))


def wait_for(fn, seconds=15):
    """Poll until fn() returns something truthy (the notes watcher and order events run in the background)."""
    end = time.time() + seconds
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.5)
    return None


def open_case(**filters):
    return (call("GET", "/api/cases", params={"status": "open", **filters})[1] or [None])[0]


# ── Reset ────────────────────────────────────────────────────────────
status, _ = call("POST", "/api/admin/reset", auth=True)
expect("Reset TMS and plugin", status, 200)
if status == 401:
    print("      TMS_API_KEY here doesn't match the plugin's / TMS's.")

# ── Toolkit: the same answers as before, through the TMS API ─────────
check = lambda sid, sender: call("GET", f"/api/agent-tools/shipments/{sid}/check", params={"sender": sender})[1]
expect("Act 1 SHP-1042", check("SHP-1042", CUSTOMER)["recommendation"], "ask_carrier")
expect("Act 2 SHP-2048", check("SHP-2048", CUSTOMER)["recommendation"], "fix_internally")
expect("Act 3 SHP-2051", check("SHP-2051", "someone@abctrucking.example.com")["recommendation"], "needs_human")
expect("On-time SHP-2049", check("SHP-2049", CUSTOMER)["recommendation"], "answer_from_tms")
expect("Act 4 SHP45342", call("GET", "/api/agent-tools/orders/SHP45342/check")[1]["recommendation"], "ask_customer")
expect("Act 5 sweep", call("GET", "/api/agent-tools/orders/data-quality")[1]["by_fix_class"],
       {"auto": 221, "info": 63, "ask_customer": 15, "needs_human": 12})
expect("Portal shipments list", call("GET", "/api/portal/shipments", params={"customer_code": "NFAS"}, base=TMS)[0], 200)
expect("Portal orders list", call("GET", "/api/portal/orders", params={"customer_code": "NFAS"}, base=TMS)[0], 200)
expect("TMS flags the overdue delivery itself",
       call("GET", "/api/shipments/SHP-1042", base=TMS)[1]["tracking_alert"], "Delivery overdue")
expect("Lookup through the plugin", call("GET", "/api/lookup", params={"ref": "BOL-88421"})[1].get("id"), "SHP-1042")

# ── Detector: once per new problem ───────────────────────────────────
first = call("POST", "/api/detector/run", auth=True)[1]
expect("Detector opens cases for SHP-1042 and SHP-2048",
       sorted(c["shipment_id"] for c in (call("GET", f"/api/cases/{i}")[1] for i in first["opened_cases"])),
       ["SHP-1042", "SHP-2048"])
expect("Detector reports nothing new on the next run", call("POST", "/api/detector/run", auth=True)[1]["opened_cases"], [])

# ── Flow 1, Act 2, as Qubi runs it against the plugin ────────────────
case = open_case(shipment_id="SHP-2048")
expect("Detector case is new, from monitoring", (case["status"], case["channel"]), ("new", "monitor"))
expect("Claim", call("POST", f"/api/cases/{case['id']}/claim", auth=True)[1]["status"], "in_progress")
expect("Claim again is refused", call("POST", f"/api/cases/{case['id']}/claim", auth=True)[0], 409)
fixes = check("SHP-2048", None)["internal_fixes"]
for f in fixes:   # PATCH /api/shipments/{id}: a plain TMS call, passed through the plugin
    call("PATCH", "/api/shipments/SHP-2048", {f["field"]: f["value"], "reason": f["evidence"],
                                              "source_ref": case["id"]}, auth=True)
expect("Truck filled in on the TMS", call("GET", "/api/shipments/SHP-2048", base=TMS)[1]["truck_id"], "TRUCK-015")
call("POST", f"/api/cases/{case['id']}/messages", {"author_type": "agent", "status": "resolved",
     "body": "Your shipment is on TRUCK-015 with Marcus Johnson."}, auth=True)
notes = call("GET", "/api/portal/shipments/SHP-2048", base=TMS)[1]["notes"]
expect("Customer sees the answer in the shipment's Notes",
       (notes[0]["message"], notes[0]["author"]),
       ("Your shipment is on TRUCK-015 with Marcus Johnson.", "TruckerPath Support"))
expect("Change is credited to the agent", call("GET", "/api/shipments/SHP-2048", base=TMS)[1]["notes"][1]["author"],
       "SMART API Agent")

# ── Customer requests ────────────────────────────────────────────────
status, req = call("POST", "/api/customer-requests", {"ref": "BOL-89107", "channel": "email",
                   "message": "Please deliver to our Mesa warehouse instead.", "sender_email": CUSTOMER})
expect("Customer request opens a change_request case", (status, req["category"], req["shipment_id"]),
       (201, "change_request", "SHP-2048"))
call("POST", f"/api/cases/{req['id']}/claim", auth=True)
call("POST", f"/api/cases/{req['id']}/messages", {"author_type": "agent", "status": "needs_human",
     "body": "Our operations team is on it."}, auth=True)
internal = call("GET", "/api/notes", params={"entity_id": "SHP-2048", "action": "handoff"}, base=TMS)[1]
expect("Handoff left as an internal note for staff", any(n["action"] == "handoff" for n in internal), True)

call("POST", "/api/portal/notes", {"entity_type": "shipment", "entity_id": "SHP-2049",
     "message": "Hi, where is my shipment right now?"}, base=TMS)
case = wait_for(lambda: open_case(shipment_id="SHP-2049"))
expect("A customer note in the TMS starts Flow 1", case and (case["category"], case["status"]),
       ("status_update", "new"))

# ── Order events and review (Act 4 on a new order) ───────────────────
status, order = call("POST", "/api/portal/orders", {
    "origin_zip": "85034", "origin_state": "arizona", "origin_country": "United States",
    "dest_zip": "h1a0a9", "dest_country": "canada", "weight": "1,200 lbs", "pallet_count": "2 pallets"}, base=TMS)
expect("Quote request saved in the TMS", (status, order["source"]), (201, "portal"))
case = wait_for(lambda: open_case(order_id=order["id"]))
expect("TMS event opens a new_order case", case and case["category"], "new_order")
if case and case["status"] == "new":   # Qubi reviews it (with no Qubi webhook the plugin already did)
    call("POST", f"/api/cases/{case['id']}/claim", auth=True)
    review = call("POST", f"/api/agent-tools/orders/{order['id']}/review", {"case_id": case["id"]}, auth=True)[1]
    expect("Review applies safe fixes and asks for the rest", (review["next_step"], len(review["applied"])),
           ("ask_customer", 7))
case = call("GET", f"/api/cases/{case['id']}")[1]
expect("Case waits on the customer", case["status"], "awaiting_customer")
asked = call("GET", f"/api/portal/orders/{order['id']}", base=TMS)[1]["notes"][0]["message"]
expect("Question is in the order's Notes", "Pallet size, L x W x H in inches:" in asked, True)

call("POST", "/api/portal/notes", {"entity_type": "order", "entity_id": order["id"],
     "message": "Pallet size, L x W x H in inches: 48x40x50"}, base=TMS)
case = wait_for(lambda: (lambda c: c if c["status"] == "customer_replied" else None)(
    call("GET", f"/api/cases/{case['id']}")[1]))
expect("Customer's note is read as their answer", case and case["latest_form_response"], {"dims": "48x40x50"})
review = call("POST", f"/api/agent-tools/orders/{order['id']}/review", {"case_id": case["id"]}, auth=True)[1]
expect("Second review uses the answer", call("GET", f"/api/orders/{order['id']}", base=TMS)[1]["skid_dims"],
       "48x40x50")

# ── Webhook ──────────────────────────────────────────────────────────
hook = call("GET", "/api/cases/webhook-status")[1]
if hook["configured"]:
    expect("Qubi webhook deliveries succeed", {a["result"] for a in hook["recent"]}, {"HTTP 200"})

call("POST", "/api/admin/reset", auth=True)   # leave the demo clean
print(f"\n{sum(results)}/{len(results)} checks passed.")
