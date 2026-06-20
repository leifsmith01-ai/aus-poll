#!/usr/bin/env python3
"""
Western Australian State Election 2CP Extractor

This script helps extract district-level two-candidate preferred (2CP) data
from Wikipedia or official sources and format it for the calibration script.

Usage:
    python scripts/wa_2cp_extractor.py <wikipedia_html_file>

Or use the data entry functions directly to build data dictionaries.
"""

import re
import json
from typing import Dict


class WA_2CP_Extractor:
    """Extract and structure WA election 2CP data."""

    def __init__(self):
        self.elections = {}

    def add_election(self, year: int, election_id: str, data: Dict):
        """Add a complete election's 2CP data.

        Args:
            year: Election year (e.g. 2021)
            election_id: YYYYMM format (e.g. '202103')
            data: Dict mapping district_name -> (alp_pct, coalition_pct)
                  or just alp_pct as float
        """
        if year not in self.elections:
            self.elections[year] = {}
        self.elections[year][election_id] = data

    def extract_from_wikipedia_html(self, html_file: str) -> Dict:
        """Extract 2CP data from saved Wikipedia HTML.

        Looks for tables with column headers like:
        - "Electorate"
        - "ALP %"
        - "Coalition %" or "Liberal" or "Labor %"

        Args:
            html_file: Path to saved Wikipedia HTML

        Returns:
            Dict mapping district names to ALP 2CP percentages
        """
        try:
            with open(html_file, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading file {html_file}: {e}")
            return {}

        # Very basic table extraction - adjust regex as needed
        results = {}

        # Split by table rows
        rows = re.split(r'<tr[^>]*>', content)

        for row in rows:
            # Try to extract electorate and 2CP percentages
            cells = re.findall(r'<td[^>]*>([^<]+)</td>', row)
            if len(cells) >= 2:
                # First cell often electorate name
                electorate = cells[0].strip()
                if electorate and len(electorate) > 3:  # Filter out noise
                    # Look for percentages in remaining cells
                    percentages = []
                    for cell in cells[1:]:
                        # Extract numeric percentage
                        match = re.search(r'(\d+\.?\d*)', cell)
                        if match:
                            try:
                                pct = float(match.group(1))
                                if 30 <= pct <= 70:  # Sanity check for 2CP
                                    percentages.append(pct)
                            except:
                                pass

                    if len(percentages) >= 1:
                        alp_pct = percentages[0]
                        results[electorate.strip()] = alp_pct

        return results

    def to_dict(self) -> Dict:
        """Export all data as nested dictionaries."""
        return self.elections

    def to_json(self, filepath: str = None) -> str:
        """Export as JSON."""
        data = {
            f"{year}": {
                election_id: districts
                for election_id, districts in elections.items()
            }
            for year, elections in self.elections.items()
        }
        json_str = json.dumps(data, indent=2)
        if filepath:
            with open(filepath, 'w') as f:
                f.write(json_str)
            print(f"Saved to {filepath}")
        return json_str

    def print_summary(self):
        """Print a summary of extracted data."""
        for year in sorted(self.elections.keys()):
            print(f"\n{year}:")
            for election_id, districts in self.elections[year].items():
                print(f"  {election_id}: {len(districts)} districts")
                for dist_name, data in sorted(districts.items())[:5]:
                    if isinstance(data, tuple):
                        alp, coal = data
                        print(f"    {dist_name}: ALP {alp}%, Coalition {coal}%")
                    else:
                        print(f"    {dist_name}: ALP {data}%")
                if len(districts) > 5:
                    print(f"    ... and {len(districts) - 5} more")


# Example usage with manual data entry
if __name__ == "__main__":
    import sys

    extractor = WA_2CP_Extractor()

    # Template for 2021 WA State Election data
    # Get from: https://en.wikipedia.org/wiki/2021_Western_Australian_legislative_assembly_election
    wa_2021_data = {
        # Format: "District Name": ALP_2CP_percentage
        # Example entries - replace with actual Wikipedia data
        "Albany": 44.3,
        "Armadale": 62.5,
        "Ascot": 58.9,
        "Bateman": 50.2,
        # ... add all 59 districts
    }
    extractor.add_election(2021, "202103", wa_2021_data)

    # Template for 2017 data
    wa_2017_data = {
        # Get from: https://en.wikipedia.org/wiki/2017_Western_Australian_legislative_assembly_election
        # "District Name": ALP_2CP_percentage,
    }
    # extractor.add_election(2017, "201703", wa_2017_data)

    # Template for 2025 data
    wa_2025_data = {
        # Get from: https://en.wikipedia.org/wiki/2025_Western_Australian_legislative_assembly_election
        # "District Name": ALP_2CP_percentage,
    }
    # extractor.add_election(2025, "202503", wa_2025_data)

    # Print summary
    extractor.print_summary()

    # Save to JSON
    extractor.to_json("data/wa_2cp_extracted.json")

    # If HTML file provided as argument
    if len(sys.argv) > 1:
        html_file = sys.argv[1]
        print(f"\nExtracting from {html_file}...")
        data = extractor.extract_from_wikipedia_html(html_file)
        if data:
            print(f"Extracted {len(data)} districts")
            for dist, pct in sorted(data.items())[:10]:
                print(f"  {dist}: {pct}%")
