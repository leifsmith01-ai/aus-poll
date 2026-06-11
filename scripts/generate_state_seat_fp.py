#!/usr/bin/env python3
"""
generate_state_seat_fp.py
=========================
Extract per-district first-preference vote percentages from the SQLite DB for
each supported state election and output JavaScript constants ready to paste
into webapp/src/App.jsx.

This creates state equivalents of the federal SEAT_FP_2025 constant, enabling
per-seat primary baselines in state models (rather than statewide averages).

Usage:
    python scripts/generate_state_seat_fp.py --state nsw --year 202303
    python scripts/generate_state_seat_fp.py --state qld --year 202410
    python scripts/generate_state_seat_fp.py --state all   # all configured states

Output:
    Prints JavaScript constant blocks to stdout.
    Each block is in the format used by computeModelledSeatsState():

    const VIC_SEAT_FP_2022 = {
      // district_id: { alp, coal, grn, ind, on, other }
      1001: { alp: 45.2, coal: 28.1, grn: 14.5, ind: 3.5, on: 1.8, other: 6.9 },
      ...
    };

Prerequisites — populate the DB first:
    python main.py --state nsw --year 202303
    python main.py --state qld --year 202410
    python main.py --state wa  --year 202503
    python main.py --state vic --year 202211
    etc.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

try:
    from pipeline.config import DB_PATH, STATE_REGISTRY
except ImportError:
    # Fallback must match pipeline/config.py (DB_PATH = data/aec_elections.db).
    DB_PATH = ROOT / "data" / "aec_elections.db"
    STATE_REGISTRY = {}

# ── Per-state coalition party abbreviations ───────────────────────────────────
COALITION_PARTIES: dict[str, set[str]] = {
    # VEC party codes: LIB (Liberal), NP/NAT (Nationals); the parser may also
    # normalise long names to LP/NP — accept all spellings.
    "vic": {"LP", "LIB", "NP", "NAT"},
    "nsw": {"LIB", "NAT", "LP", "NP"},
    "qld": {"LNP"},
    "wa":  {"LIB", "NAT", "LP"},
    "sa":  {"LIB"},
    "nt":  {"CLP"},
    "tas": {"LIB"},
    "act": {"LP", "LIB"},
}

# Party groupings: map raw party abbreviations to model party keys.
# 'alp'  = ALP and equivalents
# 'coal' = coalition parties
# 'grn'  = Greens
# 'ind'  = independents
# 'on'   = One Nation
# 'other'= everything else
def classify_party(party_ab: str | None, state: str) -> str:
    if not party_ab:
        return "other"
    p = party_ab.upper().strip()
    if p in ("ALP", "LAB"):
        return "alp"
    if p in COALITION_PARTIES.get(state, set()):
        return "coal"
    if p in ("GRN", "GRNS", "AG"):
        return "grn"
    if p in ("ON", "PHON"):
        return "on"
    if p in ("IND", "INDEP"):
        return "ind"
    return "other"


class DegenerateDataError(Exception):
    """Raised when generated FP data is obviously corrupt and must not be written."""


def degeneracy_reason(fp_data: dict[int, dict[str, float]]) -> str | None:
    """
    Sanity-check a state's per-district FP map and return a human-readable
    reason if it looks corrupt, else None.

    Catches the failure mode that previously shipped (every VIC district
    {ind: 100.0} because no party column was parsed): in any real Australian
    lower-house election the major parties dominate first preferences, and
    districts do not all share an identical vote profile.
    """
    if not fp_data:
        return None
    n = len(fp_data)
    avg_major = sum(d.get("alp", 0) + d.get("coal", 0) for d in fp_data.values()) / n
    if avg_major < 30.0:
        return (f"average ALP+Coalition first-preference share is {avg_major:.1f}% "
                f"across {n} districts (expected well above 30%)")
    for bucket in ("ind", "other", "on", "grn"):
        avg = sum(d.get(bucket, 0) for d in fp_data.values()) / n
        if avg >= 90.0:
            return f"'{bucket}' averages {avg:.1f}% across all {n} districts"
    if n > 5 and len({tuple(sorted(d.items())) for d in fp_data.values()}) == 1:
        return f"all {n} districts have an identical vote profile"
    return None


def _check_table(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def get_district_fp(
    conn: sqlite3.Connection, state: str, election_id: int
) -> dict[int, dict[str, float]]:
    """
    Return {district_id: {alp, coal, grn, ind, on, other}} with vote percentages.

    Percentages are of the formal first-preference vote for each district
    (candidates with no party are included in 'ind' or 'other').
    """
    table_fp   = f"{state}_district_fp"
    table_cand = f"{state}_candidates"
    table_dist = f"{state}_districts"

    for t in (table_fp, table_cand, table_dist):
        if not _check_table(conn, t):
            print(f"  [WARN] Table {t!r} not found — run pipeline first.", file=sys.stderr)
            return {}

    rows = conn.execute(
        f"""
        SELECT d.district_id, c.party_ab, fp.total_votes
        FROM {table_fp} fp
        JOIN {table_cand} c ON c.candidate_id = fp.candidate_id
                            AND c.election_id  = fp.election_id
        JOIN {table_dist} d ON d.district_id  = fp.district_id
                            AND d.election_id  = fp.election_id
        WHERE fp.election_id = ?
        ORDER BY d.district_id, fp.total_votes DESC
        """,
        (election_id,),
    ).fetchall()

    # Aggregate votes by (district, group)
    raw: dict[int, dict[str, int]] = {}
    for district_id, party_ab, votes in rows:
        if district_id not in raw:
            raw[district_id] = {"alp": 0, "coal": 0, "grn": 0, "ind": 0, "on": 0, "other": 0}
        group = classify_party(party_ab, state)
        raw[district_id][group] = raw[district_id].get(group, 0) + (votes or 0)

    # Convert to percentages
    result: dict[int, dict[str, float]] = {}
    for district_id, groups in raw.items():
        total = sum(groups.values())
        if total <= 0:
            continue
        result[district_id] = {
            k: round(v / total * 100, 1)
            for k, v in groups.items()
        }
        # Ensure other = 100 - sum of named parties (handles rounding)
        s = sum(v for k, v in result[district_id].items() if k != "other")
        result[district_id]["other"] = round(max(0.0, 100.0 - s), 1)

    return result


def get_district_names(
    conn: sqlite3.Connection, state: str, election_id: int
) -> dict[int, str]:
    """Return {district_id: district_name}."""
    table = f"{state}_districts"
    if not _check_table(conn, table):
        return {}
    rows = conn.execute(
        f"SELECT district_id, district_name FROM {table} WHERE election_id = ?",
        (election_id,),
    ).fetchall()
    return {r[0]: r[1] for r in rows}


def format_constant(
    state: str,
    election_id: int,
    fp_data: dict[int, dict[str, float]],
    names: dict[int, str],
) -> str:
    """Format the JS constant block."""
    # Derive constant name: VIC_SEAT_FP_2022, NSW_SEAT_FP_2023 etc.
    year = str(election_id)[:4]
    const_name = f"{state.upper()}_SEAT_FP_{year}"

    # Derive a display year/date string
    election_id_str = str(election_id)
    if len(election_id_str) == 6:
        # YYYYMM format for state elections
        month_num = int(election_id_str[4:])
        months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        month_str = months[month_num] if month_num <= 12 else f"M{month_num}"
        election_label = f"{year} ({month_str})"
    else:
        election_label = year

    lines = [
        f"// Per-district first-preference baselines for {state.upper()} {election_label},",
        f"// keyed by district name. Generated by scripts/generate_state_seat_fp.py.",
        f"// Use in computeModelledSeatsState() as the 'baselinePrim' parameter.",
        f"const {const_name} = {{",
    ]

    for dist_id in sorted(fp_data.keys(), key=lambda d: names.get(d, str(d))):
        fp = fp_data[dist_id]
        name = names.get(dist_id, f"District {dist_id}")
        alp   = fp.get("alp", 0.0)
        coal  = fp.get("coal", 0.0)
        grn   = fp.get("grn", 0.0)
        ind   = fp.get("ind", 0.0)
        on    = fp.get("on", 0.0)
        other = fp.get("other", 0.0)
        lines.append(
            f'  "{name}": {{ alp: {alp}, coal: {coal}, grn: {grn},'
            f" ind: {ind}, on: {on}, other: {other} }},"
        )

    lines.append("};")
    lines.append("")
    lines.append(
        f"// Helper: look up per-seat baseline for {state.upper()} {election_label}."
    )
    lines.append(
        f"function get{state.upper()}SeatFpBaseline(seatId) {{"
    )
    lines.append(
        f"  return {const_name}[seatId] ?? null;"
    )
    lines.append("}")
    return "\n".join(lines)


def format_export_constant(
    state: str,
    election_id: int,
    fp_data: dict[int, dict[str, float]],
    names: dict[int, str],
) -> str:
    """Format a JS constant block with `export` keyword (for ES module output).

    Same as format_constant() but uses `export const` and omits the per-state
    helper function — App.jsx accesses the constant directly via the module import.
    """
    year = str(election_id)[:4]
    const_name = f"{state.upper()}_SEAT_FP_{year}"

    lines = [
        f"// {state.upper()} — {len(fp_data)} districts, keyed by district name.",
        f"// App.jsx remaps names to its own seat IDs via mapSeatFpById().",
        f"export const {const_name} = {{",
    ]

    for dist_id in sorted(fp_data.keys(), key=lambda d: names.get(d, str(d))):
        fp = fp_data[dist_id]
        name = names.get(dist_id, f"District {dist_id}")
        alp   = fp.get("alp", 0.0)
        coal  = fp.get("coal", 0.0)
        grn   = fp.get("grn", 0.0)
        ind   = fp.get("ind", 0.0)
        on    = fp.get("on", 0.0)
        other = fp.get("other", 0.0)
        lines.append(
            f'  "{name}": {{ alp: {alp}, coal: {coal}, grn: {grn},'
            f" ind: {ind}, on: {on}, other: {other} }},"
        )

    lines.append("};")
    return "\n".join(lines)


def generate(state: str, election_id: int, db_path: Path) -> str | None:
    """Generate the JS constant for a single state/election.

    When called in stdout mode, prints to stdout and returns None.
    When called in module mode (caller collects return value), returns the
    export-formatted constant block as a string (or None if no data).
    """
    if not db_path.exists():
        # Don't abort — callers in module mode want a placeholder module
        # emitted even when the state DB hasn't been built locally yet.
        print(
            f"[INFO] DB not found at {db_path}; no {state.upper()} data available.",
            file=sys.stderr,
        )
        return None

    conn = sqlite3.connect(db_path)
    try:
        fp_data = get_district_fp(conn, state, election_id)
        names   = get_district_names(conn, state, election_id)
    finally:
        conn.close()

    if not fp_data:
        print(
            f"[WARN] No FP data found for {state.upper()} election {election_id}. "
            f"Run: python main.py --state {state} --year {election_id}",
            file=sys.stderr,
        )
        return None

    reason = degeneracy_reason(fp_data)
    if reason:
        raise DegenerateDataError(
            f"{state.upper()} {election_id} FP data looks corrupt — {reason}. "
            "Refusing to write it; check the pipeline parse "
            "(party column / file classification) and rebuild the DB."
        )

    return (fp_data, names)


# ── Latest configured election per state ─────────────────────────────────────
DEFAULT_ELECTIONS: dict[str, int] = {
    "vic": 202211,
    "nsw": 202303,
    "qld": 202410,
    "wa":  202503,
    # SA model baseline in App.jsx is the March 2026 election (SA_SEAT_FP_2026);
    # emits an empty placeholder until ECSA data is loaded into the DB.
    "sa":  202603,
    "nt":  202408,
    "tas": 202403,
    "act": 202410,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate per-seat FP baseline JS constants from the SQLite DB."
    )
    parser.add_argument(
        "--state",
        default="all",
        help="State abbreviation (vic, nsw, qld, wa, sa, nt, tas, act) or 'all'.",
    )
    parser.add_argument(
        "--year",
        type=int,
        help="Election ID in YYYYMM format (e.g. 202303). "
             "Defaults to the most recent configured election for the state.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DB_PATH,
        help="Path to SQLite database.",
    )
    parser.add_argument(
        "--output-module",
        type=Path,
        default=None,
        metavar="PATH",
        help="Write an ES module file with `export const` blocks instead of "
             "printing to stdout. Used by the GitHub Actions workflow to write "
             "webapp/src/data/state_seat_fp.js directly.",
    )
    args = parser.parse_args()

    # Collect (state, election_id) pairs to process
    pairs: list[tuple[str, int]] = []
    if args.state == "all":
        for state, election_id in DEFAULT_ELECTIONS.items():
            pairs.append((state, args.year or election_id))
    else:
        state = args.state.lower()
        election_id = args.year or DEFAULT_ELECTIONS.get(state)
        if election_id is None:
            print(
                f"ERROR: No default election configured for '{state}'. "
                "Specify --year YYYYMM.",
                file=sys.stderr,
            )
            sys.exit(1)
        pairs.append((state, election_id))

    if args.output_module:
        # ── Module mode: write a single ES module file with all constants ──
        blocks: list[str] = []
        degenerate_errors: list[str] = []
        for state, election_id in pairs:
            try:
                result = generate(state, election_id, args.db)
            except DegenerateDataError as exc:
                # Emit a placeholder for this state (graceful frontend fallback)
                # but fail the run so CI cannot silently commit corrupt data.
                print(f"[ERROR] {exc}", file=sys.stderr)
                degenerate_errors.append(str(exc))
                continue
            if result is None:
                continue
            fp_data, names = result
            blocks.append(format_export_constant(state, election_id, fp_data, names))
            print(f"  {state.upper()} {election_id}: {len(fp_data)} districts", file=sys.stderr)

        module_lines = [
            "// Auto-generated by scripts/generate_state_seat_fp.py — do not edit manually.",
            "// Regenerated monthly by the generate-state-fp GitHub Actions workflow.",
            "//",
            "// Per-district first-preference baselines for state elections,",
            "// keyed by district NAME (App.jsx remaps them to seat IDs).",
            "// Import in App.jsx:  import * as STATE_SEAT_FP from './data/state_seat_fp.js';",
            "// Usage:  mapSeatFpById(STATE_SEAT_FP.VIC_SEAT_FP_2022, VIC_SEATS)[seat.id]",
            "",
        ]

        if blocks:
            module_lines.append("\n\n".join(blocks))
            module_lines.append("")

        # Ensure every expected constant is exported even when a state's DB
        # tables are empty — lets App.jsx do named imports without Vite warnings.
        # Guarded by `typeof === 'undefined'` via placeholder const declarations:
        # only emitted for states that DIDN'T produce a populated block above.
        populated = {s.upper() for s, _ in pairs if any(
            f"{s.upper()}_SEAT_FP_{str(eid)[:4]}" in b for b in blocks for _, eid in [(s, None)]
        )}
        # Re-check populated set against the blocks' actual names (simpler).
        populated_names: set[str] = set()
        for b in blocks:
            for line in b.splitlines():
                if line.startswith("export const "):
                    populated_names.add(line.split()[2])
        placeholder_lines: list[str] = []
        for state, election_id in pairs:
            year = str(election_id)[:4]
            const_name = f"{state.upper()}_SEAT_FP_{year}"
            if const_name not in populated_names:
                placeholder_lines.append(f"export const {const_name} = {{}};")
        if placeholder_lines:
            module_lines.append("// Placeholders — state DB has no data yet for these elections.")
            module_lines.extend(placeholder_lines)
            module_lines.append("")

        if not blocks and not placeholder_lines:
            module_lines.append("// No state FP data available yet. Run the state pipeline first.")
            module_lines.append("")

        out_path = args.output_module
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("\n".join(module_lines), encoding="utf-8")
        print(f"Wrote {out_path} ({len(blocks)} states).", file=sys.stderr)
        if degenerate_errors:
            print(f"FAILED: {len(degenerate_errors)} state(s) had corrupt FP data "
                  "(placeholders written instead).", file=sys.stderr)
            sys.exit(1)
    else:
        # ── Stdout mode: print constant blocks for manual copy-paste ──
        for state, election_id in pairs:
            result = generate(state, election_id, args.db)  # DegenerateDataError propagates
            if result is None:
                continue
            fp_data, names = result
            print(f"// ── {state.upper()} {election_id} — {len(fp_data)} districts ──────────────────────\n")
            print(format_constant(state, election_id, fp_data, names))
            print()


if __name__ == "__main__":
    main()
