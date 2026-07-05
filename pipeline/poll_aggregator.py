"""
Poll aggregator for Australian federal election polling data.

Methodology:
  1. Exponential time-decay weighting  (half-life = HALF_LIFE_DAYS)
  2. Iterative house-effect correction (pollster bias removal)
  3. TPP imputation from primary votes when TPP is not reported
  4. Weighted rolling confidence intervals from cross-pollster variance

The output JSON is consumed by the frontend polling tracker.

Usage:
    python -m pipeline.poll_aggregator            # writes data/polls/aggregated.json
    python -m pipeline.poll_aggregator --plot     # also prints ASCII trend summary
"""

from __future__ import annotations

import argparse
import json
import logging
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from pipeline.poll_validation import filter_plausible

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
POLLS_DIR = Path(__file__).parent.parent / "data" / "polls"
INPUT_FILE = POLLS_DIR / "bludgertrack.json"
OUTPUT_FILE = POLLS_DIR / "aggregated.json"

# ── Aggregation parameters ────────────────────────────────────────────────────
HALF_LIFE_DAYS = 90          # Exponential decay half-life (≈3 months) — base value
HALF_LIFE_MIN_DAYS = 14      # Minimum half-life near election day
HOUSE_EFFECT_ITERATIONS = 50 # Max iterations for bias-correction (convergence usually faster)
HOUSE_EFFECT_TOLERANCE = 1e-4 # Stop iterating when max house-effect change < this
MIN_POLLS_FOR_HE = 3         # Minimum polls from a house to estimate its bias
SMOOTHING_WINDOW_DAYS = 14   # Rolling window for trend output points (days either side)
TREND_STEP_DAYS = 7          # Generate one trend point per week
MEDIAN_SAMPLE_SIZE = 1500    # Normalisation base for sample-size weighting
SINGLE_POLLSTER_STD_FLOOR = 2.0  # Minimum std error (pp) when a window holds polls
                                 # from fewer than two distinct pollsters — cross-
                                 # pollster variance is meaningless there, and a
                                 # collapsed 95% band would imply false certainty

# Effective-sample-size / inverse-variance weighting. When True, a poll's weight
# scales linearly with n (variance of a proportion ∝ 1/n, so inverse-variance ∝ n).
# When False, uses sqrt(n) — a gentler scaling that historically avoids letting
# one very large poll dominate. A/B flag so callers can compare aggregate MAE.
USE_INVERSE_VARIANCE_WEIGHTING = False

# ── Adaptive decay ────────────────────────────────────────────────────────────
# Half-life shortens as election day approaches. 365+ days out → full 90-day
# half-life; on election day → 14-day half-life. This makes the polling average
# more responsive in the final months when accuracy matters most.
def adaptive_half_life(days_to_election: float | None = None) -> float:
    """Return adaptive half-life based on proximity to election day."""
    if days_to_election is None or days_to_election >= 365:
        return HALF_LIFE_DAYS
    return max(HALF_LIFE_MIN_DAYS, HALF_LIFE_DAYS * days_to_election / 365)

# ── Advanced Aggregation Scaffolding (Phase 7) ────────────────────────────────

# #10: Bayesian Updating Framework (TODO)
# Scaffold to replace simple exponential decay and iterative house effects
# with a formal state-space model (e.g., Kalman filter or PyMC Bayesian model).
# def update_bayesian_prior(priors: dict, new_polls: list[dict], he_priors: dict) -> dict:
#     \"\"\"
#     Update hidden true-voting-intention state using new poll observations.
#     Returns updated posterior state and dynamically adjusted house biases.
#     \"\"\"
#     pass

# ── Pollster methodology quality tiers ────────────────────────────────────────
# Weight multiplier based on polling methodology. Live-caller polls are more
# accurate (fewer mode effects, better respondent engagement) but more expensive.
# IVR and online panels have known biases that house-effect correction partially
# addresses, but the raw quality difference justifies a small weight adjustment.
#
# Sources: Australian Polling Council methodology disclosures; Jackman (2009)
# "Bayesian Analysis for the Social Sciences"; historical MAE comparison.
POLLSTER_METHODOLOGY = {
    # Tier 1: Large established panels with strong track record in Australian elections.
    # Note: Newspoll was reclassified from "live_phone" to "online_panel" as of 2023.
    # It now uses YouGov's online panel methodology (not live callers). Post-2022
    # research shows online panels have closed the accuracy gap with live-phone polling
    # for Australian federal elections (lower social-desirability bias, larger samples).
    "Newspoll":            "online_panel",  # YouGov online methodology since 2022
    "Roy Morgan":          "mixed_mode",    # SMS + online + phone multi-mode
    # Tier 2: Online panels (established methodology)
    "Essential Research":  "online_panel",
    "YouGov":              "online_panel",
    "Resolve Strategic":   "online_panel",
    "RedBridge Group":     "online_panel",
    "DemosAU":             "online_panel",
    "Freshwater Strategy": "online_panel",
    "Fox & Hedgehog":      "online_panel",
    "Spectre Strategy":    "online_panel",
}

METHODOLOGY_QUALITY_WEIGHT = {
    "live_phone":   1.10,   # Live-phone: still slightly preferred for higher engagement
    "mixed_mode":   1.05,   # Multi-mode: marginal advantage over pure online
    "ivr":          1.00,   # Interactive voice response — adequate
    "online_panel": 1.00,   # Online panels — accuracy comparable to live-phone post-2022
    "unknown":      1.00,   # Default weight for unclassified pollsters
}

def _pollster_quality_weight(poll: dict) -> float:
    """Return methodology quality weight for a poll's pollster."""
    pollster = poll.get("pollster", "")
    methodology = POLLSTER_METHODOLOGY.get(pollster, "unknown")
    return METHODOLOGY_QUALITY_WEIGHT.get(methodology, 1.0)

