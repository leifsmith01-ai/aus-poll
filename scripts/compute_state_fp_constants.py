"""
Compute per-seat first-preference (FP) baselines for state/territory elections.

For each preferential-voting state (NSW, QLD, VIC, WA, SA, NT), queries the
pipeline SQLite database for district-level FP vote counts and produces
JavaScript constants (NSW_SEAT_FP_2023, QLD_SEAT_FP_2024, etc.) that can be
pasted into App.jsx.

These constants enable computeModelledSeatsState/Vic to compute per-seat 2PP
swings rather than applying a uniform statewide swing to all seats — mirroring
the SEAT_FP_2025 approach used in the federal model.

Usage:
    python scripts/compute_state_fp_constants.py

Prerequisites:
    python main.py --state nsw  --year 202303
    python main.py --state qld  --year 202410
    python main.py --state vic  --year 202211
    python main.py --state wa   --year 202503
    python main.py --state sa   --year 202603   # once SA 2026 data is available
    python main.py --state nt   --year 202408

Output:
    Prints JS constants to stdout, ready to paste into App.jsx.
    Also writes data/state_fp_report.txt with a per-seat breakdown.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
APP_JSX = ROOT / "webapp" / "src" / "App.jsx"
DB_PATH = ROOT / "data" / "elections.db"
REPORT_PATH = ROOT / "data" / "state_fp_report.txt"

# ── State configuration ───────────────────────────────────────────────────────
# (state_ab, election_id, js_constant_name, app_seat_array_name)
STATES = [
    ("nsw", 202303, "NSW_SEAT_FP_2023", "_NSW"),
    ("qld", 202410, "QLD_SEAT_FP_2024", "_QLD"),
    ("vic", 202211, "VIC_SEAT_FP_2022", "_VS"),
    ("wa",  202503, "WA_SEAT_FP_2025",  "_WA"),
    ("sa",  202603, "SA_SEAT_FP_2026",  "_SA"),
    ("nt",  202408, "NT_SEAT_FP_2024",  "_NT"),
]

# Party groupings used in App.jsx — map DB party_ab to model key.
# All parties not in this map fall into "ind" or "other" bucket.
PARTY_TO_KEY: dict[str, str] = {
    "ALP": "alp",
    "LP":  "coal", "NP": "coal", "LNP": "coal", "CLP": "coal",
    "GRN": "grn",
    "ON":  "on",
}


def _normalize(name: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def parse_app_seats(src: str, array_name: str) -> dict[str, int]:
    """
    Extract seat name → App.jsx seat ID from the named JS array constant.

    Handles the format:
        const _NSW = [
          [7001, "Penrith", "NSW", ...],
          ...
        ];
    Returns { normalized_name: seat_id }.
    """
    pattern = rf"const {re.escape(array_name)}\s*=\s*\[(.*?)\];"
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        return {}

    block = m.group(1)
    seats: dict[str, int] = {}
    # Match entries: [id, "Name", ...]
    for entry in re.finditer(r"\[\s*(\d+)\s*,\s*\"([^\"]+)\"", block):
        sid = int(entry.group(1))
        name = _normalize(entry.group(2))
        seats[name] = sid
    return seats


def get_connection(db_path: Path):
    """Open a read-only SQLite connection."""
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def fetch_state_fp(conn, state_ab: str, election_id: int) -> dict[int, dict]:
    """
    Query district-level first preferences for a state election.

    Returns { district_id: { name, alp, coal, grn, on, ind, total } }
    where alp/coal/grn/on/ind are raw vote totals.
    """
    ab = state_ab.lower()
    result: dict[int, dict] = {}
    try:
        rows = conn.execute(
            f"""
            SELECT
                f.district_id,
                d.district_name,
                c.party_ab,
                f.total_votes
            FROM {ab}_district_fp f
            JOIN {ab}_candidates c
                ON c.candidate_id = f.candidate_id
               AND c.election_id  = f.election_id
            JOIN {ab}_districts d
                ON d.district_id  = f.district_id
               AND d.election_id  = f.election_id
            WHERE f.election_id = ?
            """,
            (election_id,),
        ).fetchall()
    except Exception as exc:
        print(f"  [skip] {state_ab} {election_id}: {exc}", file=sys.stderr)
        return {}

    for row in rows:
        did = row["district_id"]
        if did not in result:
            result[did] = {
                "name": row["district_name"],
                "alp": 0, "coal": 0, "grn": 0, "on": 0, "ind": 0, "total": 0,
            }
        votes = row["total_votes"] or 0
        key = PARTY_TO_KEY.get(row["party_ab"], "ind")
        result[did][key] += votes
        result[did]["total"] += votes

    return result


def build_constant(
    state_ab: str,
    election_id: int,
    js_name: str,
    array_name: str,
    app_src: str,
    conn,
) -> tuple[str, list[str]]:
    """
    Build the JS constant string for one state.

    Returns (js_constant_string, report_lines).
    """
    app_seats = parse_app_seats(app_src, array_name)
    if not app_seats:
        return f"const {js_name} = {{}}; // {array_name} not found in App.jsx\n", []

    db_seats = fetch_state_fp(conn, state_ab, election_id)
    if not db_seats:
        return (
            f"const {js_name} = {{}};"
            f" // no data — run: python main.py --state {state_ab} --year {election_id}\n",
            [],
        )

    # Build DB name → district_id lookup
    db_by_name: dict[str, int] = {
        _normalize(v["name"]): did for did, v in db_seats.items()
    }

    lines: list[str] = [f"const {js_name} = {{"]
    report: list[str] = [f"\n=== {js_name} (election {election_id}) ==="]
    matched = unmatched_app = unmatched_db = 0

    for norm_name, sid in sorted(app_seats.items(), key=lambda x: x[1]):
        did = db_by_name.get(norm_name)
        if did is None:
            report.append(f"  UNMATCHED app seat id={sid} name='{norm_name}'")
            unmatched_app += 1
            continue

        d = db_seats[did]
        total = d["total"]
        if total == 0:
            report.append(f"  ZERO TOTAL for seat id={sid} name='{norm_name}'")
            continue

        alp  = round(d["alp"]  / total * 100, 2)
        coal = round(d["coal"] / total * 100, 2)
        grn  = round(d["grn"]  / total * 100, 2)
        on   = round(d["on"]   / total * 100, 2)
        ind  = round(d["ind"]  / total * 100, 2)

        # Use the original (non-normalised) DB name as comment
        db_name = db_seats[did]["name"]
        lines.append(
            f"  {sid}: {{ alp: {alp:5.2f}, coal: {coal:5.2f}, grn: {grn:5.2f},"
            f" ind: {ind:5.2f}, on: {on:5.2f} }}, // {db_name}"
        )
        report.append(
            f"  {db_name:<30} id={sid}  "
            f"alp={alp:.1f}% coal={coal:.1f}% grn={grn:.1f}% on={on:.1f}% ind={ind:.1f}%"
        )
        matched += 1

    # Report DB seats with no App.jsx match (informational)
    for norm_name, did in db_by_name.items():
        if norm_name not in app_seats:
            report.append(f"  UNMATCHED db  did={did} name='{db_seats[did]['name']}'")
            unmatched_db += 1

    lines.append("};")
    report.append(
        f"  Summary: {matched} matched, {unmatched_app} app-only, {unmatched_db} db-only"
    )
    return "\n".join(lines) + "\n", report


def main() -> None:
    if not APP_JSX.exists():
        print(f"ERROR: {APP_JSX} not found", file=sys.stderr)
        sys.exit(1)
    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found — run the pipeline first", file=sys.stderr)
        sys.exit(1)

    app_src = APP_JSX.read_text(encoding="utf-8")
    conn = get_connection(DB_PATH)

    all_js: list[str] = []
    all_report: list[str] = ["State FP constants report", "=" * 40]

    for state_ab, election_id, js_name, array_name in STATES:
        print(f"Processing {state_ab.upper()} {election_id}...", file=sys.stderr)
        js_const, report_lines = build_constant(
            state_ab, election_id, js_name, array_name, app_src, conn
        )
        all_js.append(f"// {state_ab.upper()} {election_id}")
        all_js.append(js_const)
        all_report.extend(report_lines)

    conn.close()

    # Print JS constants to stdout
    print("\n".join(all_js))

    # Write report
    REPORT_PATH.write_text("\n".join(all_report) + "\n", encoding="utf-8")
    print(f"\nReport written to {REPORT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
