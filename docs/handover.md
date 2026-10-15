# SMART Agent: handover for the plain TMS and Qubi build

Oct 15, 2026 · @Ranjana Tarini Ravikumar

## Purpose and status

The SMART Agent demo shows a Qubi AI agent that finds shipment and order problems in a TMS and resolves them on its own, as a plugin that can attach to any TMS. The plain TMS and the plugin are built; the Qubi flows are drafted but not yet wired up.

**Decisions already made**

- **No triage agent** (supervisor). One simple path: find the issue automatically, fix it if it can be fixed, otherwise email the carrier, read the reply, update the TMS, mark it resolved.
- **The TMS must look like a real TMS.** No agent tabs (no Cases, Agent activity or approve buttons). Operations sees the agent's work as ordinary notes on shipments and orders.
- **Issues start two ways:** the plugin's detector checks active shipments every minute, and some issues start from a customer request (a note in the portal, or a submitted order).
- **AI is used only where it beats rules:** writing the carrier email and reading the carrier's reply. Checks and fixes are rule-based and predictable.
- **Backups are kept untouched:** the earlier TMS with custom tabs and the earlier 18-node Qubi workflow.
- Customers raise issues through the portal for now; customer email comes later.

**Where things stand**

| Piece | State |
| --- | --- |
| Plain TMS + plugin | Built, on branch `claude/practical-lamport-kklv0e` |
| Qubi Flow 1 (resolve issue) | Drafted by Autopilot; needs an agent, Gmail and an input fix |
| Qubi Flow 2 (carrier reply) | Drafted by Autopilot; needs an agent, Gmail trigger and a wiring fix |
| Qubi webhook trigger | URL found; not yet tested |
| Qubi schedule and queue triggers | Never fire on this tenant; raised with the Qubi team |
| Old 18-node flow + custom-tab TMS | Working backups |

## Repos, branches and backups

Work happens on your fork; the teammate's original repo is never pushed to. Use `claude/practical-lamport-kklv0e` as the working branch for the plain TMS ([README](https://github.com/ranjanaravikumar/fleet-management-testing/blob/claude/practical-lamport-kklv0e/README.md)).

