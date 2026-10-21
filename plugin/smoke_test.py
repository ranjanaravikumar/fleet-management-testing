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
from datetime import datetime, timedelta, timezone
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

# ── A customer who asked is told when a fix is made ──────────────────
status, asked = call("POST", "/api/customer-requests", {"shipment_id": "SHP-2048", "category": "status_update",
                     "channel": "email", "message": "Where is my shipment, and who is driving?"})
expect("Customer request opens a case on SHP-2048", status, 201)
applied = call("POST", "/api/agent-tools/shipments/SHP-2048/apply-fixes", {"source_ref": asked["id"]}, auth=True)[1]
expect("Fix applied and the customer told", (applied["applied"].get("truck_id"), applied["customer_notified"]),
       ("TRUCK-015", True))
told = call("GET", "/api/portal/shipments/SHP-2048", base=TMS)[1]["notes"]
expect("Customer sees what was filled in",
       any("truck TRUCK-015" in n["message"] and n["visibility"] == "customer" for n in told), True)

# ── Flow 1, Act 2, as Qubi runs it against the plugin ────────────────
case = open_case(shipment_id="SHP-2048", channel="monitor")
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
       ("Your shipment is on TRUCK-015 with Marcus Johnson.", "Qubiway Support"))
expect("Change is credited to the agent",
       {n["author"] for n in call("GET", "/api/shipments/SHP-2048", base=TMS)[1]["notes"]
        if n["message"].startswith("Filled in from TMS records")}, {"SMART API Agent"})

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
visible = lambda ship: [n["message"] for n in call("GET", f"/api/portal/shipments/{ship}", base=TMS)[1]["notes"]]
expect("A message posted with a status doesn't add a second notice",
       "Thanks. Our operations team is looking at this and will reply here." not in visible("SHP-2048"), True)

call("POST", "/api/portal/notes", {"entity_type": "shipment", "entity_id": "SHP-2049",
     "message": "Hi, where is my shipment right now?"}, base=TMS)
case = wait_for(lambda: open_case(shipment_id="SHP-2049"))
expect("A customer note in the TMS starts Flow 1", case and (case["category"], case["status"]),
       ("status_update", "new"))

# ── Decide: the AI classifier reads the request, the guardrails decide ─
decide = lambda cid, body: call("POST", f"/api/agent-tools/cases/{cid}/decide", body, auth=True)[1]
cid = case["id"]   # a customer's note on SHP-2049, which is on track
d = decide(cid, {"category": "status_update", "confidence": 0.95})
expect("On-track shipment, a status question: answer from the TMS",
       (d["recommendation"], d["category_source"]), ("answer_from_tms", "ai"))
d = decide(cid, {"category": "change_request", "confidence": 0.9})
expect("A change request always goes to a person, even on an on-track shipment",
       (d["recommendation"], [g["flag"] for g in d["guardrails"]]), ("needs_human", ["policy_change_request"]))
expect("The classifier's reading is kept on the case", call("GET", f"/api/cases/{cid}")[1]["category"], "change_request")
d = decide(cid, {"category": "status_update", "confidence": 0.3})
expect("A classifier that is unsure sends it to a person",
       (d["recommendation"], [g["flag"] for g in d["guardrails"]]), ("needs_human", ["classifier_unsure"]))
d = decide(cid, {"category": "null", "confidence": ""})
expect("No usable classification falls back to the keyword reading", d["category_source"], "rules")
d = decide(cid, {"category": "quote_question", "confidence": 0.9})
expect("Quotes go to a person", d["recommendation"], "needs_human")
monitor = open_case(shipment_id="SHP-1042")
d = decide(monitor["id"], {"category": "other", "confidence": 0.99})
expect("A detector case keeps its own topic and still goes to the carrier",
       (d["recommendation"], d["category_source"]), ("ask_carrier", "detector"))
status, hold = call("POST", "/api/customer-requests", {"ref": "SHP-2051", "channel": "email",
                    "message": "Where is my shipment?"})