# ── Standard preference flows for TPP imputation ─────────────────────────────
# Based on observed flows at the 2025 federal election (AEC DOP data).
# These convert primary votes → estimated ALP 2PP when TPP is not reported.
# Historical context (for reference):
#   2022 AEC: grn_alp=0.857, teal_alp=0.735, on_alp=0.357, other_alp=0.574
#   2025 AEC: grn_alp=0.810, teal_alp=0.620, on_alp=0.255, other_alp=0.500
# One Nation → ALP flow by federal election (AEC DOP; Antony Green): 2016 ~0.496,
# 2019 0.347, 2022 0.357, 2025 0.255 (74.5% to the Coalition — the highest-ever
# flow to the Coalition). A rising ON primary therefore favours the Coalition.
# Note: teal_alp is tracked separately here to match the frontend model. When
# poll data does not break out teal/IND separately, teal votes are included in
# the "other" residual and flow at the other_alp rate.
DEFAULT_PREF_FLOWS = {
    "grn_alp":   0.810,  # Greens → ALP (2025 AEC DOP: 81.0%)
    "teal_alp":  0.620,  # Teal/IND → ALP (2025 AEC DOP: 62.0%)
    "on_alp":    0.255,  # One Nation → ALP (2025 AEC DOP: 25.5%)
    "other_alp": 0.500,  # Other minor parties → ALP (2025 AEC DOP: 50.0%)
}

# Parties tracked individually in the poll data; "other" is the residual.
# Teal is now tracked separately when poll data includes it, enabling more
# accurate 2PP imputation for teal-seat-heavy scenarios.
PRIMARY_PARTIES = ["alp", "coal", "grn", "on", "teal"]

# ── VIC state election preference flows ───────────────────────────────────────
# Victorian state elections use full preferential voting. Preference flows are
# more predictable than federally due to the absence of optional preferential.
# Sources: VEC DOP data (2018, 2022); Antony Green election commentary.
VIC_PREF_FLOWS = {
    "grn_alp":   0.850,  # Greens → ALP (VEC 2022: ~85% in GRN→ALP seats)
    "ind_alp":   0.600,  # Independents → ALP (varies strongly by seat)
    "on_alp":    0.250,  # One Nation → ALP (VEC 2022: ~25%)
    "other_alp": 0.430,  # Other minor parties → ALP (VEC 2022: ~43%)
}

# VIC primary parties tracked (no "teal" in VIC — independents tracked as "ind")
VIC_PRIMARY_PARTIES = ["alp", "lp", "grn", "ind", "on"]

# VIC state poll input file
VIC_POLLS_FILE = POLLS_DIR / "vic_polls.json"
VIC_OUTPUT_FILE = POLLS_DIR / "vic_aggregated.json"

# ── NSW state election preference flows ───────────────────────────────────────
# NSW uses full compulsory preferential voting. Flows based on NSWEC 2023 DOP.
NSW_PREF_FLOWS = {
    "grn_alp":   0.880,  # Greens → ALP (NSWEC 2023: statewide avg ~88%)
    "ind_alp":   0.550,  # Independents → ALP (varies; suburban independents ~55%)
    "on_alp":    0.200,  # One Nation → ALP (NSWEC 2023: ~20%)
    "other_alp": 0.450,  # Other minor parties → ALP
}
NSW_PRIMARY_PARTIES = ["alp", "lp", "np", "grn", "ind", "on"]
NSW_POLLS_FILE  = POLLS_DIR / "nsw_polls.json"
NSW_OUTPUT_FILE = POLLS_DIR / "nsw_aggregated.json"

# ── QLD state election preference flows ───────────────────────────────────────
# QLD uses full compulsory preferential voting. Flows based on ECQ 2024 DOP.
QLD_PREF_FLOWS = {
    "grn_alp":   0.820,  # Greens → ALP (ECQ 2024: statewide avg ~82%)
    "ind_alp":   0.500,  # Independents → ALP
    "on_alp":    0.180,  # One Nation → ALP (ECQ 2024: ~18%)
    "other_alp": 0.400,  # Other minor parties → ALP
}
QLD_PRIMARY_PARTIES = ["alp", "lnp", "grn", "ind", "on"]
QLD_POLLS_FILE  = POLLS_DIR / "qld_polls.json"
QLD_OUTPUT_FILE = POLLS_DIR / "qld_aggregated.json"

# ── WA state election preference flows ────────────────────────────────────────
# WA uses full compulsory preferential voting. Provisional defaults from WAEC
# 2025 DOP — revisit once 2029-cycle polling and DOP data accumulate.
WA_PREF_FLOWS = {
    "grn_alp":   0.860,  # Greens → ALP (WAEC 2025 DOP: ~86%)
    "ind_alp":   0.580,  # Independents → ALP
    "on_alp":    0.220,  # One Nation → ALP (WAEC 2025 DOP: ~22%)
    "other_alp": 0.440,  # Other minor parties → ALP
}
WA_PRIMARY_PARTIES = ["alp", "lp", "nat", "grn", "ind", "on"]
WA_POLLS_FILE  = POLLS_DIR / "wa_polls.json"
WA_OUTPUT_FILE = POLLS_DIR / "wa_aggregated.json"

# ── SA state election preference flows ────────────────────────────────────────
# SA uses full compulsory preferential voting. Provisional defaults from the
# ECSA 2026 provisional count — refresh at the final declaration.
SA_PREF_FLOWS = {
    "grn_alp":   0.840,  # Greens → ALP (ECSA 2026 provisional: ~84%)
    "ind_alp":   0.520,  # Independents → ALP
    "on_alp":    0.220,  # One Nation → ALP
    "other_alp": 0.450,  # Other minor parties → ALP
}
SA_PRIMARY_PARTIES = ["alp", "lp", "grn", "ind", "on"]
SA_POLLS_FILE  = POLLS_DIR / "sa_polls.json"
SA_OUTPUT_FILE = POLLS_DIR / "sa_aggregated.json"