| Name | What it is | Use |
| --- | --- | --- |
| [Thayaa21/fleet-management-testing](https://github.com/Thayaa21/fleet-management-testing) | Teammate's original repo (React + Vite + FastAPI fleet app) | `upstream` remote, pull only; push is disabled |
| [ranjanaravikumar/fleet-management-testing](https://github.com/ranjanaravikumar/fleet-management-testing) | Your fork | `origin` remote; all pushes go here |
| Branch `smart-agent-demo` + tag `backup-custom-tabs` | TMS with Cases, Agent activity, Orders approvals, portal Get help | Backup; works with the old 18-node Qubi flow |
| Branch `claude/practical-lamport-kklv0e` | Plain TMS + separate plugin service + updated Qubi guide | **Working branch** |
| Branch `plugin-architecture` | Started in chat for the same split | Superseded by the branch above; don't continue it |

**What the working branch contains** (from its README and `plugin/README.md`):

- `backend/tms`: the plain TMS API; screens at `/tms`.
- `plugin/`: its own service on port 8100, with `plugin/requirements.txt`, `plugin/smoke_test.py` and `plugin/README.md`.
- `docs/qubi-build-guide.md`: the case-based Qubi guide, updated so the flows point at the plugin.

**Switching branches:** stop the backend, `git checkout <branch>`, delete `backend\tms.db` (and `plugin\plugin.db`), start again. Demo data is recreated on start.

**Local folder:** `C:\Users\ranja\fleet-management-testing`, venv in `.venv`, Node 24, Python 3.10. Keys and webhook URLs live in `.env` files, which Git ignores.

## Architecture

Qubi talks only to the plugin, and the TMS knows nothing about the agent.

&#91;embedded content: architecture · TMS, plugin, Qubi, people, carrier\]

The plugin reads and writes the TMS through its normal API, starts Flow 1 by webhook, and gives Qubi one base URL. Attaching another TMS means rewriting only the plugin's adapter: an API connector, EDI, or Qubi RPA for systems with only a screen.

## The plain TMS

A FastAPI + SQLite TMS (`backend/tms`, port 8000) with a light, enterprise-style React UI at `/tms` (IBM Plex Sans, `src/tms`). It has shipments, tracking, orders, quotes and a Notes tab on every record, and nothing agent-specific.

**Demo data** is reloaded on every reset. Times are relative to the reset, so problems are always "happening now":

| Record | Situation | Expected outcome |
| --- | --- | --- |
| `SHP-1042` Chicago → Dallas, carrier Prairie Line Freight | Delivery appointment passed; no arrival or delivery recorded | Email the carrier, then record milestones from the reply |
| `SHP-2048` Phoenix → Denver | No truck or driver on the shipment; load 308 → driver Marcus Johnson → TRUCK-015 | Fixed automatically from TMS records |
| `SHP-2051` Toronto → Buffalo, customer ABC Trucking | Account on hold, unusable email on file | Left for a person (guardrail) |
| `SHP-2049` Tucson → El Paso | On track | Nothing to do |
| Order `SHP45342` | No pallet size, so no quote | Ask the customer |
| 106 orders from `orders.csv` | 221 safe format fixes, 15 need the customer, 12 need a person, 63 informational | Data sweep |

The demo customer is Northfield Auto Supply (`NFAS`, contact Maria Lopez). Operations signs in with the API key as the access key.

**Main API** (writes need `X-API-Key`):

| Endpoint | Use |
| --- | --- |
| `GET /api/shipments`, `GET /api/shipments/{id}` | Shipments with milestones, customer, load, driver and notes |
| `PATCH /api/shipments/{id}` | Change truck, driver or appointment; needs a `reason`, logged as a note |
| `POST /api/shipments/{id}/milestones` | Record ARRSHIP, PICK, INTRANSIT, ARRCONSIGNEE, DELV or POD |
| `GET /api/orders`, `GET /api/orders/{id}`, `PATCH /api/orders/{id}` | Orders and their notes |
| `GET /api/notes`, `POST /api/notes` | The activity log on any record |
| `GET /api/lookup?ref=` | Find a record from any ID or BOL, in any format |
| `/api/portal/...` | What the customer portal reads and submits (shipments, orders, Request a quote) |
| `POST /api/admin/reset` | Back to the demo starting state |

**Built-in validation:** milestone times can't be in the future or out of order (422), a repeated milestone is refused (409), and every change carries a reason.

**Screens:** the portal has Shipments, Orders and quotes, and Request a quote. The operations console has Shipments and Orders, each with Tracking or Details plus a Notes tab.

## The plugin service

The plugin (`plugin/`, port 8100) is the only thing Qubi talks to. It reads and writes the TMS only through the TMS's normal API, so attaching another TMS means rewriting the adapter, not the flows.

| Piece | What it does |
| --- | --- |
| **Detector** | Every minute, runs the shipment check on each active shipment. Each new problem opens a case and starts Flow 1, once per problem (keys like `SHP-1042:overdue:DELV`) |
| **Notes watcher** | A customer's note on a shipment or order in the portal becomes a request, or an answer to the agent's question |
| **Order events** | The TMS sends `order.submitted` to `/events/tms`; the plugin opens a "New order review" case. With no Qubi webhook set, the plugin runs the review itself |
| **Customer requests** | `POST /api/customer-requests` opens a case for a shipment or order, e.g. from a future email workflow |
| **Toolkit** | `/api/agent-tools/...`: shipment check, apply fixes, order check, data sweep, order review (validation, safe fixes, density-based freight class) |
| **Pass-through** | Any other `/api/...` path goes straight to the TMS, so the flows use one base URL |

What the customer should see becomes a **customer-visible note** in the TMS; internal steps become internal notes credited to "SMART API Agent".

**Key settings** (full list in `plugin/README.md`):

| Setting | Default | Purpose |
| --- | --- | --- |
| `TMS_URL`, `TMS_API_KEY` | `http://localhost:8000`, `dev-key-change-me` | Where the TMS is, and the key the plugin writes with |
| `PLUGIN_API_KEY` | same as `TMS_API_KEY` | The key Qubi sends in `X-API-Key` |
| `QUBI_WEBHOOK_URL`, `QUBI_TRIGGER_SECRET` | empty | Flow 1's trigger; the secret goes in `X-Trigger-Secret` |
| `DETECTOR_ENABLED`, `DETECTOR_INTERVAL_SECONDS` | `true`, `60` | Detector on or off, and how often |
| `ORDER_REVIEW_MODE` | `auto` | Who reviews new orders: `qubi`, `plugin`, or `auto` |

**What it sends to Qubi:** `{"event": "case.created", "case_id": "CASE-1002", "case": {...}}`, or `case.customer_replied`. Detector cases have `"channel": "monitor"`. The shipment ID is at `case.shipment_id`, **not** at the top level; see the Qubi workflows section.

**Useful endpoints:** `GET /health`, `GET /api/detector/status`, `GET /api/detector/problems`, `POST /api/detector/run` (scan now), `GET /api/cases/webhook-status`, `POST /api/admin/reset` (resets the TMS and clears plugin cases). All of them are listed at `http://localhost:8100/docs`.

## Qubi: what we learned

Qubi (agenthub.myqubi.com) is Qbotica's automation platform. The tenant is shared ("Default"), with 10,000 executions and 50,000 AI credits a month, so never leave secrets typed into nodes, and switch schedules off when not testing.

**Where things are**

| Area | Contains |
| --- | --- |
| AgentHub → Orchestrate | Agentic Flows (the designer), Autopilot (builds a flow from a prompt), Job Queues, Job Triggers, Jobs (run history) |
| AgentHub → Agents | Agent definitions. An Agent node in a flow must point to one of these |
| AgentHub → Connect | Tools, MCP Servers, Agent Skills, Models, Credential Vault (holds `TMS_API`, `ClaudeKey`, `OpenAI_QB`) |
| Integration Hub | Connectors (Gmail has 16 actions), Connector Builder, Connections, Triggers (webhook or polling), History |
| Designer nodes | Flow: Start, End, Merge, Sub-workflow, Wait. Agents: Agent, Supervisor. Logic: Branch, Decision, Loop, Assign, Code, JSON Parser. Integrations: HTTP, Integration. RPA: Browser, RPA, Queue item. People: HITL Task, Voice Agent Call |

**Quirks and fixes**

| Symptom | Cause and fix |
| --- | --- |
| "HTTP node has no HTTP method" | The method shown is a placeholder. Pick it in the dropdown, even if it already says GET |
| "Only http/https URLs are allowed (got scheme 'ttps')" | A URL lost its first letter while editing. Retype `https://` |
| Branch: "names no variable, so it can never match" | Branch takes the variable name without braces: `session.check.recommendation`. HTTP URLs and bodies use `{{session.x}}` |
| Credential in a header | Pick it with the magnifier; it reads `{{ credential.TMS_API.apiKey }}` |
| Publish fails: "edge #5 sets sourceHandle='output', but 'http' has one unnamed output" | Designer bug on lines from HTTP nodes. Export the flow, delete those `"sourceHandle": "output"` entries, import it back. Only needed to publish |
| Schedule and queue triggers enabled, but Jobs shows only "Person" runs; queue items stay Pending | Qubi's unattended runs aren't working on this tenant. Raised with the Qubi team; use the webhook or press play |
| HITL Task: no templates, no assignable users | ActionHub isn't set up for this account. Ask the Qubi team |
| Agent node: "No agent selected" | Create the agent under Agents first, then select it in the node |
| Merge set to "all" after exclusive branches | Waits forever, because only one branch runs. Connect the branches straight to the next node instead; a node can take several incoming lines |
| "This workflow is disabled" | Play still runs it for real. Enable the flow in the Agentic Flows list before triggers can start it |
| Finding an error | Console → Execution Log: search for `Failed` and read its `Message`. Variables appear under Console → Debug |

**Publishing** is needed only for triggers, queues and the API; play always runs the draft. Each publish is a numbered version you can roll back to.

## Qubi workflows to build

Two small flows replace the 18-node one: Flow 1 resolves an issue or emails the carrier; Flow 2 finishes the job when the carrier replies. Autopilot drafted both; they need the fixes below before testing. Base URL for every HTTP node: the plugin's ngrok address (port 8100). Headers: `ngrok-skip-browser-warning: 1`, `X-API-Key` from the `TMS_API` credential, `Content-Type: application/json`.

**Flow 1, "SSA - Resolve shipment issue"** (started by the plugin's webhook)

1. **Check shipment issue:** `GET /api/agent-tools/shipments/{id}/check` → `check` (`recommendation`, `summary`).
2. **Fetch shipment details:** `GET /api/shipments/{id}` → `shipment` (carrier name and email, route, BOL).
3. **Branch** on `session.check.recommendation`:
   1. `fix_internally`: `POST .../apply-fixes`, then a "Resolved automatically" note.
   2. `ask_carrier`: Agent "Write carrier email" → Gmail send to `{{session.shipment.carrier_email}}` → a "Waiting on carrier" note.
   3. Anything else: a "No automatic action taken" note for operations.

**Flow 2, "SSA - Carrier reply"** (started by a Gmail trigger: subject contains `[SHP-`)

1. **Agent "Read carrier reply"** → `reply` (shipment ID, arrival, delivery, signer, summary).
2. If `arrived_at`: `POST /api/shipments/{id}/milestones` with `ARRCONSIGNEE`.
3. If `delivered_at`: the same with `DELV`, labelled "Delivered, signed by …".
4. A "Resolved: …" note.

**Fixes needed**

- [ ] **Flow 1 input.** The plugin sends `case_id` and `case`, not a top-level `shipment_id`. Add an Assign step after Start that sets `shipment_id` to `{{session.case.shipment_id}}`, or change the URLs to use that path. Keep `case_id` so the flow can update the case.
- [ ] **Close the case in the plugin.** At the end of each path, `PATCH /api/cases/{{session.case_id}}` with `{"status": "resolved"}` or `{"status": "awaiting_carrier"}`. Otherwise the plugin keeps it open.
- [ ] **Both Agent nodes:** create the two agents below under Agents (Claude model), then select them in the nodes.
- [ ] **Flow 2 wiring.** Autopilot skips the DELV step when an arrival is present, and its Merge is set to "all". Delete the Merge and wire one line: arrival check → (post ARRCONSIGNEE) → delivery check → (post DELV) → resolution note.
- [ ] **Every `X-API-Key`** must be the credential, not the text "TMS\_API".
- [ ] **Gmail:** connect the agent's mailbox under Integration Hub → Connections; select it in Flow 1's send step; create the Integration Hub trigger that starts Flow 2.
- [ ] If an Agent's output arrives as text, add a JSON Parser node after it.

**Agent "SSA Carrier Email Writer" (instructions):**

```
You write short, professional emails from Qubiway Operations to a freight carrier.
Using only the shipment and check data you are given, ask the carrier for exactly the missing
information (for example arrival time, delivery time, who signed, or the truck number).
Never invent facts, times or names. Keep it under 120 words.
Return only JSON, nothing else: {"subject": "...", "body": "..."}.
The subject must start with the shipment ID in square brackets, for example "[SHP-1042]".
```

**Agent "SSA Carrier Reply Reader" (instructions):**

```
You read a carrier's email reply about a shipment and extract facts.
Return only JSON, nothing else:
{"shipment_id": the ID in square brackets in the subject, e.g. "SHP-1042",
 "arrived_at": arrival time at the consignee as ISO 8601 with -07:00, or null,
 "delivered_at": delivery time as ISO 8601 with -07:00, or null,
 "signed_by": name of the person who signed, or null,
 "summary": one sentence describing what the carrier said}
Use today's date unless the email states another date. Never guess a time that is not in the email.
```

The working branch's `docs/qubi-build-guide.md` describes a larger case-based workflow (claim, branch on category, ActionHub). Treat it as reference only; the supervisor wants the two simple flows above.

## Running it locally

Four terminals, venv active, from `C:\Users\ranja\fleet-management-testing` on the working branch. Windows Command Prompt sets variables with `set NAME=value` (or put them in a `.env` and add `--env-file .env`).

1. **Install once:** `pip install -r backend/requirements.txt -r plugin/requirements.txt` and `npm install`.
2. **TMS (port 8000),** sending order events to the plugin:

   ```
   set TMS_API_KEY=<your own long key>
   set TMS_EVENTS_URL=http://localhost:8100/events/tms
   uvicorn backend.main:app --reload --port 8000
   ```
3. **Plugin (port 8100):**

   ```
   set TMS_API_KEY=<same key>
   set QUBI_WEBHOOK_URL=<Flow 1 trigger URL>
   set QUBI_TRIGGER_SECRET=<its secret, if any>
   uvicorn plugin.main:app --reload --port 8100
   ```
4. **Screens:** `npm run dev`, then http://localhost:5173/Load-Lorry/tms. Operations signs in with the API key.
5. **Tunnel for Qubi:** `ngrok http 8100`. Point the tunnel at the plugin, not the TMS. The free static domain is `https://purse-giving-railroad.ngrok-free.dev`.
6. **Check everything:** `python -m plugin.smoke_test`. It resets the demo data, and it needs `TMS_API_KEY` set in that terminal too.

**Test the Qubi webhook on its own** before wiring it to the plugin:

```
curl -X POST "<trigger URL>" -H "Content-Type: application/json" -H "X-Trigger-Secret: <secret>" -d "{\"case_id\": \"TEST-1\"}"
```

Then look for a new run in Orchestrate → Jobs that isn't started by "Person". A 401 or 403 means the secret is wrong; a 404 means the trigger isn't enabled or attached. The trigger URL found so far is `https://agenthub.myqubi.com/api/v1/triggers/7115c40e-…/webhook`; keep the full URL in `.env` only, because anyone with it can start runs.

**Watch it work:** the plugin's `GET /api/detector/status` and `/api/cases/webhook-status`, the ngrok inspector at http://127.0.0.1:4040, Qubi's Jobs page, and the Notes tab on each shipment.

## Demo script

The story is "the problem is fixed before anyone asks". Reset first (`POST /api/admin/reset` on the plugin), keep the operations console and Qubi's Jobs page side by side, and have the carrier's mailbox open.

1. **Architecture (1 minute).** A plain TMS, a plugin next to it, and Qubi doing the work. Another TMS needs only another adapter: an API connector, EDI, or Qubi RPA for screen-only systems.
2. **Fixed automatically.** Within a minute the detector finds SHP-2048 has no truck. Flow 1 runs, the truck and driver appear, and a "Resolved automatically" note lands on the shipment.
3. **Carrier loop.** The detector finds SHP-1042's delivery overdue. The AI writes the carrier an email and Gmail sends it, adding a "Waiting on carrier" note. Reply as the carrier, e.g. "Got there about 2, unloaded by 3:15, Ortiz signed." Flow 2 reads it, records arrival and delivery, and the status turns Delivered with a "Resolved" note.
4. **Guardrail.** SHP-2051's account is on hold, so the agent leaves it for a person and doesn't act.
5. **Customer-started.** In the portal, submit a messy order (Request a quote). The order is reviewed and corrected, and its notes say what's still needed.
6. **Results.** Qubi's Jobs and dashboard: runs, success rate, time to resolution.

**Order inputs to try** (Request a quote):

| Input | Outcome |
| --- | --- |
| Pickup `85034`, `arizona`, `United States`; delivery `h1a0a9`, state empty, `canada`; `1,200 lbs`, `2 pallets`, size and class empty | 7 fields fixed (US, CA, H1A 0A9, 1,200 lb, AZ, QC filled in from the postal code, 2); asks for the pallet size. Answer `48 by 40 by 50` → stored 48x40x50, freight class 92.5 suggested from density |
| Clean: `85034` AZ US → `75201` TX US, `1200`, `2`, `48x40x50`, class `92.5` | Confirmed, ready for pricing |
| As clean, but country `Untied States`, state `Texsa` | Suggests US and TX for a person to approve; changes nothing alone |
| As clean, but pickup state `FL` | Asks the customer: 85034 is in AZ, CO, ID, NM, NV, UT or WY, not FL |
| As clean, but `545 kg` and `48" x 40" x 50"` | Converted to 1,202 lb and 48 x 40 x 50 in |
| As clean, but class `50` | Flagged: density 10.8 lb/ft³ suggests class 92.5 |
| As clean, but `30` pallets and `25,000 lb` | Flagged for a person: too big for LTL |
| Pickup `M5V 2T6`, state and country empty | Fills in CA and ON from the postal code |

## Next steps

Work top to bottom; each step depends on the ones above it.

- [ ] Check out `claude/practical-lamport-kklv0e` locally, run the TMS, the plugin and the screens, and pass `python -m plugin.smoke_test`.
- [ ] Set your own `TMS_API_KEY` in both services and in Qubi's `TMS_API` credential.
- [ ] Run `ngrok http 8100`; set every HTTP node's base URL to the plugin's address.
- [ ] Test the webhook trigger with curl; then set `QUBI_WEBHOOK_URL` and `QUBI_TRIGGER_SECRET` on the plugin.
- [ ] Flow 1: map `shipment_id` from `case.shipment_id`, add the case-status update, create and select the Email Writer agent.
- [ ] Test Flow 1 with play on SHP-2048 (fix path), then SHP-1042 (carrier path).
- [ ] Create two Gmail accounts (agent and carrier); connect the agent's in Integration Hub.
- [ ] Flow 2: fix the wiring, create and select the Reply Reader agent, create its Gmail trigger, test with a real reply.
- [ ] Let the detector start Flow 1 by itself; confirm no duplicate runs and the notes read correctly.
- [ ] Rehearse the demo script end to end; record a backup video.

**Ask the Qubi team**

- Why schedule and queue triggers never start runs on this tenant (Jobs shows only manual runs; queue item `test-1` stayed Pending).
- ActionHub: templates and assignable users for HITL Tasks.
- How an external system adds queue items or starts a workflow through the API.
- The designer's `sourceHandle` bug on HTTP node lines.

**Later:** let Flow 1 run order reviews (`ORDER_REVIEW_MODE=qubi`), route person-needed cases to ActionHub, customer email intake, host the TMS and plugin on Render, and turn the TMS endpoints into a Connector Builder connector so the agent can use them as tools.
