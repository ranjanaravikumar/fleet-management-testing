"""
classifier_check.py — runs sample customer requests through the real Flow 1 and checks what the
AI classifier read.

Each message becomes a customer request on one shipment. Flow 1 runs, the classifier reads it, and the plugin
leaves an internal note: Request read as "<topic>" (confidence <n>). This script compares that with the
answer we expect, then resolves the case so the next message gets a fresh one.

    python -m plugin.classifier_check                 # all messages (about 15 s each)
    python -m plugin.classifier_check --markdown      # print the list as a table, run nothing
    python -m plugin.classifier_check --only change   # just messages whose text or topic contains 'change'

Needs the TMS, the plugin and a published Flow 1. Every message runs the flow, so it spends AI credits.
Optional: PLUGIN_URL, TMS_API_KEY, CHECK_SHIPMENT (default SHP-2049, an on-track demo shipment).
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

PLUGIN = os.environ.get("PLUGIN_URL", "http://localhost:8100").rstrip("/")
KEY = os.environ.get("TMS_API_KEY", "dev-key-change-me")
SHIPMENT = os.environ.get("CHECK_SHIPMENT", "SHP-2049")
MIN_CONFIDENCE = 0.6

LABELS = {"Where is my shipment?": "status_update", "Need the truck number": "truck_number",
          "Change a delivery detail": "change_request", "Question about my quote": "quote_question",
          "Something else": "other"}

# (message, expected topic, expected to be unsure?)
MESSAGES = [
    ("Where is my shipment right now?", "status_update", False),
    ("Has it been delivered yet?", "status_update", False),
    ("What's the ETA for this load?", "status_update", False),
    ("Any update on my freight?", "status_update", False),
    ("Can you confirm when it arrives in Dallas?", "status_update", False),
    ("My delivery is late, where is it?", "status_update", False),
    ("Who is the driver and which truck?", "truck_number", False),
    ("What's the truck number?", "truck_number", False),
    ("Can I get the driver's name and phone number?", "truck_number", False),
    ("Which truck is picking up my freight?", "truck_number", False),
    ("Please deliver to our Mesa warehouse instead", "change_request", False),
    ("Can we move the delivery to Friday morning?", "change_request", False),
    ("I need to cancel this shipment", "change_request", False),
    ("Reroute it to our Reno dock please", "change_request", False),
    ("Add two more pallets to this load", "change_request", False),
    ("Change the pickup time to 3pm", "change_request", False),
    ("How much did this cost?", "quote_question", False),
    ("Can you send me the rate for this lane?", "quote_question", False),
    ("Why is my invoice higher than the quote?", "quote_question", False),
    ("What would it cost to add a liftgate?", "quote_question", False),
    ("ok thanks", "other", False),
    ("Thank you so much!", "other", False),
    ("Do you also ship to Canada?", "other", False),
    ("hello", "other", False),
    ("Where is it, and can you move it to tomorrow?", "change_request", False),   # mixed: a change wins
    ("Who is the driver, and how much was it?", "truck_number", False),           # mixed, no change: the first thing asked
    ("hmm what about the other thing", "other", True),
    ("can you look into it", "other", True),
]


def call(method, path, body=None, params=None):
    url = PLUGIN + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    req.add_header("ngrok-skip-browser-warning", "1")
    req.add_header("X-API-Key", KEY)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def read_back(case_id, timeout):
    """The classifier's note for this case: (topic, confidence), or None if the flow never got that far."""
    end = time.time() + timeout
    while time.time() < end:
        notes = call("GET", "/api/notes", params={"entity_type": "shipment", "entity_id": SHIPMENT,
                                                   "action": "classified", "limit": 50})[1]
        for n in notes:
            if n.get("source_ref") == case_id:
                m = re.search(r'read as "(.+?)"(?: \(confidence ([\d.]+)\))?', n["message"])
                if m:
                    return LABELS.get(m.group(1), m.group(1)), float(m.group(2)) if m.group(2) else None
        time.sleep(2)
    return None


def markdown():
    print("| # | Customer says | Expected topic | Should be unsure? |\n|---|---|---|---|")
    for i, (msg, topic, unsure) in enumerate(MESSAGES, 1):
        print(f"| {i} | {msg} | `{topic}` | {'yes (below %.1f)' % MIN_CONFIDENCE if unsure else 'no'} |")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--markdown", action="store_true", help="print the list as a table and exit")
    ap.add_argument("--only", help="only messages whose text or expected topic contains this")
    ap.add_argument("--timeout", type=int, default=90, help="seconds to wait for each flow run")
    args = ap.parse_args()
    if args.markdown:
        return markdown()

    wrong, silent, total = [], [], 0
    for msg, topic, unsure in MESSAGES:
        if args.only and args.only.lower() not in (msg + " " + topic).lower():
            continue
        total += 1
        status, case = call("POST", "/api/customer-requests",
                            {"shipment_id": SHIPMENT, "message": msg, "channel": "email"})
        if status == 200:   # an earlier case on this topic is still open; close it and try once more
            call("PATCH", f"/api/cases/{case['id']}", {"status": "resolved"})
            status, case = call("POST", "/api/customer-requests",
                                {"shipment_id": SHIPMENT, "message": msg, "channel": "email"})
        got = read_back(case["id"], args.timeout) if status == 201 else None
        if got is None:
            silent.append(msg)
            print(f"NONE   {msg!r}: the classifier left no note (flow failed, or its output wasn't read)")
        else:
            read, conf = got
            unsure_got = conf is not None and conf < MIN_CONFIDENCE
            ok = read == topic and unsure_got == unsure
            print(f"{'PASS' if ok else 'DIFF'}   {msg!r}: read {read} ({conf}), expected {topic}"
                  + (", unsure" if unsure else ""))
            if not ok:
                wrong.append(msg)
        call("PATCH", f"/api/cases/{case['id']}", {"status": "resolved"})
    print(f"\n{total - len(wrong) - len(silent)}/{total} as expected; {len(wrong)} differ; {len(silent)} unread.")


if __name__ == "__main__":
    main()
