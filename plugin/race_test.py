"""
race_test.py — what happens when a person edits a record while the agent is working on it.

A person's edit always wins. The agent writes "if it still is what I saw"; if it isn't, the TMS refuses and the
agent leaves the person's value alone. This test makes a person save at the worst moment: after the agent has
read the record and before it writes.

Run with the TMS up and the PLUGIN STOPPED (otherwise the plugin also reviews the test order itself):
    python -m plugin.race_test
Needs TMS_URL (default http://localhost:8000) and TMS_API_KEY. WARNING: resets the TMS demo data.
"""
import json
import urllib.error
import urllib.request

from plugin import config, toolkit, tms_client

results = []


def expect(name, actual, wanted):
    ok = actual == wanted
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {actual!r}" + ("" if ok else f" (expected {wanted!r})"))


def tms(method, path, body=None, key=True):
    req = urllib.request.Request(config.TMS_URL + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("X-API-Key", config.TMS_API_KEY)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def person_edits_shipment(shipment_id, **fields):
    return tms("PATCH", f"/api/shipments/{shipment_id}", {**fields, "reason": "Edited by a person",
                                                          "author": "Alex Rivera"})


def person_edits_order(order_id, **fields):
    return tms("PATCH", f"/api/orders/{order_id}", {**fields, "reason": "Edited by a person", "author": "Alex Rivera"})


def race(module, name, on_call):
    """Wrap module.name so `on_call(n)` runs just before the n-th real call: a person saving mid-work."""
    real, state = getattr(module, name), {"n": 0}

    def wrapped(*a, **k):
        state["n"] += 1
        on_call(state["n"])
        return real(*a, **k)

    setattr(module, name, wrapped)
    return lambda: setattr(module, name, real)


print("Resetting the TMS demo data")
expect("reset", tms("POST", "/api/admin/reset")[0], 200)

# ── 1. The agent fills in a missing truck; a person fills it in first ─────────────────────
before = tms_client.shipment("SHP-2048")
expect("SHP-2048 starts with no truck", before["truck_id"], None)
undo = race(tms_client, "update_shipment", lambda n: person_edits_shipment("SHP-2048", truck_id="TRUCK-099"))
result = toolkit.apply_shipment_fixes("SHP-2048")
undo()
after = tms_client.shipment("SHP-2048")
expect("a person saved between the agent's read and write: the agent writes nothing", result["applied"], {})
expect("...and says why", bool(result["conflicts"]), True)
expect("the person's truck stands", after["truck_id"], "TRUCK-099")
expect("the agent left a note that it left it alone",
       any(n["action"] == "conflict" for n in after["notes"]), True)

# ── 2. A person edits an order mid-review: the agent starts again from their version ─────
status, order = tms("POST", "/api/portal/orders", {"origin_zip": "85034", "origin_state": "arizona",
                    "origin_country": "United States", "dest_zip": "60601", "dest_state": "IL", "dest_country": "US",
                    "weight": "1,200 lbs", "pallet_count": "2"}, key=False)
oid = order["id"]
undo = race(tms_client, "update_order", lambda n: person_edits_order(oid, weight_lbs="1500") if n == 1 else None)
review = toolkit.review_order(oid, None)
undo()
final = tms_client.order(oid)
expect("a person changed the weight mid-review: the review carried on from their version",
       review["next_step"] != "conflict", True)
expect("the person's weight stands", final["weight_lbs"], "1500")
expect("the agent still tidied what the person didn't touch", final["origin_state"], "AZ")

# ── 3. A person keeps editing the same field: the agent stops and hands over instead of fighting ──
# Each time the agent is about to standardise the pickup country, a person writes it their own way.
status, order2 = tms("POST", "/api/portal/orders", {"origin_zip": "85034", "origin_state": "AZ",
                     "origin_country": "United States", "dest_zip": "60601", "dest_state": "IL", "dest_country": "US",
                     "weight": "1200", "pallet_count": "2"}, key=False)
oid2 = order2["id"]
theirs = ["USA", "United States", "USA"]
undo = race(tms_client, "update_order", lambda n: person_edits_order(oid2, origin_country=theirs[(n - 1) % 3]))
review = toolkit.review_order(oid2, None)
undo()
expect("a record a person keeps changing is handed over, not fought over", review["next_step"], "conflict")
expect("the person's own wording stands, not the agent's standard form",
       tms_client.order(oid2)["origin_country"] in theirs, True)

tms("POST", "/api/admin/reset")   # leave the demo clean
print(f"\n{sum(results)}/{len(results)} checks passed.")
