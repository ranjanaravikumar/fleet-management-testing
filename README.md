# Qubiway TMS + SMART API Agent

A plain freight TMS and a separate SMART API Agent plugin that finds shipment/order problems and starts Qubi flows. The TMS has no agent screens — the agent's work shows only as notes.

---

## Services

| Piece | Where | Port | Role |
|---|---|---|---|
| **TMS** | `backend/` | 8000 | Shipments, tracking, orders, customers, carriers, fleet. No cases, no agent tabs. |
| **Plugin** | `plugin/` | 8100 | Detector, customer requests, order review, toolkit. Talks to the TMS only through its normal API. |
| **Frontend** | `src/tms/` | 5173 | React + Vite UI at `/tms` |

---

## Quick Start

Three terminals, venv active, from the project root:

```bash
pip install -r backend/requirements.txt -r plugin/requirements.txt

# 1. TMS on :8000
TMS_EVENTS_URL=http://localhost:8100/events/tms uvicorn backend.main:app --reload --port 8000

# 2. Plugin on :8100 (add QUBI_WEBHOOK_URL / QUBI_TRIGGER_SECRET for Flow 1)
uvicorn plugin.main:app --reload --port 8100

# 3. Frontend at http://localhost:5173/Load-Lorry/tms
npm install && npm run dev

# End-to-end smoke test (resets demo data)
python -m plugin.smoke_test
```

On Windows Command Prompt: `set TMS_EVENTS_URL=...` before step 1.

Details: `backend/tms/README.md` (TMS API), `plugin/README.md` (plugin), `docs/qubi-build-guide.md` (Qubi flows).

---

## TMS Features

### Shipments & Orders
- Shipments grid: search, sort, filters, filter tabs with live counts, CSV export, bulk select
- Column chooser, saved views (sessionStorage), dense rows with sticky header and frozen first column
- Keyboard shortcuts: arrows to move, Enter to open, `/` to search, Esc to clear
- Shipment detail: Stops, Documents, Charges, Check Calls tabs; edit panel; printable BOL and rate confirmation
- Orders grid + order detail with auto-rating (CWT rate by lane + weight break)
- Staff order entry: customer, lane, commodity, weight/class/pallets, PO reference

### Operations
- **Today dashboard** — open shipments needing attention, overdue alerts, activity feed
- **Dispatch board** — assign trucks and drivers to shipments
- **Map** — active shipments on an OpenStreetMap map with live positions
- **Invoicing** — generate and track invoices from delivered shipments

### Data
- **Customers** — customer records, portal access
- **Carriers** — carrier profiles with contact and insurance info
- **Fleet** — trucks and drivers roster
- **Accessorial charge codes** — DET/LUM/TONU/REDEL/STOP/LAY/etc. with default rates

### Demo Data
- 6 customers, 5 carriers, 7 trucks, 6 drivers, 17 shipments
- API key: `dev-key-change-me` (set `TMS_API_KEY` to change)
- Admin login: `admin@qubiway.com` / `admin123`
- Customer portal: `user@company.com` / `user123`

---

## Plugin Features

### Detector
Runs every 60 seconds over active shipments. Opens a Qubi Flow 1 case once per new problem:
- Overdue milestone → `status_update` case
- Missing truck or driver → `truck_number` case

### Customer Requests
- `POST /api/customer-requests` — a customer emails or messages; the plugin routes it to Flow 1
- Customer notes in the TMS portal also trigger Flow 1
- Repeated questions on a resolved (delivered) shipment reuse the last agent answer instead of opening a new case

### Order Review
When a quote request is submitted through the portal, the plugin reviews it:
- Applies safe fixes automatically (normalises fields, infers missing values)
- Asks the customer for anything it can't resolve
- Uses a CWT rate table to suggest pricing

