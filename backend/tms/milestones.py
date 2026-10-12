"""
milestones.py — the shipment milestones and how they set a shipment's status.

Codes follow the team's whiteboard: ARRSHIP, PICK, ARRCONSIGNEE, DELV,
plus BOOKED, INTRANSIT and POD around them.
"""

# code -> (step number, default label, shipment status once reached)
MILESTONES = {
    "BOOKED":       (0, "Order confirmed",            "Booked"),
    "ARRSHIP":      (1, "Arrived at shipper",         "At Pickup"),
    "PICK":         (2, "Picked up",                  "In Transit"),
    "INTRANSIT":    (3, "In transit",                 "In Transit"),
    "ARRCONSIGNEE": (4, "Arrived at consignee",       "At Delivery"),
    "DELV":         (5, "Delivered",                  "Delivered"),
    "POD":          (6, "Proof of delivery uploaded", "Delivered"),
}

# INTRANSIT is a check call and can happen many times; every other code once.
REPEATABLE = {"INTRANSIT"}

# Expected timing, from the whiteboard happy path.
ARRIVAL_GRACE_MINUTES = 30     # ARRSHIP / ARRCONSIGNEE may be up to 30 min after the appointment starts
LOADING_WINDOW_HOURS = 2       # PICK due within 2 h of arriving at the shipper
UNLOADING_WINDOW_HOURS = 2     # DELV due within 2 h of arriving at the consignee


def step(code: str) -> int:
    return MILESTONES[code][0]


def default_label(code: str) -> str:
    return MILESTONES[code][1]


def status_for(codes: list[str]) -> str:
    """Shipment status from the furthest milestone reached."""
    if not codes:
        return "Booked"
    furthest = max(codes, key=step)
    return MILESTONES[furthest][2]
