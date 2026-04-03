"""
Export pipeline: generates JSON files consumed by the frontend dashboard.

Output structure (under data/exports/):
  elections.json                     – list of available elections
  {year}/
    national_summary.json            – national party totals + seats won
    divisions.json                   – all 151 seats with winner, margins
    division_{division_id}.json      – detailed seat data (booths, candidates, TCP)
    booths.geojson                   – all booths with lat/lon + FP totals
    preference_flows.json            – observed preference matrices

All monetary/vote figures are integers. Percentages are 2dp floats.
"""

import json
import logging
from pathlib import Path

from .config import (
    DATA_EXPORTS_DIR, ELECTIONS, COALITION_PARTIES,
    VIC_ELECTIONS, VIC_EXPORTS_DIR, VIC_COALITION_PARTIES,
    STATE_REGISTRY,
)
from .database import (
    get_connection,
    get_all_divisions,
    get_division_summary,
    get_national_summary,
    get_vic_districts,
    get_vic_district_results,
    get_vic_state_summary,
    get_state_districts,
    get_state_district_results,
    get_state_summary,
    get_state_polling_places,
    get_state_booth_votes,
    get_state_previous_election_id,
    get_state_district_tcp_pcts,
    DB_PATH,
)

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _write_json(data, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=None, separators=(",", ":"))
    logger.debug("Wrote %s (%.1f KB)", path.name, path.stat().st_size / 1024)


def _round2(v) -> float | None:
    return round(float(v), 2) if v is not None else None


# ── elections.json ────────────────────────────────────────────────────────────

