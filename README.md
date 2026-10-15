# Qubiway — Fleet Operations & Intelligence Platform

Qubiway is a full-stack fleet management SaaS platform built for modern logistics teams. It combines a marketing landing page, role-based login flows, a fully featured admin operations dashboard, a backhaul load marketplace, and a customer shipment portal — all in a premium amber-accented dark UI.

---

## TMS + SMART API Agent plugin

This branch splits the agent out of the TMS. The two run as separate services:

| Piece | Where | Role |
|---|---|---|
| **Plain TMS** | `backend/tms`, screens at `/tms` | Shipments, tracking, orders, Request a quote, and a Notes tab on each record. No cases, no agent activity, no approve buttons |
| **Plugin** | `plugin/` (its own service) | **Detector:** every minute checks active shipments and starts Flow 1 through the Qubi webhook, once per new problem. **Customer requests:** an endpoint (and customer notes) that start Flow 1. **Order events:** the TMS tells the plugin when an order is submitted and the order is reviewed. **Toolkit:** the checks and fixes. Talks to the TMS only through its normal API |
| **Qubi flows** | Qubi | Unchanged: only the base URL (`TMS_URL` in Qubi) points at the plugin |

Quick start (three terminals, venv active, from the project root):

```bash
pip install -r backend/requirements.txt -r plugin/requirements.txt

# 1. TMS on :8000, sending order events to the plugin
TMS_EVENTS_URL=http://localhost:8100/events/tms uvicorn backend.main:app --reload --port 8000

# 2. Plugin on :8100 (add QUBI_WEBHOOK_URL / QUBI_TRIGGER_SECRET for Flow 1)
uvicorn plugin.main:app --reload --port 8100

# 3. Screens: http://localhost:5173/Load-Lorry/tms
npm install && npm run dev

# Check it all end to end (resets the demo data)
python -m plugin.smoke_test
```

On Windows Command Prompt, set variables first with `set TMS_EVENTS_URL=...`.
Details: `backend/tms/README.md` (TMS API), `plugin/README.md` (plugin),
`docs/qubi-build-guide.md` (the Qubi flows).

---

## Features

### Landing Page
- Animated US freight network map (10 hub cities, 17 freight corridors, live truck simulation)
- Feature highlights, pricing tiers with monthly/annual toggle, and FAQ section
- Calls-to-action routing to admin (fleet manager) and driver/customer login flows

### Authentication
- **Login Chooser** — role selector screen (Admin / Driver & Shipper)
- **Admin Login** — fleet manager login (`admin@truckerpath.com` / `admin123`)
- **Customer Login & Signup** — separate portal entry (`user@company.com` / `user123`)
- Session persistence via `sessionStorage` — survives page refresh without re-login

### Admin Dashboard — Fleet Command Center

#### Smart Dispatch
- AI-scored load assignments based on HOS, proximity, and return-load probability
- Driver candidate comparison with safety scores and availability bars
- HOS relay detection with smart relay-point recommendations
- Bulk "Assign All Ready" action and status filter bar (Ready / Needs Input / Blocked / Assigned)
- **Load Creation Drawer** — multi-step form to create new loads from the Dispatch Board:
  - City autocomplete backed by 280+ US cities with lat/lng coordinates
  - Auto-calculated haversine distance (straight-line miles × 1.2 road factor)
  - Return-load probability scoring based on destination hub city
  - Estimated drive time, cargo type picker (8 types), priority, and deadline fields
  - Optional one-click driver pre-assignment from the roster

#### Driver Management
- Full roster with safety scores, HOS status, and fatigue health bars
- Per-driver profile page: KPIs, load history, compliance documents
- Status filters: All / On Duty / At Risk / Blocked
- Deep-link to 3D Digital Twin from any driver card

#### 3D Digital Twin
- Interactive Three.js truck model built from geometric primitives (no external 3D assets)
- Per-component fault highlighting — tires, brakes, engine — red pulse on fault, amber on warning
- Live telemetry panel: tire PSI (FL/FR/RL/RR), brake pad life, fuel level, engine status, HOS remaining
- Multi-light scene setup (ambient, directional, point, hemisphere) for fault-color accuracy
- Slow continuous rotation; export diagnostics as JSON

