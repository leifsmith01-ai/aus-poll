"""
Plausibility validation for scraped poll records.

Wikipedia polling pages carry many tables with near-identical column headers —
seat projections, leadership approval, demographic and state breakouts — and the
keyword-driven column matching in pipeline.poll_scraper can occasionally parse
one of those as a voting-intention poll. Because merge_into_file() dedups by
(pollster, date) and never overwrites, a single mis-parsed row is permanent and
flows straight into the published aggregate.

This module is the shared gate: the scraper drops implausible records before
merging, and the aggregator skips any that are already in the files. Bounds are
deliberately generous — they must accommodate genuine structural shifts (e.g.
the 2026 One Nation surge to ~30% primaries and the Coalition's slide into the
teens) while still rejecting physically impossible rows like a 98% ALP primary
(a seat-projection table) or a 64% 2PP (a demographic subsample).
"""

from __future__ import annotations

# Per-field plausible ranges. A record is rejected if any present, non-None
# field falls outside its range. Missing minor-party columns default to 0.0 in
# the scraper, so lower bounds on grn/alp/coal(lp) also reject rows scraped
# from tables that lack real primary-vote columns.
FEDERAL_BOUNDS: dict[str, tuple[float, float]] = {
    "alp":  (15.0, 60.0),
    "coal": (10.0, 60.0),
    "grn":  (2.0, 20.0),
    "on":   (0.0, 40.0),
    "teal": (0.0, 25.0),
    "tpp":  (40.0, 60.0),
}

# State polls (VIC etc.): 'lp' is the coalition key, independents are tracked
# as a bloc, and state 2PPs run more lopsided than federal (VIC 2023 polling
# had ALP 2PP above 60), hence the wider tpp band.
STATE_BOUNDS: dict[str, tuple[float, float]] = {
    "alp": (15.0, 60.0),
    "lp":  (10.0, 60.0),
    "lnp": (10.0, 60.0),   # QLD coalition key
    "grn": (2.0, 25.0),
    "ind": (0.0, 30.0),
    "on":  (0.0, 40.0),
    "tpp": (35.0, 65.0),
}

FEDERAL_PRIMARY_FIELDS = ("alp", "coal", "grn", "on", "teal")
STATE_PRIMARY_FIELDS = ("alp", "lp", "lnp", "grn", "ind", "on")

# Named primaries must sum to something poll-like: below the floor the row is
# missing major columns; above the ceiling it isn't percentages at all (seat
# counts sum to 139+). The floor sits below 80 because pollsters like Essential
# publish with an undecided share excluded.
PRIMARY_SUM_RANGE = (75.0, 101.0)


def poll_implausibility(rec: dict, kind: str = "federal") -> str | None:
    """Return a human-readable reason the record is implausible, or None if OK.

    kind is "federal" (alp/coal/grn/on/teal) or "state" (alp/lp/grn/ind/on).
    Only fields present and non-None are range-checked; the primary-sum check
    treats missing fields as 0.
    """
    bounds, primary_fields = (
        (FEDERAL_BOUNDS, FEDERAL_PRIMARY_FIELDS) if kind == "federal"
        else (STATE_BOUNDS, STATE_PRIMARY_FIELDS)
    )

    for field, (lo, hi) in bounds.items():
        v = rec.get(field)
        if v is None:
            continue
        if not (lo <= v <= hi):
            return f"{field}={v} outside plausible range [{lo}, {hi}]"

    # Placeholder records (e.g. "Election Result" markers with every primary
    # None) carry no numbers to check and contribute nothing to aggregation.
    if all(rec.get(f) is None for f in primary_fields):
        return None

    total = sum(rec.get(f) or 0.0 for f in primary_fields)
    lo, hi = PRIMARY_SUM_RANGE
    if not (lo <= total <= hi):
        return f"primaries sum to {total:.1f} (plausible range [{lo}, {hi}])"

    return None


def filter_plausible(records: list[dict], kind: str = "federal",
                     logger=None) -> list[dict]:
    """Return only the plausible records, logging each rejection if a logger
    is supplied. Order is preserved."""
    kept: list[dict] = []
    for rec in records:
        reason = poll_implausibility(rec, kind)
        if reason is None:
            kept.append(rec)
        elif logger is not None:
            logger.warning(
                "rejecting implausible poll record %s %s: %s",
                rec.get("pollster"), rec.get("date"), reason,
            )
    return kept