d = decide(hold["id"], {"category": "status_update", "confidence": 0.9})
expect("A shipment on an account on hold goes to a person", d["recommendation"], "needs_human")

# ── A customer who asked is told when the case changes hands ─────────
patch_case = lambda case_id, status_: call("PATCH", f"/api/cases/{case_id}", {"status": status_}, auth=True)[1]
patch_case(cid, "needs_human")
expect("A customer whose case goes to a person is told", visible("SHP-2049").count("Thanks. Our operations team is looking at this and will reply here."), 1)
patch_case(cid, "needs_human")
expect("...and only once", visible("SHP-2049").count("Thanks. Our operations team is looking at this and will reply here."), 1)
patch_case(cid, "awaiting_carrier")
expect("A customer whose case goes to the carrier is told", "We're checking with the carrier and will update you here." in visible("SHP-2049"), True)
patch_case(monitor["id"], "awaiting_carrier")
expect("A case the detector found tells the customer nothing", "We're checking with the carrier and will update you here." in visible("SHP-1042"), False)

# ── Order events and review (Act 4 on a new order) ───────────────────
status, order = call("POST", "/api/portal/orders", {
    "origin_zip": "85034", "origin_state": "arizona", "origin_country": "United States",
    "dest_zip": "h1a0a9", "dest_country": "canada", "weight": "1,200 lbs", "pallet_count": "2 pallets"}, base=TMS)
expect("Quote request saved in the TMS", (status, order["source"]), (201, "portal"))
case = wait_for(lambda: open_case(order_id=order["id"]))
expect("TMS event opens a new_order case", case and case["category"], "new_order")
order_case_id = case["id"]
case = wait_for(lambda: (lambda c: c if c["status"] == "awaiting_customer" else None)(
    call("GET", f"/api/cases/{order_case_id}")[1]))
expect("The plugin reviews the new order itself and waits on the customer", case and case["status"],
       "awaiting_customer")
o = call("GET", f"/api/orders/{order['id']}", base=TMS)[1]
expect("Safe fixes were applied", (o["origin_country"], o["dest_country"], o["origin_state"]), ("US", "CA", "AZ"))
asked = call("GET", f"/api/portal/orders/{order['id']}", base=TMS)[1]["notes"][0]["message"]
expect("Question is in the order's Notes", "Pallet size, L x W x H in inches:" in asked, True)

call("POST", "/api/portal/notes", {"entity_type": "order", "entity_id": order["id"],
     "message": "Pallet size, L x W x H in inches: 48x40x50"}, base=TMS)
done = wait_for(lambda: call("GET", f"/api/orders/{order['id']}", base=TMS)[1]["skid_dims"] == "48x40x50")
expect("The customer's answer is applied without anyone asking for a second review", bool(done), True)

status, quote_q = call("POST", "/api/portal/notes", {"entity_type": "order", "entity_id": "SHP45342",
                       "message": "How much will this cost?"}, base=TMS)
q_case = wait_for(lambda: open_case(order_id="SHP45342"))
expect("A question about an order goes to a person", q_case and q_case["status"], "needs_human")

# ── Webhook ──────────────────────────────────────────────────────────
hook = call("GET", "/api/cases/webhook-status")[1]
if hook["configured"]:
    expect("Qubi webhook deliveries succeed", {a["result"] for a in hook["recent"]}, {"HTTP 200"})
    expect("Order cases never reach Flow 1",
           [a for a in hook["recent"] if a["case_id"] in (order_case_id, (q_case or {}).get("id"))], [])

