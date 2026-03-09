"""
Copy pipeline exports to the frontend public/data directory.

Run this after main.py to make the real AEC data available to the frontend:
    python main.py --year 2022 2019
    python scripts/copy_data_to_frontend.py

This replaces the sample data files with real pipeline output.
"""

import os
import json
import shutil
from pathlib import Path

BASE_DIR     = Path(__file__).parent.parent
EXPORTS_DIR  = BASE_DIR / "data" / "exports"
FRONTEND_DIR = BASE_DIR / "frontend" / "public" / "data"


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


def main():
    print("Copying pipeline exports → frontend/public/data/")
    print("=" * 50)

    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

    for year in [2022, 2019, 2016]:
        copy_election_data(year)

    # Update elections.json in root
    elections_src = EXPORTS_DIR / "elections.json"
    if elections_src.exists():
        shutil.copy2(elections_src, FRONTEND_DIR / "elections.json")
        print(f"  ✓ Updated elections.json")

    print()
    print("Done. Start the frontend with: cd frontend && npm run dev")


if __name__ == "__main__":
    main()