def export_elections_index(db_path: str = None, exports_dir: str = None) -> None:
    """Write the top-level elections.json listing available elections."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            "SELECT election_id, event_id, name, election_date FROM elections ORDER BY election_id DESC"
        ).fetchall()
        data = [dict(r) for r in rows]
    finally:
        conn.close()

    out = Path(exports_dir or DATA_EXPORTS_DIR) / "elections.json"
    _write_json(data, out)
    logger.info("Exported elections index → %s", out)


# ── national_summary.json ─────────────────────────────────────────────────────

def export_national_summary(election_id: int, db_path: str = None,
                              exports_dir: str = None) -> None:
    summary = get_national_summary(election_id, db_path)

    # Compute coalition combined figure
    coalition_total = sum(
        p["total_votes"] for p in summary["parties"]
        if p["party_ab"] in COALITION_PARTIES
    )
    coalition_seats = sum(
        s["seats_won"] for s in summary["seats_won"]
        if s["party_ab"] in COALITION_PARTIES
    )

    total = summary["total_votes"] or 1
    summary["coalition_combined"] = {
        "party_ab": "COAL",
        "party_name": "Coalition (combined)",
        "total_votes": coalition_total,
        "vote_share_pct": _round2(coalition_total / total * 100),
        "seats_won": coalition_seats,
    }

    out = Path(exports_dir or DATA_EXPORTS_DIR) / str(election_id) / "national_summary.json"
    _write_json(summary, out)
    logger.info("Exported national summary for %d → %s", election_id, out)


# ── divisions.json ────────────────────────────────────────────────────────────

def export_divisions_list(election_id: int, db_path: str = None,
                           exports_dir: str = None) -> None:
    """
    Export a lightweight list of all divisions with:
    - winner name + party
    - TCP margin (votes + %)
    - first pref vote share for top parties
    - swing vs previous election (if available)
    """
    conn = get_connection(db_path)
    try:
        divisions = conn.execute(
            """
            SELECT d.division_id, d.division_name, d.state_ab, d.enrolment
            FROM divisions d
            WHERE d.election_id = ?
            ORDER BY d.state_ab, d.division_name
            """,
            (election_id,),
        ).fetchall()

        output = []
        for div in divisions:
            div_id = div["division_id"]

            # Use the Distribution of Preferences (DOP) final count for TCP totals.
            # The DOP final count includes ALL vote types (ordinary, postal, absent,
            # pre-poll, provisional) and gives the official certified result.
            # We take the highest count_number in the DOP for this division as the
            # final result.
            tcp_rows = conn.execute(
                """
                SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                       c.elected, CAST(d.calculation_value AS INTEGER) AS total_votes
                FROM distribution_of_preferences d
                JOIN candidates c ON c.candidate_id = d.candidate_id
                                  AND c.election_id = d.election_id
                WHERE d.election_id = ?
                  AND d.division_id = ?
                  AND d.calculation_type = 'Preference Count'
                  AND d.calculation_value > 0
                  AND d.count_number = (
                      SELECT MAX(d2.count_number)
                      FROM distribution_of_preferences d2
                      WHERE d2.election_id = ? AND d2.division_id = ?
                  )
                ORDER BY total_votes DESC
                """,
                (election_id, div_id, election_id, div_id),
            ).fetchall()

            # First preference totals per party (from first_preferences table if available,
            # otherwise fall back to booth-level ordinary votes from tcp_votes)
            fp_rows = conn.execute(
                """
                SELECT c.party_ab, SUM(fp.total_votes) AS total_votes
                FROM first_preferences fp
                JOIN candidates c ON c.candidate_id = fp.candidate_id
                                  AND c.election_id = fp.election_id
                WHERE fp.election_id = ? AND fp.division_id = ?
                GROUP BY c.party_ab
                ORDER BY total_votes DESC
                """,
                (election_id, div_id),
            ).fetchall()

            fp_total = sum(r["total_votes"] for r in fp_rows) or 1
            tcp_total = sum(r["total_votes"] for r in tcp_rows) or 1

            tcp_sorted = sorted(tcp_rows, key=lambda r: r["total_votes"], reverse=True)
            margin_votes = (
                tcp_sorted[0]["total_votes"] - tcp_sorted[1]["total_votes"]
                if len(tcp_sorted) >= 2 else None
            )
            margin_pct = _round2(margin_votes / tcp_total * 100) if margin_votes is not None else None

            winner = tcp_sorted[0] if tcp_sorted else None

            output.append({
                "division_id":    div_id,
                "division_name":  div["division_name"],
                "state_ab":       div["state_ab"],
                "enrolment":      div["enrolment"],
                "winner": {
                    "candidate_id": winner["candidate_id"] if winner else None,
                    "name": f"{winner['given_name']} {winner['surname']}" if winner else None,
                    "party_ab": winner["party_ab"] if winner else None,
                } if winner else None,
                "tcp": [
                    {
                        "candidate_id": r["candidate_id"],
                        "name": f"{r['given_name']} {r['surname']}",
                        "party_ab": r["party_ab"],
                        "votes": r["total_votes"],
                        "pct": _round2(r["total_votes"] / tcp_total * 100),
                    }
                    for r in tcp_sorted
                ],
                "margin_votes": margin_votes,
                "margin_pct":   margin_pct,
                "first_prefs": [
                    {
                        "party_ab": r["party_ab"],
                        "votes":    r["total_votes"],
                        "pct":      _round2(r["total_votes"] / fp_total * 100),
                    }
                    for r in fp_rows[:6]  # top 6 parties for compactness
                ],
            })

    finally:
        conn.close()

    out = Path(exports_dir or DATA_EXPORTS_DIR) / str(election_id) / "divisions.json"
    _write_json(output, out)
    logger.info(
        "Exported %d divisions for election %d → %s", len(output), election_id, out
    )


# ── division_{id}.json ────────────────────────────────────────────────────────

def export_division_detail(division_id: int, election_id: int,
                            db_path: str = None, exports_dir: str = None) -> None:
    """Export full booth-level data for a single division."""
    detail = get_division_summary(division_id, election_id, db_path)

    # Attach per-booth first pref breakdown
    conn = get_connection(db_path)
    try:
        booth_votes = conn.execute(
            """
            SELECT
                pp.polling_place_id, pp.polling_place_name,
                pp.suburb, pp.latitude, pp.longitude,
                c.party_ab, c.surname, c.given_name,
                fp.ordinary_votes, fp.total_votes
            FROM first_preferences fp
            JOIN polling_places pp ON pp.polling_place_id = fp.polling_place_id
                                   AND pp.election_id = fp.election_id
            JOIN candidates c ON c.candidate_id = fp.candidate_id
                              AND c.election_id = fp.election_id
            WHERE fp.election_id = ? AND fp.division_id = ?
            ORDER BY pp.polling_place_name, c.ballot_position
            """,
            (election_id, division_id),
        ).fetchall()

        # Group by booth
        booths = {}
        for r in booth_votes:
            bid = r["polling_place_id"]
            if bid not in booths:
                booths[bid] = {
                    "polling_place_id":   bid,
                    "polling_place_name": r["polling_place_name"],
                    "suburb":             r["suburb"],
                    "latitude":           r["latitude"],
                    "longitude":          r["longitude"],
                    "candidates":         [],
                    "total_votes":        0,
                }
            booths[bid]["candidates"].append({
                "party_ab":       r["party_ab"],
                "name":           f"{r['given_name']} {r['surname']}",
                "ordinary_votes": r["ordinary_votes"],
                "total_votes":    r["total_votes"],
            })
            booths[bid]["total_votes"] += r["total_votes"]

        # Compute % for each candidate within booth
        for booth in booths.values():
            bt = booth["total_votes"] or 1
            for c in booth["candidates"]:
                c["pct"] = _round2(c["total_votes"] / bt * 100)

        detail["booths"] = list(booths.values())

    finally:
        conn.close()

    out = (
        Path(exports_dir or DATA_EXPORTS_DIR)
        / str(election_id)
        / "divisions"
        / f"{division_id}.json"
    )
    _write_json(detail, out)


def export_all_division_details(election_id: int, db_path: str = None,
                                 exports_dir: str = None) -> None:
    """Export individual JSON files for all divisions in an election."""
    conn = get_connection(db_path)
    try:
        division_ids = [
            r["division_id"]
            for r in conn.execute(
                "SELECT division_id FROM divisions WHERE election_id = ?",
                (election_id,)
            ).fetchall()
        ]
    finally:
        conn.close()

    logger.info(
        "Exporting detail files for %d divisions (election %d)...",
        len(division_ids), election_id
    )
    for i, div_id in enumerate(division_ids):
        export_division_detail(div_id, election_id, db_path, exports_dir)
        if (i + 1) % 20 == 0:
            logger.info("  %d/%d divisions exported", i + 1, len(division_ids))


# ── booths.geojson ────────────────────────────────────────────────────────────

def export_booths_geojson(election_id: int, db_path: str = None,
                           exports_dir: str = None) -> None:
    """
    Export all booths as a GeoJSON FeatureCollection.
    Each feature has booth metadata + total votes as properties.
    Used by the frontend map to render booth markers.
    """
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT pp.polling_place_id, pp.polling_place_name, pp.suburb,
                   pp.division_id, d.division_name, pp.state_ab,
                   pp.latitude, pp.longitude,
                   SUM(fp.total_votes) AS total_votes
            FROM polling_places pp
            LEFT JOIN first_preferences fp ON fp.polling_place_id = pp.polling_place_id
                                           AND fp.election_id = pp.election_id
            JOIN divisions d ON d.division_id = pp.division_id
                             AND d.election_id = pp.election_id
            WHERE pp.election_id = ?
              AND pp.latitude IS NOT NULL
              AND pp.longitude IS NOT NULL
            GROUP BY pp.polling_place_id
            ORDER BY pp.division_id, pp.polling_place_name
            """,
            (election_id,),
        ).fetchall()

        features = []
        for r in rows:
            if not r["latitude"] or not r["longitude"]:
                continue
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [r["longitude"], r["latitude"]],
                },
                "properties": {
                    "polling_place_id":   r["polling_place_id"],
                    "polling_place_name": r["polling_place_name"],
                    "suburb":             r["suburb"],
                    "division_id":        r["division_id"],
                    "division_name":      r["division_name"],
                    "state_ab":           r["state_ab"],
                    "total_votes":        r["total_votes"],
                },
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features,
        }
    finally:
        conn.close()

    out = Path(exports_dir or DATA_EXPORTS_DIR) / str(election_id) / "booths.geojson"
    _write_json(geojson, out)
    logger.info(
        "Exported %d booth points for election %d → %s",
        len(features), election_id, out
    )


