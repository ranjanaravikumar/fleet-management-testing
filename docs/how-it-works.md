# How it works: the stack, the detector, the notes watcher and the rules

This describes the code as it is now. (`docs/architecture.md` is an older write-up; this file is the current one.)

## 1. The pieces and how they connect

| Piece | Tech | Port | Job |
|---|---|---|---|
| Screens | React 19, Vite, React Router, lucide-react icons, Leaflet map | 5173 | Portal and ops console. Pages poll the API every 3 to 10 seconds |
| TMS | FastAPI, Pydantic, SQLite (`backend/tms.db`) | 8000 | The existing system: shipments, milestones, orders, customers, carriers, drivers, trucks, notes |
| Plugin | FastAPI, httpx, background threads, SQLite (`plugin/plugin.db`) | 8100 | The agent's body: detector, notes watcher, rules, case queue, retry sweep, toolkit |
| Tunnel | ngrok | | Makes the plugin reachable from Qubi's cloud |
| Qubi | AgentHub workflows, AI agents, IntegrationHub, credential vault | cloud | The agent's brain: Flow 1, and Flow 2 once email is wired |

```
Browser ──poll──► TMS :8000 ◄──── normal API (X-API-Key) ──── Plugin :8100 ◄──ngrok──► Qubi
   screens          │  tms.db                                    │  plugin.db           workflows + AI agents
                    │                                            │
                    └── event "order.submitted" ───────────────► │   (TMS tells the plugin about a new quote request)
                                                                 └── webhook "case.created" ──► Qubi Flow 1
                                                                       (only when AI is needed)
Qubi ── HTTPS + X-API-Key (from the credential vault) ──► Plugin ── forwards to ──► TMS
```

Four rules of the design:
1. **The TMS knows nothing about the agent.** No cases, no agent screens. The agent's footprint is **notes**.
2. **The plugin talks to the TMS only through its normal API**, like any other client.
3. **Qubi talks only to the plugin.** Anything the plugin doesn't answer itself it forwards to the TMS, so Qubi needs one base URL.
4. **AI understands, code decides.** The AI reads or writes language; fixed rules choose every action.

Who calls whom, and how it is secured:

| From → to | How | Protection |
|---|---|---|
| Screens → TMS | HTTPS/HTTP, polling | Reads open; writes need `X-API-Key` (ops sign-in uses the key) |
| TMS → plugin | POST `/events/tms`, event `order.submitted` | Optional `X-Event-Secret` |
| Plugin → TMS | HTTP (`httpx`) | `X-API-Key` |
| Plugin → Qubi | POST to the trigger's callback URL: `{event, case_id, case}` | `X-Trigger-Secret` |
| Qubi → plugin | HTTP nodes via ngrok | `X-API-Key` from the `TMS_API` credential |

## 2. Notes: the shared language

Every shipment and order has notes. A note has an author type (`customer`, `staff`, `integration`, `carrier`),
a visibility (`internal` = staff only, `customer` = also in the portal) and an action tag (`note` = a person wrote it,
`problem_detected`, `classified`, `handoff`, `message`, …). The portal shows only customer-visible notes. Everything the
agent does appears here, which is how anyone can audit it. It is also how a customer talks to the agent.

## 3. The detector

A loop in the plugin, every **60 seconds** (`DETECTOR_INTERVAL_SECONDS`):

1. Ask the TMS for all **active** shipments (not delivered).
2. For each, fetch the full record and run the **shipment check** (section 5).
3. Turn what the check found into **problems**, each with a stable key:
   - a milestone is overdue → `SHP-1042:overdue:DELV` (topic: status question)
   - truck or driver missing → `SHP-2048:missing:truck_id` (topic: truck question)
4. Skip any key already seen (stored in `plugin.db`). **A problem is reported once.**
5. For each new topic on a shipment, open a **case** (channel `monitor`), write an internal note
   "Detected by monitoring… Opened CASE-1002", and hand it to **dispatch** (section 7).

`POST /api/detector/run` does the same pass on demand. Only new problems start anything, so it is cheap.

## 4. The notes watcher

A loop in the plugin, every **5 seconds**. It remembers the id of the last note it processed (`notes_cursor`), asks the
TMS for newer notes written by a customer, and for each one:

1. Ignore it unless a person wrote it (`action = note`) on a shipment or order, and it isn't already part of a case.
2. Find the open cases on that record. If one is **waiting for the customer**, or has the **same topic**, the note is a
   **reply** to it.
3. Otherwise, if the shipment can be answered from TMS data and an earlier resolved case already answered the **same
   kind of question** (a status or truck/driver question), repeat that answer without opening anything. This is why
   asking twice doesn't spend a second run. A change request or a price question never takes this shortcut: it
   always gets its own case, so it reaches the classifier and the guardrails.