#### Live Alert Feed
- Critical fleet alerts with AI-recommended actions
- Severity filter tabs: All / Critical / Warning / Info
- OSM tactical map overlay via Leaflet showing relay intercept paths

#### Backhaul Load Marketplace
- Broadcast available backhaul capacity on active truck routes
- AI-ranked carrier bids evaluated through a 4-gate eligibility pipeline:
  - **G1** Commodity compatibility matrix (8 cargo types × compatibility rules)
  - **G2** GVWR headroom (primary + backhaul weight ≤ truck GVWR)
  - **G3** LIFO route sequencing (drop stop index ≤ next primary stop index)
  - **G4** Volumetric trailer capacity (combined load volume ≤ trailer cubic footage)
- Net value ranking: `bid_price − detour_cost`, tie-broken by lowest detour cost
- **Dual-compute architecture**: tries FastAPI backend with 2-second `AbortController` timeout; automatically falls back to `localMatchCompute()` — an identical browser-side JS algorithm — if backend is unreachable; shows "Demo mode" badge when running the fallback
- Award flow updates fleet state and pushes a ranked-bid notification

#### Billing Pipeline
- Document upload (BOL, POD, Fuel Receipt) with drag-and-drop
- Simulated AI OCR extraction with live terminal output animation (pre-scripted lines from `mockData.js`)
- Invoice approval workflow with margin tracking
- Full billing history ledger with invoiced load records

#### Cost Intelligence
- Date range selector: This Week / Last Week / This Month
- Per-driver cost breakdown: miles, fuel spend, deadhead ratio, margin
- Revenue vs. cost bar charts with net margin KPIs

### Customer Portal (User Dashboard)
- Shipment booking form: commodity type, weight, trailer type, pickup window, contact info
- 8 commodity types: General, Reefer, Hazmat, Pharma, Automotive, Agriculture, Industrial, Retail
- Booking confirmation with shipment reference ID (SHP-XXXX)
- Shipment status tracking timeline

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React + Vite | 19.2.4 / 8.0.4 |
| Routing | React Router | 7.14.2 |
| State management | React Context API (`useFleetState` / `FleetProvider`) | — |
| 3D rendering | Three.js + `@react-three/fiber` + `@react-three/drei` | 0.184.0 / 9.6.0 / 10.7.7 |
| Post-processing | `@react-three/postprocessing` (Bloom, N8AO) | 3.0.4 |
| Maps | Leaflet + `react-leaflet` (OpenStreetMap / CartoDB) | 1.9.4 / 5.0.0 |
| Icons | `lucide-react` | 1.8.0 |
| Fonts | Syne (display) + DM Sans (body) via Google Fonts | — |
| Styling | Custom CSS variables — amber premium dark theme | — |
| Backend | FastAPI + uvicorn | 0.115.6 / 0.34.0 |
| Data validation | Pydantic v2 | 2.10.4 |
| Database | SQLite 3 (`backend/marketplace.db`) | — |
| Testing | Vitest + `@testing-library/react` + `fast-check` | 4.1.10 |

---

## Project Structure