# ── preference_flows.json ─────────────────────────────────────────────────────

# Parties that map to individual flow keys in App.jsx (grn_alp, teal_alp, on_alp).
# All others are aggregated into the "OTHER" bucket.
_COALITION_PARTY_ABS = {"LP", "LNP", "NP", "CLP"}
_TRACKED_PARTIES = {"GRN", "GVIC", "IND", "XEN", "CA", "ON", "PHON"}


def _compute_division_pref_flows(conn, election_id: int, div_id: int) -> dict | None:
    """
    Compute per-party ALP preference flow rates for one division from DOP data.

    For each non-finalist party's candidate, find the Transfer Count rows at the
    count when they are excluded and tally how many of their preferences went to
    the ALP candidate vs the Coalition candidate.

    Returns a dict {party_ab: {"alp_share": float}} for each non-finalist party
    that had a meaningful transfer to either ALP or Coalition, plus an "OTHER"
    aggregate for parties not individually tracked.  Returns None if the seat
    does not have an ALP vs Coalition TCP final or if no usable DOP data exists.
    """
    # Identify the ALP and Coalition TCP finalists from the final DOP count.
    finalists = conn.execute(
        """
        SELECT c.candidate_id, c.party_ab
        FROM distribution_of_preferences d
        JOIN candidates c ON c.candidate_id = d.candidate_id
                          AND c.election_id = d.election_id
        WHERE d.election_id = ?
          AND d.division_id = ?
          AND d.calculation_type = 'Preference Count'
          AND d.count_number = (
              SELECT MAX(d2.count_number)
              FROM distribution_of_preferences d2
              WHERE d2.election_id = ? AND d2.division_id = ?
          )
        GROUP BY c.candidate_id
        """,
        (election_id, div_id, election_id, div_id),
    ).fetchall()

    alp_id = next((r["candidate_id"] for r in finalists if r["party_ab"] == "ALP"), None)
    coal_id = next(
        (r["candidate_id"] for r in finalists if r["party_ab"] in _COALITION_PARTY_ABS),
        None,
    )
    if alp_id is None or coal_id is None:
        return None  # Not an ALP vs Coalition final

    # Fetch all Transfer Count rows for this division.
    transfers = conn.execute(
        """
        SELECT d.count_number, d.calculation_value, c.candidate_id, c.party_ab
        FROM distribution_of_preferences d
        JOIN candidates c ON c.candidate_id = d.candidate_id
                          AND c.election_id = d.election_id
        WHERE d.election_id = ? AND d.division_id = ?
          AND d.calculation_type = 'Transfer Count'
        ORDER BY d.count_number
        """,
        (election_id, div_id),
    ).fetchall()

    if not transfers:
        return None

    # Group rows by count number.
    by_count: dict[int, list] = {}
    for row in transfers:
        by_count.setdefault(row["count_number"], []).append(dict(row))

    # For each count (after the first), identify the excluded party and tally
    # how many preferences went to the ALP vs Coalition finalist.
    party_flows: dict[str, dict[str, float]] = {}

    for cn, rows in sorted(by_count.items()):
        if cn == 1:
            continue

        losing = [r for r in rows if r["calculation_value"] is not None and r["calculation_value"] < 0]
        gaining = [r for r in rows if r["calculation_value"] is not None and r["calculation_value"] > 0]

        if not losing or not gaining:
            continue

        # Only handle single-party exclusions to avoid attribution ambiguity.
        excluded_parties = {r["party_ab"] for r in losing}
        if len(excluded_parties) != 1:
            continue

        from_party = next(iter(excluded_parties))
        if from_party == "ALP" or from_party in _COALITION_PARTY_ABS:
            continue  # Finalists don't transfer away

        to_alp = sum(r["calculation_value"] for r in gaining if r["candidate_id"] == alp_id)
        to_coal = sum(r["calculation_value"] for r in gaining if r["candidate_id"] == coal_id)

        entry = party_flows.setdefault(from_party, {"to_alp": 0.0, "to_coal": 0.0})
        entry["to_alp"] += to_alp
        entry["to_coal"] += to_coal

    # Convert to alp_share fractions; aggregate unknown parties into "OTHER".
    result: dict[str, dict] = {}
    other_alp = 0.0
    other_coal = 0.0

    for party, flows in party_flows.items():
        total = flows["to_alp"] + flows["to_coal"]
        if total <= 0:
            continue
        if party in _TRACKED_PARTIES:
            result[party] = {"alp_share": round(flows["to_alp"] / total, 4)}
        else:
            other_alp += flows["to_alp"]
            other_coal += flows["to_coal"]

    other_total = other_alp + other_coal
    if other_total > 0:
        result["OTHER"] = {"alp_share": round(other_alp / other_total, 4)}

    return result if result else None