# Registry of supported state aggregations. "coal_keys" lists every Coalition
# component key in the polls file — TPP imputation sums them, so the junior
# partner (NSW 'np', WA 'nat') counts as Coalition rather than falling into
# the "other" residual at other_alp's ~45% ALP flow.
STATE_AGGREGATION_REGISTRY = {
    "vic": {
        "polls_file":    VIC_POLLS_FILE,
        "output_file":   VIC_OUTPUT_FILE,
        "pref_flows":    VIC_PREF_FLOWS,
        "primary_parties": VIC_PRIMARY_PARTIES,
        "coal_keys":     ["lp"],
    },
    "nsw": {
        "polls_file":    NSW_POLLS_FILE,
        "output_file":   NSW_OUTPUT_FILE,
        "pref_flows":    NSW_PREF_FLOWS,
        "primary_parties": NSW_PRIMARY_PARTIES,
        "coal_keys":     ["lp", "np"],
    },
    "qld": {
        "polls_file":    QLD_POLLS_FILE,
        "output_file":   QLD_OUTPUT_FILE,
        "pref_flows":    QLD_PREF_FLOWS,
        "primary_parties": QLD_PRIMARY_PARTIES,
        "coal_keys":     ["lnp"],
    },
    "wa": {
        "polls_file":    WA_POLLS_FILE,
        "output_file":   WA_OUTPUT_FILE,
        "pref_flows":    WA_PREF_FLOWS,
        "primary_parties": WA_PRIMARY_PARTIES,
        "coal_keys":     ["lp", "nat"],
    },
    "sa": {
        "polls_file":    SA_POLLS_FILE,
        "output_file":   SA_OUTPUT_FILE,
        "pref_flows":    SA_PREF_FLOWS,
        "primary_parties": SA_PRIMARY_PARTIES,
        "coal_keys":     ["lp"],
    },
}


def _impute_vic_tpp(poll: dict, flows: dict = VIC_PREF_FLOWS) -> Optional[float]:
    """
    Estimate ALP 2PP from VIC state primary votes when TPP not reported.

    VIC state polls use 'lp' (not 'coal') for the Liberal party.
    'ind' covers all independents and micro-parties not tracked separately.
    """
    alp = poll.get("alp")
    lp  = poll.get("lp")
    grn = poll.get("grn")
    if any(v is None for v in [alp, lp, grn]):
        return None

    ind   = poll.get("ind", 0.0) or 0.0
    on    = poll.get("on",  0.0) or 0.0
    other = max(0.0, 100.0 - alp - lp - grn - ind - on)

    alp_tcp = (
        alp
        + grn   * flows["grn_alp"]
        + ind   * flows["ind_alp"]
        + on    * flows["on_alp"]
        + other * flows["other_alp"]
    )
    coal_tcp = (
        lp
        + grn   * (1 - flows["grn_alp"])
        + ind   * (1 - flows["ind_alp"])
        + on    * (1 - flows["on_alp"])
        + other * (1 - flows["other_alp"])
    )
    total = alp_tcp + coal_tcp
    if total <= 0:
        return None
    return round(alp_tcp / total * 100, 2)


