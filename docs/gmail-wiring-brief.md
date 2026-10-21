# Wiring email into the SMART Agent demo (brief for a Qubi builder)

Everything else in the project works and is tested. This is the one part left: the agent should **send** an
email to a carrier, and **read the carrier's reply**. The plugin and the Qubi flows are already built around it.

## What the agent does with email

**Send (Flow 1, "SSA - Case Handler", the `ask_carrier` path).** A shipment is overdue and only the carrier knows
why. The flow runs: *SSA Carrier Email Writer* (AI) → *Parse email JSON* → **[send the email — missing]** →
*Post carrier inquiry note* → *Mark awaiting carrier*.

After the Parse node these variables exist: `email_subject` (starts with `[SHP-1042]`) and `email_body`.
The send step must use:

| Field | Value |
|---|---|
| To | `{{session.shipment.carrier_email}}` (set from the TMS env var `DEMO_CARRIER_EMAIL`) |
| Subject | `{{session.email_subject}} [{{session.case_id}}]`: both bracketed tags must stay in the subject |
| Body | `{{session.email_body}}` (plain text) |

Then change the note node's message to `Emailed {{session.shipment.carrier_name}}: {{session.email_subject}}. Waiting on the carrier.`

**Receive (Flow 2, "SSA - Carrier Reply Handler", import `docs/ssa-carrier-reply.workflow.json`).** The carrier
replies to that email, keeping the subject. A trigger on the operations mailbox starts Flow 2 for each new
email whose subject contains `[SHP-`. Flow 2 gives the whole email to the *SSA Carrier Reply Reader* agent
(`{{session}}`), which returns `shipment_id`, `case_id`, `arrived_at`, `delivered_at`, `signed_by`, `summary`; one HTTP call to the
plugin then records everything. The plugin finds the email in whatever field the trigger puts it in only through the
agent, so the trigger just has to make the subject and body available in the run.

## Known snags

1. **Gmail "Send message" needs a raw message.** The connector's action takes one field, `raw`: a full RFC 2822
   message, base64URL-encoded. A Qubi template can't build that. Options: (a) the plugin builds it: add an endpoint
   that returns `raw` and call it just before the send; (b) the plugin sends by SMTP and the flow only calls an HTTP
   node; (c) use a connector whose send action takes plain fields. The `outlook` connection (currently
   Disconnected) may be one: Microsoft's send-mail call takes ordinary JSON. Ask the plugin owner for (a) or (b).
2. **Unattended triggers.** In this tenant, schedule and queue triggers have not fired. If a Gmail trigger doesn't
   start Flow 2 after a reply, the fallback is for the plugin to watch the mailbox over IMAP and start Flow 2 through
   a webhook, exactly as it already starts Flow 1.
3. **Keep runs low.** Every matching email is a run. Filter on the subject and on the sender, and ignore
   out-of-office replies if the trigger allows it.
4. Gmail "Search messages" returns only message IDs, so reading a message needs a "Get message" call per result.
   A trigger that delivers the message content avoids that.

## Needs
- An **operations mailbox** (sends, and receives the reply) connected in IntegrationHub.
- A **second mailbox that plays the carrier**: set its address as `DEMO_CARRIER_EMAIL` when starting the TMS,
  then reset the demo data. It does not need to connect to Qubi.
- Times in a reply are Phoenix time (-07:00); the agent is told so.

## Acceptance test
1. Reset the demo data. The detector finds SHP-1042 (delivery overdue) and starts Flow 1.
2. The carrier mailbox receives the email, subject `[SHP-1042] … [CASE-100x]`.
3. Reply from that mailbox, keeping the subject: *"Arrived 2:05 PM, delivered 3:30 PM today, signed by J. Ortiz"*
   (times in the past, today).
4. Expect, within a minute or two: SHP-1042 shows **Delivered** with the two new tracking updates; the customer
   portal's Notes tab shows "Prairie Line Freight confirmed delivery in Dallas, TX …"; the case is `resolved`
   (`/api/cases` on the plugin); an internal note "Carrier reply: …" appears on the shipment.
5. A time in the future, or out of order, must not be recorded. The case goes to a person instead.