def export_preference_flows(election_id: int, db_path: str = None,
                              exports_dir: str = None) -> None:
    """
    Compute per-seat preference flows from DOP transfer counts and write
    data/exports/{election_id}/preference_flows.json.

    Output format:
        {
          "election_id": <int>,
          "by_division": {
            "<div_id>": {
              "<party_ab>": {"alp_share": <float 0-1>},
              ...
            }
          }
        }

    This format is consumed by scripts/update_s25_from_exports.py to populate
    SEAT_PREF_FLOWS_2025 in App.jsx.  Only ALP vs Coalition TCP finals are
    included; Teal/ON finals are handled by separate preference flow paths.
    """
    conn = get_connection(db_path)
    try:
        division_ids = [
            r["division_id"]
            for r in conn.execute(
                "SELECT division_id FROM divisions WHERE election_id = ?",
                (election_id,),
            ).fetchall()
        ]

        by_division: dict[str, dict] = {}
        for div_id in division_ids:
            flows = _compute_division_pref_flows(conn, election_id, div_id)
            if flows:
                by_division[str(div_id)] = flows
    finally:
        conn.close()

    data = {"election_id": election_id, "by_division": by_division}
    out = Path(exports_dir or DATA_EXPORTS_DIR) / str(election_id) / "preference_flows.json"
    _write_json(data, out)
    logger.info(
        "Exported preference flows for %d → %s (%d divisions)",
        election_id, out, len(by_division),
    )


# ── Full export for one election ──────────────────────────────────────────────

def export_election(election_id: int, db_path: str = None,
                    exports_dir: str = None) -> None:
    """Run the full export pipeline for one election year."""
    logger.info("═" * 60)
    logger.info("Starting full export for election %d", election_id)
    logger.info("═" * 60)

    export_elections_index(db_path, exports_dir)
    export_national_summary(election_id, db_path, exports_dir)
    export_divisions_list(election_id, db_path, exports_dir)
    export_all_division_details(election_id, db_path, exports_dir)
    export_booths_geojson(election_id, db_path, exports_dir)
    export_preference_flows(election_id, db_path, exports_dir)

    logger.info("Export complete for election %d", election_id)


# ── VIC State Election Exports ────────────────────────────────────────────────

def export_vic_elections_index(db_path: str = None, exports_dir: str = None) -> None:
    """Write vic/elections.json listing available VIC state elections."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT election_id, name, election_date, jurisdiction
            FROM vic_elections
            ORDER BY election_id DESC
            """
        ).fetchall()
        data = [dict(r) for r in rows]
    finally:
        conn.close()

    out = Path(exports_dir or VIC_EXPORTS_DIR) / "elections.json"
    _write_json(data, out)
    logger.info("Exported VIC elections index → %s", out)


def export_vic_state_summary(election_id: int, db_path: str = None,
                              exports_dir: str = None) -> None:
    """Export vic/{election_id}/state_summary.json."""
    summary = get_vic_state_summary(election_id, db_path)

    # Compute coalition combined figure
    coalition_total = sum(
        p["total_votes"] for p in summary["parties"]
        if p["party_ab"] in VIC_COALITION_PARTIES
    )
    coalition_seats = sum(
        s["seats_won"] for s in summary["seats_won"]
        if s["party_ab"] in VIC_COALITION_PARTIES
    )
    total = summary["total_votes"] or 1
    summary["coalition_combined"] = {
        "party_ab":      "COAL",
        "party_name":    "Coalition (combined)",
        "total_votes":   coalition_total,
        "vote_share_pct": _round2(coalition_total / total * 100),
        "seats_won":     coalition_seats,
    }

    out = Path(exports_dir or VIC_EXPORTS_DIR) / str(election_id) / "state_summary.json"
    _write_json(summary, out)
    logger.info("Exported VIC state summary for %d → %s", election_id, out)


