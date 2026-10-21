# Status: 2026-10-20

## Done
- Plain TMS (`backend/tms`) + plugin (`plugin/`) as two services; the agent's work shows only as notes
- Fuller TMS: Today dashboard, dispatch board, map, customers, carriers, fleet; shipment grid
  (filters, saved views, export, keyboard); Stops/Documents/Charges/Check calls tabs; edit panel;
  printable BOL and rate confirmation; invoicing; book a quoted order; PO/PRO refs; staff order
  entry; accessorial charge codes; auto-rating; demo data of 17 shipments, 5 carriers, 6 customers;
  ops menu collapses to icons (button at its top, remembered in localStorage)
- Plugin: detector (every 60 s, once per problem), notes watcher (5 s), customer requests, order
  events, toolkit, a repeated status/truck question reuses the last answer (never a change or price
  question), delivered shipments answer from the TMS
- Qubi Flow 1 live and tested end to end through the webhook (credential `TMS_API`, ngrok to :8100):
  SHP-2048 fixes itself, SHP-1042 goes to the carrier path, on-hold SHP-2051 goes to a person
- Gap work (this session), all in the plugin so the Qubi flows stay small:
  - `POST /api/agent-tools/cases/{id}/decide`: the classifier's topic + confidence, then code
    guardrails (change request, quote question, unsure classifier -> `needs_human`)
  - `plugin/dispatch.py`: order cases never go to Flow 1; the plugin reviews an order again when
    the customer answers (`ORDER_REVIEW_MODE` now defaults to `plugin`)
  - `apply-fixes` tells a customer who asked (not a detector case) what was filled in
  - `POST /api/agent-tools/shipments/{id}/carrier-reply`: Flow 2 in one call
  - A customer who asked is told when their case goes to a person or the carrier (once; not for
    detector or order cases)
  - Truck/driver questions are answered from the TMS when both are on record (even if overdue);
    a change request's handoff note briefs operations (ask, shipment, carrier contact)
  - A note on a case the carrier or a person already has no longer restarts Flow 1 (`not_sent`
    in `/api/cases/webhook-status`); a case stuck as `new` is re-sent up to 3 times, then handed to a person
  - An agent reply or classifier answer that arrives as JSON text is unwrapped by the plugin
  - `python -m plugin.classifier_check`: 28 sample requests run through the real flow to check what the
    classifier reads (`docs/classifier-test-set.md`); not yet run against the real agent
  - Smoke test 67/67 with a Qubi webhook, 64/64 without
- Docs: `docs/how-it-works.md`, `docs/qubi-flows.md`, `docs/demo-runbook.md`, `plugin/README.md`

## Decisions
- AI understands, code decides: a classifier at the entry of Flow 1 picks a topic only; the plugin's
  guardrails choose the action. No supervisor agent that decides actions (changed from earlier)
- AI also writes the carrier email and the customer reply, and reads the carrier's reply
- Detector starts Flow 1 via webhook; Qubi's scheduler is not used
- TMS stays plain: no agent tabs. Ops console opens on Today (`/tms/ops/home`)

## Rules for any TMS change (for Claude Code)
- Never rename or remove an existing API path or response field; the plugin reads them
  (e.g. `carrier_email`, `truck_id`, `driver_name`, `tracking_alert`)
- New active demo shipments need a truck, a driver and future appointments,
  or the detector opens extra cases and the smoke test fails
- Schema changes: update `_schema_is_current()` in `backend/main.py` so old `tms.db` files rebuild
- Before committing: `npx eslint src/tms`, `npx vite build`, `python -m plugin.smoke_test`

## Next
1. In Qubi: create the Classifier and Customer Reply Writer agents, import
   `docs/ssa-case-handler.workflow.json`, select the agents in their nodes, publish
2. Email: hand `docs/gmail-wiring-brief.md` to a Qubi builder (Gmail send needs a raw message; may need a
   plugin helper or SMTP); import Flow 2 (`docs/ssa-carrier-reply.workflow.json`); set `DEMO_CARRIER_EMAIL`
3. ActionHub task for `needs_human` once the tenant has it; rotate the webhook secret

## Known gaps
- Map tiles need internet; cities come from a fixed list in `MapView.jsx`
- SHP-2049 turns overdue about 2.5 h after a reset: reset right before a demo
- The real Qubi classifier hasn't been run against the guardrails yet (smoke test uses a fake)
- Qubi: schedule/queue triggers don't fire; ActionHub not set up