def run_vic(
    input_path: Path = VIC_POLLS_FILE,
    output_path: Path = VIC_OUTPUT_FILE,
    verbose: bool = False,
) -> dict:
    """
    VIC state poll aggregation pipeline.

    Mirrors the federal run() but uses VIC-specific:
      - Party keys: alp, lp (not coal), grn, ind, on
      - Preference flows from VIC_PREF_FLOWS
      - Input file: data/polls/vic_polls.json
      - Output file: data/polls/vic_aggregated.json

    Steps: load → impute TPP → compute house effects → build trend → write.
    """
    # Library functions adjust only their own logger level; root logging is
    # configured by the entry point (main.py's setup_logging, or __main__ below).
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)

    if not input_path.exists():
        logger.error("VIC polls file not found: %s", input_path)
        return {}

    with open(input_path, encoding="utf-8") as f:
        raw = json.load(f)

    polls = raw.get("polls", [])
    logger.info("Loaded %d VIC polls from %s", len(polls), input_path)

    if not polls:
        logger.warning("No VIC polls to aggregate.")
        return {}

    n_before = len(polls)
    polls = filter_plausible(polls, kind="state", logger=logger)
    if len(polls) < n_before:
        logger.warning("Dropped %d implausible VIC poll record(s)", n_before - len(polls))
    if not polls:
        logger.warning("No plausible VIC polls to aggregate.")
        return {}

    election_day = _election_day_from(raw)

    # Impute TPP where missing
    n_imputed = 0
    for p in polls:
        if p.get("tpp") is None:
            imputed = _impute_vic_tpp(p)
            if imputed is not None:
                p["tpp_imputed"] = imputed
                n_imputed += 1
        else:
            p["tpp_imputed"] = None
    for p in polls:
        p["tpp_eff"] = p.get("tpp") if p.get("tpp") is not None else p.get("tpp_imputed")

    logger.info("Imputed VIC TPP for %d polls", n_imputed)

    poll_dates = [date.fromisoformat(p["date"]) for p in polls]
    ref_date   = max(poll_dates)
    metrics    = ["alp", "lp", "grn", "ind", "on", "tpp_eff"]

    logger.info("Computing VIC house effects (ref date: %s) ...", ref_date)
    house_effects: dict[str, dict[str, float]] = {}
    for metric in metrics:
        he = compute_house_effects(polls, metric, ref_date, election_day=election_day)
        house_effects[metric] = he

    first_date = min(poll_dates)
    logger.info("Building VIC trend %s → %s ...", first_date, ref_date)
    trend = build_trend(polls, house_effects, metrics, first_date, ref_date,
                        election_day=election_day)

    current_window = 60
    current: dict = {}
    for metric in metrics:
        he = house_effects.get(metric, {})
        result = aggregate_at_date(polls, ref_date, he, metric,
                                   window_days=current_window, election_day=election_day)
        current[metric] = result

    he_summary: dict[str, dict] = {}
    he_converged: dict[str, bool] = {}
    for metric, he in house_effects.items():
        pollsters_only = {k: v for k, v in he.items() if not k.startswith("__")}
        he_converged[metric] = bool(he.get("__converged", False))
        he_summary[metric] = {
            k: v for k, v in sorted(pollsters_only.items(), key=lambda x: -abs(x[1]))
        }

    output = {
        "generated":   ref_date.isoformat(),
        "jurisdiction": raw.get("jurisdiction", "vic_state"),
        "election_date": raw.get("election_date"),
        "source":      raw.get("source"),
        "methodology": {
            "half_life_days":        HALF_LIFE_DAYS,
            "smoothing_window_days": SMOOTHING_WINDOW_DAYS,
            "trend_step_days":       TREND_STEP_DAYS,
            "tpp_pref_flows":        VIC_PREF_FLOWS,
            "note": "VIC state elections use full preferential voting. "
                    "Party key 'lp' = Liberal (not 'coal'). "
                    "'ind' = all independents tracked as a group.",
        },
        "house_effects":          he_summary,
        "house_effect_converged": he_converged,
        "current":       current,
        "trend":         trend,
        "polls":         polls,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    logger.info("Wrote VIC aggregated polls → %s", output_path)

    return output


def _impute_state_tpp(poll: dict, pref_flows: dict,
                      coal_keys: list[str] | None = None) -> Optional[float]:
    """
    Estimate ALP 2PP from state primary votes when TPP not reported.

    Generalised version of _impute_vic_tpp for any state. Uses the state's
    pref_flows and its Coalition component keys, summed — ['lp'] for VIC/SA,
    ['lp', 'np'] for NSW, ['lnp'] for QLD, ['lp', 'nat'] for WA. The senior
    partner (first key) must be reported; a missing junior-partner column
    counts as 0 (many polls fold it into the Liberal figure or "other").
    """
    if coal_keys is None:
        coal_keys = ["lp"]
    alp  = poll.get("alp")
    grn  = poll.get("grn")
    if any(v is None for v in [alp, poll.get(coal_keys[0]), grn]):
        return None
    coal = sum(poll.get(k) or 0.0 for k in coal_keys)

    ind   = poll.get("ind",  0.0) or 0.0
    on    = poll.get("on",   0.0) or 0.0
    other = max(0.0, 100.0 - alp - coal - grn - ind - on)

    alp_tcp = (
        alp
        + grn   * pref_flows["grn_alp"]
        + ind   * pref_flows["ind_alp"]
        + on    * pref_flows["on_alp"]
        + other * pref_flows["other_alp"]
    )
    coal_tcp = (
        coal
        + grn   * (1 - pref_flows["grn_alp"])
        + ind   * (1 - pref_flows["ind_alp"])
        + on    * (1 - pref_flows["on_alp"])
        + other * (1 - pref_flows["other_alp"])
    )
    total = alp_tcp + coal_tcp
    if total <= 0:
        return None
    return round(alp_tcp / total * 100, 2)


def run_state(
    state: str,
    input_path: Path = None,
    output_path: Path = None,
    verbose: bool = False,
) -> dict:
    """
    State poll aggregation pipeline (NSW, QLD, and other registered states).

    Mirrors run_vic() but is parameterised by the state registry entry so the
    same logic covers any state with a polls JSON file.

    Usage:
        python -m pipeline.poll_aggregator --state nsw
        python -m pipeline.poll_aggregator --state qld
    """
    # Library functions adjust only their own logger level; root logging is
    # configured by the entry point (main.py's setup_logging, or __main__ below).
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)

    cfg = STATE_AGGREGATION_REGISTRY.get(state.lower())
    if cfg is None:
        logger.error("No aggregation config for state '%s'. Supported: %s",
                     state, list(STATE_AGGREGATION_REGISTRY))
        return {}

    in_path  = input_path  or cfg["polls_file"]
    out_path = output_path or cfg["output_file"]
    pref_flows = cfg["pref_flows"]
    coal_keys  = cfg["coal_keys"]
    primary_parties = cfg["primary_parties"]

    if not in_path.exists():
        logger.error("%s polls file not found: %s", state.upper(), in_path)
        return {}

    with open(in_path, encoding="utf-8") as f:
        raw = json.load(f)

    polls = raw.get("polls", [])
    logger.info("Loaded %d %s polls from %s", len(polls), state.upper(), in_path)

    if not polls:
        logger.warning("No %s polls to aggregate.", state.upper())
        return {}

    n_before = len(polls)
    polls = filter_plausible(polls, kind="state", logger=logger)
    if len(polls) < n_before:
        logger.warning("Dropped %d implausible %s poll record(s)",
                       n_before - len(polls), state.upper())
    if not polls:
        logger.warning("No plausible %s polls to aggregate.", state.upper())
        return {}

    election_day = _election_day_from(raw)

    # Impute TPP where missing
    n_imputed = 0
    for p in polls:
        if p.get("tpp") is None:
            imputed = _impute_state_tpp(p, pref_flows, coal_keys)
            if imputed is not None:
                p["tpp_imputed"] = imputed
                n_imputed += 1
        else:
            p["tpp_imputed"] = None
    for p in polls:
        p["tpp_eff"] = p.get("tpp") if p.get("tpp") is not None else p.get("tpp_imputed")

    logger.info("Imputed %s TPP for %d polls", state.upper(), n_imputed)

    metrics = primary_parties + ["tpp_eff"]
    for p in polls:
        for m in metrics:
            if p.get(m) is None and m not in ("tpp_eff",):
                p[m] = None  # ensure key present for house-effect computation

    poll_dates = [date.fromisoformat(p["date"]) for p in polls]
    ref_date   = max(poll_dates)

    house_effects: dict = {}
    for metric in metrics:
        house_effects[metric] = compute_house_effects(polls, metric, ref_date,
                                                      election_day=election_day)

    first_date = min(poll_dates)
    logger.info("Building %s trend %s → %s ...", state.upper(), first_date, ref_date)
    trend = build_trend(polls, house_effects, metrics, first_date, ref_date,
                        election_day=election_day)

    current_window = 60
    current: dict = {}
    for metric in metrics:
        he = house_effects.get(metric, {})
        result = aggregate_at_date(polls, ref_date, he, metric,
                                   window_days=current_window, election_day=election_day)
        current[metric] = result

    he_summary: dict[str, dict] = {}
    he_converged: dict[str, bool] = {}
    for metric, he in house_effects.items():
        pollsters_only = {k: v for k, v in he.items() if not k.startswith("__")}
        he_converged[metric] = bool(he.get("__converged", False))
        he_summary[metric] = {
            k: v for k, v in sorted(pollsters_only.items(), key=lambda x: -abs(x[1]))
        }

    output = {
        "generated":   ref_date.isoformat(),
        "jurisdiction": raw.get("jurisdiction", f"{state.lower()}_state"),
        "election_date": raw.get("election_date"),
        "source":      raw.get("source"),
        "methodology": {
            "half_life_days":        HALF_LIFE_DAYS,
            "smoothing_window_days": SMOOTHING_WINDOW_DAYS,
            "trend_step_days":       TREND_STEP_DAYS,
            "tpp_pref_flows":        pref_flows,
            "coalition_keys":        coal_keys,
        },
        "house_effects":          he_summary,
        "house_effect_converged": he_converged,
        "current":       current,
        "trend":         trend,
        "polls":         polls,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    logger.info("Wrote %s aggregated polls → %s", state.upper(), out_path)

    return output


def _election_day_from(raw: dict) -> date | None:
    """Parse an ISO election_date field from a polls file header, or None."""
    ed = raw.get("election_date")
    if not ed:
        return None
    try:
        return date.fromisoformat(ed)
    except (TypeError, ValueError):
        logger.warning("Unparseable election_date %r — using fixed half-life", ed)
        return None


def _decay_weight(
    days_ago: float,
    half_life: float = HALF_LIFE_DAYS,
    days_to_election: float | None = None,
) -> float:
    """Return exponential decay weight for a poll published `days_ago` days ago.

    If `days_to_election` is provided, uses the adaptive half-life that
    shortens closer to election day for more responsive tracking.
    """
    hl = adaptive_half_life(days_to_election) if days_to_election is not None else half_life
    lam = math.log(2) / hl
    return math.exp(-lam * days_ago)


def _impute_tpp(poll: dict, flows: dict = DEFAULT_PREF_FLOWS) -> Optional[float]:
    """
    Estimate ALP 2PP from primary votes when TPP is not reported.

    When teal is reported separately, uses teal_alp flow rate;
    otherwise teal votes are rolled into "other" and flow at other_alp rate.
    Returns None if primary data is incomplete.
    """
    alp  = poll.get("alp")
    coal = poll.get("coal")
    grn  = poll.get("grn")
    on   = poll.get("on")
    if any(v is None for v in [alp, coal, grn, on]):
        return None

    # Teal tracked separately when poll data includes it
    teal = poll.get("teal", 0.0) or 0.0
    other = max(0.0, 100.0 - alp - coal - grn - on - teal)

    alp_tcp = (
        alp
        + grn   * flows["grn_alp"]
        + teal  * flows["teal_alp"]    # explicit teal flow when tracked
        + other * flows["other_alp"]   # remaining IND/minor rolled into "other"
        + on    * flows["on_alp"]
    )
    coal_tcp = (
        coal
        + grn   * (1 - flows["grn_alp"])
        + teal  * (1 - flows["teal_alp"])
        + other * (1 - flows["other_alp"])
        + on    * (1 - flows["on_alp"])
    )
    total = alp_tcp + coal_tcp
    if total <= 0:
        return None
    return round(alp_tcp / total * 100, 2)


def _weighted_mean(values: list[float], weights: list[float]) -> float:
    total_w = sum(weights)
    if total_w == 0:
        return float("nan")
    return sum(v * w for v, w in zip(values, weights)) / total_w


def _weighted_variance(values: list[float], weights: list[float], mean: float) -> float:
    total_w = sum(weights)
    if total_w == 0:
        return float("nan")
    return sum(w * (v - mean) ** 2 for v, w in zip(values, weights)) / total_w


def _sample_weight(poll: dict, median_n: float = MEDIAN_SAMPLE_SIZE) -> float:
    """Return a sample-size scaling factor.

    With USE_INVERSE_VARIANCE_WEIGHTING=True, returns n / median_n (linear in
    effective sample size — inverse-variance for a binomial proportion).
    Otherwise returns sqrt(n / median_n). Returns 1.0 if n is unknown.
    """
    n = poll.get("n")
    if n and n > 0:
        ratio = n / median_n
        return ratio if USE_INVERSE_VARIANCE_WEIGHTING else math.sqrt(ratio)
    return 1.0


def _combined_weight(
    poll: dict,
    days_ago: float,
    half_life: float = HALF_LIFE_DAYS,
    days_to_election: float | None = None,
) -> float:
    """Compute the combined weighting for a poll.

    Combines three factors:
      1. Exponential time-decay (adaptive if days_to_election given)
      2. Sample-size scaling (sqrt(n/median_n) or n/median_n — see USE_INVERSE_VARIANCE_WEIGHTING)
      3. Methodology quality tier: live_phone > mixed > online_panel

    Returns the product of all three weights.
    """
    decay = _decay_weight(days_ago, half_life, days_to_election)
    size  = _sample_weight(poll)
    quality = _pollster_quality_weight(poll)
    return decay * size * quality


def compute_house_effects(
    polls: list[dict],
    metric: str,
    ref_date: date,
    iterations: int = HOUSE_EFFECT_ITERATIONS,
    tolerance: float = HOUSE_EFFECT_TOLERANCE,
    min_polls: int = MIN_POLLS_FOR_HE,
    election_day: date | None = None,
) -> dict[str, float]:
    """
    Iterative house-effect (pollster bias) correction.

    Algorithm:
      1. Compute an initial decay+sample-size-weighted national mean for `metric`.
      2. For each pollster, compute their weighted-mean deviation from the national mean.
      3. Subtract house effects from each poll and recompute national mean.
      4. Repeat until convergence (max house-effect change < `tolerance`) or `iterations`.

    Weights combine exponential time-decay with sqrt(n/median_n) sample-size scaling.

    Returns a dict of {pollster: bias} where a positive bias means the pollster
    shows higher values for `metric` than the consensus. The returned dict also
    carries a `__converged` key (True/False) so callers can flag non-convergence
    in their output. (Ordinary pollster names never start with `__`.)
    """
    valid = [p for p in polls if p.get(metric) is not None]
    if not valid:
        return {}

    # Adaptive decay: when the election date is known, the half-life shortens
    # as it approaches (see adaptive_half_life). None keeps the fixed default.
    days_to_election = max(0, (election_day - ref_date).days) if election_day else None

    house_effects: dict[str, float] = {}
    converged = False
    last_max_change = float("inf")

    for iteration in range(iterations):
        # Compute decay+size-weighted mean after subtracting current house effects
        values, weights = [], []
        for p in valid:
            days_ago = (ref_date - date.fromisoformat(p["date"])).days
            if days_ago < 0:
                continue
            he = house_effects.get(p["pollster"], 0.0)
            values.append(p[metric] - he)
            weights.append(_combined_weight(p, days_ago, days_to_election=days_to_election))

        nat_mean = _weighted_mean(values, weights)
        if math.isnan(nat_mean):
            break

        # Update house effects: weighted mean residual per pollster
        pollster_residuals: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for p in valid:
            days_ago = (ref_date - date.fromisoformat(p["date"])).days
            if days_ago < 0:
                continue
            he = house_effects.get(p["pollster"], 0.0)
            residual = (p[metric] - he) - nat_mean
            pollster_residuals[p["pollster"]].append(
                (residual, _combined_weight(p, days_ago, days_to_election=days_to_election))
            )

        max_change = 0.0
        for pollster, res_weights in pollster_residuals.items():
            if len(res_weights) < min_polls:
                continue
            vals, wts = zip(*res_weights)
            delta = _weighted_mean(list(vals), list(wts))
            house_effects[pollster] = house_effects.get(pollster, 0.0) + delta
            max_change = max(max_change, abs(delta))

        last_max_change = max_change
        if max_change < tolerance:
            converged = True
            break

    if not converged:
        logger.warning(
            "House-effect correction did not converge for metric %s after %d "
            "iterations (last max change = %.4g, tolerance = %.4g). Consider "
            "raising HOUSE_EFFECT_ITERATIONS or widening MIN_POLLS_FOR_HE.",
            metric, iterations, last_max_change, tolerance,
        )

    result: dict[str, float] = {k: round(v, 3) for k, v in house_effects.items()}
    # Carry a non-numeric convergence flag alongside the pollster entries so
    # callers can surface it in the aggregated output. Pollster names in
    # practice never start with `__`, so this namespace collision is safe.
    result["__converged"] = converged
    return result


def aggregate_at_date(
    polls: list[dict],
    target_date: date,
    house_effects: dict[str, float],
    metric: str,
    window_days: int = SMOOTHING_WINDOW_DAYS,
    election_day: date | None = None,
) -> Optional[dict]:
    """
    Compute the weighted aggregate for `metric` at `target_date`.

    Only polls within `window_days` either side of `target_date` are used
    (but future polls relative to target_date are excluded for temporal integrity).
    Only polls within `window_days` before `target_date` contribute.
    Returns dict with mean, std_error, 95% CI bounds, and poll count.
    """
    window_start = target_date - timedelta(days=window_days)
    relevant = [
        p for p in polls
        if p.get(metric) is not None
        and window_start <= date.fromisoformat(p["date"]) <= target_date
    ]
    if not relevant:
        return None

    days_to_election = max(0, (election_day - target_date).days) if election_day else None

    values, weights = [], []
    for p in relevant:
        days_ago = (target_date - date.fromisoformat(p["date"])).days
        he = house_effects.get(p["pollster"], 0.0)
        adjusted = p[metric] - he
        values.append(adjusted)
        weights.append(_combined_weight(p, days_ago, days_to_election=days_to_election))

    mean = _weighted_mean(values, weights)
    variance = _weighted_variance(values, weights, mean)
    std = math.sqrt(variance) if variance >= 0 else 0.0

    # Effective sample size for standard error calculation
    total_w = sum(weights)
    sum_w2  = sum(w ** 2 for w in weights)
    n_eff   = (total_w ** 2 / sum_w2) if sum_w2 > 0 else 1.0

    std_err = std / math.sqrt(n_eff) if n_eff > 0 else std
    # Cross-pollster variance is meaningless when the window holds a single
    # poll (or duplicate rows of the same poll); floor the error so the 95%
    # band never collapses to a point.
    if len({p.get("pollster") for p in relevant}) < 2:
        std_err = max(std_err, SINGLE_POLLSTER_STD_FLOOR)
    margin  = 1.96 * std_err

    return {
        "mean":   round(mean, 2),
        "lo95":   round(mean - margin, 2),
        "hi95":   round(mean + margin, 2),
        "std":    round(std, 2),
        "n":      len(relevant),
        "n_eff":  round(n_eff, 1),
    }


def build_trend(
    polls: list[dict],
    house_effects: dict[str, dict[str, float]],
    metrics: list[str],
    first_date: date,
    last_date: date,
    step_days: int = TREND_STEP_DAYS,
    window_days: int = SMOOTHING_WINDOW_DAYS,
    election_day: date | None = None,
) -> list[dict]:
    """
    Build a weekly trend series from `first_date` to `last_date`.
    Each point contains house-effect-corrected weighted aggregates and 95% CIs.
    """
    trend = []
    current = first_date
    while current <= last_date:
        point: dict = {"date": current.isoformat()}
        has_data = False
        for metric in metrics:
            he = house_effects.get(metric, {})
            result = aggregate_at_date(polls, current, he, metric, window_days,
                                       election_day=election_day)
            if result:
                point[metric] = result
                has_data = True
            else:
                point[metric] = None
        if has_data:
            trend.append(point)
        current += timedelta(days=step_days)
    return trend


def compute_state_swings(
    polls: list[dict],
    national_house_effects: dict[str, dict[str, float]],
    ref_date: date,
    window_days: int = 60,
) -> dict[str, dict]:
    """
    Compute state-level TPP deviations from the national aggregate.

    For each state that has at least MIN_POLLS_FOR_HE polls with scope=<STATE>,
    computes the state-level weighted aggregate TPP and returns the deviation
    from the national aggregate as the state swing differential.

    Returns:
        Dict mapping state code (e.g. "NSW") to:
          { "tpp_mean", "tpp_lo95", "tpp_hi95", "deviation_from_national", "n" }

    When no state polls are available, returns an empty dict.
    This is a framework for when state-level polling data becomes available
    (e.g. YouGov MRP sub-national estimates, state-specific ReachTEL polls).

    To add state polls, include entries in bludgertrack.json with scope="NSW" etc.
    and a tpp or alp/coal/grn/on fields for that state. The aggregator will then
    compute the deviation from national and populate this field automatically.
    """
    STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]
    result = {}

    # National TPP at ref_date for computing deviations — from nationally-scoped
    # polls only, so state rows never contaminate their own baseline.
    nat_polls = [p for p in polls
                 if (p.get("scope") or "NAT").upper() in ("NAT", "NATIONAL", "AUS")]
    nat_he = national_house_effects.get("tpp_eff", {})
    nat_agg = aggregate_at_date(nat_polls, ref_date, nat_he, "tpp_eff", window_days)
    if nat_agg is None:
        return {}
    national_mean = nat_agg["mean"]

    for state in STATES:
        state_polls = [p for p in polls if p.get("scope", "NAT").upper() == state]
        if len(state_polls) < MIN_POLLS_FOR_HE:
            continue

        # For state polls, augment with tpp_eff (same imputation as national)
        for p in state_polls:
            if p.get("tpp_eff") is None:
                p["tpp_eff"] = p.get("tpp") if p.get("tpp") is not None else _impute_tpp(p)

        # State-level house effects (computed within state poll sample)
        state_he = compute_house_effects(state_polls, "tpp_eff", ref_date)
        agg = aggregate_at_date(state_polls, ref_date, state_he, "tpp_eff", window_days)
        if agg is None:
            continue

        result[state] = {
            "tpp_mean": agg["mean"],
            "tpp_lo95": agg["lo95"],
            "tpp_hi95": agg["hi95"],
            "deviation_from_national": round(agg["mean"] - national_mean, 2),
            "n": agg["n"],
        }
        logger.info("State %s: TPP=%.1f%% (deviation=%.1fpp from national)", state, agg["mean"], agg["mean"] - national_mean)

    return result