def export_vic_districts_list(election_id: int, db_path: str = None,
                               exports_dir: str = None) -> None:
    """
    Export vic/{election_id}/districts.json — lightweight list of all 88 districts
    with winner, 2CP margin, and first preference breakdown.
    """
    conn = get_connection(db_path)
    try:
        districts = conn.execute(
            """
            SELECT d.district_id, d.district_name, d.enrolment
            FROM vic_districts d
            WHERE d.election_id = ?
            ORDER BY d.district_name
            """,
            (election_id,),
        ).fetchall()

        output = []
        for dist in districts:
            dist_id = dist["district_id"]

            # 2CP results
            tcp_rows = conn.execute(
                """
                SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                       c.elected, t.total_votes, t.vote_pct
                FROM vic_district_2cp t
                JOIN vic_candidates c ON c.candidate_id = t.candidate_id
                                     AND c.election_id = t.election_id
                WHERE t.election_id = ? AND t.district_id = ?
                ORDER BY t.total_votes DESC
                """,
                (election_id, dist_id),
            ).fetchall()

            # First preference totals by party
            fp_rows = conn.execute(
                """
                SELECT c.party_ab, SUM(f.total_votes) AS total_votes
                FROM vic_district_fp f
                JOIN vic_candidates c ON c.candidate_id = f.candidate_id
                                     AND c.election_id = f.election_id
                WHERE f.election_id = ? AND f.district_id = ?
                GROUP BY c.party_ab
                ORDER BY total_votes DESC
                """,
                (election_id, dist_id),
            ).fetchall()

            tcp_sorted = sorted(tcp_rows, key=lambda r: r["total_votes"], reverse=True)
            fp_total   = sum(r["total_votes"] for r in fp_rows) or 1
            tcp_total  = sum(r["total_votes"] for r in tcp_sorted) or 1

            margin_votes = (
                tcp_sorted[0]["total_votes"] - tcp_sorted[1]["total_votes"]
                if len(tcp_sorted) >= 2 else None
            )
            margin_pct = _round2(margin_votes / tcp_total * 100) if margin_votes is not None else None
            winner = tcp_sorted[0] if tcp_sorted else None

            output.append({
                "district_id":   dist_id,
                "district_name": dist["district_name"],
                "enrolment":     dist["enrolment"],
                "winner": {
                    "candidate_id": winner["candidate_id"] if winner else None,
                    "name": f"{winner['given_name']} {winner['surname']}" if winner else None,
                    "party_ab": winner["party_ab"] if winner else None,
                } if winner else None,
                "tcp": [
                    {
                        "candidate_id": r["candidate_id"],
                        "name": f"{r['given_name']} {r['surname']}",
                        "party_ab": r["party_ab"],
                        "votes": r["total_votes"],
                        "pct": _round2(r["total_votes"] / tcp_total * 100),
                    }
                    for r in tcp_sorted
                ],
                "margin_votes": margin_votes,
                "margin_pct":   margin_pct,
                "first_prefs": [
                    {
                        "party_ab": r["party_ab"],
                        "votes":    r["total_votes"],
                        "pct":      _round2(r["total_votes"] / fp_total * 100),
                    }
                    for r in fp_rows[:6]
                ],
            })

    finally:
        conn.close()

    out = Path(exports_dir or VIC_EXPORTS_DIR) / str(election_id) / "districts.json"
    _write_json(output, out)
    logger.info(
        "Exported %d VIC districts for election %d → %s", len(output), election_id, out
    )


def export_vic_district_detail(district_id: int, election_id: int,
                                db_path: str = None, exports_dir: str = None) -> None:
    """Export vic/{election_id}/districts/{district_id}.json."""
    detail = get_vic_district_results(district_id, election_id, db_path)
    out = (
        Path(exports_dir or VIC_EXPORTS_DIR)
        / str(election_id)
        / "districts"
        / f"{district_id}.json"
    )
    _write_json(detail, out)


def export_all_vic_district_details(election_id: int, db_path: str = None,
                                     exports_dir: str = None) -> None:
    """Export individual JSON files for all VIC districts in an election."""
    conn = get_connection(db_path)
    try:
        district_ids = [
            r["district_id"]
            for r in conn.execute(
                "SELECT district_id FROM vic_districts WHERE election_id = ?",
                (election_id,)
            ).fetchall()
        ]
    finally:
        conn.close()

    logger.info("Exporting detail files for %d VIC districts (election %d)...",
                len(district_ids), election_id)
    for dist_id in district_ids:
        export_vic_district_detail(dist_id, election_id, db_path, exports_dir)