```
├── backend/
│   ├── __init__.py
│   ├── main.py               # FastAPI app — POST /marketplace/match, GET /health
│   ├── models.py             # Pydantic v2: BidRequest, MatchRequest, BidResult, MatchResponse
│   ├── matching.py           # 4-gate eligibility filter + net_value_rank algorithm
│   ├── database.py           # SQLite connection + create_tables() lifespan hook
│   ├── seed.py               # Seeds demo opportunity and bids into marketplace.db
│   ├── requirements.txt      # fastapi, uvicorn[standard], pydantic
│   └── marketplace.db        # Auto-created on first run (gitignored)
├── src/
│   ├── assets/
│   │   ├── logo.png
│   │   └── logistics_bg.png
│   ├── components/
│   │   ├── AdminLogin.jsx          # Admin credential form
│   │   ├── LoadCreationDrawer.jsx  # Multi-step new-load form with city autocomplete
│   │   ├── LoginChooser.jsx        # Role selector overlay
│   │   ├── NotificationPanel.jsx   # Slide-out notification feed
│   │   ├── Sidebar.jsx             # Admin nav sidebar
│   │   ├── TpLogo.jsx              # Brand logo SVG component
│   │   ├── TruckModel.jsx          # Three.js truck geometry with fault highlighting
│   │   └── UserLogin.jsx           # Customer login / signup form
│   ├── data/
│   │   └── mockData.js       # DRIVERS, INITIAL_LOADS, ALERTS, US_CITIES (280+ cities),
│   │                         # CARGO_TYPES, LOAD_QUEUE, TRUCK_GVWR, BACKHAUL_OPPORTUNITIES
│   ├── hooks/
│   │   └── useFleetState.jsx # Global fleet state: loads, alerts, notifications, userShipments
│   ├── pages/
│   │   ├── AlertsFeed.jsx          # Severity-filtered alert list + Leaflet map modal
│   │   ├── BillingPipeline.jsx     # OCR upload + stage state machine + invoice approval
│   │   ├── CostIntelligence.jsx    # P&L charts + per-driver cost breakdown
│   │   ├── DispatchBoard.jsx       # Load queue + AI-ranked driver assignment
│   │   ├── DriverProfile.jsx       # Per-driver KPI + compliance document page
│   │   ├── Drivers.jsx             # Driver roster with HOS + safety scores
│   │   ├── FleetTwin.jsx           # 3D Digital Twin canvas + telemetry panel
│   │   ├── Landing.jsx             # Marketing landing page
│   │   ├── LoadMarketplace.jsx     # Backhaul marketplace — FastAPI call or JS fallback
│   │   └── UserDashboard.jsx       # Customer booking + shipment tracking
│   ├── test/
│   │   └── setup.js          # Vitest + @testing-library/jest-dom global setup
│   ├── utils/
│   │   ├── marketplace.js    # Browser-side matching algorithm (mirrors backend/matching.py)
│   │   └── marketplace.test.js  # Vitest unit + property-based tests (fast-check)
│   ├── App.jsx               # View state machine + React Router admin layout
│   ├── index.css             # Design system tokens + global CSS
│   └── main.jsx              # Entry: BrowserRouter wrapping FleetProvider wrapping App
├── vite.config.js            # base: '/Load-Lorry/', Vitest (environment: jsdom)
└── package.json
```

---

## Routes

| Path | Page | Role |
|---|---|---|
| *(state: landing)* | Marketing Landing Page | Public |
| *(state: chooser)* | Login Role Chooser | Public |
| *(state: admin-login)* | Admin Login | Admin |
| *(state: user-login / user-signup)* | Customer Login / Signup | Customer |
| *(state: user-dash)* | Customer Dashboard | Customer |
| `/dispatch` | Smart Dispatch Board | Admin |
| `/drivers` | Driver Roster | Admin |
| `/drivers/:id` | Driver Profile | Admin |
| `/fleet-twin` | 3D Digital Twin | Admin |
| `/alerts` | Live Alert Feed | Admin |
| `/billing` | Billing Pipeline | Admin |
| `/cost` | Cost Intelligence | Admin |
| `/marketplace` | Backhaul Load Marketplace | Admin |

> The Landing → Login → Dashboard transition is managed via a React `useState` view state machine in `App.jsx`. Admin sub-pages use React Router for client-side routing within the dashboard panel. The current view is persisted to `sessionStorage` so a page refresh stays on the active page.

---

## Getting Started

### Frontend

```bash
npm install
npm run dev
```

Runs at `http://localhost:5173/Load-Lorry/`

### Backend

```bash
# Install dependencies
pip install -r backend/requirements.txt

# Seed the demo opportunity and bids into marketplace.db (run once)
python -m backend.seed

# Start the API server
uvicorn backend.main:app --reload --port 8000
```

