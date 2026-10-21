# SMART API Agent demo: runbook, script and report

About 15 minutes. Everything below works today except sending and reading real email (see "What is real and what is
simulated"). A full run uses about 8 Qubi runs.

## 1. The idea in one minute

A logistics company already has a TMS (transportation management system). We plug an AI agent into it **without
changing the TMS**. The agent watches for problems, answers customers, and hands anything risky to a person.

**AI understands, code decides.** The AI only reads language (what a customer wants) or writes it (an email, a
reply). Every decision, and every write to the TMS, goes through fixed rules. So the agent can be helpful without
being able to improvise on things that matter, like changing a delivery.

```
Customer portal / Ops console  ──►  TMS (:8000)  the existing system: shipments, orders, notes
                                         ▲
                                         │ normal API only
                                    Plugin (:8100)  the agent's body
                                      • detector: finds problems every minute
                                      • notes watcher: hears customers
                                      • rules: decide what is allowed
                                         │ webhook, only when AI is needed
                                         ▼
                                    Qubi  the agent's brain
                                      • Flow 1: classify, decide, fix / answer / email carrier / hand off
                                      • AI agents: classifier, reply writer, carrier email writer
```

The TMS has no agent screens. The agent's whole footprint is **notes on shipments and orders**, which is why a
supervisor can read exactly what it did.

## 2. Before the audience arrives

| # | Do | Check |
|---|---|---|
| 1 | `git pull`, then start the TMS, the plugin and the screens (three terminals). The plugin gets the current Qubi webhook URL and secret | `…ngrok…/health` shows `"qubi_webhook":true` |
| 2 | In Qubi: "SSA - Case Handler" is **published**, the old flow is disabled, and every agent node has its agent selected | Jobs is quiet |
| 3 | Open four browser tabs: **(a)** Ops console, signed in with the key, on Today. **(b)** Customer portal, "Continue as customer", on shipment **SHP-2049** → Notes. **(c)** Qubi Jobs. **(d)** The plugin's `/docs`, with **Authorize** done (`dev-key-change-me`) | |
| 4 | Do **not** reset yet. The reset is part of Act 1 | |
| 5 | Have the lines from section 4 copied somewhere you can paste from | |

Keep your Qubi runs low: don't reset more than once, don't run the classifier set, and don't run the smoke test while
the real webhook is set.

## 3. The script

### Act 1: a problem finds itself (3 min)
**Do:** on the plugin's `/docs` run `POST /api/admin/reset`, then `POST /api/detector/run`. Switch to the Ops console, **Today**.
**Say:** "I just reset the demo data. Nobody has reported anything. The monitor checks every active shipment every
minute and starts the agent only when it finds a new problem."
**See:** Today shows two problems: **SHP-1042 delivery overdue**, **SHP-2048 no truck or driver**. In Qubi Jobs, two runs
appear and finish in a few seconds.
**Then:** open **SHP-2048**. Details now show truck TRUCK-015 and driver Marcus Johnson. Its Notes tab shows "Problem
detected" and "Resolved automatically".
**Say:** "The truck and driver were already in another record, so the fix was certain. The agent made it itself and
left a note saying why. It only fixes when it is certain."

### Act 2: the carrier path (3 min)
**Do:** open **SHP-1042**, Notes tab.
**See:** "Problem detected", then **"Drafted email to Prairie Line Freight: [SHP-1042] Urgent: Delivery Status Update
Required. Not sent yet."** In Qubi, open that run's carrier email node to show the email the AI wrote from the shipment
data.
**Say:** "Only the carrier knows when it was delivered, so the agent drafts a precise email. In this environment the
email is not sent yet (see section 5), so I'll play the carrier's reply."
**Do (simulated reply):** on `/docs` run `POST /api/agent-tools/shipments/{shipment_id}/carrier-reply` with
`shipment_id` = `SHP-1042` and the body from section 4 (today's date, times in the past).
**See:** SHP-1042 turns **Delivered**; the timeline gains "Arrived at consignee" and "Delivered, signed by J. Ortiz"; in
the customer portal (SHP-1042 → Notes) the customer sees "Prairie Line Freight confirmed delivery in Dallas, TX …".
**Say:** "That call is what the second flow does after it reads the carrier's email. It records the times, tells the
customer, and closes the case. A time in the future, or out of order, would be refused and handed to a person."

### Act 3: a customer asks (4 min)
**Do:** in the customer portal, shipment **SHP-2049** → Notes. Add: `Where is my shipment right now?`
**See (about 20 seconds):** a plain-sentence reply from "Qubiway Support" with the status and appointment times. In the
Ops console, SHP-2049's Notes also show an internal line **classified**: `Request read as "Where is my shipment?"
(confidence 0.9x). Decision: answer_from_tms.`
**Say:** "An AI read what the customer meant, with a confidence. Because the answer is already in the TMS, the agent
replies from the data and invents nothing."
**Do:** ask `Who is the driver and which truck?`
**See:** a reply with the truck ID and driver name.

### Act 4: the guardrails (3 min)
**Do:** ask `Please deliver to our Mesa warehouse instead`.
**See (customer):** "Thanks. Our operations team is looking at this and will reply here." **See (Ops console, Notes):**
a **Needs a person** note with a brief: what the customer asked, the shipment, the delivery window, the carrier's
contact, and "Nothing has been changed or sent."
**Say:** "Changing a delivery can affect the receiver, the rate and the driver's hours, so the agent never decides it.
The AI recognised the request; the rule is what sends it to a person. Operations decides, and contacts the carrier if
it goes ahead."
**Do:** ask `How much did this cost?` → handed to a person (prices go through a person). Then ask
`hmm what about the other thing` → the classifier was unsure (below 0.6), so it goes to a person.
**Do:** on `/docs` run `POST /api/customer-requests` with the on-hold body from section 4.
**See:** SHP-2051's Notes: "Do not act alone: Account 111 is on hold".
**Say:** "The agent also refuses when the account is on hold. A confident AI can't override a rule."

### Act 5: orders (2 min)
**Do:** portal → **Request a quote**. Enter pickup 85034, state `arizona`, country `United States`; delivery `h1a0a9`,
country `canada`; weight `1,200 lbs`; pallets `2 pallets`; leave pallet size empty. Submit. Open the new order → Notes.
**See:** a note listing what was tidied ("arizona → AZ, canada → CA, 1,200 lbs → 1,200 lb …") and asking for the pallet
size.
**Do:** reply in the order's Notes: `Pallet size, L x W x H in inches: 48x40x50`.
**See:** the order's pallet size is filled in and the agent moves to the next step.
**Say:** "Orders are checked by the plugin's rules, with no AI and no Qubi run. The same notes channel works in both
directions."

### Close (1 min)
Collapse the left menu with its button (icons only, remembered). Then: "One part isn't live yet: real email. The
agent drafts it and the code to record a reply is built and tested. What's left is the Gmail wiring."

## 4. Lines to paste

Carrier reply (replace `YYYY-MM-DD` with today's date; Phoenix time is UTC-7 all year; both times must be in the
past, and arrival before delivery):
```
{"arrived_at": "YYYY-MM-DDT09:05:00-07:00", "delivered_at": "YYYY-MM-DDT10:30:00-07:00", "signed_by": "J. Ortiz", "summary": "Delivered and signed."}
```
On-hold customer:
```
{"ref": "SHP-2051", "message": "Where is my shipment?", "channel": "email"}
```

## 5. What is real and what is simulated

| Part | Status |
|---|---|
| TMS, portal, ops console, notes | Real |
| Detector, notes watcher, rules, guardrails, order checks | Real |
| Flow 1 in Qubi: classifier, decide, fix, answer, carrier-email draft, hand-off | Real, through the live webhook |
| Customer notices when a request changes hands | Real |
| Sending the carrier email, and reading the carrier's reply | **Not live.** The reply is simulated with the call the second flow will make |
| ActionHub task for "needs a person" | **Not live.** Today it is a note in the TMS |

## 6. If something goes wrong

| What you see | Do |
|---|---|
| No Qubi runs after the detector | `…/health`: is `qubi_webhook` true? Is the flow published and enabled? Does `/api/cases/webhook-status` show `HTTP 200` or `202`? |
| A portal question gets no answer | Wait 30 seconds. Check Jobs. If the run failed, read the Message in Console → Execution Log |
| The answer shows `{"message": ...}` | The plugin normally unwraps it. Say "formatting hiccup" and move on |
| SHP-2049 answers by asking the carrier | It turns overdue about 2.5 hours after a reset. Reset closer to the demo |
| You asked again on SHP-1042 or SHP-2048 and nothing ran | By design: a case with the carrier or a person isn't restarted. Check `not_sent` in `/api/cases/webhook-status` |
| Carrier-reply call returns an error | Times are in the future or before an earlier milestone. Move them earlier today |

## 7. Questions to expect

- **Why not one big agent that decides everything?** It would be less predictable and harder to guarantee things like
  "never change a delivery alone". Here the AI can only choose a topic, and fixed rules choose the action.
- **What if Qubi or the tunnel is down?** Cases wait. A case still new after three minutes is sent again up to three
  times, then handed to a person.
- **What stops a customer steering the agent?** The classifier can only pick one of five topics. It can't pick an action.
  A reply can still be worded oddly, which is why a person-approval step (ActionHub) is on the roadmap.
- **What if someone edits a record while the agent is working on it?** A person's edit always wins. The agent writes
  "only if it still is what I saw"; if not, the TMS refuses, the agent leaves the person's value and says so in a note.
  See `docs/agent-api-contract.md`, which also has the timings (a problem is noticed within 60 s; a customer note within 5 s).
- **How many runs does it use?** One run per new problem and per customer request. Follow-ups on a case a person or the
  carrier has are not re-run. Orders use none.

## 8. Test evidence
- Plugin smoke test: 66/66 checks with a Qubi webhook, 63/63 without.
- Live Flow 1 branches verified: fix, carrier draft, answer, change request, price question, unsure request, on-hold
  account.
- Not yet verified against the live agents: the 28-message classifier set.

## 9. Roadmap
1. Real email (send and read), per `docs/gmail-wiring-brief.md`.
2. ActionHub tasks and a reply-approval step.
3. The classifier set run against the live agent, and tuning from it.
4. Hosting the TMS and plugin on a server instead of a laptop.
