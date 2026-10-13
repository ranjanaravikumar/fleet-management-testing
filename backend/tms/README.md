# TMS API for the SMART API Agent

The data the SMART API Agent works with: shipments and their milestones,
customers, loads, drivers, and the orders from `orders.csv`. Qubi reads and
updates it over HTTP; the TMS web pages read the same data.

Data lives in `backend/tms.db` (SQLite, not committed to Git). It's created
with the demo data the first time the server starts.

## Run it

From the project root, venv active:

```
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000/docs to see and try every endpoint. For endpoints
that change data, click **Authorize** and enter the API key first.

Check the demo is ready (this resets the data):

```
python -m backend.tms.smoke_test
```

## Settings

Set these in the backend terminal **before** starting uvicorn
(Windows Command Prompt syntax):

```
set TMS_API_KEY=pick-a-long-random-key
set DEMO_CUSTOMER_EMAIL=your-demo-customer-inbox@gmail.com
set DEMO_CARRIER_EMAIL=your-demo-carrier-inbox@gmail.com
```

| Setting | Default | What it does |
|---|---|---|
| `TMS_API_KEY` | `dev-key-change-me` | Required in the `X-API-Key` header for anything that changes data |
| `DEMO_CUSTOMER_EMAIL` | placeholder | The demo customer's address. The agent only trusts emails from it |
| `DEMO_CARRIER_EMAIL` | placeholder | Where "contact the carrier" emails go: your carrier inbox |
| `QUBI_WEBHOOK_URL` | empty | A Qubi trigger's callback URL. When set, new cases and customer replies are sent to Qubi straight away |
| `QUBI_TRIGGER_SECRET` | empty | Sent as the `X-Trigger-Secret` header with each webhook |
| `TMS_RESET_ON_START` | `false` | `true` reloads demo data at every start (use on Render) |
| `CORS_ORIGINS` | `http://localhost:5173` | Web pages allowed to call the API, comma-separated |

The two email settings are written into the data at reset, so reset after
changing them: `POST /api/admin/reset`.

## Endpoints

Reading is open. Writing needs `X-API-Key`.

| Method and path | Use |
|---|---|
| `GET /api/lookup?ref=SHP-1042` | Find a shipment or order from any reference in an email (ID or BOL, any format) |
| `GET /api/shipments?customer_code=NFAS` | All shipments with milestones, optionally one customer's |
| `GET /api/shipments/{id}` | One shipment with customer, load, driver, milestones and notes |
| `PATCH /api/shipments/{id}` 🔑 | Change truck, driver, delivery appointment or agent status (needs a `reason`) |
| `POST /api/shipments/{id}/milestones` 🔑 | Record a milestone, e.g. `DELV` (needs a `reason`) |
| `GET /api/orders`, `GET /api/orders/{id}` | Orders from `orders.csv` |
| `PATCH /api/orders/{id}` 🔑 | Change order fields, e.g. `skid_dims` (needs a `reason`) |
| `GET /api/customers/{code}`, `/api/loads/{id}`, `/api/drivers/{id}` | Related records |
| `GET /api/notes`, `POST /api/notes` 🔑 | The activity log; every change is also logged automatically |
| `GET /api/stats` | Counts and open problems for the Agent Activity page |
| `GET /api/portal/shipments`, `GET /api/portal/orders` | What the customer portal shows, with alerts and open cases |
| `POST /api/portal/cases` | Customer opens a case from the portal (no key; a repeat click returns the open case) |
| `POST /api/portal/cases/{id}/messages` | Customer replies in a case, or fills in a form the agent sent |
| `GET /api/cases?status=new` | Cases: `new`, `open`, `resolved`, or any single status; filter by `shipment_id` or `order_id` |
| `GET /api/cases/{id}` | One case with its conversation |
| `POST /api/cases` 🔑 | Open a case from another channel, e.g. a future email workflow (`"channel": "email"`) |
| `POST /api/cases/{id}/claim` 🔑 | Take a new case so no one else works it |
| `POST /api/cases/{id}/messages` 🔑 | Agent or ops writes to the customer; can also set `status` and send a `form` |
| `PATCH /api/cases/{id}` 🔑 | Change a case's status; also shows on the shipment or order |
| `GET /api/cases/webhook-status` | Whether the Qubi webhook is set up, and recent attempts |
| `GET /api/auth/check` 🔑 | Checks an API key (used by the operations sign-in) |
| `POST /api/admin/reset` 🔑 | Back to the demo starting state |
| `GET /api/agent-tools/shipments/{id}/check?sender=` | **What should the agent do?** For a shipment |
| `GET /api/agent-tools/orders/{id}/check` | Data problems in one order |
| `GET /api/agent-tools/orders/data-quality` | Sweep all 106 orders |
| `POST /api/agent-tools/orders/apply-safe-fixes?dry_run=true` 🔑 | Apply every safe automatic fix (`dry_run=false` to really apply) |

