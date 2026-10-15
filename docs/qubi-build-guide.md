# Building the SMART API Agent in Qubi

How the agent's workflows fit together, what each step does, and the exact
API calls and AI instructions to use. Qubi's node names may differ from the
words used here; match each step to the closest node in the editor.

## How the pieces connect

```
                 ┌── TMS (plain) ──┐        ┌── Plugin ───────────────────────┐
Customer note ──►│ Notes tab       │◄─poll──┤ Notes watcher ─┐                │
Request a quote ►│ Orders ─────────┼─event─►│ /events/tms ───┼─► case ─webhook┼─► Qubi workflow A (Flow 1)
                 │ Shipments ◄─────┼──poll──┤ Detector ──────┘                │        │
                 └─────────────────┘        │ /api/customer-requests ─► case  │        │
                         ▲                  │ /api/cases, /api/agent-tools ◄──┼────────┤
                         └── normal API ────┤ everything else → passed on     │        ├─email─► Carrier inbox
                                            └─────────────────────────────────┘        │
Carrier's reply email ──────────────────────────────► Qubi workflow B ─────────────────┘
ActionHub (a person) ◄── anything the agent must not decide alone
```

The TMS is a plain TMS: shipments, tracking, orders, quote requests and a
Notes tab on every record. It has no cases and no agent screens. The
**plugin** (`plugin/`, its own service) does the rest and talks to the TMS only
through its normal API. A **case** starts Flow 1 when:

- the **detector** finds a new problem on an active shipment (checked every minute, reported once per problem);
- a **customer asks**: a note on their shipment or order in the portal, or a call to `POST /api/customer-requests` (e.g. from an email workflow);
- the TMS reports a **submitted order** (Request a quote).

Qubi does the language work: deciding what to say, reading the carrier's
email. The plugin does the exact work: checks, fixes, and the case
conversation. What the agent tells the customer appears as a note on the
shipment or order in the TMS.

**Moving from the earlier TMS:** the flows are unchanged. Point `TMS_URL` in
Qubi at the plugin instead of the TMS, and move the webhook settings to the
plugin (below). Every path the flows call exists on the plugin, either
answered by it (`/api/cases`, `/api/agent-tools`) or passed to the TMS
(`/api/shipments`, `/api/orders`, `/api/notes`, `/api/lookup`).

## Before you build: confirm these in Qubi

| Question | Where to look | Why it matters |
|---|---|---|
| Can a trigger start a workflow from a webhook? | Integration Hub, Triggers (it can: "Webhook (provider pushes)" with a callback URL and secret) | Workflow A starts when the TMS reports a new case |
| Is there an HTTP / REST step, or can we build a TMS connector? | The **+** node list, Connector Builder | Every TMS call |
| Is there an AI step that can return JSON? | The **+** node list, Agents | Writing replies, reading the carrier's email |
| Can a step branch on a value? | The **+** node list; the "Branch: route on a value" demo | Choosing the path |
| Can it send and read Gmail? | Connectors, Gmail (16 actions) | Carrier emails and replies |
| Can it create an ActionHub task? | ActionHub; the "Invoice exception approval" demo | Handoffs to a person |

## Settings every workflow uses

| Name | Value |
|---|---|
| `TMS_URL` | The **plugin's** address: your ngrok address for port 8100 while testing, e.g. `https://purse-giving-railroad.ngrok-free.dev`; your Render address later |
| `TMS_API_KEY` | The same value as `TMS_API_KEY` in the backend's `.env` (the plugin accepts it by default) |

Headers on **every** HTTP call:

```
ngrok-skip-browser-warning: 1
X-API-Key: {TMS_API_KEY}          (needed for writes, harmless on reads)
Content-Type: application/json    (on POST and PATCH)
```

## Connecting the plugin to Qubi's trigger

