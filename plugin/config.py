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

# Who works order cases (a new quote request, a question or answer on an order): the plugin
# (any value but "qubi", the default) or Qubi's Flow 1 ("qubi"). Flow 1 works on shipments,
# so leave this alone unless you've built an order path in the flow.
ORDER_REVIEW_MODE = os.environ.get("ORDER_REVIEW_MODE", "plugin").strip().lower()

# The request classifier (an AI step in Flow 1) reports how sure it is, 0 to 1.
# Below this, the request goes to a person instead of being answered.
CLASSIFIER_MIN_CONFIDENCE = float(os.environ.get("CLASSIFIER_MIN_CONFIDENCE", "0.6"))

PLUGIN_DB_PATH = os.environ.get("PLUGIN_DB_PATH", os.path.join(os.path.dirname(__file__), "plugin.db"))

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]

# How the plugin signs what it writes into the TMS.
AGENT_NAME = "SMART API Agent"          # internal notes and record changes
SUPPORT_NAME = "Qubiway Support"    # messages the customer sees
OPS_NAME = "Qubiway Operations"
