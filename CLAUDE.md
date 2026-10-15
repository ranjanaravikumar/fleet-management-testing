# SMART Agent demo: plain TMS + plugin + Qubi

## What this is
A plain TMS (backend/tms, :8000, screens at /tms) and a separate plugin
(plugin/, :8100) that finds shipment/order problems and starts Qubi flows.
Qubi only talks to the plugin. The TMS has no agent screens; the agent's
work shows as notes.

## Before any task
Read `docs/STATUS.md` (where we are, what's next). Read other docs only
when the task needs them: `docs/handover.md`, `plugin/README.md`,
`backend/tms/README.md`.

## Rules
- Never push to `upstream` (Thayaa21). Push to `origin` only.
- Keep the TMS plain: no cases/agent tabs in the TMS UI.
- No triage agent. Flow: detect → fix if safe → else email carrier → resolve.
- Never read a PDF directly; use the pdf-to-markdown skill.
- After code changes, run `python -m plugin.smoke_test`.

## Run
TMS: `uvicorn backend.main:app --reload --port 8000`
Plugin: `uvicorn plugin.main:app --reload --port 8100`
Screens: `npm run dev` → http://localhost:5173/Load-Lorry/tms

## End of every session
Update `docs/STATUS.md`: what got done, decisions, next 3 steps. Keep it under 60 lines.