1. In Qubi, create the trigger for workflow A and copy its **callback URL** and
   **secret** (shown under the workflow's Delivery section).
2. Set them for the **plugin** and restart it:
   ```
   QUBI_WEBHOOK_URL=<callback URL>
   QUBI_TRIGGER_SECRET=<secret>
   ```
3. Check it at `GET /api/cases/webhook-status` on the plugin; after a test
   case, `recent` should show `HTTP 200`.

The plugin sends this body, with the secret in the `X-Trigger-Secret` header:

```json
{"event": "case.created", "case_id": "CASE-1002", "case": { ...the full case, with messages... }}
```

`event` is `case.created` for a new case, or `case.customer_replied` when the
customer answers with a note. Workflow A branches on it first. A case the
detector opened has `"channel": "monitor"`; its first message, from
"Qubiway monitoring", says what was found (e.g. "Delivered overdue by
124 min"). The flow handles it like any other case.

**No webhook yet?** Use a polling trigger that calls `GET /api/cases?status=new`
every 15 to 30 seconds and runs workflow A for each case returned.

## Workflow A: a case arrives

**Step A1. Claim it.** `POST {TMS_URL}/api/cases/{case_id}/claim`.
A `409` means someone already took it: stop.

**Step A2. Check what to do.**
- Shipment case: `GET /api/agent-tools/shipments/{shipment_id}/check`
- Order case: `GET /api/agent-tools/orders/{order_id}/check`

**Step A3. Branch.** First on the case `category`:

| category | Go to |
|---|---|
| `change_request` | **needs_human**, always. Changing a commitment is a person's call |
| `truck_number`, `status_update`, `quote_question`, `other` | The check's `recommendation` |

Then on `recommendation`:

| recommendation | Steps |
|---|---|
| `answer_from_tms` | `GET /api/shipments/{id}`; AI writes the answer (prompt below); post it with `"status": "resolved"` |
| `fix_internally` | For each `internal_fixes` item: `PATCH /api/shipments/{id}` with `{"<field>": "<value>", "reason": "<evidence>", "source_ref": "{case_id}"}`. Then answer as above |
| `ask_carrier` | Email the carrier (template below). Post to the customer with `"status": "awaiting_carrier"` |
| `ask_customer` (orders) | Apply the `auto` issues with one `PATCH /api/orders/{id}`. Post a message with a `form` asking for the missing fields, with `"status": "awaiting_customer"` |
| `needs_human` | Create an ActionHub task with the case and the check's `summary` and `guardrails`. Post to the customer with `"status": "needs_human"` |

**Posting to the customer** (becomes a customer-visible note on the shipment
or order, shown in the portal straight away):

```
POST {TMS_URL}/api/cases/{case_id}/messages
{"author_type": "agent", "body": "<text>", "status": "<new status>"}
```

Asking for details, as in Act 4:

```json
{"author_type": "agent", "status": "awaiting_customer",
 "body": "To price this order we need your pallet details.",
 "form": {"fields": [{"name": "pallets", "label": "Number of pallets"},
                     {"name": "dims", "label": "Pallet size, L x W x H in inches"}]}}
```

**Reply writer (AI step):**

```
Write a short, friendly message from Qubiway Support to the customer.
Use only the facts given; never invent times, names or numbers.
Under 80 words. Plain text, no greeting line, no signature.

Customer asked: {category_label}, {first customer message}
Shipment data: {shipment JSON}
What we did: {what the workflow just did, in one sentence}
```

**Carrier email template** (keep the shipment ID and case ID in the subject):

```
Subject: [SHP-1042] [CASE-1002] Delivery status needed

Hello Prairie Line Freight,

Our records show shipment SHP-1042 (BOL-88421), Chicago, IL to Dallas, TX,
had a delivery appointment at {delivery window}, but we have no arrival or
delivery recorded. Please reply with the arrival time, the delivery time
and who signed for it.

Thank you,
Qubiway Operations
```

### When the customer replies (event `case.customer_replied`, Act 4)

1. Read the newest customer message in the case. Its `form_response` holds
   the fields, e.g. `{"pallets": "2", "dims": "48x40x50"}`. The customer
   answers with a note; the note the agent posted lists the questions as
   `Label: ` lines, and the plugin reads `Label: value` lines (or one answer
   per line) back into `form_response`. If it can't, `form_response` is
   empty and the answer is in the message `body`.
2. `PATCH /api/orders/{order_id}` with `{"skid_details": "2 pallets", "skid_dims": "48x40x50", "reason": "Customer sent pallet details", "source_ref": "{case_id}"}`.
3. ActionHub task: "Price order {order_id}". Prices go through a person.
4. Post: "Thanks, we've added your pallet details. Our pricing team will send
   your quote shortly." with `"status": "needs_human"`.

## Workflow B: the carrier replies by email

**Trigger:** new email in the agent's Gmail.

1. **Find the case.** Take the shipment and case IDs from the brackets in the
   subject, then `GET /api/cases/{case_id}`.
2. **Read the reply (AI step):**

   ```
   From this carrier reply, return only JSON:
   {
     "arrived_at": arrival time at the consignee, or null,
     "delivered_at": delivery time, or null,
     "signed_by": name of who signed, or null,
     "delay_reason": reason if they mention a delay, or null
   }
   Write times in ISO format with the -07:00 offset, using the date
   {today in YYYY-MM-DD} unless the email gives another date.
   Reply: {body}
   ```

3. If `arrived_at` is present, `POST /api/shipments/{id}/milestones`:

   ```json
   {"code": "ARRCONSIGNEE", "event_time": "{arrived_at}",
    "location": "{shipment destination}", "source": "carrier",
    "reason": "Carrier confirmed by email", "source_ref": "{subject}"}
   ```

4. If `delivered_at` is present, post `DELV` the same way, with
   `"label": "Delivered, signed by {signed_by}"`.
5. A `422` means a time doesn't fit the timeline. Send it to ActionHub rather
   than guessing.
6. Post to the customer, e.g. "Prairie Line Freight confirmed delivery in
   Dallas at 2:00 PM today, signed by J. Ortiz.", with `"status": "resolved"`.

## Workflow C: data sweep (Act 5)

**Trigger:** a schedule, or a manual run during the demo.

1. `GET /api/agent-tools/orders/data-quality`. Note `by_fix_class`.
2. `POST /api/agent-tools/orders/apply-safe-fixes?dry_run=false&source_ref=Scheduled data sweep`.
3. One ActionHub task listing everything in `needs_human` (freight classes,
   impossible weights).
4. For `ask_customer` items: add them to the same ActionHub task for now.
   Contacting customers proactively can come later.
5. `POST /api/notes` with `action` `data_sweep` and a one-line summary, e.g.
   "Fixed 221 fields on 86 orders; 12 sent to a person; 15 need the customer."

## Approval mode

Add one workflow setting, `APPROVAL_MODE`, true or false. When it's true, the
agent's message to the customer goes into an ActionHub approval task instead of
being posted, and is posted once a person approves. Turn it on for the first
demo run to show the safety option, then off to show full speed.

## Build order

1. Workflow A, started by hand with a case ID: claim, check, and post a reply.
   Watch the calls in ngrok's inspector (http://127.0.0.1:4040).
2. Add the `answer_from_tms` and `fix_internally` branches (Act 2).
3. Connect the webhook trigger, so a customer note, a new order or the detector starts the flow.
4. Add `ask_carrier` and workflow B (Act 1).
5. Add `needs_human` and ActionHub (Act 3).
6. Add the order paths and `customer_replied` (Act 4), then workflow C (Act 5).
7. Reset (`POST /api/admin/reset`) and run all five acts start to finish.

## Testing each act

Customer portal: sign in at `/tms` and choose **Continue as customer**. The
customer asks by adding a note in a record's **Notes** tab; the agent's
answer appears there as a note from Qubiway Support.

With the detector on (the default), Acts 1 and 2 start **by themselves**
within a minute of a reset: the detector sees SHP-1042's overdue delivery and
SHP-2048's missing truck and starts workflow A for each. To show them started
by the customer instead, run the plugin with `DETECTOR_ENABLED=false`.

| Act | Who starts it | Expect |
|---|---|---|
| 1 | Detector, or the customer's note on SHP-1042: "Where is my shipment?" | A note says the carrier is being checked with; the carrier gets an email. Reply as the carrier with times; the timeline fills in, the status becomes Delivered, the case is resolved |
| 2 | Detector, or a note on SHP-2048: "What's the truck number?" | Within seconds: TRUCK-015, Marcus Johnson in the Notes tab; Details fills in |
| 3 | A note on SHP-2048: "Please deliver to our Mesa warehouse instead" | "Our operations team is on it"; an ActionHub task appears; staff see a "Needs a person" note on the shipment in the ops console |
| 4 | A note on order SHP45342: "Question about my quote" | A note asks for pallet details. Answer with a note (`Number of pallets: 2`, `Pallet size, L x W x H in inches: 48x40x50`); an ActionHub pricing task appears |
| 4b | **Request a quote** with untidy details (`arizona`, `canada`, `1,200 lbs`) | The order is reviewed: a note lists the details tidied up and asks for anything missing |
| 5 | Run workflow C | `GET /api/agent-tools/orders/data-quality`: `auto` goes from 221 to 0 |

## Later: customer email

When you want customers to email in as well:

1. Connect the customer-facing Gmail in Qubi.
2. Add a workflow: on each new email, AI reads it (reference, category,
   message); then `POST /api/customer-requests` with `"ref"` (any shipment,
   BOL or order reference: the plugin looks it up), `"message"`,
   `"channel": "email"`, `"sender_email"` and `"external_ref"` (the email's
   message ID). `"category"` is optional; left out, the plugin works it out.
3. That creates a normal case, so workflow A runs exactly as above. For email
   cases, also send the agent's message back by email, as a reply in the
   same thread.
