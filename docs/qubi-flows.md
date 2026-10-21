# Qubi flows: Flow 1 and Flow 2

Both flows call the plugin (ngrok address, port 8100). Headers on every HTTP node:
`ngrok-skip-browser-warning: 1`, `X-API-Key` = `{{ credential.TMS_API.apiKey }}`, `Content-Type: application/json`.
Template paths use `{{session.x.y}}`; a Branch variable uses `session.x.y` with no braces.

The idea: **AI understands, code decides.** The AI steps only read language (what the customer wants, what the
carrier said) or write it (the email, the reply). Every decision and every write goes through the plugin's rules.

## Flow 1: SSA - Resolve shipment issue

Trigger: the plugin's webhook, `{"event", "case_id", "case": {...}}`. Shipment cases only; the plugin works order
cases itself. Import `docs/ssa-case-handler.workflow.json` (it comes in as a separate flow named "SSA - Case Handler"), or build it:

```
Webhook
  → SSA Request Classifier (agent, saves `intent`)
  → Decide what to do      POST /api/agent-tools/cases/{{session.case_id}}/decide        saves `check`
  → Fetch shipment details GET  /api/shipments/{{session.case.shipment_id}}              saves `shipment`
  → Branch on session.check.recommendation
      fix_internally  → POST /api/agent-tools/shipments/{{session.case.shipment_id}}/apply-fixes  {"source_ref": "{{session.case_id}}"}  saves `fixes`
                        → note "Resolved automatically…" → PATCH /api/cases/{{session.case_id}} {"status":"resolved"} → End
      ask_carrier     → SSA Carrier Email Writer (saves `email`) → [send email, when Gmail is connected]
                        → note → PATCH case {"status":"awaiting_carrier"} → End
      answer_from_tms → SSA Customer Reply Writer (saves `reply`)
                        → POST /api/cases/{{session.case_id}}/messages {"author_type":"agent","body":"{{session.reply.message}}","status":"resolved"} → End
      default         → note "No automatic action taken: {{session.check.summary}}" → PATCH case {"status":"needs_human"} → End
```

The decide call body: `{"category": "{{session.intent.category}}", "confidence": "{{session.intent.confidence}}"}`.

### Agents (AgentHub)

**SSA Request Classifier.** Output schema: `category` (one of status_update, truck_number, change_request,
quote_question, other) and `confidence` (number), both required. Instructions are in the v2 export's classifier node.
It only picks a topic. For a detector case (`channel` = monitor) it returns the existing topic.

**SSA Customer Reply Writer.** Output schema: `message` (text), required. Answers only from the shipment and case data,
under 80 words, no double quotes or line breaks in the message.

**SSA Carrier Email Writer.** Output schema: `subject`, `body`. The subject starts with `[SHP-xxxx]`.

### Guardrails (code, not AI)

| Situation | Result |
|---|---|
| Topic is `change_request` | `needs_human`, always |
| Topic is `quote_question` on a shipment | `needs_human` |
| Classifier confidence below `CLASSIFIER_MIN_CONFIDENCE` (0.6) | `needs_human` |
| Account on hold, unusable email, unknown sender | `needs_human` (from the shipment check) |
| Topic is `truck_number` and the truck and driver are on record | `answer_from_tms`, even if a milestone is overdue |
| A `change_request` goes to a person | The handoff note tells operations what was asked, the shipment, and the carrier's contact. Nothing is changed or sent; if the change is agreed, the carrier is the next call |
| Detector case | keeps its own topic; the classifier's answer is ignored |
| Classifier gives nothing usable | the plugin's keyword reading is used |

### What the customer sees
Only customer-visible notes show in the portal. The reply writer's answer, an applied-fix message, and the carrier's
confirmation are visible. When a case a customer started moves to `needs_human` or `awaiting_carrier`, the plugin
adds a notice by itself ("Our operations team is looking at this…" / "We're checking with the carrier…"), once. Flow 1
doesn't need a node for it. Notes the flow writes (resolved, drafted email, no automatic action) are internal.

## Flow 2: SSA - Carrier reply

Trigger: Gmail (IntegrationHub), a new email whose subject contains `[SHP-`.

```
Gmail trigger
  → SSA Carrier Reply Reader (agent, saves `reply`)
  → POST /api/agent-tools/shipments/{{session.reply.shipment_id}}/carrier-reply
      {"case_id": "{{session.reply.case_id}}", "arrived_at": "{{session.reply.arrived_at}}",
       "delivered_at": "{{session.reply.delivered_at}}", "signed_by": "{{session.reply.signed_by}}",
       "summary": "{{session.reply.summary}}", "source_ref": "<the email subject>"}
  → End
```

**SSA Carrier Reply Reader** output: `shipment_id`, `case_id` (from the subject, e.g. CASE-1002, or null), `arrived_at`,
`delivered_at` (ISO 8601 with -07:00, or null), `signed_by`, `summary`. Never guess a time that isn't in the email.
Empty or `null` values are fine; the plugin treats them as "not given". The call records the milestones, tells the
customer, resolves the case, and is safe to repeat.

The send node in Flow 1 puts the case ID in the subject: `{{session.email.subject}} [{{session.case_id}}]`.

## Not built yet
- ActionHub task for `needs_human` (tenant not set up). Today a person sees the note on the shipment.
