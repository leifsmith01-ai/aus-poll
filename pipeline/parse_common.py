"""
Shared low-level parsing helpers used by the federal (``parse``), Victorian
(``vec_parse``) and other-state (``state_parse``) parsers.

These were previously copy-pasted into each of the three modules with subtly
different behaviour (different defaults, different handling of pandas NaN /
``%`` / internal spaces). They are unified here. Each caller keeps its own
thin alias so its historical default is preserved:

  * federal / VEC ints default to ``0``; state ints default to ``None``
  * floats default to ``None`` everywhere

The cleaning is the lenient union of the three originals — it strips commas,
surrounding whitespace, internal spaces and ``%`` — which is a superset of
what any single original did and never turns a previously-valid parse into a
failure.
"""

from __future__ import annotations


def _is_missing(val) -> bool:
    """True for ``None`` and float NaN (e.g. empty pandas cells)."""
    if val is None:
        return True
    # NaN is the only value that is not equal to itself; this catches pandas
    # float NaN without importing pandas.
    return isinstance(val, float) and val != val


def _clean(val) -> str:
    return str(val).replace(",", "").replace(" ", "").replace("%", "").strip()


def safe_int(val, default: int | None = 0) -> int | None:
    """Convert ``val`` to int, returning ``default`` on missing/invalid input."""
    if _is_missing(val):
        return default
    try:
        return int(_clean(val))
    except (ValueError, TypeError, AttributeError):
        return default


def safe_float(val, default: float | None = None) -> float | None:
    """Convert ``val`` to float, returning ``default`` on missing/invalid input."""
    if _is_missing(val):
        return default
    try:
        return float(_clean(val))
    except (ValueError, TypeError, AttributeError):
        return default
