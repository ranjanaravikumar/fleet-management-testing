# The agent and the API: intent, need, gap, and the contract between them

How the agent works *with* the TMS API: what it reads, exactly what it writes, how long it takes, and what happens
when a person edits the same record at the same time.

## 1. Intent, need and gap

**Intent.** An agent that works **through the TMS's own API**, as one more clearly named user ("SMART API Agent"). It
does the small, certain jobs and hands anything that needs judgment to a person. The TMS stays the system of record
and needs no agent screens: the agent's work shows as notes.

**Need.** Operations teams spend their day on work that is repetitive and almost always has one right answer:
chasing a carrier about a missing delivery, filling in a field whose value is already in another record, answering
"where is my shipment?", and tidying order entries. At the same time, some requests must never be decided by software:
changing a delivery, quoting a price, acting on an account on hold.

**Gap in a TMS on its own.** Nobody watches every shipment every minute. Facts sit in different records and nobody
joins them. Customer questions wait for a person. Carrier follow-ups are manual. And an AI agent given write access to
a system of record would, by default, have no guarantees about scope, concurrency or audit.

**How the pieces close the gap.** Each part does only what it is good at:

| Part | Does | Guarantees |
|---|---|---|
| **TMS API** | Stores the truth. Validates every write | Integrity: ordering of tracking events, no duplicates, "write only if unchanged", a note for every change |
| **Plugin (rules)** | Watches, decides what is allowed, calls the API | The same answer for the same data; fixed policy (changes and prices go to a person) |
| **AI (Qubi)** | Reads what a customer means; writes an email or a reply | Produces text only. It cannot choose an action |

## 2. The contract: what the agent reads and writes

**Reads** (open, no key): shipments with milestones, orders, customers, carriers, loads, drivers, notes, and the
lookup. The detector reads every active shipment each pass; everything else is read on demand.

**Writes.** This is the complete list:

| What the agent writes | Through | Only when | Protection |
|---|---|---|---|
| **Truck and driver** on a shipment | `PATCH /api/shipments/{id}` | The field is empty **and** another record gives the answer for certain (the shipment's load names a driver, who drives a truck) | Written as "only if still empty"; refused (409) if a person filled it first |
| **Tracking updates** (arrival, delivery) | `POST /api/shipments/{id}/milestones` | Only from a carrier's reply | The TMS refuses a duplicate (409), a time in the future, or an event out of order (422). Append-only |
| **Order tidy-ups**: country, postal code, state, weight units, pallet count, pallet size | `PATCH /api/orders/{id}` | Only certain fixes (a format change, not a guess), and the customer's own answers to a question | Written as "only if unchanged since I read it"; refused (409) if a person edited it |
| **Notes** (internal, or visible to the customer) | `POST /api/notes` | Always, to say what it did | Append-only |

**What the agent never changes:** appointments, addresses, the assigned carrier, quotes or prices, invoices,
customer accounts (including a hold), or a shipment's status directly (status follows from its tracking events).
Anything that is a suggestion rather than a certainty (a likely country, a freight class from density) waits for a person
to approve it.

Two honest notes:
- **Scope is enforced by what the flows call.** The agent's API key could technically call other endpoints through the
  plugin. Restricting the key to the endpoints and fields above is on the roadmap.
- The toolkit also has a bulk "safe fixes" sweep for orders (it can tidy the fuel surcharge format, the status
  spelling and the quote format). **No flow runs it today.**

## 3. How fast: from a problem to a fix

The agent notices on a schedule and then acts. The wait before it notices has a known maximum, set by two intervals:

| Step | Time | Source |
|---|---|---|
| A problem is flagged only after its **rule threshold** | Arrival due 30 min after the appointment window opens; pickup and delivery due 2 h after arrival | Business rule (adjustable), not agent lag |
| The detector notices a new problem | **At most 60 s** (it checks every 60 s). Average 30 s | Setting `DETECTOR_INTERVAL_SECONDS` |
| One detector pass | About 33 ms for 10 active shipments (roughly 3 ms per shipment) | Measured |
| The notes watcher notices a customer's note | **At most 5 s** (it checks every 5 s); picking it up takes under 0.5 s | Setting `NOTES_POLL_SECONDS`; measured |
| The plugin's decision (check + rules) | About 11 ms | Measured |
| The plugin applying a fix | About 12 ms (read, rules, write, notes) | Measured |
| The Qubi run (AI classifier, then the action) | Typically 10 to 30 s | From Qubi's Jobs; an AI step took about 6 s |

**End to end, typically:** a problem found by the detector is acted on within about **90 s at most** (60 s wait + a Qubi
run), 45 s on average. A customer question is answered within about 35 s.

**When something fails:** if Qubi or the tunnel is down, a case still "new" after 3 minutes is sent again (checked every
minute), up to 3 times, then **handed to a person**. That is a worst case of roughly 12 to 15 minutes before a human is
told.

The measurements above are the plugin's side on a development machine, so the Qubi run and your network are extra.

## 4. When a person edits at the same time

**The rule: a person's edit always wins, and neither side overwrites the other silently.**

**How the agent behaves.** When it fixes something it says what it saw: "set the truck, *if it is still empty*". The
TMS checks that and writes in one step (under a write lock, so nothing can slip in between). If a person changed it
meanwhile, the TMS refuses with a 409 that says who changed what and when, nothing is written, and the agent:
- leaves a note on the record: "Left alone: truck is now TRUCK-099 (last change by Alex Rivera). The agent did not
  overwrite it", and the person's value stands;
- for an order (several writes), reads the record again and carries on from the person's version once; if the record
  keeps changing under it, it stops and hands the case to a person.

**How the screens behave.** The edit panel now remembers what the record looked like when you opened it, saves only the
fields **you** changed, and sends "if it is still what I saw". If the agent changed the same field meanwhile you get a
clear message and nothing is overwritten.

A real bug was found and fixed while checking this: the panel compared your form with the live record, which refreshes
every few seconds. If the agent filled in the truck while you were editing something else, the panel treated the
untouched truck field as your change, and saving could have **blanked the agent's fix**. It no longer does.

**What cannot collide.** Notes and tracking events are only ever added, never overwritten, and tracking events are
validated (no duplicates, no future times, in order). Two changes to **different fields** are both kept, which is intended.

**What is still true.** A reply the agent composes is a statement at one moment: a few seconds of Qubi time can pass
between the read and the customer seeing it. The portal itself always shows live data.

## 5. How to verify it

| Check | How |
|---|---|
| The agent loses a race, safely | `python -m plugin.race_test` (TMS up, plugin stopped): 11 checks. A person saves between the agent's read and write; the agent writes nothing and the person's truck stands. A person edits an order mid-review; it carries on from their version. A person keeps editing the same field; it hands over. Run against the code *before* this change, the same test shows the agent overwriting the person |
| The TMS guard | The full smoke test (`python -m plugin.smoke_test`) includes stale-write checks on shipments and orders |
| The screen | Fill in a truck as the agent while the edit panel is open: saving another field keeps the truck; changing the truck itself shows "Changed since you read it" |
| What the agent did | The record's Notes tab: every change, with who and why |

## 6. Roadmap
1. A scoped API key for the agent: only the endpoints and fields in section 2.
2. A version number on each record, a stronger check than comparing the fields it touches.
3. An approval step (ActionHub) for any write outside the safe list, and for replies.
4. A per-field change history view in the ops console.
