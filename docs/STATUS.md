# Status: 2026-10-15

## Done
- Plain TMS + plugin on branch `claude/practical-lamport-kklv0e`
- Qubi Flow 1 and Flow 2 drafted by Autopilot
- Fuller TMS built as `tms-realistic.patch` (one commit on top of the branch above):
  Today dashboard, dispatch board, map, customers, carriers, drivers and trucks;
  shipment search/sort/filters/CSV; Stops, Documents, Charges tabs; edit panel;
  printable BOL and rate confirmation; invoicing; book a quoted order; PO/PRO refs;
  5 carriers, 7 trucks, 6 drivers, 6 customers, 17 shipments in the demo data
- Checked in the build sandbox: smoke test 28/28, lint clean, build OK,
  detector still finds only SHP-1042 and SHP-2048
- Favicon: flat truck mark in brand blue, `.ico` + apple-touch fallbacks
- Part A, desktop-TMS grid conventions (`src/tms/grid.jsx`, one `DataGrid`
  shared by Shipments and Orders): filter tabs with live counts, toolbar
  (search, saved views, column chooser, refresh, export), dense rows with
  sticky header and frozen first column, checkbox selection with a bulk
  export, status bar, and keyboard (arrows move, Enter opens, `/` search,
  Esc clears). Saved views live in sessionStorage; no backend change.
- Plugin bug fixes: delivered shipments return `answer_from_tms` (not `needs_human`);
  repeated customer questions reuse the last agent answer from any resolved case instead
  of opening a new case. New `POST /api/detector/run-notes` endpoint. Smoke test 33/33.
- Part B, four workflow features (one commit):
  1. Check calls — new `check_calls` table + GET/POST `/api/shipments/{id}/check-calls`;
     "Check calls" tab on the shipment page; latest call shown in Shipments grid.
  2. Accessorial charge codes — CHARGE_CODES list (DET/LUM/TONU/REDEL/STOP/LAY/etc.)
     with default rates that pre-fill the amount; GET `/api/meta/charge-codes`.
     Existing charge data is unaffected (type column still stores label text).
  3. Auto-rating — CWT rate table by lane + weight break; GET `/api/orders/{id}/rating`
     returns breakdown; shown on order page when weight is set, accept-or-override
     UI; override writes a note.
  4. Staff order entry — POST `/api/orders`; `/tms/ops/orders/new` screen with
     customer dropdown, lane, commodity, weight/class/pallets, PO reference.

## Decisions
- No triage agent (supervisor); AI only writes and reads carrier email
- Detector starts Flow 1 via webhook; Qubi's scheduler is not used
- TMS stays plain: no agent tabs; the agent's work shows only as notes
- Ops console opens on Today (`/tms/ops/home`)

## Rules for any TMS change (for Claude Code)
- Never rename or remove an existing API path or response field; the plugin
  reads them (e.g. `carrier_email`, `truck_id`, `driver_name`, `tracking_alert`)
- New active demo shipments need a truck, a driver and future appointments,
  or the detector opens extra cases and the smoke test fails
- Schema changes: update `_schema_is_current()` in `backend/main.py` so old
  `tms.db` files are rebuilt
- Before committing: `npx eslint src/tms`, `npx vite build`, and
  `python -m plugin.smoke_test` with the TMS and plugin running

## Next
1. Flow 1: map shipment_id from case.shipment_id; create Email Writer agent
2. Test webhook with curl; set QUBI_WEBHOOK_URL on the plugin
3. Gmail accounts + Flow 2 wiring fix

## Known gaps in the TMS
- Map tiles need internet; cities come from a fixed list in `MapView.jsx`
- SHP-2049 becomes overdue about 2.5 h after a reset (existing behavior);
  reset right before a demo
- Not yet visually checked: Map, Orders, Customers, Carriers, Fleet screens

## Blocked / waiting
- Qubi team: schedule/queue triggers don't fire; ActionHub not set up
