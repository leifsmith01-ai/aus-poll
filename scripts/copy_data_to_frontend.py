"""
Copy pipeline exports to the frontend public/data directory.

Run this after main.py to make the real AEC data available to the frontend:
    python main.py --year 2022 2019
    python scripts/copy_data_to_frontend.py

To also copy fresh betting odds (after running pipeline/betting_odds.py):
    python pipeline/betting_odds.py
    python scripts/copy_data_to_frontend.py

This replaces the sample data files with real pipeline output.
"""

import shutil
from pathlib import Path

BASE_DIR     = Path(__file__).parent.parent
EXPORTS_DIR  = BASE_DIR / "data" / "exports"
FRONTEND_DIR = BASE_DIR / "frontend" / "public" / "data"
WEBAPP_DATA_DIR = BASE_DIR / "webapp" / "src" / "data"


def copy_election_data(year: int) -> None:
    src = EXPORTS_DIR / str(year)
    dst = FRONTEND_DIR / str(year)

    if not src.exists():
        print(f"  ✗ No export data found for {year} (run the pipeline first)")
        return

    dst.mkdir(parents=True, exist_ok=True)

    files_copied = 0
    for src_file in src.rglob("*"):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(src)
        dst_file = dst / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dst_file)
        files_copied += 1

    print(f"  ✓ {year}: copied {files_copied} files → {dst}")

    # Update the sample file if divisions.json exists (used by the frontend as default)
    divisions_file = dst / "divisions.json"
    if divisions_file.exists():
        sample_dst = FRONTEND_DIR / f"sample_{year}.json"
        shutil.copy2(divisions_file, sample_dst)
        print(f"  ✓ Updated sample_{year}.json")


def copy_economics() -> None:
    """Copy economics.json to webapp/src/data/ for the React frontend."""
    WEBAPP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    src = BASE_DIR / "data" / "economics.json"
    dst = WEBAPP_DATA_DIR / "economics.json"
    if not src.exists():
        print("  ✗ No economics.json found (run: python pipeline/fetch_economics.py)")
        return
    shutil.copy2(src, dst)
    print(f"  ✓ economics.json → {dst}")


def copy_leaders() -> None:
    """Copy leaders.json (approval ratings) to webapp/src/data/ for the React frontend."""
    WEBAPP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    src = BASE_DIR / "data" / "polls" / "leaders.json"
    dst = WEBAPP_DATA_DIR / "leaders.json"
    if not src.exists():
        print(f"  ✗ No leaders.json found at {src}")
        return
    shutil.copy2(src, dst)
    print(f"  ✓ leaders.json → {dst}")


def copy_aggregated_polls() -> None:
    """Copy aggregated.json (house-effect-corrected poll aggregate) to webapp/src/data/."""
    WEBAPP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    src = BASE_DIR / "data" / "polls" / "aggregated.json"
    dst = WEBAPP_DATA_DIR / "aggregated.json"
    if not src.exists():
        print("  ✗ No aggregated.json found (run: python -m pipeline.poll_aggregator)")
        return
    shutil.copy2(src, dst)
    print(f"  ✓ aggregated.json → {dst}")


def copy_state_polls() -> None:
    """Copy state poll JSONs (vic/nsw/qld/wa/sa) to webapp/src/data/ for the React frontend.

    The state scenario builders read these for their recent-polls lists and the
    "apply latest polls" seeding action.
    """
    WEBAPP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for state in ["vic", "nsw", "qld", "wa", "sa"]:
        src = BASE_DIR / "data" / "polls" / f"{state}_polls.json"
        dst = WEBAPP_DATA_DIR / f"{state}_polls.json"
        if not src.exists():
            print(f"  ✗ No {state}_polls.json found at {src}")
            continue
        shutil.copy2(src, dst)
        print(f"  ✓ {state}_polls.json → {dst}")


def main():
    print("Copying pipeline exports → frontend/public/data/")
    print("=" * 50)

    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

    for year in [2025, 2022, 2019, 2016]:
        copy_election_data(year)

    # Update elections.json in root
    elections_src = EXPORTS_DIR / "elections.json"
    if elections_src.exists():
        shutil.copy2(elections_src, FRONTEND_DIR / "elections.json")
        print("  ✓ Updated elections.json")

    # ── Betting odds → webapp/src/data/ ──────────────────────────────────────
    copy_betting_odds()

    # ── Economic indicators → webapp/src/data/ ────────────────────────────────
    copy_economics()

    # ── Leader approval ratings → webapp/src/data/ ───────────────────────────
    copy_leaders()

    # ── House-effect-corrected poll aggregate → webapp/src/data/ ─────────────
    copy_aggregated_polls()

    # ── State poll JSONs → webapp/src/data/ ──────────────────────────────────
    copy_state_polls()

    print()
    print("Done. Start the frontend with: cd webapp && npm run dev")


def copy_betting_odds() -> None:
    """Copy betting odds JSON to webapp/src/data/ for the React frontend."""
    WEBAPP_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Prefer the generated (live) file; fall back to manual placeholder
    generated = BASE_DIR / "data" / "polls" / "betting_odds.json"
    manual    = BASE_DIR / "data" / "polls" / "betting_odds_manual.json"
    dst       = WEBAPP_DATA_DIR / "betting_odds.json"

    src = generated if generated.exists() else manual
    if not src.exists():
        print(f"  ✗ No betting odds file found (expected {generated} or {manual})")
        return

    shutil.copy2(src, dst)
    source_label = "live" if src == generated else "manual placeholder"
    print(f"  ✓ betting_odds.json → {dst} ({source_label})")


if __name__ == "__main__":
    main()