The shipment check returns a `recommendation`, which is what the Qubi flow
branches on:

| recommendation | Meaning |
|---|---|
| `answer_from_tms` | All good; reply from the TMS data |
| `fix_internally` | Another TMS record has the answer; apply `internal_fixes`, then reply |
| `ask_carrier` | Milestones overdue or data missing; email the carrier |
| `needs_human` | A guardrail tripped (account on hold, bad contact, unknown sender); hand to a person |

## The five demo acts

Times are relative to the last reset, so reset before each demo run. Each act
starts with the customer opening a case in the portal.

| Act | Record | Customer does | Check says | Agent does |
|---|---|---|---|---|
| 1. Missing milestone | `SHP-1042` Chicago → Dallas | Sees "Delivery not confirmed yet", clicks **Get an update** | `ask_carrier`: arrival and delivery overdue | Emails the carrier; on the reply, records arrival and delivery and resolves the case |
| 2. Fixes it itself | `SHP-2048` Phoenix → Denver | **Need the truck number** | `fix_internally`: TRUCK-015 and Marcus Johnson, via load 308 | Fills in the shipment and answers |
| 3. Guardrail | `SHP-2048` | **Change a delivery detail** | Always a person's call | Hands to ActionHub; ABC Trucking's on-hold `SHP-2051` is another example |
| 4. Missing data | Order `SHP45342` | **Question about my quote** | `ask_customer`: no pallet details, so no quote | Asks with a form, records the answer, sends pricing to a person |
| 5. Data sweep | All 106 orders | Nothing | 311 findings: 221 safe to fix, 15 need the customer, 12 need a person, 63 for information | Applies the safe fixes and reports the rest |

## The TMS screens

Open http://localhost:5173/Load-Lorry/tms and choose:

- **Customer portal:** Northfield Auto Supply's shipments and orders, alerts
  like "Delivery not confirmed yet", and **Get help**, which opens a case. The
  agent's replies appear in the case conversation on the same page.
- **Operations console** (sign in with the API key): shipments with what the
  agent found, the Cases queue (reply as a person, change status), order data
  quality, and the agent's activity log.

Every screen refreshes itself every few seconds. To point them at another
backend (Render later), create `.env.local` in the project root and restart
`npm run dev`:

```
VITE_TMS_API_URL=https://your-backend-address
```

The older pages (landing page, Fleet Command Center, the previous portal and
Agent Activity page) are unchanged and still work.

The guide for building the agent in Qubi is in `docs/qubi-build-guide.md`.

## Tips for Qubi

- Send `X-API-Key` on every write, and `ngrok-skip-browser-warning: 1` on every call through ngrok.
- Milestone times must be ISO with a time zone, e.g. `2026-10-14T14:05:00-07:00` (Phoenix time). Ask the AI step to output that exact format.
- Errors are informative: `409` means the milestone is already recorded, `422` means the input is wrong, and the `detail` says why.
- Put the shipment ID in every email subject, like `[SHP-1042]`, so replies can be matched.
- Watch the calls in ngrok's inspector at http://127.0.0.1:4040.

## Updating the mock data

The backend loads `backend/tms/fixtures/mock_data.json`, which is copied from
`src/data/mockData.js`. After changing that file, run:

```
node scripts/export-mock-data.mjs
```
