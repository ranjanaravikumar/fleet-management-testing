"""
milestones.py — the TMS's milestone codes, as the plugin needs them for its checks.

Mirrors GET /api/meta/milestone-codes on the TMS, plus the timing rules the
detector uses to decide a milestone is overdue.
"""

# code -> (step number, default label)
MILESTONES = {
    "BOOKED":       (0, "Order confirmed"),
    "ARRSHIP":      (1, "Arrived at shipper"),
    "PICK":         (2, "Picked up"),
    "INTRANSIT":    (3, "In transit"),
    "ARRCONSIGNEE": (4, "Arrived at consignee"),
    "DELV":         (5, "Delivered"),
    "POD":          (6, "Proof of delivery uploaded"),
}

# Expected timing, from the whiteboard happy path.
ARRIVAL_GRACE_MINUTES = 30     # ARRSHIP / ARRCONSIGNEE may be up to 30 min after the appointment starts
LOADING_WINDOW_HOURS = 2       # PICK due within 2 h of arriving at the shipper
UNLOADING_WINDOW_HOURS = 2     # DELV due within 2 h of arriving at the consignee


def step(code: str) -> int:
    return MILESTONES[code][0]


def default_label(code: str) -> str:
    return MILESTONES[code][1]
