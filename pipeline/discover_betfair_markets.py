"""
Betfair market discovery helper for aus-poll.

Run once before each election to find the Betfair market IDs for:
  - The national government-winner market
  - Individual seat-level markets

Output is printed to stdout as a Python dict you can paste into
BETTING_CONFIG["seat_market_ids"] in pipeline/config.py.

Requirements:
    BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN environment variables must be set.

Usage:
    python pipeline/discover_betfair_markets.py
    python pipeline/discover_betfair_markets.py --event "Federal Election"
    python pipeline/discover_betfair_markets.py --list-competitions
    python pipeline/discover_betfair_markets.py --competition-id 6423930

Betfair API authentication:
    1. Create a free Betfair account at betfair.com.au
    2. In My Account → API Access, create an application (free)
       → you get an Application Key (BETFAIR_APP_KEY)
    3. Log in via the API to get a session token:
       POST https://identitysso-cert.betfair.com/api/certlogin
       (requires a client certificate for non-interactive apps)
    4. Or for interactive/dev use, POST:
       https://identitysso.betfair.com/api/login
       with username= and password= form fields
       → response contains sessionToken (BETFAIR_SESSION_TOKEN)
"""

import json
import os
import sys
import argparse

import requests

BETFAIR_BASE_URL = "https://api.betfair.com/exchange/betting/rest/v1.0"


def _headers(app_key: str, session_token: str) -> dict:
    return {
        "X-Application": app_key,
        "X-Authentication": session_token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _post(endpoint: str, body: dict, app_key: str, session_token: str) -> list | dict:
    url = f"{BETFAIR_BASE_URL}/{endpoint}/"
    resp = requests.post(url, json=body, headers=_headers(app_key, session_token), timeout=15)
    resp.raise_for_status()
    return resp.json()


def list_competitions(app_key: str, session_token: str, text_filter: str = "") -> list[dict]:
    """List all competitions matching an optional text filter."""
    body = {
        "filter": {
            "textQuery": text_filter,
            "eventTypeIds": ["2378961"],  # Politics event type ID on Betfair
        } if text_filter else {
            "eventTypeIds": ["2378961"],
        }
    }
    try:
        return _post("listCompetitions", body, app_key, session_token)
    except Exception:
        # Try without filtering by event type (in case the ID differs by locale)
        body = {"filter": {"textQuery": text_filter} if text_filter else {}}
        return _post("listCompetitions", body, app_key, session_token)


def list_markets(
    app_key: str,
    session_token: str,
    competition_id: str | None = None,
    text_filter: str = "",
) -> list[dict]:
    """List available markets for a competition."""
    f: dict = {}
    if competition_id:
        f["competitionIds"] = [competition_id]
    if text_filter:
        f["textQuery"] = text_filter

    body = {
        "filter": f,
        "marketProjection": [
            "MARKET_NAME",
            "RUNNER_DESCRIPTION",
            "COMPETITION",
            "EVENT",
            "MARKET_START_TIME",
        ],
        "maxResults": 500,
        "sort": "VOLUME",
    }
    return _post("listMarketCatalogue", body, app_key, session_token)


def main():
    parser = argparse.ArgumentParser(
        description="Discover Betfair market IDs for Australian federal election betting"
    )
    parser.add_argument(
        "--event",
        default="Australian Federal Election",
        help="Text to search for in market names (default: 'Australian Federal Election')",
    )
    parser.add_argument(
        "--competition-id",
        default=None,
        help="Filter by specific Betfair competition ID",
    )
    parser.add_argument(
        "--list-competitions",
        action="store_true",
        help="List all available Australian politics competitions and exit",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw market catalogue JSON (for debugging)",
    )
    args = parser.parse_args()

    app_key = os.environ.get("BETFAIR_APP_KEY", "")
    session_token = os.environ.get("BETFAIR_SESSION_TOKEN", "")

    if not app_key or not session_token:
        print("ERROR: BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN environment variables required.")
        print()
        print("To get credentials:")
        print("  1. Create a Betfair account at betfair.com.au (free)")
        print("  2. Go to Account → API Access → Create Application Key")
        print("  3. Log in via API:")
        print("     curl -X POST 'https://identitysso.betfair.com/api/login' \\")
        print("       -d 'username=YOUR_EMAIL&password=YOUR_PASSWORD' \\")
        print("       -H 'X-Application: YOUR_APP_KEY' \\")
        print("       -H 'Accept: application/json'")
        print("     → copy 'token' value as BETFAIR_SESSION_TOKEN")
        sys.exit(1)

    if args.list_competitions:
        print("Fetching Australian politics competitions from Betfair...")
        competitions = list_competitions(app_key, session_token, text_filter="Australia")
        if not competitions:
            competitions = list_competitions(app_key, session_token)
        print(f"\nFound {len(competitions)} competitions:\n")
        for comp in sorted(competitions, key=lambda c: c.get("competitionRegion", "") + c.get("competition", {}).get("name", "")):
            c = comp.get("competition", {})
            print(f"  ID: {c.get('id', '?'):<12}  "
                  f"Name: {c.get('name', '?'):<40}  "
                  f"Market count: {comp.get('marketCount', 0)}")
        print("\nRe-run with --competition-id <ID> to list markets for a specific competition.")
        return

    # ── List markets ───────────────────────────────────────────────────────────
    print(f"Searching for markets matching '{args.event}'...")
    markets = list_markets(
        app_key, session_token,
        competition_id=args.competition_id,
        text_filter=args.event,
    )

    if not markets:
        print("No markets found. Try --list-competitions to find the right competition ID.")
        return

    if args.json:
        print(json.dumps(markets, indent=2))
        return

    print(f"\nFound {len(markets)} markets:\n")
    national_id = None
    seat_ids: dict[str, str] = {}

    for m in markets:
        market_id = m.get("marketId", "?")
        market_name = m.get("marketName", "?")
        runners = m.get("runners", [])
        runner_names = [r.get("runnerName", "?") for r in runners]
        start_time = m.get("marketStartTime", "?")[:10] if m.get("marketStartTime") else "?"

        print(f"  {market_id:<16}  {market_name:<50}  Start: {start_time}")
        print(f"    Runners: {', '.join(runner_names[:6])}{' ...' if len(runner_names) > 6 else ''}")

        # Classify: national vs seat-level
        name_lower = market_name.lower()
        if ("majority" in name_lower or "government" in name_lower or
                "next prime minister" in name_lower or "next pm" in name_lower):
            national_id = market_id
            print("    ↑ NATIONAL market")
        else:
            # Treat as a seat market; infer seat name from market name
            seat_name = market_name.strip()
            for suffix in [" - Next MP", " Next MP", " Winner", " - Winner"]:
                seat_name = seat_name.replace(suffix, "").replace(suffix.lower(), "")
            seat_ids[seat_name.strip()] = market_id

    # ── Print config snippet ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("Paste the following into BETTING_CONFIG in pipeline/config.py:")
    print("=" * 70)
    print()
    if national_id:
        print(f'    "national_market_id": "{national_id}",')
    else:
        print('    "national_market_id": "",  # not found — check --list-competitions')
    print('    "seat_market_ids": {')
    for seat, mid in sorted(seat_ids.items()):
        print(f'        "{seat}": "{mid}",')
    print('    },')


if __name__ == "__main__":
    main()
