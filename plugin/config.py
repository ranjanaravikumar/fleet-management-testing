"""
config.py — the plugin's settings, all from environment variables.
"""
import os


def _flag(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# Where the TMS is, and the key the plugin uses for its own writes.
TMS_URL = os.environ.get("TMS_URL", "http://localhost:8000").rstrip("/")
TMS_API_KEY = os.environ.get("TMS_API_KEY", "dev-key-change-me")

# Key callers (Qubi) send in X-API-Key for anything that changes data. Defaults to
# the TMS key, so the Qubi flows keep the key they already have.
PLUGIN_API_KEY = os.environ.get("PLUGIN_API_KEY", TMS_API_KEY)

# Flow 1's trigger in Qubi: new cases and customer replies are sent here.
QUBI_WEBHOOK_URL = os.environ.get("QUBI_WEBHOOK_URL", "").strip()
QUBI_TRIGGER_SECRET = os.environ.get("QUBI_TRIGGER_SECRET", "").strip()

# Shared secret on events the TMS sends to /events/tms (same value as TMS_EVENTS_SECRET).
TMS_EVENTS_SECRET = os.environ.get("TMS_EVENTS_SECRET", "").strip()

# Detector: checks active shipments every DETECTOR_INTERVAL_SECONDS.
DETECTOR_ENABLED = _flag("DETECTOR_ENABLED", True)
DETECTOR_INTERVAL_SECONDS = int(os.environ.get("DETECTOR_INTERVAL_SECONDS", "60"))

# Customer notes: the plugin reads new customer notes from the TMS and treats
# them as customer requests (or replies to an open question).
WATCH_CUSTOMER_NOTES = _flag("WATCH_CUSTOMER_NOTES", True)
NOTES_POLL_SECONDS = int(os.environ.get("NOTES_POLL_SECONDS", "5"))

# Who reviews a new order: "qubi" (Flow 1 calls /api/agent-tools/orders/{id}/review),
# "plugin" (the plugin reviews it straight away), or "auto" (plugin only when no
# Qubi webhook is set).
ORDER_REVIEW_MODE = os.environ.get("ORDER_REVIEW_MODE", "auto").strip().lower()

PLUGIN_DB_PATH = os.environ.get("PLUGIN_DB_PATH", os.path.join(os.path.dirname(__file__), "plugin.db"))

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]

# How the plugin signs what it writes into the TMS.
AGENT_NAME = "SMART API Agent"          # internal notes and record changes
SUPPORT_NAME = "Qubiway Support"    # messages the customer sees
OPS_NAME = "Qubiway Operations"