def run(
    input_path: Path = INPUT_FILE,
    output_path: Path = OUTPUT_FILE,
    verbose: bool = False,
) -> dict:
    """
    Main aggregation pipeline.

    Steps:
      1. Load raw poll data.
      2. Impute missing TPP from primaries.
      3. Compute house effects for each primary metric and TPP.
      4. Build weekly trend series with 95% CIs.
      5. Compute current (most-recent-window) aggregate.
      6. Write output JSON.
    """
    # Library functions adjust only their own logger level; root logging is
    # configured by the entry point (main.py's setup_logging, or __main__ below).
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)

    with open(input_path, encoding="utf-8") as f:
        raw = json.load(f)

    polls = raw["polls"]
    logger.info("Loaded %d polls from %s", len(polls), input_path)

    # Defensive gate: drop implausible rows (mis-parsed scraper output) so a
    # bad record already in the file cannot distort the aggregate.
    n_before = len(polls)
    polls = filter_plausible(polls, kind="federal", logger=logger)
    if len(polls) < n_before:
        logger.warning("Dropped %d implausible poll record(s)", n_before - len(polls))

    election_day = _election_day_from(raw)

    # Step 1: Impute TPP where missing
    n_imputed = 0
    for p in polls:
        if p.get("tpp") is None:
            imputed = _impute_tpp(p)
            if imputed is not None:
                p["tpp_imputed"] = imputed
                n_imputed += 1
        else:
            p["tpp_imputed"] = None  # use actual
    logger.info("Imputed TPP for %d polls (of %d missing)", n_imputed,
                sum(1 for p in polls if p.get("tpp") is None))

    # Augment polls: create a "tpp_eff" field = tpp if reported, else tpp_imputed
    for p in polls:
        p["tpp_eff"] = p.get("tpp") if p.get("tpp") is not None else p.get("tpp_imputed")

    # National aggregates must only use nationally-scoped polls; state-subsample
    # rows (scope="NSW" etc., invited by compute_state_swings) would otherwise
    # bias the national house effects and trend toward over-polled states.
    nat_polls = [p for p in polls
                 if (p.get("scope") or "NAT").upper() in ("NAT", "NATIONAL", "AUS")]
    if len(nat_polls) < len(polls):
        logger.info("Using %d national polls for the national aggregate "
                    "(%d state-scoped rows reserved for state swings)",
                    len(nat_polls), len(polls) - len(nat_polls))

    # Step 2: Compute house effects for each metric
    poll_dates = [date.fromisoformat(p["date"]) for p in nat_polls]
    ref_date   = max(poll_dates)
    metrics    = ["alp", "coal", "grn", "on", "teal", "tpp_eff"]

    logger.info("Computing house effects (ref date: %s) ...", ref_date)
    house_effects: dict[str, dict[str, float]] = {}
    for metric in metrics:
        he = compute_house_effects(nat_polls, metric, ref_date, election_day=election_day)
        house_effects[metric] = he
        if he:
            logger.debug("House effects for %s: %s", metric, he)

    # Step 3: Build weekly trend
    first_date = min(poll_dates)
    logger.info("Building trend from %s to %s (step=%d days, window=%d days) ...",
                first_date, ref_date, TREND_STEP_DAYS, SMOOTHING_WINDOW_DAYS)
    trend = build_trend(nat_polls, house_effects, metrics, first_date, ref_date,
                        election_day=election_day)
    logger.info("Built %d trend points", len(trend))

    # Step 4: Compute current aggregate (last 60 days)
    current_window = 60
    current: dict = {}
    for metric in metrics:
        he = house_effects.get(metric, {})
        result = aggregate_at_date(nat_polls, ref_date, he, metric,
                                   window_days=current_window, election_day=election_day)
        current[metric] = result
    logger.info("Current aggregate (last %d days): TPP=%.1f%% [%.1f-%.1f]",
                current_window,
                current.get("tpp_eff", {}).get("mean", float("nan")),
                current.get("tpp_eff", {}).get("lo95", float("nan")),
                current.get("tpp_eff", {}).get("hi95", float("nan")))

    # Step 5: Summarise house effects for output. Pop the __converged sentinel
    # out of each metric's dict into a parallel convergence map so consumers
    # can see per-metric convergence status without numeric sentinel pollution.
    he_summary: dict[str, dict] = {}
    he_converged: dict[str, bool] = {}
    for metric, he in house_effects.items():
        pollsters_only = {k: v for k, v in he.items() if not k.startswith("__")}
        he_converged[metric] = bool(he.get("__converged", False))
        he_summary[metric] = {
            k: v for k, v in sorted(pollsters_only.items(), key=lambda x: -abs(x[1]))
        }

    # Step 5b: State-level swing deviations (populated when state polls are present)
    logger.info("Computing state-level swing deviations ...")
    state_swings = compute_state_swings(polls, house_effects, ref_date)
    if state_swings:
        logger.info("State swings computed for: %s", list(state_swings.keys()))
    else:
        logger.info("No state-level polls found (scope=<STATE> entries needed in bludgertrack.json)")

    # Step 6: Assemble and write output
    output = {
        "generated": ref_date.isoformat(),
        "source": raw.get("source"),
        "methodology": {
            "half_life_days":            HALF_LIFE_DAYS,
            "house_effect_max_iter":     HOUSE_EFFECT_ITERATIONS,
            "house_effect_tolerance":    HOUSE_EFFECT_TOLERANCE,
            "min_polls_for_he":          MIN_POLLS_FOR_HE,
            "smoothing_window_days":     SMOOTHING_WINDOW_DAYS,
            "trend_step_days":           TREND_STEP_DAYS,
            "median_sample_size":        MEDIAN_SAMPLE_SIZE,
            "tpp_pref_flows":            DEFAULT_PREF_FLOWS,
        },
        "house_effects": he_summary,
        "house_effect_converged": he_converged,
        "current": current,
        "trend": trend,
        "state_swings": state_swings,
        "polls_with_imputed_tpp": [
            {k: v for k, v in p.items() if k != "tpp_imputed" or p["tpp_imputed"] is not None}
            for p in polls
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    logger.info("Wrote aggregated polls → %s", output_path)

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aggregate Australian election polls")
    parser.add_argument("--input",  default=str(INPUT_FILE),  help="Input polls JSON")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output aggregated JSON")
    parser.add_argument("--state",  default="",               help="State jurisdiction (e.g. 'vic'). Runs state-specific aggregation.")
    parser.add_argument("--plot",   action="store_true",      help="Print ASCII trend summary")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)

    state_arg = args.state.lower() if args.state else ""
    if state_arg in STATE_AGGREGATION_REGISTRY:
        # State-specific aggregation (VIC, NSW, QLD, ...)
        cfg = STATE_AGGREGATION_REGISTRY[state_arg]
        in_path  = Path(args.input)  if args.input  != str(INPUT_FILE)  else cfg["polls_file"]
        out_path = Path(args.output) if args.output != str(OUTPUT_FILE) else cfg["output_file"]
        if state_arg == "vic":
            result = run_vic(in_path, out_path, verbose=args.verbose)
        else:
            result = run_state(state_arg, in_path, out_path, verbose=args.verbose)
        if args.plot and result:
            primary_parties = cfg.get("primary_parties", ["alp", *cfg["coal_keys"], "grn", "ind"])
            print(f"\n=== {state_arg.upper()} Current Aggregate (house-effect corrected, last 60 days) ===")
            current = result.get("current", {})
            for m in primary_parties + ["tpp_eff"]:
                c = current.get(m)
                if c:
                    label = m.upper().replace("_EFF", " TPP")
                    print(f"  {label:12s}: {c['mean']:5.1f}%  "
                          f"[{c['lo95']:.1f}–{c['hi95']:.1f}]  "
                          f"n={c['n']} (n_eff={c['n_eff']:.1f})")
    else:
        result = run(Path(args.input), Path(args.output), verbose=args.verbose)

        if args.plot:
            print("\n=== Current Aggregate (house-effect corrected, last 60 days) ===")
            current = result["current"]
            for m in ["alp", "coal", "grn", "on", "tpp_eff"]:
                c = current.get(m)
                if c:
                    label = m.upper().replace("_EFF", " TPP")
                    print(f"  {label:12s}: {c['mean']:5.1f}%  "
                          f"[{c['lo95']:.1f}–{c['hi95']:.1f}]  "
                          f"n={c['n']} (n_eff={c['n_eff']:.1f})")

            print("\n=== Significant House Effects (TPP) ===")
            he_tpp = result["house_effects"].get("tpp_eff", {})
            for pollster, bias in list(he_tpp.items())[:8]:
                direction = "HIGH" if bias > 0 else "LOW"
                print(f"  {pollster:30s}: {bias:+.2f}pp ({direction})")
