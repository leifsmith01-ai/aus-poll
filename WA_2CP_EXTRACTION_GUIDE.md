# WA State Election 2CP Data Extraction Guide

This guide helps you extract district-level two-candidate preferred (2CP) results from Western Australian state elections for the calibration script.

## Data Sources

### Official WAEC Results
- **2025 Election:** https://www.elections.wa.gov.au/elections/state/2025stateelection
- **2021 Election:** https://www.elections.wa.gov.au/elections/state/2021stateelection
- **2017 Election:** https://www.elections.wa.gov.au/elections/state/2017stateelection

### Wikipedia (Alternative)
- **2021 WA:** https://en.wikipedia.org/wiki/2021_Western_Australian_legislative_assembly_election
  - Look for "Results by electorate" section with a table showing 2CP percentages
- **2017 WA:** https://en.wikipedia.org/wiki/2017_Western_Australian_legislative_assembly_election
  - Similar "Results by electorate" section
- **2025 WA:** https://en.wikipedia.org/wiki/2025_Western_Australian_legislative_assembly_election
  - Check once results are finalized

## What Data to Extract

For each district (electorate), you need:

| District Name | ALP 2CP % |
|---------------|-----------|
| Albany | 44.3 |
| Armadale | 62.5 |
| Ascot | 58.9 |
| ... | ... |

**Key columns to find in Wikipedia results tables:**
- **"Electorate"** or **"Division"** — the district name
- **"ALP %"** or **"Labor %"** — ALP's two-candidate preferred percentage

## Extraction Methods

### Method 1: Manual Copy-Paste (Easiest)

1. Navigate to the Wikipedia page for your target election
2. Find the "Results by electorate" section
3. Look for the table with columns like: Electorate | ALP % | Coalition %
4. Copy the table (select all, Ctrl+C)
5. Paste into a spreadsheet or text file
6. Extract just the Electorate and ALP % columns
7. Use the data entry template in `scripts/wa_2cp_extractor.py`

### Method 2: Save HTML and Use Extractor

1. Save the Wikipedia page as HTML (File → Save As → HTML format)
2. Run:
   ```bash
   python scripts/wa_2cp_extractor.py path/to/saved_wikipedia.html
   ```
3. The script will attempt to parse tables and extract percentages

### Method 3: Use Data Entry Script

1. Open `scripts/wa_2cp_extractor.py` in a text editor
2. Manually fill in the `wa_2021_data`, `wa_2017_data`, `wa_2025_data` dictionaries
3. Run:
   ```bash
   python scripts/wa_2cp_extractor.py
   ```
4. Output saved to `data/wa_2cp_extracted.json`

## Expected Output Format

```python
{
  "2021": {
    "202103": {
      "Albany": 44.3,
      "Armadale": 62.5,
      "Ascot": 58.9,
      # ... all 59 districts
    }
  },
  "2017": {
    "201703": {
      "Albany": 45.1,
      # ...
    }
  },
  "2025": {
    "202503": {
      "Albany": 46.2,
      # ...
    }
  }
}
```

## Key Notes

1. **ALP Percentage Only:** Focus on getting the ALP 2CP percentage. This is the most important metric for calibration.

2. **District Names:** Use the exact names from Wikipedia/WAEC (e.g., "Armadale", not "Armadale (WA)" or variations)

3. **All 59 Districts:** The WA Legislative Assembly has exactly 59 seats. Try to capture all of them.

4. **Format:** Store as floats (e.g., `44.3`, not `"44.3%"` or `44`)

5. **Missing Data:** If some districts don't have 2CP data (e.g., only one candidate nominated), it's okay to skip them. The calibration script will handle gaps gracefully.

## Dictionary Structure in wa_2cp_extractor.py

```python
wa_2021_data = {
    "Albany": 44.3,              # District name -> ALP 2CP %
    "Armadale": 62.5,
    "Ascot": 58.9,
    "Bateman": 50.2,
    # ... continue for all districts
}

extractor.add_election(2021, "202103", wa_2021_data)
```

The election ID is in `YYYYMM` format:
- 2021 election: `"202103"` (March 2021)
- 2017 election: `"201703"` (March 2017)
- 2025 election: `"202503"` (March 2025) — note: actual date TBD

## Verifying Your Data

After extracting, verify:
- ✓ All district names are spelled correctly
- ✓ All percentages are 2CP (two-candidate preferred), not first preferences
- ✓ Percentages are in range 0–100 (sanity check)
- ✓ You have ~59 districts per election
- ✓ JSON is valid (can be parsed without errors)

## Output Files

Once extracted, save to: `data/wa_2cp_extracted.json`

The file will be in JSON format and can be imported into the calibration script.

---

**Questions?** Check the CLAUDE.md file in the project root for more context on the pipeline structure and election data handling.