def compute_vic_swings(
    election_id: int,
    prev_election_id: int,
    db_path: str = None,
    exports_dir: str = None,
) -> None:
    """
    Compute and export district-level swings between two VIC elections.

    For each district present in both elections, calculates:
      • swing_2cp  — change in ALP (or leading left-of-centre) 2CP % between elections
      • swing_alp_fp — change in ALP first-preference % between elections

    District names are normalised via VIC_DISTRICT_ALIASES to handle seats renamed
    during redistributions (e.g. "Ballarat West" → "Wendouree").

    Output: vic/{election_id}/swings_vs_{prev_election_id}.json
    """
    from .config import VIC_DISTRICT_ALIASES

    conn = get_connection(db_path)
    try:
        def _alp_2cp_pct(eid: int) -> dict[str, float | None]:
            """Return {district_name: alp_2cp_pct} for an election."""
            rows = conn.execute(
                """
                SELECT dn.district_name, t.vote_pct, c.party_ab
                FROM vic_district_2cp t
                JOIN vic_candidates c ON c.candidate_id = t.candidate_id
                                     AND c.election_id = t.election_id
                JOIN vic_districts dn ON dn.district_id = t.district_id
                                      AND dn.election_id = t.election_id
                WHERE t.election_id = ?
                """,
                (eid,),
            ).fetchall()
            result: dict[str, float | None] = {}
            for row in rows:
                name = row["district_name"]
                # ALP or left-dominant party is assumed to be the 'alp' side;
                # we record the ALP vote% if it's an ALP candidate, else store None
                if row["party_ab"] == "ALP":
                    result[name] = row["vote_pct"]
            return result

        def _alp_fp_pct(eid: int) -> dict[str, float | None]:
            """Return {district_name: alp_fp_pct} for an election."""
            rows = conn.execute(
                """
                SELECT dn.district_name, SUM(f.total_votes) AS alp_votes,
                       SUM(ft.total_votes_district) AS total_votes
                FROM vic_district_fp f
                JOIN vic_candidates c ON c.candidate_id = f.candidate_id
                                     AND c.election_id = f.election_id
                JOIN vic_districts dn ON dn.district_id = f.district_id
                                     AND dn.election_id = f.election_id
                JOIN (
                    SELECT election_id, district_id, SUM(total_votes) AS total_votes_district
                    FROM vic_district_fp
                    WHERE election_id = ?
                    GROUP BY election_id, district_id
                ) ft ON ft.election_id = f.election_id AND ft.district_id = f.district_id
                WHERE f.election_id = ? AND c.party_ab = 'ALP'
                GROUP BY dn.district_name
                """,
                (eid, eid),
            ).fetchall()
            return {
                row["district_name"]: (
                    _round2(row["alp_votes"] / row["total_votes"] * 100)
                    if row["total_votes"] else None
                )
                for row in rows
            }

        curr_2cp = _alp_2cp_pct(election_id)
        prev_2cp = _alp_2cp_pct(prev_election_id)
        curr_fp  = _alp_fp_pct(election_id)
        prev_fp  = _alp_fp_pct(prev_election_id)

    finally:
        conn.close()

    # Normalise district names using aliases (e.g. renamed seats between redistributions)
    def _canonical(name: str) -> str:
        return VIC_DISTRICT_ALIASES.get(name, name)

    # Build alias-keyed lookups for previous election
    prev_2cp_aliased = {_canonical(k): v for k, v in prev_2cp.items()}
    prev_fp_aliased  = {_canonical(k): v for k, v in prev_fp.items()}

    output = []
    all_districts = set(curr_2cp) | set(curr_fp)
    for name in sorted(all_districts):
        canonical = _canonical(name)
        c2cp = curr_2cp.get(name)
        p2cp = prev_2cp_aliased.get(canonical)
        cfp  = curr_fp.get(name)
        pfp  = prev_fp_aliased.get(canonical)

        output.append({
            "district_name":    name,
            "alp_2cp_curr":     _round2(c2cp),
            "alp_2cp_prev":     _round2(p2cp),
            "swing_2cp":        _round2(c2cp - p2cp) if c2cp is not None and p2cp is not None else None,
            "alp_fp_curr":      _round2(cfp),
            "alp_fp_prev":      _round2(pfp),
            "swing_alp_fp":     _round2(cfp - pfp) if cfp is not None and pfp is not None else None,
            "prev_election_id": prev_election_id,
        })

    out = (
        Path(exports_dir or VIC_EXPORTS_DIR)
        / str(election_id)
        / f"swings_vs_{prev_election_id}.json"
    )
    _write_json(output, out)
    logger.info(
        "Exported VIC district swings (%d→%d) for %d districts → %s",
        prev_election_id, election_id, len(output), out,
    )


def export_vic_election(election_id: int, db_path: str = None,
                        exports_dir: str = None) -> None:
    """Run the full VIC export pipeline for one election."""
    logger.info("═" * 60)
    logger.info("Starting full VIC export for election %d", election_id)
    logger.info("═" * 60)

    export_vic_elections_index(db_path, exports_dir)
    export_vic_state_summary(election_id, db_path, exports_dir)
    export_vic_districts_list(election_id, db_path, exports_dir)
    export_all_vic_district_details(election_id, db_path, exports_dir)

    # Compute district-level swings vs the preceding election if both are loaded.
    # Ordering: 202211 → 201811 → 201411
    from .config import VIC_ELECTIONS
    all_ids = sorted(VIC_ELECTIONS.keys(), reverse=True)  # descending: 202211, 201811, 201411
    idx = all_ids.index(election_id) if election_id in all_ids else -1
    if idx >= 0 and idx + 1 < len(all_ids):
        prev_id = all_ids[idx + 1]
        try:
            compute_vic_swings(election_id, prev_id, db_path, exports_dir)
        except Exception as exc:
            logger.warning(
                "Could not compute VIC swings (%d→%d): %s (run both elections first)",
                prev_id, election_id, exc,
            )

    logger.info("VIC export complete for election %d", election_id)


# ── Generic state/territory exports ───────────────────────────────────────────
#
# Mirrors the VEC export structure but is parameterised by state_ab.
# Output path: data/exports/{state_ab}/{election_id}/
#   elections.json      – list of all known elections for this state
#   summary.json        – state-wide party totals + seats won
#   districts.json      – list of all districts with winner info
#   districts/
#     {district_id}.json – per-district FP + TCP (or party_seats for Hare-Clark)


def export_state_elections_index(state_ab: str, db_path: str = None,
                                  exports_dir: str = None) -> None:
    """Export {state_ab}/elections.json listing all known elections."""
    cfg = STATE_REGISTRY[state_ab.lower()]
    elections = cfg["elections"]

    conn = get_connection(db_path)
    table = f"{state_ab.lower()}_elections"
    try:
        rows = conn.execute(
            f"SELECT election_id, name, election_date FROM {table} ORDER BY election_id DESC"
        ).fetchall()
    except Exception:
        rows = []
    finally:
        conn.close()

    loaded_ids = {r["election_id"] for r in rows}
    output = []
    for eid, ecfg in sorted(elections.items(), reverse=True):
        output.append({
            "election_id":   eid,
            "name":          ecfg["name"],
            "date":          ecfg["date"],
            "jurisdiction":  ecfg["jurisdiction"],
            "loaded":        eid in loaded_ids,
        })

    base = Path(exports_dir or cfg["exports_dir"])
    _write_json(output, base / "elections.json")
    logger.info("Exported %s elections index (%d entries)", state_ab.upper(), len(output))


