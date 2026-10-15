# SMART Agent Demo — Full Technical Report

## What this project is

A working demo that proves one argument: **an AI agent can be plugged into any existing TMS to handle carrier communication, exceptions and data quality automatically**, without changing the TMS itself.

The demo is built as three completely separate services that talk to each other only through APIs.

---

## Architecture: the three services

```
Browser
  │
  ├── TMS screens (Vite dev server, port 5173)
  │     /tms/ops/*         Operations console
  │     /tms/portal/*      Customer portal
  │
  ├── TMS backend (FastAPI, port 8000)   ←── "the existing TMS"
  │     /api/shipments     Shipments, tracking, documents, charges
  │     /api/orders        Orders and quotes
  │     /api/customers     Customer accounts
  │     /api/carriers      Carrier profiles
  │     /api/drivers       Driver list
  │     /api/trucks        Truck fleet
  │     /api/notes         Notes on any record (customer-visible or internal)
  │     /api/lookup        Find anything from any reference number
  │     /api/admin/reset   Reset the demo data
  │
  └── Plugin (FastAPI, port 8100)        ←── "the SMART API Agent"
        /api/cases/*            Cases Flow 1 works on
        /api/agent-tools/*      The toolkit: checks and fixes
        /api/customer-requests  Customer asks → Flow 1
        /events/tms             TMS reports a submitted order
        /api/detector/*         Detector status and manual trigger
        /api/*                  Everything else passed to the TMS unchanged

Qubi (cloud)
  Flow 1: a case arrives → AI decides and acts → writes back to the TMS
  Flow 2: carrier replies by email → AI reads it → updates milestones
```

**The key design decision:** the TMS knows nothing about the agent. It has no cases screen, no agent tabs, no approve buttons. The agent's work appears only as notes on the shipment or order. This is what makes it a demo of a plugin, not a custom system.

---

## The TMS (port 8000)

**Files:** `backend/tms/`

**Database:** SQLite (`tms.db`), reset on start if the schema changed.

**Tables:**
- `shipments` — id, origin, destination, status, truck, driver, carrier, commodity, weight, appointments, references (BOL, PO, PRO, customer_ref), invoice status
- `milestones` — tracking events on a shipment (BOOKED → PICK → INTRANSIT → ARRCONSIGNEE → DELV → POD)
- `check_calls` — dispatcher's running notes: time, location, miles out, ETA
- `notes` — notes on any record; `visibility` is `customer` or `internal`
- `orders` — quote requests from the portal, or keyed in by staff
- `customers` — accounts with on-hold flag
- `carriers` — MC/DOT, insurance expiry, contact email
- `drivers` — CDL, HOS hours remaining
- `trucks` — unit number, make/model, service date
- `documents` — uploaded files (BOL, POD, rate confirmation)
- `charges` — line items on a shipment; customer side and carrier side
- `cases` — **plugin-only**: the TMS stores them but the plugin owns them
- `rate_table` — lane × weight break → base rate (used by auto-rating)

**Demo data (resets every run):**
- 4 demo shipments with known problems (SHP-1042 overdue, SHP-2048 no truck, SHP-2051 on hold, SHP-2049 on track)
- 10 background shipments (all healthy, all with trucks and future appointments)
- 6 customers, 5 carriers, 6 drivers, 7 trucks
- 106 orders from `orders.csv` with messy data (intentionally dirty for the data sweep act)

**The TMS fires an event to the plugin** (`TMS_EVENTS_URL`) whenever a customer submits an order via the portal. That's the only thing the TMS does toward the plugin.

---

## The Plugin (port 8100)

**Files:** `plugin/`

**Its own database:** `plugin.db` (SQLite). Stores cases and the detector's memory of what problems it has already reported.

### What it does

**1. Detector** (`plugin/detector.py`) — two background threads:

- **Shipment checker** — every 60 seconds, reads all active shipments from the TMS, runs `shipment_check()` on each. For every new problem found (identified by a key like `SHP-1042:overdue:DELV`), it creates a case and fires the Qubi webhook. It never reports the same problem twice.
- **Notes watcher** — every 5 seconds, reads new customer-visible notes from the TMS. If the note is on a record that already has an open case waiting for the customer, it treats the note as the customer's reply and fires `case.customer_replied` to Qubi. Otherwise it treats the note as a new customer request and creates a case.

**2. Cases** (`plugin/cases.py`):
A case has a `category` (status_update, truck_number, change_request, quote_question, other), a `status` (new → in_progress → awaiting_carrier / awaiting_customer / needs_human → resolved), and a `messages` list. Every Qubi step that needs to tell the customer something posts a message here; the plugin writes it to the TMS's Notes tab.

**3. Toolkit** (`plugin/toolkit.py` and `plugin/checks.py`):
The rules-based part. Qubi calls these instead of deciding in the AI:

