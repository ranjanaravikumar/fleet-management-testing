"""
dispatch.py — who handles a case event: Flow 1 in Qubi, or the plugin itself.

Flow 1 works on shipments. Order cases (a new quote request, a customer's
question about an order, their answer to the agent's question) are handled
here, so they never reach Flow 1 and fail there. Set ORDER_REVIEW_MODE=qubi to
send them to Qubi anyway.
"""
from collections import deque

from fastapi import HTTPException

from plugin import cases, config, qubi
from plugin.clock import stamp
from plugin.store import get_db, write_lock

skipped: deque = deque(maxlen=20)   # follow-ups on a case that isn't waiting for the agent


def orders_handled_by_plugin() -> bool:
    return config.ORDER_REVIEW_MODE != "qubi"


def route(event: str, case: dict) -> None:
    """Send a case event to whoever works it. Never raises for a Qubi delivery problem."""
    if case["record_type"] == "order" and orders_handled_by_plugin():
        _handle_order_case(event, case)
    elif case["status"] in cases.READY_FOR_AGENT:
        qubi.notify(event, case)
    else:
        # A customer added a note to a case the carrier or a person already has. Running Flow 1 again could
        # repeat a carrier email or resolve something a person owns. The note is on the case and the record.
        skipped.appendleft({"at": stamp(), "event": event, "case_id": case["id"], "status": case["status"]})


def _handle_order_case(event: str, case: dict) -> None:
    from plugin import toolkit   # late import: toolkit imports the cases module

    first_review = event == "case.created" and case["category"] == "new_order"
    answered = case["status"] == "customer_replied"   # the customer answered the agent's question
    if first_review or answered:
        try:
            cases.claim_case(case["id"])
        except HTTPException:
            return   # already taken
        toolkit.review_order(case["record_id"], case["id"])
    elif event == "case.created":
        _hand_to_person(case)   # a fresh question about an order: pricing and the like are a person's call
    # Anything else (a note on a case a person already has) needs no action.


def _hand_to_person(case: dict) -> None:
    with write_lock:
        conn = get_db()
        try:
            c = cases.load_case(conn, case["id"])
            cases.post_to_customer(conn, c, "agent",
                                   f"Thanks. Our team will look at your question about order {c['order_id']} "
                                   "and reply here.")
            cases.set_status(conn, c, "needs_human", "A customer question about an order.")
            conn.commit()
        finally:
            conn.close()