def export_state_summary(state_ab: str, election_id: int,
                          db_path: str = None, exports_dir: str = None) -> None:
    """Export {state_ab}/{election_id}/summary.json."""
    cfg = STATE_REGISTRY[state_ab.lower()]
    summary = get_state_summary(state_ab, election_id, db_path)
    out = Path(exports_dir or cfg["exports_dir"]) / str(election_id) / "summary.json"
    _write_json(summary, out)
    logger.info("Exported %s %d summary → %s", state_ab.upper(), election_id, out)


def export_state_districts_list(state_ab: str, election_id: int,
                                 db_path: str = None, exports_dir: str = None) -> None:
    """Export {state_ab}/{election_id}/districts.json.

    For preferential states, includes an ``alp_swing_2pp`` field (pp change in ALP
    2CP% vs the previous election) wherever both elections have ALP TCP data.
    Hare-Clark systems (TAS, ACT) do not have 2CP data, so no swing is included.
    """
    cfg = STATE_REGISTRY[state_ab.lower()]
    hare_clark = cfg["system"] == "hare-clark"
    districts = get_state_districts(state_ab, election_id, db_path)

    if hare_clark:
        # For Hare-Clark, enrich with party seat summary per district
        output = []
        for d in districts:
            detail = get_state_district_results(
                state_ab, d["district_id"], election_id, db_path
            )
            output.append({
                "district_id":       d["district_id"],
                "district_name":     d["district_name"],
                "enrolment":         d.get("enrolment"),
                "seats_in_district": d.get("seats_in_district", 5),
                "party_seats":       detail.get("party_seats", []),
            })
    else:
        # Attempt to load previous election TCP for swing computation
        prev_election_id = get_state_previous_election_id(state_ab, election_id, db_path)
        prev_tcp: dict = {}
        if prev_election_id is not None:
            prev_tcp = get_state_district_tcp_pcts(state_ab, prev_election_id, db_path)
        curr_tcp = get_state_district_tcp_pcts(state_ab, election_id, db_path)

        output = []
        for d in districts:
            # Fetch FP summary for top candidates
            detail = get_state_district_results(
                state_ab, d["district_id"], election_id, db_path
            )
            fp_rows = detail.get("first_prefs", [])
            fp_total = sum(r.get("total_votes", 0) for r in fp_rows) or 1

            # Compute ALP 2PP swing vs previous election (None if data missing)
            did = d["district_id"]
            alp_swing_2pp = None
            curr_alp_pct = curr_tcp.get(did, {}).get("alp_pct")
            prev_alp_pct = prev_tcp.get(did, {}).get("alp_pct")
            if curr_alp_pct is not None and prev_alp_pct is not None:
                alp_swing_2pp = _round2(curr_alp_pct - prev_alp_pct)

            output.append({
                "district_id":    d["district_id"],
                "district_name":  d["district_name"],
                "enrolment":      d.get("enrolment"),
                "winner_party":   d.get("party_ab"),
                "winner_name":    (
                    f"{d.get('surname', '')} {d.get('given_name', '')}".strip()
                    if d.get("surname") else None
                ),
                "alp_2pp":        _round2(curr_alp_pct),
                "alp_swing_2pp":  alp_swing_2pp,
                "prev_alp_2pp":   _round2(prev_alp_pct),
                "top_candidates": [
                    {
                        "party_ab": r.get("party_ab"),
                        "votes":    r.get("total_votes"),
                        "pct":      _round2(r.get("total_votes", 0) / fp_total * 100),
                    }
                    for r in fp_rows[:4]
                ],
            })

    base = Path(exports_dir or cfg["exports_dir"])
    out = base / str(election_id) / "districts.json"
    _write_json(output, out)
    logger.info("Exported %d %s districts for election %d → %s",
                len(output), state_ab.upper(), election_id, out)


def export_state_district_detail(state_ab: str, district_id: int,
                                  election_id: int,
                                  db_path: str = None,
                                  exports_dir: str = None) -> None:
    """Export {state_ab}/{election_id}/districts/{district_id}.json."""
    cfg = STATE_REGISTRY[state_ab.lower()]
    detail = get_state_district_results(state_ab, district_id, election_id, db_path)
    out = (
        Path(exports_dir or cfg["exports_dir"])
        / str(election_id)
        / "districts"
        / f"{district_id}.json"
    )
    _write_json(detail, out)


def export_all_state_district_details(state_ab: str, election_id: int,
                                       db_path: str = None,
                                       exports_dir: str = None) -> None:
    """Export individual JSON files for all districts in a state election."""
    ab = state_ab.lower()
    conn = get_connection(db_path)
    try:
        district_ids = [
            r["district_id"]
            for r in conn.execute(
                f"SELECT district_id FROM {ab}_districts WHERE election_id = ?",
                (election_id,)
            ).fetchall()
        ]
    finally:
        conn.close()

    logger.info("Exporting detail files for %d %s districts (election %d)...",
                len(district_ids), state_ab.upper(), election_id)
    for dist_id in district_ids:
        export_state_district_detail(state_ab, dist_id, election_id, db_path, exports_dir)


