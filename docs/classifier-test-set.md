# Classifier test set

28 sample customer requests with the topic the classifier should read. Use them two ways.

**By hand:** paste each message into the SSA Request Classifier agent's test panel and compare.
**Through the real flow:** `python -m plugin.classifier_check` sends each one as a customer request on one
shipment, waits for Flow 1, reads the plugin's `Request read as "…" (confidence …)` note, compares, and resolves
the case. About 15 seconds per message, and every message runs the flow, so it spends AI credits.
`--only change` runs a subset; `--timeout 120` waits longer for a slow flow.

What to look for:
- **Wrong topic** on a clear message: tighten the agent's instructions with an example of that wording.
- **Confidence under 0.6 on a clear message:** the request would go to a person. Raise the model's confidence by
  making the topics less overlapping, or lower `CLASSIFIER_MIN_CONFIDENCE`.
- **Confidence 0.6 or more on the two vague messages (27, 28):** the threshold isn't catching unclear requests.
- **Mixed messages (25, 26):** the rule is a change wins; otherwise the first thing asked.

| # | Customer says | Expected topic | Should be unsure? |
|---|---|---|---|
| 1 | Where is my shipment right now? | `status_update` | no |
| 2 | Has it been delivered yet? | `status_update` | no |
| 3 | What's the ETA for this load? | `status_update` | no |
| 4 | Any update on my freight? | `status_update` | no |
| 5 | Can you confirm when it arrives in Dallas? | `status_update` | no |
| 6 | My delivery is late, where is it? | `status_update` | no |
| 7 | Who is the driver and which truck? | `truck_number` | no |
| 8 | What's the truck number? | `truck_number` | no |
| 9 | Can I get the driver's name and phone number? | `truck_number` | no |
| 10 | Which truck is picking up my freight? | `truck_number` | no |
| 11 | Please deliver to our Mesa warehouse instead | `change_request` | no |
| 12 | Can we move the delivery to Friday morning? | `change_request` | no |
| 13 | I need to cancel this shipment | `change_request` | no |
| 14 | Reroute it to our Reno dock please | `change_request` | no |
| 15 | Add two more pallets to this load | `change_request` | no |
| 16 | Change the pickup time to 3pm | `change_request` | no |
| 17 | How much did this cost? | `quote_question` | no |
| 18 | Can you send me the rate for this lane? | `quote_question` | no |
| 19 | Why is my invoice higher than the quote? | `quote_question` | no |
| 20 | What would it cost to add a liftgate? | `quote_question` | no |
| 21 | ok thanks | `other` | no |
| 22 | Thank you so much! | `other` | no |
| 23 | Do you also ship to Canada? | `other` | no |
| 24 | hello | `other` | no |
| 25 | Where is it, and can you move it to tomorrow? | `change_request` | no |
| 26 | Who is the driver, and how much was it? | `truck_number` | no |
| 27 | hmm what about the other thing | `other` | yes (below 0.6) |
| 28 | can you look into it | `other` | yes (below 0.6) |
