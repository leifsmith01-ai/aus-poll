"""
Copy pipeline data files into webapp/src/data/ for the React frontend.

Run this after main.py / the data fetchers so the webapp bundles the freshest
betting odds, economics, leader ratings, poll aggregate and state poll files:
    python main.py --year 2022 2019
    python scripts/copy_data_to_frontend.py

The webapp is fully static and imports everything from webapp/src/data/ at
build time — it does not fetch any /data/ URL at runtime, so nothing is copied
into a public/ directory. (An earlier revision copied the per-election exports
into a frontend/public/data tree that no longer exists and was never read.)
"""

import shutil
from pathlib import Path

BASE_DIR     = Path(__file__).parent.parent
WEBAPP_DATA_DIR = BASE_DIR / "webapp" / "src" / "data"


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
    print("Copying pipeline data → webapp/src/data/")
    print("=" * 50)

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