def export_state_booths_geojson(state_ab: str, election_id: int,
                                 db_path: str = None,
                                 exports_dir: str = None) -> None:
    """Export {state_ab}/{election_id}/booths.geojson with all polling places.

    Each feature includes the booth's coordinates (if available) and a
    'properties' object with the FP vote totals per candidate party.
    Only available for NSW, QLD, WA, SA, NT (booth_level states).
    """
    _BOOTH_STATES = {"nsw", "qld", "wa", "sa", "nt"}
    if state_ab.lower() not in _BOOTH_STATES:
        logger.debug(
            "%s does not have booth-level data — skipping booths GeoJSON export.",
            state_ab.upper()
        )
        return

    cfg = STATE_REGISTRY[state_ab.lower()]
    places = get_state_polling_places(state_ab, election_id, db_path=db_path)

    features = []
    for p in places:
        booth_votes = get_state_booth_votes(
            state_ab,
            p["polling_place_id"],
            p["district_id"],
            election_id,
            db_path=db_path,
        )
        fp_rows = booth_votes.get("first_prefs", [])
        fp_total = sum(r.get("total_votes", 0) for r in fp_rows) or 1

        properties = {
            "polling_place_id":   p["polling_place_id"],
            "polling_place_name": p["polling_place_name"],
            "district_id":        p["district_id"],
            "suburb":             p.get("suburb"),
            "total_votes":        sum(r.get("total_votes", 0) for r in fp_rows),
            "fp": [
                {
                    "party_ab":  r.get("party_ab"),
                    "candidate": f"{r.get('surname', '')} {r.get('given_name', '')}".strip(),
                    "votes":     r.get("total_votes", 0),
                    "pct":       _round2(r.get("total_votes", 0) / fp_total * 100),
                }
                for r in fp_rows
            ],
        }

        lat = p.get("latitude")
        lon = p.get("longitude")
        geometry = (
            {"type": "Point", "coordinates": [lon, lat]}
            if lat is not None and lon is not None
            else None
        )

        features.append({
            "type":       "Feature",
            "geometry":   geometry,
            "properties": properties,
        })

    geojson = {
        "type":     "FeatureCollection",
        "features": features,
    }

    base = Path(exports_dir or cfg["exports_dir"])
    out = base / str(election_id) / "booths.geojson"
    _write_json(geojson, out)
    logger.info(
        "Exported %d %s booths GeoJSON for election %d → %s",
        len(features), state_ab.upper(), election_id, out
    )


def export_state_booth_detail(state_ab: str, polling_place_id: int,
                               district_id: int, election_id: int,
                               db_path: str = None,
                               exports_dir: str = None) -> None:
    """Export {state_ab}/{election_id}/booths/{polling_place_id}.json."""
    _BOOTH_STATES = {"nsw", "qld", "wa", "sa", "nt"}
    if state_ab.lower() not in _BOOTH_STATES:
        return
    cfg = STATE_REGISTRY[state_ab.lower()]
    detail = get_state_booth_votes(
        state_ab, polling_place_id, district_id, election_id, db_path
    )
    out = (
        Path(exports_dir or cfg["exports_dir"])
        / str(election_id)
        / "booths"
        / f"{polling_place_id}.json"
    )
    _write_json(detail, out)


def export_all_state_booth_details(state_ab: str, election_id: int,
                                    db_path: str = None,
                                    exports_dir: str = None) -> None:
    """Export individual JSON files for all booths in a state election."""
    _BOOTH_STATES = {"nsw", "qld", "wa", "sa", "nt"}
    if state_ab.lower() not in _BOOTH_STATES:
        logger.debug(
            "%s does not have booth-level data — skipping per-booth JSON export.",
            state_ab.upper()
        )
        return

    places = get_state_polling_places(state_ab, election_id, db_path=db_path)
    logger.info("Exporting detail files for %d %s booths (election %d)...",
                len(places), state_ab.upper(), election_id)
    for p in places:
        export_state_booth_detail(
            state_ab,
            p["polling_place_id"],
            p["district_id"],
            election_id,
            db_path,
            exports_dir,
        )


def export_state_election(state_ab: str, election_id: int,
                           db_path: str = None, exports_dir: str = None) -> None:
    """Run the full export pipeline for one state/territory election.

    Generates:
      data/exports/{state_ab}/elections.json
      data/exports/{state_ab}/{election_id}/summary.json
      data/exports/{state_ab}/{election_id}/districts.json
      data/exports/{state_ab}/{election_id}/districts/{district_id}.json
      data/exports/{state_ab}/{election_id}/booths.geojson    (booth states only)
      data/exports/{state_ab}/{election_id}/booths/{id}.json  (booth states only)
    """
    logger.info("═" * 60)
    logger.info("Starting full %s export for election %d", state_ab.upper(), election_id)
    logger.info("═" * 60)

    export_state_elections_index(state_ab, db_path, exports_dir)
    export_state_summary(state_ab, election_id, db_path, exports_dir)
    export_state_districts_list(state_ab, election_id, db_path, exports_dir)
    export_all_state_district_details(state_ab, election_id, db_path, exports_dir)

    # Booth-level exports (NSW, QLD, WA, SA, NT only)
    if state_ab.lower() in {"nsw", "qld", "wa", "sa", "nt"}:
        export_state_booths_geojson(state_ab, election_id, db_path, exports_dir)
        export_all_state_booth_details(state_ab, election_id, db_path, exports_dir)

    logger.info("%s export complete for election %d", state_ab.upper(), election_id)
