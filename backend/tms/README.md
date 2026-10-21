# Qubiway TMS

A plain transportation management system: shipments, tracking, orders,
quote requests, and a Notes tab on every record. It knows nothing about
the SMART API Agent. The agent's plugin (`plugin/`) is a separate service
that uses this API like any other client.

Data lives in `backend/tms.db` (SQLite, not committed to Git). It's created
with the demo data the first time the server starts.

## Run it

From the project root, venv active:

```
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000/docs to see and try every endpoint. For endpoints
that change data, click **Authorize** and enter the API key first.

## Settings

Set these before starting uvicorn (Windows Command Prompt: `set NAME=value`;
macOS/Linux: `export NAME=value`):

| Setting | Default | What it does |
|---|---|---|
| `TMS_API_KEY` | `dev-key-change-me` | Required in the `X-API-Key` header for anything that changes data |
| `TMS_EVENTS_URL` | empty | Where to send events, e.g. `http://localhost:8100/events/tms` (the plugin). Empty: no events are sent |
| `TMS_EVENTS_SECRET` | empty | Sent as the `X-Event-Secret` header with each event |
| `DEMO_CUSTOMER_EMAIL` | placeholder | The demo customer's email address |
| `DEMO_CARRIER_EMAIL` | placeholder | The carriers' email address on the demo shipments |
| `TMS_RESET_ON_START` | `false` | `true` reloads demo data at every start (use on Render) |
| `CORS_ORIGINS` | `http://localhost:5173` | Web pages allowed to call the API, comma-separated |

The two email settings are written into the data at reset, so reset after
changing them: `POST /api/admin/reset`.

## Endpoints

Reading is open. Writing needs `X-API-Key` (🔑).

| Method and path | Use |
|---|---|
| `GET /api/lookup?ref=BOL-88421` | Find a shipment or order from any reference (ID or BOL, any format) |
| `GET /api/shipments?status=active` | Shipments with milestones and `tracking_alert`; filter by `customer_code`, `status` (`active`, `delivered` or an exact status) |
| `GET /api/shipments/{id}` | One shipment with customer, load, driver, milestones and notes |
| `PATCH /api/shipments/{id}` 🔑 | Change truck, driver or delivery appointment (needs a `reason`; logged as a note) |
| `POST /api/shipments/{id}/milestones` 🔑 | Record a tracking milestone, e.g. `DELV` (also updates the status) |
| `GET /api/orders` | Orders, newest first; `limit`, `offset`, `customer_code`, `source` (`csv` or `portal`) |
| `GET /api/orders/{id}` | One order with its notes |
| `PATCH /api/orders/{id}` 🔑 | Change order fields (needs a `reason`; logged as a note) |
| `GET /api/customers/{code}`, `/api/loads/{id}`, `/api/drivers/{id}` | Related records |
| `GET /api/notes` | Notes, filter by `entity_type`, `entity_id`, `author_type`, `visibility`, `action`, `after_id`; `order=asc` for oldest first |
| `POST /api/notes` 🔑 | Add a note; `visibility: "customer"` also shows it to the customer |
| `GET /api/portal/shipments`, `/api/portal/shipments/{id}` | The customer's shipments; one shipment with its customer-visible notes |
| `GET /api/portal/orders`, `/api/portal/orders/{id}` | The customer's orders; one order with its customer-visible notes |
| `POST /api/portal/orders` | **Request a quote**: saves the order exactly as typed and sends an `order.submitted` event |
| `POST /api/portal/notes` | The customer adds a note to one of their shipments or orders |
| `GET /api/events/status` | Whether events are set up, and recent deliveries |
| `GET /api/meta/milestone-codes` | Milestone codes and labels |
| `GET /api/auth/check` 🔑 | Checks an API key (used by the operations sign-in) |
| `POST /api/admin/reset` 🔑 | Back to the demo starting state |

### Notes

Every shipment and order has notes. Each note has:

| Field | Values |
|---|---|
| `author_type` | `customer`, `staff`, `carrier`, `integration`, `system` |
| `visibility` | `internal` (staff only) or `customer` (also shown in the portal) |
| `action` | A short tag: `note` (written by a person), `update` and `milestone` (logged automatically), `order_submitted`, or anything a client sends |

Every change made through the API is logged as an internal note, with the
`reason` and `author` the caller gave.

### Events

When `TMS_EVENTS_URL` is set, the TMS POSTs events to it:

```json
{"event": "order.submitted", "sent_at": "2026-10-14T14:05:00-07:00",
 "data": {"order_id": "SHP71754", "customer_code": "NFAS", "order": { ...the order... }}}
```

with `X-Event-Secret: <TMS_EVENTS_SECRET>`. A subscriber that is down never
blocks the customer; failures show in `GET /api/events/status`.

### Tracking alerts

`tracking_alert` is the standard TMS exception flag: `Delivery overdue` when
the delivery window has ended with no delivery recorded, `Pickup overdue`
when the pickup window has ended with no pickup.

## The screens

Open http://localhost:5173/Load-Lorry/tms and choose:

- **Customer portal:** Shipments (tracking, details, notes), Orders and
  quotes, and Request a quote.
- **Operations console** (sign in with the API key): Shipments with
  exceptions, record a tracking update, Orders, and the Notes tab on each
  record (internal or customer-visible).

The menu on the left collapses to icons with the button at its top (the choice is remembered). Screens refresh themselves every few seconds. To point them at another
backend, create `.env.local` in the project root and restart `npm run dev`:

```
VITE_TMS_API_URL=https://your-tms-address
```

## Updating the mock data

The backend loads `backend/tms/fixtures/mock_data.json`, which is copied from
`src/data/mockData.js`. After changing that file, run:

```
node scripts/export-mock-data.mjs
```
