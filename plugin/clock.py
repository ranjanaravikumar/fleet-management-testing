"""
clock.py — time helpers. Same convention as the TMS: Phoenix time (MST, UTC-7, no daylight saving).
"""
from datetime import datetime, timedelta, timezone

PHOENIX = timezone(timedelta(hours=-7), "MST")


def now() -> datetime:
    """Current time in Phoenix time, to the minute."""
    return datetime.now(PHOENIX).replace(second=0, microsecond=0)


def stamp() -> str:
    """Current time to the second, for records and 'updated at' fields."""
    return datetime.now(PHOENIX).replace(microsecond=0).isoformat()


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None
