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

Times are relative to the last reset, so reset before each demo run.

| Act | Record | Check says | What the agent does |
|---|---|---|---|
| 1. Missing milestone | `SHP-1042` Chicago → Dallas | `ask_carrier`: arrival and delivery overdue | Emails the carrier; on reply, posts `ARRCONSIGNEE` and `DELV`; status becomes Delivered; confirms to customer |
| 2. Fixes it itself | `SHP-2048` Phoenix → Denver | `fix_internally`: TRUCK-015 and Marcus Johnson, via load 308 | PATCHes the shipment, replies with the truck number |
| 3. Guardrail | `SHP-2051`, customer ABC Trucking | `needs_human`: on hold, unusable email, unknown sender | Doesn't act; creates an ActionHub task |
| 4. Missing data | Order `SHP45342` | `ask_customer`: no pallet dimensions, so no quote | Fixes formats, asks the customer for dimensions, records the reply, sends the quote to a person |
| 5. Data sweep | All 106 orders | 242 findings: 221 auto, 18 for a person, 3 for the customer | Applies the safe fixes, reports the rest |

## Live screens

Two pages read this API every few seconds, so the agent's changes appear
without refreshing:

- **Customer portal, My Shipments tab:** Northfield Auto Supply's shipments,
  with the timeline, an agent status line ("We are checking with the carrier"),
  and a one-time glow on any card that changes.
- **Admin, Agent Activity:** the live feed of notes, shipments needing action,
  and order data-quality counts.

They call `http://localhost:8000` by default. To point them somewhere else
(Render later), create `.env.local` in the project root and restart `npm run dev`:

```
VITE_TMS_API_URL=https://your-backend-address
```

If the API can't be reached, the portal falls back to the old sample data and
says so, and the Agent Activity page explains how to start the backend.

The full guide for building the agent in Qubi is in `docs/qubi-build-guide.md`.

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