| Endpoint | What it does |
|---|---|
| `GET /api/agent-tools/shipments/{id}/check` | Returns `recommendation`, `evidence`, `internal_fixes`, `guardrails` |
| `PATCH /api/shipments/{id}` | Apply a fix (truck, driver, appointment); logs a note |
| `POST /api/shipments/{id}/milestones` | Record a tracking event from the carrier's email |
| `GET /api/agent-tools/orders/{id}/check` | Checks order data quality; returns what's auto-fixable |
| `PATCH /api/orders/{id}` | Apply auto-fixes |
| `GET /api/agent-tools/orders/data-quality` | Summary across all orders |
| `POST /api/agent-tools/orders/apply-safe-fixes` | Bulk apply auto-fixable issues |

**4. Passthrough** — any call to `/api/*` that the plugin doesn't handle itself is forwarded to the TMS. So Qubi only needs one base URL and one API key.

---

## Qubi (the AI layer)

Qubi is a no-code workflow platform. The flows are not yet fully wired — that's what's next. Here is what they will do when complete.

### Flow 1: a case arrives

**Trigger:** the plugin fires a webhook to Qubi when a case is created or when a customer replies. Qubi receives:
```json
{
  "event": "case.created",
  "case_id": "CASE-1002",
  "case": { ...full case with messages... }
}
```

**Steps:**

1. **Claim** — `POST /api/cases/{case_id}/claim`. If 409, stop (another run got it).
2. **Check** — `GET /api/agent-tools/shipments/{id}/check`. Gets back a `recommendation`.
3. **Branch on recommendation:**

| recommendation | What Qubi does |
|---|---|
| `answer_from_tms` | Get the shipment; AI writes a reply from the data; post it as resolved |
| `fix_internally` | PATCH the shipment with the fix (e.g. truck number from the load); then answer |
| `ask_carrier` | Send an email to the carrier's address from the shipment record; post "we're checking with the carrier" |
| `ask_customer` | Post a message asking for missing details (pallets, dims); wait |
| `needs_human` | Create an ActionHub task for staff; post "our team is on it" |

4. **Post the reply** — `POST /api/cases/{case_id}/messages`. This writes a customer-visible note on the shipment in the TMS.

**When the customer replies** (event `case.customer_replied`):
- Read the form_response from the newest message
- PATCH the order with the customer's answer
- Create an ActionHub pricing task
- Post "thanks, our pricing team will be in touch"

### Flow 2: carrier replies by email

**Trigger:** new email in the agent's Gmail inbox.

**Steps:**
1. Pull shipment ID and case ID from the email subject brackets
2. AI step reads the email and returns structured JSON (arrived_at, delivered_at, signed_by, delay_reason)
3. POST the ARRCONSIGNEE and DELV milestones to the TMS
4. Post the confirmation to the customer; mark the case resolved

### Flow C: data sweep (Act 5)

**Trigger:** scheduled or manual.

1. `GET /api/agent-tools/orders/data-quality` — see what's fixable
2. `POST /api/agent-tools/orders/apply-safe-fixes` — fix 200+ fields automatically
3. ActionHub task for the 12 orders that need a person
4. Post a summary note to the TMS

---

## What's done vs what's still needed

| Piece | Status |
|---|---|
| TMS backend — all APIs | Done |
| TMS screens — all 10 screens | Done |
| Plugin — detector, cases, toolkit, passthrough | Done |
| Smoke test — all 5 acts end to end | Passing 28/28 |
| Qubi Flow 1 — drafted by Autopilot | **Not wired: missing shipment_id mapping and Email Writer agent** |
| Qubi Flow 2 — drafted | **Not wired: Gmail accounts not set up** |
| Webhook — curl test | **Not done: QUBI_WEBHOOK_URL not set on plugin** |
| TMS UI polish — check calls, accessorial codes, auto-rating, staff order entry | Done |

---

## What "Flow 1 wiring" means concretely

Right now Flow 1 was drafted by Qubi's Autopilot, which means the steps exist but aren't connected to the real endpoints. Three things are missing:

1. **`shipment_id` mapping.** The webhook body contains `case.shipment_id`. Flow 1 needs to read that field and use it in every subsequent API call. Autopilot may have left a placeholder.
2. **Email Writer agent.** The `ask_carrier` branch needs an AI step that takes the shipment data and writes the carrier email. This is the one Qubi AI step that needs to be configured with the prompt from `docs/qubi-build-guide.md`.
3. **Webhook URL on the plugin.** Set `QUBI_WEBHOOK_URL` and `QUBI_TRIGGER_SECRET` in the plugin's environment. Until then, the detector runs but its findings go nowhere.

Those three things are the entire "Flow 1" task in STATUS.md.
