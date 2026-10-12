# Building the SMART API Agent in Qubi

How the agent's workflows fit together, what each step does, and the exact
API calls and AI instructions to use. Qubi's node names may differ from the
words used here; match each step to the closest node in the editor.

## How the pieces connect

```
Customer inbox ──email──► Qubi workflow A ──HTTP──► TMS API (your backend)
                               │                         ▲
                               ├──email──► Carrier inbox │
                               │                         │
Carrier / customer reply ──► Qubi workflow B ──HTTP──────┘
                               │
                               └──task──► ActionHub (a person)

Schedule ──► Qubi workflow C (data sweep) ──HTTP──► TMS API
```

Qubi does the language work: reading emails, deciding what they're about,
writing replies. The TMS API does the exact work: finding records, checking
milestones and data, saving changes. Keep it that way. If you find yourself
asking the AI "is this overdue?", call the check endpoint instead.

## Before you build: confirm these in Qubi

| Question | Where to look | Why it matters |
|---|---|---|
| Can a workflow start when an email arrives? | Job Triggers, Connect | Workflows A and B start this way. If not, poll the inbox on a schedule |
| Is there an HTTP / REST step? | The **+** node list, IntegrationHub | Every TMS call |
| Is there an AI step that can return JSON? | The **+** node list, Agents | Reading emails |
| Can a step branch on a value? | The **+** node list; see the "Branch: route on a value" demo | Choosing the path |
| Can it send email? | Connect, IntegrationHub | Replies and carrier requests |
| Can it create an ActionHub task? | ActionHub, the "Invoice exception approval" demo | Handoffs to a person |
| Where do secrets go? | Connect, Admin | The API key |

## Settings every workflow uses

| Name | Value |
|---|---|
| `TMS_URL` | Your ngrok address while testing, e.g. `https://purse-giving-railroad.ngrok-free.dev`; your Render address later |
| `TMS_API_KEY` | The same value as `TMS_API_KEY` in the backend terminal |

Send these headers on **every** HTTP call:

```
ngrok-skip-browser-warning: 1
X-API-Key: {TMS_API_KEY}          (only needed for writes, harmless on reads)
Content-Type: application/json    (on POST and PATCH)
```

## Workflow A: a customer email arrives

**Trigger:** new email in the agent's inbox whose subject doesn't start with `Re:`.

**Step A1. Read the email (AI step).** Instructions:

```
You read customer emails for a freight company. From the email below,
return only this JSON, nothing else:

{
  "reference": the shipment, BOL or order number mentioned, exactly as
               written (e.g. "SHP-1042", "BOL-88421", "SHP45342"), or null,
  "intent": one of "status", "truck_number", "quote", "change_request", "other",
  "summary": one short sentence describing what the customer wants
}

"change_request" means they ask us to change something: an address,
a date, an appointment, a price.

Email from: {sender}
Subject: {subject}
Body: {body}
```

**Step A2. Find the record.** `GET {TMS_URL}/api/lookup?ref={reference}`
- 404, or no reference → reply asking for the shipment or order number. Stop.
- Answer `type` is `shipment` or `order` → continue with its `id`.

**Step A3. Log the email.** `POST {TMS_URL}/api/notes`

```json
{"entity_type": "shipment", "entity_id": "{id}", "action": "email_received",
 "message": "{summary}", "source_ref": "{subject}"}
```

**Step A4. Check what to do.**
- Shipment: `GET {TMS_URL}/api/agent-tools/shipments/{id}/check?sender={sender}`
- Order: `GET {TMS_URL}/api/agent-tools/orders/{id}/check`

**Step A5. Branch on `recommendation`.** Branch on `intent` first: a
`change_request` always goes to the **needs_human** branch, because changing
commitments is a person's call.

| recommendation | Steps |
|---|---|
| `answer_from_tms` | `GET /api/shipments/{id}`, then AI writes the reply from that data (prompt below), then send it, then log `replied_customer` |
| `fix_internally` | For each item in `internal_fixes`: `PATCH /api/shipments/{id}` with `{"<field>": "<value>", "reason": "<evidence>", "source_ref": "<subject>"}`. Then answer as above |
| `ask_carrier` | Email the carrier (template below), then `PATCH /api/shipments/{id}` with `{"agent_status": "awaiting_carrier", "reason": "Asked the carrier to confirm <what>", "source_ref": "<subject>"}`, then send the customer a short "we're checking" reply |
| `ask_customer` (orders) | Apply the `auto` issues with one `PATCH /api/orders/{id}`, then email the customer asking for the missing items, then `PATCH` with `{"agent_status": "awaiting_customer", ...}` |
| `needs_human` | Create an ActionHub task with the email, the check `summary` and the `guardrails`; `PATCH` with `{"agent_status": "needs_human", ...}`; log `handoff`. Do **not** reply to the customer |

**Reply writer (AI step):**

