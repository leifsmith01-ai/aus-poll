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

def export_preference_flows(election_id: int, db_path: str = None,
                              exports_dir: str = None) -> None:
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT scope, scope_value, from_party, to_party, flow_pct, is_observed, label
            FROM preference_flows
            WHERE election_id = ?
            ORDER BY scope, from_party, flow_pct DESC
            """,
            (election_id,),
        ).fetchall()
        data = [dict(r) for r in rows]
    finally:
        conn.close()

    out = Path(exports_dir or DATA_EXPORTS_DIR) / str(election_id) / "preference_flows.json"
    _write_json(data, out)
    logger.info("Exported preference flows for %d → %s", election_id, out)


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
    """Export {state_ab}/{election_id}/districts.json."""
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
        output = []
        for d in districts:
            # Fetch FP summary for top candidates
            detail = get_state_district_results(
                state_ab, d["district_id"], election_id, db_path
            )
            fp_rows = detail.get("first_prefs", [])
            fp_total = sum(r.get("total_votes", 0) for r in fp_rows) or 1
            output.append({
                "district_id":   d["district_id"],
                "district_name": d["district_name"],
                "enrolment":     d.get("enrolment"),
                "winner_party":  d.get("party_ab"),
                "winner_name":   (
                    f"{d.get('surname', '')} {d.get('given_name', '')}".strip()
                    if d.get("surname") else None
                ),
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


def export_state_election(state_ab: str, election_id: int,
                           db_path: str = None, exports_dir: str = None) -> None:
    """Run the full export pipeline for one state/territory election.

    Generates:
      data/exports/{state_ab}/elections.json
      data/exports/{state_ab}/{election_id}/summary.json
      data/exports/{state_ab}/{election_id}/districts.json
      data/exports/{state_ab}/{election_id}/districts/{district_id}.json
    """
    logger.info("═" * 60)
    logger.info("Starting full %s export for election %d", state_ab.upper(), election_id)
    logger.info("═" * 60)

    export_state_elections_index(state_ab, db_path, exports_dir)
    export_state_summary(state_ab, election_id, db_path, exports_dir)
    export_state_districts_list(state_ab, election_id, db_path, exports_dir)
    export_all_state_district_details(state_ab, election_id, db_path, exports_dir)

    logger.info("%s export complete for election %d", state_ab.upper(), election_id)