The marketplace page calls `http://localhost:8000/marketplace/match` directly (CORS is enabled for `localhost:5173`). If the backend is not running, the page falls back automatically to the browser-side JavaScript implementation — same 4-gate algorithm, same ranking logic, with a `Demo mode` indicator shown in the UI.

### Other Commands

```bash
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
npm run lint     # ESLint check
npm test         # Run Vitest unit + property-based tests
```

---

## Backend API

### `POST /marketplace/match`

Accepts a `MatchRequest` payload, runs the 4-gate eligibility filter and net value ranking, returns a `MatchResponse`.

**Request body**

```json
{
  "truck_id": "TRUCK-012",
  "primary_load_weight": 56000,
  "truck_gvwr": 80000,
  "primary_cargo_type": "General",
  "truck_certified_commodities": ["General", "Reefer"],
  "next_stop_index": 2,
  "primary_load_volume_cuft": 2660,
  "truck_trailer_volume_cuft": 3800,
  "bids": [
    {
      "bid_id": "BID-001",
      "carrier_name": "Swift Freight",
      "cargo_type": "Retail",
      "cargo_weight_lbs": 18000,
      "bid_price": 850.0,
      "detour_cost": 120.0,
      "cargo_volume_cuft": 900.0,
      "drop_stop_index": 1
    }
  ]
}
```

**Response**

```json
{
  "eligible_bids": [
    {
      "bid_id": "BID-001",
      "carrier_name": "Swift Freight",
      "cargo_type": "Retail",
      "cargo_weight_lbs": 18000,
      "bid_price": 850.0,
      "detour_cost": 120.0,
      "drop_stop_index": 1,
      "eligibility_status": "eligible",
      "disqualify_reason": null,
      "net_value": 730.0,
      "rank": 1
    }
  ],
  "ineligible_bids": [],
  "recommended_bid_id": "BID-001"
}
```

### `GET /health`

Returns `{ "status": "ok", "service": "backhaul-marketplace" }`.

---

## Matching Algorithm

The 4-gate eligibility filter runs identically in both `backend/matching.py` (server-side) and `src/utils/marketplace.js` (browser fallback):

| Gate | Condition | Disqualify reason |
|---|---|---|
| G1 | Cargo type compatible with primary cargo per `COMMODITY_COMPATIBILITY` matrix | `commodity_mismatch` |
| G2 | `primary_load_weight + cargo_weight_lbs ≤ truck_gvwr` | `gvwr_exceeded` |
| G3 | `drop_stop_index ≤ next_stop_index` (LIFO sequencing) | `route_sequence_violation` |
| G4 | `primary_load_volume_cuft + cargo_volume_cuft ≤ truck_trailer_volume_cuft` | `volume_exceeded` |

Eligible bids are ranked by `net_value = bid_price − detour_cost` descending. Ties are broken by lowest `detour_cost`.

---

## Database Schema

SQLite database at `backend/marketplace.db` — created automatically on first startup via the FastAPI `lifespan` hook calling `create_tables()`.

| Table | Purpose |
|---|---|
| `opportunities` | Backhaul broadcast events — truck ID, capacity, primary load details |
| `bids` | Carrier bids with eligibility status, net value, and rank |
| `awards` | Winning bid records with reason and timestamp |

---

## Design System

Custom CSS variable system defined in `src/index.css`:

| Token | Value | Usage |
|---|---|---|
| `--amber` | `#F59E0B` | Primary accent, buttons, active nav, fault-free highlights |
| `--bg` | `#05080F` | Page background |
| `--card` | `#0F1525` | Card / panel surfaces |
| `--surface2` | `#141C2E` | Nested surfaces, input backgrounds |
| `--green` | `#10B981` | Success, available status |
| `--red` | `#EF4444` | Alerts, critical status, fault pulse |
| `--font-display` | Syne | Headings, stat values, logo wordmark |
| `--font-body` | DM Sans | Body text, labels, nav items |

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Fleet Admin | `admin@truckerpath.com` | `admin123` |
| Customer | `user@company.com` | `user123` |

---

## License

Internal project — for demonstration purposes only.