4. Otherwise open a new case (channel `portal`) and hand it to dispatch.

A provisional topic comes from simple **keyword matching** (change, truck/driver, price, where/status, else other).
It is used to avoid duplicates. The AI classifier in Flow 1 gives the real reading. If the TMS is reset on its own (note
ids start over), the watcher notices and clears the plugin's cases.

## 5. The rules

**Shipment check** (`plugin/checks.py`): the same answer every time for the same data.
- Milestone timing, from the appointments. Arrival at pickup is due 30 minutes after the pickup window opens; pickup
  2 hours after arrival; arrival at the consignee 30 minutes after the delivery window opens; delivery 2 hours after
  arrival. A milestone counts as overdue only if it isn't recorded and nothing later has been.
- Missing truck or driver. If the load and its driver are on record, the check proposes the fix (`fix_internally`).
  Otherwise only the carrier can say (`ask_carrier`).
- Guardrails: account on hold, unusable customer email, unknown sender. Any of these means `needs_human`.
- A delivered shipment is simply answered from the data.
- The answer is one of: `answer_from_tms`, `fix_internally`, `ask_carrier`, `needs_human` (most cautious first).

**Policy on top, in `decide`** (called by Flow 1 with the classifier's topic and confidence):
- A **change request** or a **quote question** is always `needs_human`.
- A classifier that isn't sure (below 0.6) is `needs_human`.
- A detector case keeps its own topic; the classifier's answer is ignored.
- A **truck/driver question** is answered from the TMS when both are on record, even if a milestone is overdue.

**Order data rules:** country and postal code formats, state or province against the postal code, weight units and
range, pallet count, pallet size, freight class against density. Each finding is `auto` (fix it, the right value is
certain), `suggested` (a person approves), `ask_customer`, `needs_human` or `info`.

**Routing and notices:**
- Order cases are handled by the plugin itself and never go to Qubi.
- A shipment case goes to Qubi only if it is new, or the customer answered the agent. A note on a case the carrier or
  a person already has is held back so Flow 1 doesn't restart.
- When a case a customer started goes to a person or to the carrier, the customer gets one short notice.
- A case still `new` three minutes after being sent is sent again (up to 3 times), then handed to a person.

## 6. The cases

The plugin keeps its own **cases** (`plugin.db`): one per problem or request, with a conversation and a status
(`new`, `in_progress`, `awaiting_carrier`, `awaiting_customer`, `needs_human`, `resolved`). Messages for the customer are
written into the TMS as customer-visible notes, and the case keeps the same text. The TMS never sees a case.

## 7. Flow 1 in Qubi, step by step

```
webhook  {event, case_id, case}
  → SSA Request Classifier (AI)         topic + confidence, saved as `intent`
  → Decide  (POST plugin)               rules combine the topic with the shipment check, saved as `check`
  → Fetch shipment (GET plugin→TMS)     saved as `shipment`
  → Branch on check.recommendation
      fix_internally   → apply-fixes → note → case resolved
      ask_carrier      → Carrier Email Writer (AI) → Parser → note → case awaiting_carrier
      answer_from_tms  → Customer Reply Writer (AI) → post the reply, case resolved
      default          → note "No automatic action taken" → case needs_human
```

Every write goes through the plugin. The AI steps only produce text.

## 8. Three journeys

**An overdue delivery.** Detector (60 s) finds `DELV` overdue on SHP-1042 → opens a case, writes a note → dispatch sends a
webhook → Qubi classifies nothing (it is a detector case), `decide` says `ask_carrier`, the AI drafts the email →
notes and status updated. (Sending the email and reading the reply need the Gmail wiring.)

**A customer question.** Customer adds a note in the portal → TMS stores it → watcher (5 s) sees it → opens a case →
dispatch → webhook → classifier reads it, `decide` applies the rules → for `answer_from_tms` the Reply Writer writes
the answer, which is posted as a customer-visible note → the portal (polling) shows it.

**A quote request.** Customer submits the form → TMS stores the order and sends `order.submitted` to the plugin →
the plugin opens an order case and reviews the order with the data rules → tidy-ups and a question appear as notes →
the customer answers in a note → the watcher sees it → the plugin reviews again. No Qubi run.

## 9. Where to look when something is off

| Question | Look at |
|---|---|
| Did the detector run, and what did it see? | `GET /api/detector/status` and `/api/detector/problems` on the plugin |
| Did the plugin reach Qubi? | `GET /api/cases/webhook-status` (`recent`, and `not_sent` for held-back follow-ups) |
| What is a case's state? | `GET /api/cases/{id}` on the plugin |
| What did the agent do? | The shipment's or order's Notes tab in the ops console |
| What did Qubi do? | Jobs, then Console → Execution Log |