# ── Flow 2: a carrier's reply, in one call ───────────────────────────
phoenix = timezone(timedelta(hours=-7))
t0 = datetime.now(phoenix)
iso_ago = lambda hours: (t0 - timedelta(hours=hours)).isoformat(timespec="seconds")
c1042 = open_case(shipment_id="SHP-1042")
status, r = call("POST", "/api/agent-tools/shipments/SHP-1042/carrier-reply", {
    "case_id": c1042["id"], "arrived_at": iso_ago(3), "delivered_at": iso_ago(2), "signed_by": "J. Ortiz",
    "summary": "Delivered and signed.", "source_ref": "[SHP-1042] test"}, auth=True)
expect("Carrier reply records arrival and delivery, and resolves the case",
       (status, r["recorded"], r["case_status"], r["shipment_status"]),
       (200, ["ARRCONSIGNEE", "DELV"], "resolved", "Delivered"))
told = call("GET", "/api/portal/shipments/SHP-1042", base=TMS)[1]["notes"]
expect("Customer is told", any("confirmed delivery in Dallas, TX" in n["message"] and "J. Ortiz" in n["message"]
                               for n in told), True)
r = call("POST", "/api/agent-tools/shipments/SHP-1042/carrier-reply", {
    "case_id": c1042["id"], "arrived_at": iso_ago(3), "delivered_at": iso_ago(2)}, auth=True)[1]
expect("The same reply twice changes nothing", (r["recorded"], r["skipped"], r["customer_message"]),
       ([], ["ARRCONSIGNEE", "DELV"], None))
r = call("POST", "/api/agent-tools/shipments/SHP-2049/carrier-reply", {
    "arrived_at": (t0 + timedelta(hours=5)).isoformat(timespec="seconds")}, auth=True)[1]
expect("A time in the future is not recorded", (r["recorded"], len(r["problems"])), ([], 1))

# ── Bug fixes: delivered shipments + repeated questions ───────────────
# Reset so SHP-2045 has no open cases.
call("POST", "/api/admin/reset", auth=True)

# Step 1: customer asks about delivered shipment SHP-2045.
call("POST", "/api/portal/notes", {"entity_type": "shipment", "entity_id": "SHP-2045",
     "message": "Hi, can you confirm my delivery?"}, base=TMS)
case_delv = wait_for(lambda: open_case(shipment_id="SHP-2045"))
expect("Delivered shipment note opens a case", bool(case_delv), True)

# Step 2: detector check recommends answer_from_tms for delivered SHP-2045.
check_delv = call("GET", "/api/agent-tools/shipments/SHP-2045/check")[1]
expect("Delivered shipment check recommends answer_from_tms",
       check_delv.get("recommendation"), "answer_from_tms")
expect("Delivered shipment check is not needs_human",
       check_delv.get("recommendation") != "needs_human", True)

# Step 3: resolve the case (simulating Flow 1 answering from TMS data).
if case_delv:
    call("POST", f"/api/cases/{case_delv['id']}/claim", auth=True)
    call("POST", f"/api/cases/{case_delv['id']}/messages",
         {"author_type": "agent", "status": "resolved",
          "body": "Your shipment was delivered and signed by P. Morales."}, auth=True)

# Step 4: customer asks again on the same delivered shipment.
call("POST", "/api/portal/notes", {"entity_type": "shipment", "entity_id": "SHP-2045",
     "message": "Hi, can you confirm my delivery?"}, base=TMS)
# Trigger the notes watcher directly so we don't have to wait for its 5-second poll interval.
call("POST", "/api/detector/run-notes", auth=True)
# No new case should be created; the resolved case answer is reposted instead.
open_after_repeat = open_case(shipment_id="SHP-2045")
expect("Repeated question on delivered shipment does not open a new case",
       open_after_repeat, None)
# A note with the reused answer should appear on the shipment.
notes_after = call("GET", "/api/portal/shipments/SHP-2045", base=TMS)[1]["notes"]
reused = any("To follow up on your earlier question:" in (n.get("message") or "") for n in notes_after)
expect("Repeated question reuses last agent answer as a new note", reused, True)

call("POST", "/api/admin/reset", auth=True)   # leave the demo clean
print(f"\n{sum(results)}/{len(results)} checks passed.")
