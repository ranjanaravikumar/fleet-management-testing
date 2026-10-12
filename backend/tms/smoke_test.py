"""
smoke_test.py — checks the demo is ready, against the running server.

Start the backend first, then in another terminal (venv active):
    python -m backend.tms.smoke_test
Optional: set TMS_BASE_URL (default http://localhost:8000) and TMS_API_KEY.

WARNING: this resets all TMS data to the demo starting state.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("TMS_BASE_URL", "http://localhost:8000").rstrip("/")
KEY = os.environ.get("TMS_API_KEY", "dev-key-change-me")
CUSTOMER = os.environ.get("DEMO_CUSTOMER_EMAIL", "northfield-shipping@example.com")


def call(method, path, params=None, auth=False):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, method=method)
    req.add_header("ngrok-skip-browser-warning", "1")
    if auth:
        req.add_header("X-API-Key", KEY)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


results = []


def expect(name, actual, wanted):
    ok = actual == wanted
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {actual!r}" + ("" if ok else f" (expected {wanted!r})"))


status, body = call("POST", "/api/admin/reset", auth=True)
expect("Reset with API key", status, 200)
if status == 401:
    print("      Your TMS_API_KEY here doesn't match the server's.")

check = lambda sid, sender: call("GET", f"/api/agent-tools/shipments/{sid}/check", {"sender": sender})[1]
expect("Act 1 SHP-1042", check("SHP-1042", CUSTOMER)["recommendation"], "ask_carrier")
expect("Act 2 SHP-2048", check("SHP-2048", CUSTOMER)["recommendation"], "fix_internally")
expect("Act 3 SHP-2051", check("SHP-2051", "someone@abctrucking.example.com")["recommendation"], "needs_human")
expect("On-time SHP-2049", check("SHP-2049", CUSTOMER)["recommendation"], "answer_from_tms")
expect("Act 4 SHP45342", call("GET", "/api/agent-tools/orders/SHP45342/check")[1]["recommendation"], "ask_customer")
expect("Act 5 sweep", call("GET", "/api/agent-tools/orders/data-quality")[1]["by_fix_class"],
       {"auto": 221, "needs_human": 18, "ask_customer": 3})
expect("Lookup by BOL", call("GET", "/api/lookup", {"ref": "BOL-88421"})[1].get("id"), "SHP-1042")

print(f"\n{sum(results)}/{len(results)} checks passed.")
if CUSTOMER == "northfield-shipping@example.com":
    print("Note: DEMO_CUSTOMER_EMAIL isn't set, so the demo customer still has a placeholder address.")