### Toolkit (endpoints Qubi calls)
| Endpoint | Purpose |
|---|---|
| `GET /api/agent-tools/shipments/{id}/check` | Rules-based recommendation: `ask_carrier`, `fix_internally`, `answer_from_tms`, `needs_human` |
| `POST /api/agent-tools/shipments/{id}/check` | Same, with full check data |
| `GET /api/agent-tools/orders/{id}/check` | Data-quality check for a quoted order |
| `GET /api/agent-tools/orders/data-quality` | Bulk data-quality sweep |
| `POST /api/agent-tools/orders/{id}/review` | Apply safe fixes and ask the customer |
| `GET /api/orders/{id}/rating` | Auto-rating breakdown |

---

## Project Structure

```
├── backend/
│   ├── main.py               # FastAPI app — TMS API, event webhook to plugin
│   └── tms/
│       ├── db.py             # SQLite schema + seed data
│       ├── routes.py         # All TMS API routes
│       ├── seed.py           # Demo data (customers, carriers, fleet, shipments, orders)
│       └── README.md         # Full TMS API reference
├── plugin/
│   ├── main.py               # Plugin FastAPI app
│   ├── detector.py           # Shipment detector + notes watcher background threads
│   ├── cases.py              # Case lifecycle: create, claim, messages, customer routing
│   ├── toolkit.py            # Shipment check, order review, auto-rating
│   ├── checks.py             # Rules engine: recommendation logic
│   ├── tms_client.py         # HTTP client for the TMS API
│   ├── store.py              # Plugin SQLite store (cases, detected problems, kv)
│   ├── qubi.py               # Qubi webhook notify
│   ├── config.py             # Environment variable config
│   ├── smoke_test.py         # End-to-end test (33 checks)
│   └── README.md             # Plugin API reference
├── src/
│   ├── components/
│   │   ├── TpLogo.jsx        # Brand logo SVG
│   │   ├── LoginChooser.jsx  # Role selector (Admin / Customer)
│   │   ├── AdminLogin.jsx    # Admin credential form
│   │   └── UserLogin.jsx     # Customer login / signup
│   └── tms/
│       ├── TmsApp.jsx        # TMS app shell + routing
│       ├── grid.jsx          # Shared DataGrid (Shipments, Orders)
│       ├── ops/
│       │   ├── Home.jsx      # Today dashboard
│       │   ├── ShipmentsView.jsx
│       │   ├── ShipmentDetail.jsx
│       │   ├── OrdersView.jsx
│       │   ├── OrderDetail.jsx
│       │   ├── DispatchBoard.jsx
│       │   ├── MapView.jsx   # OpenStreetMap via react-leaflet
│       │   ├── Customers.jsx
│       │   ├── Carriers.jsx
│       │   └── Fleet.jsx
│       └── tms.css
├── docs/
│   ├── STATUS.md             # Current status, decisions, next steps
│   ├── architecture.md       # Technical reference
│   ├── handover.md           # Handover notes
│   └── qubi-build-guide.md  # Qubi Flow 1 and Flow 2 build guide
├── public/
│   ├── favicon.svg
│   └── favicon.ico
├── index.html
├── vite.config.js
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 |
| Routing | React Router 7 |
| Maps | Leaflet + react-leaflet (OpenStreetMap, no API key) |
| Icons | lucide-react |
| Backend | FastAPI + uvicorn |
| Data validation | Pydantic v2 |
| Database | SQLite 3 (`tms.db` for TMS, `plugin.db` for plugin) |
| Plugin smoke test | Python stdlib (urllib) |

---

## TMS API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/shipments` | List shipments (filters: status, customer, search) |
| GET/PATCH | `/api/shipments/{id}` | Get or update a shipment |
| GET | `/api/orders` | List orders |
| GET/PATCH | `/api/orders/{id}` | Get or update an order |
| POST | `/api/orders` | Create a new order (staff entry) |
| GET/POST | `/api/shipments/{id}/check-calls` | Check call log |
| GET | `/api/portal/shipments` | Customer portal: their shipments |
| POST | `/api/portal/notes` | Customer posts a note (triggers Flow 1) |
| POST | `/api/admin/reset` | Reset all demo data |
| GET | `/api/meta/charge-codes` | Accessorial charge codes with default rates |

Full reference: `backend/tms/README.md`.

---

## License

Internal demo project — for demonstration purposes only.
