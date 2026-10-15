# SMART API Agent plugin

A separate service that sits next to the TMS and connects it to the Qubi
flows. It talks to the TMS **only through the TMS's normal API**
(`backend/tms`), the same way any other integration would.

```
                 ┌───────────── plugin (port 8100) ─────────────┐
TMS (8000)       │                                               │        Qubi
 shipments ◄─────┤ Detector      every minute: new problem? ─────┼──► Flow 1 webhook
 notes     ◄─────┤ Notes watcher customer wrote a note? ─────────┼──► Flow 1 webhook
 orders ─event──►│ /events/tms   order submitted → review case ──┼──► Flow 1 webhook
                 │ /api/customer-requests  customer asks ────────┼──► Flow 1 webhook
           ◄─────┤ /api/cases, /api/agent-tools  (toolkit) ◄─────┼─── Flow 1 calls
           ◄─────┤ anything else under /api → passed to the TMS ◄┼─── Flow 1 calls
                 └───────────────────────────────────────────────┘
```

## What it does

| Piece | What it does |
|---|---|
| **Detector** | Every minute, reads the active shipments and runs the shipment check on each. Each new problem (a milestone overdue, the truck or driver missing) opens a case and starts Flow 1, **once per problem**. Problems are remembered by key, e.g. `SHP-1042:overdue:DELV` |
| **Customer requests** | `POST /api/customer-requests` opens a case and starts Flow 1. The notes watcher does the same when a customer writes a note on a shipment or order in the TMS portal |
| **Order events** | The TMS sends `order.submitted` to `/events/tms`. The plugin opens a "New order review" case and starts Flow 1, which calls the review tool. With no Qubi webhook set, the plugin runs the review itself |
| **Toolkit** | `/api/agent-tools/...`: the checks (what should the agent do about this shipment, data problems in this order) and the fixes (fill in from TMS records, safe order fixes, order review). Every read and write goes through the TMS API |

What the customer should see is written to the TMS as a **customer-visible
note** on the shipment or order. When the agent needs details, the note
lists the questions; the customer answers with a note, which the plugin
reads back as the answer (`Pallet size, L x W x H in inches: 48x40x50`).

## Run it

Start the TMS first (see `backend/tms/README.md`), then in a second terminal,
venv active, from the project root:

```
pip install -r plugin/requirements.txt
uvicorn plugin.main:app --reload --port 8100
```

Tell the TMS where to send events, and restart it:

```
TMS_EVENTS_URL=http://localhost:8100/events/tms
```

Check everything end to end (this resets the demo data):

```
python -m plugin.smoke_test
```

Open http://localhost:8100/docs to see every endpoint.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `TMS_URL` | `http://localhost:8000` | Where the TMS is |
| `TMS_API_KEY` | `dev-key-change-me` | The key the plugin uses for its own writes to the TMS |
| `PLUGIN_API_KEY` | same as `TMS_API_KEY` | The key callers (Qubi) send in `X-API-Key`. Defaulting to the TMS key means the flows keep the key they have |
| `QUBI_WEBHOOK_URL` | empty | Flow 1's trigger callback URL |
| `QUBI_TRIGGER_SECRET` | empty | Sent as `X-Trigger-Secret` with each webhook |
| `TMS_EVENTS_SECRET` | empty | Must match the TMS's `TMS_EVENTS_SECRET` when set |
| `DETECTOR_ENABLED` | `true` | Turn the detector off for a demo where you want to start every case by hand |
| `DETECTOR_INTERVAL_SECONDS` | `60` | How often the detector checks |
| `WATCH_CUSTOMER_NOTES` | `true` | Treat customer notes in the TMS as requests and replies |
| `NOTES_POLL_SECONDS` | `5` | How often the notes watcher checks |
| `ORDER_REVIEW_MODE` | `auto` | `qubi`: Flow 1 reviews new orders. `plugin`: the plugin does. `auto`: the plugin only when no Qubi webhook is set |
| `PLUGIN_DB_PATH` | `plugin/plugin.db` | The plugin's own database (cases, detected problems) |
| `CORS_ORIGINS` | `http://localhost:5173` | Web pages allowed to call the plugin |

## Endpoints

Writing needs `X-API-Key` (🔑).

| Method and path | Use |
|---|---|
| `POST /api/customer-requests` | A customer asks for something. Give `shipment_id`, `order_id` or any `ref`, and the `message`; `category` is worked out from the message if left out |
| `GET /api/cases?status=new` | Cases: `new`, `open`, `resolved`, any status or several; filter by `shipment_id`, `order_id`, `channel` |
| `GET /api/cases/{id}` | One case with its conversation |
| `POST /api/cases` 🔑 | Open a case from another channel, e.g. an email workflow |
| `POST /api/cases/{id}/claim` 🔑 | Take a new case (409 if already taken) |
| `POST /api/cases/{id}/messages` 🔑 | Write to the customer (becomes a customer-visible note in the TMS); can set `status` and send a `form` |
| `PATCH /api/cases/{id}` 🔑 | Change a case's status. `needs_human` also leaves an internal "Needs a person" note for staff |
| `GET /api/cases/webhook-status` | Whether the Qubi webhook is set up, and recent attempts |
| `GET /api/agent-tools/shipments/{id}/check?sender=` | What should the agent do about this shipment |
| `POST /api/agent-tools/shipments/{id}/apply-fixes` 🔑 | Fill in what other TMS records already know |
| `GET /api/agent-tools/orders/{id}/check` | Data problems in one order |
| `GET /api/agent-tools/orders/data-quality` | Sweep every order |
| `POST /api/agent-tools/orders/apply-safe-fixes?dry_run=true` 🔑 | Apply every safe fix (`dry_run=false` to really apply) |
| `POST /api/agent-tools/orders/{id}/review` 🔑 | Review a new order: use the customer's answers, apply safe fixes, then ask, hand over or confirm |
| `POST /api/orders/{id}/approve-fix` 🔑 | A person approves a suggested fix (e.g. from an ActionHub task) |
| `POST /events/tms` | Where the TMS sends its events |
| `GET /api/detector/status`, `GET /api/detector/problems` | Detector and notes watcher: last runs, problems already reported |
| `POST /api/detector/run` 🔑 | Run the detector now |
| `POST /api/admin/reset` 🔑 | Reset the TMS demo data and clear the plugin's cases |
| `GET /health` | Is the plugin up, and can it reach the TMS |
| anything else under `/api` | Passed straight to the TMS (`/api/shipments`, `/api/orders`, `/api/notes`, `/api/lookup`, ...) |

Writes passed through to the TMS are credited to `SMART API Agent` in the
TMS's notes unless the caller sends its own `author`.

### Webhook body (unchanged)

```json
{"event": "case.created", "case_id": "CASE-1002", "case": { ...the full case, with messages... }}
```

`event` is `case.created` or `case.customer_replied`. Detector cases have
`"channel": "monitor"` and a first message from "Qubiway monitoring"
describing the problem.