```
Write a short, friendly email reply from Northfield's freight team
("TruckerPath Customer Support") to the customer below. Use only the facts
given; never invent times, names or numbers. Under 120 words. Plain text.

Customer's question: {summary}
Shipment data: {shipment JSON}
What we did: {what the workflow just did, in one sentence}
```

**Carrier email template** (subject must keep the ID in brackets):

```
Subject: [SHP-1042] Delivery status needed

Hello Prairie Line Freight,

Our records show shipment SHP-1042 (BOL-88421), Chicago, IL to Dallas, TX,
had a delivery appointment at {delivery window}, but we have no arrival or
delivery recorded. Please reply with the arrival time, the delivery time
and who signed for it.

Thank you,
TruckerPath Operations
```

## Workflow B: a reply arrives

**Trigger:** new email in the agent's inbox whose subject starts with `Re:`.

**Step B1. Find the record.** Take the ID from the brackets in the subject,
then call `GET /api/lookup?ref={id}`.

**Step B2. Who replied?** If the sender is the record's `carrier_email`, follow
the carrier path. If it's the customer's email, follow the customer path.
Anyone else: ActionHub task.

**Carrier path (Act 1).**

1. AI step:

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

2. If `arrived_at` is present, `POST /api/shipments/{id}/milestones`:

   ```json
   {"code": "ARRCONSIGNEE", "event_time": "{arrived_at}",
    "location": "{shipment destination}", "source": "carrier",
    "reason": "Carrier confirmed by email", "source_ref": "{subject}"}
   ```

3. If `delivered_at` is present, post `DELV` the same way, with
   `"label": "Delivered, signed by {signed_by}"`.
4. A `422` means a time doesn't fit the timeline. Send it to ActionHub rather
   than guessing.
5. `PATCH /api/shipments/{id}` with `{"clear_agent_status": true, "reason": "Resolved; confirmed to customer", ...}`.
6. Email the customer with the reply writer: the shipment was delivered, at
   what time, and who signed.

**Customer path (Act 4).**

1. AI step: pull out pallet count and dimensions, e.g. `{"skid_details": "2 pallets", "skid_dims": "48x40x50"}`.
2. `PATCH /api/orders/{id}` with those fields, `"agent_status": "needs_human"`
   and `"reason": "Customer sent pallet dimensions; quote needs pricing"`.
3. ActionHub task: "Price order {id}". A person sets the price, because
   prices go through a person.
4. Reply to the customer: dimensions received, the quote will follow.

## Workflow C: data sweep (Act 5)

**Trigger:** a schedule, or a manual run during the demo.

1. `GET /api/agent-tools/orders/data-quality`. Note `by_fix_class`.
2. `POST /api/agent-tools/orders/apply-safe-fixes?dry_run=false&source_ref=Scheduled data sweep`.
3. One ActionHub task listing everything in `needs_human` (freight classes,
   impossible weights).
4. For `ask_customer` items: one email per order asking for the missing
   information.
5. `POST /api/notes` with `action` `data_sweep` and a one-line summary, e.g.
   "Fixed 221 fields on 86 orders; 18 sent to a person; 3 need the customer."

## Approval mode

Add one workflow setting, `APPROVAL_MODE`, true or false. When it's true,
every customer email goes into an ActionHub approval task instead of being
sent, and is sent once a person approves. Turn it on for the first demo run to
show the safety option, then turn it off to show full speed.

## Build order

1. Workflow A with only the lookup and the check. Run it by hand with a pasted
   email, and watch the calls in ngrok's inspector (http://127.0.0.1:4040).
2. Add the `answer_from_tms` and `fix_internally` branches (Act 2).
3. Add `ask_carrier` and workflow B's carrier path (Act 1).
4. Add `needs_human` and ActionHub (Act 3).
5. Add the order paths (Act 4) and workflow C (Act 5).
6. Switch the manual start to the email trigger.
7. Reset (`POST /api/admin/reset`) and run all five acts start to finish.

## Testing each act

| Act | Send this email to the agent's inbox, from | Expect |
|---|---|---|
| 1 | Customer: "Hi, was SHP-1042 delivered? It was due this morning." | Carrier gets an email; portal says "We are checking with the carrier". Reply as the carrier with times; the portal flips to Delivered and the customer gets a confirmation |
| 2 | Customer: "What truck is SHP-2048 on? We need it for dock check-in." | Reply says TRUCK-015, driver Marcus Johnson; the portal shows the truck |
| 3 | Any other address: "Please change the delivery address for SHP-2051." | No reply; an ActionHub task appears; Agent Activity shows the handoff |
| 4 | Customer: "When will I get a quote for SHP45342?" | Customer is asked for dimensions; reply with them; an ActionHub pricing task appears |
| 5 | Run workflow C | Agent Activity's "Safe to fix automatically" goes from 221 to 0 |
