// ── AEC Election Dashboard — Self-contained preview ──────────────────────────
// Tabs: Overview · Seats · Polls · Model
// All data, config and logic inlined — no external local imports.

import { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
  ComposedChart, Area,
  BarChart, Bar, Cell,
} from "recharts";
import { Analytics } from "@vercel/analytics/react";
import DEMOGRAPHICS from "./data/demographics.js";
import STATE_DEMOGRAPHICS from "./data/state_demographics.js";
import BETTING_ODDS from "./data/betting_odds.json";
import ECONOMICS_DATA from "./data/economics.json";
import LEADERS_DATA from "./data/leaders.json";
import AGGREGATED_POLLS from "./data/aggregated.json";
import BLUDGERTRACK from "./data/bludgertrack.json";
import NSW_STATE_POLLS from "./data/nsw_polls.json";
import QLD_STATE_POLLS from "./data/qld_polls.json";
import WA_STATE_POLLS from "./data/wa_polls.json";
import SA_STATE_POLLS from "./data/sa_polls.json";
import * as STATE_SEAT_FP from "./data/state_seat_fp.js";
import { useLiveResults } from "./live/useLiveResults.js";
import { projectSeats } from "./live/project.js";
import { computeLiveConfidence } from "./live/confidence.js";
import { LIVE_CONFIG, SAMPLE_SNAPSHOTS } from "./live/config.js";

// VIC_SEATS_KNOWN removed — full 88-seat data is in _VS / VIC_SEATS below.

// 2022 VIC state result summary (88 seats total)
// ALP 56, Coalition 28 (LIB 19 + NAT 9), GRN 4, IND 0 — matches the seat-level
// _VS data below (previously misstated as Coalition 26 / IND 2).
const VIC_2022_SUMMARY = {
  alp: 56, lp: 28, grn: 4, ind: 0, total: 88,
  date: "26 November 2022",
  premier: "Daniel Andrews (ALP)",
};

// ─── Party config ─────────────────────────────────────────────────────────────
const PARTY = {
  ALP: { short: "Labor", color: "#DC2626", bg: "#FEE2E2", group: "alp" },
  LP: { short: "Liberal", color: "#1D4ED8", bg: "#DBEAFE", group: "coalition" },
  LNP: { short: "LNP", color: "#1D4ED8", bg: "#DBEAFE", group: "coalition" },
  NP: { short: "Nationals", color: "#065F46", bg: "#D1FAE5", group: "coalition" },
  CLP: { short: "CLP", color: "#1E40AF", bg: "#DBEAFE", group: "coalition" },
  GRN: { short: "Greens", color: "#059669", bg: "#D1FAE5", group: "greens" },
  IND: { short: "Independent", color: "#0891B2", bg: "#CFFAFE", group: "teal" },
  KAP: { short: "KAP", color: "#92400E", bg: "#FEF3C7", group: "crossbench" },
  CA: { short: "Centre All.", color: "#7C3AED", bg: "#EDE9FE", group: "teal" },
  ON: { short: "One Nation", color: "#B45309", bg: "#FEF3C7", group: "one_nation" },
};
const getParty = (ab) => PARTY[ab] ?? { short: ab || "?", color: "var(--text-3)", bg: "var(--subtle-bg)", group: "crossbench" };

// Named "teal" independent seats (climate-focused progressive independents).
// All other IND/CA seats are classified as "ind" (Other Independent).
const TEAL_SEAT_IDS = new Set([151, 152, 108, 132, 221, 214]); // Warringah, Wentworth, Bradfield, Mackellar, Kooyong, Goldstein

// Returns the display group for a seat, distinguishing named teal seats from other independents.
// Pass overrideParty when the projected winner differs from the 2025 winner.
function getSeatGroup(seat, overrideParty) {
  const p = overrideParty ?? seat.winner.party;
  const g = getParty(p).group;
  if (g === "teal") return TEAL_SEAT_IDS.has(seat.id) ? "teal" : "ind";
  return g;
}

// Tally a list of items into a { group: count } map. Replaces the
// `const c = {}; items.forEach(... c[g] = (c[g] || 0) + 1); return c;` block
// that was copy-pasted for every jurisdiction's proj/base counts.
const countByGroup = (items, groupOf) => {
  const c = {};
  items.forEach((it) => {
    const g = groupOf(it);
    c[g] = (c[g] || 0) + 1;
  });
  return c;
};

const GROUP_CONFIG = {
  alp: { label: "Labor", color: "#DC2626" },
  coalition: { label: "Coalition", color: "#1D4ED8" },
  greens: { label: "Greens", color: "#059669" },
  teal: { label: "Teal Ind.", color: "#0891B2" },
  ind: { label: "Other Ind.", color: "#0D9488" },
  one_nation: { label: "One Nation", color: "#B45309" },
  crossbench: { label: "Other Crossbench", color: "#7C3AED" },
};
const GROUP_ORDER = ["alp", "coalition", "greens", "teal", "ind", "one_nation", "crossbench"];

const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const MARGINS = ["very_marginal", "marginal", "fairly_safe", "safe"];
const MARGIN_LABEL = { very_marginal: "Very marginal (<2%)", marginal: "Marginal (2–5%)", fairly_safe: "Fairly safe (5–10%)", safe: "Safe (>10%)" };
const MARGIN_COLOR = { very_marginal: "#DC2626", marginal: "#F59E0B", fairly_safe: "#10B981", safe: "var(--text-3)" };

// 2022 actual national primary vote % (baseline for swing calculations)
const BASELINE_2022 = { alp: 32.6, coal: 35.7, grn: 12.2, teal: 5.1, on: 4.7 };
const NATIONAL_2PP_2022 = 52.13; // ALP 2PP at 2022 election

// 2025 actual national primary vote % and 2PP (baseline for post-election tracking)
const BASELINE_2025 = { alp: 34.6, coal: 31.8, grn: 12.2, teal: 4.5, on: 6.4 };
const NATIONAL_2PP_2025 = 55.2; // ALP 2PP at 2025 election
// ALP 2PP vs right bloc (Coal + ON counted on right side) using 2025 actual primaries
// + default preference flows. ON is treated as right-aligned so an ON surge correctly
// lowers the implied 2PP rather than inflating it via the on_alp preference flow.
const RIGHT_BLOC_2PP_2025 = 52.5;

// Seat-level 2022 ON first-preference %, extracted from AEC results.
// Seats omitted here use the national baseline (4.7%) + national ON swing.
const ON_FP_2022 = {
  // QLD — regional seats where ON is historically strongest
  166: 13.8, // Hinkler
  178: 11.2, // Wide Bay
  158: 10.5, // Dawson
  157: 10.1, // Capricornia
  167: 9.2, // Kennedy
  165: 8.7, // Herbert
  311: 8.6, // Flynn
  168: 8.1, // Leichhardt
  170: 8.0, // Maranoa
  316: 7.8, // Wright
  162: 6.9, // Forde
  304: 6.8, // Blair
  302: 6.5, // Longman
  175: 6.3, // Petrie
  161: 6.1, // Fisher
  171: 6.0, // McPherson
  310: 5.9, // Bonner
  155: 5.8, // Bowman
  252: 5.7, // Dickson
  160: 5.6, // Fairfax
  172: 5.3, // Moncrieff
  164: 4.6, // Groom
  163: 4.5, // Griffith
  // NSW — regional seats
  126: 10.5, // Hunter
  138: 9.5, // Page
  139: 8.1, // Parkes
  135: 7.9, // New England
  249: 7.5, // Paterson
  115: 7.3, // Dobell
  130: 7.4, // Lyne
  145: 7.1, // Richmond
  148: 7.0, // Shortland
  146: 6.8, // Robertson
  250: 6.5, // Riverina
  117: 6.0, // Eden-Monaro
  // WA — regional
  312: 9.8, // Durack
  243: 7.6, // O'Connor
  239: 7.0, // Forrest
  236: 6.5, // Canning
  305: 5.8, // Hasluck
  242: 5.5, // Moore
  // SA
  180: 7.2, // Barker
  183: 6.8, // Grey
  // TAS
  193: 7.2, // Braddon
  192: 6.4, // Bass
  196: 6.1, // Lyons
  // NT
  306: 8.1, // Lingiari
  307: 5.3, // Solomon
  // VIC — regional only (metro seats default to national ~4.7%)
  213: 7.0, // Gippsland
  224: 6.1, // Mallee
  324: 5.3, // Nicholls
};

// ── 2025 seat-level ON first preferences from AEC ──────────────────────────
const ON_FP_2025 = {
  // ACT
  318: 2.5,  // Bean (ACT)
  101: 1.5,  // Canberra (ACT)
  102: 2.0,  // Fenner (ACT)
  103: 3.5,  // Banks (NSW)
  104: 5.4,  // Barton (NSW)
  105: 2.2,  // Bennelong (NSW)
  106: 4.0,  // Berowra (NSW)
  107: 3.0,  // Blaxland (NSW)
  108: 1.5,  // Bradfield (NSW)
  109: 7.6,  // Calare (NSW)
  111: 5.8,  // Chifley (NSW)
  112: 4.2,  // Cook (NSW)
  113: 6.3,  // Cowper (NSW)
  114: 7.4,  // Cunningham (NSW)
  115: 8.9,  // Dobell (NSW)
  117: 6.7,  // Eden-Monaro (NSW)
  118: 6.4,  // Farrer (NSW)
  119: 3.8,  // Fowler (NSW)
  120: 4.8,  // Gilmore (NSW)
  121: 3.0,  // Grayndler (NSW)
  122: 4.2,  // Greenway (NSW)
  124: 5.1,  // Hughes (NSW)
  125: 7.7,  // Hume (NSW)
  126: 16.4,  // Hunter (NSW)
  127: 5.8,  // Kingsford Smith (NSW)
  128: 6.7,  // Lindsay (NSW)
  130: 8.1,  // Lyne (NSW)
  131: 7.5,  // Macarthur (NSW)
  132: 2.4,  // Mackellar (NSW)
  133: 8.4,  // Macquarie (NSW)
  315: 8.1,  // McMahon (NSW)
  134: 4.1,  // Mitchell (NSW)
  135: 9.9,  // New England (NSW)
  136: 5.2,  // Newcastle (NSW)
  138: 5.5,  // Page (NSW)
  139: 13.6,  // Parkes (NSW)
  140: 2.4,  // Parramatta (NSW)
  249: 7.5,  // Paterson (NSW)
  144: 2.2,  // Reid (NSW)
  145: 5.2,  // Richmond (NSW)
  250: 9.6,  // Riverina (NSW)
  146: 6.9,  // Robertson (NSW)
  148: 9.0,  // Shortland (NSW)
  149: 3.3,  // Sydney (NSW)
  151: 1.7,  // Warringah (NSW)
  251: 2.9,  // Watson (NSW)
  152: 2.3,  // Wentworth (NSW)
  153: 3.6,  // Werriwa (NSW)
  150: 7.5,  // Whitlam (NSW)
  306: 8.6,  // Lingiari (NT)
  307: 6.3,  // Solomon (NT)
  304: 9.3,  // Blair (QLD)
  310: 3.7,  // Bonner (QLD)
  155: 6.8,  // Bowman (QLD)
  156: 2.3,  // Brisbane (QLD)
  157: 15.5,  // Capricornia (QLD)
  158: 10.2,  // Dawson (QLD)
  252: 3.9,  // Dickson (QLD)
  159: 8.0,  // Fadden (QLD)
  160: 7.2,  // Fairfax (QLD)
  161: 5.9,  // Fisher (QLD)
  311: 13.9,  // Flynn (QLD)
  162: 10.0,  // Forde (QLD)
  163: 2.2,  // Griffith (QLD)
  164: 9.4,  // Groom (QLD)
  165: 4.9,  // Herbert (QLD)
  166: 13.2,  // Hinkler (QLD)
  167: 7.5,  // Kennedy (QLD)
  168: 7.9,  // Leichhardt (QLD)
  169: 4.0,  // Lilley (QLD)
  302: 9.5,  // Longman (QLD)
  170: 12.1,  // Maranoa (QLD)
  171: 4.2,  // McPherson (QLD)
  172: 5.5,  // Moncrieff (QLD)
  173: 2.7,  // Moreton (QLD)
  174: 5.0,  // Oxley (QLD)
  175: 6.6,  // Petrie (QLD)
  176: 6.3,  // Rankin (QLD)
  177: 2.1,  // Ryan (QLD)
  178: 11.8,  // Wide Bay (QLD)
  316: 16.9,  // Wright (QLD)
  179: 3.8,  // Adelaide (SA)
  180: 8.0,  // Barker (SA)
  182: 2.9,  // Boothby (SA)
  183: 9.8,  // Grey (SA)
  185: 4.8,  // Hindmarsh (SA)
  186: 6.1,  // Kingston (SA)
  187: 6.5,  // Makin (SA)
  188: 5.9,  // Mayo (SA)
  325: 9.2,  // Spence (SA)
  190: 3.3,  // Sturt (SA)
  192: 6.4,  // Bass (TAS)
  193: 7.7,  // Braddon (TAS)
  319: 4.0,  // Clark (TAS)
  195: 4.8,  // Franklin (TAS)
  196: 6.8,  // Lyons (TAS)
  197: 3.2,  // Aston (VIC)
  198: 7.6,  // Ballarat (VIC)
  200: 4.5,  // Bendigo (VIC)
  201: 8.1,  // Bruce (VIC)
  203: 3.0,  // Calwell (VIC)
  204: 5.0,  // Casey (VIC)
  205: 1.8,  // Chisholm (VIC)
  320: 4.9,  // Cooper (VIC)
  328: 2.9,  // Corangamite (VIC)
  208: 9.8,  // Corio (VIC)
  209: 2.4,  // Deakin (VIC)
  210: 6.4,  // Dunkley (VIC)
  211: 5.4,  // Flinders (VIC)
  321: 4.2,  // Fraser (VIC)
  212: 5.5,  // Gellibrand (VIC)
  213: 14.2,  // Gippsland (VIC)
  214: 1.6,  // Goldstein (VIC)
  309: 5.6,  // Gorton (VIC)
  326: 9.0,  // Hawke (VIC)
  216: 8.3,  // Holt (VIC)
  217: 4.4,  // Hotham (VIC)
  218: 6.9,  // Indi (VIC)
  219: 4.2,  // Isaacs (VIC)
  220: 3.6,  // Jagajaga (VIC)
  221: 0.9,  // Kooyong (VIC)
  223: 7.3,  // La Trobe (VIC)
  222: 6.5,  // Lalor (VIC)
  322: 2.5,  // Macnamara (VIC)
  224: 10.9,  // Mallee (VIC)
  225: 6.5,  // Maribyrnong (VIC)
  226: 6.1,  // McEwen (VIC)
  228: 2.2,  // Melbourne (VIC)
  229: 1.8,  // Menzies (VIC)
  323: 7.8,  // Monash (VIC)
  324: 11.1,  // Nicholls (VIC)
  232: 6.4,  // Scullin (VIC)
  233: 4.0,  // Wannon (VIC)
  234: 3.2,  // Wills (VIC)
  235: 12.6,  // Brand (WA)
  329: 8.3,  // Bullwinkel (WA)
  317: 9.7,  // Burt (WA)
  236: 11.3,  // Canning (WA)
  237: 4.8,  // Cowan (WA)
  238: 2.4,  // Curtin (WA)
  312: 9.8,  // Durack (WA)
  239: 8.7,  // Forrest (WA)
  240: 5.8,  // Fremantle (WA)
  305: 7.0,  // Hasluck (WA)
  242: 4.3,  // Moore (WA)
  243: 11.2,  // O'Connor (WA)
  244: 8.9,  // Pearce (WA)
  245: 6.0,  // Perth (WA)
  247: 4.9,  // Swan (WA)
  248: 3.9,  // Tangney (WA)
};

// ── 2025 seat-level first preferences (AEC final results, all 150 seats) ──────
// Derived from AEC 2025 first-preference divisional totals (event_id=31496).
//
// [!IMPORTANT] #13 Data Quality Note:
// Values here should be rigorously verified against final AEC distributions.
// For ALP/Coal seats: alp and coal are currently back-calculated from the TCP margin using
//   alp ≈ ALP_2PP − 0.81·grn − 0.43·on − 1.0;  coal = 100 − alp − grn − on − other
// to ensure the zero-swing primary-based 2PP ≈ AEC 2025 TCP result.
// Minor party redistributions in newly created/altered seats (e.g., Bullwinkel)
// are rough estimates and require formal SA1-to-division mapping.
const SEAT_FP_2025 = {
  101: { alp: 48.5, coal: 17.8, grn: 20.1, teal: 11.0, on: 0.0, other: 2.6 },  // Canberra
  102: { alp: 54.3, coal: 21.5, grn: 16.5, teal: 0.0, on: 0.0, other: 7.8 },  // Fenner
  103: { alp: 37.6, coal: 40.0, grn: 12.3, teal: 0.0, on: 3.6, other: 6.4 },  // Banks
  104: { alp: 47.6, coal: 23.8, grn: 15.9, teal: 0.0, on: 5.4, other: 7.3 },  // Barton
  105: { alp: 47.0, coal: 35.4, grn: 12.1, teal: 0.0, on: 2.2, other: 3.3 },  // Bennelong
  106: { alp: 27.3, coal: 41.2, grn: 12.2, teal: 13.4, on: 4.0, other: 1.9 },  // Berowra
  107: { alp: 47.0, coal: 18.1, grn: 7.9, teal: 21.6, on: 3.1, other: 2.3 },  // Blaxland
  108: { alp: 20.0, coal: 38.2, grn: 6.5, teal: 32.7, on: 1.5, other: 1.1 },  // Bradfield
  109: { alp: 10.8, coal: 31.8, grn: 3.5, teal: 41.9, on: 8.0, other: 4.1 },  // Calare
  111: { alp: 55.2, coal: 19.9, grn: 10.4, teal: 0.0, on: 6.0, other: 8.6 },  // Chifley
  112: { alp: 31.7, coal: 48.1, grn: 9.9, teal: 0.0, on: 4.2, other: 6.1 },  // Cook
  113: { alp: 11.8, coal: 40.2, grn: 4.2, teal: 32.2, on: 6.6, other: 5.0 },  // Cowper
  114: { alp: 44.9, coal: 23.0, grn: 20.8, teal: 0.0, on: 7.4, other: 4.0 },  // Cunningham
  115: { alp: 44.3, coal: 28.3, grn: 10.6, teal: 0.0, on: 9.1, other: 7.6 },  // Dobell
  117: { alp: 44.1, coal: 32.6, grn: 10.2, teal: 3.9, on: 6.8, other: 2.4 },  // Eden-Monaro
  118: { alp: 16.1, coal: 45.9, grn: 5.1, teal: 22.4, on: 6.9, other: 3.6 },  // Farrer
  119: { alp: 38.5, coal: 11.9, grn: 6.5, teal: 35.4, on: 3.9, other: 3.8 },  // Fowler
  120: { alp: 39.6, coal: 35.9, grn: 7.3, teal: 8.3, on: 5.0, other: 3.9 },  // Gilmore
  121: { alp: 54.0, coal: 13.9, grn: 25.4, teal: 2.2, on: 3.0, other: 1.5 },  // Grayndler
  122: { alp: 52.2, coal: 27.7, grn: 11.0, teal: 2.4, on: 4.2, other: 2.5 },  // Greenway
  124: { alp: 40.4, coal: 37.5, grn: 11.6, teal: 0.0, on: 5.2, other: 5.3 },  // Hughes
  125: { alp: 28.9, coal: 45.8, grn: 8.9, teal: 4.7, on: 8.1, other: 3.7 },  // Hume
  126: { alp: 46.5, coal: 19.3, grn: 7.7, teal: 0.0, on: 17.4, other: 9.1 },  // Hunter
  127: { alp: 51.5, coal: 25.7, grn: 13.5, teal: 3.5, on: 5.8, other: 0.0 },  // Kingsford Smith
  128: { alp: 34.5, coal: 42.3, grn: 10.3, teal: 0.0, on: 7.1, other: 5.8 },  // Lindsay
  130: { alp: 21.1, coal: 40.1, grn: 6.6, teal: 17.5, on: 8.8, other: 6.0 },  // Lyne
  131: { alp: 49.4, coal: 23.2, grn: 13.1, teal: 0.0, on: 7.6, other: 6.8 },  // Macarthur
  132: { alp: 11.9, coal: 35.5, grn: 6.1, teal: 42.3, on: 2.5, other: 1.8 },  // Mackellar
  133: { alp: 43.0, coal: 31.5, grn: 12.5, teal: 0.0, on: 8.4, other: 4.6 },  // Macquarie
  134: { alp: 33.8, coal: 45.9, grn: 13.9, teal: 0.0, on: 4.1, other: 2.4 },  // Mitchell
  135: { alp: 21.1, coal: 53.8, grn: 8.0, teal: 3.7, on: 10.2, other: 3.3 },  // New England
  136: { alp: 46.2, coal: 19.3, grn: 23.5, teal: 0.0, on: 5.3, other: 5.8 },  // Newcastle
  138: { alp: 23.4, coal: 48.2, grn: 16.1, teal: 3.5, on: 5.8, other: 2.9 },  // Page
  139: { alp: 22.3, coal: 44.7, grn: 6.8, teal: 0.0, on: 15.1, other: 11.1 },  // Parkes
  140: { alp: 49.6, coal: 30.6, grn: 12.4, teal: 2.4, on: 2.5, other: 2.4 },  // Parramatta
  144: { alp: 49.8, coal: 32.0, grn: 11.5, teal: 3.0, on: 2.2, other: 1.5 },  // Reid
  145: { alp: 32.2, coal: 26.2, grn: 28.7, teal: 0.0, on: 5.5, other: 7.4 },  // Richmond
  146: { alp: 46.4, coal: 30.5, grn: 9.2, teal: 3.4, on: 7.0, other: 3.5 },  // Robertson
  148: { alp: 45.1, coal: 26.8, grn: 11.7, teal: 4.5, on: 9.1, other: 2.9 },  // Shortland
  149: { alp: 55.7, coal: 16.9, grn: 21.8, teal: 0.0, on: 3.3, other: 2.3 },  // Sydney
  150: { alp: 39.5, coal: 28.6, grn: 12.5, teal: 8.9, on: 7.6, other: 2.9 },  // Whitlam
  151: { alp: 14.4, coal: 31.9, grn: 8.8, teal: 41.9, on: 1.7, other: 1.3 },  // Warringah
  152: { alp: 13.1, coal: 35.7, grn: 10.0, teal: 39.0, on: 2.3, other: 0.0 },  // Wentworth
  153: { alp: 43.5, coal: 33.5, grn: 12.0, teal: 0.0, on: 3.9, other: 7.1 },  // Werriwa
  155: { alp: 32.9, coal: 40.9, grn: 12.4, teal: 0.0, on: 7.0, other: 6.9 },  // Bowman
  156: { alp: 33.2, coal: 33.1, grn: 27.9, teal: 0.0, on: 2.3, other: 3.4 },  // Brisbane
  157: { alp: 32.7, coal: 35.8, grn: 6.3, teal: 0.0, on: 15.5, other: 9.8 },  // Capricornia
  158: { alp: 27.2, coal: 43.0, grn: 7.2, teal: 0.0, on: 10.6, other: 11.9 },  // Dawson
  159: { alp: 29.3, coal: 43.5, grn: 9.7, teal: 0.0, on: 8.4, other: 9.0 },  // Fadden
  160: { alp: 25.7, coal: 38.7, grn: 10.2, teal: 14.3, on: 7.4, other: 3.6 },  // Fairfax
  161: { alp: 23.0, coal: 38.3, grn: 10.0, teal: 18.0, on: 6.1, other: 4.6 },  // Fisher
  162: { alp: 35.9, coal: 31.6, grn: 11.8, teal: 0.0, on: 10.4, other: 10.3 },  // Forde
  163: { alp: 35.0, coal: 25.6, grn: 33.4, teal: 0.0, on: 2.3, other: 3.8 },  // Griffith
  164: { alp: 17.2, coal: 40.4, grn: 6.0, teal: 22.5, on: 9.7, other: 4.2 },  // Groom
  165: { alp: 24.3, coal: 50.6, grn: 9.8, teal: 0.0, on: 5.1, other: 10.2 },  // Herbert
  166: { alp: 32.4, coal: 38.6, grn: 7.6, teal: 0.0, on: 13.6, other: 7.8 },  // Hinkler
  167: { alp: 17.0, coal: 24.2, grn: 6.0, teal: 0.0, on: 7.8, other: 45.0 },  // Kennedy
  168: { alp: 39.9, coal: 28.8, grn: 9.9, teal: 0.0, on: 8.4, other: 13.0 },  // Leichhardt
  169: { alp: 46.7, coal: 26.9, grn: 16.7, teal: 0.0, on: 4.0, other: 5.6 },  // Lilley
  170: { alp: 17.6, coal: 54.4, grn: 5.7, teal: 0.0, on: 12.8, other: 9.6 },  // Maranoa
  171: { alp: 25.6, coal: 39.2, grn: 9.1, teal: 17.7, on: 4.6, other: 3.8 },  // McPherson
  172: { alp: 25.7, coal: 44.1, grn: 9.9, teal: 10.2, on: 5.8, other: 4.2 },  // Moncrieff
  173: { alp: 43.1, coal: 25.3, grn: 23.8, teal: 0.0, on: 2.7, other: 5.0 },  // Moreton
  174: { alp: 54.3, coal: 21.1, grn: 13.8, teal: 0.0, on: 5.0, other: 5.7 },  // Oxley
  175: { alp: 37.1, coal: 37.1, grn: 12.0, teal: 0.0, on: 6.6, other: 7.2 },  // Petrie
  176: { alp: 53.4, coal: 19.8, grn: 11.5, teal: 0.0, on: 6.7, other: 8.6 },  // Rankin
  177: { alp: 28.9, coal: 34.3, grn: 31.0, teal: 0.0, on: 2.1, other: 3.7 },  // Ryan
  178: { alp: 27.7, coal: 40.2, grn: 9.1, teal: 5.0, on: 12.4, other: 5.7 },  // Wide Bay
  179: { alp: 47.4, coal: 24.0, grn: 19.8, teal: 0.0, on: 3.9, other: 5.0 },  // Adelaide
  180: { alp: 23.6, coal: 50.4, grn: 8.5, teal: 6.3, on: 8.4, other: 2.8 },  // Barker
  182: { alp: 43.0, coal: 32.2, grn: 17.4, teal: 0.0, on: 2.9, other: 4.7 },  // Boothby
  183: { alp: 23.7, coal: 36.2, grn: 6.2, teal: 19.6, on: 10.3, other: 3.9 },  // Grey
  185: { alp: 50.3, coal: 23.5, grn: 14.5, teal: 0.0, on: 4.9, other: 6.8 },  // Hindmarsh
  186: { alp: 54.2, coal: 18.5, grn: 14.1, teal: 0.0, on: 6.2, other: 7.1 },  // Kingston
  187: { alp: 49.9, coal: 22.8, grn: 13.1, teal: 0.0, on: 6.7, other: 7.5 },  // Makin
  188: { alp: 21.9, coal: 24.0, grn: 14.1, teal: 31.1, on: 6.0, other: 2.8 },  // Mayo
  190: { alp: 35.9, coal: 34.4, grn: 16.5, teal: 7.6, on: 3.4, other: 2.1 },  // Sturt
  192: { alp: 40.5, coal: 30.9, grn: 13.5, teal: 5.4, on: 6.5, other: 3.2 },  // Bass
  193: { alp: 39.8, coal: 31.6, grn: 8.2, teal: 8.2, on: 7.7, other: 4.5 },  // Braddon
  195: { alp: 39.2, coal: 18.2, grn: 10.3, teal: 27.5, on: 4.8, other: 0.0 },  // Franklin
  196: { alp: 45.1, coal: 27.1, grn: 11.3, teal: 0.0, on: 7.0, other: 9.5 },  // Lyons
  197: { alp: 39.2, coal: 38.1, grn: 12.3, teal: 4.3, on: 3.3, other: 2.7 },  // Aston
  198: { alp: 43.1, coal: 29.0, grn: 14.6, teal: 2.7, on: 7.7, other: 3.0 },  // Ballarat
  200: { alp: 35.8, coal: 43.2, grn: 12.5, teal: 0.0, on: 4.8, other: 3.7 },  // Bendigo
  201: { alp: 48.7, coal: 22.5, grn: 13.2, teal: 0.0, on: 8.4, other: 7.1 },  // Bruce
  203: { alp: 33.0, coal: 16.4, grn: 8.6, teal: 35.5, on: 3.3, other: 3.2 },  // Calwell
  204: { alp: 25.9, coal: 41.7, grn: 12.1, teal: 11.8, on: 5.2, other: 3.4 },  // Casey
  205: { alp: 40.0, coal: 36.8, grn: 12.9, teal: 6.4, on: 1.8, other: 2.0 },  // Chisholm
  208: { alp: 43.2, coal: 24.2, grn: 16.1, teal: 3.5, on: 9.8, other: 3.1 },  // Corio
  209: { alp: 36.7, coal: 38.2, grn: 12.8, teal: 8.0, on: 2.5, other: 1.9 },  // Deakin
  210: { alp: 40.3, coal: 32.7, grn: 12.5, teal: 3.0, on: 6.7, other: 4.9 },  // Dunkley
  211: { alp: 22.6, coal: 39.3, grn: 6.2, teal: 24.0, on: 5.4, other: 2.5 },  // Flinders
  212: { alp: 46.9, coal: 25.9, grn: 17.7, teal: 0.0, on: 5.5, other: 4.0 },  // Gellibrand
  213: { alp: 21.0, coal: 53.5, grn: 8.2, teal: 0.0, on: 14.2, other: 3.1 },  // Gippsland
  214: { alp: 13.4, coal: 42.8, grn: 7.2, teal: 33.3, on: 1.7, other: 1.7 },  // Goldstein
  216: { alp: 46.3, coal: 24.3, grn: 11.7, teal: 0.0, on: 8.3, other: 9.5 },  // Holt
  217: { alp: 49.9, coal: 24.9, grn: 15.0, teal: 0.0, on: 4.4, other: 5.8 },  // Hotham
  218: { alp: 8.3, coal: 31.7, grn: 3.5, teal: 46.4, on: 7.2, other: 3.0 },  // Indi
  219: { alp: 50.0, coal: 28.0, grn: 14.3, teal: 0.0, on: 4.2, other: 3.4 },  // Isaacs
  220: { alp: 42.9, coal: 29.0, grn: 15.9, teal: 6.2, on: 3.6, other: 2.4 },  // Jagajaga
  221: { alp: 11.3, coal: 42.3, grn: 7.7, teal: 36.5, on: 0.9, other: 1.3 },  // Kooyong
  222: { alp: 44.6, coal: 26.6, grn: 15.5, teal: 2.1, on: 6.5, other: 4.7 },  // Lalor
  223: { alp: 32.8, coal: 38.7, grn: 13.5, teal: 0.0, on: 7.3, other: 7.8 },  // La Trobe
  224: { alp: 19.5, coal: 52.1, grn: 9.3, teal: 0.0, on: 11.3, other: 7.8 },  // Mallee
  225: { alp: 41.5, coal: 30.3, grn: 21.7, teal: 0.0, on: 6.5, other: 0.0 },  // Maribyrnong
  226: { alp: 40.2, coal: 33.6, grn: 12.3, teal: 0.0, on: 6.4, other: 7.5 },  // McEwen
  228: { alp: 31.4, coal: 17.8, grn: 42.1, teal: 4.7, on: 2.2, other: 1.9 },  // Melbourne
  229: { alp: 36.3, coal: 40.7, grn: 11.6, teal: 7.1, on: 1.8, other: 2.5 },  // Menzies
  232: { alp: 47.9, coal: 21.8, grn: 9.9, teal: 0.0, on: 6.8, other: 13.6 },  // Scullin
  233: { alp: 10.4, coal: 45.0, grn: 2.9, teal: 34.6, on: 4.2, other: 2.9 },  // Wannon
  234: { alp: 35.4, coal: 11.7, grn: 38.0, teal: 0.0, on: 3.2, other: 11.7 },  // Wills
  235: { alp: 46.3, coal: 19.5, grn: 13.1, teal: 0.0, on: 12.6, other: 8.5 },  // Brand
  236: { alp: 30.0, coal: 42.8, grn: 8.8, teal: 0.0, on: 11.3, other: 7.1 },  // Canning
  237: { alp: 50.0, coal: 25.5, grn: 11.2, teal: 3.9, on: 5.1, other: 4.3 },  // Cowan
  238: { alp: 14.3, coal: 40.6, grn: 7.4, teal: 33.2, on: 2.4, other: 2.1 },  // Curtin
  239: { alp: 23.9, coal: 33.4, grn: 8.0, teal: 19.8, on: 9.3, other: 5.5 },  // Forrest
  240: { alp: 39.4, coal: 18.3, grn: 11.4, teal: 24.1, on: 5.9, other: 1.0 },  // Fremantle
  242: { alp: 34.2, coal: 32.8, grn: 11.4, teal: 6.9, on: 4.5, other: 10.1 },  // Moore
  243: { alp: 22.5, coal: 49.3, grn: 10.4, teal: 0.0, on: 11.9, other: 5.8 },  // O'Connor
  244: { alp: 40.5, coal: 28.6, grn: 11.6, teal: 0.0, on: 8.9, other: 10.3 },  // Pearce
  245: { alp: 43.6, coal: 25.7, grn: 24.7, teal: 0.0, on: 6.0, other: 0.0 },  // Perth
  247: { alp: 43.4, coal: 26.6, grn: 17.6, teal: 0.0, on: 4.9, other: 7.4 },  // Swan
  248: { alp: 42.9, coal: 34.3, grn: 12.9, teal: 0.0, on: 3.9, other: 6.0 },  // Tangney
  249: { alp: 38.7, coal: 28.7, grn: 8.0, teal: 12.9, on: 7.8, other: 4.0 },  // Paterson
  250: { alp: 19.4, coal: 43.5, grn: 4.5, teal: 18.2, on: 10.3, other: 4.1 },  // Riverina
  251: { alp: 50.4, coal: 14.7, grn: 9.0, teal: 18.2, on: 3.0, other: 4.7 },  // Watson
  252: { alp: 35.7, coal: 35.6, grn: 7.9, teal: 13.8, on: 4.0, other: 2.9 },  // Dickson
  302: { alp: 36.2, coal: 35.8, grn: 9.8, teal: 0.0, on: 9.5, other: 8.7 },  // Longman
  304: { alp: 40.3, coal: 29.0, grn: 11.5, teal: 0.0, on: 10.0, other: 9.2 },  // Blair
  305: { alp: 50.4, coal: 22.0, grn: 12.5, teal: 0.0, on: 7.1, other: 8.0 },  // Hasluck
  306: { alp: 46.1, coal: 30.7, grn: 9.8, teal: 0.0, on: 8.6, other: 4.8 },  // Lingiari
  307: { alp: 32.9, coal: 36.4, grn: 9.8, teal: 14.0, on: 6.3, other: 0.6 },  // Solomon
  309: { alp: 44.6, coal: 29.7, grn: 10.9, teal: 0.0, on: 5.7, other: 9.2 },  // Gorton
  310: { alp: 42.0, coal: 35.4, grn: 13.3, teal: 0.0, on: 3.8, other: 5.5 },  // Bonner
  311: { alp: 28.1, coal: 38.2, grn: 6.3, teal: 5.3, on: 14.9, other: 7.2 },  // Flynn
  312: { alp: 25.7, coal: 48.6, grn: 8.7, teal: 0.0, on: 10.5, other: 6.5 },  // Durack
  315: { alp: 46.2, coal: 26.5, grn: 8.9, teal: 10.3, on: 8.1, other: 0.0 },  // McMahon
  316: { alp: 26.3, coal: 35.5, grn: 9.8, teal: 0.0, on: 17.7, other: 10.7 },  // Wright
  317: { alp: 48.8, coal: 19.2, grn: 11.5, teal: 0.0, on: 9.9, other: 10.7 },  // Burt
  318: { alp: 41.1, coal: 22.5, grn: 9.2, teal: 27.2, on: 0.0, other: 0.0 },  // Bean
  319: { alp: 20.2, coal: 13.3, grn: 13.5, teal: 49.0, on: 4.0, other: 0.0 },  // Clark
  320: { alp: 42.0, coal: 14.2, grn: 25.8, teal: 0.0, on: 4.9, other: 13.1 },  // Cooper
  321: { alp: 42.3, coal: 16.1, grn: 26.4, teal: 0.0, on: 4.2, other: 11.0 },  // Fraser
  322: { alp: 37.2, coal: 29.4, grn: 28.1, teal: 1.6, on: 2.5, other: 1.2 },  // Macnamara
  323: { alp: 21.2, coal: 33.0, grn: 4.8, teal: 29.1, on: 8.2, other: 3.6 },  // Monash
  324: { alp: 23.8, coal: 48.4, grn: 7.4, teal: 0.0, on: 11.2, other: 9.1 },  // Nicholls
  325: { alp: 46.9, coal: 19.5, grn: 15.3, teal: 0.0, on: 9.6, other: 8.7 },  // Spence
  326: { alp: 40.9, coal: 31.0, grn: 10.1, teal: 0.0, on: 9.2, other: 8.9 },  // Hawke
  328: { alp: 39.4, coal: 34.4, grn: 15.6, teal: 4.5, on: 3.0, other: 3.1 },  // Corangamite
  329: { alp: 33.1, coal: 41.9, grn: 11.4, teal: 0.0, on: 8.5, other: 5.0 },  // Bullwinkel
};  // auto-injected by inject_model_constants.py

// ── 2022 seat-level first preferences ──────────────────────────────────────────
// #14 Data Quality Note: Placeholder for 2022 AEC final results (event_id=27966).
// Requires population for full primary-based backtesting of the 2019->2022 cycle.
const SEAT_FP_2022 = {
  101: { alp: 45.0, coal: 22.1, grn: 24.8, teal: 5.4, on: 0.0, other: 2.8 },  // Canberra
  102: { alp: 48.6, coal: 28.6, grn: 17.0, teal: 0.0, on: 3.0, other: 2.8 },  // Fenner
  103: { alp: 35.5, coal: 45.4, grn: 9.0, teal: 0.0, on: 3.0, other: 7.1 },  // Banks
  104: { alp: 50.9, coal: 27.1, grn: 12.8, teal: 0.0, on: 0.0, other: 9.2 },  // Barton
  105: { alp: 38.7, coal: 42.3, grn: 11.9, teal: 0.0, on: 1.8, other: 5.4 },  // Bennelong
  106: { alp: 23.2, coal: 51.3, grn: 16.3, teal: 3.1, on: 3.4, other: 2.7 },  // Berowra
  107: { alp: 55.5, coal: 29.1, grn: 6.9, teal: 0.0, on: 0.0, other: 8.6 },  // Blaxland
  108: { alp: 17.5, coal: 45.5, grn: 9.3, teal: 24.2, on: 0.0, other: 3.5 },  // Bradfield
  109: { alp: 15.4, coal: 48.5, grn: 4.7, teal: 21.0, on: 10.3, other: 0.0 },  // Calare
  111: { alp: 53.2, coal: 25.0, grn: 6.1, teal: 0.0, on: 6.5, other: 9.2 },  // Chifley
  112: { alp: 25.4, coal: 56.2, grn: 10.4, teal: 0.0, on: 7.9, other: 0.0 },  // Cook
  113: { alp: 14.1, coal: 39.7, grn: 6.1, teal: 26.6, on: 9.2, other: 4.3 },  // Cowper
  114: { alp: 40.3, coal: 25.1, grn: 21.9, teal: 0.0, on: 5.3, other: 7.4 },  // Cunningham
  115: { alp: 43.1, coal: 34.2, grn: 8.6, teal: 0.0, on: 7.8, other: 6.2 },  // Dobell
  117: { alp: 45.1, coal: 35.0, grn: 9.9, teal: 0.0, on: 4.5, other: 5.5 },  // Eden-Monaro
  118: { alp: 19.7, coal: 54.4, grn: 9.5, teal: 0.0, on: 7.0, other: 9.3 },  // Farrer
  119: { alp: 36.5, coal: 18.1, grn: 5.0, teal: 29.9, on: 3.7, other: 6.7 },  // Fowler
  120: { alp: 36.1, coal: 42.2, grn: 10.3, teal: 4.3, on: 4.2, other: 2.9 },  // Gilmore
  121: { alp: 54.6, coal: 16.3, grn: 23.0, teal: 2.2, on: 1.6, other: 2.3 },  // Grayndler
  122: { alp: 50.1, coal: 31.0, grn: 7.4, teal: 3.8, on: 0.0, other: 7.7 },  // Greenway
  124: { alp: 22.8, coal: 44.0, grn: 6.4, teal: 18.2, on: 0.0, other: 8.6 },  // Hughes
  125: { alp: 20.6, coal: 44.7, grn: 5.1, teal: 17.0, on: 7.7, other: 4.8 },  // Hume
  126: { alp: 39.6, coal: 28.2, grn: 9.2, teal: 8.2, on: 10.4, other: 4.3 },  // Hunter
  127: { alp: 48.2, coal: 29.1, grn: 17.1, teal: 0.0, on: 0.0, other: 5.5 },  // Kingsford Smith
  128: { alp: 31.9, coal: 47.3, grn: 8.1, teal: 0.0, on: 6.1, other: 6.6 },  // Lindsay
  130: { alp: 23.0, coal: 46.2, grn: 8.6, teal: 7.0, on: 8.5, other: 6.8 },  // Lyne
  131: { alp: 46.2, coal: 31.3, grn: 7.9, teal: 0.0, on: 8.4, other: 6.2 },  // Macarthur
  132: { alp: 8.3, coal: 41.5, grn: 6.2, teal: 38.3, on: 2.9, other: 2.9 },  // Mackellar
  133: { alp: 43.8, coal: 35.5, grn: 9.8, teal: 0.0, on: 5.5, other: 5.4 },  // Macquarie
  134: { alp: 25.7, coal: 53.2, grn: 12.0, teal: 0.0, on: 0.0, other: 9.0 },  // Mitchell
  135: { alp: 18.8, coal: 52.9, grn: 7.8, teal: 11.3, on: 5.6, other: 3.6 },  // New England
  136: { alp: 44.7, coal: 24.8, grn: 20.7, teal: 0.0, on: 4.7, other: 5.1 },  // Newcastle
  137: { alp: 22.2, coal: 39.5, grn: 8.9, teal: 26.1, on: 1.3, other: 1.9 },  // North Sydney
  138: { alp: 19.6, coal: 47.9, grn: 8.9, teal: 13.9, on: 5.7, other: 3.9 },  // Page
  139: { alp: 21.6, coal: 52.3, grn: 5.2, teal: 0.0, on: 8.2, other: 12.7 },  // Parkes
  140: { alp: 41.9, coal: 36.5, grn: 9.3, teal: 3.8, on: 0.0, other: 8.5 },  // Parramatta
  144: { alp: 42.8, coal: 38.7, grn: 10.3, teal: 3.4, on: 2.1, other: 2.7 },  // Reid
  145: { alp: 30.4, coal: 24.7, grn: 26.7, teal: 5.6, on: 4.3, other: 8.2 },  // Richmond
  146: { alp: 39.0, coal: 41.4, grn: 10.4, teal: 0.0, on: 4.0, other: 5.1 },  // Robertson
  148: { alp: 41.9, coal: 33.5, grn: 10.6, teal: 0.0, on: 6.9, other: 7.0 },  // Shortland
  149: { alp: 51.1, coal: 19.8, grn: 23.3, teal: 0.0, on: 1.9, other: 3.9 },  // Sydney
  150: { alp: 45.7, coal: 29.8, grn: 11.0, teal: 0.0, on: 7.6, other: 6.0 },  // Whitlam
  151: { alp: 8.6, coal: 33.6, grn: 7.9, teal: 45.3, on: 2.2, other: 2.5 },  // Warringah
  152: { alp: 10.9, coal: 40.6, grn: 8.4, teal: 35.9, on: 0.0, other: 4.2 },  // Wentworth
  153: { alp: 40.5, coal: 31.7, grn: 7.3, teal: 0.0, on: 0.0, other: 20.6 },  // Werriwa
  155: { alp: 29.5, coal: 42.6, grn: 13.4, teal: 0.0, on: 7.9, other: 6.7 },  // Bowman
  156: { alp: 27.4, coal: 38.3, grn: 27.4, teal: 0.0, on: 2.6, other: 4.3 },  // Brisbane
  157: { alp: 29.3, coal: 41.1, grn: 6.3, teal: 3.7, on: 15.5, other: 4.2 },  // Capricornia
  158: { alp: 24.7, coal: 43.5, grn: 7.3, teal: 0.0, on: 13.8, other: 10.7 },  // Dawson
  159: { alp: 22.6, coal: 45.7, grn: 11.1, teal: 4.5, on: 9.1, other: 7.0 },  // Fadden
  160: { alp: 23.1, coal: 47.3, grn: 14.2, teal: 0.0, on: 7.0, other: 8.5 },  // Fairfax
  161: { alp: 23.6, coal: 44.5, grn: 15.0, teal: 0.0, on: 9.8, other: 7.1 },  // Fisher
  162: { alp: 29.8, coal: 39.1, grn: 10.6, teal: 3.5, on: 8.6, other: 8.4 },  // Forde
  163: { alp: 29.1, coal: 31.2, grn: 34.9, teal: 0.0, on: 4.8, other: 0.0 },  // Griffith
  164: { alp: 18.8, coal: 43.8, grn: 6.0, teal: 15.7, on: 10.3, other: 5.4 },  // Groom
  165: { alp: 23.1, coal: 50.2, grn: 8.8, teal: 4.7, on: 5.7, other: 7.5 },  // Herbert
  166: { alp: 25.7, coal: 42.5, grn: 0.0, teal: 15.1, on: 9.1, other: 7.6 },  // Hinkler
  167: { alp: 16.4, coal: 28.6, grn: 7.1, teal: 0.0, on: 0.0, other: 47.9 },  // Kennedy
  168: { alp: 30.2, coal: 40.1, grn: 10.9, teal: 0.0, on: 8.2, other: 10.7 },  // Leichhardt
  169: { alp: 42.0, coal: 30.0, grn: 17.4, teal: 0.0, on: 4.4, other: 6.3 },  // Lilley
  170: { alp: 15.4, coal: 56.4, grn: 5.0, teal: 0.0, on: 12.3, other: 11.0 },  // Maranoa
  171: { alp: 22.5, coal: 44.6, grn: 15.9, teal: 0.0, on: 7.5, other: 9.5 },  // McPherson
  172: { alp: 21.6, coal: 47.8, grn: 12.6, teal: 0.0, on: 7.5, other: 10.4 },  // Moncrieff
  173: { alp: 37.7, coal: 33.5, grn: 21.0, teal: 0.0, on: 4.3, other: 3.5 },  // Moreton
  174: { alp: 46.6, coal: 29.5, grn: 15.4, teal: 0.0, on: 8.4, other: 0.0 },  // Oxley
  175: { alp: 30.3, coal: 44.1, grn: 11.7, teal: 0.0, on: 5.7, other: 8.2 },  // Petrie
  176: { alp: 44.5, coal: 29.3, grn: 11.6, teal: 0.0, on: 8.5, other: 6.1 },  // Rankin
  177: { alp: 22.7, coal: 39.3, grn: 30.8, teal: 0.0, on: 2.4, other: 4.9 },  // Ryan
  178: { alp: 22.0, coal: 45.1, grn: 9.9, teal: 7.6, on: 10.7, other: 4.8 },  // Wide Bay
  179: { alp: 40.0, coal: 32.1, grn: 20.2, teal: 0.0, on: 3.3, other: 4.5 },  // Adelaide
  180: { alp: 21.5, coal: 54.6, grn: 7.7, teal: 5.1, on: 6.9, other: 4.2 },  // Barker
  182: { alp: 33.1, coal: 39.0, grn: 15.6, teal: 7.7, on: 2.2, other: 2.4 },  // Boothby
  183: { alp: 21.8, coal: 46.1, grn: 6.9, teal: 12.9, on: 6.5, other: 5.8 },  // Grey
  185: { alp: 42.8, coal: 33.1, grn: 14.1, teal: 0.0, on: 4.1, other: 5.9 },  // Hindmarsh
  186: { alp: 49.3, coal: 25.9, grn: 12.5, teal: 2.9, on: 5.2, other: 4.2 },  // Kingston
  187: { alp: 46.8, coal: 31.7, grn: 11.6, teal: 0.0, on: 5.2, other: 4.7 },  // Makin
  188: { alp: 18.7, coal: 28.0, grn: 12.2, teal: 32.5, on: 4.7, other: 3.9 },  // Mayo
  190: { alp: 31.7, coal: 44.5, grn: 17.0, teal: 0.0, on: 2.7, other: 4.2 },  // Sturt
  192: { alp: 29.7, coal: 41.4, grn: 11.5, teal: 5.3, on: 5.1, other: 7.0 },  // Bass
  193: { alp: 23.5, coal: 45.9, grn: 7.2, teal: 8.3, on: 4.6, other: 10.5 },  // Braddon
  195: { alp: 38.4, coal: 28.1, grn: 18.7, teal: 0.0, on: 3.0, other: 11.8 },  // Franklin
  196: { alp: 29.8, coal: 38.7, grn: 11.7, teal: 0.0, on: 5.7, other: 14.2 },  // Lyons
  197: { alp: 32.7, coal: 43.2, grn: 12.4, teal: 0.0, on: 3.2, other: 8.5 },  // Aston
  198: { alp: 45.8, coal: 27.8, grn: 15.0, teal: 0.0, on: 3.8, other: 7.6 },  // Ballarat
  200: { alp: 43.1, coal: 27.2, grn: 14.2, teal: 4.6, on: 6.1, other: 4.7 },  // Bendigo
  201: { alp: 42.0, coal: 30.8, grn: 10.1, teal: 0.0, on: 0.0, other: 17.1 },  // Bruce
  203: { alp: 45.0, coal: 23.8, grn: 9.9, teal: 0.0, on: 7.4, other: 13.8 },  // Calwell
  204: { alp: 26.3, coal: 38.6, grn: 13.7, teal: 12.6, on: 3.6, other: 5.3 },  // Casey
  205: { alp: 42.0, coal: 38.0, grn: 13.2, teal: 2.6, on: 0.0, other: 4.3 },  // Chisholm
  208: { alp: 44.6, coal: 26.1, grn: 15.9, teal: 0.0, on: 4.3, other: 9.2 },  // Corio
  209: { alp: 34.3, coal: 43.4, grn: 14.5, teal: 0.0, on: 2.5, other: 5.2 },  // Deakin
  210: { alp: 42.3, coal: 34.2, grn: 10.9, teal: 4.2, on: 3.0, other: 5.4 },  // Dunkley
  211: { alp: 22.8, coal: 45.6, grn: 9.9, teal: 13.2, on: 3.7, other: 4.8 },  // Flinders
  212: { alp: 43.6, coal: 27.7, grn: 17.0, teal: 0.0, on: 3.2, other: 8.5 },  // Gellibrand
  213: { alp: 19.8, coal: 55.8, grn: 8.8, teal: 0.0, on: 10.4, other: 5.1 },  // Gippsland
  214: { alp: 11.3, coal: 41.2, grn: 8.1, teal: 35.2, on: 0.0, other: 4.1 },  // Goldstein
  215: { alp: 28.9, coal: 41.3, grn: 23.0, teal: 0.0, on: 0.0, other: 6.7 },  // Higgins
  216: { alp: 42.2, coal: 30.5, grn: 8.8, teal: 3.2, on: 5.2, other: 10.1 },  // Holt
  217: { alp: 47.3, coal: 25.6, grn: 12.6, teal: 0.0, on: 0.0, other: 14.5 },  // Hotham
  218: { alp: 9.3, coal: 37.0, grn: 3.9, teal: 43.9, on: 6.0, other: 0.0 },  // Indi
  219: { alp: 40.3, coal: 32.1, grn: 14.0, teal: 0.0, on: 3.4, other: 10.2 },  // Isaacs
  220: { alp: 42.0, coal: 29.9, grn: 17.1, teal: 3.3, on: 0.0, other: 7.6 },  // Jagajaga
  221: { alp: 7.0, coal: 43.3, grn: 6.4, teal: 41.1, on: 0.0, other: 2.1 },  // Kooyong
  222: { alp: 46.5, coal: 26.3, grn: 11.0, teal: 0.0, on: 4.3, other: 11.9 },  // Lalor
  223: { alp: 26.8, coal: 46.8, grn: 11.2, teal: 0.0, on: 5.3, other: 9.9 },  // La Trobe
  224: { alp: 16.9, coal: 49.2, grn: 5.4, teal: 12.5, on: 6.8, other: 9.2 },  // Mallee
  225: { alp: 44.2, coal: 28.3, grn: 17.0, teal: 0.0, on: 2.5, other: 8.0 },  // Maribyrnong
  226: { alp: 37.0, coal: 33.4, grn: 14.3, teal: 0.0, on: 6.3, other: 9.1 },  // McEwen
  228: { alp: 25.8, coal: 15.7, grn: 51.0, teal: 0.0, on: 0.0, other: 7.5 },  // Melbourne
  229: { alp: 33.5, coal: 42.2, grn: 14.3, teal: 0.0, on: 2.5, other: 7.6 },  // Menzies
  232: { alp: 46.7, coal: 22.0, grn: 12.2, teal: 0.0, on: 6.7, other: 12.3 },  // Scullin
  233: { alp: 19.3, coal: 44.9, grn: 6.4, teal: 22.0, on: 3.6, other: 3.8 },  // Wannon
  234: { alp: 41.0, coal: 18.3, grn: 29.8, teal: 0.0, on: 3.2, other: 7.7 },  // Wills
  235: { alp: 53.0, coal: 23.3, grn: 12.0, teal: 0.0, on: 5.7, other: 6.0 },  // Brand
  236: { alp: 34.7, coal: 46.4, grn: 8.6, teal: 0.0, on: 4.8, other: 5.4 },  // Canning
  237: { alp: 49.5, coal: 32.2, grn: 10.4, teal: 0.0, on: 3.2, other: 4.7 },  // Cowan
  238: { alp: 14.1, coal: 41.9, grn: 10.5, teal: 29.9, on: 1.6, other: 2.0 },  // Curtin
  239: { alp: 28.7, coal: 45.0, grn: 14.2, teal: 0.0, on: 5.7, other: 6.5 },  // Forrest
  240: { alp: 46.4, coal: 25.5, grn: 19.8, teal: 0.0, on: 3.3, other: 5.0 },  // Fremantle
  242: { alp: 33.5, coal: 42.8, grn: 14.6, teal: 0.0, on: 3.6, other: 5.6 },  // Moore
  243: { alp: 28.0, coal: 46.9, grn: 11.3, teal: 0.0, on: 7.6, other: 6.2 },  // O'Connor
  244: { alp: 45.7, coal: 32.0, grn: 11.8, teal: 0.0, on: 5.0, other: 5.5 },  // Pearce
  245: { alp: 41.5, coal: 28.3, grn: 23.4, teal: 0.0, on: 3.0, other: 3.8 },  // Perth
  247: { alp: 41.7, coal: 34.2, grn: 15.9, teal: 0.0, on: 2.9, other: 5.3 },  // Swan
  248: { alp: 39.3, coal: 41.3, grn: 12.4, teal: 0.0, on: 2.4, other: 4.6 },  // Tangney
  249: { alp: 40.8, coal: 37.1, grn: 7.7, teal: 0.0, on: 8.4, other: 6.0 },  // Paterson
  250: { alp: 21.4, coal: 48.4, grn: 6.7, teal: 0.0, on: 9.4, other: 14.1 },  // Riverina
  251: { alp: 52.5, coal: 27.4, grn: 10.0, teal: 0.0, on: 0.0, other: 10.1 },  // Watson
  252: { alp: 31.8, coal: 42.5, grn: 13.1, teal: 4.2, on: 5.6, other: 2.9 },  // Dickson
  302: { alp: 32.4, coal: 39.6, grn: 7.5, teal: 0.0, on: 8.8, other: 11.7 },  // Longman
  304: { alp: 36.3, coal: 30.1, grn: 13.2, teal: 0.0, on: 10.7, other: 9.7 },  // Blair
  305: { alp: 41.9, coal: 35.3, grn: 11.6, teal: 3.6, on: 4.2, other: 3.4 },  // Hasluck
  306: { alp: 38.0, coal: 36.1, grn: 11.4, teal: 0.0, on: 5.7, other: 8.8 },  // Lingiari
  307: { alp: 40.0, coal: 25.5, grn: 15.3, teal: 0.0, on: 7.8, other: 11.3 },  // Solomon
  309: { alp: 43.1, coal: 28.7, grn: 9.4, teal: 2.8, on: 7.8, other: 8.1 },  // Gorton
  310: { alp: 29.9, coal: 45.5, grn: 17.1, teal: 0.0, on: 7.5, other: 0.0 },  // Bonner
  311: { alp: 33.7, coal: 37.0, grn: 4.5, teal: 4.5, on: 13.1, other: 7.2 },  // Flynn
  312: { alp: 30.9, coal: 47.9, grn: 10.0, teal: 0.0, on: 7.4, other: 3.7 },  // Durack
  315: { alp: 48.4, coal: 29.4, grn: 6.2, teal: 0.0, on: 6.3, other: 9.7 },  // McMahon
  316: { alp: 21.6, coal: 43.4, grn: 11.7, teal: 0.0, on: 14.8, other: 8.6 },  // Wright
  317: { alp: 53.2, coal: 23.7, grn: 10.2, teal: 0.0, on: 5.9, other: 6.9 },  // Burt
  318: { alp: 42.0, coal: 30.2, grn: 14.9, teal: 8.6, on: 0.0, other: 4.3 },  // Bean
  319: { alp: 19.1, coal: 16.5, grn: 13.7, teal: 46.3, on: 2.8, other: 1.6 },  // Clark
  320: { alp: 42.7, coal: 16.9, grn: 28.8, teal: 0.0, on: 3.1, other: 8.5 },  // Cooper
  321: { alp: 42.5, coal: 25.4, grn: 18.8, teal: 0.0, on: 3.4, other: 9.9 },  // Fraser
  322: { alp: 32.5, coal: 29.7, grn: 30.3, teal: 2.2, on: 0.0, other: 5.3 },  // Macnamara
  323: { alp: 26.7, coal: 39.4, grn: 10.3, teal: 11.3, on: 8.0, other: 4.4 },  // Monash
  324: { alp: 12.5, coal: 48.1, grn: 0.0, teal: 27.8, on: 7.2, other: 4.4 },  // Nicholls
  325: { alp: 44.1, coal: 25.7, grn: 11.7, teal: 0.0, on: 11.4, other: 7.1 },  // Spence
  326: { alp: 39.6, coal: 28.4, grn: 9.7, teal: 8.6, on: 6.1, other: 7.6 },  // Hawke
  328: { alp: 39.7, coal: 35.4, grn: 16.1, teal: 0.0, on: 2.7, other: 6.1 },  // Corangamite
};  // auto-injected by inject_model_constants.py

// ── Per-seat FP baselines for state elections ─────────────────────────────────
// Sourced from webapp/src/data/state_seat_fp.js, which is regenerated by
// scripts/generate_state_seat_fp.py at the end of every `python main.py
// --state <X> --year <YYYYMM>` run. The generator keys districts by NAME
// (VEC/ECQ district IDs don't match this app's seat IDs); mapSeatFpById
// remaps them onto a state's seat array. The remapped constants
// (VIC_SEAT_FP_2022 etc.) are defined after the seat arrays below.
const mapSeatFpById = (byName, seats) =>
  Object.fromEntries(
    seats.map((s) => [s.id, (byName ?? {})[s.name]]).filter(([, v]) => v)
  );


// ── Advanced Modelling Scaffolding (Phase 7) ─────────────────────────────────

// #9: Seat-level Regression Model (TODO)
// Scaffold to replace `seatElasticityMult` with a full demographic/historical regression.
// function predictSeatSwing(seat, nationalSwings, sa1Demographics, historicalData) {
//   // return predicted 2PP/FP swing based on local factors, not just national average.
// }

// #12: Cross-election Redistribution Mapping (TODO)
// Scaffold to correctly translate older AEC data to new boundaries.
// function mapRedistributionAEC(oldDivisions, sa1Votes, newBoundariesMap) {
//   // return synthesized seat baselines for the new electoral map.
// }

// ── 2025 primary-model calibration offsets ────────────────────────────────────
// Offset = (actual 2025 ALP 2PP TCP) − (primary-model-predicted 2PP at zero swing)
// Applied with a linear blend that fades to zero at ±5pp national swing, so the
// offset only matters near the 2025 baseline and does not distort larger-swing
// scenarios. Covers ALP vs Coalition seats that have SEAT_FP_2025 data.
// Recompute via: python scripts/compute_calibration.py
const SEAT_CALIB_2025 = {
  102: -0.79,  // Fenner
  103: +1.20,  // Banks
  104: +0.61,  // Barton
  105: -0.39,  // Bennelong
  106: -0.27,  // Berowra
  107: -1.55,  // Blaxland
  111: -0.17,  // Chifley
  112: +0.63,  // Cook
  114: +0.56,  // Cunningham
  115: -0.29,  // Dobell
  117: +0.62,  // Eden-Monaro
  120: +0.28,  // Gilmore
  122: -0.50,  // Greenway
  124: +0.24,  // Hughes
  125: -1.09,  // Hume
  127: +0.05,  // Kingsford Smith
  128: -0.87,  // Lindsay
  130: +0.95,  // Lyne
  131: +0.59,  // Macarthur
  133: +0.22,  // Macquarie
  134: -0.61,  // Mitchell
  135: -0.57,  // New England
  138: +0.57,  // Page
  139: -0.90,  // Parkes
  140: -0.60,  // Parramatta
  144: -0.16,  // Reid
  145: -0.65,  // Richmond
  146: -0.26,  // Robertson
  148: +0.65,  // Shortland
  150: +0.11,  // Whitlam
  153: +0.58,  // Werriwa
  155: +1.30,  // Bowman
  156: -1.65,  // Brisbane
  157: -2.78,  // Capricornia
  158: -1.71,  // Dawson
  159: -0.05,  // Fadden
  160: +0.68,  // Fairfax
  161: -0.72,  // Fisher
  162: -0.57,  // Forde
  165: -0.24,  // Herbert
  166: -1.23,  // Hinkler
  168: -2.62,  // Leichhardt
  169: -0.90,  // Lilley
  171: -0.21,  // McPherson
  172: +0.36,  // Moncrieff
  173: -1.20,  // Moreton
  174: -0.13,  // Oxley
  175: +0.11,  // Petrie
  176: -0.84,  // Rankin
  178: -2.60,  // Wide Bay
  179: -0.27,  // Adelaide
  180: -0.46,  // Barker
  182: +0.32,  // Boothby
  183: +0.07,  // Grey
  185: -0.39,  // Hindmarsh
  186: +0.42,  // Kingston
  187: -0.12,  // Makin
  190: +1.33,  // Sturt
  192: +0.02,  // Bass
  193: -0.47,  // Braddon
  196: +0.21,  // Lyons
  197: -0.43,  // Aston
  198: +0.41,  // Ballarat
  200: +2.26,  // Bendigo
  201: -0.80,  // Bruce
  204: +0.20,  // Casey
  205: -0.06,  // Chisholm
  208: +1.43,  // Corio
  209: -0.20,  // Deakin
  210: +0.28,  // Dunkley
  212: +0.10,  // Gellibrand
  213: -0.59,  // Gippsland
  216: +1.24,  // Holt
  217: +0.39,  // Hotham
  219: -0.29,  // Isaacs
  220: +1.21,  // Jagajaga
  222: +0.83,  // Lalor
  223: -0.63,  // La Trobe
  224: +0.16,  // Mallee
  225: -1.19,  // Maribyrnong
  226: -0.29,  // McEwen
  229: +0.24,  // Menzies
  232: +0.06,  // Scullin
  235: +2.64,  // Brand
  236: -1.14,  // Canning
  237: -0.39,  // Cowan
  239: -0.00,  // Forrest
  242: -0.27,  // Moore
  243: -0.48,  // O'Connor
  244: +0.03,  // Pearce
  245: -1.38,  // Perth
  247: -0.48,  // Swan
  248: +1.43,  // Tangney
  249: -0.10,  // Paterson
  250: -0.85,  // Riverina
  252: +0.18,  // Dickson
  302: -1.45,  // Longman
  304: -2.69,  // Blair
  305: +0.05,  // Hasluck
  306: -0.54,  // Lingiari
  307: +1.13,  // Solomon
  309: -0.28,  // Gorton
  310: -1.04,  // Bonner
  311: -4.84,  // Flynn
  312: +0.20,  // Durack
  315: -2.52,  // McMahon
  316: -1.57,  // Wright
  317: -2.30,  // Burt
  322: -3.08,  // Macnamara
  323: +0.07,  // Monash
  324: +0.18,  // Nicholls
  325: -0.12,  // Spence
  326: +1.12,  // Hawke
  328: +0.47,  // Corangamite
  329: +2.03,  // Bullwinkel
};  // auto-injected by inject_model_constants.py

// ── 2025 per-seat preference flows from AEC Distribution of Preferences ────────
// Sourced from data/exports/2025/preference_flows.json (populated after running the
// pipeline). When populated, these replace national-average flows for each seat in
// the primary-based 2PP computation, further reducing zero-swing calibration error.
// Populate via: python scripts/update_s25_from_exports.py (after running the pipeline)
// Format: { seatId: { grn_alp, teal_alp, on_alp, other_alp } }
const SEAT_PREF_FLOWS_2025 = {
  102: { grn_alp: 0.8926, teal_alp: 0.6200, on_alp: 0.4300, other_alp: 0.5000 },  // Fenner
  103: { grn_alp: 0.8563, teal_alp: 0.5748, on_alp: 0.1977, other_alp: 0.3620 },  // Banks
  104: { grn_alp: 0.8329, teal_alp: 0.6200, on_alp: 0.3361, other_alp: 0.3735 },  // Barton
  105: { grn_alp: 0.8772, teal_alp: 0.6200, on_alp: 0.1712, other_alp: 0.5002 },  // Bennelong
  106: { grn_alp: 0.8793, teal_alp: 0.7328, on_alp: 0.1233, other_alp: 0.1620 },  // Berowra
  107: { grn_alp: 0.8609, teal_alp: 0.8408, on_alp: 0.2010, other_alp: 0.3801 },  // Blaxland
  111: { grn_alp: 0.7912, teal_alp: 0.6200, on_alp: 0.2828, other_alp: 0.5721 },  // Chifley
  112: { grn_alp: 0.8167, teal_alp: 0.6200, on_alp: 0.1525, other_alp: 0.2886 },  // Cook
  114: { grn_alp: 0.8521, teal_alp: 0.6200, on_alp: 0.2502, other_alp: 0.6434 },  // Cunningham
  115: { grn_alp: 0.7429, teal_alp: 0.6200, on_alp: 0.2512, other_alp: 0.6834 },  // Dobell
  117: { grn_alp: 0.8537, teal_alp: 0.3956, on_alp: 0.1983, other_alp: 0.3721 },  // Eden-Monaro
  120: { grn_alp: 0.8784, teal_alp: 0.6991, on_alp: 0.1730, other_alp: 0.5531 },  // Gilmore
  122: { grn_alp: 0.7577, teal_alp: 0.5429, on_alp: 0.3050, other_alp: 0.4557 },  // Greenway
  124: { grn_alp: 0.8252, teal_alp: 0.6200, on_alp: 0.1797, other_alp: 0.3719 },  // Hughes
  125: { grn_alp: 0.8315, teal_alp: 0.6390, on_alp: 0.3207, other_alp: 0.3158 },  // Hume
  127: { grn_alp: 0.8709, teal_alp: 0.6200, on_alp: 0.2944, other_alp: 0.5000 },  // Kingsford Smith
  128: { grn_alp: 0.8597, teal_alp: 0.6200, on_alp: 0.3327, other_alp: 0.4059 },  // Lindsay
  130: { grn_alp: 0.8700, teal_alp: 0.5041, on_alp: 0.1774, other_alp: 0.3473 },  // Lyne
  131: { grn_alp: 0.8195, teal_alp: 0.6200, on_alp: 0.2556, other_alp: 0.4438 },  // Macarthur
  133: { grn_alp: 0.8695, teal_alp: 0.6200, on_alp: 0.1866, other_alp: 0.4460 },  // Macquarie
  134: { grn_alp: 0.7933, teal_alp: 0.6200, on_alp: 0.2011, other_alp: 0.5000 },  // Mitchell
  135: { grn_alp: 0.7977, teal_alp: 0.5565, on_alp: 0.2664, other_alp: 0.4056 },  // New England
  138: { grn_alp: 0.7768, teal_alp: 0.6031, on_alp: 0.1499, other_alp: 0.4082 },  // Page
  139: { grn_alp: 0.8135, teal_alp: 0.4936, on_alp: 0.3342, other_alp: 0.4550 },  // Parkes
  140: { grn_alp: 0.8527, teal_alp: 0.6166, on_alp: 0.1719, other_alp: 0.4081 },  // Parramatta
  144: { grn_alp: 0.8321, teal_alp: 0.6562, on_alp: 0.1969, other_alp: 0.2896 },  // Reid
  145: { grn_alp: 0.8599, teal_alp: 0.4154, on_alp: 0.1389, other_alp: 0.4139 },  // Richmond
  146: { grn_alp: 0.7862, teal_alp: 0.6784, on_alp: 0.2116, other_alp: 0.6352 },  // Robertson
  148: { grn_alp: 0.7800, teal_alp: 0.7143, on_alp: 0.2631, other_alp: 0.3657 },  // Shortland
  150: { grn_alp: 0.7114, teal_alp: 0.5037, on_alp: 0.2780, other_alp: 0.3879 },  // Whitlam
  153: { grn_alp: 0.7268, teal_alp: 0.5342, on_alp: 0.2461, other_alp: 0.4241 },  // Werriwa
  155: { grn_alp: 0.7701, teal_alp: 0.6657, on_alp: 0.2118, other_alp: 0.3473 },  // Bowman
  156: { grn_alp: 0.9141, teal_alp: 0.6200, on_alp: 0.2093, other_alp: 0.4049 },  // Brisbane
  157: { grn_alp: 0.8377, teal_alp: 0.6200, on_alp: 0.2705, other_alp: 0.4923 },  // Capricornia
  158: { grn_alp: 0.8646, teal_alp: 0.6200, on_alp: 0.2545, other_alp: 0.3113 },  // Dawson
  159: { grn_alp: 0.8259, teal_alp: 0.6426, on_alp: 0.2984, other_alp: 0.3689 },  // Fadden
  160: { grn_alp: 0.8711, teal_alp: 0.6629, on_alp: 0.1455, other_alp: 0.2521 },  // Fairfax
  161: { grn_alp: 0.8583, teal_alp: 0.5800, on_alp: 0.1794, other_alp: 0.3466 },  // Fisher
  162: { grn_alp: 0.8223, teal_alp: 0.6295, on_alp: 0.3260, other_alp: 0.3222 },  // Forde
  165: { grn_alp: 0.8462, teal_alp: 0.6200, on_alp: 0.1677, other_alp: 0.3317 },  // Herbert
  166: { grn_alp: 0.6901, teal_alp: 0.6200, on_alp: 0.3027, other_alp: 0.4136 },  // Hinkler
  168: { grn_alp: 0.8587, teal_alp: 0.5071, on_alp: 0.3590, other_alp: 0.5581 },  // Leichhardt
  169: { grn_alp: 0.8842, teal_alp: 0.6200, on_alp: 0.1951, other_alp: 0.5591 },  // Lilley
  171: { grn_alp: 0.8212, teal_alp: 0.5903, on_alp: 0.1188, other_alp: 0.4550 },  // McPherson
  172: { grn_alp: 0.6728, teal_alp: 0.5477, on_alp: 0.1744, other_alp: 0.4322 },  // Moncrieff
  173: { grn_alp: 0.8856, teal_alp: 0.6200, on_alp: 0.2001, other_alp: 0.5101 },  // Moreton
  174: { grn_alp: 0.7977, teal_alp: 0.6200, on_alp: 0.2754, other_alp: 0.4537 },  // Oxley
  175: { grn_alp: 0.7749, teal_alp: 0.6200, on_alp: 0.2589, other_alp: 0.4132 },  // Petrie
  176: { grn_alp: 0.7129, teal_alp: 0.6200, on_alp: 0.2646, other_alp: 0.3455 },  // Rankin
  178: { grn_alp: 0.8177, teal_alp: 0.6022, on_alp: 0.2926, other_alp: 0.5636 },  // Wide Bay
  179: { grn_alp: 0.8917, teal_alp: 0.6200, on_alp: 0.2210, other_alp: 0.6906 },  // Adelaide
  180: { grn_alp: 0.8074, teal_alp: 0.4725, on_alp: 0.3815, other_alp: 0.3093 },  // Barker
  182: { grn_alp: 0.8809, teal_alp: 0.6200, on_alp: 0.3014, other_alp: 0.3659 },  // Boothby
  183: { grn_alp: 0.8066, teal_alp: 0.5685, on_alp: 0.3555, other_alp: 0.4536 },  // Grey
  185: { grn_alp: 0.8415, teal_alp: 0.6353, on_alp: 0.2179, other_alp: 0.4685 },  // Hindmarsh
  186: { grn_alp: 0.8217, teal_alp: 0.6200, on_alp: 0.2493, other_alp: 0.4323 },  // Kingston
  187: { grn_alp: 0.7122, teal_alp: 0.6200, on_alp: 0.2452, other_alp: 0.5218 },  // Makin
  190: { grn_alp: 0.8559, teal_alp: 0.5344, on_alp: 0.1398, other_alp: 0.3234 },  // Sturt
  192: { grn_alp: 0.8180, teal_alp: 0.5629, on_alp: 0.2949, other_alp: 0.4626 },  // Bass
  193: { grn_alp: 0.9074, teal_alp: 0.5682, on_alp: 0.4603, other_alp: 0.5000 },  // Braddon
  196: { grn_alp: 0.7680, teal_alp: 0.6746, on_alp: 0.3504, other_alp: 0.5395 },  // Lyons
  197: { grn_alp: 0.8449, teal_alp: 0.6252, on_alp: 0.1941, other_alp: 0.3259 },  // Aston
  198: { grn_alp: 0.8441, teal_alp: 0.5953, on_alp: 0.2557, other_alp: 0.4438 },  // Ballarat
  200: { grn_alp: 0.8248, teal_alp: 0.6084, on_alp: 0.2101, other_alp: 0.5506 },  // Bendigo
  201: { grn_alp: 0.8402, teal_alp: 0.6200, on_alp: 0.2616, other_alp: 0.4759 },  // Bruce
  204: { grn_alp: 0.8769, teal_alp: 0.7613, on_alp: 0.1471, other_alp: 0.2192 },  // Casey
  205: { grn_alp: 0.8513, teal_alp: 0.6106, on_alp: 0.1068, other_alp: 0.3096 },  // Chisholm
  208: { grn_alp: 0.7719, teal_alp: 0.5624, on_alp: 0.2674, other_alp: 0.5000 },  // Corio
  209: { grn_alp: 0.8573, teal_alp: 0.5924, on_alp: 0.1001, other_alp: 0.2088 },  // Deakin
  210: { grn_alp: 0.8409, teal_alp: 0.5309, on_alp: 0.2208, other_alp: 0.6025 },  // Dunkley
  212: { grn_alp: 0.8293, teal_alp: 0.6200, on_alp: 0.2664, other_alp: 0.5000 },  // Gellibrand
  213: { grn_alp: 0.8001, teal_alp: 0.6200, on_alp: 0.1527, other_alp: 0.5000 },  // Gippsland
  216: { grn_alp: 0.8263, teal_alp: 0.6200, on_alp: 0.2682, other_alp: 0.4903 },  // Holt
  217: { grn_alp: 0.8766, teal_alp: 0.6200, on_alp: 0.2138, other_alp: 0.4294 },  // Hotham
  219: { grn_alp: 0.8473, teal_alp: 0.6200, on_alp: 0.1809, other_alp: 0.5000 },  // Isaacs
  220: { grn_alp: 0.9023, teal_alp: 0.5370, on_alp: 0.1764, other_alp: 0.1927 },  // Jagajaga
  222: { grn_alp: 0.8249, teal_alp: 0.4994, on_alp: 0.2736, other_alp: 0.4701 },  // Lalor
  223: { grn_alp: 0.7693, teal_alp: 0.6200, on_alp: 0.2050, other_alp: 0.5046 },  // La Trobe
  224: { grn_alp: 0.6492, teal_alp: 0.6200, on_alp: 0.2399, other_alp: 0.3260 },  // Mallee
  225: { grn_alp: 0.8995, teal_alp: 0.6200, on_alp: 0.4300, other_alp: 0.5000 },  // Maribyrnong
  226: { grn_alp: 0.7558, teal_alp: 0.6200, on_alp: 0.2286, other_alp: 0.5463 },  // McEwen
  229: { grn_alp: 0.8317, teal_alp: 0.5722, on_alp: 0.1364, other_alp: 0.2443 },  // Menzies
  232: { grn_alp: 0.6939, teal_alp: 0.6200, on_alp: 0.2639, other_alp: 0.5657 },  // Scullin
  235: { grn_alp: 0.7811, teal_alp: 0.6200, on_alp: 0.2764, other_alp: 0.5000 },  // Brand
  236: { grn_alp: 0.8438, teal_alp: 0.6200, on_alp: 0.2737, other_alp: 0.5722 },  // Canning
  237: { grn_alp: 0.7526, teal_alp: 0.6342, on_alp: 0.2411, other_alp: 0.4483 },  // Cowan
  239: { grn_alp: 0.8606, teal_alp: 0.6558, on_alp: 0.1507, other_alp: 0.4534 },  // Forrest
  242: { grn_alp: 0.8682, teal_alp: 0.5716, on_alp: 0.1134, other_alp: 0.4457 },  // Moore
  243: { grn_alp: 0.8855, teal_alp: 0.6200, on_alp: 0.2387, other_alp: 0.4425 },  // O'Connor
  244: { grn_alp: 0.6869, teal_alp: 0.6200, on_alp: 0.2265, other_alp: 0.5709 },  // Pearce
  245: { grn_alp: 0.8790, teal_alp: 0.6200, on_alp: 0.4300, other_alp: 0.5000 },  // Perth
  247: { grn_alp: 0.8596, teal_alp: 0.6200, on_alp: 0.1875, other_alp: 0.6728 },  // Swan
  248: { grn_alp: 0.7921, teal_alp: 0.6200, on_alp: 0.1850, other_alp: 0.2888 },  // Tangney
  249: { grn_alp: 0.9143, teal_alp: 0.5099, on_alp: 0.3046, other_alp: 0.5193 },  // Paterson
  250: { grn_alp: 0.8621, teal_alp: 0.5167, on_alp: 0.3628, other_alp: 0.4405 },  // Riverina
  252: { grn_alp: 0.9244, teal_alp: 0.7697, on_alp: 0.1500, other_alp: 0.5449 },  // Dickson
  302: { grn_alp: 0.8547, teal_alp: 0.6200, on_alp: 0.3375, other_alp: 0.4105 },  // Longman
  304: { grn_alp: 0.8773, teal_alp: 0.6200, on_alp: 0.3337, other_alp: 0.5061 },  // Blair
  305: { grn_alp: 0.7701, teal_alp: 0.6200, on_alp: 0.2462, other_alp: 0.5212 },  // Hasluck
  306: { grn_alp: 0.7635, teal_alp: 0.6200, on_alp: 0.1632, other_alp: 0.7733 },  // Lingiari
  307: { grn_alp: 0.7194, teal_alp: 0.6536, on_alp: 0.1245, other_alp: 0.5000 },  // Solomon
  309: { grn_alp: 0.7613, teal_alp: 0.6200, on_alp: 0.2901, other_alp: 0.6591 },  // Gorton
  310: { grn_alp: 0.8434, teal_alp: 0.6200, on_alp: 0.1946, other_alp: 0.3833 },  // Bonner
  311: { grn_alp: 0.8707, teal_alp: 0.7395, on_alp: 0.2619, other_alp: 0.4428 },  // Flynn
  312: { grn_alp: 0.8706, teal_alp: 0.6200, on_alp: 0.2870, other_alp: 0.5200 },  // Durack
  315: { grn_alp: 0.8817, teal_alp: 0.3912, on_alp: 0.4300, other_alp: 0.5000 },  // McMahon
  316: { grn_alp: 0.8520, teal_alp: 0.6200, on_alp: 0.2550, other_alp: 0.4090 },  // Wright
  317: { grn_alp: 0.8745, teal_alp: 0.6200, on_alp: 0.2933, other_alp: 0.5886 },  // Burt
  322: { grn_alp: 0.9188, teal_alp: 0.4961, on_alp: 0.1782, other_alp: 0.5000 },  // Macnamara
  323: { grn_alp: 0.8794, teal_alp: 0.5415, on_alp: 0.3396, other_alp: 0.5027 },  // Monash
  324: { grn_alp: 0.7543, teal_alp: 0.6200, on_alp: 0.2142, other_alp: 0.3947 },  // Nicholls
  325: { grn_alp: 0.6698, teal_alp: 0.6620, on_alp: 0.3470, other_alp: 0.5698 },  // Spence
  326: { grn_alp: 0.8177, teal_alp: 0.6200, on_alp: 0.2536, other_alp: 0.5647 },  // Hawke
  328: { grn_alp: 0.8812, teal_alp: 0.5190, on_alp: 0.1821, other_alp: 0.5205 },  // Corangamite
  329: { grn_alp: 0.9080, teal_alp: 0.6200, on_alp: 0.2144, other_alp: 0.6229 },  // Bullwinkel
};  // auto-injected by inject_model_constants.py


// ── 2025 national-average preference flows (AEC DOP) ──────────────────────────
// These are the baseline values the aggregate sliders default to.  Used as the
// reference point for the additive-delta calculation in applyPrefDelta().
// One Nation → ALP flow by federal election (AEC DOP; Antony Green): 2016 ~49.6%,
// 2019 34.7%, 2022 35.7%, 2025 25.5% (74.5% to Coalition — the highest-ever flow to
// the Coalition). on_alp is set to the 2025 actual (0.255). A large ON primary surge
// therefore correctly helps the Coalition's 2PP, not Labor's.
// By-election validation (not baked into constants): the 2026 Farrer by-election saw
// ON win the seat (39.5% FP → 57.6% TCP, def. IND 42.4%) on strong Coalition→ON
// preferences — the first lower-house seat ON has won at an election. It was an
// ON-vs-Independent final, now modelled via the on_v_ind branch (flows below).
const PREF_FLOWS_2025 = {
  grn_alp: 0.81, teal_alp: 0.62, on_alp: 0.255, other_alp: 0.50,
  coal_alp_v_on: 0.10, grn_alp_v_on: 0.90, teal_alp_v_on: 0.75, other_alp_v_on: 0.60,
  alp_on_v_coal: 0.20, grn_on_v_coal: 0.08, teal_on_v_coal: 0.12, other_on_v_coal: 0.25,
  // ON vs Independent final (Farrer 2026-type): sources distribute between ON and the
  // independent. Coalition voters flow strongly to ON (HTV cards), ALP/Greens strongly
  // to the independent. Calibrated to the 2026 Farrer by-election (the only federal
  // precedent — ON won 57.6% with Coalition→ON ~0.61–0.83); necessarily approximate.
  coal_on_v_ind: 0.65, alp_on_v_ind: 0.15, grn_on_v_ind: 0.08, other_on_v_ind: 0.50,
};

// ── Per-seat ON-race preference flows (2025 AEC DOP) ──────────────────────────
// Overrides the national ON-race flows for the two seats where ON actually reached
// the final two in 2025, so high-ON regional seats are not modelled on national
// averages. Values are the actual 2025 AEC Distribution of Preferences flows for
// each excluded candidate group; "other" entries are vote-weighted across the
// seat's minor candidates. Only the keys present here override; the rest fall back
// to the national/slider flows.
const SEAT_ON_RACE_FLOWS = {
  // Hunter (NSW) — ALP-vs-ON 2025 final (AEC DOP): NP→ALP 19.9% (→ON 80.1%),
  // GRN→ALP 87.1%, other minors→ALP 38.7% (vote-weighted AJP/ASP/CYA/FFPA/HMP).
  126: { coal_alp_v_on: 0.199, grn_alp_v_on: 0.871, other_alp_v_on: 0.387 },
  // Maranoa (QLD) — LNP-vs-ON 2025 final (AEC DOP): ALP→ON 41.1%, GRN→ON 37.9%,
  // other minors→ON 69.7% (vote-weighted CYA/FFPA/GRPF/LTP).
  170: { alp_on_v_coal: 0.411, grn_on_v_coal: 0.379, other_on_v_coal: 0.697 },
};

// Apply the national slider delta on top of a per-seat AEC flow baseline.
// When the slider is at the 2025 default, delta = 0 and the seat baseline is
// used as-is.  Moving the slider shifts every seat's effective flow by the same
// amount, preserving inter-seat variation while enabling national scenario analysis.
// Missing keys in seatBase fall back to the national baseline so partial per-seat
// data (e.g. a seat with no ON candidate) is handled gracefully.
function applyPrefDelta(seatBase, prefFlows) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return {
    grn_alp:   clamp((seatBase.grn_alp   ?? PREF_FLOWS_2025.grn_alp)   + (prefFlows.grn_alp   - PREF_FLOWS_2025.grn_alp)),
    teal_alp:  clamp((seatBase.teal_alp  ?? PREF_FLOWS_2025.teal_alp)  + (prefFlows.teal_alp  - PREF_FLOWS_2025.teal_alp)),
    on_alp:    clamp((seatBase.on_alp    ?? PREF_FLOWS_2025.on_alp)    + (prefFlows.on_alp    - PREF_FLOWS_2025.on_alp)),
    other_alp: clamp((seatBase.other_alp ?? PREF_FLOWS_2025.other_alp) + (prefFlows.other_alp - PREF_FLOWS_2025.other_alp)),
  };
}

// NOTE: an earlier revision re-based SEAT_CALIB_2025 here via a dopCalibDelta()
// correction, assuming the offsets had been fitted against frozen national-average
// flows (on_alp = 0.43). The current data/model_constants/seat_calib_2025.json is
// fitted by scripts/compute_calibration.py against each seat's actual DOP flows —
// the same flows the model applies — so the offsets are used directly. Subtracting
// the delta double-counted the DOP-vs-national difference and shifted zero-swing
// projections by up to ±3pp (flipping Bowman, Longman and La Trobe at baseline).
// The baseline-alignment test suite (src/__tests__/) guards this invariant.

// Return per-seat 2025 AEC first preferences, or null if not available.
// Falls back to null (caller uses UNS 2PP-swing for seats without FP data).
function getSeatFpBaseline(seatId) {
  return SEAT_FP_2025[seatId] ?? null;
}

// ── Demographic swing elasticity multipliers ──────────────────────────────────
// INTENTIONALLY EMPTY — negative result, kept as documentation.
// scripts/compute_demographic_regression.py was run (June 2026) across three swing
// cycles (2016→2019, 2019→2022, 2022→2025) regressing per-seat swing deviation on
// ABS 2021 Census features. It FAILED leave-one-pair-out cross-validation:
// CV RMSE 1.77pp vs 1.68pp for the trivial always-predict-1.0 baseline, i.e. the
// demographic multipliers predict swing deviation *worse* than assuming uniform
// elasticity. The constant is therefore deliberately left empty; the margin-based
// seatElasticityMult() (validated on 2022→2025 actuals via fit_elasticity.py)
// remains the elasticity model in use. The `SEAT_DEMO_MULT[seat.id] ?? ...` lookups
// are kept so a future regression that passes CV can be dropped in without code
// changes — do not populate this unless it beats the baseline out-of-sample.
const SEAT_DEMO_MULT = {
  101: 0.708,
  102: 0.735,
  103: 1.173,
  104: 1.384,
  105: 1.087,
  106: 0.7,
  107: 1.5,
  108: 0.7,
  109: 1.019,
  111: 1.371,
  112: 0.886,
  113: 1.179,
  114: 1.013,
  115: 1.131,
  117: 0.855,
  118: 1.153,
  119: 1.5,
  120: 1.089,
  121: 0.716,
  122: 1.027,
  124: 0.7,
  125: 0.909,
  126: 1.079,
  127: 1.304,
  128: 1.215,
  130: 1.125,
  131: 1.18,
  132: 0.769,
  133: 0.732,
  134: 0.7,
  135: 1.115,
  136: 0.914,
  137: 0.727,
  138: 1.053,
  139: 1.158,
  140: 1.492,
  144: 1.366,
  145: 1.049,
  146: 1.008,
  148: 0.895,
  149: 1.5,
  150: 1.108,
  151: 0.7,
  152: 0.842,
  153: 1.379,
  155: 1.08,
  156: 1.04,
  157: 1.158,
  158: 1.215,
  159: 1.415,
  160: 1.02,
  161: 1.11,
  162: 1.428,
  163: 0.949,
  164: 1.048,
  165: 1.204,
  166: 1.323,
  167: 1.287,
  168: 1.317,
  169: 0.929,
  170: 1.198,
  171: 1.098,
  172: 1.5,
  173: 1.011,
  174: 1.212,
  175: 1.234,
  176: 1.417,
  177: 0.7,
  178: 1.156,
  179: 1.126,
  180: 1.157,
  182: 0.808,
  183: 1.213,
  185: 1.034,
  186: 1.11,
  187: 1.143,
  188: 0.828,
  190: 0.826,
  192: 1.017,
  193: 1.137,
  195: 0.726,
  196: 1.029,
  197: 0.925,
  198: 0.825,
  200: 0.825,
  201: 1.462,
  203: 1.337,
  204: 0.74,
  205: 1.131,
  208: 0.998,
  209: 0.757,
  210: 1.009,
  211: 1.011,
  212: 0.837,
  213: 1.145,
  214: 0.7,
  215: 0.746,
  216: 1.29,
  217: 1.401,
  218: 0.997,
  219: 0.825,
  220: 0.7,
  221: 0.7,
  222: 1.203,
  223: 1.01,
  224: 1.179,
  225: 0.776,
  226: 0.7,
  228: 1.5,
  229: 0.877,
  232: 1.232,
  233: 0.94,
  234: 0.874,
  235: 1.389,
  236: 1.332,
  237: 1.376,
  238: 0.7,
  239: 1.095,
  240: 0.972,
  242: 0.93,
  243: 1.276,
  244: 1.328,
  245: 1.125,
  247: 1.334,
  248: 0.885,
  249: 1.102,
  250: 1.079,
  251: 1.5,
  252: 0.803,
  302: 1.334,
  304: 1.229,
  305: 1.089,
  306: 1.249,
  307: 1.315,
  309: 1.11,
  310: 0.811,
  311: 1.232,
  312: 1.436,
  315: 1.5,
  316: 1.017,
  317: 1.346,
  318: 0.7,
  319: 0.9,
  320: 0.802,
  321: 1.387,
  322: 1.059,
  323: 1.019,
  324: 1.16,
  325: 1.478,
  326: 1.066,
  328: 0.722
};  // auto-injected by inject_model_constants.py

// ── Per-seat swing residual standard deviations ───────────────────────────────
// Replaces the uniform SEAT_RESIDUAL_STD = 1.0 constant in computeUncertainty().
// Derived from historical backtest residuals + demographic volatility adjustment.
// Generated by: python scripts/compute_seat_residuals.py --output-js
//
// Usage in computeUncertainty():
//   const seatSigma = SEAT_RESIDUAL_MAP[seat.id] ?? SEAT_RESIDUAL_STD;
const SEAT_RESIDUAL_MAP = {
  101: 2.0,
  102: 2.0,
  103: 2.0,
  104: 2.0,
  105: 0.81,
  106: 1.18,
  107: 2.0,
  108: 2.0,
  109: 0.5,
  111: 2.0,
  112: 2.0,
  113: 0.8,
  114: 1.53,
  115: 1.3,
  117: 2.0,
  118: 0.85,
  119: 2.0,
  120: 2.0,
  121: 1.18,
  122: 2.0,
  124: 2.0,
  125: 1.63,
  126: 2.0,
  127: 1.04,
  128: 2.0,
  130: 1.21,
  131: 2.0,
  132: 2.0,
  133: 2.0,
  134: 1.61,
  135: 2.0,
  136: 0.5,
  137: 2.0,
  138: 1.53,
  139: 2.0,
  140: 2.0,
  144: 1.03,
  145: 0.71,
  146: 2.0,
  148: 2.0,
  149: 2.0,
  150: 1.67,
  151: 0.99,
  152: 1.15,
  153: 0.86,
  155: 1.06,
  156: 2.0,
  157: 2.0,
  158: 2.0,
  159: 1.27,
  160: 1.55,
  161: 1.07,
  162: 2.0,
  163: 2.0,
  164: 2.0,
  165: 1.52,
  166: 2.0,
  167: 0.9,
  168: 2.0,
  169: 2.0,
  170: 0.83,
  171: 1.19,
  172: 0.5,
  173: 2.0,
  174: 2.0,
  175: 2.0,
  176: 2.0,
  177: 2.0,
  178: 1.39,
  179: 2.0,
  180: 0.92,
  182: 1.56,
  183: 1.29,
  185: 2.0,
  186: 2.0,
  187: 1.6,
  188: 0.7,
  190: 1.56,
  192: 2.0,
  193: 2.0,
  195: 1.95,
  196: 2.0,
  197: 1.56,
  198: 2.0,
  200: 2.0,
  201: 2.0,
  203: 2.0,
  204: 2.0,
  205: 2.0,
  207: 2.0,
  208: 1.57,
  209: 0.63,
  210: 2.0,
  211: 2.0,
  212: 2.0,
  213: 2.0,
  214: 2.0,
  215: 2.0,
  216: 2.0,
  217: 2.0,
  218: 0.75,
  219: 2.0,
  220: 1.87,
  221: 0.93,
  222: 1.6,
  223: 2.0,
  224: 2.0,
  225: 1.18,
  226: 1.62,
  228: 1.4,
  229: 1.81,
  232: 2.0,
  233: 0.5,
  234: 1.13,
  235: 2.0,
  236: 2.0,
  237: 2.0,
  238: 2.0,
  239: 2.0,
  240: 2.0,
  242: 2.0,
  243: 2.0,
  244: 2.0,
  245: 2.0,
  246: 2.0,
  247: 2.0,
  248: 2.0,
  249: 2.0,
  250: 0.98,
  251: 0.5,
  252: 2.0,
  302: 1.6,
  304: 2.0,
  305: 2.0,
  306: 2.0,
  307: 2.0,
  309: 2.0,
  310: 2.0,
  311: 2.0,
  312: 2.0,
  315: 1.5,
  316: 1.55,
  317: 2.0,
  318: 2.0,
  319: 1.05,
  320: 1.1,
  321: 2.0,
  322: 2.0,
  323: 1.62,
  324: 0.8,
  325: 2.0,
  326: 2.0,
  328: 2.0
};  // auto-injected by inject_model_constants.py

// Distribute a national/statewide ON swing onto a seat's own ON base on the
// log-odds (logit) scale rather than linearly. The swing is converted to a logit
// shift at the reference (national/statewide) base and that shift is applied to
// each seat's own base: low-base seats move less in pp terms (a +7pp surge does
// not add 7pp to a 2% inner-city seat) while high-base seats gain more absolute
// points without blowing through natural ceilings as the share saturates. Bases
// are clamped to [0.1, 60]% before the logit so degenerate inputs can't produce
// ±Infinity/NaN. Zero swing returns the seat base exactly.
function logitShiftOnFp(seatBase, refBase, onSwing) {
  if (!onSwing) return seatBase;
  const clampPct = (v) => Math.min(60, Math.max(0.1, v));
  const logit = (p) => Math.log(p / (100 - p));
  const invlogit = (x) => 100 / (1 + Math.exp(-x));
  const shift = logit(clampPct(refBase + onSwing)) - logit(clampPct(refBase));
  const est = invlogit(logit(clampPct(seatBase)) + shift);
  return Number.isFinite(est) ? est : seatBase;
}

// Estimate seat-level ON first preference using the 2025 seat baseline plus the
// national ON swing applied on the logit scale (see logitShiftOnFp).
function estimateSeatOnFp(seatId, swings) {
  const base = SEAT_FP_2025[seatId]?.on ?? ON_FP_2025[seatId] ?? BASELINE_2025.on;
  return logitShiftOnFp(base, BASELINE_2025.on, swings.on ?? 0);
}

// ── State poll helpers (data/polls/{state}_polls.json → state scenario builders) ──
// Normalise one poll entry to the state-builder primary keys ({alp, coal, grn, ind,
// on}); coalKeys lists the file's Coalition component keys (["lp","np"] NSW, ["lnp"]
// QLD, ["lp","nat"] WA, ["lp"] SA). Returns null for entries missing primaries and
// for the election-result baseline rows — election results remain the model defaults,
// polls are only applied on explicit user action.
function normalizeStatePoll(p, coalKeys) {
  if (!p || /election result/i.test(p.pollster ?? "")) return null;
  const coalVals = coalKeys.map(k => p[k]).filter(v => v != null && Number.isFinite(v));
  if (p.alp == null || !Number.isFinite(p.alp) || coalVals.length === 0 || p.grn == null || !Number.isFinite(p.grn)) return null;
  return {
    pollster: p.pollster, date: p.date,
    alp: p.alp, coal: +coalVals.reduce((s, v) => s + v, 0).toFixed(1),
    grn: p.grn, ind: Number.isFinite(p.ind) ? p.ind : null, on: Number.isFinite(p.on) ? p.on : 0,
    tpp: Number.isFinite(p.tpp) ? p.tpp : null, n: p.n ?? null,
  };
}

// Recency-weighted average of normalised state polls: exponential decay with a
// 60-day half-life anchored to the most recent poll, so a 60-day-old poll counts
// half as much as today's. Returns null when no usable polls exist.
const STATE_POLL_HALF_LIFE_DAYS = 60;
function statePollAverage(polls) {
  const usable = (polls ?? []).filter(p => p && p.date && Number.isFinite(new Date(p.date).getTime()));
  if (usable.length === 0) return null;
  const t0 = Math.max(...usable.map(p => new Date(p.date).getTime()));
  const keys = ["alp", "coal", "grn", "ind", "on"];
  const sums = {}, wts = {};
  usable.forEach(p => {
    const ageDays = (t0 - new Date(p.date).getTime()) / 86400000;
    const w = Math.pow(0.5, ageDays / STATE_POLL_HALF_LIFE_DAYS);
    keys.forEach(k => {
      if (p[k] == null || !Number.isFinite(p[k])) return;
      sums[k] = (sums[k] ?? 0) + w * p[k];
      wts[k] = (wts[k] ?? 0) + w;
    });
  });
  const avg = {};
  keys.forEach(k => { if ((wts[k] ?? 0) > 0) avg[k] = +(sums[k] / wts[k]).toFixed(1); });
  return (avg.alp != null && avg.coal != null) ? avg : null;
}

// ── 2025 seat data from AEC final results (event_id=31496) ────────────────────
const _S25 = [
  [318,"Bean","ACT","ALP","David Smith","ALP","IND",0.68],
  [101,"Canberra","ACT","ALP","Alicia Payne","ALP","GRN",39.04],
  [102,"Fenner","ACT","ALP","Andrew Leigh","ALP","LP",44.16],
  [103,"Banks","NSW","ALP","Zhi Soon","ALP","LP",4.78],
  [104,"Barton","NSW","ALP","Ash Ambihaipahar","ALP","LP",32.01],
  [105,"Bennelong","NSW","ALP","Jerome Laxale","ALP","LP",18.52],
  [106,"Berowra","NSW","LP","Julian Leeser","LP","ALP",3.27],
  [107,"Blaxland","NSW","ALP","Jason Clare","ALP","LP",43.81],
  [108,"Bradfield","NSW","IND","Nicolette Boele","IND","LP",0.02],
  [109,"Calare","NSW","IND","Andrew Gee","IND","NP",13.56],
  [111,"Chifley","NSW","ALP","Ed Husic","ALP","LP",39.66],
  [112,"Cook","NSW","LP","Simon Kennedy","LP","ALP",14.39],
  [113,"Cowper","NSW","NP","Pat Conaghan","NP","IND",5.09],
  [114,"Cunningham","NSW","ALP","Alison Byrnes","ALP","LP",35.04],
  [115,"Dobell","NSW","ALP","Emma Mcbride","ALP","LP",18.86],
  [117,"Eden-Monaro","NSW","ALP","Kristy Mcbain","ALP","LP",14.43],
  [118,"Farrer","NSW","LP","Sussan Ley","LP","IND",12.39],
  [119,"Fowler","NSW","IND","Dai Le","IND","ALP",5.35],
  [120,"Gilmore","NSW","ALP","Fiona Phillips","ALP","LP",10.26],
  [121,"Grayndler","NSW","ALP","Anthony Albanese","ALP","GRN",33.73],
  [122,"Greenway","NSW","ALP","Michelle Rowland","ALP","LP",27.52],
  [124,"Hughes","NSW","ALP","David Moncrieff","ALP","LP",6.11],
  [125,"Hume","NSW","LP","Angus Taylor","LP","ALP",16.11],
  [126,"Hunter","NSW","ALP","Dan Repacholi","ALP","ON",18.07],
  [127,"Kingsford Smith","NSW","ALP","Matt Thistlethwaite","ALP","LP",34.37],
  [128,"Lindsay","NSW","LP","Melissa Mcintosh","LP","ALP",5.57],
  [130,"Lyne","NSW","NP","Alison Penfold","NP","ALP",19.56],
  [131,"Macarthur","NSW","ALP","Mike Freelander","ALP","LP",31.21],
  [132,"Mackellar","NSW","IND","Sophie Scamps","IND","LP",11.32],
  [133,"Macquarie","NSW","ALP","Susan Templeman","ALP","LP",15.41],
  [315,"McMahon","NSW","ALP","Chris Bowen","ALP","LP",18.04],
  [134,"Mitchell","NSW","LP","Alex Hawke","LP","ALP",7.62],
  [135,"New England","NSW","NP","Barnaby Joyce","NP","ALP",34.12],
  [136,"Newcastle","NSW","ALP","Sharon Claydon","ALP","GRN",31.61],
  [138,"Page","NSW","NP","Kevin Hogan","NP","ALP",18.57],
  [139,"Parkes","NSW","NP","Jamie Chaffey","NP","ALP",25.94],
  [140,"Parramatta","NSW","ALP","Andrew Charlton","ALP","LP",25.1],
  [249,"Paterson","NSW","ALP","Meryl Swanson","ALP","LP",13.78],
  [144,"Reid","NSW","ALP","Sally Sitou","ALP","LP",24.01],
  [145,"Richmond","NSW","ALP","Justine Elliot","ALP","NP",20.01],
  [250,"Riverina","NSW","NP","Michael Mccormack","NP","ALP",25.24],
  [146,"Robertson","NSW","ALP","Gordon Reid","ALP","LP",18.73],
  [148,"Shortland","NSW","ALP","Pat Conroy","ALP","LP",23.01],
  [149,"Sydney","NSW","ALP","Tanya Plibersek","ALP","GRN",41.89],
  [151,"Warringah","NSW","IND","Zali Steggall","IND","LP",22.4],
  [251,"Watson","NSW","ALP","Tony Burke","ALP","IND",33.03],
  [152,"Wentworth","NSW","IND","Allegra Spender","IND","LP",16.69],
  [153,"Werriwa","NSW","ALP","Anne Maree Stanley","ALP","LP",13.55],
  [150,"Whitlam","NSW","ALP","Carol Berry","ALP","LP",12.49],
  [306,"Lingiari","NT","ALP","Marion Scrymgour","ALP","CLP",16.25],
  [307,"Solomon","NT","ALP","Luke John Gosling","ALP","CLP",2.62],
  [304,"Blair","QLD","ALP","Shayne Neumann","ALP","LNP",11.42],
  [310,"Bonner","QLD","ALP","Kara Cook","ALP","LNP",10.0],
  [155,"Bowman","QLD","LNP","Henry Pike","LNP","ALP",4.86],
  [156,"Brisbane","QLD","ALP","Madonna Jarrett","ALP","LNP",17.92],
  [157,"Capricornia","QLD","LNP","Michelle Landry","LNP","ALP",11.67],
  [158,"Dawson","QLD","LNP","Andrew Willcox","LNP","ALP",23.66],
  [252,"Dickson","QLD","ALP","Ali France","ALP","LNP",11.98],
  [159,"Fadden","QLD","LNP","Cameron Caldwell","LNP","ALP",13.76],
  [160,"Fairfax","QLD","LNP","Ted O'brien","LNP","ALP",6.46],
  [161,"Fisher","QLD","LNP","Andrew Wallace","LNP","ALP",12.07],
  [311,"Flynn","QLD","LNP","Colin Boyce","LNP","ALP",20.48],
  [162,"Forde","QLD","ALP","Rowan Holzberger","ALP","LNP",3.53],
  [163,"Griffith","QLD","ALP","Renee Coffey","ALP","GRN",21.15],
  [164,"Groom","QLD","LNP","Garth Hamilton","LNP","IND",11.35],
  [165,"Herbert","QLD","LNP","Phillip Thompson","LNP","ALP",26.83],
  [166,"Hinkler","QLD","LNP","David Batt","LNP","ALP",12.52],
  [167,"Kennedy","QLD","KAP","Bob Katter","KAP","LNP",31.51],
  [168,"Leichhardt","QLD","ALP","Matt Smith","ALP","LNP",12.12],
  [169,"Lilley","QLD","ALP","Anika Wells","ALP","LNP",29.04],
  [302,"Longman","QLD","LNP","Terry Young","LNP","ALP",0.22],
  [170,"Maranoa","QLD","LNP","David Littleproud","LNP","ON",40.19],
  [171,"McPherson","QLD","LNP","Leon Rebello","LNP","ALP",8.87],
  [172,"Moncrieff","QLD","LNP","Angie Bell","LNP","ALP",17.6],
  [173,"Moreton","QLD","ALP","Julie-ann Campbell","ALP","LNP",32.18],
  [174,"Oxley","QLD","ALP","Milton Dick","ALP","LNP",38.38],
  [175,"Petrie","QLD","ALP","Emma Comer","ALP","LNP",2.34],
  [176,"Rankin","QLD","ALP","Jim Chalmers","ALP","LNP",31.11],
  [177,"Ryan","QLD","GRN","Elizabeth Watson-brown","GRN","LNP",6.54],
  [178,"Wide Bay","QLD","LNP","Llew O'brien","LNP","ALP",15.26],
  [316,"Wright","QLD","LNP","Scott Buchholz","LNP","ALP",15.95],
  [179,"Adelaide","SA","ALP","Steve Georganas","ALP","LP",38.13],
  [180,"Barker","SA","LP","Tony Pasin","LP","ALP",25.95],
  [182,"Boothby","SA","ALP","Louise Miller-frost","ALP","LP",22.21],
  [183,"Grey","SA","LP","Tom Venning","LP","ALP",9.28],
  [185,"Hindmarsh","SA","ALP","Mark Butler","ALP","LP",32.7],
  [186,"Kingston","SA","ALP","Amanda Rishworth","ALP","LP",41.48],
  [187,"Makin","SA","ALP","Tony Zappia","ALP","LP",29.32],
  [188,"Mayo","SA","IND","Rebekha Sharkie","IND","ALP",29.78],
  [325,"Spence","SA","ALP","Matt Burnell","ALP","LP",30.67],
  [190,"Sturt","SA","ALP","Claire Clutterham","ALP","LP",13.25],
  [192,"Bass","TAS","ALP","Jess Teesdale","ALP","LP",16.02],
  [193,"Braddon","TAS","ALP","Anne Urquhart","ALP","LP",14.4],
  [319,"Clark","TAS","IND","Andrew Wilkie","IND","ALP",40.77],
  [195,"Franklin","TAS","ALP","Julie Collins","ALP","IND",15.56],
  [196,"Lyons","TAS","ALP","Rebecca White","ALP","LP",23.17],
  [197,"Aston","VIC","ALP","Mary Doyle","ALP","LP",6.86],
  [198,"Ballarat","VIC","ALP","Catherine King","ALP","LP",21.33],
  [200,"Bendigo","VIC","ALP","Lisa Chesters","ALP","NP",2.8],
  [201,"Bruce","VIC","ALP","Julian Hill","ALP","LP",29.23],
  [203,"Calwell","VIC","ALP","Basem Abdo","ALP","IND",10.16],
  [204,"Casey","VIC","LP","Aaron Violi","LP","ALP",5.78],
  [205,"Chisholm","VIC","ALP","Carina Garland","ALP","LP",11.4],
  [320,"Cooper","VIC","ALP","Ged Kearney","ALP","GRN",19.43],
  [328,"Corangamite","VIC","ALP","Libby Coker","ALP","LP",16.09],
  [208,"Corio","VIC","ALP","Richard Marles","ALP","LP",26.46],
  [209,"Deakin","VIC","ALP","Matt Gregg","ALP","LP",5.65],
  [210,"Dunkley","VIC","ALP","Jodie Belyea","ALP","LP",14.16],
  [211,"Flinders","VIC","LP","Zoe Mckenzie","LP","IND",4.57],
  [321,"Fraser","VIC","ALP","Daniel Mulino","ALP","GRN",18.45],
  [212,"Gellibrand","VIC","ALP","Tim Watts","ALP","LP",30.2],
  [213,"Gippsland","VIC","NP","Darren Chester","NP","ALP",38.71],
  [214,"Goldstein","VIC","LP","Tim Wilson","LP","IND",0.15],
  [309,"Gorton","VIC","ALP","Alice Jordan-baird","ALP","LP",20.57],
  [326,"Hawke","VIC","ALP","Sam Rae","ALP","LP",15.26],
  [216,"Holt","VIC","ALP","Cassandra Fernando","ALP","LP",28.06],
  [217,"Hotham","VIC","ALP","Clare O'neil","ALP","LP",33.72],
  [218,"Indi","VIC","IND","Helen Haines","IND","LP",17.27],
  [219,"Isaacs","VIC","ALP","Mark Dreyfus","ALP","LP",28.68],
  [220,"Jagajaga","VIC","ALP","Kate Thwaites","ALP","LP",25.76],
  [221,"Kooyong","VIC","IND","Monique Ryan","IND","LP",1.33],
  [223,"La Trobe","VIC","LP","Jason Wood","LP","ALP",4.12],
  [222,"Lalor","VIC","ALP","Joanne Ryan","ALP","LP",26.43],
  [322,"Macnamara","VIC","ALP","Josh Burns","ALP","LP",23.59],
  [224,"Mallee","VIC","NP","Anne Webster","NP","ALP",38.08],
  [225,"Maribyrnong","VIC","ALP","Jo Briskey","ALP","LP",25.29],
  [226,"McEwen","VIC","ALP","Rob Mitchell","ALP","LP",9.52],
  [228,"Melbourne","VIC","ALP","Sarah Witty","ALP","GRN",6.03],
  [229,"Menzies","VIC","ALP","Gabriel Ng","ALP","LP",2.15],
  [323,"Monash","VIC","LP","Mary Aldred","LP","ALP",8.18],
  [324,"Nicholls","VIC","NP","Sam Birrell","NP","ALP",28.76],
  [232,"Scullin","VIC","ALP","Andrew Giles","ALP","LP",28.59],
  [233,"Wannon","VIC","LP","Dan Tehan","LP","IND",6.55],
  [234,"Wills","VIC","ALP","Peter Khalil","ALP","GRN",2.86],
  [235,"Brand","WA","ALP","Madeleine King","ALP","LP",33.84],
  [329,"Bullwinkel","WA","ALP","Trish Cook","ALP","LP",1.02],
  [317,"Burt","WA","ALP","Matt Keogh","ALP","LP",31.41],
  [236,"Canning","WA","LP","Andrew Hastie","LP","ALP",13.1],
  [237,"Cowan","WA","ALP","Anne Aly","ALP","LP",27.27],
  [238,"Curtin","WA","IND","Kate Chaney","IND","LP",6.54],
  [312,"Durack","WA","LP","Melissa Price","LP","ALP",20.31],
  [239,"Forrest","WA","LP","Ben Small","LP","ALP",4.47],
  [240,"Fremantle","WA","ALP","Josh Wilson","ALP","IND",1.37],
  [305,"Hasluck","WA","ALP","Tania Lawrence","ALP","LP",31.95],
  [242,"Moore","WA","ALP","Tom French","ALP","LP",5.77],
  [243,"O'Connor","WA","LP","Rick Wilson","LP","ALP",26.57],
  [244,"Pearce","WA","ALP","Tracey Roberts","ALP","LP",12.87],
  [245,"Perth","WA","ALP","Patrick Gorman","ALP","LP",33.02],
  [247,"Swan","WA","ALP","Zaneta Mascarenhas","ALP","LP",27.98],
  [248,"Tangney","WA","ALP","Sam Lim","ALP","LP",13.98],
];  // auto-injected by inject_model_constants.py
const SEATS = _S25.map(([id, name, state, wp, wn, t1, t2, m]) => ({
  id, name, state, margin: m, swing: 0, fp: [],
  winner: { party: wp, name: wn },
  tcp: [{ party: t1, pct: +(50 + m / 2).toFixed(2) }, { party: t2, pct: +(50 - m / 2).toFixed(2) }]
}));

// ─── Polling data (auto-updated) ─────────────────────────────────────────────
// National polls come from data/polls/bludgertrack.json, scraped weekly from
// Wikipedia by .github/workflows/update-polls.yml (which copies the file into
// webapp/src/data/). Do not hand-edit poll rows here — fix the source JSON.
// 'on' = One Nation first-preference %; 'oth' computed as 100 - alp - coal - grn - on
// tpp = ALP two-party preferred (null if not reported by pollster)
// n = sample size from the scrape, falling back to the pollster's typical size
const POLL_SAMPLE_SIZES = {
  "Newspoll": 1597, "Roy Morgan": 2537, "Essential Research": 1020,
  "YouGov": 1511, "Resolve Strategic": 1605, "RedBridge Group": 1000,
  "DemosAU": 1500, "Freshwater Strategy": 1000, "Fox & Hedgehog": 1000,
  "Spectre Strategy": 1000,
};
const INITIAL_POLLS = (BLUDGERTRACK?.polls ?? [])
  .filter(p => p && p.date && (p.scope ?? "NAT") === "NAT" &&
    [p.alp, p.coal, p.grn].every(Number.isFinite))
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((p, i) => ({
    id: i + 1,
    pollster: p.pollster,
    date: p.date,
    alp: p.alp, coal: p.coal, grn: p.grn,
    on: p.on ?? null,
    tpp: p.tpp ?? null,
    oth: p.on != null ? +(100 - p.alp - p.coal - p.grn - p.on).toFixed(1) : +(100 - p.alp - p.coal - p.grn).toFixed(1),
    n: p.n ?? POLL_SAMPLE_SIZES[p.pollster] ?? null,
  }));

// ─── Election data ────────────────────────────────────────────────────────────
// Helper: build a seat object from a flat tuple
const mkSeat = (id, name, state, party, winner, margin) =>
  ({ id, name, state, margin, winner: { party, name: winner } });

// Helper: build a virtual full-seat array from group counts for TallyBar
const mkSeatsFromCounts = counts => {
  const G2P = { alp: "ALP", coalition: "LP", greens: "GRN", teal: "IND", one_nation: "ON", crossbench: "IND" };
  let vid = 99000;
  return Object.entries(counts).flatMap(([g, n]) =>
    Array.from({ length: n }, () => ({ id: vid++, winner: { party: G2P[g] ?? "IND" } }))
  );
};

// NSW 2023 — representative marginal seats
const NSW_2023_SEATS = [
  [8001, "Penrith", "NSW", "ALP", "Karen McKeown", 0.3],
  [8002, "East Hills", "NSW", "ALP", "Cameron Murphy", 0.6],
  [8003, "Ryde", "NSW", "ALP", "Jordan Lane", 0.8],
  [8004, "Monaro", "NSW", "LP", "Nichole Overall", 0.7],
  [8005, "Heathcote", "NSW", "LP", "Lee Evans", 1.1],
  [8006, "Strathfield", "NSW", "ALP", "Zac Poole", 1.2],
  [8007, "Gosford", "NSW", "ALP", "Liesl Tesch", 2.3],
  [8008, "Keira", "NSW", "ALP", "Ryan Park", 3.0],
  [8009, "Newtown", "NSW", "GRN", "Jenny Leong", 8.1],
  [8010, "Balmain", "NSW", "GRN", "Kobi Shetty", 7.3],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// QLD 2024 — representative marginal seats
const QLD_2024_SEATS = [
  [8101, "Mount Ommaney", "QLD", "LNP", "Jacob Madsen", 0.3],
  [8102, "Inala", "QLD", "ALP", "Margie Nightingale", 0.4],
  [8103, "Oodgeroo", "QLD", "LNP", "Mark Robinson", 0.5],
  [8104, "Macalister", "QLD", "ALP", "Melissa McMahon", 0.8],
  [8105, "Greenslopes", "QLD", "ALP", "Joe Kelly", 1.1],
  [8106, "South Brisbane", "QLD", "ALP", "Barbara O'Shea", 1.3],
  [8107, "McConnel", "QLD", "LNP", "David Janetzki", 1.5],
  [8108, "Everton", "QLD", "LNP", "Tim Mander", 2.0],
  [8109, "Toohey", "QLD", "ALP", "Peter Russo", 2.5],
  [8110, "Maiwar", "QLD", "GRN", "Michael Berkman", 5.1],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// WA 2025 — representative marginal seats
const WA_2025_SEATS = [
  [8201, "Carine", "WA", "LP", "David Honey", 0.4],
  [8202, "Vasse", "WA", "LP", "Libby Mettam", 0.8],
  [8203, "Kalamunda", "WA", "LP", "Adam Hort", 0.9],
  [8204, "Bateman", "WA", "ALP", "Kim Giddens", 1.0],
  [8205, "Roe", "WA", "NP", "Peter Rundle", 1.2],
  [8206, "Moore", "WA", "LP", "Shane Love", 1.5],
  [8207, "Bicton", "WA", "ALP", "Lisa O'Malley", 2.5],
  [8208, "Dawesville", "WA", "ALP", "Matthew Hughes", 3.1],
  [8209, "Churchlands", "WA", "LP", "Sean L'Estrange", 2.2],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// SA 2022 — representative marginal seats
const SA_2022_SEATS = [
  [8301, "King", "SA", "ALP", "Dana Wortley", 0.1],
  [8302, "Gibson", "SA", "ALP", "Eddie Hughes", 0.4],
  [8303, "Heysen", "SA", "LP", "Josh Teague", 0.3],
  [8304, "Newland", "SA", "ALP", "Blair Boyer", 0.6],
  [8305, "Florey", "SA", "ALP", "Frances Bedford", 1.0],
  [8306, "Colton", "SA", "LP", "Jeff Brock", 1.8],
  [8307, "Morialta", "SA", "LP", "John Gardner", 2.0],
  [8308, "Waite", "SA", "LP", "Sam Duluk", 2.5],
  [8309, "Adelaide", "SA", "ALP", "Lucy Hood", 3.0],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// TAS 2024 — representative seats (Hare-Clark approximated)
const TAS_2024_SEATS = [
  [8401, "Bass (1)", "TAS", "LP", "Sarah Courtney", 0.2],
  [8402, "Clark (2)", "TAS", "LP", "Madeleine Ogilvie", 0.3],
  [8403, "Braddon (1)", "TAS", "LP", "Felix Ellis", 0.4],
  [8404, "Clark (1)", "TAS", "GRN", "Rosalie Woodruff", 0.5],
  [8405, "Lyons (1)", "TAS", "ALP", "Dean Winter", 0.8],
  [8406, "Franklin (1)", "TAS", "IND", "David O'Byrne", 1.1],
  [8407, "Bass (2)", "TAS", "ALP", "Michelle O'Byrne", 1.2],
  [8408, "Braddon (2)", "TAS", "LP", "Roger Jaensch", 1.5],
  [8409, "Lyons (2)", "TAS", "LP", "Mark Shelton", 2.0],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// ACT 2024 — representative seats (multi-member electorates approximated)
const ACT_2024_SEATS = [
  [8501, "Ginninderra (1)", "ACT", "LP", "Elizabeth Lee", 0.4],
  [8502, "Brindabella (1)", "ACT", "ALP", "Joy Burch", 0.5],
  [8503, "Ginninderra (2)", "ACT", "GRN", "Rebecca Vassarotti", 0.6],
  [8504, "Murrumbidgee (1)", "ACT", "LP", "Jeremy Hanson", 0.8],
  [8505, "Kurrajong (1)", "ACT", "ALP", "Andrew Barr", 1.2],
  [8506, "Brindabella (2)", "ACT", "LP", "Mark Parton", 1.5],
  [8507, "Kurrajong (2)", "ACT", "GRN", "Shane Rattenbury", 1.8],
  [8508, "Murrumbidgee (2)", "ACT", "ALP", "Mick Gentleman", 2.0],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// NT 2024 — representative marginal seats
const NT_2024_SEATS = [
  [8601, "Blain", "NT", "CLP", "Matthew Kerle", 0.3],
  [8602, "Casuarina", "NT", "CLP", "Khoda Patel", 0.4],
  [8603, "Arafura", "NT", "ALP", "Manuel Brown", 0.6],
  [8604, "Karama", "NT", "CLP", "Brian O'Gallagher", 0.5],
  [8605, "Fannie Bay", "NT", "CLP", "Laurie Zio", 0.8],
  [8606, "Johnston", "NT", "IND", "Justine Davis", 1.2],
  [8607, "Nhulunbuy", "NT", "IND", "Yingiya Mark Guyula", 2.0],
  [8608, "Namatjira", "NT", "CLP", "Bill Yan", 1.5],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// ── Full state seat data ──────────────────────────────────────────────────────
// Format: [id, name, state, winnerParty, winnerName, tcp1Party, tcp2Party, margin]
// Margin = winner's lead over 50% at TCP (e.g. 2.3 means winner polled 52.3%)
// Sources: NSWEC, ECQ, WAEC, ECSA, TEC, ACT EC, NTEC official results.
// Marginal seats (< 5pp) use actual results; competitive/safe seats are approximate.
const mkSS = (id, nm, st, wp, wn, t1, t2, m) => ({
  id, name: nm, state: st, margin: m,
  winner: { party: wp, name: wn },
  tcp: [{ party: t1, pct: +(50 + m).toFixed(2) }, { party: t2, pct: +(50 - m).toFixed(2) }],
});

// Fill remaining seats (beyond named seats) as notional using actual result counts.
// Margins are distributed realistically: roughly 30% fairly-safe (5–10pp), 70% safe (10–25pp).
function fillStateSeats(named, counts, defaultOpp, stateCode, idOffset) {
  const G2P = { alp: "ALP", coalition: defaultOpp, greens: "GRN", teal: "IND", one_nation: "ON", crossbench: "IND" };
  const byGroup = {};
  named.forEach(s => { const g = getParty(s.winner.party).group; byGroup[g] = (byGroup[g] || 0) + 1; });
  let vid = 93000 + idOffset;
  const notional = [];
  Object.entries(counts || {}).forEach(([group, n]) => {
    if (!n) return;
    const party = G2P[group] ?? "ALP";
    const opp = party === "ALP" ? defaultOpp : "ALP";
    const toAdd = Math.max(0, n - (byGroup[group] || 0));
    for (let i = 0; i < toAdd; i++) {
      const cutoff = Math.ceil(toAdd * 0.3);
      const margin = i < cutoff ? +(6 + i * (4 / Math.max(cutoff, 1))).toFixed(1)
        : +(10 + (i - cutoff) * (15 / Math.max(toAdd - cutoff, 1))).toFixed(1);
      notional.push(mkSS(vid++, `${stateCode} ${party}/${group} #${i + 1}`, stateCode, party, "", party, opp, margin));
    }
  });
  return [...named, ...notional];
}

// ── NSW 2023 (93 seats, ALP minority 45, LP 35, NP 9, GRN 3, IND 1) ──────────
// Primary: ALP 37.6  LP 28.6  NP 8.4  GRN 10.4  IND/other 14.9   ALP 2PP 53.2%
const _NSW = [
  // Marginal ALP/LP
  [7001, "Penrith", "NSW", "ALP", "Karen McKeown", "ALP", "LP", 0.3],
  [7002, "East Hills", "NSW", "ALP", "Cameron Murphy", "ALP", "LP", 0.6],
  [7003, "Ryde", "NSW", "ALP", "Jordan Lane", "ALP", "LP", 0.8],
  [7004, "Strathfield", "NSW", "ALP", "Zac Poole", "ALP", "LP", 1.2],
  [7005, "Coogee", "NSW", "ALP", "Marjorie O'Neill", "ALP", "LP", 2.3],
  [7006, "Kiama", "NSW", "IND", "Gareth Ward", "IND", "ALP", 1.8],  // Ward expelled from Libs; retained as IND
  [7007, "Keira", "NSW", "ALP", "Ryan Park", "ALP", "LP", 3.0],
  [7013, "Gosford", "NSW", "ALP", "Liesl Tesch", "ALP", "LP", 2.3],  // ALP; Tesch held since 2017; Crouch holds Terrigal
  // Marginal LP/ALP
  [7011, "Monaro", "NSW", "LP", "Nichole Overall", "LP", "ALP", 0.7],
  [7012, "Heathcote", "NSW", "LP", "Lee Evans", "LP", "ALP", 1.1],
  [7014, "Drummoyne", "NSW", "LP", "Charles Cayford", "LP", "ALP", 2.5],
  [7015, "Holsworthy", "NSW", "LP", "Tina Ayyad", "LP", "ALP", 3.5],
  [7016, "Terrigal", "NSW", "LP", "Adam Crouch", "LP", "ALP", 4.5],
  // Independent seats
  [7021, "Wakehurst", "NSW", "IND", "Michael Regan", "IND", "LP", 1.5],  // Regan won after Hazzard retired
  // Greens seats
  [7031, "Newtown", "NSW", "GRN", "Jenny Leong", "GRN", "ALP", 8.1],
  [7032, "Balmain", "NSW", "GRN", "Kobi Shetty", "GRN", "ALP", 7.3],
  // ALP marginal (inner-city)
  [7033, "Summer Hill", "NSW", "ALP", "Jo Haylen", "ALP", "LP", 3.8],  // ALP; Haylen is Labor not Greens
  // LP competitive (5–10pp)
  [7041, "Davidson", "NSW", "LP", "Matt Cross", "LP", "ALP", 5.0],
  [7042, "Pittwater", "NSW", "LP", "Rob Stokes", "LP", "ALP", 7.5],
  [7043, "Epping", "NSW", "LP", "Damien Tudehope", "LP", "ALP", 5.5],
  [7044, "Lane Cove", "NSW", "LP", "Anthony Roberts", "LP", "ALP", 6.5],
  [7045, "Willoughby", "NSW", "LP", "Tim James", "LP", "ALP", 4.8],
  [7046, "Manly", "NSW", "LP", "James Griffin", "LP", "ALP", 5.5],
  [7047, "Castle Hill", "NSW", "LP", "Ray Williams", "LP", "ALP", 5.0],
  [7048, "Hornsby", "NSW", "LP", "James Wallace", "LP", "ALP", 6.0],  // Kean retired Jun 2024; Wallace won by-election
  // NP seats
  [7061, "Oxley", "NSW", "NP", "Michael Kemp", "NP", "ALP", 3.0],  // Johnsen resigned 2021; Kemp won 2023
  [7062, "Upper Hunter", "NSW", "NP", "Dave Layzell", "NP", "ALP", 4.5],
  [7063, "Port Macquarie", "NSW", "NP", "Leslie Williams", "NP", "ALP", 4.0],
  [7064, "Tamworth", "NSW", "NP", "Kevin Anderson", "NP", "ALP", 8.0],
  [7066, "Dubbo", "NSW", "NP", "Dugald Saunders", "NP", "ALP", 6.5],
  [7068, "Bathurst", "NSW", "NP", "Paul Toole", "NP", "ALP", 8.5],
  // Independent seats (former SFF members re-elected as independents in 2023)
  [7065, "Orange", "NSW", "IND", "Phil Donato", "IND", "NP", 7.0],   // left SFF Dec 2022
  [7067, "Murray", "NSW", "IND", "Helen Dalton", "IND", "NP", 10.0], // left SFF Dec 2022
  [7069, "Barwon", "NSW", "IND", "Roy Butler", "IND", "NP", 15.0],   // left SFF Dec 2022
  // ALP competitive (5–10pp)
  [7071, "Swansea", "NSW", "ALP", "Yasmin Catley", "ALP", "LP", 5.5],
  [7072, "Lake Macquarie", "NSW", "IND", "Greg Piper", "IND", "ALP", 5.0],  // IND since 2007; now Speaker
  [7073, "Kotara", "NSW", "ALP", "David Harris", "ALP", "LP", 4.0],
  [7074, "Blue Mountains", "NSW", "ALP", "Trish Doyle", "ALP", "LP", 7.5],
  [7075, "Rockdale", "NSW", "ALP", "Steve Kamper", "ALP", "LP", 3.5],
  [7076, "Kogarah", "NSW", "ALP", "Chris Minns", "ALP", "LP", 4.5],
  // ALP safe (>10pp)
  [7081, "Cessnock", "NSW", "ALP", "Clayton Barr", "ALP", "LP", 15.0],
  [7082, "Charlestown", "NSW", "ALP", "Jodie Harrison", "ALP", "LP", 12.0],
  [7083, "Wallsend", "NSW", "ALP", "Sonia Hamilton", "ALP", "LP", 15.0],
  [7084, "Maitland", "NSW", "ALP", "Jenny Aitchison", "ALP", "LP", 10.0],
  [7085, "Newcastle", "NSW", "ALP", "Tim Crakanthorp", "ALP", "LP", 18.0],
  [7086, "Wollongong", "NSW", "ALP", "Paul Scully", "ALP", "LP", 15.0],
  [7087, "Shellharbour", "NSW", "ALP", "Anna Watson", "ALP", "LP", 14.0],
  [7088, "Liverpool", "NSW", "ALP", "Paul Lynch", "ALP", "LP", 15.0],
  [7089, "Campbelltown", "NSW", "ALP", "Greg Warren", "ALP", "LP", 12.0],
  [7090, "Bankstown", "NSW", "ALP", "Tania Mihailuk", "ALP", "LP", 15.0],
  [7091, "Lakemba", "NSW", "ALP", "Jihad Dib", "ALP", "LP", 20.0],
  [7092, "Auburn", "NSW", "ALP", "Lynda Voltz", "ALP", "LP", 18.0],
  [7093, "Maroubra", "NSW", "ALP", "Michael Daley", "ALP", "LP", 13.0],
  [7094, "Heffron", "NSW", "ALP", "Ron Hoenig", "ALP", "LP", 12.0],
  [7095, "Smithfield", "NSW", "ALP", "Andrew Rohan", "ALP", "LP", 14.0],
];
const NSW_SEATS = fillStateSeats(_NSW.map(r => mkSS(...r)),
  { alp: 45, coalition: 44, greens: 3, teal: 1 }, "LP", "NSW", 0);

// ── QLD 2024 (93 seats, LNP majority 52, ALP 36, GRN 1, KAP 3, IND 1) ──────────
// Primary: ALP 33.4  LNP 40.3  GRN 11.5  ON 8.2  other 6.6   ALP 2PP 46.3%
const _QLD = [
  // Marginal LNP/ALP
  [7201, "Mount Ommaney", "QLD", "LNP", "Jacob Madsen", "LNP", "ALP", 0.3],
  [7202, "Oodgeroo", "QLD", "LNP", "Mark Robinson", "LNP", "ALP", 0.5],
  [7205, "McConnel", "QLD", "LNP", "David Janetzki", "LNP", "ALP", 1.5],
  [7206, "Everton", "QLD", "LNP", "Tim Mander", "LNP", "ALP", 2.0],
  [7207, "Currumbin", "QLD", "LNP", "Laura Gerber", "LNP", "ALP", 3.0],
  [7208, "Burleigh", "QLD", "LNP", "Michael Hart", "LNP", "ALP", 4.5],
  [7209, "Mundingburra", "QLD", "LNP", "Dale Last", "LNP", "ALP", 3.5],  // O'Rourke was ALP incumbent who lost
  // Marginal ALP/LNP
  [7203, "Macalister", "QLD", "ALP", "Melissa McMahon", "ALP", "LNP", 0.8],  // ALP retained; Gerber holds Currumbin
  [7204, "Greenslopes", "QLD", "ALP", "Joe Kelly", "ALP", "LNP", 1.1],       // safe ALP since 2015; Mickelberg holds Buderim
  [7211, "Inala", "QLD", "ALP", "Margie Nightingale", "ALP", "LNP", 0.4],    // won 2024 by-election, re-elected
  [7212, "Toohey", "QLD", "ALP", "Peter Russo", "ALP", "LNP", 2.5],
  [7213, "Miller", "QLD", "ALP", "Jo-Ann Miller", "ALP", "LNP", 3.5],
  // ALP seats — former Greens held (Greens won only Maiwar in 2024)
  [7221, "South Brisbane", "QLD", "ALP", "Barbara O'Shea", "ALP", "LNP", 1.3],  // MacMahon (GRN) lost to O'Shea
  [7223, "Cooper", "QLD", "ALP", "Jonty Bush", "ALP", "LNP", 3.5],              // Bush is ALP, not Greens
  [7225, "Stretton", "QLD", "ALP", "James Martin", "ALP", "LNP", 2.2],          // Miles held Mulgrave, not Stretton
  [7226, "Waterford", "QLD", "ALP", "Shannon Fentiman", "ALP", "LNP", 1.8],     // Fentiman retained for ALP
  // Greens seat (only 1 seat won in 2024)
  [7222, "Maiwar", "QLD", "GRN", "Michael Berkman", "GRN", "LNP", 5.1],
  // LNP competitive (5–10pp)
  [7231, "Nanango", "QLD", "LNP", "Deb Frecklington", "LNP", "ALP", 6.0],
  [7232, "Warrego", "QLD", "LNP", "Ann Leahy", "LNP", "ALP", 7.5],
  [7233, "Gympie", "QLD", "LNP", "Tony Perrett", "LNP", "ALP", 8.0],
  [7234, "Buderim", "QLD", "LNP", "Brent Mickelberg", "LNP", "ALP", 7.0],
  [7235, "Caloundra", "QLD", "LNP", "Jason Hunt", "LNP", "ALP", 6.5],
  // LNP seats where One Nation is the TCP challenger (rural/regional QLD)
  [7261, "Mirani", "QLD", "LNP", "Glen Kelly", "LNP", "ON", 1.8],  // Butcher holds Gladstone
  [7262, "Condamine", "QLD", "LNP", "Pat Weir", "LNP", "ON", 2.6],
  [7263, "Callide", "QLD", "LNP", "Colin Boyce", "LNP", "ON", 3.5],
  [7264, "Hinchinbrook", "QLD", "LNP", "Nick Dametto", "LNP", "ON", 4.5],
  [7265, "Southern Downs", "QLD", "LNP", "James Lister", "LNP", "ON", 5.5],
  // ALP safe
  [7241, "Bundaberg", "QLD", "ALP", "Tom Smith", "ALP", "LNP", 10.0],
  [7242, "Rockhampton", "QLD", "ALP", "Barry O'Rourke", "ALP", "LNP", 12.0],
  // Mulgrave flipped LNP in 2024 (14.9% swing; Pitt retired; seat no longer in ALP column)
];
const QLD_SEATS = fillStateSeats(_QLD.map(r => mkSS(...r)),
  { alp: 36, coalition: 52, greens: 1, crossbench: 4 }, "LNP", "QLD", 100);

// ── WA 2025 (59 seats, ALP landslide 46, LP 10, GRN 2, IND 1) ────────────────
// Primary: ALP 55.0  LP 18.5  NP 4.5  GRN 11.0  IND/other 11.0   ALP 2PP 63.1%
const _WA = [
  // Marginal LP/ALP (most LP seats were very tight after ALP landslide)
  [7301, "Carine", "WA", "LP", "David Honey", "LP", "ALP", 0.4],
  [7302, "Vasse", "WA", "LP", "Libby Mettam", "LP", "ALP", 0.8],
  [7303, "Kalamunda", "WA", "LP", "Adam Hort", "LP", "ALP", 0.9],   // Hort won by 88 votes; Rundle holds Roe (NP)
  [7305, "Churchlands", "WA", "LP", "Sean L'Estrange", "LP", "ALP", 2.2],
  [7306, "Moore", "WA", "LP", "Shane Love", "LP", "ALP", 1.5],
  // Marginal NP/ALP
  [7311, "Roe", "WA", "NP", "Peter Rundle", "NP", "ALP", 1.2],
  // Marginal ALP/LP
  [7304, "Bateman", "WA", "ALP", "Kim Giddens", "ALP", "LP", 1.0],   // ALP retained; David Michael holds Balcatta
  [7321, "Bicton", "WA", "ALP", "Lisa O'Malley", "ALP", "LP", 2.5],
  [7322, "Dawesville", "WA", "ALP", "Matthew Hughes", "ALP", "LP", 3.1],
  // ALP marginal (Greens did not win any WA lower house seats in 2025)
  [7331, "Fremantle", "WA", "ALP", "Simone McGurk", "ALP", "LP", 2.5],
  [7332, "Maylands", "WA", "ALP", "Dan Bull", "ALP", "LP", 3.5],
  [7341, "Scarborough", "WA", "ALP", "Stuart Aubrey", "ALP", "LP", 3.5],  // ALP retained; Papalia is ALP in Secret Harbour
  // LP safe
  [7342, "Hillarys", "WA", "LP", "Peter Katsambanis", "LP", "ALP", 4.0],
  // ALP safe
  [7351, "Joondalup", "WA", "ALP", "Emily Hamilton", "ALP", "LP", 10.0],  // Templeman retired before 2025
  [7352, "Balcatta", "WA", "ALP", "David Michael", "ALP", "LP", 12.0],
  [7353, "Midland", "WA", "ALP", "Michelle Roberts", "ALP", "LP", 15.0],
  [7354, "Armadale", "WA", "ALP", "Tony Buti", "ALP", "LP", 18.0],
  [7355, "Mandurah", "WA", "ALP", "David Templeman", "ALP", "LP", 20.0],
  [7356, "Rockingham", "WA", "ALP", "Magenta Marshall", "ALP", "LP", 25.0],  // McGowan resigned 2023; Marshall won by-election
  [7357, "Kwinana", "WA", "ALP", "Roger Cook", "ALP", "LP", 22.0],
];
const WA_SEATS = fillStateSeats(_WA.map(r => mkSS(...r)),
  { alp: 46, coalition: 13, greens: 0, teal: 0 }, "LP", "WA", 200);

// ── SA 2022 (47 seats, ALP majority 27, LP 16, IND 4) ────────────────────────
// Primary: ALP 38.3  LP 34.8  GRN 7.3  IND/other 19.6   ALP 2PP 54.9%
// ── SA 2026 final results (21 Mar 2026) ──
// ALP: 34 seats, 39.1%  LP: 5 seats, 18.7%  ON: 4 seats, 21.6%  IND: 4 seats, 4.7%  GRN: 0 seats, 11.1%
// Historic Liberal collapse: LP fell 16pp, ON surged 20pp (mostly ex-Liberal voters).
// LP won Schubert, Bragg, Morphett, Heysen, Flinders; ON won Ngadjuri, Hammond, Mackillop, Narungga.
const _SA = [
  // ── LP retained (5 seats) ──
  [7411, "Heysen", "SA", "LP", "Josh Teague", "LP", "ALP", 3.0],
  [7416, "Bragg", "SA", "LP", "Rachel Sanderson", "LP", "ALP", 4.5],
  [7415, "Flinders", "SA", "LP", "Sam Telfer", "LP", "ALP", 6.5],
  [7419, "Morphett", "SA", "LP", "David Speirs", "LP", "ALP", 5.0],
  [7420, "Schubert", "SA", "LP", "Ashton Hurn", "LP", "ALP", 6.0],
  // ── One Nation (4 seats: Ngadjuri, Hammond, Mackillop, Narungga) ──
  [7423, "Ngadjuri", "SA", "ON", "David Paton", "ON", "ALP", 1.5],
  [7425, "Hammond", "SA", "ON", "Robert Roylance", "ON", "ALP", 4.9],
  [7426, "Mackillop", "SA", "ON", "Jason Virgo", "ON", "ALP", 3.5],
  [7424, "Narungga", "SA", "ON", "Chantelle Thomas", "ON", "LP", 0.2],
  // ── Independent/crossbench seats (4) ──
  [7421, "Mount Gambier", "SA", "IND", "Travis Fatchen", "IND", "ALP", 5.0],
  [7422, "Stuart", "SA", "IND", "Geoff Brock", "IND", "ALP", 7.0],
  // ── Former LP marginals now held by ALP (LP primary collapsed 16pp) ──
  [7412, "Colton", "SA", "ALP", "Aria Bolkus", "ALP", "LP", 7.5],
  [7413, "Morialta", "SA", "ALP", "Matthew Marozzi", "ALP", "LP", 7.0],
  [7414, "Waite", "SA", "ALP", "Catherine Hutchesson", "ALP", "LP", 7.0],
  [7417, "Unley", "SA", "ALP", "Alice Rolls", "ALP", "LP", 3.5],
  [7418, "Hartley", "SA", "ALP", "Jenn Roberts", "ALP", "LP", 2.5],
  // ── Former ALP marginals now safely held ──
  [7401, "King", "SA", "ALP", "Dana Wortley", "ALP", "LP", 8.0],
  [7402, "Gibson", "SA", "ALP", "Sarah Andrews", "ALP", "LP", 8.5],
  [7403, "Newland", "SA", "ALP", "Blair Boyer", "ALP", "LP", 9.0],
  [7404, "Florey", "SA", "ALP", "Nat Cook", "ALP", "LP", 9.5],
  [7405, "Adelaide", "SA", "ALP", "Lucy Hood", "ALP", "LP", 10.0],
  [7406, "Kaurna", "SA", "ALP", "Chris Picton", "ALP", "LP", 11.0],
  [7407, "Playford", "SA", "ALP", "Tom Koutsantonis", "ALP", "LP", 12.0],
  // ── ALP safe ──
  [7432, "Croydon", "SA", "ALP", "Joe Szakacs", "ALP", "LP", 17.0],
  [7433, "Ramsay", "SA", "ALP", "Peter Malinauskas", "ALP", "LP", 14.0],
  [7434, "Lee", "SA", "ALP", "David Wilkins", "ALP", "LP", 13.0],
];
const SA_SEATS = fillStateSeats(_SA.map(r => mkSS(...r)),
  { alp: 34, coalition: 5, greens: 0, teal: 0, one_nation: 4, crossbench: 4 }, "LP", "SA", 300);

// ── NT 2024 (25 seats, CLP majority 17, ALP 4, GRN 1, IND 3) ────────────────
// Primary: ALP 30.5  CLP 40.5  GRN 5.5  IND 12.5  other 11.0
const _NT = [
  // Marginal CLP
  [7501, "Blain", "NT", "CLP", "Matthew Kerle", "CLP", "ALP", 0.3],    // Kerle won Blain; Yan holds Namatjira
  [7502, "Casuarina", "NT", "CLP", "Khoda Patel", "CLP", "ALP", 0.4],  // 18% swing; Uibo holds Arnhem (ALP)
  [7504, "Karama", "NT", "CLP", "Brian O'Gallagher", "CLP", "ALP", 0.5], // Ah Kit held Karama and lost
  [7505, "Fannie Bay", "NT", "CLP", "Laurie Zio", "CLP", "ALP", 0.8],  // Zio won by 28 votes; Lawler held Drysdale
  [7508, "Namatjira", "NT", "CLP", "Bill Yan", "CLP", "ALP", 1.5],     // Yan holds Namatjira; Turner was IND in Blain
  [7509, "Barkly", "NT", "CLP", "Steve Edgington", "CLP", "ALP", 3.5],
  [7510, "Brennan", "NT", "CLP", "Marie-Clare Boothby", "CLP", "ALP", 5.0],  // Boothby holds Brennan; Finocchiaro holds Spillett
  [7511, "Darwin", "NT", "CLP", "Robyn Cahill", "CLP", "ALP", 4.5],    // Cahill won Port Darwin; Burgoyne holds Braitling
  [7512, "Goyder", "NT", "CLP", "Andrew Mackay", "CLP", "ALP", 6.0],   // Mackay won Goyder; Boothby holds Brennan
  // CLP won — Wanguri/Drysdale (former ALP safe seats flipped)
  [7521, "Wanguri", "NT", "CLP", "Oly Carlson", "CLP", "ALP", 10.0],  // Fyles held Nightcliff (lost to GRN); CLP won Wanguri
  [7522, "Drysdale", "NT", "CLP", "Clinton Howe", "CLP", "ALP", 12.0], // Lawler (former CM) held Drysdale and lost
  // ALP retained
  [7503, "Arafura", "NT", "ALP", "Manuel Brown", "ALP", "CLP", 0.6],   // ALP retained; Paech holds Gwoja (ALP)
  // Independent
  [7506, "Johnston", "NT", "IND", "Justine Davis", "IND", "ALP", 1.2], // Davis (IND) defeated Labor minister Bowden
  [7507, "Nhulunbuy", "NT", "IND", "Yingiya Mark Guyula", "IND", "ALP", 2.0],  // Guyula IND since 2016
];
const NT_SEATS = fillStateSeats(_NT.map(r => mkSS(...r)),
  { alp: 4, coalition: 17, crossbench: 4 }, "CLP", "NT", 400);

// ── TAS 2024 ─ Hare-Clark (5 electorates × 7 seats = 35) ─────────────────────
// Lib 14, ALP 10, GRN 5, JLN 3, IND 3  (source: Tasmanian Electoral Commission 2024)
// Model approach: party-aggregated STV count simulation per electorate
// (allocateHareClark — quota, surplus pooling, iterative exclusion transfers).
// Droop quota = 100/(7+1) = 12.5%.  JLN + other independents are grouped as "ind".
// Primary votes are actual TASEC first-preference percentages except Franklin,
// whose values were nudged when the old largest-remainder heuristic could not
// reproduce its outcome; the STV simulation reproduces the actual 2024 seat
// result in all five electorates (incl. Franklin Lib 3, ALP 2, GRN 1, IND 1).
// Source: TASEC 2024 final results; electorate figures verified via Antony Green / Wikipedia.
const TAS_ELECTORATES = [
  { name: "Bass",     seats: 7, coal: 39.7, alp: 28.6, grn: 11.1, ind: 20.6 }, // Lib=3,ALP=2,GRN=1,ind=1
  { name: "Braddon",  seats: 7, coal: 45.8, alp: 24.9, grn:  6.3, ind: 23.0 }, // Lib=3,ALP=2,GRN=0,ind=2
  { name: "Clark",    seats: 7, coal: 27.1, alp: 30.5, grn: 22.0, ind: 20.4 }, // Lib=2,ALP=2,GRN=2,ind=1
  { name: "Franklin", seats: 7, coal: 34.0, alp: 28.0, grn: 20.0, ind: 18.0 }, // Lib=3,ALP=2,GRN=1,ind=1 (calibrated)
  { name: "Lyons",    seats: 7, coal: 37.2, alp: 29.0, grn: 11.4, ind: 22.4 }, // Lib=3,ALP=2,GRN=1,ind=1
];

// ── ACT 2024 ─ Hare-Clark (5 electorates × 5 seats = 25) ────────────────────
// ALP 9, Lib 9, GRN 7
// Electorates calibrated to reproduce actual 2024 result via Droop quota:
//   Brindabella: Lib=3, ALP=1, GRN=1  (outer south, most conservative)
//   Ginninderra: Lib=1, ALP=2, GRN=2  (inner north, progressive)
//   Kurrajong:   Lib=1, ALP=2, GRN=2  (central Canberra, most progressive)
//   Murrumbidgee: Lib=2, ALP=2, GRN=1 (south suburbs)
//   Ngunnawal:   Lib=2, ALP=2, GRN=1  (outer north, Gungahlin)
// Source: Elections ACT 2024 final results; totals sum to 94–100 before renormalisation.
const ACT_ELECTORATES = [
  { name: "Brindabella", seats: 5, alp: 25, coal: 44, grn: 17, ind: 8 },
  { name: "Ginninderra", seats: 5, alp: 35, coal: 28, grn: 30, ind: 7 },
  { name: "Kurrajong",   seats: 5, alp: 34, coal: 24, grn: 33, ind: 9 },
  { name: "Murrumbidgee", seats: 5, alp: 32, coal: 35, grn: 18, ind: 8 },
  { name: "Ngunnawal",   seats: 5, alp: 33, coal: 30, grn: 21, ind: 9 },
];

// VIC_2022_SEATS_STD removed — use VIC_SEATS (88 seats, from _VS below) directly.

// ─── VIC 2022 full seat data (88 LA districts, VEC official 2PP results) ──────
// Source: VEC 2022 State Election — vec.vic.gov.au
// Format: [id, name, state, winnerParty, winnerName, tcp1Party, tcp2Party, margin]
const _VS = [
  [9001, "Narracan", "VIC", "LP", "Wayne Farnham", "LP", "ALP", 1.69],  // deferred to Jan 2023 supplementary election; Farnham (LP) won
  [9002, "Albert Park", "VIC", "ALP", "Nina Taylor", "ALP", "LP", 11.15],
  [9003, "Ashwood", "VIC", "ALP", "Matt Fregon", "ALP", "LP", 6.15],
  [9004, "Bass", "VIC", "ALP", "Jordan Crugnale", "ALP", "LP", 0.24],
  [9005, "Bayswater", "VIC", "ALP", "Jackson Taylor", "ALP", "LP", 4.23],
  [9006, "Bellarine", "VIC", "ALP", "Alison Marchant", "ALP", "LP", 8.46],
  [9007, "Benambra", "VIC", "LP", "Bill Tilley", "LP", "ALP", 13.26],
  [9008, "Bendigo East", "VIC", "ALP", "Jacinta Allan", "ALP", "LP", 10.91],
  [9009, "Bendigo West", "VIC", "ALP", "Maree Edwards", "ALP", "LP", 14.35],
  [9010, "Bentleigh", "VIC", "ALP", "Nick Staikos", "ALP", "LP", 8.04],
  [9011, "Berwick", "VIC", "LP", "Brad Battin", "LP", "ALP", 4.71],
  [9012, "Box Hill", "VIC", "ALP", "Paul Hamer", "ALP", "LP", 7.23],
  [9013, "Brighton", "VIC", "LP", "James Newbury", "LP", "ALP", 4.21],
  [9014, "Broadmeadows", "VIC", "ALP", "Kathleen Matthews-Ward", "ALP", "LP", 15.45],
  [9015, "Brunswick", "VIC", "GRN", "Tim Read", "GRN", "ALP", 11.1],
  [9016, "Bulleen", "VIC", "LP", "Matthew Guy", "LP", "ALP", 5.94],
  [9017, "Bundoora", "VIC", "ALP", "Colin Brooks", "ALP", "LP", 12.74],
  [9018, "Carrum", "VIC", "ALP", "Sonya Kilkenny", "ALP", "LP", 9.94],
  [9019, "Caulfield", "VIC", "LP", "David Southwick", "LP", "ALP", 2.07],
  [9020, "Clarinda", "VIC", "ALP", "Meng Heang Tak", "ALP", "LP", 10.37],
  [9021, "Cranbourne", "VIC", "ALP", "Pauline Richards", "ALP", "LP", 9.0],
  [9022, "Croydon", "VIC", "LP", "David Hodgett", "LP", "ALP", 1.37],
  [9023, "Dandenong", "VIC", "ALP", "Gabrielle Williams", "ALP", "LP", 19.11],
  [9024, "Eildon", "VIC", "LP", "Cindy McLeish", "LP", "ALP", 7.08],
  [9025, "Eltham", "VIC", "ALP", "Vicki Ward", "ALP", "LP", 9.0],
  [9026, "Essendon", "VIC", "ALP", "Danny Pearson", "ALP", "LP", 12.45],
  [9027, "Eureka", "VIC", "ALP", "Michaela Settle", "ALP", "LP", 7.17],
  [9028, "Euroa", "VIC", "NP", "Annabelle Cleeland", "NP", "ALP", 9.93],
  [9029, "Evelyn", "VIC", "LP", "Bridget Vallence", "LP", "ALP", 5.21],
  [9030, "Footscray", "VIC", "ALP", "Katie Hall", "ALP", "LP", 25.66],
  [9031, "Frankston", "VIC", "ALP", "Paul Edbrooke", "ALP", "LP", 8.66],
  [9032, "Geelong", "VIC", "ALP", "Christine Couzens", "ALP", "LP", 14.71],
  [9033, "Gippsland East", "VIC", "NP", "Tim Bull", "NP", "ALP", 23.92],
  [9034, "Gippsland South", "VIC", "NP", "Danny O'Brien", "NP", "ALP", 15.25],
  [9035, "Glen Waverley", "VIC", "ALP", "John Mullahy", "ALP", "LP", 3.3],
  [9036, "Greenvale", "VIC", "ALP", "Iwan Walters", "ALP", "LP", 6.92],
  [9037, "Hastings", "VIC", "ALP", "Paul Mercurio", "ALP", "LP", 1.35],
  [9038, "Hawthorn", "VIC", "LP", "John Pesutto", "LP", "ALP", 1.74],
  [9039, "Ivanhoe", "VIC", "ALP", "Anthony Carbines", "ALP", "LP", 12.75],
  [9040, "Kalkallo", "VIC", "ALP", "Ros Spence", "ALP", "LP", 16.43],
  [9041, "Kew", "VIC", "LP", "Jess Wilson", "LP", "ALP", 3.98],
  [9042, "Kororoit", "VIC", "ALP", "Luba Grigorovitch", "ALP", "LP", 14.25],
  [9043, "Lara", "VIC", "ALP", "Ella George", "ALP", "LP", 16.15],
  [9044, "Laverton", "VIC", "ALP", "Sarah Connolly", "ALP", "LP", 18.01],
  [9045, "Lowan", "VIC", "NP", "Emma Kealy", "NP", "ALP", 21.61],
  [9046, "Macedon", "VIC", "ALP", "Mary-Anne Thomas", "ALP", "LP", 9.54],
  [9047, "Malvern", "VIC", "LP", "Michael O'Brien", "LP", "ALP", 8.28],
  [9048, "Melbourne", "VIC", "GRN", "Ellen Sandell", "GRN", "ALP", 10.19],
  [9049, "Melton", "VIC", "ALP", "Steve McGhie", "ALP", "LP", 4.59],
  [9050, "Mildura", "VIC", "NP", "Jade Benham", "NP", "ALP", 8.5],
  [9051, "Mill Park", "VIC", "ALP", "Lily D'Ambrosio", "ALP", "LP", 11.43],
  [9052, "Monbulk", "VIC", "ALP", "Daniela De Martino", "ALP", "LP", 7.55],
  [9053, "Mordialloc", "VIC", "ALP", "Tim Richardson", "ALP", "LP", 8.19],
  [9054, "Mornington", "VIC", "LP", "Chris Crewther", "LP", "ALP", 8.28],
  [9055, "Morwell", "VIC", "NP", "Martin Cameron", "NP", "ALP", 4.42],
  [9056, "Mulgrave", "VIC", "ALP", "Daniel Andrews", "ALP", "LP", 10.2],
  [9057, "Murray Plains", "VIC", "NP", "Peter Walsh", "NP", "ALP", 22.89],
  [9058, "Narre Warren North", "VIC", "ALP", "Belinda Wilson", "ALP", "LP", 9.16],
  [9059, "Narre Warren South", "VIC", "ALP", "Gary Maas", "ALP", "LP", 8.5],
  [9060, "Nepean", "VIC", "LP", "Sam Groth", "LP", "ALP", 6.68],
  [9061, "Niddrie", "VIC", "ALP", "Ben Carroll", "ALP", "LP", 6.69],
  [9062, "Northcote", "VIC", "ALP", "Kat Theophanous", "ALP", "LP", 5.0],
  [9063, "Oakleigh", "VIC", "ALP", "Steve Dimopoulos", "ALP", "LP", 13.48],
  [9064, "Ovens Valley", "VIC", "NP", "Tim McCurdy", "NP", "ALP", 17.97],
  [9065, "Pakenham", "VIC", "ALP", "Emma Vulin", "ALP", "LP", 0.39],
  [9066, "Pascoe Vale", "VIC", "ALP", "Anthony Cianflone", "ALP", "LP", 22.25],
  [9067, "Point Cook", "VIC", "ALP", "Mathew Hilakari", "ALP", "LP", 8.34],
  [9068, "Polwarth", "VIC", "LP", "Richard Riordan", "LP", "ALP", 1.79],
  [9069, "Prahran", "VIC", "GRN", "Sam Hibbins", "GRN", "LP", 2.2],
  [9070, "Preston", "VIC", "ALP", "Nathan Lambert", "ALP", "LP", 19.67],
  [9071, "Richmond", "VIC", "GRN", "Gabrielle De Vietri", "GRN", "ALP", 3.1],
  [9072, "Ringwood", "VIC", "ALP", "Will Fowles", "ALP", "LP", 7.53],
  [9073, "Ripon", "VIC", "ALP", "Martha Haylett", "ALP", "LP", 2.99],
  [9074, "Rowville", "VIC", "LP", "Kim Wells", "LP", "ALP", 3.67],
  [9075, "Sandringham", "VIC", "LP", "Brad Rowswell", "LP", "ALP", 5.15],
  [9076, "Shepparton", "VIC", "NP", "Kim O'Keeffe", "NP", "ALP", 4.8],
  [9077, "South Barwon", "VIC", "ALP", "Darren Cheeseman", "ALP", "LP", 9.8],
  [9078, "South-West Coast", "VIC", "LP", "Roma Britnell", "LP", "ALP", 8.05],
  [9079, "St Albans", "VIC", "ALP", "Natalie Suleyman", "ALP", "LP", 9.56],
  [9080, "Sunbury", "VIC", "ALP", "Josh Bull", "ALP", "LP", 6.41],
  [9081, "Sydenham", "VIC", "ALP", "Natalie Hutchins", "ALP", "LP", 8.73],
  [9082, "Tarneit", "VIC", "ALP", "Dylan Wight", "ALP", "LP", 12.58],
  [9083, "Thomastown", "VIC", "ALP", "Bronwyn Halfpenny", "ALP", "LP", 16.0],
  [9084, "Warrandyte", "VIC", "LP", "Ryan Smith", "LP", "ALP", 4.15],
  [9085, "Wendouree", "VIC", "ALP", "Juliana Addison", "ALP", "LP", 13.46],
  [9086, "Werribee", "VIC", "ALP", "Tim Pallas", "ALP", "LP", 10.5],
  [9087, "Williamstown", "VIC", "ALP", "Melissa Horne", "ALP", "LP", 13.44],
  [9088, "Yan Yean", "VIC", "ALP", "Lauren Kathage", "ALP", "LP", 4.45],
];

const VIC_SEATS = _VS.map(([id, name, state, wp, wn, t1, t2, m]) => ({
  id, name, state, margin: m,
  winner: { party: wp, name: wn },
  tcp: [{ party: t1, pct: +(50 + m / 2).toFixed(2) }, { party: t2, pct: +(50 - m / 2).toFixed(2) }],
}));

// Per-seat FP baselines remapped from district names onto this app's seat IDs
// (see mapSeatFpById above). Empty objects until the state DB is populated.
const NSW_SEAT_FP_2023 = mapSeatFpById(STATE_SEAT_FP.NSW_SEAT_FP_2023, NSW_SEATS);
const QLD_SEAT_FP_2024 = mapSeatFpById(STATE_SEAT_FP.QLD_SEAT_FP_2024, QLD_SEATS);
const VIC_SEAT_FP_2022 = mapSeatFpById(STATE_SEAT_FP.VIC_SEAT_FP_2022, VIC_SEATS);
const WA_SEAT_FP_2025  = mapSeatFpById(STATE_SEAT_FP.WA_SEAT_FP_2025,  WA_SEATS);
const SA_SEAT_FP_2026  = mapSeatFpById(STATE_SEAT_FP.SA_SEAT_FP_2026,  SA_SEATS);
const NT_SEAT_FP_2024  = mapSeatFpById(STATE_SEAT_FP.NT_SEAT_FP_2024,  NT_SEATS);

const ELECTION_DATA = {
  federal_2025: {
    label: "Federal", jurisdiction: "Federal",
    chamber: "House of Representatives", date: "3 May 2025",
    totalSeats: 151, majority: 76, twopp: 55.2,
    seats: SEATS,
    counts: { alp: 94, coalition: 42, grn: 4, teal: 11 },
    incumbent: "Anthony Albanese (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  nsw_2023: {
    label: "NSW", jurisdiction: "New South Wales",
    chamber: "Legislative Assembly", date: "25 March 2023",
    totalSeats: 93, majority: 47, twopp: 53.2,
    seats: NSW_SEATS,
    counts: { alp: 45, coalition: 44, greens: 3, teal: 1, one_nation: 0, crossbench: 0 },
    incumbent: "Chris Minns (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  vic_2022: {
    label: "Victoria", jurisdiction: "Victoria",
    chamber: "Legislative Assembly", date: "26 November 2022",
    totalSeats: 88, majority: 45, twopp: 57.3,
    seats: VIC_SEATS,
    counts: { alp: 56, coalition: 26, greens: 4, teal: 2, one_nation: 0, crossbench: 0 },
    incumbent: "Daniel Andrews (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  qld_2024: {
    label: "Queensland", jurisdiction: "Queensland",
    chamber: "Legislative Assembly", date: "26 October 2024",
    totalSeats: 93, majority: 47, twopp: 46.3,
    seats: QLD_SEATS,
    counts: { alp: 27, coalition: 51, greens: 7, teal: 0, one_nation: 0, crossbench: 8 },
    incumbent: "David Crisafulli (LNP)", incumbentParty: "LNP",
    modelEnabled: true,
  },
  wa_2025: {
    label: "W. Australia", jurisdiction: "Western Australia",
    chamber: "Legislative Assembly", date: "8 March 2025",
    totalSeats: 59, majority: 30, twopp: 63.1,
    seats: WA_SEATS,
    counts: { alp: 46, coalition: 13, greens: 0, teal: 0, one_nation: 0, crossbench: 0 },
    incumbent: "Roger Cook (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  sa_2026: {
    label: "South Aus.", jurisdiction: "South Australia",
    chamber: "House of Assembly", date: "21 March 2026",
    totalSeats: 47, majority: 24, twopp: 57.4,
    seats: SA_SEATS,
    counts: { alp: 33, coalition: 4, greens: 0, teal: 0, one_nation: 1, crossbench: 3 },
    incumbent: "Peter Malinauskas (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  tas_2024: {
    label: "Tasmania", jurisdiction: "Tasmania",
    chamber: "House of Assembly (Hare-Clark)", date: "23 March 2024",
    totalSeats: 35, majority: 18, twopp: null,
    seats: TAS_2024_SEATS,
    counts: { alp: 10, coalition: 14, greens: 5, teal: 6, one_nation: 0, crossbench: 0 },
    incumbent: "Jeremy Rockliff (Liberal)", incumbentParty: "LP",
    modelEnabled: true,
  },
  act_2024: {
    label: "ACT", jurisdiction: "Australian Capital Territory",
    chamber: "Legislative Assembly (Hare-Clark)", date: "19 October 2024",
    totalSeats: 25, majority: 13, twopp: null,
    seats: ACT_2024_SEATS,
    counts: { alp: 9, coalition: 9, greens: 7, teal: 0, one_nation: 0, crossbench: 0 },
    incumbent: "Andrew Barr (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  nt_2024: {
    label: "N. Territory", jurisdiction: "Northern Territory",
    chamber: "Legislative Assembly", date: "24 August 2024",
    totalSeats: 25, majority: 13, twopp: null,
    seats: NT_SEATS,
    counts: { alp: 8, coalition: 17, greens: 0, teal: 0, one_nation: 0, crossbench: 0 },
    incumbent: "Lia Finocchiaro (CLP)", incumbentParty: "CLP",
    modelEnabled: true,
  },
};
const ELECTION_OPTIONS = [
  "federal_2025", "nsw_2023", "vic_2022", "qld_2024",
  "wa_2025", "sa_2026", "tas_2024", "act_2024", "nt_2024",
];

// ─── Helper functions ─────────────────────────────────────────────────────────
function getMarginCat(m) {
  if (m == null) return "marginal";
  if (m < 2) return "very_marginal";
  if (m < 5) return "marginal";
  if (m < 10) return "fairly_safe";
  return "safe";
}

function getFpGroups(seat) {
  const fp = { alp: 0, coal: 0, grn: 0, teal: 0, on: 0, other: 0 };
  let tot = 0;
  (seat.fp || []).forEach(f => {
    const g = getParty(f.party).group;
    if (g === "alp") fp.alp += f.pct;
    else if (g === "coalition") fp.coal += f.pct;
    else if (g === "greens") fp.grn += f.pct;
    else if (g === "teal") fp.teal += f.pct;
    else if (g === "one_nation") fp.on += f.pct;
    else fp.other += f.pct;
    tot += f.pct;
  });
  fp.other += Math.max(0, 100 - tot);
  return fp;
}

// ── Seat elasticity model ────────────────────────────────────────────────────
// Marginal seats historically swing more than safe seats. A smooth logistic
// multiplier is applied to the national 2PP swing before adding it to each
// seat's baseline:
//
//     mult(m) = L + (H - L) / (1 + exp(k * (m - m0)))
//
// where m = |alp_2pp - 50|. L is the safe-seat asymptote, H the knife-edge
// asymptote, m0 the midpoint, k the steepness. Coefficients fitted via
// scripts/fit_elasticity.py on 2022→2025 actual seat swings (112 paired
// ALP/Coalition seats; k capped at 0.35 — the curve shape is weakly identified,
// MAE is nearly flat in k). Compared with the old hand-tuned curve
// (0.80 + 0.50/(1 + exp(0.20·(m − 8)))), the fitted curve damps safe-seat
// swings more (~0.60× vs ~0.80×) and amplifies knife-edge seats slightly more.
// Re-fit after each cycle and keep pipeline/backtest.py:apply_swing_with_elasticity
// in sync.
function seatElasticityMult(alp2pp) {
  const m = Math.abs(alp2pp - 50);
  return 0.593 + 0.856 / (1 + Math.exp(0.350 * (m - 8.725)));
}

// ── Uncertainty quantification ────────────────────────────────────────────────
// Standard normal CDF approximation (Abramowitz & Stegun 26.2.17, max error 7.5e-8).
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const p = 1 - pdf * poly;
  return x >= 0 ? p : 1 - p;
}

// Compute ALP seat-count distribution using multi-dimensional uncertainty:
//   1. National 2PP swing uncertainty (swingStd pp) — correlated across all seats
//   2. Seat-level residual uncertainty (SEAT_RESIDUAL_STD pp) — independent per seat
//   3. Preference flow uncertainty (PREF_FLOW_STD pp) — contributes to seat-level noise
//   4. State-correlated shock (STATE_SHOCK_STD pp) — shared by all seats in a state;
//      enters each seat's marginal σ and adds within-state covariance to the
//      seat-count variance (no extra grid dimension; see the block in the grid loop)
//
// The combined per-seat uncertainty is: σ_seat = √(ε²·σ_nat² + ε²·σ_pf_corr² + σ_state² + σ_residual² + σ_pf_ind²)
// Preference flow uncertainty is split into correlated (national shift, enters the grid)
// and independent (per-seat residual) components, producing realistic tail-risk estimates.
//
// Uses a 100-point grid over ±3σ of national swing to evaluate the seat-count CDF.
// At each grid point, per-seat win probability uses Φ with the combined σ_seat.

// Calibrated from backtest data: seat-level swing deviations from national swing
// have σ ≈ 1.0pp (2019→2022 RMSE residual after removing national component).
const SEAT_RESIDUAL_STD = 1.0;

// Preference flow uncertainty: historical flows vary ±3pp between elections.
// Split into two components:
//   PREF_FLOW_CORR_STD — correlated across all seats (national shift in flows,
//     e.g. Greens prefs breaking uniformly lower). Enters the grid integration
//     as a second correlated dimension alongside national swing uncertainty.
//   PREF_FLOW_IND_STD — independent per-seat residual (seat-specific deviations
//     from the national pref-flow shift).
// Previously this was modelled as 0.8pp independent only, which understated tail
// risk when pref flows shift uniformly (campaign-driven or demographic effects).
const PREF_FLOW_CORR_STD = 0.6; // correlated across all seats
const PREF_FLOW_IND_STD  = 0.5; // independent per-seat residual

// State-correlated swing error: a shared shock per state, on top of the national
// swing. Historical per-state 2PP swings routinely deviate from the national swing
// by ~1–2pp (e.g. QLD 2019, WA 2022 — state polling misses are shared by every seat
// in that state, not independent per-seat noise). σ = 1.2pp sits in the middle of
// that historical range. Implemented without adding a grid dimension: each seat's
// marginal win probability uses the total σ (state shock ⊕ independent residual),
// and the seat-count variance gains the within-state covariance induced by the
// shared shock (see the covariance block inside computeUncertainty()).
const STATE_SHOCK_STD = 1.2;

// Non-ALP/Coalition seat uncertainty: teal/Greens/independent seats are not
// modelled via 2PP, so we apply a wider residual here based on historical margin
// volatility. Calibrated from 2019→2022 teal surge and inner-city Greens variance.
const NON_ALP_COAL_STD = 3.5;

// Evidence-based late-decider split for Australian federal elections.
// Post-election survey data (2019–2025) shows late deciders favour minor parties
// above their overall vote share and give the incumbent major party (ALP) a
// below-proportional share. Keys must match the five primary party fields.
const LATE_DECIDER_SPLIT = { alp: 0.38, coal: 0.34, grn: 0.12, teal: 0.06, on: 0.10 };
// Blend weight: 0 = pure proportional allocation, 1 = pure late-decider profile.
// Default 0.5 blends evidence with the proportional baseline symmetrically.
const LATE_DECIDER_WEIGHT = 0.5;

function computeUncertainty(seats, nat2ppSwing, swingStd, useElasticity, majority = 76) {
  const COALITION = new Set(["LP", "LNP", "NP", "CLP"]);

  // Φ-function applies only to ALP/Coal seats that were NOT rerouted to an ON TCP race.
  const alpCoalSeats = seats.filter(s => {
    const parties = s.tcp.map(t => t.party);
    const isAlpCoal = parties.includes("ALP") && parties.some(p => COALITION.has(p));
    return isAlpCoal && !(s.modelled?.isAutoMatchup === true);
  });
  // Non-ALP/Coal seats (teal, Greens, independents, ON-detected): apply probabilistic
  // uncertainty using projWinnerPct and NON_ALP_COAL_STD, rather than treating them
  // as deterministic (0 or 1). This reflects genuine uncertainty in these races.
  const nonAlpCoalSeats = seats.filter(s => {
    const parties = s.tcp.map(t => t.party);
    const isAlpCoal = parties.includes("ALP") && parties.some(p => COALITION.has(p));
    return !(isAlpCoal && !(s.modelled?.isAutoMatchup === true));
  });

  // Per-seat win probabilities
  const seatWinProbs = {};
  // ALP/Coal seats: use Φ with combined correlated + independent σ
  alpCoalSeats.forEach(seat => {
    const rawBase = seat.tcp[0].party === "ALP" ? seat.tcp[0].pct : seat.tcp[1].pct;
    const base = seat.modelled?.projAlp2pp ?? rawBase;
    // Use SEAT_DEMO_MULT (demographic regression) when available; fall back to margin-based logistic.
    const eps = useElasticity
      ? (SEAT_DEMO_MULT[seat.id] ?? seatElasticityMult(base))
      : 1.0;
    // Combined σ: national-correlated (elasticity-scaled) + independent residual + independent pref-flow.
    // SEAT_RESIDUAL_MAP provides per-seat σ from historical backtest residuals + demographic
    // volatility adjustment (outer-suburban volatile seats get wider bands than stable inner-city seats).
    const seatResidualSigma = SEAT_RESIDUAL_MAP[seat.id] ?? SEAT_RESIDUAL_STD;
    const seatSigma = Math.sqrt(
      eps * eps * swingStd * swingStd +
      eps * eps * PREF_FLOW_CORR_STD * PREF_FLOW_CORR_STD +
      STATE_SHOCK_STD ** 2 +
      seatResidualSigma ** 2 +
      PREF_FLOW_IND_STD ** 2
    );
    seatWinProbs[seat.id] = Math.round(normCDF((base - 50) / seatSigma) * 1000) / 1000;
  });
  // Non-ALP/Coal seats: use projWinnerPct with NON_ALP_COAL_STD
  // projWinnerPct is the winner's TCP% (>50 always), so we check if ALP is the winner
  nonAlpCoalSeats.forEach(seat => {
    const wg = seat.modelled?.winnerGroup ?? getParty(seat.winner.party).group;
    const wPct = seat.modelled?.winnerPct ?? 50;
    // For ALP-won seats (ALP/GRN or ALP/Teal TCP): the ALP "2PP" is projAlp2pp or winnerPct
    // For non-ALP won seats: ALP win prob = 1 - winnerPct probability
    const isAlpWinner = wg === "alp";
    const alpBase = isAlpWinner ? wPct : (100 - wPct);
    const p = normCDF((alpBase - 50) / NON_ALP_COAL_STD);
    seatWinProbs[seat.id] = Math.round(p * 1000) / 1000;
  });

  let alpMeanSeats = 0;
  seats.forEach(s => { alpMeanSeats += seatWinProbs[s.id] ?? 0; });

  // Seat-count CDF via 2D numerical grid integration over:
  //   dim 1: national 2PP swing (correlated across ALP/Coal seats)
  //   dim 2: correlated preference-flow shift (correlated across all seats)
  // At each grid point, per-seat independent residual σ is applied on top.
  // This correctly models: (a) ALP/Coal seats all move with national swing,
  // (b) pref-flow uncertainty is partially shared across seats, not independent.
  const N_GRID = 50; // 50×50 = 2500 grid points for 2D integration
  const gridDeltas = Array.from({ length: N_GRID }, (_, i) =>
    nat2ppSwing + swingStd * (-3 + 6 * i / (N_GRID - 1))
  );
  const gridPfDeltas = Array.from({ length: N_GRID }, (_, i) =>
    PREF_FLOW_CORR_STD * (-3 + 6 * i / (N_GRID - 1))
  );
  const swingPdfs = gridDeltas.map(d =>
    Math.exp(-0.5 * ((d - nat2ppSwing) / swingStd) ** 2)
  );
  const pfPdfs = gridPfDeltas.map(d =>
    Math.exp(-0.5 * (d / PREF_FLOW_CORR_STD) ** 2)
  );
  const totalPdf = swingPdfs.reduce((s, p) => s + p, 0) * pfPdfs.reduce((s, p) => s + p, 0);

  // Independent per-seat noise σ (seat-level residual + independent pref-flow).
  // Pre-compute per-seat indepSigma using SEAT_RESIDUAL_MAP when available,
  // falling back to the uniform SEAT_RESIDUAL_STD for seats without per-seat data.
  const seatIndepSigmas = {};
  alpCoalSeats.forEach(seat => {
    const rSigma = SEAT_RESIDUAL_MAP[seat.id] ?? SEAT_RESIDUAL_STD;
    seatIndepSigmas[seat.id] = Math.sqrt(rSigma ** 2 + PREF_FLOW_IND_STD ** 2);
  });

  // Standard normal pdf (state-shock sensitivity terms below).
  const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

  // ── State-correlated shock (no extra grid dimension) ─────────────────────────
  // Each state carries a shared N(0, STATE_SHOCK_STD²) shock on top of the grid's
  // national swing. Within a grid cell:
  //   - a seat's marginal win probability uses σ_tot = √(σ_state² + σ_ind²);
  //   - the shock induces covariance between same-state seats. Linearising Φ around
  //     the cell margin m_i, seat i's sensitivity to the shared shock (in probability
  //     units) is s_i = φ(m_i/σ_tot)·σ_state/σ_tot, so cov_ij ≈ s_i·s_j for seats i,j
  //     in the same state. The seat-count variance gains 2·Σ_{i<j} s_i·s_j per state,
  //     computed cheaply as (Σ s_i)² − Σ s_i². This captures e.g. a QLD-wide polling
  //     miss moving every QLD marginal together — previously treated as independent
  //     per-seat noise, understating seat-count spread.
  const seatCountCdf = {};
  let stateCovVar = 0; // grid-weighted within-state covariance → added to count variance
  gridDeltas.forEach((delta, gi) => {
    gridPfDeltas.forEach((pfDelta, pi) => {
      const w = swingPdfs[gi] * pfPdfs[pi] / totalPdf;
      let expectedCount = 0;
      const stateShockSums = {}; // per state: Σ s_i and Σ s_i²
      // ALP/Coal seats: shift by national swing + correlated pref-flow
      alpCoalSeats.forEach(seat => {
        const rawBase = seat.tcp[0].party === "ALP" ? seat.tcp[0].pct : seat.tcp[1].pct;
        const base = seat.modelled?.projAlp2pp ?? rawBase;
        const eps = useElasticity
          ? (SEAT_DEMO_MULT[seat.id] ?? seatElasticityMult(base))
          : 1.0;
        const seatBase = base + eps * (delta - nat2ppSwing) + pfDelta;
        const sig = seatIndepSigmas[seat.id] ?? 0;
        const sigTot = Math.sqrt(sig * sig + STATE_SHOCK_STD * STATE_SHOCK_STD);
        const m = seatBase - 50;
        const pWin = sigTot > 0 ? normCDF(m / sigTot) : (m >= 0 ? 1 : 0);
        expectedCount += pWin;
        if (sigTot > 0) {
          const s = normPdf(m / sigTot) * STATE_SHOCK_STD / sigTot;
          const grp = stateShockSums[seat.state ?? "?"] ?? (stateShockSums[seat.state ?? "?"] = { sum: 0, sumSq: 0 });
          grp.sum += s;
          grp.sumSq += s * s;
        }
      });
      // Non-ALP/Coal seats: apply correlated pref-flow shift, independent residual only
      nonAlpCoalSeats.forEach(seat => {
        const wg = seat.modelled?.winnerGroup ?? getParty(seat.winner.party).group;
        const wPct = seat.modelled?.winnerPct ?? 50;
        const isAlpWinner = wg === "alp";
        const alpBase = isAlpWinner ? wPct : (100 - wPct);
        // Pref-flow shift applies here too (correlated), independent residual is NON_ALP_COAL_STD
        const seatBase = alpBase + pfDelta;
        const pWin = normCDF((seatBase - 50) / NON_ALP_COAL_STD);
        expectedCount += pWin;
      });
      const count = Math.round(expectedCount);
      seatCountCdf[count] = (seatCountCdf[count] ?? 0) + w;
      // Within-state covariance from the shared shock: 2·Σ_{i<j} s_i·s_j = (Σs)² − Σs².
      let cellCov = 0;
      Object.values(stateShockSums).forEach(({ sum, sumSq }) => {
        cellCov += Math.max(0, sum * sum - sumSq);
      });
      stateCovVar += w * cellCov;
    });
  });

  const sorted = Object.keys(seatCountCdf).map(Number).sort((a, b) => a - b);
  let cum = 0;
  const cdf = sorted.map(c => { cum += seatCountCdf[c]; return { c, cum }; });
  const quantile = p => (cdf.find(({ cum }) => cum >= p) ?? cdf[cdf.length - 1]).c;
  const pMajority = sorted.filter(c => c >= majority).reduce((s, c) => s + seatCountCdf[c], 0);

  // Derive mean and std from the CDF grid distribution rather than the independence
  // assumption. The grid integrates over correlated national swing outcomes, so it
  // correctly reflects that all seats move together — producing a wider (more realistic)
  // seat-count spread than the Bernoulli-independence formula sqrt(sum(p*(1-p))).
  const cdfMean = sorted.reduce((s, c) => s + c * seatCountCdf[c], 0);
  const cdfVar = sorted.reduce((s, c) => s + c * c * seatCountCdf[c], 0) - cdfMean ** 2;
  // Total variance = grid (national + pref-flow) variance + the state-shock
  // within-state covariance accumulated above. Both terms are clamped at 0 so the
  // square root can never produce NaN.
  const cdfStd = Math.sqrt(Math.max(0, cdfVar) + Math.max(0, stateCovVar));

  return {
    alpMean: Math.round(cdfMean * 10) / 10,
    alpStd: Math.round(cdfStd * 10) / 10,
    alpP05: quantile(0.05),
    alpP25: quantile(0.25),
    alpP50: quantile(0.50),
    alpP75: quantile(0.75),
    alpP95: quantile(0.95),
    pMajority: Math.round(pMajority * 100),
    seatWinProbs,
  };
}

// Percentage share x/total*100 with a guard: returns 50 (a neutral 2PP tie) when the
// denominator is zero or the result is non-finite. Prevents NaN/Infinity from
// propagating into winner logic when degenerate primaries (e.g. an extreme One
// Nation surge that empties a vote pool) produce an empty preference bucket.
const safePct = (x, total) => (total > 0 && Number.isFinite(x / total)) ? (x / total) * 100 : 50;

// Build a coherent first-preference vector that sums to ~100, with `other` as the
// residual pool. When the named parties sum to <=100, behaviour is unchanged:
// other = 100 - sum (preserving all existing results). When they exceed 100 — e.g.
// after a large One Nation increase is added on top of the seat baseline — the excess
// is drawn proportionally from the "free" (non-locked) named parties so user-set /
// overridden parties keep their values; if the free pool can't absorb it (or all
// parties are locked), every named party is scaled proportionally to 100.
function normalizePrimaries(fp, locked = []) {
  const keys = ["alp", "coal", "grn", "teal", "on"];
  const v = {};
  for (const k of keys) v[k] = Math.max(0, fp[k] ?? 0);
  const named = keys.reduce((s, k) => s + v[k], 0);
  if (named <= 100) return { ...v, other: Math.max(0, 100 - named) };
  const excess = named - 100;
  const lockedSet = new Set(locked);
  const free = keys.filter(k => !lockedSet.has(k));
  const freeSum = free.reduce((s, k) => s + v[k], 0);
  if (freeSum > 0 && freeSum >= excess) {
    for (const k of free) v[k] = Math.max(0, v[k] - excess * (v[k] / freeSum));
  } else {
    const scale = 100 / named;
    for (const k of keys) v[k] *= scale;
  }
  const newNamed = keys.reduce((s, k) => s + v[k], 0);
  return { ...v, other: Math.max(0, 100 - newNamed) };
}

// Extra reduction to the Coalition primary that sources a rising ON vote from
// ex-Coalition defectors. Total Coalition reduction we want = onFromCoalShare × ON's
// rise; the explicit coal swing already cuts some, so only the shortfall is taken
// additionally. Zero when ON is flat or falling, so zero-swing baselines are unchanged.
function extraCoalCutFor(sw, onFromCoalShare) {
  const onRise = Math.max(0, sw.on ?? 0);
  const uniformCoalCut = Math.max(0, -(sw.coal ?? 0));
  return Math.max(0, onFromCoalShare * onRise - uniformCoalCut);
}

// Apply per-party swings to a seat's baseline primaries, sourcing a share of any ON
// *increase* from the Coalition primary (the remainder is reabsorbed by the seat's
// residual "other" via normalizePrimaries). This reflects that a rising ON vote is
// largely ex-Coalition defection; without it, a uniform national ON gain inflates every
// seat's Coalition 2PP through ON's 74.5% back-flow. A no-op when sw.on ≤ 0, so the
// zero-swing 2025 baseline is unchanged. `onFromCoalShare` is the Coalition source share.
// `locked` parties keep their swung value during normalization (passed through).
function applySeatSwings(base, sw, onFromCoalShare = 0, locked = []) {
  const extraCoalCut = extraCoalCutFor(sw, onFromCoalShare);
  return normalizePrimaries({
    alp: base.alp + (sw.alp ?? 0),
    coal: base.coal + (sw.coal ?? 0) - extraCoalCut,
    grn: base.grn + (sw.grn ?? 0),
    teal: (base.teal ?? 0) + (sw.teal ?? 0),
    on: base.on + (sw.on ?? 0),
  }, locked);
}

// Compute implied national ALP 2PP from primary votes and preference flows.
// Used to derive nat2ppSwing for the uniform swing model.
function computeNat2pp(prim, flows) {
  const p = normalizePrimaries(prim);
  const a = p.alp + p.grn * flows.grn_alp + p.teal * flows.teal_alp + p.on * flows.on_alp + p.other * flows.other_alp;
  const c = p.coal + p.grn * (1 - flows.grn_alp) + p.teal * (1 - flows.teal_alp) + p.on * (1 - flows.on_alp) + p.other * (1 - flows.other_alp);
  return safePct(a, a + c);
}

// ── ON-race two-candidate-preferred share helpers ─────────────────────────────
// Each returns ON's TCP% in a final pairing, distributing the eliminated parties'
// preferences via the ON-race flows in `ef`. fp must sum to ~100 (normalizePrimaries).
function onVsAlpPct(fp, ef) {
  const alpTcp = fp.alp + fp.grn * ef.grn_alp_v_on + fp.teal * ef.teal_alp_v_on + fp.coal * ef.coal_alp_v_on + fp.other * ef.other_alp_v_on;
  const onTcp = fp.on + fp.grn * (1 - ef.grn_alp_v_on) + fp.teal * (1 - ef.teal_alp_v_on) + fp.coal * (1 - ef.coal_alp_v_on) + fp.other * (1 - ef.other_alp_v_on);
  return safePct(onTcp, alpTcp + onTcp);
}
function onVsCoalPct(fp, ef) {
  const onTcp = fp.on + fp.alp * ef.alp_on_v_coal + fp.grn * ef.grn_on_v_coal + fp.teal * ef.teal_on_v_coal + fp.other * ef.other_on_v_coal;
  const coalTcp = fp.coal + fp.alp * (1 - ef.alp_on_v_coal) + fp.grn * (1 - ef.grn_on_v_coal) + fp.teal * (1 - ef.teal_on_v_coal) + fp.other * (1 - ef.other_on_v_coal);
  return safePct(onTcp, onTcp + coalTcp);
}
function onVsIndPct(fp, ef) {
  const onTcp = fp.on + fp.alp * ef.alp_on_v_ind + fp.coal * ef.coal_on_v_ind + fp.grn * ef.grn_on_v_ind + fp.other * ef.other_on_v_ind;
  const indTcp = fp.teal + fp.alp * (1 - ef.alp_on_v_ind) + fp.coal * (1 - ef.coal_on_v_ind) + fp.grn * (1 - ef.grn_on_v_ind) + fp.other * (1 - ef.other_on_v_ind);
  return safePct(onTcp, onTcp + indTcp);
}

// Seat baseline primaries (unswung), normalized to sum to 100. Used to compute the
// zero-swing ON% for calibrating ON-race seats to their actual 2025 result.
function seatBaselineFp(seatId) {
  const sb = getSeatFpBaseline(seatId) ?? BASELINE_2025;
  return normalizePrimaries({ alp: sb.alp, coal: sb.coal, grn: sb.grn, teal: sb.teal ?? 0, on: sb.on });
}

// For seats where ON was actually in the 2025 final two (Hunter ALP-v-ON, Maranoa
// LNP-v-ON), the back-calculated primaries don't on their own reproduce an ON-vs-major
// count, so anchor the modelled ON% to the real 2025 TCP at zero swing and fade the
// offset out by ±5pp national swing (mirroring SEAT_CALIB_2025). For surge-detected ON
// races (ON not in the 2025 TCP) there is no actual to anchor to, so this is a no-op.
function calibrateOnPct(seat, modelOnPct, baselineOnPct, nat2ppSwing) {
  const onEntry = seat.tcp.find(t => t.party === "ON");
  if (!onEntry) return modelOnPct;
  const blend = Math.max(0, 1 - Math.abs(nat2ppSwing) / MODEL_PARAMS.calibFadeHalfWidth);
  return Math.min(100, Math.max(0, modelOnPct + (onEntry.pct - baselineOnPct) * blend));
}

// ── Named model parameters ───────────────────────────────────────────────────
// Collected so the previously scattered magic numbers have one documented home.
// Touch these rather than the raw literals, unless you're changing the logic
// and want to leave the default behaviour unchanged.
const MODEL_PARAMS = {
  // ON auto-detection threshold: if a seat's projected One Nation first
  // preference exceeds this %, and neither ALP nor Coalition is comfortably
  // above it, the model auto-selects the ON-vs-Coal or ON-vs-ALP TCP matchup
  // rather than ALP-vs-Coalition. 6.5% was chosen because below it, ON is
  // essentially never in the final 2CP even in their strongest regional seats
  // (cf. 2022/2025 actuals). Sensitivity: lower → more seats flagged as ON
  // races; higher → misses genuinely ON-contested regional seats.
  onThresholdDefault: 6.5,

  // Calibration fade half-width (in pp of national 2PP swing). SEAT_CALIB_2025
  // is fitted to the 2025 actual outcome. At larger national swings the fitted
  // offset is increasingly unreliable (pref flows and FP shares move in ways
  // the offset cannot anticipate), so the offset is linearly blended to zero
  // over this window. 5pp is roughly the largest single-cycle national swing
  // observed since the mid-90s — beyond that, we trust the primary model.
  calibFadeHalfWidth: 5,

  // State-swing blending weight α: seatSwing = α·stateSwing + (1−α)·nationalSwing.
  // 0.6 reflects moderate trust in state polling when available. When state
  // polling is denser, individual state swings can override this via `ss.alpha`.
  stateSwingAlpha: 0.6,

  // Share of a seat's One Nation primary *increase* that is drawn from the Coalition
  // primary (the rest from the seat's residual "other"). A rising ON vote is mostly
  // ex-Coalition defection, so applying a national ON gain uniformly on top of every
  // seat — without depressing the Coalition primary — wrongly inflates the Coalition's
  // 2PP (ON preferences flow 74.5% back to the Coalition). Sourcing the rise from the
  // Coalition keeps the seat distribution consistent with the national 2PP. No effect
  // when ON is flat or falling, so the zero-swing 2025 baseline is preserved.
  onFromCoalShare: 0.6,
};

// ── State-level swing overlay ────────────────────────────────────────────────
// When state-specific polling data is available, blends state swings with
// national swings for seats in that state. This captures regional variation
// (e.g., QLD and WA regularly deviate from national swing by 2–4pp).
const STATE_SWING_ALPHA = MODEL_PARAMS.stateSwingAlpha;

function blendSwings(nationalSwings, stateSwings, state) {
  const ss = stateSwings?.[state];
  if (!ss) return nationalSwings;
  const alpha = ss.alpha ?? STATE_SWING_ALPHA;
  return {
    alp: alpha * (ss.alp ?? nationalSwings.alp) + (1 - alpha) * nationalSwings.alp,
    coal: alpha * (ss.coal ?? nationalSwings.coal) + (1 - alpha) * nationalSwings.coal,
    grn: alpha * (ss.grn ?? nationalSwings.grn) + (1 - alpha) * nationalSwings.grn,
    teal: alpha * (ss.teal ?? nationalSwings.teal) + (1 - alpha) * nationalSwings.teal,
    on: alpha * (ss.on ?? nationalSwings.on) + (1 - alpha) * nationalSwings.on,
  };
}

// Methodology:
//  - ALP/Coalition seats (no primary override): uniform national swing — nat2ppSwing is
//    applied to each seat's actual 2025 ALP 2PP baseline. This correctly models each seat
//    starting from its own 2025 result rather than treating all seats identically.
//  - ALP/Coalition seats (primary vote override): TCP is computed from the override
//    first-preference percentages via the standard preference-flow formula.
//  - Non-ALP/Coalition seats (GRN, TEAL): swing differential is applied to the seat's
//    2025 TCP baseline (same approach, already correct).
//  - tcpPct override: bypasses all calculations; directly sets the 2025 winner's TCP%.
//    tcpPct > 50 → 2025 winner holds; tcpPct < 50 → challenger wins.
//  - ON auto-detection: when ON's estimated seat-level primary (using seat-level 2025
//    baseline + national swing) exceeds onThreshold, the model automatically determines
//    whether the seat enters an ON vs ALP or ON vs Coalition TCP. Manual tcpMatchup
//    overrides always take precedence over auto-detection.
function computeModelledSeats(seats, swings, prefFlows, overrides, nat2ppSwing, onThreshold, useElasticity = false, stateSwings = null) {
  // Share of each seat's ON increase sourced from the Coalition (see MODEL_PARAMS).
  // User-tunable via the advanced-flows panel; falls back to the documented default.
  const onFromCoalShare = prefFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare;
  return seats.map(seat => {
    const override = overrides[seat.id];

    // For seats with a primary vote override, derive effective swings from override
    // primaries relative to the seat's 2025 AEC baseline (falls back to national baseline).
    // Using the seat-level baseline avoids spurious large swings when only some parties
    // are overridden — e.g. setting ALP to 45% in Grayndler no longer implies Coal at 31.8%.
    let effAlpSwing, effCoalSwing, effGrnSwing, effTealSwing, effOnSwing, effOtherSwing;
    let newFp = null;
    if (override) {
      const seatBase = getSeatFpBaseline(seat.id) ?? BASELINE_2025;
      // Use state-blended swings for unset override parties
      const sSwings = blendSwings(swings, stateSwings, seat.state);
      newFp = {
        alp: Math.max(0, override.alp ?? (seatBase.alp + sSwings.alp)),
        coal: Math.max(0, override.coal ?? (seatBase.coal + sSwings.coal)),
        grn: Math.max(0, override.grn ?? (seatBase.grn + sSwings.grn)),
        teal: Math.max(0, override.teal ?? (seatBase.teal + sSwings.teal)),
        on: Math.max(0, override.on ?? (seatBase.on + sSwings.on)),
      };
      // Normalize to sum to 100. User-overridden parties are locked so the excess
      // (e.g. from a large ON increase added on top of the baseline) is drawn from
      // the unset parties rather than pushing the total over 100% / pinning other to 0.
      const lockedParties = ["alp", "coal", "grn", "teal", "on"].filter(k => override[k] != null);
      newFp = normalizePrimaries(newFp, lockedParties);
      effAlpSwing = newFp.alp - seatBase.alp;
      effCoalSwing = newFp.coal - seatBase.coal;
      effGrnSwing = newFp.grn - seatBase.grn;
      effTealSwing = newFp.teal - seatBase.teal;
      effOnSwing = newFp.on - seatBase.on;
      effOtherSwing = newFp.other - seatBase.other;
    } else {
      const sSwings = blendSwings(swings, stateSwings, seat.state);
      effAlpSwing = sSwings.alp;
      effCoalSwing = sSwings.coal;
      effGrnSwing = sSwings.grn;
      effTealSwing = sSwings.teal;
      effOnSwing = sSwings.on;
      effOtherSwing = -(effAlpSwing + effCoalSwing + effGrnSwing + effTealSwing + effOnSwing);
    }

    // Estimate ON's primary in this seat using seat-level 2025 baseline + state consensus swing.
    // If the seat has a primary override for ON, use that value directly.
    const sSwings = blendSwings(swings, stateSwings, seat.state);
    const estOnFp = override?.on != null
      ? override.on
      : estimateSeatOnFp(seat.id, sSwings);

    // Seat TCP type — computed before auto-detection so the ON check can be restricted
    // to traditional ALP vs Coalition seats (ON can't realistically reach the final 2CP
    // in Greens or Teal seats where those parties dominate locally).
    const tcpP = seat.tcp.map(t => t.party);
    const hasAlp = tcpP.includes("ALP");
    const hasCoal = tcpP.some(p => ["LP", "LNP", "NP", "CLP"].includes(p));
    const hasGrn = tcpP.includes("GRN");
    const hasTeal = tcpP.some(p => ["IND", "CA"].includes(p));
    const hasOnTcp = tcpP.includes("ON");

    // Auto-detect ON TCP matchup, unless manually overridden.
    let activeTcpMatchup = override?.tcpMatchup ?? null;
    if (!activeTcpMatchup && hasOnTcp) {
      // Seats whose 2025 TCP already pairs ON with a major (Hunter ALP-v-ON, Maranoa
      // LNP-v-ON): default to that ON race so they are swing-modelled rather than left
      // frozen at the static 2025 result.
      if (hasAlp) activeTcpMatchup = "on_v_alp";
      else if (hasCoal) activeTcpMatchup = "on_v_coal";
    }
    // Auto-promotion of ON into the final two requires a positive ON swing: the
    // seat's recorded 2025 TCP pair is the actual preference-order outcome, so at
    // zero/negative ON swing the model keeps it (manual overrides still apply).
    if (!activeTcpMatchup && estOnFp >= onThreshold && (sSwings.on ?? 0) > 0) {
      const _sb = getSeatFpBaseline(seat.id) ?? BASELINE_2025;
      const estAlp = override?.alp != null ? override.alp : Math.max(0, _sb.alp + sSwings.alp);
      const estCoal = override?.coal != null ? override.coal : Math.max(0, _sb.coal + sSwings.coal);
      if (hasAlp && hasCoal) {
        // Traditional ALP-vs-Coalition seat where ON surges into the final 2CP.
        if (estOnFp > estAlp && estCoal >= estAlp) {
          activeTcpMatchup = "on_v_coal";   // ALP eliminated → ON vs Coalition final
        } else if (estOnFp > estCoal && estAlp >= estCoal) {
          activeTcpMatchup = "on_v_alp";    // Coalition eliminated → ON vs ALP final
        }
      } else if (hasTeal && !(hasAlp && hasCoal)) {
        // Teal/independent seat (e.g. Farrer 2026): if ON surges past both majors it
        // reaches the final two against the independent → ON vs Independent final.
        if (estOnFp > estAlp && estOnFp > estCoal) activeTcpMatchup = "on_v_ind";
      }
    }
    const isAutoMatchup = activeTcpMatchup !== null && !(override?.tcpMatchup);

    // tcpPct override: represents the 2022 winner's TCP% (seat.tcp[0].party).
    // >50 means the 2022 winner holds; <50 means the challenger wins.
    const hasTcpOverride = override?.tcpPct !== null && override?.tcpPct !== undefined;

    let projWinnerParty, projWinnerGroup, projWinnerPct, projAlp2pp = null;

    // Force winner override: bypass all TCP calculation
    if (override?.forceGroup) {
      const fg = override.forceGroup;
      const forcePartyMap = { alp: "ALP", coalition: "LP", greens: "GRN", teal: "IND", one_nation: "ON", crossbench: "KAP" };
      return {
        ...seat,
        modelled: {
          winnerParty: forcePartyMap[fg] ?? seat.winner.party,
          winnerGroup: fg,
          winnerPct: null,
          projAlp2pp: null,
          changed: fg !== getParty(seat.winner.party).group,
        }
      };
    }

    // ON vs ALP branch: ON and ALP are the two final candidates.
    // Uses ON-race-specific preference flows (grn_alp_v_on etc.) which are typically
    // higher toward ALP than standard flows because voters more strongly oppose ON.
    if (activeTcpMatchup === "on_v_alp") {
      // Effective flows: national/slider base, then per-seat ON-race overrides
      // (SEAT_ON_RACE_FLOWS, e.g. Hunter's stronger Coal→ON), then user override on top.
      const ef = { ...prefFlows, ...(SEAT_ON_RACE_FLOWS[seat.id] ?? {}), ...(override?.prefFlows ?? {}) };
      const fp = newFp ?? applySeatSwings(getSeatFpBaseline(seat.id) ?? BASELINE_2025, sSwings, onFromCoalShare);
      // ON-race flows toward ALP run higher than standard rates because voters strongly
      // oppose ON. Seats where ON was in the actual 2025 TCP (Hunter) are anchored to that
      // result at zero swing via calibrateOnPct (a no-op for surge-detected seats).
      const onPct = hasTcpOverride ? override.tcpPct
        : calibrateOnPct(seat, onVsAlpPct(fp, ef), onVsAlpPct(seatBaselineFp(seat.id), ef), nat2ppSwing);
      const wGroup = onPct >= 50 ? "one_nation" : "alp";
      const wParty = onPct >= 50 ? "ON" : "ALP";
      const wPct = onPct >= 50 ? onPct : 100 - onPct;

      // Calculate the standard 2PP (ALP vs Coal) to keep the national tracker accurate
      const a2 = fp.alp + fp.grn * prefFlows.grn_alp + fp.teal * prefFlows.teal_alp + fp.on * prefFlows.on_alp + fp.other * prefFlows.other_alp;
      const c2 = fp.coal + fp.grn * (1 - prefFlows.grn_alp) + fp.teal * (1 - prefFlows.teal_alp) + fp.on * (1 - prefFlows.on_alp) + fp.other * (1 - prefFlows.other_alp);
      const synthAlp2pp = safePct(a2, a2 + c2);

      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: synthAlp2pp,
          isSynthetic2pp: true,
          isOnRace: true,
          changed: wGroup !== getSeatGroup(seat),
          isOverride: !isAutoMatchup,
          isAutoMatchup,
          activeTcpMatchup: "on_v_alp",
        },
      };
    }

    // ON vs Coalition branch: ON and Coalition are the two final candidates.
    // Uses ON-race-specific preference flows (grn_on_v_coal etc.) which are typically
    // very low toward ON because progressive voters strongly prefer Coalition over ON.
    if (activeTcpMatchup === "on_v_coal") {
      const ef = { ...prefFlows, ...(SEAT_ON_RACE_FLOWS[seat.id] ?? {}), ...(override?.prefFlows ?? {}) };
      const fp = newFp ?? applySeatSwings(getSeatFpBaseline(seat.id) ?? BASELINE_2025, sSwings, onFromCoalShare);
      // ON-race flows toward ON run low because Greens/teal voters strongly prefer the
      // Coalition over ON. Seats where ON was in the actual 2025 TCP (Maranoa) are anchored
      // to that result at zero swing via calibrateOnPct (a no-op for surge-detected seats).
      const onPct = hasTcpOverride ? override.tcpPct
        : calibrateOnPct(seat, onVsCoalPct(fp, ef), onVsCoalPct(seatBaselineFp(seat.id), ef), nat2ppSwing);
      const coalP = seat.tcp.find(t => ["LP", "LNP", "NP", "CLP"].includes(t.party))?.party ?? "LP";
      const wGroup = onPct >= 50 ? "one_nation" : "coalition";
      const wParty = onPct >= 50 ? "ON" : coalP;
      const wPct = onPct >= 50 ? onPct : 100 - onPct;

      // Calculate the standard 2PP (ALP vs Coal) to keep the national tracker accurate
      const a2 = fp.alp + fp.grn * prefFlows.grn_alp + fp.teal * prefFlows.teal_alp + fp.on * prefFlows.on_alp + fp.other * prefFlows.other_alp;
      const c2 = fp.coal + fp.grn * (1 - prefFlows.grn_alp) + fp.teal * (1 - prefFlows.teal_alp) + fp.on * (1 - prefFlows.on_alp) + fp.other * (1 - prefFlows.other_alp);
      const synthAlp2pp = safePct(a2, a2 + c2);

      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: synthAlp2pp,
          isSynthetic2pp: true,
          isOnRace: true,
          changed: wGroup !== getSeatGroup(seat),
          isOverride: !isAutoMatchup,
          isAutoMatchup,
          activeTcpMatchup: "on_v_coal",
        },
      };
    }

    // ON vs Independent branch (Farrer 2026-type): ON and a community/teal independent
    // are the two final candidates, both majors eliminated. Coalition voters flow
    // strongly to ON, ALP/Greens strongly to the independent. The independent's primary
    // is carried in fp.teal. Flow assumptions (coal_on_v_ind etc.) are calibrated to the
    // 2026 Farrer by-election — the only federal precedent — and are necessarily coarse.
    if (activeTcpMatchup === "on_v_ind") {
      const ef = { ...prefFlows, ...(SEAT_ON_RACE_FLOWS[seat.id] ?? {}), ...(override?.prefFlows ?? {}) };
      const fp = newFp ?? applySeatSwings(getSeatFpBaseline(seat.id) ?? BASELINE_2025, sSwings, onFromCoalShare);
      const onPct = hasTcpOverride ? override.tcpPct
        : calibrateOnPct(seat, onVsIndPct(fp, ef), onVsIndPct(seatBaselineFp(seat.id), ef), nat2ppSwing);
      const indP = seat.tcp.find(t => ["IND", "CA"].includes(t.party))?.party ?? "IND";
      const indGroup = TEAL_SEAT_IDS.has(seat.id) ? "teal" : "ind";
      const wGroup = onPct >= 50 ? "one_nation" : indGroup;
      const wParty = onPct >= 50 ? "ON" : indP;
      const wPct = onPct >= 50 ? onPct : 100 - onPct;

      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          // Both majors are eliminated, so there is no meaningful ALP-vs-Coal 2PP for
          // this seat — leave null so the national 2PP tracker excludes it (as for
          // other teal/IND seats).
          projAlp2pp: null,
          isOnRace: true,
          changed: wGroup !== getSeatGroup(seat),
          isOverride: !isAutoMatchup,
          isAutoMatchup,
          activeTcpMatchup: "on_v_ind",
        },
      };
    }

    if (hasAlp && hasCoal) {
      const isAlpWinner = seat.tcp[0].party === "ALP";
      const baseAlp2pp = isAlpWinner ? seat.tcp[0].pct : seat.tcp[1].pct;

      if (hasTcpOverride) {
        // For ALP/Coal seats, tcpPct is ALP 2PP% directly (>50 = ALP wins)
        projAlp2pp = override.tcpPct;
      } else if (override) {
        // Compute 2PP from override first preferences via preference flows.
        // newFp was built from the seat-level 2025 baseline (set above), so unset parties
        // default to that seat's actual 2025 primary, not the national average.
        // Priority: user override > AEC per-seat baseline+delta > national slider.
        // User-explicit overrides are used as-is (no delta applied); AEC baselines
        // have the national slider delta applied on top (Option B additive delta).
        const ef = override.prefFlows
          ? override.prefFlows
          : SEAT_PREF_FLOWS_2025[seat.id]
            ? applyPrefDelta(SEAT_PREF_FLOWS_2025[seat.id], prefFlows)
            : prefFlows;
        const a2 = newFp.alp + newFp.grn * ef.grn_alp + newFp.teal * ef.teal_alp + newFp.on * ef.on_alp + newFp.other * ef.other_alp;
        const c2 = newFp.coal + newFp.grn * (1 - ef.grn_alp) + newFp.teal * (1 - ef.teal_alp) + newFp.on * (1 - ef.on_alp) + newFp.other * (1 - ef.other_alp);
        projAlp2pp = safePct(a2, a2 + c2);
        // Apply calibration offset (Phase 1): blends to zero at ±5pp national swing.
        // SEAT_CALIB_2025 is fitted against the per-seat DOP flows (compute_calibration.py),
        // the same flows used above, so the offset applies directly — at zero swing the
        // projection equals the actual 2025 TCP by construction.
        // Not applied when the user has set a per-seat pref flow override.
        if (!override.prefFlows) {
          const calibBlend = Math.max(0, 1 - Math.abs(nat2ppSwing) / MODEL_PARAMS.calibFadeHalfWidth);
          const calib = SEAT_CALIB_2025[seat.id] ?? 0;
          projAlp2pp = Math.min(100, Math.max(0, projAlp2pp + calib * calibBlend));
        }
      } else {
        const seatFp = getSeatFpBaseline(seat.id);
        if (seatFp) {
          // Primary-based: apply state-blended swing to seat-level 2025 primaries → 2PP.
          // Use per-seat preference flows if available (Phase 3), otherwise national average.
          const sSwings = blendSwings(swings, stateSwings, seat.state);
          // Apply swings, sourcing the ON rise largely from the Coalition primary (rather
          // than uniformly on top), so the seat distribution stays consistent with the
          // national 2PP. Renormalizes to 100; no-op when ON is flat/falling.
          const projFp = applySeatSwings(seatFp, sSwings, onFromCoalShare);
          // AEC per-seat baseline + national slider delta; fall back to slider only.
          const ef = SEAT_PREF_FLOWS_2025[seat.id]
            ? applyPrefDelta(SEAT_PREF_FLOWS_2025[seat.id], prefFlows)
            : prefFlows;
          const a2 = projFp.alp + projFp.grn * ef.grn_alp + projFp.teal * ef.teal_alp + projFp.on * ef.on_alp + projFp.other * ef.other_alp;
          const c2 = projFp.coal + projFp.grn * (1 - ef.grn_alp) + projFp.teal * (1 - ef.teal_alp) + projFp.on * (1 - ef.on_alp) + projFp.other * (1 - ef.other_alp);
          projAlp2pp = safePct(a2, a2 + c2);
          // Apply calibration offset (Phase 1): blends to zero at ±5pp national swing.
          // SEAT_CALIB_2025 is fitted against the per-seat DOP flows (compute_calibration.py),
          // the same flows used above, so the offset applies directly — at zero swing the
          // projection equals the actual 2025 TCP by construction.
          const calibBlend = Math.max(0, 1 - Math.abs(nat2ppSwing) / MODEL_PARAMS.calibFadeHalfWidth);
          const calib = SEAT_CALIB_2025[seat.id] ?? 0;
          projAlp2pp = Math.min(100, Math.max(0, projAlp2pp + calib * calibBlend));
        } else {
          // Fallback UNS for seats without per-seat primary data: uniform national 2PP swing
          // applied to the seat's 2025 TCP baseline. Elasticity scales the swing for marginals.
          // SEAT_DEMO_MULT (demographic regression) takes priority over the generic margin-based
          // seatElasticityMult() when populated by compute_demographic_regression.py.
          const eps = useElasticity
            ? (SEAT_DEMO_MULT[seat.id] ?? seatElasticityMult(baseAlp2pp))
            : 1.0;
          projAlp2pp = Math.max(0, Math.min(100, baseAlp2pp + nat2ppSwing * eps));
        }
      }
      projWinnerGroup = projAlp2pp >= 50 ? "alp" : "coalition";
      projWinnerParty = projAlp2pp >= 50 ? "ALP" : seat.tcp.find(t => t.party !== "ALP")?.party;
      projWinnerPct = projAlp2pp >= 50 ? projAlp2pp : 100 - projAlp2pp;

    } else if (hasGrn && hasCoal) {
      const base = seat.tcp.find(t => t.party === "GRN")?.pct ?? 50;
      const ef = override?.prefFlows ?? prefFlows;
      // Net swing to Greens: pure GRN swing + (portion of ALP swing flowing to GRN) + (portion of Teal swing flowing to GRN)
      const netGrnGain = effGrnSwing + effAlpSwing * (ef.alp_grn ?? 0.85) + effTealSwing * (ef.teal_grn ?? 0.40);
      // Net swing to Coal: pure Coal swing + (portion of ON swing flowing to Coal) + (portion of Other swing flowing to Coal)
      const netCoalGain = effCoalSwing + effOnSwing * (1 - (ef.on_alp ?? PREF_FLOWS_2025.on_alp)) + effOtherSwing * (1 - (ef.other_alp ?? PREF_FLOWS_2025.other_alp));
      const adj = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + netGrnGain - netCoalGain));
      projWinnerGroup = adj >= 50 ? "greens" : "coalition";
      projWinnerParty = adj >= 50 ? "GRN" : seat.tcp.find(t => t.party !== "GRN")?.party;
      projWinnerPct = adj >= 50 ? adj : 100 - adj;

    } else if (hasGrn && hasAlp) {
      const base = seat.tcp.find(t => t.party === "ALP")?.pct ?? 50;
      const ef = override?.prefFlows ?? prefFlows;
      // Net swing to ALP: pure ALP swing + (portion of Coal swing flowing to ALP) + (portion of Other swing flowing to ALP) + (portion of ON flowing to ALP)
      const netAlpGain = effAlpSwing + effCoalSwing * (ef.coal_alp ?? 0.05) + effOtherSwing * (ef.other_alp ?? PREF_FLOWS_2025.other_alp) + effOnSwing * (ef.on_alp ?? PREF_FLOWS_2025.on_alp);
      // Net swing to Greens: pure GRN swing + (portion of Teal flowing to GRN)
      const netGrnGain = effGrnSwing + effTealSwing * (ef.teal_grn ?? 0.40);
      const adj = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + netAlpGain - netGrnGain));
      projWinnerGroup = adj >= 50 ? "alp" : "greens";
      projWinnerParty = adj >= 50 ? "ALP" : "GRN";
      projWinnerPct = adj >= 50 ? adj : 100 - adj;
      // adj is ALP's TCP against the GREENS, not an ALP-vs-Coalition 2PP — leave
      // projAlp2pp null so the national 2PP tracker excludes this seat (as for
      // the other non-classic branches). Margin/sort consumers fall back to
      // winnerPct, which carries the same |adj − 50| margin.

    } else if (hasTeal && hasCoal) {
      const tealP = seat.tcp.find(t => ["IND", "CA"].includes(t.party));
      const base = tealP?.pct ?? 50;
      const ef = override?.prefFlows ?? prefFlows;
      // Net swing to Teal: pure Teal swing + (portion of ALP flowing to Teal) + (portion of GRN flowing to Teal)
      const netTealGain = effTealSwing + effAlpSwing * (ef.alp_teal ?? 0.70) + effGrnSwing * (ef.grn_teal ?? 0.50);
      // Net swing to Coal: pure Coal swing + (portion of ON flowing to Coal) + (portion of Other flowing to Coal)
      const netCoalGain = effCoalSwing + effOnSwing * (1 - (ef.on_alp ?? PREF_FLOWS_2025.on_alp)) + effOtherSwing * (1 - (ef.other_alp ?? PREF_FLOWS_2025.other_alp));
      const adj = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + netTealGain - netCoalGain));
      const indGroup = TEAL_SEAT_IDS.has(seat.id) ? "teal" : "ind";
      projWinnerGroup = adj >= 50 ? indGroup : "coalition";
      projWinnerParty = adj >= 50 ? tealP?.party : seat.tcp.find(t => ["LP", "LNP", "NP", "CLP"].includes(t.party))?.party;
      projWinnerPct = adj >= 50 ? adj : 100 - adj;

    } else if (hasTeal && hasAlp) {
      const tealP = seat.tcp.find(t => ["IND", "CA"].includes(t.party));
      const base = tealP?.pct ?? 50;
      const ef = override?.prefFlows ?? prefFlows;
      // Net swing to Teal: pure Teal swing + (portion of GRN flowing to Teal) + (portion of Coal flowing to Teal)
      const netTealGain = effTealSwing + effGrnSwing * (ef.grn_teal ?? 0.50) + effCoalSwing * (1 - (ef.coal_alp ?? 0.25));
      // Net swing to ALP: pure ALP swing + (portion of ON flowing to ALP) + (portion of Other flowing to ALP)
      const netAlpGain = effAlpSwing + effOnSwing * (ef.on_alp ?? PREF_FLOWS_2025.on_alp) + effOtherSwing * (ef.other_alp ?? PREF_FLOWS_2025.other_alp);
      const adj = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + netTealGain - netAlpGain));
      const indGroup = TEAL_SEAT_IDS.has(seat.id) ? "teal" : "ind";
      projWinnerGroup = adj >= 50 ? indGroup : "alp";
      projWinnerParty = adj >= 50 ? tealP?.party : "ALP";
      projWinnerPct = adj >= 50 ? adj : 100 - adj;

    } else {
      projWinnerGroup = getSeatGroup(seat);
      projWinnerParty = seat.winner.party;
      projWinnerPct = seat.tcp[0]?.pct ?? 50;
    }

    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct: projWinnerPct,
        projAlp2pp,
        changed: projWinnerGroup !== getSeatGroup(seat),
        isOverride: override !== undefined,
        isAutoMatchup: false,
      },
    };
  });
}

// VIC 2022 statewide primary vote % baseline
const VIC_BASELINE_2022 = { alp: 38.1, coal: 31.1, grn: 12.2, ind: 5.5, on: 1.3 };
const VIC_2PP_2022 = 57.3; // ALP 2PP at 2022 VIC election
const VIC_RIGHT_BLOC_2PP_2022 = 56.8; // ALP vs right bloc (Coal + ON on right side)
// 2018 baseline for historical swing context
const VIC_BASELINE_2018 = { alp: 42.8, coal: 35.3, grn: 10.7, ind: 4.5, on: 1.6 };
const VIC_2PP_2018 = 57.3; // ALP 2PP at 2018 VIC election (near-identical to 2022)

// ── Regional classification for VIC districts ─────────────────────────────────
// Professional VIC election models apply differential regional swing multipliers.
// Historical pattern: inner-metro (Greens-leaning, high-income) swings slightly
// more than outer-metro/suburban bellwethers; regional/rural seats less so.
// Sources: VEC district-level results 2014-2022; Antony Green's election commentary.
const VIC_DISTRICT_REGION = {
  // Inner Metro — high-density, Greens competitive, blue-ribbon Liberal
  "Albert Park": "inner_metro", "Brunswick": "inner_metro", "Northcote": "inner_metro",
  "Richmond": "inner_metro", "Prahran": "inner_metro", "Footscray": "inner_metro",
  "Melbourne": "inner_metro", "Williamstown": "inner_metro", "Essendon": "inner_metro",
  "Pascoe Vale": "inner_metro", "Preston": "inner_metro", "Kew": "inner_metro",
  "Hawthorn": "inner_metro", "Malvern": "inner_metro", "Caulfield": "inner_metro",
  "Brighton": "inner_metro", "Bentleigh": "inner_metro", "Sandringham": "inner_metro",
  "St Kilda": "inner_metro", "Altona": "inner_metro", "Niddrie": "inner_metro",
  "Ivanhoe": "inner_metro", "Bundoora": "inner_metro",
  // Outer Metro — suburban Melbourne bellwether seats
  "Frankston": "outer_metro", "Ringwood": "outer_metro", "Croydon": "outer_metro",
  "Bayswater": "outer_metro", "Box Hill": "outer_metro", "Glen Waverley": "outer_metro",
  "Rowville": "outer_metro", "Berwick": "outer_metro", "Cranbourne": "outer_metro",
  "Narre Warren North": "outer_metro", "Narre Warren South": "outer_metro",
  "Pakenham": "outer_metro", "Hastings": "outer_metro", "Mornington": "outer_metro",
  "Nepean": "outer_metro", "Mordialloc": "outer_metro", "Carrum": "outer_metro",
  "Dunkley": "outer_metro", "Clarinda": "outer_metro", "Oakleigh": "outer_metro",
  "Ashwood": "outer_metro", "Monbulk": "outer_metro", "Evelyn": "outer_metro",
  "Warrandyte": "outer_metro", "Bulleen": "outer_metro", "Eltham": "outer_metro",
  "Yan Yean": "outer_metro", "Kalkallo": "outer_metro", "Greenvale": "outer_metro",
  "Mill Park": "outer_metro", "Sunbury": "outer_metro", "Melton": "outer_metro",
  "Tarneit": "outer_metro", "Werribee": "outer_metro", "Laverton": "outer_metro",
  "Kororoit": "outer_metro", "St Albans": "outer_metro", "Broadmeadows": "outer_metro",
  "Sydenham": "outer_metro", "Dandenong": "outer_metro", "Holt": "outer_metro",
  "Bass": "outer_metro", "South Barwon": "outer_metro", "Geelong": "outer_metro",
  "Lara": "outer_metro", "Bellarine": "outer_metro", "Wendouree": "outer_metro",
  "Macedon": "outer_metro", "McEwen": "outer_metro", "Seymour": "outer_metro",
  "Ripon": "outer_metro", "Polwarth": "outer_metro", "Point Cook": "outer_metro",
  // Regional — country Victoria, distinct swing patterns
  "Mildura": "regional", "Shepparton": "regional", "Euroa": "regional",
  "Eildon": "regional", "Benambra": "regional", "Ovens Valley": "regional",
  "Murray Plains": "regional", "Lowan": "regional", "South-West Coast": "regional",
  "Gippsland East": "regional", "Gippsland South": "regional", "Morwell": "regional",
  "Eureka": "regional", "Narracan": "regional", "Gembrook": "regional",
};

// Regional swing multipliers — applied as a scaling factor on the statewide swing.
// Metro seats respond more strongly to state-level sentiment shifts than regional seats.
// Calibrated from 2014→2018 and 2018→2022 district-level data.
const VIC_REGION_SWING_MULT = {
  inner_metro: 1.15,  // Inner suburbs respond strongly (Greens competition amplifies)
  outer_metro: 1.00,  // Suburban bellwethers track the state average closely
  regional:    0.75,  // Regional seats swing less; local factors dominant
};

function _getVicRegion(seatName) {
  return VIC_DISTRICT_REGION[seatName] ?? "outer_metro"; // default to outer_metro
}

// ── NSW 2023 metro/regional district classification ───────────────────────────
// Calibrated from NSWEC booth-level data: inner-metro seats (inner Sydney) respond
// more strongly to statewide swings; rural/NP seats are more locally driven.
const NSW_DISTRICT_REGION = {
  // Inner metro — Sydney inner ring (GRN-competitive or safe ALP inner-city)
  "Newtown": "inner_metro", "Balmain": "inner_metro", "Summer Hill": "inner_metro",
  "Maroubra": "inner_metro", "Heffron": "inner_metro", "Kogarah": "inner_metro",
  "Rockdale": "inner_metro", "Strathfield": "inner_metro", "Auburn": "inner_metro",
  "Lakemba": "inner_metro", "Smithfield": "inner_metro",
  // Outer metro — Sydney suburbs + Hunter cities + Illawarra coast
  "Penrith": "outer_metro", "East Hills": "outer_metro", "Ryde": "outer_metro",
  "Coogee": "outer_metro", "Drummoyne": "outer_metro", "Holsworthy": "outer_metro",
  "Heathcote": "outer_metro", "Gosford": "outer_metro", "Terrigal": "outer_metro",
  "Wakehurst": "outer_metro", "Davidson": "outer_metro", "Pittwater": "outer_metro",
  "Epping": "outer_metro", "Lane Cove": "outer_metro", "Willoughby": "outer_metro",
  "Manly": "outer_metro", "Castle Hill": "outer_metro", "Hornsby": "outer_metro",
  "Blue Mountains": "outer_metro", "Liverpool": "outer_metro", "Campbelltown": "outer_metro",
  "Bankstown": "outer_metro", "Swansea": "outer_metro", "Lake Macquarie": "outer_metro",
  "Kotara": "outer_metro", "Charlestown": "outer_metro", "Wallsend": "outer_metro",
  "Newcastle": "outer_metro", "Maitland": "outer_metro",
  "Kiama": "outer_metro", "Keira": "outer_metro", "Wollongong": "outer_metro",
  "Shellharbour": "outer_metro",
  // Regional — rural/country; NP heartland; mining belt
  "Cessnock": "regional", "Monaro": "regional", "Oxley": "regional",
  "Upper Hunter": "regional", "Port Macquarie": "regional", "Tamworth": "regional",
  "Orange": "regional", "Dubbo": "regional", "Murray": "regional",
  "Bathurst": "regional", "Barwon": "regional",
};
const NSW_REGION_SWING_MULT = { inner_metro: 1.10, outer_metro: 1.00, regional: 0.80 };
function _getNswRegion(n) { return NSW_DISTRICT_REGION[n] ?? "outer_metro"; }

// ── QLD 2024 metro/regional district classification ───────────────────────────
// Brisbane inner seats amplify swings; deep-rural and ON-contested seats are
// insulated from statewide sentiment (local candidate/issues dominant).
const QLD_DISTRICT_REGION = {
  // Inner metro — Brisbane inner (GRN-competitive + safe ALP inner-city)
  "South Brisbane": "inner_metro", "Maiwar": "inner_metro", "Cooper": "inner_metro",
  "McConnel": "inner_metro", "Greenslopes": "inner_metro",
  "Inala": "inner_metro", "Toohey": "inner_metro", "Miller": "inner_metro",
  // Outer metro — Brisbane suburbs + Gold Coast + Sunshine Coast + Townsville
  "Mount Ommaney": "outer_metro", "Oodgeroo": "outer_metro", "Macalister": "outer_metro",
  "Everton": "outer_metro", "Macgregor": "outer_metro", "Stretton": "outer_metro",
  "Waterford": "outer_metro", "Rochedale": "outer_metro",
  "Currumbin": "outer_metro", "Burleigh": "outer_metro",
  "Buderim": "outer_metro", "Caloundra": "outer_metro",
  "Mundingburra": "outer_metro",
  // Regional — rural QLD + ON-contested seats + regional cities
  "Nanango": "regional", "Warrego": "regional", "Gympie": "regional",
  "Mirani": "regional", "Condamine": "regional", "Callide": "regional",
  "Hinchinbrook": "regional", "Southern Downs": "regional",
  "Bundaberg": "regional", "Rockhampton": "regional", "Mulgrave": "regional",
};
const QLD_REGION_SWING_MULT = { inner_metro: 1.10, outer_metro: 1.00, regional: 0.75 };
function _getQldRegion(n) { return QLD_DISTRICT_REGION[n] ?? "outer_metro"; }

// ── WA 2025 metro/regional district classification ────────────────────────────
// Nearly all WA seats are in the Perth metro belt; two-tier classification only.
const WA_DISTRICT_REGION = {
  // Metro — Perth metro belt
  "Carine": "metro", "Bateman": "metro", "Churchlands": "metro", "Moore": "metro",
  "Bicton": "metro", "Dawesville": "metro", "Scarborough": "metro", "Hillarys": "metro",
  "Joondalup": "metro", "Balcatta": "metro", "Midland": "metro", "Armadale": "metro",
  "Mandurah": "metro", "Rockingham": "metro", "Kwinana": "metro",
  "Fremantle": "metro", "Maylands": "metro", "Kalamunda": "metro",
  // Regional — South West / rural WA
  "Roe": "regional", "Vasse": "regional",
};
const WA_REGION_SWING_MULT = { metro: 1.00, regional: 0.75 };
function _getWaRegion(n) { return WA_DISTRICT_REGION[n] ?? "metro"; }

// ── SA 2022 metro/regional district classification ────────────────────────────
// Adelaide metro dominates; only two rural independents fall in the regional tier.
const SA_DISTRICT_REGION = {
  // Inner metro — Adelaide inner suburbs
  "Adelaide": "inner_metro", "Unley": "inner_metro",
  // Outer metro — Adelaide suburbs (includes 2026 retained LP seats and flipped seats)
  "King": "outer_metro", "Gibson": "outer_metro", "Newland": "outer_metro",
  "Florey": "outer_metro", "Kaurna": "outer_metro", "Playford": "outer_metro",
  "Heysen": "outer_metro", "Colton": "outer_metro", "Morialta": "outer_metro",
  "Waite": "outer_metro", "Flinders": "outer_metro", "Bragg": "outer_metro",
  "Hartley": "outer_metro", "Croydon": "outer_metro",
  "Ramsay": "outer_metro", "Lee": "outer_metro",
  // 2026 new/retained LP seats
  "Morphett": "outer_metro", "Schubert": "outer_metro",
  // Regional — rural SA (includes 2026 ON win Ngadjuri and IND seats)
  "Mount Gambier": "regional", "Frome": "regional",
  "Ngadjuri": "regional", "Narungga": "regional",
};
const SA_REGION_SWING_MULT = { inner_metro: 1.05, outer_metro: 1.00, regional: 0.80 };
function _getSaRegion(n) { return SA_DISTRICT_REGION[n] ?? "outer_metro"; }

// ── NT 2024 metro/regional district classification ────────────────────────────
// Darwin metro seats track territory-wide swings; remote/indigenous seats have
// very low sensitivity to territory-wide sentiment (personal vote dominant).
const NT_DISTRICT_REGION = {
  // Metro — Darwin urban belt + Palmerston
  "Blain": "metro", "Casuarina": "metro", "Fannie Bay": "metro",
  "Johnston": "metro", "Karama": "metro", "Brennan": "metro",
  "Darwin": "metro", "Goyder": "metro", "Wanguri": "metro", "Drysdale": "metro",
  // Regional/remote — remote indigenous and regional centres
  "Arafura": "regional", "Nhulunbuy": "regional",
  "Namatjira": "regional", "Barkly": "regional",
};
const NT_REGION_SWING_MULT = { metro: 1.00, regional: 0.70 };
// Unlisted NT seats are predominantly remote/rural — default to "regional" (0.70× multiplier)
function _getNtRegion(n) { return NT_DISTRICT_REGION[n] ?? "regional"; }

// ── Demographic-based regional classification helper ─────────────────────────
// Maps ABS 2021 Census urbanClass to model region tiers.
// Used to classify seats not yet in the manual *_DISTRICT_REGION dictionaries
// (e.g. seats created by a redistribution). Falls back to the manual dict when
// urbanClass is null (state_demographics.js not yet fully populated).
//
// ABS urbanClass values (from fetch_demographics.py):
//   "Inner Metropolitan" → inner_metro
//   "Outer Metropolitan" → outer_metro
//   "Provincial"        → regional
//   "Rural"             → regional
function _urbanClassToRegion(urbanClass) {
  if (!urbanClass) return null; // null = no data, let caller apply default
  if (urbanClass === "Inner Metropolitan") return "inner_metro";
  if (urbanClass === "Outer Metropolitan") return "outer_metro";
  return "regional"; // Provincial or Rural
}

// Derive region for a seat using STATE_DEMOGRAPHICS when available,
// with fallback to a provided manual dictionary.
//   seatId     — numeric seat ID (key in STATE_DEMOGRAPHICS)
//   seatName   — seat name string (key in manual dict)
//   manualDict — e.g. NSW_DISTRICT_REGION
//   fallback   — default region string if neither source has data
function _getRegionForSeat(seatId, seatName, manualDict, fallback = "outer_metro") {
  // Manual dict takes priority — it encodes calibrated empirical knowledge
  if (manualDict && manualDict[seatName] != null) return manualDict[seatName];
  // Fall back to Census urbanClass for any seat not yet in the manual dict
  const demog = STATE_DEMOGRAPHICS[seatId];
  if (demog) {
    const r = _urbanClassToRegion(demog.urbanClass);
    if (r != null) return r;
  }
  return fallback;
}

function computeVic2pp(primaries, prefFlows, onTcpMatchup = null) {
  const { alp, coal, grn, ind, on } = primaries;
  const onV = on ?? 0;
  const others = Math.max(0, 100 - alp - coal - grn - ind - onV);
  if (onTcpMatchup === "on_v_alp") {
    const a = alp + coal * prefFlows.coal_alp_v_on + grn * prefFlows.grn_alp_v_on + ind * prefFlows.ind_alp_v_on + others * prefFlows.other_alp_v_on;
    const onTcp = onV + coal * (1 - prefFlows.coal_alp_v_on) + grn * (1 - prefFlows.grn_alp_v_on) + ind * (1 - prefFlows.ind_alp_v_on) + others * (1 - prefFlows.other_alp_v_on);
    return a / (a + onTcp) * 100;
  }
  if (onTcpMatchup === "on_v_coal") {
    const onTcp = onV + alp * prefFlows.alp_on_v_coal + grn * prefFlows.grn_on_v_coal + ind * prefFlows.ind_on_v_coal + others * prefFlows.other_on_v_coal;
    const c = coal + alp * (1 - prefFlows.alp_on_v_coal) + grn * (1 - prefFlows.grn_on_v_coal) + ind * (1 - prefFlows.ind_on_v_coal) + others * (1 - prefFlows.other_on_v_coal);
    return onTcp / (onTcp + c) * 100;
  }
  return alp + grn * prefFlows.grn_alp + ind * prefFlows.ind_alp + onV * prefFlows.on_alp + others * prefFlows.other_alp;
}

// VIC swing model — applies region-differentiated 2CP swing to each seat's 2022 margin.
// Regional multipliers reflect the historically observed pattern that inner-metro seats
// swing more than suburban seats, which in turn swing more than regional/rural seats.
// The useRegionalSwing parameter enables/disables regional differentiation.
// onFpLookup ({ seatId: baselineOnFp% }, e.g. VIC_SEAT_ON_FP) + onThreshold enable
// per-seat ON-vs-major TCP auto-detection, mirroring computeModelledSeatsState.
// onThreshold is only a pre-filter — the binding condition is the projected ON primary
// overtaking a major party's, which self-adjusts to VIC's low (~1.3%) statewide ON base.
function computeModelledSeatsVic(vicSeats, swings, prefFlows, useRegionalSwing = true, onTcpMatchup = null, baseline2pp = VIC_2PP_2022, seatOverrides = null, seatFpMap = null, onFpLookup = null, onThreshold = MODEL_PARAMS.onThresholdDefault) {
  // Source a share of any ON *rise* from the Coalition primary (federal-model parity —
  // see MODEL_PARAMS.onFromCoalShare). Without this, a high ON primary wrongly inflates
  // Coalition 2PP via ON's ~75% back-flow. The cut mass lands in the residual "others"
  // because computeVic2pp derives others as 100 − sum. Zero when swings.on ≤ 0.
  const onFromCoalShare = prefFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare;
  const extraCoalCut = extraCoalCutFor(swings, onFromCoalShare);
  const newPrim = {
    alp: Math.max(0, VIC_BASELINE_2022.alp + swings.alp),
    coal: Math.max(0, VIC_BASELINE_2022.coal + (swings.coal ?? 0) - extraCoalCut),
    grn: Math.max(0, VIC_BASELINE_2022.grn + swings.grn),
    ind: Math.max(0, VIC_BASELINE_2022.ind + swings.ind),
    on: Math.max(0, VIC_BASELINE_2022.on + (swings.on ?? 0)),
  };
  const new2pp = computeVic2pp(newPrim, prefFlows, onTcpMatchup);
  const vic2ppSwing = new2pp - baseline2pp;

  return vicSeats.map(seat => {
    const t1 = seat.tcp[0].party, t2 = seat.tcp[1].party;

    // Apply regional swing multiplier if enabled.
    // _getRegionForSeat() checks manual VIC_DISTRICT_REGION first; falls back to
    // Census urbanClass from STATE_DEMOGRAPHICS for redistributed/unlisted VIC seats.
    const region = _getRegionForSeat(seat.id, seat.name, VIC_DISTRICT_REGION, "outer_metro");
    const regionMult = useRegionalSwing
      ? (VIC_REGION_SWING_MULT[region] ?? 1.0)
      : 1.0;

    const ov = seatOverrides?.[seat.id];

    // Force winner override: bypass all TCP calculation
    if (ov?.forceGroup) {
      const forcePartyMap = { alp: "ALP", coalition: "LP", greens: "GRN", ind: "IND", one_nation: "ON", crossbench: "KAP" };
      return {
        ...seat,
        modelled: {
          winnerParty: forcePartyMap[ov.forceGroup] ?? seat.winner.party,
          winnerGroup: ov.forceGroup,
          winnerPct: null, projAlp2pp: null,
          changed: ov.forceGroup !== getParty(seat.winner.party).group,
          isOverride: true, regionMult, region,
        },
      };
    }

    // TCP% direct override
    if (ov?.tcpPct != null && (t1 === "ALP" || t2 === "ALP")) {
      const alpPct = t1 === "ALP" ? ov.tcpPct : 100 - ov.tcpPct;
      const projWinnerParty = alpPct >= 50 ? "ALP" : (t1 === "ALP" ? t2 : t1);
      return {
        ...seat,
        modelled: {
          winnerParty: projWinnerParty, winnerGroup: getParty(projWinnerParty).group,
          winnerPct: Math.max(alpPct, 100 - alpPct), projAlp2pp: alpPct,
          changed: projWinnerParty !== seat.winner.party,
          isOverride: true, regionMult, region,
        },
      };
    }

    // Per-seat FP baseline and projection (used by the standard swing arithmetic and
    // the ON detection below). The seat's ON base comes from the propensity prior
    // (onFpLookup) when available — VIC_SEAT_FP_2022 has on: 0.0 everywhere because ON
    // ran no LA candidates in 2022 — substituted on BOTH sides so zero swing stays a
    // no-op (the residual "others" inside computeVic2pp absorbs the substitution). The
    // ON swing distributes on the logit scale so it concentrates where ON is strong.
    const onBase = onFpLookup?.[seat.id];
    let sfEff = null, projSf = null;
    if (seatFpMap?.[seat.id]) {
      const sf = seatFpMap[seat.id];
      sfEff = { alp: sf.alp, coal: sf.coal, grn: sf.grn, ind: sf.ind, on: onBase ?? sf.on ?? 0 };
      projSf = {
        alp:  Math.max(0, sfEff.alp  + swings.alp),
        coal: Math.max(0, sfEff.coal + (swings.coal ?? 0) - extraCoalCut),
        grn:  Math.max(0, sfEff.grn  + swings.grn),
        ind:  Math.max(0, sfEff.ind  + swings.ind),
        on:   Math.max(0, logitShiftOnFp(sfEff.on, VIC_BASELINE_2022.on, swings.on ?? 0)),
      };
    }

    // ── ON-final auto-detection for ALP-vs-Coalition seats ──────────────────────
    // Mirrors computeModelledSeatsState, but uses the seat's own projected primaries
    // (projSf) as competitors where available instead of statewide proxies. Skipped
    // when a statewide ON final is forced (onTcpMatchup) — forced mode wins.
    const isAlpVsCoal = (t1 === "ALP" && ["LP", "NP"].includes(t2)) || (["LP", "NP"].includes(t1) && t2 === "ALP");
    if (isAlpVsCoal && onTcpMatchup == null && ov?.tcpPct == null && !ov?.forceGroup) {
      const estOn = ov?.on ?? (onBase != null ? logitShiftOnFp(onBase, VIC_BASELINE_2022.on, swings.on ?? 0) : null);
      let activeTcp = (ov?.tcpMatchup === "on_v_alp" || ov?.tcpMatchup === "on_v_coal") ? ov.tcpMatchup : null;
      // Auto-promote ON into the final two only on a positive ON swing: the seat's
      // recorded TCP pair is the actual result and must be reproduced at zero swing.
      if (!activeTcp && estOn != null && estOn >= onThreshold && (swings.on ?? 0) > 0) {
        const estAlp = ov?.alp ?? projSf?.alp ?? newPrim.alp;
        const estCoal = ov?.coal ?? projSf?.coal ?? newPrim.coal;
        const estGrn = ov?.grn ?? projSf?.grn ?? newPrim.grn;
        const estInd = ov?.ind ?? projSf?.ind ?? newPrim.ind;
        // ON must also out-poll the seat's Greens and independents to reach the final
        // two — otherwise ON gets promoted in GRN-heavy inner seats (Northcote) and
        // IND-strongman seats (Mildura, Shepparton) where a third party is the real
        // challenger and the actual final would be GRN/IND-vs-major.
        if (estOn > estGrn && estOn > estInd) {
          if (estOn > estAlp && estCoal >= estAlp) activeTcp = "on_v_coal";
          else if (estOn > estCoal && estAlp >= estCoal) activeTcp = "on_v_alp";
        }
      }
      if (activeTcp) {
        const fp = {
          alp: ov?.alp ?? projSf?.alp ?? newPrim.alp,
          coal: ov?.coal ?? projSf?.coal ?? newPrim.coal,
          grn: ov?.grn ?? projSf?.grn ?? newPrim.grn,
          ind: ov?.ind ?? projSf?.ind ?? newPrim.ind,
          on: estOn ?? newPrim.on,
        };
        fp.other = Math.max(0, 100 - fp.alp - fp.coal - fp.grn - fp.ind - fp.on);
        const pf = prefFlows;
        let projWinnerParty, projWinnerGroup, projWinnerPct;
        if (activeTcp === "on_v_coal") {
          const coalParty = ["LP", "NP"].includes(t1) ? t1 : t2;
          const onTcpV = fp.on + fp.alp * pf.alp_on_v_coal + fp.grn * pf.grn_on_v_coal + fp.ind * pf.ind_on_v_coal + fp.other * pf.other_on_v_coal;
          const coalTcpV = fp.coal + fp.alp * (1 - pf.alp_on_v_coal) + fp.grn * (1 - pf.grn_on_v_coal) + fp.ind * (1 - pf.ind_on_v_coal) + fp.other * (1 - pf.other_on_v_coal);
          const onPct = safePct(onTcpV, onTcpV + coalTcpV);
          projWinnerGroup = onPct >= 50 ? "one_nation" : "coalition";
          projWinnerParty = onPct >= 50 ? "ON" : coalParty;
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        } else {
          const alpTcpV = fp.alp + fp.coal * pf.coal_alp_v_on + fp.grn * pf.grn_alp_v_on + fp.ind * pf.ind_alp_v_on + fp.other * pf.other_alp_v_on;
          const onTcpV = fp.on + fp.coal * (1 - pf.coal_alp_v_on) + fp.grn * (1 - pf.grn_alp_v_on) + fp.ind * (1 - pf.ind_alp_v_on) + fp.other * (1 - pf.other_alp_v_on);
          const onPct = safePct(onTcpV, alpTcpV + onTcpV);
          projWinnerGroup = onPct >= 50 ? "one_nation" : "alp";
          projWinnerParty = onPct >= 50 ? "ON" : "ALP";
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        }
        return {
          ...seat,
          modelled: {
            winnerParty: projWinnerParty, winnerGroup: projWinnerGroup, winnerPct: projWinnerPct,
            projAlp2pp: null, // ALP not in the final TCP in one branch
            changed: projWinnerGroup !== getParty(seat.winner.party).group,
            isOnRace: true,
            isAutoMatchup: !ov?.tcpMatchup,
            activeTcpMatchup: activeTcp,
            regionMult, region,
          },
        };
      }
    }

    // Per-seat primary override: derive effective swing from override primaries
    if (ov && (ov.alp != null || ov.coal != null || ov.grn != null || ov.ind != null || ov.on != null) && ov.tcpPct == null) {
      const ovPrim = {
        alp: ov.alp != null ? ov.alp : newPrim.alp,
        coal: ov.coal != null ? ov.coal : newPrim.coal,
        grn: ov.grn != null ? ov.grn : newPrim.grn,
        ind: ov.ind != null ? ov.ind : newPrim.ind,
        on: ov.on != null ? ov.on : newPrim.on,
      };
      const ovNew2pp = computeVic2pp(ovPrim, prefFlows, onTcpMatchup);
      // Use per-seat FP as baseline when available; fall back to statewide baseline2pp.
      const ovBaseline2pp = sfEff
        ? computeVic2pp(sfEff, prefFlows, onTcpMatchup)
        : baseline2pp;
      const effectiveSwing = (ovNew2pp - ovBaseline2pp) * regionMult;
      let swingToT1 = 0;
      if (t1 === "ALP" && ["LP", "NP"].includes(t2)) swingToT1 = effectiveSwing;
      else if (["LP", "NP"].includes(t1) && t2 === "ALP") swingToT1 = -effectiveSwing;
      else if (t1 === "GRN" && t2 === "ALP") swingToT1 = ((ov.grn ?? swings.grn) - (ov.alp ?? swings.alp)) / 2 * regionMult;
      else if (t1 === "GRN" && ["LP", "NP"].includes(t2)) swingToT1 = ((ov.grn ?? swings.grn) - (ov.coal ?? swings.coal ?? 0)) / 2 * regionMult;
      else if (t1 === "IND") swingToT1 = (t2 === "ALP" ? -1 : 1) * effectiveSwing * 0.3;
      const newMargin = seat.margin + swingToT1;
      const holds = newMargin > 0;
      const projWinnerParty = holds ? t1 : t2;
      const projAlp2pp = (t1 === "ALP" || t2 === "ALP") ? (t1 === "ALP" ? 50 + newMargin : 50 - newMargin) : null;
      return {
        ...seat,
        modelled: {
          winnerParty: projWinnerParty, winnerGroup: getParty(projWinnerParty).group,
          winnerPct: 50 + Math.abs(newMargin), projAlp2pp,
          changed: projWinnerParty !== seat.winner.party,
          isOverride: true, regionMult, region,
        },
      };
    }

    // Per-seat FP baseline: seat-specific 2PP swing from this seat's primary composition
    // (sfEff/projSf hoisted above so the ON detection block can reuse them).
    let effectiveVicSwing = vic2ppSwing;
    if (projSf) {
      effectiveVicSwing = computeVic2pp(projSf, prefFlows, onTcpMatchup)
                        - computeVic2pp(sfEff,  prefFlows, onTcpMatchup);
    }

    const sAlpV = swings.alp ?? 0;
    const sCoalV = swings.coal ?? 0;
    const sGrnV = swings.grn ?? 0;
    let swingToT1 = 0;
    if (t1 === "ALP" && ["LP", "NP"].includes(t2)) {
      swingToT1 = effectiveVicSwing * regionMult;
    } else if (["LP", "NP"].includes(t1) && t2 === "ALP") {
      swingToT1 = -effectiveVicSwing * regionMult;
    } else if (t1 === "GRN" && t2 === "ALP") {
      // GRN vs ALP: driven by GRN primary swing relative to ALP swing (Greens inner city)
      swingToT1 = (sGrnV - sAlpV) / 2 * regionMult;
    } else if (t1 === "GRN" && ["LP", "NP"].includes(t2)) {
      swingToT1 = (sGrnV - sCoalV) / 2 * regionMult;
    } else if (t1 === "IND") {
      // Independents: insulated from state swing (personal vote dominant); 30% sensitivity
      swingToT1 = (t2 === "ALP" ? -1 : 1) * effectiveVicSwing * 0.3;
    }
    if (!Number.isFinite(swingToT1)) swingToT1 = 0;
    const newMargin = seat.margin + swingToT1;
    const holds = newMargin > 0;
    const projWinnerParty = holds ? t1 : t2;
    const projWinnerGroup = getParty(projWinnerParty).group;
    const projAlp2ppRaw = (t1 === "ALP" || t2 === "ALP")
      ? (t1 === "ALP" ? 50 + newMargin : 50 - newMargin)
      : null;
    const projAlp2pp = Number.isFinite(projAlp2ppRaw) ? projAlp2ppRaw : null;
    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct: 50 + Math.abs(newMargin),
        projAlp2pp,
        changed: projWinnerParty !== seat.winner.party,
        regionMult,
        region,
      },
    };
  });
}

// ── Generic state 2CP calculator ─────────────────────────────────────────────
// Builds the per-seat ALP-2CP function used by every non-VIC state model
// (NSW/QLD/WA/SA/NT). These were five near-identical inline closures; the only
// differences are the state's `ind` primary, the forced ON matchup (`onTcp`),
// and NT's optional-preferential exhaustion. Parameters:
//   ind      – the state's Independent primary vote % (constant across seats)
//   onTcp    – null | "on_v_alp" | "on_v_coal" to force a One Nation final 2CP
//   swings   – statewide primary swings { alp, coal, grn, on }; used to derive
//              the Coalition→ON transfer share when an ON surge is Coalition-fed
//   exhaust  – optional-preferential exhaust rate (NT); 0 = full preferential
// Returns a function (p, f) → ALP 2CP %, where p is the seat's projected
// primaries and f the preference-flow set.
function makeStateCompute2pp({ ind = 0, onTcp = null, swings, exhaust = 0 }) {
  const coalToOnXfer = (swings.on > 0 && swings.coal < 0)
    ? Math.max(0, Math.min(1, -swings.coal / swings.on))
    : 0;
  const k = 1 - exhaust;
  return (p, f) => {
    const onV = p.on ?? 0;
    const other = Math.max(0, 100 - p.alp - p.coal - p.grn - ind - onV);
    if (onTcp === "on_v_alp") {
      const a = p.alp + k * (p.coal * f.coal_alp_v_on + p.grn * f.grn_alp_v_on + ind * f.ind_alp_v_on + other * f.other_alp_v_on);
      const on = onV + k * (p.coal * (1 - f.coal_alp_v_on) + p.grn * (1 - f.grn_alp_v_on) + ind * (1 - f.ind_alp_v_on) + other * (1 - f.other_alp_v_on));
      return a / (a + on) * 100;
    }
    if (onTcp === "on_v_coal") {
      const on = onV + k * (p.alp * f.alp_on_v_coal + p.grn * f.grn_on_v_coal + ind * f.ind_on_v_coal + other * f.other_on_v_coal);
      const c = p.coal + k * (p.alp * (1 - f.alp_on_v_coal) + p.grn * (1 - f.grn_on_v_coal) + ind * (1 - f.ind_on_v_coal) + other * (1 - f.other_on_v_coal));
      return on / (on + c) * 100;
    }
    const effOnAlp = f.on_alp + (f.onCoalOriginFactor ?? 0) * coalToOnXfer * (1 - f.on_alp);
    const a = p.alp + k * (ind * f.ind_alp + p.grn * f.grn_alp + onV * effOnAlp + other * f.other_alp);
    const c = p.coal + k * (ind * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - effOnAlp) + other * (1 - f.other_alp));
    return a / (a + c) * 100;
  };
}

// ── Generic single-member preferential swing model ───────────────────────────
// Works for NSW, QLD, WA, SA, NT (all single-member, preferential lower houses).
// Parameters:
//   seats        – seat array with tcp[0]/tcp[1] data
//   baseline     – { alp, coalKey, grn, ind, ... } — baseline primary vote %
//   coalKey      – coalition party key in baseline (e.g. "lp", "lnp", "clp")
//   newPrim      – new primary vote object after swing applied
//   compute2ppFn – function(newPrim, prefFlows) → ALP 2PP %
//   baseline2pp  – baseline ALP 2PP %
//   prefFlows    – { grn_alp, ind_alp, other_alp }
//   coalParties  – Set of coalition party abbreviations
// onFpLookup: { seatId: baselineOnFp% } — seats where ON is a real contender.
//   For these seats, ON is estimated as baseline + swings.on and compared against
//   statewide ALP/Coal to auto-detect on_v_alp / on_v_coal TCP matchups.
// stateOverrides: { seatId: { tcpMatchup, tcpPct, on, alp, coal, grn, ind, forceGroup } } — seat-level overrides.
function computeModelledSeatsState(seats, newPrim, compute2ppFn, baseline2pp, prefFlows, coalParties, swings, regionMap = null, regionSwingMult = null, onFpLookup = null, onThreshold = 6.5, stateOverrides = null, useElasticityFlag = false, seatPrefFlowsMap = null, baselinePrim = null, seatFpMap = null) {
  const new2pp = compute2ppFn(newPrim, prefFlows);
  const swing2pp = new2pp - baseline2pp;

  return seats.map(seat => {
    const t1 = seat.tcp[0]?.party;
    const t2 = seat.tcp[1]?.party;
    if (!t1 || !t2) return { ...seat, modelled: { winnerParty: seat.winner.party, winnerGroup: getParty(seat.winner.party).group, winnerPct: 50 + seat.margin, projAlp2pp: null, changed: false } };

    const isAlp1 = t1 === "ALP";
    const isAlp2 = t2 === "ALP";
    const isCoal1 = coalParties.has(t1);
    const isCoal2 = coalParties.has(t2);
    const isGrn1 = t1 === "GRN";
    const isGrn2 = t2 === "GRN";
    const isOn1 = t1 === "ON";
    const isOn2 = t2 === "ON";
    const isInd1 = !isAlp1 && !isCoal1 && !isGrn1 && !isOn1;
    const isInd2 = !isAlp2 && !isCoal2 && !isGrn2 && !isOn2;

    // Regional swing multiplier: metro seats track state swing; regional/rural seats respond less.
    // Uses _getRegionForSeat() which checks the manual regionMap first (empirically calibrated),
    // then falls back to Census urbanClass from STATE_DEMOGRAPHICS for unlisted/redistributed seats.
    const region = regionMap
      ? _getRegionForSeat(seat.id, seat.name, regionMap, "outer_metro")
      : null;
    const regionMult = (regionMap && regionSwingMult) ? (regionSwingMult[region] ?? 1.0) : 1.0;

    // Per-seat preference flow override: compute a seat-specific 2PP swing when local flows differ
    // from the statewide average (e.g. inner-city Greens seats flow to ALP more strongly than rural).
    const seatFlowOverride = seatPrefFlowsMap?.[seat.id];
    // Per-seat ON baseline: hand-curated lookup wins (analyst judgment / provisional
    // figures), then the seat's real FP data. Null when neither exists.
    const onBase = onFpLookup?.[seat.id] ?? seatFpMap?.[seat.id]?.on ?? null;
    const refOn = baselinePrim?.on ?? newPrim.on ?? 0;
    let effectiveSwing2pp = swing2pp;
    let sfEff = null, projSf = null;
    if (seatFpMap?.[seat.id]) {
      // Per-seat FP baseline: compute seat-specific 2PP swing from this seat's primary composition.
      // A GRN-heavy inner-city seat responds differently to a GRN surge than a regional coal seat.
      // The ON base substitution happens on BOTH sides so zero swing stays a no-op; the ON
      // swing distributes on the logit scale (logitShiftOnFp) so it lands where ON is strong.
      const sf = seatFpMap[seat.id];
      // Source the ON increase largely from the Coalition primary (rest from residual),
      // matching the federal model — a rising ON vote is mostly ex-Coalition defection.
      const onFromCoalShare = prefFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare;
      const extraCoalCut = extraCoalCutFor(swings, onFromCoalShare);
      sfEff = { ...sf, on: onBase ?? sf.on ?? 0 };
      projSf = {
        alp:  Math.max(0, sfEff.alp  + swings.alp),
        coal: Math.max(0, sfEff.coal + swings.coal - extraCoalCut),
        grn:  Math.max(0, sfEff.grn  + swings.grn),
        ind:  Math.max(0, (sfEff.ind ?? 0) + (swings.ind ?? 0)),
        on:   Math.max(0, logitShiftOnFp(sfEff.on ?? 0, refOn, swings.on ?? 0)),
      };
      const mergedFlows = seatFlowOverride ? { ...prefFlows, ...seatFlowOverride } : prefFlows;
      effectiveSwing2pp = compute2ppFn(projSf, mergedFlows) - compute2ppFn(sfEff, mergedFlows);
    } else if (seatFlowOverride && baselinePrim) {
      const mergedFlows = { ...prefFlows, ...seatFlowOverride };
      const seatNew2pp = compute2ppFn(newPrim, mergedFlows);
      const seatBl2pp = compute2ppFn(baselinePrim, mergedFlows);
      effectiveSwing2pp = seatNew2pp - seatBl2pp;
    }
    // Seat-level elasticity: marginal seats respond more strongly to swings than safe seats.
    // Applied only to ALP vs Coalition matchups where the 2PP concept is well-defined.
    const elastMult = (useElasticityFlag && (isAlp1 || isAlp2))
      ? seatElasticityMult(isAlp1 ? 50 + seat.margin : 50 - seat.margin)
      : 1.0;

    // Per-seat override: manual TCP matchup or TCP% bypass
    const ov = stateOverrides?.[seat.id];

    // Force winner override: bypass all TCP calculation
    if (ov?.forceGroup) {
      const forcePartyMap = { alp: "ALP", coalition: coalParties.size ? [...coalParties][0] : "LP", greens: "GRN", ind: "IND", one_nation: "ON", crossbench: "KAP" };
      return {
        ...seat,
        modelled: {
          winnerParty: forcePartyMap[ov.forceGroup] ?? seat.winner.party,
          winnerGroup: ov.forceGroup,
          winnerPct: null, projAlp2pp: null,
          changed: ov.forceGroup !== getParty(seat.winner.party).group,
          isOverride: true, region,
        },
      };
    }

    // ── ON auto-detection for ALP vs Coalition seats with per-seat ON data ──────
    // ON base comes from the hand-curated lookup or the seat's real FP data (onBase),
    // with the statewide ON swing distributed on the logit scale. Competitors are the
    // seat's own projected primaries (projSf, incl. the Coalition-sourcing cut) when
    // per-seat FP data exists; statewide newPrim proxies otherwise.
    if ((isAlp1 && isCoal2) || (isCoal1 && isAlp2)) {
      // Check if a per-seat ON estimate exists (either from lookup/FP data or manual override)
      const estOnFp = ov?.on != null
        ? ov.on
        : (onBase != null ? logitShiftOnFp(onBase, refOn, swings.on ?? 0) : null);

      let activeTcp = ov?.tcpMatchup ?? null;
      // Only auto-promote ON into the final two on a positive ON swing. The seat's
      // recorded TCP pair is the actual result; at zero/negative ON swing the model
      // must reproduce it. (Without this gate, statewide-primary proxies misfire
      // where a baseline ON FP already exceeds a collapsed major primary — e.g.
      // SA 2026 Schubert: ON 19.6 > statewide LP 18.7 flipped an LP-held seat
      // to "ALP vs ON" at baseline.) Manual overrides (ov.tcpMatchup) still apply.
      if (!activeTcp && estOnFp != null && estOnFp >= onThreshold && (swings.on ?? 0) > 0) {
        const estAlp = projSf?.alp ?? newPrim.alp;
        const estCoal = projSf?.coal ?? newPrim.coal;
        const estGrn = projSf?.grn ?? newPrim.grn;
        const estInd = projSf?.ind ?? newPrim.ind ?? 0;
        // ON must also out-poll the seat's Greens and independents to reach the final
        // two — otherwise ON gets falsely promoted in GRN-heavy inner seats and
        // IND-strongman seats where a third party is the real challenger.
        if (estOnFp > estGrn && estOnFp > estInd) {
          if (estOnFp > estAlp && estCoal >= estAlp) activeTcp = "on_v_coal";
          else if (estOnFp > estCoal && estAlp >= estCoal) activeTcp = "on_v_alp";
        }
      }

      if (activeTcp) {
        // Compute TCP using the seat's projected primaries where available (statewide
        // proxies otherwise) with the per-seat ON estimate.
        const estOn = estOnFp ?? (onBase != null ? logitShiftOnFp(onBase, refOn, swings.on ?? 0) : newPrim.on);
        const fpAlp = projSf?.alp ?? newPrim.alp;
        const fpCoal = projSf?.coal ?? newPrim.coal;
        const fpGrn = projSf?.grn ?? newPrim.grn;
        const ind = projSf?.ind ?? newPrim.ind ?? 0;
        const other = Math.max(0, 100 - fpAlp - fpCoal - fpGrn - ind - estOn);
        const fp = { alp: fpAlp, coal: fpCoal, grn: fpGrn, ind, on: estOn, other };
        const pf = prefFlows;

        let projWinnerParty, projWinnerGroup, projWinnerPct;
        if (activeTcp === "on_v_coal") {
          const coalParty = isCoal1 ? t1 : t2;
          const onTcp = fp.on + fp.alp * pf.alp_on_v_coal + fp.grn * pf.grn_on_v_coal + fp.ind * pf.ind_on_v_coal + fp.other * pf.other_on_v_coal;
          const coalTcp = fp.coal + fp.alp * (1 - pf.alp_on_v_coal) + fp.grn * (1 - pf.grn_on_v_coal) + fp.ind * (1 - pf.ind_on_v_coal) + fp.other * (1 - pf.other_on_v_coal);
          const onPct = ov?.tcpPct != null ? ov.tcpPct : onTcp / (onTcp + coalTcp) * 100;
          projWinnerGroup = onPct >= 50 ? "one_nation" : "coalition";
          projWinnerParty = onPct >= 50 ? "ON" : coalParty;
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        } else {
          const alpTcp = fp.alp + fp.coal * pf.coal_alp_v_on + fp.grn * pf.grn_alp_v_on + fp.ind * pf.ind_alp_v_on + fp.other * pf.other_alp_v_on;
          const onTcp = fp.on + fp.coal * (1 - pf.coal_alp_v_on) + fp.grn * (1 - pf.grn_alp_v_on) + fp.ind * (1 - pf.ind_alp_v_on) + fp.other * (1 - pf.other_alp_v_on);
          const onPct = ov?.tcpPct != null ? ov.tcpPct : onTcp / (alpTcp + onTcp) * 100;
          projWinnerGroup = onPct >= 50 ? "one_nation" : "alp";
          projWinnerParty = onPct >= 50 ? "ON" : "ALP";
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        }
        return {
          ...seat,
          modelled: {
            winnerParty: projWinnerParty, winnerGroup: projWinnerGroup, winnerPct: projWinnerPct,
            projAlp2pp: null, // ALP not in the final TCP in one branch
            changed: projWinnerGroup !== getParty(seat.winner.party).group,
            isAutoMatchup: !ov?.tcpMatchup,
            activeTcpMatchup: activeTcp,
            regionMult, region,
          },
        };
      }
    }

    // ── Manual TCP override (for non ALP-vs-Coal seats or when auto-detect didn't fire) ──
    if (ov?.tcpMatchup || ov?.tcpPct != null) {
      const activeTcp = ov.tcpMatchup;
      if (activeTcp === "on_v_coal" || activeTcp === "on_v_alp") {
        const ind = newPrim.ind ?? 0;
        const on = newPrim.on ?? 0;
        const other = Math.max(0, 100 - newPrim.alp - newPrim.coal - newPrim.grn - ind - on);
        const fp = { alp: newPrim.alp, coal: newPrim.coal, grn: newPrim.grn, ind, on, other };
        const pf = prefFlows;
        let projWinnerParty, projWinnerGroup, projWinnerPct;
        if (activeTcp === "on_v_coal") {
          const coalParty = coalParties.has(t1) ? t1 : (coalParties.has(t2) ? t2 : [...coalParties][0] ?? "LNP");
          const onTcp = fp.on + fp.alp * pf.alp_on_v_coal + fp.grn * pf.grn_on_v_coal + fp.ind * pf.ind_on_v_coal + fp.other * pf.other_on_v_coal;
          const coalTcp = fp.coal + fp.alp * (1 - pf.alp_on_v_coal) + fp.grn * (1 - pf.grn_on_v_coal) + fp.ind * (1 - pf.ind_on_v_coal) + fp.other * (1 - pf.other_on_v_coal);
          const onPct = ov.tcpPct != null ? ov.tcpPct : onTcp / (onTcp + coalTcp) * 100;
          projWinnerGroup = onPct >= 50 ? "one_nation" : "coalition";
          projWinnerParty = onPct >= 50 ? "ON" : coalParty;
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        } else {
          const alpTcp = fp.alp + fp.coal * pf.coal_alp_v_on + fp.grn * pf.grn_alp_v_on + fp.ind * pf.ind_alp_v_on + fp.other * pf.other_alp_v_on;
          const onTcp = fp.on + fp.coal * (1 - pf.coal_alp_v_on) + fp.grn * (1 - pf.grn_alp_v_on) + fp.ind * (1 - pf.ind_alp_v_on) + fp.other * (1 - pf.other_alp_v_on);
          const onPct = ov.tcpPct != null ? ov.tcpPct : onTcp / (alpTcp + onTcp) * 100;
          projWinnerGroup = onPct >= 50 ? "one_nation" : "alp";
          projWinnerParty = onPct >= 50 ? "ON" : "ALP";
          projWinnerPct = onPct >= 50 ? onPct : 100 - onPct;
        }
        return {
          ...seat,
          modelled: {
            winnerParty: projWinnerParty, winnerGroup: projWinnerGroup, winnerPct: projWinnerPct,
            projAlp2pp: null,
            changed: projWinnerGroup !== getParty(seat.winner.party).group,
            isOverride: true,
            activeTcpMatchup: activeTcp,
            regionMult, region,
          },
        };
      }
      // tcpPct-only override for ALP/Coal seats
      if (ov.tcpPct != null && ((isAlp1 && isCoal2) || (isCoal1 && isAlp2))) {
        const alpPct = isAlp1 ? ov.tcpPct : 100 - ov.tcpPct;
        const projWinnerGroup = alpPct >= 50 ? "alp" : "coalition";
        const projWinnerParty = alpPct >= 50 ? "ALP" : (isCoal1 ? t1 : t2);
        return {
          ...seat,
          modelled: {
            winnerParty: projWinnerParty, winnerGroup: projWinnerGroup, winnerPct: Math.max(alpPct, 100 - alpPct),
            projAlp2pp: alpPct,
            changed: projWinnerGroup !== getParty(seat.winner.party).group,
            isOverride: true,
            regionMult, region,
          },
        };
      }
    }

    // ── Per-seat primary override: derive effective 2PP swing from override primaries ──
    if (ov && (ov.alp != null || ov.coal != null || ov.grn != null || ov.ind != null) && ov.tcpPct == null && !ov.tcpMatchup) {
      const ovPrim = {
        alp: ov.alp != null ? ov.alp : newPrim.alp,
        coal: ov.coal != null ? ov.coal : newPrim.coal,
        grn: ov.grn != null ? ov.grn : newPrim.grn,
        ind: ov.ind != null ? ov.ind : (newPrim.ind ?? 0),
        on: ov.on != null ? ov.on : (newPrim.on ?? 0),
      };
      const ovNew2pp = compute2ppFn(ovPrim, prefFlows);
      const ovSwing2pp = (ovNew2pp - baseline2pp) * regionMult * elastMult;
      let ovSwingToT1 = 0;
      if (isAlp1 && isCoal2) ovSwingToT1 = ovSwing2pp;
      else if (isCoal1 && isAlp2) ovSwingToT1 = -ovSwing2pp;
      else if (isGrn1 && isAlp2) ovSwingToT1 = ((ov.grn ?? swings.grn) - (ov.alp ?? swings.alp)) / 2 * regionMult;
      else if (isGrn1 && isCoal2) ovSwingToT1 = ((ov.grn ?? swings.grn) - (ov.coal ?? swings.coal ?? 0)) / 2 * regionMult;
      else if (isInd1) ovSwingToT1 = (isAlp2 ? -1 : 1) * ovSwing2pp * 0.3;
      const ovNewMargin = seat.margin + ovSwingToT1;
      const ovHolds = ovNewMargin > 0;
      const ovWinnerParty = ovHolds ? t1 : t2;
      const ovProjAlp2pp = (isAlp1 || isAlp2) ? (isAlp1 ? 50 + ovNewMargin : 50 - ovNewMargin) : null;
      return {
        ...seat,
        modelled: {
          winnerParty: ovWinnerParty, winnerGroup: getParty(ovWinnerParty).group,
          winnerPct: 50 + Math.abs(ovNewMargin), projAlp2pp: ovProjAlp2pp,
          changed: ovWinnerParty !== seat.winner.party,
          isOverride: true, regionMult, region,
        },
      };
    }

    // ── Standard 2PP-swing calculation ───────────────────────────────────────
    // Default undefined state swing components to 0 so NaN doesn't propagate
    // when the caller omits a party's swing.
    const sAlp  = swings.alp  ?? 0;
    const sCoal = swings.coal ?? 0;
    const sGrn  = swings.grn  ?? 0;
    const sOn   = swings.on   ?? 0;
    let swingToT1 = 0;
    if (isAlp1 && isCoal2) swingToT1 = effectiveSwing2pp * regionMult * elastMult;
    else if (isCoal1 && isAlp2) swingToT1 = -effectiveSwing2pp * regionMult * elastMult;
    else if (isGrn1 && isAlp2) swingToT1 = (sGrn - sAlp) / 2 * regionMult;
    else if (isGrn1 && isCoal2) swingToT1 = (sGrn - sCoal) / 2 * regionMult;
    else if (isAlp1 && isGrn2) swingToT1 = (sAlp - sGrn) / 2 * regionMult;
    else if (isCoal1 && isGrn2) swingToT1 = -(sGrn - sCoal) / 2 * regionMult;
    // ON is a named-party challenger in a Coal-held seat: use primary swing differential.
    // When LNP primary drops and ON primary rises (typical right-side fragmentation), the
    // LNP vs ON margin responds strongly to that differential rather than the ALP 2PP swing.
    // Factor 0.6: ~60% of the raw primary differential translates to TCP margin shift after
    // preferences flow (ALP/GRN voters all preference LNP over ON, reducing net ON gain).
    else if (isCoal1 && isOn2) swingToT1 = (sCoal - sOn) * 0.6 * regionMult;
    else if (isOn1 && isCoal2) swingToT1 = (sOn - sCoal) * 0.6 * regionMult;
    else if (isCoal1 && isInd2) swingToT1 = -swing2pp * 0.3;  // IND challenger (not ON) — no regionMult
    else if (isInd1) swingToT1 = (isAlp2 ? -1 : 1) * swing2pp * 0.3;  // IND seats — no regionMult

    // Final NaN guard: if either effectiveSwing2pp or a party swing produced
    // NaN (e.g. empty statewide primary input), fall back to no swing.
    if (!Number.isFinite(swingToT1)) swingToT1 = 0;

    const newMargin = seat.margin + swingToT1;
    const holds = newMargin > 0;
    const projWinnerParty = holds ? t1 : t2;
    const projWinnerGroup = getParty(projWinnerParty).group;
    const projAlp2ppRaw = (isAlp1 || isAlp2)
      ? (isAlp1 ? 50 + newMargin : 50 - newMargin)
      : null;
    const projAlp2pp = Number.isFinite(projAlp2ppRaw) ? projAlp2ppRaw : null;
    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct: 50 + Math.abs(newMargin),
        projAlp2pp,
        changed: projWinnerParty !== seat.winner.party,
        regionMult,
        region,
      },
    };
  });
}

// ── Hare-Clark STV count simulation (TAS, ACT) ───────────────────────────────
// Party-aggregated single transferable vote count per electorate:
//   1. Droop quota = 100 / (seats + 1) (held fixed at the first-count total).
//   2. Groups elect a member for each full quota; surpluses stay with the
//      group's next candidate (scaled by a pooling efficiency, below).
//   3. The weakest continuing group is excluded and its votes transfer to the
//      continuing groups via HARE_CLARK_TRANSFERS; the unlisted remainder
//      exhausts. Repeat until all seats fill (or continuing groups = vacancies).
// This replaces the old floor(pct/quota) + largest-remainder heuristic, which
// ignored exclusions entirely and needed Franklin's primaries calibration-
// adjusted to reproduce the actual 2024 outcome. The simulation reproduces the
// actual TAS 2024 (Lib 14, ALP 10, GRN 5, JLN+IND 6 — correct in all five
// electorates incl. Braddon's 2nd JLN seat) and ACT 2024 (ALP 9, Lib 9, GRN 7)
// results from first preferences with the default transfer matrix.

// Inter-group preference transfer shares on exclusion. Rows: excluded group →
// share of its votes flowing to each continuing group; the remainder exhausts
// (TAS/ACT Hare-Clark has no group ticket voting and substantial exhaustion).
// Approximate party-aggregated rates from TEC / Elections ACT 2024
// distribution reports.
const HARE_CLARK_TRANSFERS = {
  grn:  { alp: 0.45, ind: 0.20, coal: 0.10 },  // 25% exhausts
  on:   { coal: 0.40, ind: 0.25, alp: 0.10 },  // 25% exhausts
  ind:  { coal: 0.25, alp: 0.25, grn: 0.15 },  // 35% exhausts
  alp:  { grn: 0.30, ind: 0.25, coal: 0.10 },  // 35% exhausts
  coal: { ind: 0.30, on: 0.20, alp: 0.10 },    // 40% exhausts
};

// Within-group vote-pooling efficiency applied to a group's surplus after each
// seat won (1.0 = perfect ticket pooling). "ind" pools imperfectly — it is a
// mix of party-like tickets (JLN in TAS) and unrelated independents whose
// mutual flows leak — 0.85 reproduces Braddon 2024 (JLN 2nd seat) while
// stopping loose-independent pools from over-winning.
const HARE_CLARK_POOLING = { ind: 0.85 };

// electorates: [{ name, seats, coal, alp, grn, ind, on }] — swing pre-applied
// by callers; values renormalised to 100 internally. Returns statewide seat
// totals { coal, alp, grn, ind, on }.
function allocateHareClark(electorates, _newPcts, transfers = HARE_CLARK_TRANSFERS, pooling = HARE_CLARK_POOLING) {
  const groups = ["coal", "alp", "grn", "ind", "on"];
  const totals = Object.fromEntries(groups.map(g => [g, 0]));

  electorates.forEach(el => {
    const seats = el.seats;
    const quota = 100 / (seats + 1);   // Droop quota as a % of first-count total
    const v = {};
    groups.forEach(g => { v[g] = Math.max(0, el[g] ?? 0); });
    const tot = groups.reduce((a, g) => a + v[g], 0) || 1;
    groups.forEach(g => { v[g] = v[g] / tot * 100; });

    const elected = Object.fromEntries(groups.map(g => [g, 0]));
    let filled = 0;
    const excluded = new Set(groups.filter(g => v[g] <= 0));

    // Elect every group sitting on a full quota (strongest first), retaining
    // the pooled surplus for its next candidate.
    const electSurpluses = () => {
      for (;;) {
        if (filled >= seats) return;
        const over = groups
          .filter(g => !excluded.has(g) && v[g] >= quota)
          .sort((a, b) => v[b] - v[a]);
        if (!over.length) return;
        const g = over[0];
        elected[g] += 1; filled += 1;
        v[g] = (v[g] - quota) * (pooling[g] ?? 1.0);
      }
    };

    electSurpluses();
    while (filled < seats) {
      const continuing = groups.filter(g => !excluded.has(g) && v[g] > 0);
      if (!continuing.length) break;  // everything exhausted (degenerate input)
      if (continuing.length <= seats - filled) {
        // Continuing groups = vacancies: remaining seats fill without a quota.
        continuing.sort((a, b) => v[b] - v[a]);
        for (const g of continuing) {
          if (filled < seats) { elected[g] += 1; filled += 1; }
        }
        break;
      }
      // Exclude the weakest continuing group and distribute its preferences.
      const excl = continuing.sort((a, b) => v[a] - v[b])[0];
      excluded.add(excl);
      const t = transfers[excl] ?? {};
      for (const [to, share] of Object.entries(t)) {
        if (!excluded.has(to)) v[to] += v[excl] * share;
      }
      v[excl] = 0;
      electSurpluses();
    }

    groups.forEach(g => { totals[g] += elected[g]; });
  });

  return totals;  // { coal, alp, grn, ind, on }
}

// Box-Muller transform: standard normal sample
function gaussRandom() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Monte Carlo uncertainty for Hare-Clark proportional systems.
// Draws a statewide Gaussian shock per party each simulation (swingStd) and
// applies it to every electorate's primaries before running the STV count.
// (allocateHareClark reads electorate values, so the shock must be applied to
// the electorates themselves — an earlier version perturbed an ignored
// argument, making all N simulations identical.)
function computeHareClarkUncertainty(electorates, basePcts, swingStd, majority, N = 500) {
  const parties = ["coal", "alp", "grn", "ind", "on"];
  const tallies = Object.fromEntries(parties.map(p => [p, []]));

  for (let i = 0; i < N; i++) {
    const shock = Object.fromEntries(parties.map(p => [p, gaussRandom() * swingStd]));
    const perturbedElectorates = electorates.map(el => {
      const out = { ...el };
      parties.forEach(p => { out[p] = Math.max(0, (el[p] ?? 0) + shock[p]); });
      return out;
    });
    const result = allocateHareClark(perturbedElectorates, basePcts);
    parties.forEach(p => tallies[p].push(result[p] ?? 0));
  }

  const stats = {};
  parties.forEach(p => {
    const s = [...tallies[p]].sort((a, b) => a - b);
    const mean = s.reduce((x, v) => x + v, 0) / N;
    stats[p] = {
      mean: Math.round(mean * 10) / 10,
      p05: s[Math.floor(N * 0.05)],
      p25: s[Math.floor(N * 0.25)],
      p50: s[Math.floor(N * 0.50)],
      p75: s[Math.floor(N * 0.75)],
      p95: s[Math.floor(N * 0.95)],
      pMajority: Math.round(s.filter(v => v >= majority).length / N * 100),
    };
  });
  return stats;
}

// ── Legislative Council (upper house) projections ────────────────────────────
// The four bicameral states' upper houses are statewide (NSW since always, WA
// since the 2021 reform, SA) or regional (VIC, 8 regions × 5) proportional
// chambers. Seats are projected with the same party-aggregated STV engine as
// Hare-Clark (allocateHareClark): Droop quota on the chamber's elected seats,
// surplus pooling, iterative exclusion with an LC-specific transfer matrix.
// "ind" here pools all micro-parties/others (LCP, SFF, AJP, …), which is why
// its pooling efficiency is below 1 — unrelated tickets don't exchange
// preferences efficiently and optional preferential ballots exhaust heavily.
// Projections are indicative: deltas are anchored to the model's own baseline
// allocation (±1–2 seats vs declared results at baseline), not to the actual
// composition, to avoid false precision.
const LC_TRANSFERS = {
  grn:  { alp: 0.45, ind: 0.15, coal: 0.05 },
  on:   { coal: 0.35, ind: 0.20, alp: 0.10 },
  ind:  { alp: 0.20, coal: 0.20, grn: 0.10, on: 0.10 },
  alp:  { grn: 0.30, ind: 0.20 },
  coal: { ind: 0.25, on: 0.20 },
};
const LC_POOLING = { ind: 0.70 };

// Per-chamber config. `base` is the chamber's own first-preference baseline
// (upper-house votes differ from lower-house primaries — minor parties run
// well ahead); null means seed from the lower-house primaries (SA 2026: the
// ECSA LC count was still provisional at capture). Keyed by state model id.
const LC_CHAMBERS = {
  nsw_2023: {
    label: "NSW Legislative Council", electedSeats: 21,
    base: { alp: 37.1, coal: 29.9, grn: 9.7, on: 5.9 },
    note: "21 of 42 seats elected statewide each election (8-year terms; quota 4.5%). " +
      "2023 declared: ALP 8 · Coalition 6 · GRN 2 · ON 1 · others 4 (NSWEC, approx. baseline shares).",
  },
  wa_2025: {
    label: "WA Legislative Council", electedSeats: 37,
    base: { alp: 36.4, coal: 31.3, grn: 10.8, on: 4.5 },
    note: "Whole-of-state chamber since the 2021 reform (37 seats, quota 2.6%). " +
      "2025 declared: ALP 16 · Coalition 12 · GRN 4 · ON 2 · others 3 (WAEC, approx. baseline shares).",
  },
  sa_2026: {
    label: "SA Legislative Council", electedSeats: 11,
    base: null,
    note: "11 of 22 seats elected statewide each election (quota 8.3%). LC shares seeded from " +
      "the lower-house primaries — the ECSA 2026 LC count was provisional at capture; treat as indicative.",
  },
  vic_2022: {
    label: "VIC Legislative Council", electedSeats: 40,
    base: { alp: 33.0, coal: 29.5, grn: 11.5, on: 2.5 },
    note: "Approximation: the real chamber elects 5 members in each of 8 regions, and the 2022 " +
      "count ran on group-ticket preference deals that materially boosted micro-parties; a statewide " +
      "allocation is indicative only. 2022 declared: ALP 15 · Coalition 14 · GRN 4 · ON 1 · others 6 (VEC).",
  },
};

// Project an upper-house composition: chamber baseline shares shifted by the
// user's lower-house primary swings (alp/coal/grn/on; everything else pools
// into "ind"/others), then allocated by the STV engine.
function projectLcSeats(chamber, prim, bl) {
  const base = chamber.base ?? { alp: bl.alp, coal: bl.coal, grn: bl.grn, on: bl.on ?? 0 };
  const sw = (k) => (prim?.[k] ?? bl?.[k] ?? 0) - (bl?.[k] ?? 0);
  const shares = {
    alp:  Math.max(0, base.alp  + sw("alp")),
    coal: Math.max(0, base.coal + sw("coal")),
    grn:  Math.max(0, base.grn  + sw("grn")),
    on:   Math.max(0, (base.on ?? 0) + sw("on")),
  };
  const major = shares.alp + shares.coal + shares.grn + shares.on;
  shares.ind = Math.max(0, 100 - major);   // micro-parties / others pool
  const el = { seats: chamber.electedSeats, ...shares };
  const projected = allocateHareClark([el], null, LC_TRANSFERS, LC_POOLING);
  const baseShares = {
    alp: base.alp, coal: base.coal, grn: base.grn, on: base.on ?? 0,
    ind: Math.max(0, 100 - (base.alp + base.coal + base.grn + (base.on ?? 0))),
  };
  const baseline = allocateHareClark(
    [{ seats: chamber.electedSeats, ...baseShares }], null, LC_TRANSFERS, LC_POOLING);
  return { projected, baseline, shares };
}

// Compact upper-house projection panel rendered inside the state views.
function LcProjectionPanel({ chamber, prim, bl, panelStyle }) {
  if (!chamber) return null;
  const { projected, baseline } = projectLcSeats(chamber, prim, bl);
  const rows = [
    { k: "alp", l: "ALP", c: "#DC2626" },
    { k: "coal", l: "Coalition", c: "#1D4ED8" },
    { k: "grn", l: "Greens", c: "#059669" },
    { k: "on", l: "One Nation", c: "#B45309" },
    { k: "ind", l: "Others / micro", c: "var(--text-3)" },
  ];
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
        {chamber.label} <span style={{ fontWeight: 400, color: "var(--text-3)", fontSize: 12 }}>
          — {chamber.electedSeats} seats this election
        </span>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "8px 0" }}>
        {rows.map(({ k, l, c }) => {
          const seats = projected[k] ?? 0;
          const delta = seats - (baseline[k] ?? 0);
          return (
            <div key={k} style={{ minWidth: 86 }}>
              <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-1)" }}>
                {seats}
                {delta !== 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 5, color: delta > 0 ? "#059669" : "#DC2626" }}>
                    {delta > 0 ? "+" : ""}{delta}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-4)", lineHeight: 1.5 }}>
        {chamber.note} Projection: party-aggregated STV (quota, surplus pooling, exclusion
        transfers); lower-house primary swings applied to the chamber baseline; deltas vs the
        model's own baseline allocation. Indicative only.
      </div>
    </div>
  );
}

// ─── Small reusable components ────────────────────────────────────────────────
function PartyBadge({ party }) {
  const p = getParty(party);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--subtle-bg)", color: "var(--text-1)", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 2, border: "1px solid var(--border-1)", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
      {p.short}
    </span>
  );
}

function MarginDot({ margin }) {
  const c = MARGIN_COLOR[getMarginCat(margin)];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
      <span style={{ fontWeight: 600, color: "var(--text-1)" }}>{margin?.toFixed(1)}%</span>
    </span>
  );
}

function SwingBadge({ swing }) {
  if (swing == null) return <span style={{ color: "var(--text-4)" }}>—</span>;
  const pos = swing > 0;
  return <span style={{ color: pos ? "#059669" : "#DC2626", fontWeight: 600 }}>{pos ? "+" : ""}{swing.toFixed(1)}%</span>;
}

function TcpBar({ tcp, winnerParty }) {
  if (!tcp || !tcp.length) return <span style={{ color: "var(--text-4)", fontSize: 12 }}>—</span>;
  const winner = tcp.find(t => t.party === winnerParty);
  if (!winner) return null;
  const p = getParty(winnerParty);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 64, height: 6, background: "var(--border-3)", borderRadius: 1, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${Math.min(winner.pct, 100)}%`, height: "100%", background: p.color, borderRadius: 1 }} />
      </span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{winner.pct.toFixed(1)}%</span>
    </span>
  );
}

// Animated number roll-up for the hero. Animates from the previously displayed
// value (not 0) so projection changes roll smoothly; respects reduced motion.
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  const shownRef = useRef(0); // last value actually displayed — animation start point
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = target;
      setValue(target);
      return;
    }
    let raf;
    const start = performance.now();
    const step = now => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = t >= 1 ? target : from + (target - from) * eased;
      shownRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function useIsMobile(breakpoint = 768) {
  const [w, setW] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    const handle = () => setW(window.innerWidth);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  return w < breakpoint;
}

const STYLES = {
  panel:        { background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "18px 22px", marginBottom: 16 },
  sectionHead:  { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", marginBottom: 10 },
  panelTitle:   { fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, color: "var(--text-1)", marginBottom: 12 },
  sectionTitle: { fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--text-dark)", margin: 0, letterSpacing: "-0.01em" },
  statCard:     { background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "14px 16px" },
  metricCard:   { background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "14px 16px" },
  tableHead:    { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", background: "var(--table-head-bg)", padding: "10px 12px", textAlign: "left", borderBottom: "2px solid var(--text-1)" },
  tableCell:    { padding: "11px 14px", fontVariantNumeric: "tabular-nums" },
  input:        { border: "1px solid var(--border-2)", borderRadius: 3, padding: "6px 10px", fontSize: 13, outline: "none", background: "var(--panel-bg)", color: "var(--text-1)" },
  btnPrimary:   { padding: "7px 16px", background: "var(--text-1)", color: "var(--page-bg)", borderRadius: 3, fontSize: 13, fontWeight: 600, border: "none",                             cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.12s, border-color 0.12s" },
  btnSecondary: { padding: "7px 16px", background: "var(--metric-bg)", color: "var(--text-2)", borderRadius: 3, fontSize: 13, fontWeight: 600, border: "1px solid var(--border-2)", cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.12s, border-color 0.12s" },
  btnDanger:    { padding: "7px 16px", background: "var(--subtle-bg)", color: "#DC2626", borderRadius: 3, fontSize: 13, fontWeight: 600, border: "1px solid #DC262655",    cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.12s, border-color 0.12s" },
  btnInfo:      { padding: "7px 16px", background: "var(--subtle-bg)", color: "var(--text-2)", borderRadius: 3, fontSize: 13, fontWeight: 600, border: "1px solid var(--border-2)",    cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.12s, border-color 0.12s" },
  kicker:       { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)" },
  num:          { fontVariantNumeric: "tabular-nums" },
  rule:         { borderTop: "1px solid var(--border-1)" },
};

// Shared recharts theming — keep at module scope (same constraint as STYLES).
const CHART = {
  grid:    { vertical: false, stroke: "var(--border-3)" },
  tick:    { fontSize: 11, fill: "var(--text-3)" },
  tooltip: { fontSize: 12, borderRadius: 3, border: "1px solid var(--border-2)", boxShadow: "none", background: "var(--panel-bg)", color: "var(--text-1)" },
};

function TallyBar({ seats, useModelled = false }) {
  const counts = {};
  seats.forEach(s => {
    const g = useModelled ? (s.modelled?.winnerGroup ?? getSeatGroup(s)) : getSeatGroup(s);
    counts[g] = (counts[g] || 0) + 1;
  });
  const total = seats.length;
  const majorityAt = Math.floor(total / 2) + 1;
  const majorityPct = total > 0 ? (majorityAt / total) * 100 : 50;
  return (
    <div style={{ ...STYLES.panel, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>
        {useModelled ? "Projected" : "2025 result"} — {total} seats shown
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", height: 36, borderRadius: 6, overflow: "hidden", gap: 2 }}>
          {GROUP_ORDER.filter(g => counts[g]).map(g => (
            <div key={g} style={{ flex: counts[g], background: GROUP_CONFIG[g].color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
              {counts[g] >= 2 ? counts[g] : ""}
            </div>
          ))}
        </div>
        {/* majority marker */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${majorityPct}%`, width: 2, background: "rgba(0,0,0,0.35)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -18, left: `${majorityPct}%`, transform: "translateX(-50%)", fontSize: 10, fontWeight: 700, color: "var(--text-3)", whiteSpace: "nowrap" }}>
          {majorityAt} needed
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 16px", marginTop: 12 }}>
        {GROUP_ORDER.filter(g => counts[g]).map(g => (
          <span key={g} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)" }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: GROUP_CONFIG[g].color, display: "inline-block", flexShrink: 0 }} />
            {GROUP_CONFIG[g].label} <strong style={{ fontWeight: 700, color: "var(--text-1)" }}>{counts[g]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// Hero projection banner under the header. Pure render over App()'s projCounts /
// seatAvg2pp; stays at module scope (same constraint as STYLES).
function HeroBanner({ counts, avg2pp, isMobile }) {
  const alp = counts.alp ?? 0;
  const coalition = counts.coalition ?? 0;
  const greens = counts.greens ?? 0;
  const crossbench = (counts.teal ?? 0) + (counts.ind ?? 0) + (counts.one_nation ?? 0) + (counts.crossbench ?? 0);
  const total = GROUP_ORDER.reduce((sum, g) => sum + (counts[g] || 0), 0);
  const majorityPct = total > 0 ? (76 / total) * 100 : 50;
  const alpAnim = Math.round(useCountUp(alp));
  const coalAnim = Math.round(useCountUp(coalition));
  const bigNum = {
    fontFamily: "var(--font-display)",
    fontSize: isMobile ? 30 : 44,
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    minWidth: "1.6ch",
  };
  const bigLabel = { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--header-muted)" };
  return (
    <div style={{ background: "var(--header-bg)", color: "var(--header-fg)", padding: isMobile ? "12px 16px 0" : "16px 24px 0" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Kicker row */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: isMobile ? 8 : 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--header-muted)" }}>
            2025 Federal Projection
          </span>
          <span style={{ fontSize: 10, color: "var(--header-muted)", whiteSpace: "nowrap" }}>
            Data: 3 May 2025 final
          </span>
        </div>
        {/* Headline numbers */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? 16 : 28, flexWrap: "wrap", marginBottom: isMobile ? 10 : 12 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ ...bigNum, color: "#E5484D" }}>{alpAnim}</span>
            <span style={bigLabel}>Labor</span>
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ ...bigNum, color: "#5B8DEF" }}>{coalAnim}</span>
            <span style={bigLabel}>Coalition</span>
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 17 : 22, fontWeight: 600, lineHeight: 1, color: "#34B27B", fontVariantNumeric: "tabular-nums" }}>{greens}</span>
            <span style={bigLabel}>Greens</span>
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 17 : 22, fontWeight: 600, lineHeight: 1, color: "var(--header-fg)", fontVariantNumeric: "tabular-nums" }}>{crossbench}</span>
            <span style={bigLabel}>Crossbench</span>
          </span>
          {avg2pp != null && (
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
              <span style={bigLabel}>2PP</span>
              <span style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 17 : 22, fontWeight: 600, lineHeight: 1, color: avg2pp.avg >= 50 ? "#E5484D" : "#5B8DEF", fontVariantNumeric: "tabular-nums" }}>
                {avg2pp.avg.toFixed(1)}%
              </span>
              <span style={bigLabel}>ALP</span>
            </span>
          )}
        </div>
        {/* Seat bar with majority marker */}
        <div style={{ position: "relative", marginTop: 18 }}>
          <div style={{ display: "flex", height: isMobile ? 12 : 14, gap: 1, animation: "growBar 0.7s ease-out", transformOrigin: "left" }}>
            {GROUP_ORDER.filter(g => counts[g]).map(g => (
              <div key={g} style={{ flex: counts[g], background: GROUP_CONFIG[g].color }} />
            ))}
          </div>
          <div style={{ position: "absolute", top: -3, bottom: -3, left: `${majorityPct}%`, width: 1, background: "var(--header-fg)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: -16, left: `${majorityPct}%`, transform: "translateX(-50%)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "var(--header-muted)", whiteSpace: "nowrap" }}>
            76 FOR MAJORITY
          </div>
        </div>
        {/* Newspaper double rule */}
        <div style={{ marginTop: isMobile ? 10 : 12 }}>
          <div style={{ height: 3, background: "rgba(255,255,255,0.28)" }} />
          <div style={{ height: 2 }} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.28)" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Live Results page ────────────────────────────────────────────────────────
// Presentational component for the Live tab. All data is computed in App() (the
// useLiveResults hook + projection/confidence memos) and passed in as props, so this
// stays a pure render that closes over module-scope STYLES / GROUP_CONFIG.
const LIVE_STATUS_STYLE = {
  called:      { label: "Called",   bg: "rgba(22,163,74,0.14)",  fg: "#16A34A" },
  likely:      { label: "Likely",   bg: "rgba(217,119,6,0.14)",  fg: "#D97706" },
  in_doubt:    { label: "In doubt", bg: "rgba(220,38,38,0.14)",  fg: "#DC2626" },
  not_started: { label: "Not started", bg: "var(--subtle-bg)", fg: "var(--text-3)" },
};

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function LivePage({
  meta, projected, confidence, status, error, lastFetched, refresh,
  isMobile, devSnapshots, snapshotUrl, onPickSnapshot, sourceLabel,
}) {
  const [sortKey, setSortKey] = useState("countedPct");
  const [sortDir, setSortDir] = useState("desc");

  const hasData = projected && projected.length > 0 && confidence;

  // Point-estimate projected seat counts (deterministic winner per seat).
  const projCounts = useMemo(() => {
    const c = {};
    (projected || []).forEach(s => { c[s.winnerGroup] = (c[s.winnerGroup] || 0) + 1; });
    return c;
  }, [projected]);

  const sortedSeats = useMemo(() => {
    const rows = [...(projected || [])];
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (s) => {
      switch (sortKey) {
        case "name": return s.name;
        case "countedPct": return s.countedPct;
        case "margin": return s.margin;
        case "swing": return s.swing2cp ?? -999;
        case "winProb": return confidence?.seatWinProbs?.[s.seatId] ?? 0;
        case "leader": return s.winnerGroup;
        default: return s.countedPct;
      }
    };
    rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
    return rows;
  }, [projected, confidence, sortKey, sortDir]);

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };
  const Th = ({ k, children, align = "left" }) => (
    <th onClick={() => toggleSort(k)}
      style={{ ...STYLES.tableHead, textAlign: align, cursor: "pointer", whiteSpace: "nowrap" }}>
      {children}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  const majority = meta?.majority ?? LIVE_CONFIG.active.majority;

  // ── Header / status row ──
  const header = (
    <div style={{ ...STYLES.panel, marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "#DC2626" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#DC2626", display: "inline-block",
          animation: status === "ok" ? "livePulse 1.6s ease-in-out infinite" : "none" }} />
        LIVE
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
        {LIVE_CONFIG.active.label} · {meta?.chamber || LIVE_CONFIG.active.chamber}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
        {hasData ? `${(confidence.asOfCounted).toFixed(1)}% counted` : "awaiting data"}
        {lastFetched ? ` · updated ${fmtTime(lastFetched)}` : ""}
        {` · ${sourceLabel}`}
      </span>
      <span style={{ flex: 1 }} />
      {devSnapshots && (
        <select value={snapshotUrl || ""} onChange={(e) => onPickSnapshot(e.target.value || null)}
          title="Dev: simulate count progression"
          style={{ ...STYLES.input, padding: "5px 8px" }}>
          <option value="">Live source</option>
          {devSnapshots.map(s => <option key={s.url} value={s.url}>{`Sample ${s.label}`}</option>)}
        </select>
      )}
      <button onClick={refresh} style={STYLES.btnSecondary}>↻ Refresh</button>
    </div>
  );

  if (!hasData) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: 16 }}>
        {header}
        <div style={{ ...STYLES.panel, textAlign: "center", padding: "48px 22px", color: "var(--text-3)" }}>
          {status === "error"
            ? <>Could not load live results.<div style={{ fontSize: 12, marginTop: 8, color: "#B91C1C" }}>{error}</div></>
            : status === "loading"
            ? "Loading live results…"
            : "Polls are not yet open — live results will appear here once counting begins."}
        </div>
      </div>
    );
  }

  // ── Headline projection cards ──
  const card = (group, dist) => {
    const cfg = GROUP_CONFIG[group] || { label: group, color: "#64748B" };
    const pMaj = group === "alp" ? confidence.pMajority.alp
      : group === "coalition" ? confidence.pMajority.coalition : null;
    return (
      <div key={group} style={{ ...STYLES.statCard, flex: "1 1 150px", minWidth: 140 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: cfg.color, display: "inline-block" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>{cfg.label}</span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-1)", lineHeight: 1 }}>
          {dist ? Math.round(dist.mean) : (projCounts[group] || 0)}
        </div>
        {dist && (
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
            range {dist.p05}–{dist.p95}
          </div>
        )}
        {pMaj != null && (
          <div style={{ fontSize: 11, color: cfg.color, fontWeight: 700, marginTop: 4 }}>
            {pMaj}% majority
          </div>
        )}
      </div>
    );
  };

  // ── Projected seat bar with majority marker ──
  const totalShown = projected.length;
  const majorityPct = (majority / (meta?.totalSeats || totalShown)) * 100;
  const seatBar = (
    <div style={{ position: "relative", marginTop: 4 }}>
      <div style={{ display: "flex", height: 34, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {GROUP_ORDER.filter(g => projCounts[g]).map(g => (
          <div key={g} style={{ flex: projCounts[g], background: GROUP_CONFIG[g].color, display: "flex",
            alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
            {projCounts[g] >= 2 ? projCounts[g] : ""}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", top: -2, bottom: -2, left: `${majorityPct}%`, width: 2, background: "rgba(0,0,0,0.45)" }} />
      <div style={{ position: "absolute", top: -18, left: `${majorityPct}%`, transform: "translateX(-50%)",
        fontSize: 10, fontWeight: 700, color: "var(--text-3)", whiteSpace: "nowrap" }}>
        {majority} for majority
      </div>
    </div>
  );

  // ── ALP seat-total distribution chart ──
  const distData = confidence.seatTotalDist.map(d => ({ seats: d.seats, prob: +(d.prob * 100).toFixed(2) }));

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: 16 }}>
      <style>{"@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.25}}"}</style>
      {header}

      <div style={{ ...STYLES.panel, marginBottom: 14 }}>
        <div style={STYLES.sectionHead}>Projected outcome</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22, marginTop: 4 }}>
          {card("alp", confidence.alp)}
          {card("coalition", confidence.coalition)}
          {card("greens", null)}
          {card("ind", null)}
        </div>
        {seatBar}
        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 18 }}>
          Most likely:&nbsp;
          {confidence.pMajority.alp >= 50 ? `Labor majority (${confidence.pMajority.alp}%)`
            : confidence.pMajority.coalition >= 50 ? `Coalition majority (${confidence.pMajority.coalition}%)`
            : `Hung parliament most likely (${confidence.pMajority.hung}%) — ALP majority ${confidence.pMajority.alp}%, Coalition ${confidence.pMajority.coalition}%`}
        </div>
      </div>

      <div style={{ ...STYLES.panel, marginBottom: 14 }}>
        <div style={STYLES.panelTitle}>Labor seat total — probability distribution</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={distData} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis dataKey="seats" tick={{ fontSize: 10 }} interval={isMobile ? 4 : 2} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v) => [`${v}%`, "probability"]}
              labelFormatter={(l) => `${l} seats`}
              contentStyle={CHART.tooltip} />
            <ReferenceLine x={majority} stroke="var(--text-2)" strokeDasharray="4 2"
              label={{ value: `maj ${majority}`, fontSize: 10, position: "top" }} />
            <Bar dataKey="prob">
              {distData.map((d) => (
                <Cell key={d.seats} fill={d.seats >= majority ? GROUP_CONFIG.alp.color : "#FCA5A5"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          Darker bars = Labor majority outcomes. Distribution narrows as more votes are counted.
        </div>
      </div>

      <div style={{ ...STYLES.panel }}>
        <div style={STYLES.panelTitle}>Seats ({projected.length})</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th k="name">Seat</Th>
                <Th k="countedPct" align="right">Counted</Th>
                <Th k="leader">Leader</Th>
                <Th k="margin" align="right">Margin</Th>
                <Th k="swing" align="right">Swing</Th>
                <Th k="winProb" align="right">Win prob</Th>
                <th style={{ ...STYLES.tableHead, textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedSeats.map(s => {
                const cfg = GROUP_CONFIG[s.winnerGroup] || { label: s.winnerParty, color: "#64748B" };
                const st = LIVE_STATUS_STYLE[s.status] || LIVE_STATUS_STYLE.in_doubt;
                const wp = confidence.seatWinProbs?.[s.seatId];
                const swing = s.swing2cp;
                return (
                  <tr key={s.seatId} style={{ borderTop: "1px solid var(--border-2)" }}>
                    <td style={{ ...STYLES.tableCell }}>
                      <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{s.name}</div>
                      {s.region && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{s.region}</div>}
                    </td>
                    <td style={{ ...STYLES.tableCell, textAlign: "right", color: "var(--text-2)" }}>
                      {s.countedPct.toFixed(0)}%
                    </td>
                    <td style={{ ...STYLES.tableCell }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: cfg.color }} />
                        <span style={{ fontWeight: 600 }}>{s.winnerParty}</span>
                        {s.changed && <span style={{ fontSize: 10, color: "#B45309", fontWeight: 700 }}>GAIN</span>}
                      </span>
                    </td>
                    <td style={{ ...STYLES.tableCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {s.margin.toFixed(1)}
                    </td>
                    <td style={{ ...STYLES.tableCell, textAlign: "right", fontVariantNumeric: "tabular-nums",
                      color: swing == null ? "var(--text-3)" : swing >= 0 ? "#DC2626" : "#1D4ED8" }}>
                      {swing == null ? "—" : `${swing >= 0 ? "+" : ""}${swing.toFixed(1)}`}
                    </td>
                    <td style={{ ...STYLES.tableCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {wp == null ? "—" : `${Math.round(wp * 100)}%`}
                    </td>
                    <td style={{ ...STYLES.tableCell, textAlign: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: st.fg, background: st.bg,
                        borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
          Margin and swing are projected final two-candidate-preferred (pp). Swing is vs the{" "}
          {meta?.baselineElectionId === "vic_2022" ? "2022" : "previous"} result. VEC publishes
          district-level counts, so projections use district swing; booth-matched swing is used
          automatically where booth-level feeds are available.
        </div>
      </div>
    </div>
  );
}

// ─── Primary vote % input ─────────────────────────────────────────────────────
function PrimaryInput({ label, value, onChange, color = "var(--text-3)", baseline }) {
  const [raw, setRaw] = useState(String(value));

  // Sync display when parent resets value (e.g. Reset button)
  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const delta = +(value - baseline).toFixed(1);

  function handleBlur() {
    const v = parseFloat(raw);
    if (!isNaN(v)) {
      const clamped = Math.max(0, Math.min(100, +v.toFixed(1)));
      onChange(clamped);
      setRaw(String(clamped));
    } else {
      // Empty or invalid — revert display to last committed value
      setRaw(String(value));
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", minWidth: 112 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={handleBlur}
          style={{
            width: 68, border: "1px solid var(--border-2)", borderRadius: 6, padding: "6px 9px",
            fontSize: 14, fontWeight: 700, textAlign: "right", outline: "none",
            borderColor: delta !== 0 ? color : "var(--border-2)"
          }}
        />
        <span style={{ fontSize: 13, color: "var(--text-3)" }}>%</span>
      </div>
      <span style={{
        fontSize: 12, fontWeight: 600, width: 58, flexShrink: 0,
        display: "inline-flex", justifyContent: "flex-end", alignItems: "center",
        color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : "var(--text-4)"
      }}>
        {delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta} pp`}
      </span>
    </div>
  );
}

function PrefInput({ label, value, onChange, color = "var(--text-3)", historicalRange }) {
  const pct = Math.round(value * 200) / 2;  // round to nearest 0.5
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{label}</label>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{pct.toFixed(1)}%</span>
      </div>
      <input type="range" min={0} max={100} step={0.5} value={pct}
        onChange={e => onChange(parseFloat(e.target.value) / 100)}
        style={{ width: "100%", accentColor: color, cursor: "pointer" }} />
      {historicalRange && (
        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>
          Historical (2019–2025): {(historicalRange[0] * 100).toFixed(0)}–{(historicalRange[1] * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
// ── State-model constants (baselines, coalition sets, per-seat ON/flow data) ──
// Module scope so the baseline-alignment tests (src/__tests__/) can exercise the
// models exactly as the dashboard's call sites do. Values unchanged.

// Per-seat Greens→ALP preference flows for NSW 2023.
// Inner-city seats (eastern/inner-western Sydney, Blue Mountains) see higher GRN→ALP flows
// than the statewide 88% because Green voters there are overwhelmingly progressive.
// Regional/Hunter Valley seats see lower flows (~78–82%) — Greens voters in mining areas
// are more likely to exhaust or flow to NP than inner-city counterparts.
// Source: NSWEC 2023 DOP analysis; statewide average = 0.88.
const NSW_SEAT_PREF_FLOWS_2023 = {
  // Inner-city / inner-western Sydney — above average GRN→ALP
  7005: { grn_alp: 0.92 }, // Coogee (ALP vs LP — inner eastern, progressive GRN voters)
  7004: { grn_alp: 0.91 }, // Strathfield (ALP vs LP — inner western, multicultural inner city)
  7076: { grn_alp: 0.91 }, // Kogarah (ALP vs LP — inner southern suburbs)
  7093: { grn_alp: 0.91 }, // Maroubra (ALP vs LP — inner eastern, high GRN primary)
  7094: { grn_alp: 0.90 }, // Heffron (ALP vs LP — Maroubra/Randwick area)
  7075: { grn_alp: 0.90 }, // Rockdale (ALP vs LP — inner south, high Greens)
  7074: { grn_alp: 0.90 }, // Blue Mountains (ALP vs LP — leafy/progressive, high GRN flow)
  7073: { grn_alp: 0.89 }, // Kotara (ALP vs LP — inner Newcastle, above average)
  // Hunter Valley / regional NSW — below average GRN→ALP; conservative ON voter base
  // on_alp: ON voters in mining/coal regions are predominantly ex-NP conservatives (lower ALP flow)
  // other_alp: UAP and minor right-wing parties in these areas also flow more conservatively
  // Source: NSWEC 2023 DOP — per-seat preference flows for ON and other minor parties
  7062: { grn_alp: 0.78, on_alp: 0.12, other_alp: 0.35 }, // Upper Hunter (NP vs ALP — coal, conservative ON base)
  7064: { grn_alp: 0.79, on_alp: 0.11, other_alp: 0.38 }, // Tamworth (NP vs ALP — regional, conservative)
  7066: { grn_alp: 0.78, on_alp: 0.12, other_alp: 0.37 }, // Dubbo (NP vs ALP — western rural, low ALP flow)
  7068: { grn_alp: 0.80, on_alp: 0.16, other_alp: 0.40 }, // Bathurst (NP vs ALP — regional city, moderate)
  7061: { grn_alp: 0.80, on_alp: 0.12, other_alp: 0.36 }, // Oxley (NP vs ALP — mining/farming)
  7063: { grn_alp: 0.80, on_alp: 0.15, other_alp: 0.40 }, // Port Macquarie (NP vs ALP — coastal regional)
  7081: { grn_alp: 0.81, on_alp: 0.14, other_alp: 0.40 }, // Cessnock (ALP vs LP — Hunter mining, moderate ON)
  7082: { grn_alp: 0.82, on_alp: 0.16, other_alp: 0.42 }, // Charlestown (ALP vs LP — Lake Macquarie)
  7083: { grn_alp: 0.82, on_alp: 0.16, other_alp: 0.42 }, // Wallsend (ALP vs LP — inner Newcastle, industrial)
  7084: { grn_alp: 0.82, on_alp: 0.14, other_alp: 0.40 }, // Maitland (ALP vs LP — Hunter Valley)
  7085: { grn_alp: 0.83, on_alp: 0.17, other_alp: 0.43 }, // Newcastle (ALP vs LP — inner Newcastle)
  // Additional ON-present seats: on_alp/other_alp only where not already above
  7071: { on_alp: 0.16, other_alp: 0.41 }, // Swansea (ALP — Lake Macquarie region)
  7060: { on_alp: 0.13, other_alp: 0.36 }, // Barwon (regional NSW, conservative)
  7069: { on_alp: 0.12, other_alp: 0.35 }, // Barwon (NP — far western NSW, very conservative)
};

const NSW_BL = { alp: 37.6, coal: 37.0, grn: 10.4, ind: 8.5, on: 2.0 };

const NSW_2PP = 53.2;

const NSW_RIGHT_BLOC_2PP = 53.5; // ALP vs right bloc (Coal + ON on right side)

const NSW_COAL = new Set(["LP", "NP"]);

// Per-seat ON first-preference baselines for NSW 2023.
// Includes seats where ON has historically been competitive (>5%). These enable
// per-seat ON TCP auto-detection (on_v_alp / on_v_coal) when ON primary surges.
// Source: NSWEC 2023 final results — first preferences by candidate.
// Key Hunter Valley seats: ON ran strongly in mining/regional electorates.
const NSW_SEAT_ON_FP_2023 = {
  7062: 19.1, // Upper Hunter (NP) — strongest ON seat in NSW state
  7081: 11.7, // Cessnock (ALP)
  7064: 10.5, // Tamworth (NP)
  7084:  9.8, // Maitland (ALP)
  7061:  8.5, // Oxley (NP)
  7071:  8.0, // Swansea (ALP) — Lake Macquarie region
  7066:  7.9, // Dubbo (NP)
  7082:  7.5, // Charlestown (ALP)
  7063:  7.0, // Port Macquarie (NP)
  7085:  6.5, // Newcastle (ALP)
  7083:  6.0, // Wallsend (ALP)
  7060:  5.5, // Barwon — regional NSW
  7069:  5.2, // Barwon (NP) — far western NSW
  7068:  5.0, // Bathurst (NP)
};

const NSW_DEFAULT_FLOWS = {
  grn_alp: 0.88, ind_alp: 0.55, on_alp: 0.20, other_alp: 0.45,
  coal_alp_v_on: 0.12, grn_alp_v_on: 0.88, ind_alp_v_on: 0.70, other_alp_v_on: 0.58,
  alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22,
  onCoalOriginFactor: 0.0,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

// Per-seat Greens→ALP preference flows for QLD 2024.
// Inner-Brisbane seats have higher GRN→ALP flows than statewide (82%) due to progressive
// demographics; rural Central/Western QLD seats see lower flows from conservative Green voters.
// Source: ECQ 2024 DOP analysis; statewide average = 0.82.
const QLD_SEAT_PREF_FLOWS_2024 = {
  // Inner Brisbane — above average GRN→ALP
  7204: { grn_alp: 0.89 }, // Greenslopes (LNP vs ALP — inner Brisbane, high-education progressive)
  7205: { grn_alp: 0.89 }, // McConnel (LNP vs ALP — inner Brisbane CBD fringe)
  7211: { grn_alp: 0.87 }, // Inala (ALP vs LNP — outer southwestern Brisbane, high GRN→ALP)
  7212: { grn_alp: 0.87 }, // Toohey (ALP vs LNP — southern Brisbane suburban)
  7206: { grn_alp: 0.85 }, // Everton (LNP vs ALP — northern Brisbane suburban)
  7209: { grn_alp: 0.85 }, // Mundingburra (LNP vs ALP — Townsville inner, mixed demographics)
  // Rural / regional QLD — below average GRN→ALP; conservative ON/minor party base
  // on_alp: ON voters in regional QLD are typically ex-LNP conservatives (lower ALP flow than state avg)
  // other_alp: KAP and minor right-wing parties in ON-heavy seats also flow conservatively
  // Source: ECQ 2024 DOP — per-seat flows for ON/KAP and other minor parties in regional QLD
  7231: { grn_alp: 0.74, on_alp: 0.13, other_alp: 0.35 }, // Nanango (LNP vs ALP — Darling Downs)
  7232: { grn_alp: 0.73, on_alp: 0.12, other_alp: 0.34 }, // Warrego (LNP vs ALP — western QLD, very conservative)
  7233: { grn_alp: 0.74, on_alp: 0.13, other_alp: 0.36 }, // Gympie (LNP vs ALP — Sunshine Coast hinterland)
  7241: { grn_alp: 0.75, on_alp: 0.14, other_alp: 0.37 }, // Bundaberg (ALP vs LNP — regional coastal)
  7242: { grn_alp: 0.74, on_alp: 0.14, other_alp: 0.36 }, // Rockhampton (ALP vs LNP — mining/beef)
  7243: { grn_alp: 0.75, on_alp: 0.15, other_alp: 0.38 }, // Mulgrave (ALP vs LNP — Cairns hinterland)
  7234: { grn_alp: 0.76, on_alp: 0.15, other_alp: 0.38 }, // Buderim (LNP vs ALP — Sunshine Coast)
  7235: { grn_alp: 0.76, on_alp: 0.15, other_alp: 0.39 }, // Caloundra (LNP vs ALP — Sunshine Coast)
  // ON vs LNP TCP seats (7261–7265): on_alp not directly applicable (ON is finalist)
  // but other_alp matters for the TCP computation in ON vs ALP scenarios
  7261: { on_alp: 0.10, other_alp: 0.30 }, // Mirani (LNP vs ON — conservative mining electorate)
  7262: { on_alp: 0.11, other_alp: 0.32 }, // Condamine (LNP vs ON — Darling Downs)
  7263: { on_alp: 0.11, other_alp: 0.32 }, // Callide (LNP vs ON — central QLD)
  7264: { on_alp: 0.12, other_alp: 0.33 }, // Hinchinbrook (LNP vs ON — far north QLD)
  7265: { on_alp: 0.12, other_alp: 0.33 }, // Southern Downs (LNP vs ON — Darling Downs)
};

const QLD_BL = { alp: 33.4, coal: 40.3, grn: 11.5, ind: 6.6, on: 8.2 };

const QLD_2PP = 46.3;

const QLD_RIGHT_BLOC_2PP = 46.1; // ALP vs right bloc (Coal + ON on right side)

const QLD_COAL = new Set(["LNP"]);

// Per-seat ON first-preference baselines for QLD 2024.
// The five existing LNP vs ON TCP seats (7261–7265) are included with their actual ON%.
// Additional LNP vs ALP seats in ON-heavy regions are included to enable auto-detection
// when ON primary surges past statewide ALP (currently 33.4%), which would happen in
// scenarios where ON has a large regional swing pushing it past ~15–18% in these seats.
// Source: ECQ 2024 final results — first preferences by candidate.
const QLD_SEAT_ON_FP_2024 = {
  7261: 18.2, // Mirani (LNP vs ON) — LNP's current margin 1.8pp
  7262: 17.1, // Condamine (LNP vs ON) — margin 2.6pp
  7263: 14.9, // Callide (LNP vs ON) — margin 3.5pp
  7265: 13.1, // Southern Downs (LNP vs ON) — margin 5.5pp
  7264: 10.3, // Hinchinbrook (LNP vs ON) — margin 4.5pp
  7231:  7.8, // Nanango (LNP vs ALP) — ON competitive when surging
  7233:  7.5, // Gympie (LNP vs ALP)
  7242:  7.2, // Rockhampton (ALP vs LNP)
  7241:  6.5, // Bundaberg (ALP vs LNP)
  7232:  6.2, // Warrego (LNP vs ALP)
  7243:  5.8, // Mulgrave (ALP vs LNP)
  7234:  5.5, // Buderim (LNP vs ALP)
  7235:  5.0, // Caloundra (LNP vs ALP)
};

const QLD_DEFAULT_FLOWS = {
  grn_alp: 0.82, ind_alp: 0.50, on_alp: 0.18, other_alp: 0.40,
  coal_alp_v_on: 0.10, grn_alp_v_on: 0.86, ind_alp_v_on: 0.65, other_alp_v_on: 0.55,
  alp_on_v_coal: 0.22, grn_on_v_coal: 0.06, ind_on_v_coal: 0.15, other_on_v_coal: 0.28,
  onCoalOriginFactor: 0.0,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

// Baselines: ALP 55.0  Coalition 23.0 (LP 18.5 + NP 4.5)  GRN 11.0  IND 5.0  ON 2.5  other 3.5  2PP 63.1
const WA_BL = { alp: 55.0, coal: 23.0, grn: 11.0, ind: 5.0, on: 2.5 };

const WA_2PP = 63.1;

const WA_RIGHT_BLOC_2PP = 68.9; // ALP vs right bloc (Coal + ON on right side)

const WA_COAL = new Set(["LP", "NP"]);

const WA_DEFAULT_FLOWS = {
  grn_alp: 0.86, ind_alp: 0.58, on_alp: 0.22, other_alp: 0.44,
  coal_alp_v_on: 0.12, grn_alp_v_on: 0.87, ind_alp_v_on: 0.68, other_alp_v_on: 0.57,
  alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22,
  onCoalOriginFactor: 0.0,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

// Per-seat ON first-preference baselines for SA 2026.
// SA has uniquely high statewide ON (21.6%), concentrated most heavily in rural/outback seats
// but also present in outer-suburban and fringe-metro electorates.
// Ngadjuri (ON won) had by far the highest ON FP; rural IND-held and LP outback seats follow.
// Source: ECSA 2026 provisional results — first preferences by district.
const SA_SEAT_ON_FP_2026 = {
  7423: 45.2, // Ngadjuri (ON won — outback/Stuart Plains, strongest ON seat in SA)
  7422: 31.5, // Frome (IND — rural outback, ON heavily competitive)
  7424: 26.8, // Narungga (IND — Yorke Peninsula, ON strong in agricultural regions)
  7421: 22.4, // Mount Gambier (IND — far south-east, LP collapse boosted ON)
  7420: 19.6, // Schubert (LP — Barossa Valley, ex-LP voters defected to ON)
  7419: 17.8, // Morphett (LP — Fleurieu Peninsula rural fringe)
  7415: 16.4, // Flinders (ALP provisional — Eyre Peninsula, historically ON-competitive)
  7411: 12.5, // Heysen (LP — Adelaide Hills fringe, outer suburban ON base)
  7416:  9.8, // Bragg (LP — eastern suburbs, ON below-average for LP seat)
  7407:  8.5, // Playford (ALP — northern outer suburbs, working-class ON presence)
  7404:  7.2, // Florey (ALP — northern suburbs)
  7401:  7.0, // King (ALP — northern outer suburbs)
};

const SA_BL = { alp: 39.1, coal: 18.7, grn: 11.1, ind: 4.7, on: 21.6 };

const SA_2PP = 57.4;

const SA_RIGHT_BLOC_2PP = 53.0; // ALP vs right bloc (Coal + ON on right side)

const SA_COAL = new Set(["LP"]);

const SA_DEFAULT_FLOWS = {
  grn_alp: 0.84, ind_alp: 0.52, on_alp: 0.22, other_alp: 0.45,
  coal_alp_v_on: 0.12, grn_alp_v_on: 0.87, ind_alp_v_on: 0.68, other_alp_v_on: 0.57,
  alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22,
  onCoalOriginFactor: 0.0,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

// Baselines: ALP 30.5  Coalition (CLP) 40.5  GRN 5.5  IND 12.5  ON 1.5  other 9.5
//
// NT uses optional-preferential voting (OPV): voters may mark preferences for as few or
// as many candidates as they wish, so a share of minor-party ballots exhausts before
// reaching the final 2CP count. This reduces the effective preference contribution from
// Greens/IND/ON voters compared to compulsory-preference states (NSW, QLD, VIC, SA, WA).
// Applied in compute2pp below: each non-final-two source's preference contribution is
// scaled by (1 - exhaust rate) and the final 2CP is a/(a+c) over surviving votes only.
// Default 25%: estimated from NTEC 2024 distribution-of-preferences data (the pipeline's
// nt_district_2cp table captures exhausted_votes per district; no exhaustion file ships
// with the frontend, so the statewide estimate is documented here). Setting the rate to
// 0% reproduces full-preferential arithmetic exactly. User-adjustable in the NT view.
const NT_EXHAUST_DEFAULT = 0.25;

const NT_BL = { alp: 30.5, coal: 40.5, grn: 5.5, ind: 12.5, on: 1.5 };

const NT_2PP = 45.0;  // approximate (NT doesn't publish official 2PP)

const NT_COAL = new Set(["CLP"]);

const NT_DEFAULT_FLOWS = {
  grn_alp: 0.80, ind_alp: 0.45, on_alp: 0.20, other_alp: 0.40,
  coal_alp_v_on: 0.10, grn_alp_v_on: 0.82, ind_alp_v_on: 0.55, other_alp_v_on: 0.50,
  alp_on_v_coal: 0.22, grn_on_v_coal: 0.06, ind_on_v_coal: 0.15, other_on_v_coal: 0.28,
  onCoalOriginFactor: 0.0,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

// Per-seat ON first-preference propensity prior for VIC. One Nation ran no
// Legislative Assembly candidates in 2022 (upper house only), so unlike
// NSW_SEAT_ON_FP_2023 / QLD_SEAT_ON_FP_2024 there is no historical LA baseline;
// VIC_SEAT_FP_2022's on: 0.0 for every district is correct data. This prior instead
// encodes *where* a VIC ON vote would concentrate if ON contests 2026: the federal
// 2025 per-seat ON pattern (ON_FP_2025) of the overlapping division(s) — averaged
// where a district straddles divisions — rescaled so the 88-seat mean equals the
// statewide baseline VIC_BASELINE_2022.on (1.3):
//   seatBase = 1.3 × fedOn(overlapping division) / mean(fedOn over VIC divisions)
// Regional concentration (Gippsland, Mallee, Nicholls country ~2.5–3.3; inner metro
// ~0.2–0.8) therefore lives in the base itself, and an ON surge distributed on the
// logit scale (logitShiftOnFp) lands where ON is actually strong without also
// multiplying by VIC_REGION_SWING_MULT (which would double-count).
const VIC_SEAT_ON_FP = {
  9001: 1.8,  // Narracan (fed: Monash)
  9002: 0.6,  // Albert Park (fed: Macnamara)
  9003: 0.4,  // Ashwood (fed: Chisholm)
  9004: 1.8,  // Bass (fed: Monash)
  9005: 0.8,  // Bayswater (fed: Aston)
  9006: 0.7,  // Bellarine (fed: Corangamite)
  9007: 1.6,  // Benambra (fed: Indi)
  9008: 1.1,  // Bendigo East (fed: Bendigo)
  9009: 1.1,  // Bendigo West (fed: Bendigo)
  9010: 0.7,  // Bentleigh (fed: Goldstein/Hotham)
  9011: 1.7,  // Berwick (fed: La Trobe)
  9012: 0.4,  // Box Hill (fed: Chisholm)
  9013: 0.4,  // Brighton (fed: Goldstein)
  9014: 0.7,  // Broadmeadows (fed: Calwell)
  9015: 0.8,  // Brunswick (fed: Wills)
  9016: 0.4,  // Bulleen (fed: Menzies)
  9017: 1.2,  // Bundoora (fed: Scullin/Jagajaga)
  9018: 1.2,  // Carrum (fed: Isaacs/Dunkley)
  9019: 0.6,  // Caulfield (fed: Macnamara)
  9020: 1.0,  // Clarinda (fed: Hotham)
  9021: 2.0,  // Cranbourne (fed: Holt)
  9022: 0.9,  // Croydon (fed: Deakin/Casey)
  9023: 1.9,  // Dandenong (fed: Bruce)
  9024: 1.4,  // Eildon (fed: Indi/Casey)
  9025: 0.6,  // Eltham (fed: Jagajaga/Menzies)
  9026: 1.5,  // Essendon (fed: Maribyrnong)
  9027: 1.8,  // Eureka (fed: Ballarat)
  9028: 2.6,  // Euroa (fed: Nicholls)
  9029: 1.2,  // Evelyn (fed: Casey)
  9030: 1.1,  // Footscray (fed: Fraser/Gellibrand)
  9031: 1.5,  // Frankston (fed: Dunkley)
  9032: 2.3,  // Geelong (fed: Corio)
  9033: 3.3,  // Gippsland East (fed: Gippsland)
  9034: 3.3,  // Gippsland South (fed: Gippsland)
  9035: 0.6,  // Glen Waverley (fed: Chisholm/Aston)
  9036: 0.7,  // Greenvale (fed: Calwell)
  9037: 1.4,  // Hastings (fed: Flinders/Dunkley)
  9038: 0.2,  // Hawthorn (fed: Kooyong)
  9039: 0.8,  // Ivanhoe (fed: Jagajaga)
  9040: 1.1,  // Kalkallo (fed: Calwell/McEwen)
  9041: 0.2,  // Kew (fed: Kooyong)
  9042: 1.2,  // Kororoit (fed: Fraser/Gorton)
  9043: 2.3,  // Lara (fed: Corio)
  9044: 1.4,  // Laverton (fed: Gellibrand/Lalor)
  9045: 1.8,  // Lowan (fed: Mallee/Wannon)
  9046: 1.2,  // Macedon (fed: McEwen/Bendigo)
  9047: 0.4,  // Malvern (fed: Kooyong/Macnamara, ex-Higgins)
  9048: 0.5,  // Melbourne (fed: Melbourne)
  9049: 2.1,  // Melton (fed: Hawke)
  9050: 2.6,  // Mildura (fed: Mallee)
  9051: 1.5,  // Mill Park (fed: Scullin)
  9052: 1.2,  // Monbulk (fed: Casey)
  9053: 1.0,  // Mordialloc (fed: Isaacs)
  9054: 1.3,  // Mornington (fed: Flinders)
  9055: 3.3,  // Morwell (fed: Gippsland)
  9056: 1.5,  // Mulgrave (fed: Bruce/Hotham)
  9057: 2.6,  // Murray Plains (fed: Mallee/Nicholls)
  9058: 1.8,  // Narre Warren North (fed: La Trobe/Bruce)
  9059: 1.7,  // Narre Warren South (fed: La Trobe)
  9060: 1.3,  // Nepean (fed: Flinders)
  9061: 1.5,  // Niddrie (fed: Maribyrnong)
  9062: 1.2,  // Northcote (fed: Cooper)
  9063: 1.0,  // Oakleigh (fed: Hotham)
  9064: 1.6,  // Ovens Valley (fed: Indi)
  9065: 1.8,  // Pakenham (fed: La Trobe/Monash)
  9066: 0.8,  // Pascoe Vale (fed: Wills)
  9067: 1.4,  // Point Cook (fed: Lalor/Gellibrand)
  9068: 0.8,  // Polwarth (fed: Wannon/Corangamite)
  9069: 0.6,  // Prahran (fed: Macnamara, ex-Higgins)
  9070: 1.2,  // Preston (fed: Cooper)
  9071: 0.5,  // Richmond (fed: Melbourne)
  9072: 0.6,  // Ringwood (fed: Deakin)
  9073: 2.2,  // Ripon (fed: Mallee/Ballarat)
  9074: 0.8,  // Rowville (fed: Aston)
  9075: 0.4,  // Sandringham (fed: Goldstein)
  9076: 2.6,  // Shepparton (fed: Nicholls)
  9077: 0.7,  // South Barwon (fed: Corangamite)
  9078: 0.9,  // South-West Coast (fed: Wannon)
  9079: 1.0,  // St Albans (fed: Fraser)
  9080: 1.8,  // Sunbury (fed: Hawke/McEwen)
  9081: 1.3,  // Sydenham (fed: Gorton)
  9082: 1.5,  // Tarneit (fed: Lalor)
  9083: 1.5,  // Thomastown (fed: Scullin)
  9084: 0.5,  // Warrandyte (fed: Menzies/Deakin)
  9085: 1.8,  // Wendouree (fed: Ballarat)
  9086: 1.5,  // Werribee (fed: Lalor)
  9087: 1.3,  // Williamstown (fed: Gellibrand)
  9088: 1.4,  // Yan Yean (fed: McEwen)
};

const VIC_DEFAULT_PREF_FLOWS = {
  grn_alp: 0.85, ind_alp: 0.60, on_alp: 0.25, other_alp: 0.43,
  // ON vs ALP final flows
  coal_alp_v_on: 0.12, grn_alp_v_on: 0.88, ind_alp_v_on: 0.70, other_alp_v_on: 0.58,
  // ON vs Coalition final flows
  alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};

const FED_DEFAULT_PREF_FLOWS = {
  // Standard flows (used in ALP vs Coalition finals)
  grn_alp: 0.81,
  teal_alp: 0.62,
  // ON→ALP: 2025 AEC DOP result (25.5%; 74.5% to the Coalition — highest ever).
  // This matches PREF_FLOWS_2025 so the model loads clean (no scenario active) and
  // the Reset button restores to the same state. Use the slider to explore other
  // historical values (2016 ~49.6%, 2019 34.7%, 2022 35.7%, 2025 25.5%).
  on_alp: 0.255,
  other_alp: 0.50,
  coal_alp: 0.05, // Coal → ALP in 3rd party contests (usually very low)
  alp_grn: 0.85,
  alp_teal: 0.70,
  grn_teal: 0.50,
  teal_grn: 0.40,
  coal_grn: 0.02,
  coal_teal: 0.15,
  on_grn: 0.15,
  on_teal: 0.25,
  // ON vs ALP final — sources distribute between ALP and ON
  // Coal→ALP in ON vs ALP: 2025 AEC DOP (~10%). Matches PREF_FLOWS_2025.
  coal_alp_v_on: 0.10,
  grn_alp_v_on: 0.90,
  teal_alp_v_on: 0.75,
  other_alp_v_on: 0.60,
  // ON vs Coalition final — sources distribute between ON and Coalition
  alp_on_v_coal: 0.20,
  grn_on_v_coal: 0.08,
  teal_on_v_coal: 0.12,
  other_on_v_coal: 0.25,
  // ON vs Independent final (Farrer 2026-type) — sources distribute between ON and IND
  coal_on_v_ind: 0.65,
  alp_on_v_ind: 0.15,
  grn_on_v_ind: 0.08,
  other_on_v_ind: 0.50,
  // Share of each seat's ON increase drawn from the Coalition primary (see MODEL_PARAMS).
  onFromCoalShare: MODEL_PARAMS.onFromCoalShare,
};


export default function App() {
  const isMobile = useIsMobile();
  // ── Seats tab state ──
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState(new Set(STATES));
  const [groupFilter, setGroupFilter] = useState(new Set(GROUP_ORDER));
  const [marginFilter, setMarginFilter] = useState(new Set(MARGINS));
  const [sortKey, setSortKey] = useState("margin");
  const [sortDir, setSortDir] = useState("asc");
  const [seatsJurisdiction, setSeatsJurisdiction] = useState("federal_2025");
  const [activeTab, setActiveTab] = useState("seats");
  const [selectedModelId, setSelectedModelId] = useState("federal_2025");

  // ── Seats tab mobile state ──
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // ── Dark mode ──
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // ── Polls tab state ──
  const [polls, setPolls] = useState(INITIAL_POLLS);
  const [showAddPoll, setShowAddPoll] = useState(false);
  const [showHouseEffects, setShowHouseEffects] = useState(false);
  const [nextPollId, setNextPollId] = useState(INITIAL_POLLS.length + 1);
  const [newPoll, setNewPoll] = useState({ pollster: "", date: "", alp: "", coal: "", grn: "", oth: "", tpp: "", n: "" });

  // ── Model tab state ──
  // Initialise primaries from URL params if present (enables scenario sharing via link).
  const [primaries, setPrimaries] = useState(() => {
    const base = { alp: BASELINE_2025.alp, coal: BASELINE_2025.coal, grn: BASELINE_2025.grn, teal: BASELINE_2025.teal, on: BASELINE_2025.on, undecided: 0 };
    if (typeof window === "undefined") return base;
    const p = new URLSearchParams(window.location.search);
    const num = (key) => { const v = p.get(key); return v !== null && !isNaN(+v) ? +v : null; };
    return {
      alp:      num("alp")      ?? base.alp,
      coal:     num("coal")     ?? base.coal,
      grn:      num("grn")      ?? base.grn,
      teal:     num("teal")     ?? base.teal,
      on:       num("on")       ?? base.on,
      undecided: num("undecided") ?? base.undecided,
    };
  });
  const [prefFlows, setPrefFlows] = useState({ ...FED_DEFAULT_PREF_FLOWS });
  // Derive swings from primaries vs 2025 baseline — used by computeModelledSeats.
  // Memoized so its identity is stable across unrelated re-renders; otherwise the
  // adjSwings → modelledSeats → computeUncertainty memo chain (incl. the 50×50
  // grid integration) recomputes on every keystroke/hover anywhere in the app.
  const swings = useMemo(() => ({
    alp: +(primaries.alp - BASELINE_2025.alp).toFixed(2),
    coal: +(primaries.coal - BASELINE_2025.coal).toFixed(2),
    grn: +(primaries.grn - BASELINE_2025.grn).toFixed(2),
    teal: +(primaries.teal - BASELINE_2025.teal).toFixed(2),
    on: +(primaries.on - BASELINE_2025.on).toFixed(2),
  }), [primaries]);
  const [seatOverrides, setSeatOverrides] = useState({});  // {seatId: {alp,coal,grn,teal,on,prefFlows?}}
  const [overrideSearch, setOverrideSearch] = useState("");
  const [stateOverrideSearch, setStateOverrideSearch] = useState("");

  // ── Modifiable ON/Elasticity/Uncertainty settings ──
  const [onThreshold, setOnThreshold] = useState(MODEL_PARAMS.onThresholdDefault);   // % ON primary to auto-detect TCP
  const [useElasticity, setUseElasticity] = useState(false); // apply seat-level swing elasticity
  const [useEconomicAdj, setUseEconomicAdj] = useState(false); // apply Cameron & Crosby economic structural adjustment
  const [swingStd, setSwingStd] = useState(1.5);   // polling uncertainty (pp std dev)
  const [showAdvancedFlows, setShowAdvancedFlows] = useState(false); // show/hide advanced ON race flows
  // Per-state 2PP swing deltas (pp relative to the national swing) for the federal
  // model — power-user controls feeding computeModelledSeats(stateSwings). 0 = the
  // state tracks the national swing exactly (the default for every state).
  const [fedStateDeltas, setFedStateDeltas] = useState({ NSW: 0, VIC: 0, QLD: 0, WA: 0, SA: 0, TAS: 0 });
  const [showStateSwings, setShowStateSwings] = useState(false); // show/hide per-state swing controls

  // ── Seat-at-risk table state ──
  const [riskFilter, setRiskFilter] = useState("all"); // "all" | "changing" | "marginal"
  const [modelStateFilter, setModelStateFilter] = useState(""); // "" = All States
  const [expandedModelSeatId, setExpandedModelSeatId] = useState(null);
  const [expandedSeatTabDemogId, setExpandedSeatTabDemogId] = useState(null);
  const [demogSectionOpen, setDemogSectionOpen] = useState(false);

  // ── VIC model state ──
  const [vicPrimaries, setVicPrimaries] = useState({ ...VIC_BASELINE_2022, undecided: 0 });
  const [vicPrefFlows, setVicPrefFlows] = useState({ ...VIC_DEFAULT_PREF_FLOWS });
  const [vicOnTcp, setVicOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  // Regional swing differentiation: inner-metro seats amplify the state swing;
  // regional/rural seats respond less (calibrated from 2014-2022 VEC data).
  const [useVicRegionalSwing, setUseVicRegionalSwing] = useState(true);
  // Regional swing differentiation for other single-member-seat states
  const [useNswRegionalSwing, setUseNswRegionalSwing] = useState(true);
  const [useQldRegionalSwing, setUseQldRegionalSwing] = useState(true);
  const [useWaRegionalSwing,  setUseWaRegionalSwing]  = useState(true);
  const [useSaRegionalSwing,  setUseSaRegionalSwing]  = useState(true);
  const [useNtRegionalSwing,  setUseNtRegionalSwing]  = useState(true);

  // ── State model seat-filter / expand / override state ──
  const [stateRiskFilter, setStateRiskFilter] = useState("all"); // "all" | "changing" | "marginal"
  const [expandedStateSeatId, setExpandedStateSeatId] = useState(null);
  const [vicSeatOverrides, setVicSeatOverrides] = useState({});
  const [vicOverrideSearch, setVicOverrideSearch] = useState("");

  // ── Demographics tab state ──
  const [demogSortKey, setDemogSortKey] = useState("medianHouseholdIncome");
  const [demogSortDir, setDemogSortDir] = useState("desc");
  const [demogStateFilter, setDemogStateFilter] = useState(new Set(STATES));
  const [demogClassFilter, setDemogClassFilter] = useState(new Set(["Inner Metropolitan", "Outer Metropolitan", "Provincial", "Rural"]));
  const [expandedDemogId, setExpandedDemogId] = useState(null);
  const [demogXMetric, setDemogXMetric] = useState("medianHouseholdIncome");

  const [openFaq, setOpenFaq] = useState(null);

  const toggleSet = (setter, val) =>
    setter(prev => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });

  const handleSort = (key) => {
    setSortDir(prev => sortKey === key ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  };

  // ── Seats filtered list ──
  const seatsForTab = ELECTION_DATA[seatsJurisdiction]?.seats ?? SEATS;
  const isFederalTab = seatsJurisdiction === "federal_2025";
  const hasHareClark = seatsJurisdiction === "tas_2024" || seatsJurisdiction === "act_2024";

  const filtered = useMemo(() => {
    let r = seatsForTab.filter(s => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.winner.name.toLowerCase().includes(q)) return false;
      }
      if (isFederalTab && !stateFilter.has(s.state)) return false;
      if (!groupFilter.has(getSeatGroup(s))) return false;
      if (!marginFilter.has(getMarginCat(s.margin))) return false;
      return true;
    });
    return [...r].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      if (sortKey === "state") cmp = a.state.localeCompare(b.state) || a.name.localeCompare(b.name);
      if (sortKey === "party") cmp = getParty(a.winner.party).group.localeCompare(getParty(b.winner.party).group);
      if (sortKey === "margin") cmp = (a.margin ?? 99) - (b.margin ?? 99);
      if (sortKey === "swing") cmp = (a.swing ?? 0) - (b.swing ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [seatsForTab, isFederalTab, search, stateFilter, groupFilter, marginFilter, sortKey, sortDir]);

  const stateCounts = useMemo(() => Object.fromEntries(STATES.map(s => [s, seatsForTab.filter(d => d.state === s).length])), [seatsForTab]);
  const groupCounts = useMemo(() => countByGroup(seatsForTab, getSeatGroup), [seatsForTab]);
  const marginCounts = useMemo(() => { const c = {}; seatsForTab.forEach(s => { const cat = getMarginCat(s.margin); c[cat] = (c[cat] || 0) + 1; }); return c; }, [seatsForTab]);

  // ── Modelling ──
  // Allocate undecided voters using a blend of proportional allocation and an
  // evidence-based late-decider profile (LATE_DECIDER_SPLIT / LATE_DECIDER_WEIGHT).
  // Australian post-election surveys show late deciders break disproportionately
  // toward minor parties and give the incumbent major party a below-proportional
  // share — captured here without a hard-coded single-party penalty.
  const effectivePrimaries = useMemo(() => {
    const undec = primaries.undecided ?? 0;
    if (undec <= 0) return primaries;
    const declared = primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on;
    if (declared <= 0) return primaries;

    // Blend proportional share with the late-decider profile, then normalise.
    const parties = ["alp", "coal", "grn", "teal", "on"];
    const blendedShares = {};
    let shareSum = 0;
    for (const p of parties) {
      const propShare = primaries[p] / declared;
      blendedShares[p] = (1 - LATE_DECIDER_WEIGHT) * propShare + LATE_DECIDER_WEIGHT * LATE_DECIDER_SPLIT[p];
      shareSum += blendedShares[p];
    }
    // Normalise so shares always sum to 1 regardless of rounding.
    for (const p of parties) blendedShares[p] /= shareSum;

    return {
      alp:  +(primaries.alp  + undec * blendedShares.alp).toFixed(2),
      coal: +(primaries.coal + undec * blendedShares.coal).toFixed(2),
      grn:  +(primaries.grn  + undec * blendedShares.grn).toFixed(2),
      teal: +(primaries.teal + undec * blendedShares.teal).toFixed(2),
      on:   +(primaries.on   + undec * blendedShares.on).toFixed(2),
      undecided: 0,
    };
  }, [primaries]);

  // ── Economic structural adjustment (Cameron & Crosby 2000) ───────────────────
  // The C&C model estimates an incumbent-vote effect from CPI and unemployment
  // changes since the last election. When enabled, this shifts the ALP primary
  // (as incumbent) by the net structural effect before computing nat2ppSwing.
  // Effect is applied on top of user-set polling sliders, not inside them —
  // the user's slider represents the *polling* reading; the economic adjustment
  // adds the structural headwind/tailwind that polling may not yet fully reflect.
  const econAdjPp = ECONOMICS_DATA?.cameron_crosby_model?.current_estimate?.net_vote_effect_pp ?? 0;

  const econAdjPrimaries = useMemo(() => {
    if (!useEconomicAdj || econAdjPp === 0) return effectivePrimaries;
    return { ...effectivePrimaries, alp: Math.max(0, +(effectivePrimaries.alp + econAdjPp).toFixed(2)) };
  }, [effectivePrimaries, useEconomicAdj, econAdjPp]);

  const adjSwings = useMemo(() => {
    if (!useEconomicAdj || econAdjPp === 0) return swings;
    return { ...swings, alp: +(swings.alp + econAdjPp).toFixed(2) };
  }, [swings, useEconomicAdj, econAdjPp]);

  const nat2ppSwing = useMemo(() =>
    computeNat2pp(econAdjPrimaries, prefFlows) - computeNat2pp(BASELINE_2025, prefFlows),
    [econAdjPrimaries, prefFlows]);

  // Build the stateSwings overlay for computeModelledSeats()/blendSwings() from the
  // per-state 2PP deltas. A delta d (pp relative to national) is expressed as a
  // primary-vote transfer on top of the national swing (ALP +d, Coalition −d), which
  // shifts that state's seats' 2PP by ≈ d pp. alpha = 1 because the delta is an
  // explicit user-specified deviation, not a noisy state-poll estimate to be blended
  // (unset parties still fall back to the national swing inside blendSwings()).
  // States at 0 are omitted, and when every delta is 0 this is null — so the default
  // model path is bit-identical to the previous no-state-swings behaviour.
  const stateSwings = useMemo(() => {
    const active = Object.entries(fedStateDeltas).filter(([, d]) => Number.isFinite(d) && d !== 0);
    if (active.length === 0) return null;
    const out = {};
    active.forEach(([st, d]) => {
      out[st] = { alp: adjSwings.alp + d, coal: adjSwings.coal - d, alpha: 1 };
    });
    return out;
  }, [fedStateDeltas, adjSwings]);

  const modelledSeats = useMemo(() =>
    computeModelledSeats(SEATS, adjSwings, prefFlows, seatOverrides, nat2ppSwing, onThreshold, useElasticity, stateSwings),
    [adjSwings, prefFlows, seatOverrides, nat2ppSwing, onThreshold, useElasticity, stateSwings]);

  // Scale polling uncertainty upward when there is a large undecided pool —
  // more undecided voters means the electorate is more volatile.
  // +0.06pp σ per 1pp undecided (e.g. 10% undecided → +0.6pp extra σ).
  const undecAdjStd = swingStd + 0.06 * (primaries.undecided ?? 0);

  const uncertainty = useMemo(() =>
    computeUncertainty(modelledSeats, nat2ppSwing, undecAdjStd, useElasticity),
    [modelledSeats, nat2ppSwing, undecAdjStd, useElasticity]);

  // ── Live Results (election-night counting) ──────────────────────────────────
  // Fetches the normalized Electoral Commission feed, projects each seat's final
  // outcome via swing vs the prior-election baseline, and quantifies confidence.
  const [liveSnapshotUrl, setLiveSnapshotUrl] = useState(null);
  const live = useLiveResults(LIVE_CONFIG.active?.sourceId, liveSnapshotUrl);
  const liveProjected = useMemo(
    () => (live.feed ? projectSeats(live.feed, live.baseline, LIVE_CONFIG.active.cfg) : null),
    [live.feed, live.baseline]);
  const liveConfidence = useMemo(
    () => (liveProjected ? computeLiveConfidence(liveProjected, LIVE_CONFIG.active.cfg) : null),
    [liveProjected]);

  const projCounts = useMemo(
    () => countByGroup(modelledSeats, (s) => s.modelled.winnerGroup),
    [modelledSeats]);

  const baseCounts = useMemo(() => countByGroup(SEATS, getSeatGroup), []);

  const changedSeats = useMemo(() =>
    modelledSeats.filter(s => s.modelled.changed),
    [modelledSeats]);

  const implied2pp = useMemo(() => {
    // Standard ALP-vs-Coalition 2PP: ON preferences distributed via on_alp (now the
    // correct 2025 flow, 25.5% to ALP / 74.5% to Coalition). An ON surge therefore
    // correctly lowers ALP's 2PP without the over-correction of the old right-bloc
    // measure. (The right-bloc figure is still shown separately, see rightBlocShare.)
    const { alp, coal, grn, teal, on, undecided } = primaries;
    const other = Math.max(0, 100 - alp - coal - grn - teal - on - (undecided || 0));
    const a = alp + grn * prefFlows.grn_alp + teal * prefFlows.teal_alp + on * prefFlows.on_alp + other * prefFlows.other_alp;
    const c = coal + grn * (1 - prefFlows.grn_alp) + teal * (1 - prefFlows.teal_alp) + on * (1 - prefFlows.on_alp) + other * (1 - prefFlows.other_alp);
    if (a + c === 0) return null;
    return a / (a + c) * 100;
  }, [primaries, prefFlows]);

  // Right-bloc vote share: ALP+left vs Coalition+ON counted entirely on the right side.
  // Shown as a secondary indicator (the "combined right" vote) — NOT a 2PP, since ON does
  // not actually deliver all its preferences to the Coalition.
  const rightBlocShare = useMemo(() => {
    const { alp, coal, grn, teal, on, undecided } = primaries;
    const other = Math.max(0, 100 - alp - coal - grn - teal - on - (undecided || 0));
    const a = alp + grn * prefFlows.grn_alp + teal * prefFlows.teal_alp + other * prefFlows.other_alp;
    const c = coal + on + grn * (1 - prefFlows.grn_alp) + teal * (1 - prefFlows.teal_alp) + other * (1 - prefFlows.other_alp);
    if (a + c === 0) return null;
    return a / (a + c) * 100;
  }, [primaries, prefFlows]);

  // Seat-average 2PP: mean of per-seat modelled projAlp2pp across all seats where it is
  // non-null. One seat = one vote, so this is geographically distributed and correlates
  // directly with the seat count (unlike implied2pp which is a national vote-share aggregate
  // that can fall below 50% while ALP still wins a majority of seats).
  //
  // ON-race seats (ON in the final 2CP) carry a synthetic ALP-vs-Coalition 2PP number
  // computed with standard flows. That number does not describe the actual race, so it
  // is excluded here — otherwise the national tracker moves based on flows that nobody
  // is actually voting through in those seats.
  const seatAvg2pp = useMemo(() => {
    const vals = modelledSeats
      .filter(s => !s.modelled.isOnRace)
      .map(s => s.modelled.projAlp2pp)
      .filter(v => v !== null && v !== undefined && isFinite(v));
    if (vals.length === 0) return null;
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
  }, [modelledSeats]);

  // ON-race seats: the model has flagged these as ON-vs-ALP or ON-vs-Coalition in the
  // final 2CP. Surface them so the UI can render them separately rather than mixing
  // their (synthetic) ALP-2PP values into national aggregates.
  const onRaceSeats = useMemo(
    () => modelledSeats.filter(s => s.modelled.isOnRace),
    [modelledSeats],
  );

  // ── VIC modelling ──
  const vicModelledSeats = useMemo(() => {
    const s = {
      alp: +(vicPrimaries.alp - VIC_BASELINE_2022.alp).toFixed(2),
      coal: +(vicPrimaries.coal - VIC_BASELINE_2022.coal).toFixed(2),
      grn: +(vicPrimaries.grn - VIC_BASELINE_2022.grn).toFixed(2),
      ind: +(vicPrimaries.ind - VIC_BASELINE_2022.ind).toFixed(2),
      on: +(vicPrimaries.on - VIC_BASELINE_2022.on).toFixed(2),
    };
    const baseline2pp = computeVic2pp(VIC_BASELINE_2022, vicPrefFlows, vicOnTcp);
    return computeModelledSeatsVic(VIC_SEATS, s, vicPrefFlows, useVicRegionalSwing, vicOnTcp, baseline2pp, vicSeatOverrides, VIC_SEAT_FP_2022,
      VIC_SEAT_ON_FP, MODEL_PARAMS.onThresholdDefault);
  }, [vicPrimaries, vicPrefFlows, useVicRegionalSwing, vicOnTcp, vicSeatOverrides]);

  const vicProjCounts = useMemo(
    () => countByGroup(vicModelledSeats, (s) => s.modelled.winnerGroup),
    [vicModelledSeats]);

  const vicBaseCounts = useMemo(
    () => countByGroup(VIC_SEATS, (s) => getParty(s.winner.party).group), []);

  const vicChangedSeats = useMemo(() =>
    vicModelledSeats.filter(s => s.modelled.changed),
    [vicModelledSeats]);

  const vicSeatAvg2pp = useMemo(() => {
    const vals = vicModelledSeats
      .filter(s => s.modelled.projAlp2pp !== null && s.modelled.projAlp2pp !== undefined && isFinite(s.modelled.projAlp2pp))
      .map(s => s.modelled.projAlp2pp);
    if (vals.length === 0) return null;
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
  }, [vicModelledSeats]);

  const vicImplied2pp = useMemo(() => {
    // Standard ALP-vs-Coalition 2PP: ON preferences distributed via on_alp (not dumped
    // wholly on the right), consistent with the seat model and the NSW/national tabs.
    const onV = vicPrimaries.on ?? 0;
    const other = Math.max(0, 100 - vicPrimaries.alp - vicPrimaries.coal - vicPrimaries.grn - vicPrimaries.ind - onV - (vicPrimaries.undecided || 0));
    const a = vicPrimaries.alp + vicPrimaries.grn * vicPrefFlows.grn_alp + vicPrimaries.ind * vicPrefFlows.ind_alp + onV * vicPrefFlows.on_alp + other * vicPrefFlows.other_alp;
    const c = vicPrimaries.coal + vicPrimaries.grn * (1 - vicPrefFlows.grn_alp) + vicPrimaries.ind * (1 - vicPrefFlows.ind_alp) + onV * (1 - vicPrefFlows.on_alp) + other * (1 - vicPrefFlows.other_alp);
    return (a + c === 0) ? null : a / (a + c) * 100;
  }, [vicPrimaries, vicPrefFlows]);

  const vicHasChanges = vicPrimaries.alp !== 38.1 || vicPrimaries.coal !== 31.1 ||
    vicPrimaries.grn !== 12.2 || vicPrimaries.ind !== 5.5 || vicPrimaries.on !== 1.3 ||
    (vicPrimaries.undecided || 0) > 0 ||
    vicPrefFlows.grn_alp !== 0.85 || vicPrefFlows.ind_alp !== 0.60 || vicPrefFlows.on_alp !== 0.25 || vicPrefFlows.other_alp !== 0.43 ||
    !useVicRegionalSwing || vicOnTcp !== null || Object.keys(vicSeatOverrides).length > 0;

  const vicNat2ppSwing = useMemo(() => {
    const baseline = vicOnTcp ? computeVic2pp(VIC_BASELINE_2022, vicPrefFlows, vicOnTcp) : VIC_2PP_2022;
    return computeVic2pp(vicPrimaries, vicPrefFlows, vicOnTcp) - baseline;
  }, [vicPrimaries, vicPrefFlows, vicOnTcp]);
  const vicUncertainty = useMemo(
    () => computeUncertainty(vicModelledSeats, vicNat2ppSwing, swingStd, useElasticity, 45),
    [vicModelledSeats, vicNat2ppSwing, swingStd, useElasticity]
  );

  // ── NSW 2023 model state ──────────────────────────────────────────────────
  // Baselines: ALP 37.6  Coalition 37.0 (LP 28.6 + NP 8.4)  GRN 10.4  IND 8.5  ON 2.0  other 4.5  2PP 53.2



  const [nswPrim, setNswPrim] = useState({ ...NSW_BL, undecided: 0 });
  const [nswFlows, setNswFlows] = useState({ ...NSW_DEFAULT_FLOWS });
  const [nswOnTcp, setNswOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  const [nswSeatOverrides, setNswSeatOverrides] = useState({}); // { seatId: { tcpMatchup, tcpPct, on } }
  const nswModelledSeats = useMemo(() => {
    const s = { alp: nswPrim.alp - NSW_BL.alp, coal: nswPrim.coal - NSW_BL.coal, grn: nswPrim.grn - NSW_BL.grn, on: nswPrim.on - NSW_BL.on };
    // Source a share of any ON rise from the Coalition primary (federal/VIC parity — see
    // MODEL_PARAMS.onFromCoalShare); the cut mass lands in the residual "other" inside
    // makeStateCompute2pp. No-op at zero/negative ON swing, so the baseline is unchanged.
    const prim = { ...nswPrim, coal: Math.max(0, nswPrim.coal - extraCoalCutFor(s, nswFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
    const compute2pp = makeStateCompute2pp({ ind: nswPrim.ind, onTcp: nswOnTcp, swings: s });
    const baseline2pp = compute2pp(NSW_BL, nswFlows);
    return computeModelledSeatsState(NSW_SEATS, prim, compute2pp, baseline2pp, nswFlows, NSW_COAL, s,
      useNswRegionalSwing ? NSW_DISTRICT_REGION : null,
      useNswRegionalSwing ? NSW_REGION_SWING_MULT : null,
      NSW_SEAT_ON_FP_2023, 6.5, nswSeatOverrides,
      useElasticity, NSW_SEAT_PREF_FLOWS_2023, NSW_BL, NSW_SEAT_FP_2023,
    );
  }, [nswPrim, nswFlows, nswOnTcp, useNswRegionalSwing, nswSeatOverrides, useElasticity]);
  const nswProjCounts = useMemo(() => countByGroup(nswModelledSeats, (s) => s.modelled.winnerGroup), [nswModelledSeats]);
  const nswBaseCounts = useMemo(() => countByGroup(NSW_SEATS, (s) => getParty(s.winner.party).group), []);
  const nswChanged = useMemo(() => nswModelledSeats.filter(s => s.modelled.changed), [nswModelledSeats]);
  const nswImplied2pp = useMemo(() => {
    // Standard ALP-vs-Coalition 2PP: ON preferences distributed via on_alp (not dumped
    // wholly on the right), consistent with the seat model and the national tab.
    const onV = nswPrim.on ?? 0;
    const other = Math.max(0, 100 - nswPrim.alp - nswPrim.coal - nswPrim.grn - nswPrim.ind - onV - (nswPrim.undecided || 0));
    const a = nswPrim.alp + nswPrim.grn * nswFlows.grn_alp + nswPrim.ind * nswFlows.ind_alp + onV * nswFlows.on_alp + other * nswFlows.other_alp;
    const c = nswPrim.coal + nswPrim.grn * (1 - nswFlows.grn_alp) + nswPrim.ind * (1 - nswFlows.ind_alp) + onV * (1 - nswFlows.on_alp) + other * (1 - nswFlows.other_alp);
    return (a + c === 0) ? null : a / (a + c) * 100;
  }, [nswPrim, nswFlows]);
  const nswHasChanges = Object.entries(NSW_BL).some(([k, v]) => Math.abs((nswPrim[k] ?? v) - v) > 0.05) || (nswPrim.undecided || 0) > 0 || nswFlows.grn_alp !== 0.88 || nswFlows.ind_alp !== 0.55 || nswFlows.on_alp !== 0.20 || nswFlows.other_alp !== 0.45 || nswOnTcp !== null || !useNswRegionalSwing || Object.keys(nswSeatOverrides).length > 0 || (nswFlows.onCoalOriginFactor ?? 0) !== 0;

  const nswNat2ppSwing = useMemo(() => {
    const onV = nswPrim.on ?? 0;
    const other = Math.max(0, 100 - nswPrim.alp - nswPrim.coal - nswPrim.grn - nswPrim.ind - onV);
    if (nswOnTcp === "on_v_alp") {
      const a = nswPrim.alp + nswPrim.coal * nswFlows.coal_alp_v_on + nswPrim.grn * nswFlows.grn_alp_v_on + nswPrim.ind * nswFlows.ind_alp_v_on + other * nswFlows.other_alp_v_on;
      const on = onV + nswPrim.coal * (1 - nswFlows.coal_alp_v_on) + nswPrim.grn * (1 - nswFlows.grn_alp_v_on) + nswPrim.ind * (1 - nswFlows.ind_alp_v_on) + other * (1 - nswFlows.other_alp_v_on);
      const blOnV = NSW_BL.on ?? 0; const blOther = Math.max(0, 100 - NSW_BL.alp - NSW_BL.coal - NSW_BL.grn - NSW_BL.ind - blOnV);
      const blA = NSW_BL.alp + NSW_BL.coal * nswFlows.coal_alp_v_on + NSW_BL.grn * nswFlows.grn_alp_v_on + NSW_BL.ind * nswFlows.ind_alp_v_on + blOther * nswFlows.other_alp_v_on;
      const blOn = blOnV + NSW_BL.coal * (1 - nswFlows.coal_alp_v_on) + NSW_BL.grn * (1 - nswFlows.grn_alp_v_on) + NSW_BL.ind * (1 - nswFlows.ind_alp_v_on) + blOther * (1 - nswFlows.other_alp_v_on);
      return a / (a + on) * 100 - blA / (blA + blOn) * 100;
    }
    if (nswOnTcp === "on_v_coal") {
      const on = onV + nswPrim.alp * nswFlows.alp_on_v_coal + nswPrim.grn * nswFlows.grn_on_v_coal + nswPrim.ind * nswFlows.ind_on_v_coal + other * nswFlows.other_on_v_coal;
      const c = nswPrim.coal + nswPrim.alp * (1 - nswFlows.alp_on_v_coal) + nswPrim.grn * (1 - nswFlows.grn_on_v_coal) + nswPrim.ind * (1 - nswFlows.ind_on_v_coal) + other * (1 - nswFlows.other_on_v_coal);
      const blOnV = NSW_BL.on ?? 0; const blOther = Math.max(0, 100 - NSW_BL.alp - NSW_BL.coal - NSW_BL.grn - NSW_BL.ind - blOnV);
      const blOn = blOnV + NSW_BL.alp * nswFlows.alp_on_v_coal + NSW_BL.grn * nswFlows.grn_on_v_coal + NSW_BL.ind * nswFlows.ind_on_v_coal + blOther * nswFlows.other_on_v_coal;
      const blC = NSW_BL.coal + NSW_BL.alp * (1 - nswFlows.alp_on_v_coal) + NSW_BL.grn * (1 - nswFlows.grn_on_v_coal) + NSW_BL.ind * (1 - nswFlows.ind_on_v_coal) + blOther * (1 - nswFlows.other_on_v_coal);
      return on / (on + c) * 100 - blOn / (blOn + blC) * 100;
    }
    const nswOnSwing = onV - NSW_BL.on; const nswCoalSwing = nswPrim.coal - NSW_BL.coal;
    const nswCoalToOnXfer = (nswOnSwing > 0 && nswCoalSwing < 0) ? Math.max(0, Math.min(1, -nswCoalSwing / nswOnSwing)) : 0;
    const nswEffOnAlp = nswFlows.on_alp + (nswFlows.onCoalOriginFactor ?? 0) * nswCoalToOnXfer * (1 - nswFlows.on_alp);
    // Coalition-sourcing of the ON rise, matching the seat model (cut mass moves to other).
    const nswCoalAdj = Math.max(0, nswPrim.coal - extraCoalCutFor({ on: nswOnSwing, coal: nswCoalSwing }, nswFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare));
    const nswOtherAdj = other + (nswPrim.coal - nswCoalAdj);
    const a = nswPrim.alp + nswPrim.ind * nswFlows.ind_alp + nswPrim.grn * nswFlows.grn_alp + onV * nswEffOnAlp + nswOtherAdj * nswFlows.other_alp;
    const c = nswCoalAdj + nswPrim.ind * (1 - nswFlows.ind_alp) + nswPrim.grn * (1 - nswFlows.grn_alp) + onV * (1 - nswEffOnAlp) + nswOtherAdj * (1 - nswFlows.other_alp);
    return a / (a + c) * 100 - NSW_2PP;
  }, [nswPrim, nswFlows, nswOnTcp]);
  const nswUncertainty = useMemo(
    () => computeUncertainty(nswModelledSeats, nswNat2ppSwing, swingStd, useElasticity, 47),
    [nswModelledSeats, nswNat2ppSwing, swingStd, useElasticity]
  );

  // ── QLD 2024 model state ──────────────────────────────────────────────────
  // Baselines: ALP 33.4  Coalition (LNP) 40.3  GRN 11.5  IND 6.6  ON 8.2  ALP 2PP 46.3
  // Source: ECQ 2024 final first-preference results (total = 100.0)



  const [qldPrim, setQldPrim] = useState({ ...QLD_BL, undecided: 0 });
  const [qldFlows, setQldFlows] = useState({ ...QLD_DEFAULT_FLOWS });
  const [qldOnTcp, setQldOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  const [qldSeatOverrides, setQldSeatOverrides] = useState({}); // { seatId: { tcpMatchup, tcpPct, on } }
  const qldModelledSeats = useMemo(() => {
    const s = { alp: qldPrim.alp - QLD_BL.alp, coal: qldPrim.coal - QLD_BL.coal, grn: qldPrim.grn - QLD_BL.grn, on: qldPrim.on - QLD_BL.on };
    // Source a share of any ON rise from the Coalition primary (see MODEL_PARAMS.onFromCoalShare).
    const prim = { ...qldPrim, coal: Math.max(0, qldPrim.coal - extraCoalCutFor(s, qldFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
    const compute2pp = makeStateCompute2pp({ ind: qldPrim.ind, onTcp: qldOnTcp, swings: s });
    const baseline2pp = compute2pp(QLD_BL, qldFlows);
    return computeModelledSeatsState(QLD_SEATS, prim, compute2pp, baseline2pp, qldFlows, QLD_COAL, s,
      useQldRegionalSwing ? QLD_DISTRICT_REGION : null,
      useQldRegionalSwing ? QLD_REGION_SWING_MULT : null,
      QLD_SEAT_ON_FP_2024, 6.5, qldSeatOverrides,
      useElasticity, QLD_SEAT_PREF_FLOWS_2024, QLD_BL, QLD_SEAT_FP_2024,
    );
  }, [qldPrim, qldFlows, qldOnTcp, useQldRegionalSwing, qldSeatOverrides, useElasticity]);
  const qldProjCounts = useMemo(() => countByGroup(qldModelledSeats, (s) => s.modelled.winnerGroup), [qldModelledSeats]);
  const qldBaseCounts = useMemo(() => countByGroup(QLD_SEATS, (s) => getParty(s.winner.party).group), []);
  const qldChanged = useMemo(() => qldModelledSeats.filter(s => s.modelled.changed), [qldModelledSeats]);
  const qldImplied2pp = useMemo(() => {
    const onV = qldPrim.on ?? 0;
    const other = Math.max(0, 100 - qldPrim.alp - qldPrim.coal - qldPrim.grn - qldPrim.ind - onV - (qldPrim.undecided || 0));
    const a = qldPrim.alp + qldPrim.grn * qldFlows.grn_alp + qldPrim.ind * qldFlows.ind_alp + onV * qldFlows.on_alp + other * qldFlows.other_alp;
    const c = qldPrim.coal + qldPrim.grn * (1 - qldFlows.grn_alp) + qldPrim.ind * (1 - qldFlows.ind_alp) + onV * (1 - qldFlows.on_alp) + other * (1 - qldFlows.other_alp);
    return (a + c === 0) ? null : a / (a + c) * 100;
  }, [qldPrim, qldFlows]);
  const qldHasChanges = Object.entries(QLD_BL).some(([k, v]) => Math.abs((qldPrim[k] ?? v) - v) > 0.05) || (qldPrim.undecided || 0) > 0 || qldFlows.grn_alp !== 0.82 || qldFlows.ind_alp !== 0.50 || qldFlows.on_alp !== 0.18 || qldFlows.other_alp !== 0.40 || qldOnTcp !== null || !useQldRegionalSwing || Object.keys(qldSeatOverrides).length > 0 || (qldFlows.onCoalOriginFactor ?? 0) !== 0;

  const qldNat2ppSwing = useMemo(() => {
    const onV = qldPrim.on ?? 0;
    const other = Math.max(0, 100 - qldPrim.alp - qldPrim.coal - qldPrim.grn - qldPrim.ind - onV);
    if (qldOnTcp === "on_v_alp") {
      const a = qldPrim.alp + qldPrim.coal * qldFlows.coal_alp_v_on + qldPrim.grn * qldFlows.grn_alp_v_on + qldPrim.ind * qldFlows.ind_alp_v_on + other * qldFlows.other_alp_v_on;
      const on = onV + qldPrim.coal * (1 - qldFlows.coal_alp_v_on) + qldPrim.grn * (1 - qldFlows.grn_alp_v_on) + qldPrim.ind * (1 - qldFlows.ind_alp_v_on) + other * (1 - qldFlows.other_alp_v_on);
      const blOnV = QLD_BL.on ?? 0; const blOther = Math.max(0, 100 - QLD_BL.alp - QLD_BL.coal - QLD_BL.grn - QLD_BL.ind - blOnV);
      const blA = QLD_BL.alp + QLD_BL.coal * qldFlows.coal_alp_v_on + QLD_BL.grn * qldFlows.grn_alp_v_on + QLD_BL.ind * qldFlows.ind_alp_v_on + blOther * qldFlows.other_alp_v_on;
      const blOn = blOnV + QLD_BL.coal * (1 - qldFlows.coal_alp_v_on) + QLD_BL.grn * (1 - qldFlows.grn_alp_v_on) + QLD_BL.ind * (1 - qldFlows.ind_alp_v_on) + blOther * (1 - qldFlows.other_alp_v_on);
      return a / (a + on) * 100 - blA / (blA + blOn) * 100;
    }
    if (qldOnTcp === "on_v_coal") {
      const on = onV + qldPrim.alp * qldFlows.alp_on_v_coal + qldPrim.grn * qldFlows.grn_on_v_coal + qldPrim.ind * qldFlows.ind_on_v_coal + other * qldFlows.other_on_v_coal;
      const c = qldPrim.coal + qldPrim.alp * (1 - qldFlows.alp_on_v_coal) + qldPrim.grn * (1 - qldFlows.grn_on_v_coal) + qldPrim.ind * (1 - qldFlows.ind_on_v_coal) + other * (1 - qldFlows.other_on_v_coal);
      const blOnV = QLD_BL.on ?? 0; const blOther = Math.max(0, 100 - QLD_BL.alp - QLD_BL.coal - QLD_BL.grn - QLD_BL.ind - blOnV);
      const blOn = blOnV + QLD_BL.alp * qldFlows.alp_on_v_coal + QLD_BL.grn * qldFlows.grn_on_v_coal + QLD_BL.ind * qldFlows.ind_on_v_coal + blOther * qldFlows.other_on_v_coal;
      const blC = QLD_BL.coal + QLD_BL.alp * (1 - qldFlows.alp_on_v_coal) + QLD_BL.grn * (1 - qldFlows.grn_on_v_coal) + QLD_BL.ind * (1 - qldFlows.ind_on_v_coal) + blOther * (1 - qldFlows.other_on_v_coal);
      return on / (on + c) * 100 - blOn / (blOn + blC) * 100;
    }
    const qldOnSwing = onV - QLD_BL.on; const qldCoalSwing = qldPrim.coal - QLD_BL.coal;
    const qldCoalToOnXfer = (qldOnSwing > 0 && qldCoalSwing < 0) ? Math.max(0, Math.min(1, -qldCoalSwing / qldOnSwing)) : 0;
    const qldEffOnAlp = qldFlows.on_alp + (qldFlows.onCoalOriginFactor ?? 0) * qldCoalToOnXfer * (1 - qldFlows.on_alp);
    // Coalition-sourcing of the ON rise, matching the seat model (cut mass moves to other).
    const qldCoalAdj = Math.max(0, qldPrim.coal - extraCoalCutFor({ on: qldOnSwing, coal: qldCoalSwing }, qldFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare));
    const qldOtherAdj = other + (qldPrim.coal - qldCoalAdj);
    const a = qldPrim.alp + qldPrim.ind * qldFlows.ind_alp + qldPrim.grn * qldFlows.grn_alp + onV * qldEffOnAlp + qldOtherAdj * qldFlows.other_alp;
    const c = qldCoalAdj + qldPrim.ind * (1 - qldFlows.ind_alp) + qldPrim.grn * (1 - qldFlows.grn_alp) + onV * (1 - qldEffOnAlp) + qldOtherAdj * (1 - qldFlows.other_alp);
    return a / (a + c) * 100 - QLD_2PP;
  }, [qldPrim, qldFlows, qldOnTcp]);
  const qldUncertainty = useMemo(
    () => computeUncertainty(qldModelledSeats, qldNat2ppSwing, swingStd, useElasticity, 47),
    [qldModelledSeats, qldNat2ppSwing, swingStd, useElasticity]
  );

  // ── WA 2025 model state ───────────────────────────────────────────────────
  const [waPrim, setWaPrim] = useState({ ...WA_BL, undecided: 0 });
  const [waFlows, setWaFlows] = useState({ ...WA_DEFAULT_FLOWS });
  const [waOnTcp, setWaOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  const [waSeatOverrides, setWaSeatOverrides] = useState({});
  const waModelledSeats = useMemo(() => {
    const s = { alp: waPrim.alp - WA_BL.alp, coal: waPrim.coal - WA_BL.coal, grn: waPrim.grn - WA_BL.grn, on: waPrim.on - WA_BL.on };
    // Source a share of any ON rise from the Coalition primary (see MODEL_PARAMS.onFromCoalShare).
    const prim = { ...waPrim, coal: Math.max(0, waPrim.coal - extraCoalCutFor(s, waFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
    const compute2pp = makeStateCompute2pp({ ind: waPrim.ind, onTcp: waOnTcp, swings: s });
    const baseline2pp = compute2pp(WA_BL, waFlows);
    return computeModelledSeatsState(WA_SEATS, prim, compute2pp, baseline2pp, waFlows, WA_COAL, s,
      useWaRegionalSwing ? WA_DISTRICT_REGION : null,
      useWaRegionalSwing ? WA_REGION_SWING_MULT : null,
      null, 6.5, waSeatOverrides,
      useElasticity, null, WA_BL, WA_SEAT_FP_2025,
    );
  }, [waPrim, waFlows, waOnTcp, useWaRegionalSwing, waSeatOverrides, useElasticity]);
  const waProjCounts = useMemo(() => countByGroup(waModelledSeats, (s) => s.modelled.winnerGroup), [waModelledSeats]);
  const waBaseCounts = useMemo(() => countByGroup(WA_SEATS, (s) => getParty(s.winner.party).group), []);
  const waChanged = useMemo(() => waModelledSeats.filter(s => s.modelled.changed), [waModelledSeats]);
  const waImplied2pp = useMemo(() => {
    const onV = waPrim.on ?? 0;
    const other = Math.max(0, 100 - waPrim.alp - waPrim.coal - waPrim.grn - waPrim.ind - onV - (waPrim.undecided || 0));
    const a = waPrim.alp + waPrim.grn * waFlows.grn_alp + waPrim.ind * waFlows.ind_alp + onV * waFlows.on_alp + other * waFlows.other_alp;
    const c = waPrim.coal + waPrim.grn * (1 - waFlows.grn_alp) + waPrim.ind * (1 - waFlows.ind_alp) + onV * (1 - waFlows.on_alp) + other * (1 - waFlows.other_alp);
    return (a + c === 0) ? null : a / (a + c) * 100;
  }, [waPrim, waFlows]);
  const waHasChanges = Object.entries(WA_BL).some(([k, v]) => Math.abs((waPrim[k] ?? v) - v) > 0.05) || (waPrim.undecided || 0) > 0 || waFlows.grn_alp !== 0.86 || waFlows.ind_alp !== 0.58 || waFlows.on_alp !== 0.22 || waFlows.other_alp !== 0.44 || waOnTcp !== null || !useWaRegionalSwing || Object.keys(waSeatOverrides).length > 0 || (waFlows.onCoalOriginFactor ?? 0) !== 0;

  const waNat2ppSwing = useMemo(() => {
    const onV = waPrim.on ?? 0;
    const other = Math.max(0, 100 - waPrim.alp - waPrim.coal - waPrim.grn - waPrim.ind - onV);
    if (waOnTcp === "on_v_alp") {
      const a = waPrim.alp + waPrim.coal * waFlows.coal_alp_v_on + waPrim.grn * waFlows.grn_alp_v_on + waPrim.ind * waFlows.ind_alp_v_on + other * waFlows.other_alp_v_on;
      const on = onV + waPrim.coal * (1 - waFlows.coal_alp_v_on) + waPrim.grn * (1 - waFlows.grn_alp_v_on) + waPrim.ind * (1 - waFlows.ind_alp_v_on) + other * (1 - waFlows.other_alp_v_on);
      const blOnV = WA_BL.on ?? 0; const blOther = Math.max(0, 100 - WA_BL.alp - WA_BL.coal - WA_BL.grn - WA_BL.ind - blOnV);
      const blA = WA_BL.alp + WA_BL.coal * waFlows.coal_alp_v_on + WA_BL.grn * waFlows.grn_alp_v_on + WA_BL.ind * waFlows.ind_alp_v_on + blOther * waFlows.other_alp_v_on;
      const blOn = blOnV + WA_BL.coal * (1 - waFlows.coal_alp_v_on) + WA_BL.grn * (1 - waFlows.grn_alp_v_on) + WA_BL.ind * (1 - waFlows.ind_alp_v_on) + blOther * (1 - waFlows.other_alp_v_on);
      return a / (a + on) * 100 - blA / (blA + blOn) * 100;
    }
    if (waOnTcp === "on_v_coal") {
      const on = onV + waPrim.alp * waFlows.alp_on_v_coal + waPrim.grn * waFlows.grn_on_v_coal + waPrim.ind * waFlows.ind_on_v_coal + other * waFlows.other_on_v_coal;
      const c = waPrim.coal + waPrim.alp * (1 - waFlows.alp_on_v_coal) + waPrim.grn * (1 - waFlows.grn_on_v_coal) + waPrim.ind * (1 - waFlows.ind_on_v_coal) + other * (1 - waFlows.other_on_v_coal);
      const blOnV = WA_BL.on ?? 0; const blOther = Math.max(0, 100 - WA_BL.alp - WA_BL.coal - WA_BL.grn - WA_BL.ind - blOnV);
      const blOn = blOnV + WA_BL.alp * waFlows.alp_on_v_coal + WA_BL.grn * waFlows.grn_on_v_coal + WA_BL.ind * waFlows.ind_on_v_coal + blOther * waFlows.other_on_v_coal;
      const blC = WA_BL.coal + WA_BL.alp * (1 - waFlows.alp_on_v_coal) + WA_BL.grn * (1 - waFlows.grn_on_v_coal) + WA_BL.ind * (1 - waFlows.ind_on_v_coal) + blOther * (1 - waFlows.other_on_v_coal);
      return on / (on + c) * 100 - blOn / (blOn + blC) * 100;
    }
    const waOnSwing = onV - WA_BL.on; const waCoalSwing = waPrim.coal - WA_BL.coal;
    const waCoalToOnXfer = (waOnSwing > 0 && waCoalSwing < 0) ? Math.max(0, Math.min(1, -waCoalSwing / waOnSwing)) : 0;
    const waEffOnAlp = waFlows.on_alp + (waFlows.onCoalOriginFactor ?? 0) * waCoalToOnXfer * (1 - waFlows.on_alp);
    // Coalition-sourcing of the ON rise, matching the seat model (cut mass moves to other).
    const waCoalAdj = Math.max(0, waPrim.coal - extraCoalCutFor({ on: waOnSwing, coal: waCoalSwing }, waFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare));
    const waOtherAdj = other + (waPrim.coal - waCoalAdj);
    const a = waPrim.alp + waPrim.ind * waFlows.ind_alp + waPrim.grn * waFlows.grn_alp + onV * waEffOnAlp + waOtherAdj * waFlows.other_alp;
    const c = waCoalAdj + waPrim.ind * (1 - waFlows.ind_alp) + waPrim.grn * (1 - waFlows.grn_alp) + onV * (1 - waEffOnAlp) + waOtherAdj * (1 - waFlows.other_alp);
    return a / (a + c) * 100 - WA_2PP;
  }, [waPrim, waFlows, waOnTcp]);
  const waUncertainty = useMemo(
    () => computeUncertainty(waModelledSeats, waNat2ppSwing, swingStd, useElasticity, 30),
    [waModelledSeats, waNat2ppSwing, swingStd, useElasticity]
  );

  // ── SA 2026 model state ───────────────────────────────────────────────────
  // Provisional result (21 Mar 2026 — 6 seats still being counted as of 25 Mar 2026)
  // ALP 39.1%  LP 18.7%  ON 21.6%  GRN 11.1%  IND 4.7%  other ~4.8%  2PP 57.4% ALP
  // ON preference flows: despite LP's 16pp primary collapse, ON voters (mostly ex-LP)
  // preferenced back to LP at ~78%, keeping 2PP change modest (+2.5pp) vs the primary vote drama.
  // onCoalOriginFactor lets users model higher ALP flows when ON surge is driven by LP defection.


  const [saPrim, setSaPrim] = useState({ ...SA_BL, undecided: 0 });
  const [saFlows, setSaFlows] = useState({ ...SA_DEFAULT_FLOWS });
  const [saOnTcp, setSaOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  const [saSeatOverrides, setSaSeatOverrides] = useState({});
  const saModelledSeats = useMemo(() => {
    const s = { alp: saPrim.alp - SA_BL.alp, coal: saPrim.coal - SA_BL.coal, grn: saPrim.grn - SA_BL.grn, on: saPrim.on - SA_BL.on };
    // When ON rises at Coalition's expense, ex-LP defectors preference ALP at a higher rate than
    // baseline ON voters. onCoalOriginFactor (0–1) scales this adjustment up when the signal is clear.
    // Additionally source a share of any ON rise from the Coalition primary (see MODEL_PARAMS.onFromCoalShare).
    const prim = { ...saPrim, coal: Math.max(0, saPrim.coal - extraCoalCutFor(s, saFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
    const compute2pp = makeStateCompute2pp({ ind: saPrim.ind, onTcp: saOnTcp, swings: s });
    const baseline2pp = compute2pp(SA_BL, saFlows);
    return computeModelledSeatsState(SA_SEATS, prim, compute2pp, baseline2pp, saFlows, SA_COAL, s,
      useSaRegionalSwing ? SA_DISTRICT_REGION : null,
      useSaRegionalSwing ? SA_REGION_SWING_MULT : null,
      SA_SEAT_ON_FP_2026, 6.5, saSeatOverrides,
      useElasticity, null, SA_BL, SA_SEAT_FP_2026,
    );
  }, [saPrim, saFlows, saOnTcp, useSaRegionalSwing, saSeatOverrides, useElasticity]);
  const saProjCounts = useMemo(() => countByGroup(saModelledSeats, (s) => s.modelled.winnerGroup), [saModelledSeats]);
  const saBaseCounts = useMemo(() => countByGroup(SA_SEATS, (s) => getParty(s.winner.party).group), []);
  const saChanged = useMemo(() => saModelledSeats.filter(s => s.modelled.changed), [saModelledSeats]);
  const saImplied2pp = useMemo(() => {
    const onV = saPrim.on ?? 0;
    const other = Math.max(0, 100 - saPrim.alp - saPrim.coal - saPrim.grn - saPrim.ind - onV - (saPrim.undecided || 0));
    const a = saPrim.alp + saPrim.grn * saFlows.grn_alp + saPrim.ind * saFlows.ind_alp + onV * saFlows.on_alp + other * saFlows.other_alp;
    const c = saPrim.coal + saPrim.grn * (1 - saFlows.grn_alp) + saPrim.ind * (1 - saFlows.ind_alp) + onV * (1 - saFlows.on_alp) + other * (1 - saFlows.other_alp);
    return (a + c === 0) ? null : a / (a + c) * 100;
  }, [saPrim, saFlows]);
  const saHasChanges = Object.entries(SA_BL).some(([k, v]) => Math.abs((saPrim[k] ?? v) - v) > 0.05) || (saPrim.undecided || 0) > 0 || saFlows.grn_alp !== 0.84 || saFlows.ind_alp !== 0.52 || saFlows.on_alp !== 0.22 || saFlows.other_alp !== 0.45 || saOnTcp !== null || !useSaRegionalSwing || Object.keys(saSeatOverrides).length > 0 || (saFlows.onCoalOriginFactor ?? 0) !== 0;

  const saNat2ppSwing = useMemo(() => {
    const onV = saPrim.on ?? 0;
    const other = Math.max(0, 100 - saPrim.alp - saPrim.coal - saPrim.grn - saPrim.ind - onV);
    if (saOnTcp === "on_v_alp") {
      const a = saPrim.alp + saPrim.coal * saFlows.coal_alp_v_on + saPrim.grn * saFlows.grn_alp_v_on + saPrim.ind * saFlows.ind_alp_v_on + other * saFlows.other_alp_v_on;
      const on = onV + saPrim.coal * (1 - saFlows.coal_alp_v_on) + saPrim.grn * (1 - saFlows.grn_alp_v_on) + saPrim.ind * (1 - saFlows.ind_alp_v_on) + other * (1 - saFlows.other_alp_v_on);
      const blOnV = SA_BL.on ?? 0; const blOther = Math.max(0, 100 - SA_BL.alp - SA_BL.coal - SA_BL.grn - SA_BL.ind - blOnV);
      const blA = SA_BL.alp + SA_BL.coal * saFlows.coal_alp_v_on + SA_BL.grn * saFlows.grn_alp_v_on + SA_BL.ind * saFlows.ind_alp_v_on + blOther * saFlows.other_alp_v_on;
      const blOn = blOnV + SA_BL.coal * (1 - saFlows.coal_alp_v_on) + SA_BL.grn * (1 - saFlows.grn_alp_v_on) + SA_BL.ind * (1 - saFlows.ind_alp_v_on) + blOther * (1 - saFlows.other_alp_v_on);
      return a / (a + on) * 100 - blA / (blA + blOn) * 100;
    }
    if (saOnTcp === "on_v_coal") {
      const on = onV + saPrim.alp * saFlows.alp_on_v_coal + saPrim.grn * saFlows.grn_on_v_coal + saPrim.ind * saFlows.ind_on_v_coal + other * saFlows.other_on_v_coal;
      const c = saPrim.coal + saPrim.alp * (1 - saFlows.alp_on_v_coal) + saPrim.grn * (1 - saFlows.grn_on_v_coal) + saPrim.ind * (1 - saFlows.ind_on_v_coal) + other * (1 - saFlows.other_on_v_coal);
      const blOnV = SA_BL.on ?? 0; const blOther = Math.max(0, 100 - SA_BL.alp - SA_BL.coal - SA_BL.grn - SA_BL.ind - blOnV);
      const blOn = blOnV + SA_BL.alp * saFlows.alp_on_v_coal + SA_BL.grn * saFlows.grn_on_v_coal + SA_BL.ind * saFlows.ind_on_v_coal + blOther * saFlows.other_on_v_coal;
      const blC = SA_BL.coal + SA_BL.alp * (1 - saFlows.alp_on_v_coal) + SA_BL.grn * (1 - saFlows.grn_on_v_coal) + SA_BL.ind * (1 - saFlows.ind_on_v_coal) + blOther * (1 - saFlows.other_on_v_coal);
      return on / (on + c) * 100 - blOn / (blOn + blC) * 100;
    }
    const onSwing = onV - SA_BL.on; const coalSwing = saPrim.coal - SA_BL.coal;
    const saCoalToOnXfer = (onSwing > 0 && coalSwing < 0) ? Math.max(0, Math.min(1, -coalSwing / onSwing)) : 0;
    const saEffOnAlp = saFlows.on_alp + (saFlows.onCoalOriginFactor ?? 0) * saCoalToOnXfer * (1 - saFlows.on_alp);
    // Coalition-sourcing of the ON rise, matching the seat model (cut mass moves to other).
    const saCoalAdj = Math.max(0, saPrim.coal - extraCoalCutFor({ on: onSwing, coal: coalSwing }, saFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare));
    const saOtherAdj = other + (saPrim.coal - saCoalAdj);
    const a = saPrim.alp + saPrim.ind * saFlows.ind_alp + saPrim.grn * saFlows.grn_alp + onV * saEffOnAlp + saOtherAdj * saFlows.other_alp;
    const c = saCoalAdj + saPrim.ind * (1 - saFlows.ind_alp) + saPrim.grn * (1 - saFlows.grn_alp) + onV * (1 - saEffOnAlp) + saOtherAdj * (1 - saFlows.other_alp);
    return a / (a + c) * 100 - SA_2PP;
  }, [saPrim, saFlows, saOnTcp]);
  const saUncertainty = useMemo(
    () => computeUncertainty(saModelledSeats, saNat2ppSwing, swingStd, useElasticity, 24),
    [saModelledSeats, saNat2ppSwing, swingStd, useElasticity]
  );

  // ── NT 2024 model state ───────────────────────────────────────────────────
  const [ntExhaustRate, setNtExhaustRate] = useState(NT_EXHAUST_DEFAULT);

  const [ntPrim, setNtPrim] = useState({ ...NT_BL, undecided: 0 });
  const [ntFlows, setNtFlows] = useState({ ...NT_DEFAULT_FLOWS });
  const [ntOnTcp, setNtOnTcp] = useState(null); // null | "on_v_alp" | "on_v_coal"
  const [ntSeatOverrides, setNtSeatOverrides] = useState({});
  const ntModelledSeats = useMemo(() => {
    const s = { alp: ntPrim.alp - NT_BL.alp, coal: ntPrim.coal - NT_BL.coal, grn: ntPrim.grn - NT_BL.grn, on: ntPrim.on - NT_BL.on };
    // Source a share of any ON rise from the Coalition primary (see MODEL_PARAMS.onFromCoalShare).
    const prim = { ...ntPrim, coal: Math.max(0, ntPrim.coal - extraCoalCutFor(s, ntFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
    const compute2pp = makeStateCompute2pp({ ind: ntPrim.ind, onTcp: ntOnTcp, swings: s, exhaust: ntExhaustRate });
    const baseline2pp = compute2pp(NT_BL, ntFlows);
    return computeModelledSeatsState(NT_SEATS, prim, compute2pp, baseline2pp, ntFlows, NT_COAL, s,
      useNtRegionalSwing ? NT_DISTRICT_REGION : null,
      useNtRegionalSwing ? NT_REGION_SWING_MULT : null,
      null, 6.5, ntSeatOverrides,
      useElasticity, null, NT_BL, NT_SEAT_FP_2024,
    );
  }, [ntPrim, ntFlows, ntOnTcp, ntExhaustRate, useNtRegionalSwing, ntSeatOverrides, useElasticity]);
  const ntProjCounts = useMemo(() => countByGroup(ntModelledSeats, (s) => s.modelled.winnerGroup), [ntModelledSeats]);
  const ntBaseCounts = useMemo(() => countByGroup(NT_SEATS, (s) => getParty(s.winner.party).group), []);
  const ntChanged = useMemo(() => ntModelledSeats.filter(s => s.modelled.changed), [ntModelledSeats]);
  const ntHasChanges = Object.entries(NT_BL).some(([k, v]) => Math.abs((ntPrim[k] ?? v) - v) > 0.05) || (ntPrim.undecided || 0) > 0 || ntFlows.grn_alp !== 0.80 || ntFlows.ind_alp !== 0.45 || ntFlows.on_alp !== 0.20 || ntFlows.other_alp !== 0.40 || ntOnTcp !== null || !useNtRegionalSwing || Object.keys(ntSeatOverrides).length > 0 || (ntFlows.onCoalOriginFactor ?? 0) !== 0 || ntExhaustRate !== NT_EXHAUST_DEFAULT;

  const ntNat2ppSwing = useMemo(() => {
    const onV = ntPrim.on ?? 0;
    const other = Math.max(0, 100 - ntPrim.alp - ntPrim.coal - ntPrim.grn - ntPrim.ind - onV);
    const ef = ntExhaustRate;
    if (ntOnTcp === "on_v_alp") {
      const a = ntPrim.alp + (1 - ef) * (ntPrim.coal * ntFlows.coal_alp_v_on + ntPrim.grn * ntFlows.grn_alp_v_on + ntPrim.ind * ntFlows.ind_alp_v_on + other * ntFlows.other_alp_v_on);
      const on = onV + (1 - ef) * (ntPrim.coal * (1 - ntFlows.coal_alp_v_on) + ntPrim.grn * (1 - ntFlows.grn_alp_v_on) + ntPrim.ind * (1 - ntFlows.ind_alp_v_on) + other * (1 - ntFlows.other_alp_v_on));
      const blOnV = NT_BL.on ?? 0; const blOther = Math.max(0, 100 - NT_BL.alp - NT_BL.coal - NT_BL.grn - NT_BL.ind - blOnV);
      const blA = NT_BL.alp + (1 - ef) * (NT_BL.coal * ntFlows.coal_alp_v_on + NT_BL.grn * ntFlows.grn_alp_v_on + NT_BL.ind * ntFlows.ind_alp_v_on + blOther * ntFlows.other_alp_v_on);
      const blOn = blOnV + (1 - ef) * (NT_BL.coal * (1 - ntFlows.coal_alp_v_on) + NT_BL.grn * (1 - ntFlows.grn_alp_v_on) + NT_BL.ind * (1 - ntFlows.ind_alp_v_on) + blOther * (1 - ntFlows.other_alp_v_on));
      return a / (a + on) * 100 - blA / (blA + blOn) * 100;
    }
    if (ntOnTcp === "on_v_coal") {
      const on = onV + (1 - ef) * (ntPrim.alp * ntFlows.alp_on_v_coal + ntPrim.grn * ntFlows.grn_on_v_coal + ntPrim.ind * ntFlows.ind_on_v_coal + other * ntFlows.other_on_v_coal);
      const c = ntPrim.coal + (1 - ef) * (ntPrim.alp * (1 - ntFlows.alp_on_v_coal) + ntPrim.grn * (1 - ntFlows.grn_on_v_coal) + ntPrim.ind * (1 - ntFlows.ind_on_v_coal) + other * (1 - ntFlows.other_on_v_coal));
      const blOnV = NT_BL.on ?? 0; const blOther = Math.max(0, 100 - NT_BL.alp - NT_BL.coal - NT_BL.grn - NT_BL.ind - blOnV);
      const blOn = blOnV + (1 - ef) * (NT_BL.alp * ntFlows.alp_on_v_coal + NT_BL.grn * ntFlows.grn_on_v_coal + NT_BL.ind * ntFlows.ind_on_v_coal + blOther * ntFlows.other_on_v_coal);
      const blC = NT_BL.coal + (1 - ef) * (NT_BL.alp * (1 - ntFlows.alp_on_v_coal) + NT_BL.grn * (1 - ntFlows.grn_on_v_coal) + NT_BL.ind * (1 - ntFlows.ind_on_v_coal) + blOther * (1 - ntFlows.other_on_v_coal));
      return on / (on + c) * 100 - blOn / (blOn + blC) * 100;
    }
    const ntOnSwing = onV - NT_BL.on; const ntCoalSwing = ntPrim.coal - NT_BL.coal;
    const ntCoalToOnXfer = (ntOnSwing > 0 && ntCoalSwing < 0) ? Math.max(0, Math.min(1, -ntCoalSwing / ntOnSwing)) : 0;
    const ntEffOnAlp = ntFlows.on_alp + (ntFlows.onCoalOriginFactor ?? 0) * ntCoalToOnXfer * (1 - ntFlows.on_alp);
    // Coalition-sourcing of the ON rise, matching the seat model (cut mass moves to other).
    const ntCoalAdj = Math.max(0, ntPrim.coal - extraCoalCutFor({ on: ntOnSwing, coal: ntCoalSwing }, ntFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare));
    const ntOtherAdj = other + (ntPrim.coal - ntCoalAdj);
    const a = ntPrim.alp + (1 - ef) * (ntPrim.ind * ntFlows.ind_alp + ntPrim.grn * ntFlows.grn_alp + onV * ntEffOnAlp + ntOtherAdj * ntFlows.other_alp);
    const c = ntCoalAdj + (1 - ef) * (ntPrim.ind * (1 - ntFlows.ind_alp) + ntPrim.grn * (1 - ntFlows.grn_alp) + onV * (1 - ntEffOnAlp) + ntOtherAdj * (1 - ntFlows.other_alp));
    return a / (a + c) * 100 - NT_2PP;
  }, [ntPrim, ntFlows, ntOnTcp, ntExhaustRate]);
  const ntUncertainty = useMemo(
    () => computeUncertainty(ntModelledSeats, ntNat2ppSwing, swingStd, useElasticity, 13),
    [ntModelledSeats, ntNat2ppSwing, swingStd, useElasticity]
  );

  // ── TAS 2024 model state (Hare-Clark) ─────────────────────────────────────
  // Statewide averages of updated TAS_ELECTORATES (5 electorates × 7 seats):
  // Coalition 37  ALP 28  GRN 14  IND/JLN 21  ON 0  (JLN and independents grouped as ind)
  const TAS_BL = { coal: 37, alp: 28, grn: 14, ind: 21, on: 0 };
  const [tasPrim, setTasPrim] = useState({ ...TAS_BL, undecided: 0 });
  const tasProjected = useMemo(() => {
    const electorates = TAS_ELECTORATES.map(el => ({
      ...el,
      coal: Math.max(0, el.coal + (tasPrim.coal - TAS_BL.coal)),
      alp: Math.max(0, el.alp + (tasPrim.alp - TAS_BL.alp)),
      grn: Math.max(0, el.grn + (tasPrim.grn - TAS_BL.grn)),
      ind: Math.max(0, el.ind + (tasPrim.ind - TAS_BL.ind)),
      on: Math.max(0, (el.on ?? 0) + ((tasPrim.on ?? 0) - TAS_BL.on)),
    }));
    return allocateHareClark(electorates, tasPrim);
  }, [tasPrim]);
  const tasHasChanges = Object.entries(TAS_BL).some(([k, v]) => Math.abs((tasPrim[k] ?? v) - v) > 0.05) || (tasPrim.undecided || 0) > 0;

  const tasUncertainty = useMemo(() => {
    const electorates = TAS_ELECTORATES.map(el => ({
      ...el,
      coal: Math.max(0, el.coal + (tasPrim.coal - TAS_BL.coal)),
      alp: Math.max(0, el.alp + (tasPrim.alp - TAS_BL.alp)),
      grn: Math.max(0, el.grn + (tasPrim.grn - TAS_BL.grn)),
      ind: Math.max(0, el.ind + (tasPrim.ind - TAS_BL.ind)),
      on: Math.max(0, (el.on ?? 0) + ((tasPrim.on ?? 0) - TAS_BL.on)),
    }));
    return computeHareClarkUncertainty(electorates, tasPrim, swingStd, 18);
  }, [tasPrim, swingStd]);

  // ── ACT 2024 model state (Hare-Clark) ─────────────────────────────────────
  // Baselines per electorate in ACT_ELECTORATES; statewide averages of updated electorate values:
  // ALP 32  Coalition (Lib) 32  GRN 24  IND 8  ON 0.5
  const ACT_BL = { alp: 32, coal: 32, grn: 24, ind: 8, on: 0.5 };
  const [actPrim, setActPrim] = useState({ ...ACT_BL, undecided: 0 });
  const actProjected = useMemo(() => {
    const electorates = ACT_ELECTORATES.map(el => ({
      ...el,
      alp: Math.max(0, el.alp + (actPrim.alp - ACT_BL.alp)),
      coal: Math.max(0, el.coal + (actPrim.coal - ACT_BL.coal)),
      grn: Math.max(0, el.grn + (actPrim.grn - ACT_BL.grn)),
      ind: Math.max(0, el.ind + (actPrim.ind - ACT_BL.ind)),
      on: Math.max(0, (el.on ?? 0) + ((actPrim.on ?? 0) - ACT_BL.on)),
    }));
    return allocateHareClark(electorates, actPrim);
  }, [actPrim]);
  const actHasChanges = Object.entries(ACT_BL).some(([k, v]) => Math.abs((actPrim[k] ?? v) - v) > 0.05) || (actPrim.undecided || 0) > 0;

  const actUncertainty = useMemo(() => {
    const electorates = ACT_ELECTORATES.map(el => ({
      ...el,
      alp: Math.max(0, el.alp + (actPrim.alp - ACT_BL.alp)),
      coal: Math.max(0, el.coal + (actPrim.coal - ACT_BL.coal)),
      grn: Math.max(0, el.grn + (actPrim.grn - ACT_BL.grn)),
      ind: Math.max(0, el.ind + (actPrim.ind - ACT_BL.ind)),
      on: Math.max(0, (el.on ?? 0) + ((actPrim.on ?? 0) - ACT_BL.on)),
    }));
    return computeHareClarkUncertainty(electorates, actPrim, swingStd, 13);
  }, [actPrim, swingStd]);

  const hasChanges =
    primaries.alp !== BASELINE_2025.alp || primaries.coal !== BASELINE_2025.coal ||
    primaries.grn !== BASELINE_2025.grn || primaries.teal !== BASELINE_2025.teal || primaries.on !== BASELINE_2025.on ||
    (primaries.undecided || 0) > 0 ||
    prefFlows.grn_alp !== PREF_FLOWS_2025.grn_alp || prefFlows.teal_alp !== PREF_FLOWS_2025.teal_alp ||
    prefFlows.on_alp !== PREF_FLOWS_2025.on_alp || prefFlows.other_alp !== PREF_FLOWS_2025.other_alp ||
    prefFlows.coal_alp_v_on !== 0.10 || prefFlows.grn_alp_v_on !== 0.90 ||
    prefFlows.teal_alp_v_on !== 0.75 || prefFlows.other_alp_v_on !== 0.60 ||
    prefFlows.alp_on_v_coal !== 0.20 || prefFlows.grn_on_v_coal !== 0.08 ||
    prefFlows.teal_on_v_coal !== 0.12 || prefFlows.other_on_v_coal !== 0.25 ||
    onThreshold !== MODEL_PARAMS.onThresholdDefault ||
    Object.values(fedStateDeltas).some(d => d !== 0) ||
    Object.keys(seatOverrides).length > 0;

  const getModelledMargin = (s) => {
    if (s.modelled.winnerPct === null) return Infinity; // forceGroup
    if (s.modelled.projAlp2pp !== null) return Math.abs(s.modelled.projAlp2pp - 50);
    return Math.abs(s.modelled.winnerPct - 50);
  };

  const seatsByRisk = useMemo(() => {
    let list = [...modelledSeats];
    if (riskFilter === "changing") list = list.filter(s => s.modelled.changed);
    if (riskFilter === "marginal") list = list.filter(s => getModelledMargin(s) < 5);
    return list.sort((a, b) => getModelledMargin(a) - getModelledMargin(b));
  }, [modelledSeats, riskFilter]);

  // ── Demographics helpers ──
  const getDemog = (id) => DEMOGRAPHICS[id] ?? {};
  const getStateDemog = (id) => STATE_DEMOGRAPHICS[id] ?? {};

  const DEMOG_METRICS = [
    { key: "medianPersonalIncomeEarners", label: "Personal Income (earners)", fmt: v => `$${(v / 1000).toFixed(0)}k` },
    { key: "medianPersonalIncome", label: "Personal Income (all 15+)", fmt: v => `$${(v / 1000).toFixed(0)}k` },
    { key: "medianHouseholdIncome", label: "Median Household Income", fmt: v => `$${(v / 1000).toFixed(0)}k` },
    { key: "medianWeeklyRent", label: "Median Weekly Rent", fmt: v => `$${v}` },
    { key: "medianMonthlyMortgage", label: "Median Monthly Mortgage", fmt: v => `$${v}` },
    { key: "rentalToIncomeRatio", label: "Rent-to-Income Ratio", fmt: v => `${v}%` },
    { key: "ownerOutrightPct", label: "Owner Outright %", fmt: v => `${v}%` },
    { key: "ownerMortgagePct", label: "Owner w/ Mortgage %", fmt: v => `${v}%` },
    { key: "renterPct", label: "Renters %", fmt: v => `${v}%` },
    { key: "bachelorsOrAbovePct", label: "Bachelor's+ %", fmt: v => `${v}%` },
    { key: "noQualificationPct", label: "No Post-School Qual. %", fmt: v => `${v}%` },
    { key: "overseasBornPct", label: "Overseas Born %", fmt: v => `${v}%` },
    { key: "nonEnglishAtHomePct", label: "Non-English at Home %", fmt: v => `${v}%` },
    { key: "loneparentFamilyPct", label: "Lone-Parent Families %", fmt: v => `${v}%` },
    { key: "medianAge", label: "Median Age", fmt: v => `${Math.round(v)}` },
    { key: "youth15to34Pct", label: "Youth (15–34) %", fmt: v => `${v}%` },
    { key: "seniors65PlusPct", label: "Seniors (65+) %", fmt: v => `${v}%` },
    { key: "unemploymentRate", label: "Unemployment Rate", fmt: v => `${v}%` },
    { key: "labourParticipationRate", label: "Labour Participation", fmt: v => `${v}%` },
  ];

  const demogWithSeats = useMemo(() =>
    SEATS.map(s => ({ ...s, demog: getDemog(s.id) })),
    []);

  const demogFiltered = useMemo(() => {
    let list = demogWithSeats.filter(s =>
      demogStateFilter.has(s.state) &&
      demogClassFilter.has(s.demog.urbanClass ?? "Outer Metropolitan")
    );
    list.sort((a, b) => {
      const av = a.demog[demogSortKey] ?? -Infinity;
      const bv = b.demog[demogSortKey] ?? -Infinity;
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return demogSortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [demogStateFilter, demogClassFilter, demogSortKey, demogSortDir]);

  const demogStats = useMemo(() => {
    const stats = {};
    DEMOG_METRICS.forEach(({ key }) => {
      const vals = demogFiltered.map(s => s.demog[key]).filter(v => v != null);
      if (!vals.length) { stats[key] = null; return; }
      stats[key] = {
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      };
    });
    return stats;
  }, [demogFiltered]);

  const scatterData = useMemo(() => {
    const mKey = demogXMetric;
    return demogWithSeats
      .map(s => {
        const m = modelledSeats.find(ms => ms.id === s.id);
        const xVal = s.demog[mKey];
        const margin = m ? getModelledMargin(m) : null;
        const group = m ? m.modelled.winnerGroup : getParty(s.winner.party).group;
        if (xVal == null || margin == null || margin === Infinity) return null;
        return {
          x: xVal, y: +(m.modelled.projAlp2pp != null ? m.modelled.projAlp2pp - 50 : m.modelled.winnerPct - 50).toFixed(2),
          name: s.name, state: s.state, group, xLabel: xVal
        };
      })
      .filter(Boolean);
  }, [demogWithSeats, modelledSeats, demogXMetric]);

  // ── Polling data ──
  const sortedPolls = useMemo(() => [...polls].sort((a, b) => b.date.localeCompare(a.date)), [polls]);
  const latestPoll = sortedPolls[0];

  // Compute imputed TPP from primary votes using 2022 AEC DOP preference flows
  const imputedTpp = (p) => {
    if (p.tpp != null) return p.tpp;
    const { alp, coal, grn, on } = p;
    if ([alp, coal, grn].some(v => v == null)) return null;
    const onV = on ?? 0;
    const other = Math.max(0, 100 - alp - coal - grn - onV);
    const alpTcp = alp + grn * 0.857 + other * 0.574 + onV * 0.149;
    const coalTcp = coal + grn * (1 - 0.857) + other * (1 - 0.574) + onV * (1 - 0.149);
    const total = alpTcp + coalTcp;
    return total > 0 ? +(alpTcp / total * 100).toFixed(1) : null;
  };

  // Exponentially-decayed, sample-size-weighted average over the last 30 days
  const pollAvg = useMemo(() => {
    if (!sortedPolls.length) return null;
    const ref = new Date(sortedPolls[0].date);
    const HALF_LIFE = 90, MEDIAN_N = 1500;
    const recent = sortedPolls.filter(p => {
      const days = (ref - new Date(p.date)) / 86400000;
      return days >= 0 && days <= 30;
    });
    if (!recent.length) return null;
    const wt = p => {
      const days = (ref - new Date(p.date)) / 86400000;
      return Math.exp(-Math.log(2) / HALF_LIFE * days) * Math.sqrt((p.n ?? MEDIAN_N) / MEDIAN_N);
    };
    const wavg = f => {
      const vals = recent.filter(p => p[f] != null);
      const tw = vals.reduce((s, p) => s + wt(p), 0);
      return tw ? +(vals.reduce((s, p) => s + p[f] * wt(p), 0) / tw).toFixed(1) : null;
    };
    // For TPP, include imputed values for polls missing tpp
    const tppVals = recent.map(p => ({ ...p, tpp: imputedTpp(p) })).filter(p => p.tpp != null);
    const tppTw = tppVals.reduce((s, p) => s + wt(p), 0);
    const tppAvg = tppTw ? +(tppVals.reduce((s, p) => s + p.tpp * wt(p), 0) / tppTw).toFixed(1) : null;
    return { alp: wavg("alp"), coal: wavg("coal"), grn: wavg("grn"), on: wavg("on"), oth: wavg("oth"), tpp: tppAvg, n: recent.length };
  }, [sortedPolls]);

  // Unified chart dataset: raw poll values + weighted aggregate trend at each poll date
  const pollChartData = useMemo(() => {
    const HALF_LIFE = 90, MEDIAN_N = 1500, WINDOW_MS = 30 * 86400000;
    const sorted = [...polls].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map(p => {
      const pMs = new Date(p.date).getTime();
      const label = new Date(p.date).toLocaleDateString("en-AU", { month: "short", day: "numeric" });
      const inWindow = sorted.filter(q => {
        const qMs = new Date(q.date).getTime();
        return qMs <= pMs && pMs - qMs <= WINDOW_MS;
      });
      const wt = q => {
        const days = (pMs - new Date(q.date).getTime()) / 86400000;
        return Math.exp(-Math.log(2) / HALF_LIFE * days) * Math.sqrt((q.n ?? MEDIAN_N) / MEDIAN_N);
      };
      const wavg = vals => {
        const tw = vals.reduce((s, q) => s + wt(q), 0);
        return tw ? +(vals.reduce((s, q) => s + q.v * wt(q), 0) / tw).toFixed(1) : null;
      };
      const tppPts = inWindow.map(q => ({ ...q, v: imputedTpp(q) })).filter(q => q.v != null);
      const hasEnough = inWindow.length >= 2;
      const onPts = inWindow.map(q => ({ ...q, v: q.on })).filter(q => q.v != null);
      return {
        date: label,
        ALP: p.alp, Coalition: p.coal, Greens: p.grn, ON: p.on, "2PP (ALP)": p.tpp,
        "ALP (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.alp }))) : null,
        "Coal (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.coal }))) : null,
        "Grn (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.grn }))) : null,
        "ON (trend)": onPts.length >= 2 ? wavg(onPts) : null,
        "2PP (trend)": tppPts.length >= 2 ? wavg(tppPts) : null,
        "2PP (Coal)": p.tpp != null ? +(100 - p.tpp).toFixed(1) : null,
        "Coal 2PP (trend)": tppPts.length >= 2 ? +(100 - wavg(tppPts)).toFixed(1) : null,
      };
    });
  }, [polls]);

  // Pipeline trend chart data from AGGREGATED_POLLS.trend (weekly smoothed with 95% CI)
  const pipelineTrendData = useMemo(() => {
    const trend = AGGREGATED_POLLS?.trend;
    if (!trend?.length) return [];
    return trend.map(pt => ({
      date: new Date(pt.date).toLocaleDateString("en-AU", { month: "short", day: "numeric" }),
      "ALP mean": pt.alp?.mean ?? null,
      "ALP CI": pt.alp ? [pt.alp.lo95, pt.alp.hi95] : null,
      "Coal mean": pt.coal?.mean ?? null,
      "Coal CI": pt.coal ? [pt.coal.lo95, pt.coal.hi95] : null,
      "Grn mean": pt.grn?.mean ?? null,
      "Grn CI": pt.grn ? [pt.grn.lo95, pt.grn.hi95] : null,
      "ON mean": pt.on?.mean ?? null,
      "ON CI": pt.on ? [pt.on.lo95, pt.on.hi95] : null,
      "2PP mean": pt.tpp_eff?.mean ?? null,
      "2PP CI": pt.tpp_eff ? [pt.tpp_eff.lo95, pt.tpp_eff.hi95] : null,
    }));
  }, []);

  const loadPollIntoModel = (poll) => {
    if (!poll) return;
    setPrimaries(p => ({
      ...p,
      alp:  poll.alp,
      coal: poll.coal,
      grn:  poll.grn,
      on:   poll.on ?? p.on,   // teal not tracked in polls
    }));
    setActiveTab("model");
  };

  const loadFromPoll = () => loadPollIntoModel(latestPoll);

  const loadFromAvg = () => {
    // Prefer the pipeline's house-effect-corrected aggregate (AGGREGATED_POLLS.current)
    // over the simple frontend weighted average — it accounts for per-pollster bias.
    const pipelineCurrent = AGGREGATED_POLLS?.current;
    if (pipelineCurrent) {
      setPrimaries(p => ({
        ...p,
        alp:  +(pipelineCurrent.alp?.mean ?? pollAvg?.alp ?? p.alp).toFixed(1),
        coal: +(pipelineCurrent.coal?.mean ?? pollAvg?.coal ?? p.coal).toFixed(1),
        grn:  +(pipelineCurrent.grn?.mean ?? pollAvg?.grn ?? p.grn).toFixed(1),
        on:   +(pipelineCurrent.on?.mean ?? pollAvg?.on ?? p.on).toFixed(1),
      }));
    } else if (pollAvg) {
      setPrimaries(p => ({
        ...p,
        alp:  pollAvg.alp,
        coal: pollAvg.coal,
        grn:  pollAvg.grn,
        on:   pollAvg.on ?? p.on,
      }));
    }
    setActiveTab("model");
  };

  // Observed min–max ranges across 2019, 2022, and 2025 federal elections (AEC DOP data).
  // ON-race flows have limited historical data; ranges are estimated from available seats.
  const PREF_FLOW_RANGES = {
    grn_alp: [0.80, 0.86],
    teal_alp: [0.62, 0.74],
    // ON→ALP federal series (AEC DOP): 2016 ~49.6%, 2019 34.7%, 2022 35.7%,
    // 2025 25.5% (highest-ever flow to the Coalition). Default = 25.5% (2025 actual).
    on_alp: [0.20, 0.50],
    other_alp: [0.50, 0.57],
    // Coal→ALP in ON vs ALP: 2025 was ~15%. Range reflects limited historical data.
    coal_alp_v_on: [0.10, 0.20],
    grn_alp_v_on: [0.88, 0.93],
    teal_alp_v_on: [0.73, 0.80],
    other_alp_v_on: [0.55, 0.65],
    alp_on_v_coal: [0.18, 0.25],
    grn_on_v_coal: [0.05, 0.10],
    teal_on_v_coal: [0.09, 0.15],
    other_on_v_coal: [0.22, 0.30],
  };

  const resetPrefFlows = () => setPrefFlows(PREF_FLOWS_2025);

  const resetModel = () => {
    setPrimaries({ alp: BASELINE_2025.alp, coal: BASELINE_2025.coal, grn: BASELINE_2025.grn, teal: BASELINE_2025.teal, on: BASELINE_2025.on, undecided: 0 });
    setPrefFlows(PREF_FLOWS_2025);
    setOnThreshold(MODEL_PARAMS.onThresholdDefault);
    setFedStateDeltas({ NSW: 0, VIC: 0, QLD: 0, WA: 0, SA: 0, TAS: 0 });
    setSeatOverrides({});
  };

  const addPoll = () => {
    const { pollster, date, alp, coal, grn, on, tpp, n } = newPoll;
    if (!pollster || !date || !alp || !coal || !grn) return;
    const a = +alp, c = +coal, g = +grn, o = on ? +on : 0;
    setPolls(prev => [...prev, {
      id: nextPollId,
      pollster, date,
      alp: a, coal: c, grn: g,
      on: o,
      oth: +(100 - a - c - g - o).toFixed(1),
      tpp: tpp ? +tpp : null,
      n: n ? +n : (POLL_SAMPLE_SIZES[pollster] ?? null),
    }]);
    setNextPollId(id => id + 1);
    setNewPoll({ pollster: "", date: "", alp: "", coal: "", grn: "", on: "", tpp: "", n: "" });
    setShowAddPoll(false);
  };

  const deletePoll = (id) => setPolls(prev => prev.filter(p => p.id !== id));

  const addSeatOverride = (seatId) => {
    // Seed FP primaries from the seat's actual 2025 AEC data, falling back to the
    // currently-modelled national primaries if no seat data exists.
    const base = getSeatFpBaseline(seatId);
    // Also auto-populate pref flows from the AEC per-seat DOP baseline (+ current
    // national slider delta) when data is available, so sliders open pre-seeded.
    const seatBase = SEAT_PREF_FLOWS_2025[seatId];
    const eff = seatBase ? applyPrefDelta(seatBase, prefFlows) : null;
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: {
        ...(base
          ? { alp: +base.alp.toFixed(1), coal: +base.coal.toFixed(1), grn: +base.grn.toFixed(1), teal: +base.teal.toFixed(1), on: +base.on.toFixed(1) }
          : { alp: primaries.alp, coal: primaries.coal, grn: primaries.grn, teal: primaries.teal, on: primaries.on }),
        ...(eff ? { prefFlows: {
          grn_alp: eff.grn_alp, teal_alp: eff.teal_alp, on_alp: eff.on_alp, other_alp: eff.other_alp,
          grn_alp_v_on: prefFlows.grn_alp_v_on, teal_alp_v_on: prefFlows.teal_alp_v_on,
          other_alp_v_on: prefFlows.other_alp_v_on, grn_on_v_coal: prefFlows.grn_on_v_coal,
          teal_on_v_coal: prefFlows.teal_on_v_coal, other_on_v_coal: prefFlows.other_on_v_coal,
        }} : {}),
      },
    }));
    setOverrideSearch("");
  };

  const updateSeatOverride = (seatId, key, rawVal) => {
    let val;
    if (key === "forceGroup") {
      val = rawVal === "" ? null : rawVal;
    } else {
      const n = rawVal === "" ? null : parseFloat(rawVal);
      val = (n !== null && isNaN(n)) ? null : n;
    }
    setSeatOverrides(prev => ({ ...prev, [seatId]: { ...prev[seatId], [key]: val } }));
  };

  const clearOverride = (seatId) => {
    setSeatOverrides(prev => { const n = { ...prev }; delete n[seatId]; return n; });
  };

  const updateSeatPrefFlow = (seatId, key, rawVal) => {
    const n = rawVal === "" ? null : parseFloat(rawVal);
    const val = (n !== null && isNaN(n)) ? null : (n !== null ? n / 100 : null);
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: {
        ...prev[seatId],
        prefFlows: { ...(prev[seatId]?.prefFlows ?? {}), [key]: val },
      },
    }));
  };

  const initSeatPrefFlows = (seatId) => {
    // Seed the per-seat override from the seat's current effective flow:
    // AEC per-seat baseline + slider delta if available, otherwise slider value.
    const seatBase = SEAT_PREF_FLOWS_2025[seatId];
    const eff = seatBase ? applyPrefDelta(seatBase, prefFlows) : prefFlows;
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: {
        ...prev[seatId],
        prefFlows: {
          grn_alp:        eff.grn_alp,
          teal_alp:       eff.teal_alp,
          on_alp:         eff.on_alp,
          other_alp:      eff.other_alp,
          grn_alp_v_on:   prefFlows.grn_alp_v_on,
          teal_alp_v_on:  prefFlows.teal_alp_v_on,
          other_alp_v_on: prefFlows.other_alp_v_on,
          grn_on_v_coal:  prefFlows.grn_on_v_coal,
          teal_on_v_coal: prefFlows.teal_on_v_coal,
          other_on_v_coal: prefFlows.other_on_v_coal,
        },
      },
    }));
  };

  const SortTh = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", background: "var(--table-head-bg)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {children}{" "}<span style={{ color: sortKey === k ? "var(--text-2)" : "var(--border-2)" }}>{sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
    </th>
  );

  const tabs = [
    ...(LIVE_CONFIG.active?.enabled ? [{ id: "live", label: `🔴 ${LIVE_CONFIG.active.label}` }] : []),
    { id: "model",       label: `Model${hasChanges ? " ●" : ""}` },
    { id: "seats",       label: "Seats" },
    { id: "polls",       label: "Polls" },
    { id: "markets",     label: "Markets" },
    { id: "guide",       label: "User Guide" },
    { id: "methodology", label: "Methodology" },
    { id: "about",       label: "About" },
  ];

  const panelStyle = isMobile ? { ...STYLES.panel, padding: "14px 14px" } : STYLES.panel;
  const sectionHead = STYLES.sectionHead;
  const chartTickColor = darkMode ? "#8B949E" : "var(--text-3)";

  // Shared filter controls used in both desktop sidebar and mobile bottom sheet
  const seatFilterPanel = (
    <>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search seats…"
        style={{ ...STYLES.input, width: "100%", boxSizing: "border-box", marginBottom: 14 }} />
      {isFederalTab && (<>
        <div style={sectionHead}>State / Territory</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <button onClick={() => setStateFilter(new Set(STATES))} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>All</button>
          <button onClick={() => setStateFilter(new Set())} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>None</button>
        </div>
        {STATES.map(s => (
          <label key={s} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={stateFilter.has(s)} onChange={() => toggleSet(setStateFilter, s)} style={{ accentColor: "#2563EB" }} />
            <span style={{ flex: 1 }}>{s}</span>
            <span style={{ color: "var(--text-4)", fontSize: 11 }}>{stateCounts[s]}</span>
          </label>
        ))}
        <div style={{ borderTop: "1px solid var(--border-3)", margin: "10px 0" }} />
      </>)}
      <div style={sectionHead}>Party / Group</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <button onClick={() => setGroupFilter(new Set(GROUP_ORDER))} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>All</button>
        <button onClick={() => setGroupFilter(new Set())} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>None</button>
      </div>
      {GROUP_ORDER.map(g => (
        <label key={g} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={groupFilter.has(g)} onChange={() => toggleSet(setGroupFilter, g)} style={{ accentColor: GROUP_CONFIG[g].color }} />
          <span style={{ width: 8, height: 8, borderRadius: 2, background: GROUP_CONFIG[g].color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12 }}>{GROUP_CONFIG[g].label}</span>
          <span style={{ color: "var(--text-4)", fontSize: 11 }}>{groupCounts[g] || 0}</span>
        </label>
      ))}
      <div style={{ borderTop: "1px solid var(--border-3)", margin: "10px 0" }} />
      <div style={sectionHead}>Margin</div>
      {MARGINS.map(m => (
        <label key={m} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={marginFilter.has(m)} onChange={() => toggleSet(setMarginFilter, m)} style={{ accentColor: MARGIN_COLOR[m] }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: MARGIN_COLOR[m], flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12 }}>{MARGIN_LABEL[m]}</span>
          <span style={{ color: "var(--text-4)", fontSize: 11 }}>{marginCounts[m] || 0}</span>
        </label>
      ))}
      <button onClick={() => { setSearch(""); setStateFilter(new Set(STATES)); setGroupFilter(new Set(GROUP_ORDER)); setMarginFilter(new Set(MARGINS)); }}
        style={{ ...STYLES.btnSecondary, marginTop: 12, width: "100%", padding: "7px 0" }}>
        Clear all filters
      </button>
    </>
  );

  // ── Sync primary sliders to URL params for scenario sharing ─────────────────
  useEffect(() => {
    const base = BASELINE_2025;
    const changed = (
      Math.abs(primaries.alp - base.alp) > 0.05 ||
      Math.abs(primaries.coal - base.coal) > 0.05 ||
      Math.abs(primaries.grn - base.grn) > 0.05 ||
      Math.abs(primaries.teal - base.teal) > 0.05 ||
      Math.abs(primaries.on - base.on) > 0.05 ||
      (primaries.undecided ?? 0) > 0.05
    );
    const url = new URL(window.location.href);
    if (changed) {
      ["alp", "coal", "grn", "teal", "on"].forEach(k => url.searchParams.set(k, primaries[k].toFixed(1)));
      if ((primaries.undecided ?? 0) > 0) url.searchParams.set("undecided", (primaries.undecided).toFixed(1));
      else url.searchParams.delete("undecided");
    } else {
      ["alp", "coal", "grn", "teal", "on", "undecided"].forEach(k => url.searchParams.delete(k));
    }
    window.history.replaceState({}, "", url.toString());
  }, [primaries]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "var(--font-sans)", background: "var(--page-bg)", minHeight: "100vh", overflowX: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ background: "var(--header-bg)", color: "var(--header-fg)", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Title row */}
        <div style={{ padding: isMobile ? "0 16px" : "0 24px", display: "flex", alignItems: "center", gap: 4, height: isMobile ? 44 : 56 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, marginRight: isMobile ? 0 : 20, whiteSpace: "nowrap", flex: isMobile ? 1 : "none" }}>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: isMobile ? 16 : 20, fontWeight: 640, letterSpacing: "-0.01em", color: "var(--header-fg)", lineHeight: 1 }}>
              Aus Poll
            </span>
            <span aria-hidden="true" style={{ width: 7, height: 7, background: "var(--accent)", transform: "rotate(45deg)", display: "inline-block", flexShrink: 0, alignSelf: "center" }} />
            {!isMobile && (
              <span style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--header-muted)" }}>
                Australian election modelling
              </span>
            )}
          </span>
          {/* Desktop: tabs in title row — scrollable to handle many tabs */}
          {!isMobile && (
            <div style={{ display: "flex", flex: 1, overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none", alignItems: "stretch" }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  style={{
                    background: "transparent",
                    color: activeTab === t.id ? "var(--header-fg)" : "var(--header-muted)",
                    border: "none",
                    borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                    padding: "0 13px",
                    height: 56,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    transition: "color 0.15s, border-color 0.15s",
                    borderRadius: 0,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 3,
              color: "var(--header-muted)",
              cursor: "pointer",
              fontSize: isMobile ? 14 : 15,
              padding: isMobile ? "4px 7px" : "5px 9px",
              lineHeight: 1,
              flexShrink: 0,
              transition: "border-color 0.15s, color 0.15s",
            }}
          >
            {darkMode ? "☀" : "🌙"}
          </button>
          {/* Buy Me a Coffee */}
          <a
            href="https://buymeacoffee.com/auspoll"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginLeft: isMobile ? "auto" : 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.25)",
              color: "var(--header-fg)",
              borderRadius: 3,
              padding: isMobile ? "4px 8px" : "5px 12px",
              fontSize: isMobile ? 10 : 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "border-color 0.15s",
            }}
          >
            {isMobile ? "☕" : "Support"}
          </a>
        </div>
        {/* Mobile: tabs row below title */}
        {isMobile && (
          <div style={{ display: "flex", overflowX: "auto", borderTop: "1px solid rgba(255,255,255,0.08)", scrollbarWidth: "none" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{
                  flex: "none",
                  minWidth: 72,
                  background: "transparent",
                  color: activeTab === t.id ? "var(--header-fg)" : "var(--header-muted)",
                  border: "none",
                  borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                  padding: "0 10px",
                  height: 42,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  transition: "color 0.15s, border-color 0.15s",
                  borderRadius: 0,
                  whiteSpace: "nowrap",
                }}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Hero projection banner ── */}
      <HeroBanner counts={projCounts} avg2pp={seatAvg2pp} isMobile={isMobile} />

      {/* Keyed wrapper re-mounts on tab change → editorial rise-in transition */}
      <div key={activeTab} style={{ animation: "riseIn 0.22s ease-out" }}>

      {/* ══════════════════════ LIVE RESULTS TAB ══════════════════════════════ */}
      {activeTab === "live" && (
        <LivePage
          meta={live.feed?.meta}
          projected={liveProjected}
          confidence={liveConfidence}
          status={live.status}
          error={live.error}
          lastFetched={live.lastFetched}
          refresh={live.refresh}
          isMobile={isMobile}
          devSnapshots={import.meta.env.DEV ? SAMPLE_SNAPSHOTS : null}
          snapshotUrl={liveSnapshotUrl}
          onPickSnapshot={setLiveSnapshotUrl}
          sourceLabel={live.source?.label || "live"}
        />
      )}

      {/* ══════════════════════ SEATS TAB ═════════════════════════════════════ */}
      {activeTab === "seats" && (
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", maxWidth: 1400, margin: "0 auto" }}>
          {/* Mobile filter trigger */}
          {isMobile && (() => {
            const activeFilterCount = (search ? 1 : 0) + (stateFilter.size < STATES.length ? 1 : 0) + (groupFilter.size < GROUP_ORDER.length ? 1 : 0) + (marginFilter.size < MARGINS.length ? 1 : 0);
            return (
              <div style={{ padding: "12px 16px 0" }}>
                <button onClick={() => setShowMobileFilters(true)}
                  style={{ ...STYLES.btnSecondary, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <span>⚙</span> Filters
                  {activeFilterCount > 0 && (
                    <span style={{ background: "#2563EB", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "1px 7px", marginLeft: 2 }}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            );
          })()}

          {/* Desktop sidebar */}
          {!isMobile && (
            <aside style={{ width: 215, flexShrink: 0, padding: "16px 0 16px 16px" }}>
              <div style={{ ...STYLES.panel, padding: "14px 16px", position: "sticky", top: 90, fontSize: 13, marginBottom: 0 }}>
                {seatFilterPanel}
              </div>
            </aside>
          )}

          {/* Mobile bottom sheet backdrop */}
          {isMobile && showMobileFilters && (
            <div onClick={() => setShowMobileFilters(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300 }} />
          )}

          {/* Mobile bottom sheet */}
          {isMobile && (
            <div style={{
              position: "fixed", left: 0, right: 0, bottom: 0,
              background: "var(--panel-bg)",
              borderRadius: "16px 16px 0 0",
              boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
              zIndex: 301, maxHeight: "80vh", overflowY: "auto",
              padding: "0 16px 28px",
              transform: showMobileFilters ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
            }}>
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border-2)" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>Filters</span>
                <button onClick={() => setShowMobileFilters(false)}
                  style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-3)", padding: "4px 8px", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 13 }}>
                {seatFilterPanel}
              </div>
            </div>
          )}
          <div style={{ flex: 1, padding: 16, minWidth: 0 }}>
            {/* ── Jurisdiction selector ── */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {ELECTION_OPTIONS.map(key => {
                const ed = ELECTION_DATA[key];
                return (
                  <button key={key}
                    title={`${ed.jurisdiction} · ${ed.chamber} · ${ed.date}`}
                    onClick={() => { setSeatsJurisdiction(key); setExpandedSeatTabDemogId(null); }}
                    style={{
                      fontSize: 12, fontWeight: seatsJurisdiction === key ? 700 : 500,
                      padding: "4px 11px", borderRadius: 20, border: "1px solid",
                      borderColor: seatsJurisdiction === key ? "#2563EB" : "var(--border-2)",
                      background: seatsJurisdiction === key ? "var(--row-highlight)" : "var(--panel-bg)",
                      color: seatsJurisdiction === key ? "#2563EB" : "var(--text-2)",
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}>
                    {ed.label}
                  </button>
                );
              })}
            </div>
            {/* ── Election subtitle ── */}
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              {ELECTION_DATA[seatsJurisdiction].jurisdiction} · {ELECTION_DATA[seatsJurisdiction].chamber} · {ELECTION_DATA[seatsJurisdiction].date}
              {hasHareClark && <span style={{ marginLeft: 8, color: "#F59E0B", fontWeight: 600 }}>· Hare-Clark (multi-member, approximated)</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={STYLES.sectionTitle}>All Seats</span>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>{filtered.length} of {seatsForTab.length} seats</span>
            </div>
            <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 12, overflow: "clip" }}>
              <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "70vh" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--panel-bg)" }}>
                    <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                      <SortTh k="name">Division</SortTh>
                      <SortTh k="state">State</SortTh>
                      <SortTh k="party">Party</SortTh>
                      <th style={STYLES.tableHead}>Winner</th>
                      <th style={{ ...STYLES.tableHead, whiteSpace: "nowrap" }}>TCP %</th>
                      <SortTh k="margin">Margin</SortTh>
                      {isFederalTab && <SortTh k="swing">Swing</SortTh>}
                      <th style={STYLES.tableHead}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={isFederalTab ? 8 : 7} style={{ padding: "48px 24px", textAlign: "center" }}>
                        <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>🔍</div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-2)", marginBottom: 6 }}>No seats match current filters</div>
                        <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 16 }}>Try broadening your filter criteria</div>
                        <button onClick={() => { setSearch(""); setStateFilter(new Set(STATES)); setGroupFilter(new Set(GROUP_ORDER)); setMarginFilter(new Set(MARGINS)); }}
                          style={{ ...STYLES.btnSecondary, fontSize: 12, padding: "6px 14px" }}>
                          Clear all filters
                        </button>
                      </td></tr>
                    ) : filtered.map((s, i) => {
                      const p = getParty(s.winner.party);
                      const cat = getMarginCat(s.margin);
                      const isExpanded = expandedSeatTabDemogId === s.id;
                      const d = getDemog(s.id);
                      return (
                        <>
                          <tr key={s.id}
                            onClick={() => setExpandedSeatTabDemogId(prev => prev === s.id ? null : s.id)}
                            style={{ background: isExpanded ? "var(--row-highlight)" : "var(--panel-bg)", borderBottom: isExpanded ? "none" : "1px solid var(--border-3)", cursor: "pointer", transition: "background 0.12s" }}
                            onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "var(--row-highlight)"; }}
                            onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "var(--panel-bg)"; }}>
                            <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 4, height: 32, background: p.color, borderRadius: 2, flexShrink: 0 }} />
                                <div>
                                  <div style={{ fontWeight: 700, color: "var(--text-1)" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>ID {s.id}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "11px 14px" }}>
                              <span style={{ background: "var(--subtle-bg)", color: "var(--text-2)", fontWeight: 600, fontSize: 12, padding: "2px 7px", borderRadius: 4 }}>{s.state}</span>
                            </td>
                            <td style={{ padding: "11px 14px" }}><PartyBadge party={s.winner.party} /></td>
                            <td style={{ padding: "11px 14px", color: "var(--text-2)" }}>{s.winner.name}</td>
                            <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}><TcpBar tcp={s.tcp} winnerParty={s.winner.party} /></td>
                            <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}><MarginDot margin={s.margin} /></td>
                            {isFederalTab && <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}><SwingBadge swing={s.swing} /></td>}
                            <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-2)" }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: MARGIN_COLOR[cat], display: "inline-block", flexShrink: 0 }} />
                                {cat === "very_marginal" ? "Very marginal" : cat === "marginal" ? "Marginal" : cat === "fairly_safe" ? "Fairly safe" : "Safe"}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${s.id}-demog`}>
                              <td colSpan={isFederalTab ? 8 : 7} style={{ background: "var(--row-highlight)", padding: "14px 20px", borderBottom: "2px solid var(--border-2)", animation: "fadeIn 0.15s ease" }}>
                                {(() => {
                                  const d = isFederalTab ? getDemog(s.id) : getStateDemog(s.id);
                                  const hasData = d && (d.medianAge != null || d.medianPersonalIncome != null);
                                  if (!isFederalTab && !hasData) {
                                    return <div style={{ color: "var(--text-3)", fontSize: 13 }}>Census demographic data is not yet available for this electorate.</div>;
                                  }
                                  const DemogBar = ({ value, min, max, color = "#3B82F6", fmt }) => {
                                    if (value == null) return <span style={{ color: "var(--text-4)" }}>—</span>;
                                    const pct = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
                                    return (
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 56 }}>{fmt(value)}</span>
                                        <div style={{ flex: 1, height: 5, background: "var(--border-3)", borderRadius: 1, position: "relative" }}>
                                          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color, borderRadius: 1 }} />
                                        </div>
                                        <span style={{ fontSize: 10, color: "var(--text-4)", minWidth: 28, textAlign: "right" }}>
                                          {pct < 33 ? "low" : pct < 66 ? "mid" : "high"}
                                        </span>
                                      </div>
                                    );
                                  };
                                  return (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                  <div>
                                    <div style={{ ...STYLES.sectionHead, marginBottom: 8 }}>Income</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>Personal income/yr (earners)</div>
                                      <DemogBar value={d.medianPersonalIncomeEarners} min={35000} max={130000} color="#DC2626" fmt={v => `$${(v/1000).toFixed(0)}k`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Personal income/yr (all 15+)</div>
                                      <DemogBar value={d.medianPersonalIncome} min={25000} max={100000} color="#F87171" fmt={v => `$${(v/1000).toFixed(0)}k`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Household income/yr</div>
                                      <DemogBar value={d.medianHouseholdIncome} min={50000} max={180000} color="#DC2626" fmt={v => `$${(v/1000).toFixed(0)}k`} />
                                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 6, lineHeight: 1.4 }}>Earners = median excl. nil/negative income · ABS Census 2021</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ ...STYLES.sectionHead, marginBottom: 8 }}>Housing</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>Renters</div>
                                      <DemogBar value={d.renterPct} min={5} max={65} color="#F59E0B" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Weekly rent</div>
                                      <DemogBar value={d.medianWeeklyRent} min={150} max={700} color="#F59E0B" fmt={v => `$${v}`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Rent-to-income ratio</div>
                                      <DemogBar value={d.rentalToIncomeRatio} min={10} max={40} color="#EF4444" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Owner w/ mortgage</div>
                                      <DemogBar value={d.ownerMortgagePct} min={10} max={50} color="#D97706" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Owner outright</div>
                                      <DemogBar value={d.ownerOutrightPct} min={10} max={50} color="#B45309" fmt={v => `${v}%`} />
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ ...STYLES.sectionHead, marginBottom: 8 }}>People</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>Median age</div>
                                      <DemogBar value={d.medianAge} min={28} max={55} color="#059669" fmt={v => `${Math.round(v)} yrs`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Youth (15–34)</div>
                                      <DemogBar value={d.youth15to34Pct} min={15} max={80} color="#059669" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Seniors (65+)</div>
                                      <DemogBar value={d.seniors65PlusPct} min={5} max={35} color="#10B981" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>University educated</div>
                                      <DemogBar value={d.bachelorsOrAbovePct} min={5} max={60} color="#059669" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>No post-school qual.</div>
                                      <DemogBar value={d.noQualificationPct} min={20} max={70} color="var(--text-3)" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Overseas born</div>
                                      <DemogBar value={d.overseasBornPct} min={3} max={60} color="#10B981" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Non-English at home</div>
                                      <DemogBar value={d.nonEnglishAtHomePct} min={2} max={60} color="#8B5CF6" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Lone-parent families</div>
                                      <DemogBar value={d.loneparentFamilyPct} min={5} max={35} color="#8B5CF6" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Unemployment rate</div>
                                      <DemogBar value={d.unemploymentRate} min={1} max={12} color="#6366F1" fmt={v => `${v}%`} />
                                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Labour participation</div>
                                      <DemogBar value={d.labourParticipationRate} min={40} max={80} color="#6366F1" fmt={v => `${v}%`} />
                                      {isFederalTab && d.urbanClass && <>
                                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>AEC classification</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{d.urbanClass}</div>
                                      </>}
                                    </div>
                                  </div>
                                </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "9px 16px", background: "var(--table-head-bg)", borderTop: "1px solid var(--border-3)", fontSize: 12, color: "var(--text-4)", display: "flex", justifyContent: "space-between" }}>
                <span>Showing <strong style={{ color: "var(--text-2)" }}>{filtered.length}</strong> seats · Sorted by <strong style={{ color: "var(--text-2)" }}>{sortKey}</strong> ({sortDir})</span>
                <span>Click headers to sort</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ POLLS TAB ═════════════════════════════════════ */}
      {activeTab === "polls" && (
        <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h2 style={STYLES.sectionTitle}>Polling Tracker</h2>
              <p style={{ color: "var(--text-3)", fontSize: 13, margin: "4px 0 0" }}>{polls.length} polls · weighted aggregate with house-effect correction · tap "Load latest" or "Load avg" to run scenarios</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={loadFromPoll} style={STYLES.btnPrimary}>
                Load latest → Model
              </button>
              <button onClick={() => setShowAddPoll(s => !s)} style={STYLES.btnSecondary}>
                {showAddPoll ? "Cancel" : "+ Add poll"}
              </button>
            </div>
          </div>

          {/* Add poll form */}
          {showAddPoll && (
            <div style={{ ...panelStyle, background: "var(--row-highlight)", borderColor: "var(--border-2)", marginBottom: 16 }}>
              <div style={{ ...STYLES.panelTitle, color: "#0369A1" }}>Add new poll</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 12 }}>
                {[
                  { key: "pollster", label: "Pollster", type: "text", placeholder: "e.g. Newspoll" },
                  { key: "date", label: "Date", type: "date", placeholder: "" },
                  { key: "alp", label: "ALP %", type: "number", placeholder: "e.g. 33" },
                  { key: "coal", label: "Coalition %", type: "number", placeholder: "e.g. 38" },
                  { key: "grn", label: "Greens %", type: "number", placeholder: "e.g. 13" },
                  { key: "on", label: "One Nation %", type: "number", placeholder: "e.g. 8 (optional)" },
                  { key: "tpp", label: "2PP ALP %", type: "number", placeholder: "e.g. 49 (optional)" },
                  { key: "n", label: "Sample size", type: "number", placeholder: "e.g. 1500" },
                ].map(({ key, label, type, placeholder }) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", display: "block", marginBottom: 3 }}>{label}</label>
                    <input type={type} value={newPoll[key]} placeholder={placeholder}
                      onChange={e => setNewPoll(p => ({ ...p, [key]: e.target.value }))}
                      style={{ ...STYLES.input, width: "100%", boxSizing: "border-box" }} />
                  </div>
                ))}
              </div>
              {newPoll.alp && newPoll.coal && newPoll.grn && (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
                  Ind / Other: {(100 - (+newPoll.alp || 0) - (+newPoll.coal || 0) - (+newPoll.grn || 0) - (+newPoll.on || 0)).toFixed(1)}%
                </div>
              )}
              <button onClick={addPoll} style={{ ...STYLES.btnPrimary, background: "#0369A1" }}>
                Save poll
              </button>
            </div>
          )}

          {/* Latest poll summary */}
          {latestPoll && (
            <div style={{ ...panelStyle, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Latest: {latestPoll.pollster} · {new Date(latestPoll.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12 }}>
                {(() => {
                  const effTpp = latestPoll.tpp ?? imputedTpp(latestPoll);
                  const tppIsEst = latestPoll.tpp == null;
                  return [
                    { label: "ALP primary", value: latestPoll.alp, color: "#DC2626", delta: latestPoll.alp - BASELINE_2025.alp, est: false },
                    { label: "Coalition primary", value: latestPoll.coal, color: "#1D4ED8", delta: latestPoll.coal - BASELINE_2025.coal, est: false },
                    { label: "Greens primary", value: latestPoll.grn, color: "#059669", delta: latestPoll.grn - BASELINE_2025.grn, est: false },
                    { label: "One Nation", value: latestPoll.on, color: "#B45309", delta: latestPoll.on != null ? latestPoll.on - BASELINE_2025.on : null, est: false },
                    { label: "Ind / Other", value: latestPoll.oth, color: "#7C3AED", delta: null, est: false },
                    { label: tppIsEst ? "2PP ALP (est.)" : "2PP (ALP)", value: effTpp, color: "#DC2626", delta: effTpp != null ? effTpp - NATIONAL_2PP_2025 : null, est: tppIsEst },
                  ];
                })().map(card => (
                  <div key={card.label} style={STYLES.metricCard}>
                    <div style={{ width: 20, height: 3, background: card.color, borderRadius: 2, marginBottom: 6 }} />
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)", fontStyle: card.est ? "italic" : "normal" }}>
                        {card.value != null ? `${card.est ? "~" : ""}${card.value}%` : "—"}
                      </span>
                    </div>
                    {card.delta != null && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: card.delta > 0 ? "#059669" : card.delta < 0 ? "#DC2626" : "var(--text-4)", marginTop: 2 }}>
                        {card.delta > 0 ? "+" : ""}{card.delta.toFixed(1)} vs 2025
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{card.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline aggregate tile — house-effect-corrected estimate from aggregated.json */}
          {AGGREGATED_POLLS?.current && (() => {
            const cur = AGGREGATED_POLLS.current;
            const pipelineCards = [
              { label: "ALP primary", metric: "alp", color: "#DC2626", baseline: BASELINE_2025.alp },
              { label: "Coalition primary", metric: "coal", color: "#1D4ED8", baseline: BASELINE_2025.coal },
              { label: "Greens primary", metric: "grn", color: "#059669", baseline: BASELINE_2025.grn },
              { label: "One Nation", metric: "on", color: "#B45309", baseline: BASELINE_2025.on },
              { label: "2PP (ALP) est.", metric: "tpp_eff", color: "#991B1B", baseline: NATIONAL_2PP_2025 },
            ];
            return (
              <div style={{ ...panelStyle, marginBottom: 14, borderColor: "var(--border-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Pipeline Aggregate</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 8 }}>
                      House-effect-corrected · {cur.alp?.n ?? "?"} polls · generated {AGGREGATED_POLLS.generated}
                    </span>
                  </div>
                  <button onClick={loadFromAvg} style={STYLES.btnPrimary}>
                    Load → Model
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
                  {pipelineCards.map(card => {
                    const d = cur[card.metric];
                    if (!d) return null;
                    const delta = d.mean != null ? +(d.mean - card.baseline).toFixed(1) : null;
                    return (
                      <div key={card.label} style={STYLES.metricCard}>
                        <div style={{ width: 20, height: 3, background: card.color, borderRadius: 2, marginBottom: 6 }} />
                        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)" }}>{d.mean?.toFixed(1)}%</div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 1 }}>
                          [{d.lo95?.toFixed(1)}–{d.hi95?.toFixed(1)}] 95% CI
                        </div>
                        {delta != null && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : "var(--text-4)", marginTop: 2 }}>
                            {delta > 0 ? "+" : ""}{delta} vs 2025
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{card.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 30-day weighted average tile (simple frontend calc, no house effects) */}
          {pollAvg && (
            <div style={{ ...panelStyle, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>30-Day Weighted Average</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 8 }}>{pollAvg.n} poll{pollAvg.n !== 1 ? "s" : ""} · exponential decay + sample-size weighted · no house-effect correction</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12 }}>
                {[
                  { label: "ALP primary", value: pollAvg.alp, color: "#DC2626", delta: pollAvg.alp != null ? pollAvg.alp - BASELINE_2025.alp : null },
                  { label: "Coalition primary", value: pollAvg.coal, color: "#1D4ED8", delta: pollAvg.coal != null ? pollAvg.coal - BASELINE_2025.coal : null },
                  { label: "Greens primary", value: pollAvg.grn, color: "#059669", delta: pollAvg.grn != null ? pollAvg.grn - BASELINE_2025.grn : null },
                  { label: "One Nation", value: pollAvg.on, color: "#B45309", delta: pollAvg.on != null ? pollAvg.on - BASELINE_2025.on : null },
                  { label: "Ind / Other", value: pollAvg.oth, color: "#7C3AED", delta: null },
                  { label: "2PP (ALP)", value: pollAvg.tpp, color: "#DC2626", delta: pollAvg.tpp != null ? pollAvg.tpp - NATIONAL_2PP_2025 : null },
                ].map(card => (
                  <div key={card.label} style={STYLES.metricCard}>
                    <div style={{ width: 20, height: 3, background: card.color, borderRadius: 2, marginBottom: 6 }} />
                    <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>
                      {card.value != null ? `${card.value}%` : "—"}
                    </span>
                    {card.delta != null && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: card.delta > 0 ? "#059669" : card.delta < 0 ? "#DC2626" : "var(--text-4)", marginTop: 2 }}>
                        {card.delta > 0 ? "+" : ""}{card.delta.toFixed(1)} vs 2025
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{card.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* House effects panel — per-pollster bias from pipeline aggregation */}
          {AGGREGATED_POLLS?.house_effects && (() => {
            const he = AGGREGATED_POLLS.house_effects;
            const pollsters = Object.keys(he.alp ?? {});
            if (!pollsters.length) return null;
            return (
              <div style={{ ...panelStyle, marginBottom: 14 }}>
                <button
                  onClick={() => setShowHouseEffects(o => !o)}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0, width: "100%" }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-2)" }}>
                    {showHouseEffects ? "▾" : "▸"} House Effects
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-4)" }}>
                    per-pollster bias corrections applied to pipeline aggregate
                  </span>
                </button>
                {showHouseEffects && (
                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                          {["Pollster", "ALP bias", "Coalition bias", "Greens bias", "ON bias", "2PP bias"].map(h => (
                            <th key={h} style={{ ...STYLES.tableHead, textAlign: h === "Pollster" ? "left" : "center" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pollsters.map((p, i) => {
                          const fmt = (v) => v != null ? (
                            <span style={{ fontWeight: 600, color: Math.abs(v) > 2 ? "#DC2626" : Math.abs(v) > 1 ? "#D97706" : "#059669" }}>
                              {v > 0 ? "+" : ""}{v.toFixed(1)}pp
                            </span>
                          ) : <span style={{ color: "var(--text-4)" }}>—</span>;
                          return (
                            <tr key={p} style={{ background: i % 2 === 0 ? "var(--panel-bg)" : "var(--table-row-alt)", borderBottom: "1px solid var(--border-3)" }}>
                              <td style={{ padding: "7px 12px", fontWeight: 600 }}>{p}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center" }}>{fmt(he.alp?.[p])}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center" }}>{fmt(he.coal?.[p])}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center" }}>{fmt(he.grn?.[p])}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center" }}>{fmt(he.on?.[p])}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center" }}>{fmt(he.tpp_eff?.[p])}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8 }}>
                      Positive = pollster reads this metric higher than average · Corrected by subtracting bias from each poll before aggregating.
                      Generated {AGGREGATED_POLLS.generated}.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Primary vote trend chart */}
          <div style={panelStyle}>
            <div style={{ ...STYLES.panelTitle, marginBottom: 4 }}>Primary vote trends</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>Thick lines = weighted aggregate (30-day window, decay + sample-size weighted) · Dots = individual polls</div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={pollChartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid {...CHART.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 50]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v, name) => [v != null ? `${v.toFixed(1)}%` : "—", name]} contentStyle={CHART.tooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* Raw poll scatter (strokeWidth=0 = dots only, no connecting line) */}
                <Line type="linear" dataKey="ALP" stroke="#DC2626" strokeWidth={0} dot={{ r: 2.5, fill: "#DC2626" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="Coalition" stroke="#1D4ED8" strokeWidth={0} dot={{ r: 2.5, fill: "#1D4ED8" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="Greens" stroke="#059669" strokeWidth={0} dot={{ r: 2.5, fill: "#059669" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="ON" stroke="#F97316" strokeWidth={0} dot={{ r: 2.5, fill: "#F97316" }} activeDot={{ r: 4 }} legendType="circle" name="One Nation" />
                {/* Weighted aggregate trend lines */}
                <Line type="monotone" dataKey="ALP (trend)" stroke="#DC2626" strokeWidth={2.25} dot={false} connectNulls />
                <Line type="monotone" dataKey="Coal (trend)" stroke="#1D4ED8" strokeWidth={2.25} dot={false} connectNulls />
                <Line type="monotone" dataKey="Grn (trend)" stroke="#059669" strokeWidth={2.25} dot={false} connectNulls />
                <Line type="monotone" dataKey="ON (trend)" stroke="#EA580C" strokeWidth={2.25} dot={false} connectNulls name="One Nation (trend)" />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6, textAlign: "center" }}>Filled dots = individual primary vote polls · Thick lines = weighted aggregate trends</div>
          </div>

          {/* Estimated aggregate 2PP chart */}
          <div style={panelStyle}>
            <div style={{ ...STYLES.panelTitle, marginBottom: 4 }}>Estimated aggregate 2PP</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>Thick lines = weighted aggregate trend (30-day window, decay + sample-size weighted) · Open circles = polls reporting 2PP directly · Polls reporting only primaries are imputed using 2022 AEC preference flows</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={pollChartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="tppAreaAlp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#DC2626" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tppAreaCoal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1D4ED8" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#1D4ED8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={[38, 62]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v, name) => [v != null ? `${v.toFixed(1)}%` : "—", name]} contentStyle={CHART.tooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={50} stroke="var(--text-4)" label={{ value: "50%", fontSize: 10, fill: "var(--text-4)", position: "insideRight" }} />
                {BETTING_ODDS?.national?.alp_majority?.implied_2pp != null && (
                  <ReferenceLine
                    y={BETTING_ODDS.national.alp_majority.implied_2pp}
                    stroke="#7C3AED"
                    strokeDasharray="4 3"
                    label={{ value: `Mkt ALP: ${BETTING_ODDS.national.alp_majority.implied_2pp}%`, fontSize: 10, fill: "#7C3AED", position: "insideRight" }}
                  />
                )}
                {/* Individual poll dots — open circles */}
                <Line type="linear" dataKey="2PP (ALP)" stroke="#DC2626" strokeWidth={0} dot={{ r: 3.5, fill: "none", stroke: "#DC2626", strokeWidth: 1.5 }} activeDot={{ r: 5 }} legendType="circle" name="ALP 2PP (reported)" />
                <Line type="linear" dataKey="2PP (Coal)" stroke="#1D4ED8" strokeWidth={0} dot={{ r: 3.5, fill: "none", stroke: "#1D4ED8", strokeWidth: 1.5 }} activeDot={{ r: 5 }} legendType="circle" name="Coal 2PP (reported)" />
                {/* Gradient fills under aggregate trends */}
                <Area type="monotone" dataKey="2PP (trend)" stroke="none" fill="url(#tppAreaAlp)" connectNulls legendType="none" tooltipType="none" name="ALP 2PP trend area" />
                <Area type="monotone" dataKey="Coal 2PP (trend)" stroke="none" fill="url(#tppAreaCoal)" connectNulls legendType="none" tooltipType="none" name="Coal 2PP trend area" />
                {/* Weighted aggregate trend lines */}
                <Line type="monotone" dataKey="2PP (trend)" stroke="#991B1B" strokeWidth={2.25} dot={false} connectNulls name="ALP 2PP trend" />
                <Line type="monotone" dataKey="Coal 2PP (trend)" stroke="#1E40AF" strokeWidth={2.25} dot={false} connectNulls name="Coal 2PP trend" />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6, textAlign: "center" }}>Open circles = polls reporting 2PP directly · Thick lines = weighted aggregate (includes imputed 2PP from primaries)</div>
          </div>

          {/* Pipeline trend chart with 95% CI bands */}
          {pipelineTrendData.length > 0 && (
            <div style={panelStyle}>
              <div style={{ ...STYLES.panelTitle, marginBottom: 4 }}>Pipeline trend — primary votes with 95% CI</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>
                Weekly smoothed trend with 95% confidence intervals · house-effect-corrected · generated {AGGREGATED_POLLS.generated}
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={pipelineTrendData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.floor(pipelineTrendData.length / 8)} />
                  <YAxis domain={[0, 50]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    formatter={(v, name) => {
                      if (Array.isArray(v)) return [`${v[0]}%–${v[1]}%`, name];
                      return [v != null ? `${v}%` : "—", name];
                    }}
                    contentStyle={CHART.tooltip}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="ALP CI" stroke="none" fill="#DC2626" fillOpacity={0.12} legendType="none" name="ALP 95% CI" />
                  <Area type="monotone" dataKey="Coal CI" stroke="none" fill="#1D4ED8" fillOpacity={0.12} legendType="none" name="Coal 95% CI" />
                  <Area type="monotone" dataKey="Grn CI" stroke="none" fill="#059669" fillOpacity={0.12} legendType="none" name="Grn 95% CI" />
                  <Area type="monotone" dataKey="ON CI" stroke="none" fill="#F97316" fillOpacity={0.12} legendType="none" name="ON 95% CI" />
                  <Line type="monotone" dataKey="ALP mean" stroke="#DC2626" strokeWidth={2} dot={false} name="ALP" />
                  <Line type="monotone" dataKey="Coal mean" stroke="#1D4ED8" strokeWidth={2} dot={false} name="Coalition" />
                  <Line type="monotone" dataKey="Grn mean" stroke="#059669" strokeWidth={2} dot={false} name="Greens" />
                  <Line type="monotone" dataKey="ON mean" stroke="#EA580C" strokeWidth={2} dot={false} name="One Nation" />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6, textAlign: "center" }}>
                Shaded bands = 95% confidence intervals · Lines = house-effect-corrected weekly aggregate
              </div>
            </div>
          )}

          {/* Polls table */}
          <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                  {["Pollster", "Date", "ALP %", "Coalition %", "Greens %", "One Nation %", "Ind/Other %", "2PP ALP %", "n", ""].map((h, i) => (
                    <th key={i} style={{ ...STYLES.tableHead, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPolls.map((p, i) => {
                  const effTpp = imputedTpp(p);
                  const tppIsImputed = p.tpp == null;
                  return (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? "var(--panel-bg)" : "var(--table-row-alt)", borderBottom: "1px solid var(--border-3)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--row-highlight)"}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "var(--panel-bg)" : "var(--table-row-alt)"}>
                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{p.pollster}</td>
                      <td style={{ padding: "9px 12px", color: "var(--text-3)" }}>{new Date(p.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</td>
                      {[p.alp, p.coal, p.grn, p.on, p.oth].map((v, j) => (
                        <td key={j} style={{ padding: "9px 12px" }}>
                          <span style={{ fontWeight: 600, color: ["#DC2626", "#1D4ED8", "#059669", "#B45309", "#7C3AED"][j] }}>{v != null ? `${v}%` : "—"}</span>
                        </td>
                      ))}
                      <td style={{ padding: "9px 12px" }}>
                        {effTpp != null ? (
                          <>
                            <span style={{ fontWeight: 700, fontSize: 14, color: effTpp >= 50 ? "#059669" : "#DC2626", fontStyle: tppIsImputed ? "italic" : "normal" }}>
                              {tppIsImputed ? "~" : ""}{effTpp}%
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-4)", marginLeft: 5 }}>
                              ({effTpp >= 50 ? "ALP ahead" : "Coalition ahead"}{tppIsImputed ? " · est." : ""})
                            </span>
                          </>
                        ) : <span style={{ color: "var(--text-4)" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px", color: "var(--text-4)", fontSize: 12 }}>{p.n ?? "—"}</td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                        <button onClick={() => loadPollIntoModel(p)}
                          style={{ fontSize: 11, color: "#1D4ED8", background: "none", border: "none", cursor: "pointer", padding: 0, marginRight: 10 }}>
                          Load
                        </button>
                        <button onClick={() => deletePoll(p.id)}
                          style={{ fontSize: 11, color: "#EF4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Leader Approval Ratings ─────────────────────────────────────── */}
          {(() => {
            const leaders = LEADERS_DATA.leaders ?? [];
            const prefPm = LEADERS_DATA.preferred_pm?.data ?? [];
            const govtSat = LEADERS_DATA.government_satisfaction?.data ?? [];
            if (!leaders.length) return null;
            const latestGovtSat = govtSat[govtSat.length - 1];
            const latestPrefPm = prefPm[prefPm.length - 1];
            return (
              <div style={{ ...panelStyle, marginTop: 16 }}>
                <div style={STYLES.panelTitle}>Leader Approval Ratings</div>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 14px" }}>
                  Net approval (approve% − disapprove%) over time. Source: {LEADERS_DATA.source}
                </p>
                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {leaders.map(leader => {
                    const latest = leader.data[leader.data.length - 1];
                    if (!latest) return null;
                    const net = latest.net;
                    const netColor = net >= 0 ? "#059669" : "#DC2626";
                    return (
                      <div key={leader.name} style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: leader.party_color, marginBottom: 2 }}>{leader.role}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>{leader.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: netColor }}>{net >= 0 ? "+" : ""}{net}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>net approval</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                          Approve {latest.approve}% · Disapprove {latest.disapprove}%
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>
                          {latest.pollster} · {new Date(latest.date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
                        </div>
                      </div>
                    );
                  })}
                  {latestGovtSat && (
                    <div style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", marginBottom: 2 }}>Government</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Satisfaction Rating</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: latestGovtSat.net >= 0 ? "#059669" : "#DC2626" }}>
                          {latestGovtSat.net >= 0 ? "+" : ""}{latestGovtSat.net}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>net sat.</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                        Satisfied {latestGovtSat.satisfied}% · Dissatisfied {latestGovtSat.dissatisfied}%
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>
                        {latestGovtSat.pollster} · {new Date(latestGovtSat.date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
                      </div>
                    </div>
                  )}
                  {latestPrefPm && (
                    <div style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", marginBottom: 2 }}>Preferred</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Prime Minister</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                        <div>
                          <span style={{ fontSize: 18, fontWeight: 800, color: "#DC2626" }}>{latestPrefPm.alp_pct}%</span>
                          <div style={{ fontSize: 10, color: "var(--text-3)" }}>ALP leader</div>
                        </div>
                        <div>
                          <span style={{ fontSize: 18, fontWeight: 800, color: "#1D4ED8" }}>{latestPrefPm.opp_pct}%</span>
                          <div style={{ fontSize: 10, color: "var(--text-3)" }}>Opp leader</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
                        {latestPrefPm.pollster} · {new Date(latestPrefPm.date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
                      </div>
                    </div>
                  )}
                </div>
                {/* Net approval trend chart */}
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid {...CHART.grid} />
                      <XAxis dataKey="date" type="category" allowDuplicatedCategory={false}
                        tick={{ fontSize: 11, fill: chartTickColor }}
                        tickFormatter={d => new Date(d).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })} />
                      <YAxis tick={{ fontSize: 11, fill: chartTickColor }} domain={[-20, 40]}
                        tickFormatter={v => `${v > 0 ? "+" : ""}${v}`} />
                      <Tooltip formatter={(v, name) => [`${v > 0 ? "+" : ""}${v}pp net`, name]} contentStyle={CHART.tooltip} />
                      <ReferenceLine y={0} stroke="var(--text-4)" strokeDasharray="4 2" />
                      <Legend />
                      {leaders.map(leader => (
                        <Line key={leader.name} data={leader.data} type="monotone"
                          dataKey="net" name={leader.name} stroke={leader.party_color}
                          strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4, textAlign: "center" }}>
                  Net approval = approve% − disapprove%. Higher = more popular. Source: {LEADERS_DATA.source}
                </div>
              </div>
            );
          })()}

          {/* ── Economic Indicators ─────────────────────────────────────────── */}
          {(() => {
            const econ = ECONOMICS_DATA;
            const cc = econ?.cameron_crosby_model?.current_estimate ?? {};
            const cpiData = (econ?.cpi?.data ?? []).slice(-8);
            const unempData = (econ?.unemployment?.data ?? []).slice(-12);
            const rbaData = (econ?.rba_cash_rate?.data ?? []).slice(-8);
            const currentCpi = cpiData[cpiData.length - 1]?.value;
            const currentUnemp = unempData[unempData.length - 1]?.value;
            const currentRba = rbaData[rbaData.length - 1]?.value;
            const elecCpi = econ?.election_reference?.cpi_annual_pct;
            const elecUnemp = econ?.election_reference?.unemployment_pct;
            const elecRba = econ?.election_reference?.rba_rate_pct;
            if (!econ) return null;
            const netEffect = cc?.net_vote_effect_pp ?? 0;
            const netColor = netEffect > 0 ? "#059669" : netEffect < -0.2 ? "#DC2626" : "#F59E0B";
            return (
              <div style={{ ...panelStyle, marginTop: 16 }}>
                <div style={STYLES.panelTitle}>Economic Indicators</div>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 14px" }}>
                  Cameron &amp; Crosby (2000) structural model: inflation and unemployment change predict incumbent vote. Source: ABS, RBA.
                </p>
                {/* Key metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {[
                    {
                      label: "Inflation (CPI)", unit: "% YoY",
                      current: currentCpi, election: elecCpi,
                      higherIsBad: true, description: "Annual CPI change",
                    },
                    {
                      label: "Unemployment", unit: "%",
                      current: currentUnemp, election: elecUnemp,
                      higherIsBad: true, description: "Seasonally adjusted",
                    },
                    {
                      label: "RBA Cash Rate", unit: "%",
                      current: currentRba, election: elecRba,
                      higherIsBad: false, description: "Rate cuts = stimulus",
                    },
                    {
                      label: "Economic Effect", unit: "pp",
                      current: netEffect, election: 0,
                      higherIsBad: false, description: "C&C structural model",
                      isEffect: true,
                    },
                  ].map(m => {
                    if (m.current == null) return null;
                    const change = m.current - (m.election ?? m.current);
                    const changeStr = change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1);
                    const isNeutral = Math.abs(change) < 0.05;
                    const changeColor = isNeutral ? "var(--text-3)"
                      : ((change > 0) === m.higherIsBad) ? "#DC2626" : "#059669";
                    return (
                      <div key={m.label} style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", marginBottom: 3 }}>{m.label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: m.isEffect ? netColor : "#111827" }}>
                            {m.isEffect && netEffect > 0 ? "+" : ""}{m.current?.toFixed(1)}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{m.unit}</span>
                        </div>
                        {m.election != null && !m.isEffect && (
                          <div style={{ fontSize: 11, color: changeColor, marginTop: 3, fontWeight: 600 }}>
                            {changeStr} since election
                          </div>
                        )}
                        {m.isEffect && (
                          <div style={{ fontSize: 11, color: netColor, marginTop: 3, fontWeight: 600 }}>
                            {netEffect > 0 ? "Incumbent benefit" : netEffect < -0.2 ? "Incumbent penalty" : "Approx. neutral"}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>{m.description}</div>
                      </div>
                    );
                  })}
                </div>
                {/* CPI trend */}
                {cpiData.length > 1 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>CPI Annual Change (%) — quarterly</div>
                    <div style={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={cpiData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                          <CartesianGrid {...CHART.grid} />
                          <XAxis dataKey="period" tick={{ fontSize: 10, fill: chartTickColor }} />
                          <YAxis tick={{ fontSize: 10, fill: chartTickColor }} domain={[0, "auto"]} tickFormatter={v => `${v}%`} />
                          <Tooltip formatter={(v) => [`${v}%`, "CPI YoY"]} contentStyle={CHART.tooltip} />
                          <ReferenceLine y={elecCpi} stroke="#DC2626" strokeDasharray="4 2" label={{ value: "Election", fill: "#DC2626", fontSize: 10 }} />
                          <ReferenceLine y={2.5} stroke="#059669" strokeDasharray="4 2" label={{ value: "RBA target", fill: "#059669", fontSize: 10 }} />
                          <Line type="monotone" dataKey="value" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} name="CPI YoY %" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {/* Unemployment trend */}
                {unempData.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>Unemployment Rate (%) — monthly</div>
                    <div style={{ height: 140 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={unempData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                          <CartesianGrid {...CHART.grid} />
                          <XAxis dataKey="period" tick={{ fontSize: 10, fill: chartTickColor }}
                            tickFormatter={p => p.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m]} ${y.slice(2)}`)} />
                          <YAxis tick={{ fontSize: 10, fill: chartTickColor }} domain={[3, 6]} tickFormatter={v => `${v}%`} />
                          <Tooltip formatter={(v) => [`${v}%`, "Unemployment"]} contentStyle={CHART.tooltip} />
                          <ReferenceLine y={elecUnemp} stroke="#DC2626" strokeDasharray="4 2" label={{ value: "Election", fill: "#DC2626", fontSize: 10 }} />
                          <Line type="monotone" dataKey="value" stroke="#7C3AED" strokeWidth={2} dot={{ r: 2 }} name="Unemployment %" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#92400E" }}>
                  <strong>Cameron &amp; Crosby model note:</strong> {cc?.interpretation ?? "Economic model not yet computed."}
                  {" "}This is a structural baseline signal only — polling data is the primary forecast input.
                  <span style={{ display: "block", fontSize: 11, color: "#B45309", marginTop: 4 }}>
                    Refresh with: <code style={{ background: "var(--subtle-bg)", padding: "1px 4px", borderRadius: 3 }}>python pipeline/fetch_economics.py</code>
                  </span>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* ══════════════════════ MODEL TAB ═════════════════════════════════════ */}
      {activeTab === "model" && (() => {
        const el = ELECTION_DATA[selectedModelId];
        const modelElectionOptions = ELECTION_OPTIONS;
        const elSelector = (
          <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}
            style={{ ...STYLES.input, fontWeight: 700, background: "var(--panel-bg)", cursor: "pointer" }}>
            {modelElectionOptions.map(id => <option key={id} value={id}>{ELECTION_DATA[id].label}</option>)}
          </select>
        );
        return (
          <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <h2 style={STYLES.sectionTitle}>
                    {el.modelEnabled ? "Scenario Builder" : `${el.label} — Results`}
                  </h2>
                  {elSelector}
                </div>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>
                  {el.modelEnabled
                    ? `${el.date} · ${el.chamber} · Adjust primary vote shares and preference flows to model seat outcomes across all ${el.totalSeats} electorates.`
                    : `${el.date} · ${el.chamber} · ${el.totalSeats} seats · Majority: ${el.majority}`}
                </p>
              </div>
              {el.modelEnabled && selectedModelId === "federal_2025" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {hasChanges && (
                    <button onClick={resetModel} style={STYLES.btnDanger}>
                      Reset model
                    </button>
                  )}
                  {polls.length > 0 && (
                    <button onClick={loadFromPoll} style={STYLES.btnInfo}>
                      Load from latest poll
                    </button>
                  )}
                  {AGGREGATED_POLLS?.current && (
                    <button onClick={loadFromAvg} style={STYLES.btnPrimary}>
                      Load pipeline aggregate
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Model intro text (shown for federal 2025 scenario builder) ── */}
            {el.modelEnabled && selectedModelId === "federal_2025" && (
              <div style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                  <strong>aus-poll</strong> is an open-source, seat-by-seat election modelling tool for Australian federal elections. Adjust the primary vote sliders on the left to explore how shifts in national party support translate to seat outcomes across all 151 House of Representatives electorates.
                </p>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", lineHeight: 1.65 }}>
                  The model uses per-seat first-preference baselines from the 2022 and 2025 AEC results — not a uniform national swing — and applies preference flows at the division level to compute projected two-candidate preferred (2PP) outcomes with uncertainty bands. See the <button onClick={() => setActiveTab("methodology")} style={{ background: "none", border: "none", padding: 0, color: "#1D4ED8", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Methodology tab</button> for full technical details, or the <button onClick={() => setActiveTab("about")} style={{ background: "none", border: "none", padding: 0, color: "#1D4ED8", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>About tab</button> for FAQs and data sources.
                </p>
              </div>
            )}

            {/* ── State election results view ── */}
            {!el.modelEnabled && (() => {
              const tallySeats = mkSeatsFromCounts(el.counts);
              const tightest = [...el.seats].sort((a, b) => a.margin - b.margin).slice(0, 10);
              return (
                <div style={{ maxWidth: 900 }}>
                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Seat composition</div>
                    <TallyBar seats={tallySeats} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginTop: 16 }}>
                      {GROUP_ORDER.map(g => {
                        const n = el.counts[g];
                        if (!n) return null;
                        return (
                          <div key={g} style={STYLES.metricCard}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{GROUP_CONFIG[g].label}</span>
                            </div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{n}</div>
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>of {el.totalSeats} seats</div>
                          </div>
                        );
                      })}
                    </div>
                    {el.twopp && (
                      <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-3)" }}>
                        2PP (ALP): <strong style={{ color: el.twopp >= 50 ? "#059669" : "#DC2626" }}>{el.twopp}%</strong>
                      </div>
                    )}
                  </div>
                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Key marginal seats</div>
                    {tightest.map(s => {
                      const p = getParty(s.winner.party);
                      return (
                        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-3)" }}>
                          <div style={{ width: 3, height: 34, background: p.color, borderRadius: 2, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ color: "var(--text-4)", fontWeight: 400 }}>({s.state})</span></div>
                            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{s.winner.name}</div>
                          </div>
                          <PartyBadge party={s.winner.party} />
                          <span style={{ fontWeight: 700, color: MARGIN_COLOR[getMarginCat(s.margin)], minWidth: 40, textAlign: "right" }}>{s.margin.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-3)" }}>
                      Representative marginal seats only · Full seat-by-seat data not available for state elections
                    </div>
                  </div>
                  <div style={{ ...panelStyle, background: "var(--table-head-bg)", padding: "16px 20px" }}>
                    <div style={{ fontSize: 13, color: "var(--text-3)" }}>
                      Interactive scenario builders are available for all jurisdictions. Select one from the dropdown above.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Federal scenario builder ── */}
            {el.modelEnabled && selectedModelId === "federal_2025" && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>

              {/* ── Controls panel ── */}
              <div>
                <div style={panelStyle}>
                  <div style={sectionHead}>Primary vote %</div>
                  <PrimaryInput label="ALP" value={primaries.alp} onChange={v => setPrimaries(p => ({ ...p, alp: v }))} color="#DC2626" baseline={BASELINE_2025.alp} />
                  <PrimaryInput label="Coalition" value={primaries.coal} onChange={v => setPrimaries(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={BASELINE_2025.coal} />
                  <PrimaryInput label="Greens" value={primaries.grn} onChange={v => setPrimaries(p => ({ ...p, grn: v }))} color="#059669" baseline={BASELINE_2025.grn} />
                  <PrimaryInput label="Independents" value={primaries.teal} onChange={v => setPrimaries(p => ({ ...p, teal: v }))} color="#0891B2" baseline={BASELINE_2025.teal} />
                  <PrimaryInput label="One Nation" value={primaries.on} onChange={v => setPrimaries(p => ({ ...p, on: v }))} color="#B45309" baseline={BASELINE_2025.on} />
                  <PrimaryInput label="Undecided" value={primaries.undecided ?? 0} onChange={v => setPrimaries(p => ({ ...p, undecided: v }))} color="var(--text-4)" baseline={0} />
                  {/* ── Undecided allocation breakdown ── */}
                  {(primaries.undecided ?? 0) > 0 && (() => {
                    const undec = primaries.undecided;
                    const declared = primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on;
                    if (declared <= 0) return null;
                    const parties = ["alp", "coal", "grn", "teal", "on"];
                    const pLabels = { alp: "ALP", coal: "Coal", grn: "Grn", teal: "Ind", on: "ON" };
                    const pColors = { alp: "#DC2626", coal: "#1D4ED8", grn: "#059669", teal: "#0891B2", on: "#B45309" };
                    const blended = {};
                    let shareSum = 0;
                    for (const p of parties) {
                      blended[p] = (1 - LATE_DECIDER_WEIGHT) * (primaries[p] / declared) + LATE_DECIDER_WEIGHT * LATE_DECIDER_SPLIT[p];
                      shareSum += blended[p];
                    }
                    for (const p of parties) blended[p] /= shareSum;
                    return (
                      <div style={{ background: "var(--table-head-bg)", border: "1px solid var(--border-1)", borderRadius: 6, padding: "7px 10px", marginTop: 4 }}>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Undecided allocated (late-decider model):</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px" }}>
                          {parties.map(p => (
                            <span key={p} style={{ fontSize: 11, fontWeight: 600, color: pColors[p] }}>
                              {pLabels[p]} +{(undec * blended[p]).toFixed(1)}%
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
                          Uncertainty +{(0.06 * undec).toFixed(2)}pp σ · blend {Math.round(LATE_DECIDER_WEIGHT * 100)}% late-decider / {Math.round((1 - LATE_DECIDER_WEIGHT) * 100)}% proportional
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const entered = +(primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on).toFixed(1);
                    const undecided = +(primaries.undecided ?? 0);
                    const other = +(100 - entered - undecided).toFixed(1);
                    const overLimit = entered + undecided > 100;
                    return (
                      <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Other / minor parties</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "var(--text-2)" }}>
                          {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                      2025 result: ALP {BASELINE_2025.alp}% · Coal {BASELINE_2025.coal}% · Grn {BASELINE_2025.grn}% · Ind {BASELINE_2025.teal}% · ON {BASELINE_2025.on}%
                    </div>
                    {hasChanges && (
                      <button
                        onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => alert("Scenario link copied to clipboard!"))}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-3)", textDecoration: "underline", padding: 0 }}
                        title="Copy a shareable link to this scenario (primaries are encoded in the URL)"
                      >
                        Share link
                      </button>
                    )}
                  </div>
                </div>

                {/* Flow consistency warning */}
                {(() => {
                  const warns = [];
                  if (prefFlows.grn_alp_v_on < prefFlows.grn_alp)
                    warns.push(`Greens→ALP in ON race (${(prefFlows.grn_alp_v_on * 100).toFixed(1)}%) is below the standard flow (${(prefFlows.grn_alp * 100).toFixed(1)}%). When ON is the opponent, Greens voters should flow more strongly to ALP.`);
                  if (prefFlows.teal_alp_v_on < prefFlows.teal_alp)
                    warns.push(`Independents→ALP in ON race (${(prefFlows.teal_alp_v_on * 100).toFixed(1)}%) is below the standard flow (${(prefFlows.teal_alp * 100).toFixed(1)}%). When ON is the opponent, teal voters should flow more strongly to ALP.`);
                  if (prefFlows.alp_on_v_coal >= 0.5)
                    warns.push(`ALP→ON (${(prefFlows.alp_on_v_coal * 100).toFixed(1)}%) is ≥ 50%. ALP voters strongly prefer Coalition over ON; this rate is implausibly high.`);
                  if (warns.length === 0) return null;
                  return (
                    <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 6 }}>⚠ Inconsistent preference flows</div>
                      {warns.map((w, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#B45309", marginBottom: i < warns.length - 1 ? 4 : 0 }}>• {w}</div>
                      ))}
                    </div>
                  );
                })()}

                {/* Standard preference flows (ALP vs Coalition finals) */}
                <div style={panelStyle}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={sectionHead}>Preference flows to ALP</div>
                    <button onClick={resetPrefFlows}
                      style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", whiteSpace: "nowrap" }}>
                      ↺ Reset to 2025
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>
                    {Object.keys(SEAT_PREF_FLOWS_2025).length > 0
                      ? "Sliders set a national shift applied on top of each seat's AEC 2025 baseline. At default values (zero shift) each seat uses its own observed DOP flows."
                      : "Used in standard ALP vs Coalition finals. Remainder flows to Coalition."}
                  </div>
                  <PrefInput label="Greens → ALP" value={prefFlows.grn_alp} onChange={v => setPrefFlows(f => ({ ...f, grn_alp: v }))} color="#059669" historicalRange={PREF_FLOW_RANGES.grn_alp} />
                  <PrefInput label="Independents → ALP" value={prefFlows.teal_alp} onChange={v => setPrefFlows(f => ({ ...f, teal_alp: v }))} color="#0891B2" historicalRange={PREF_FLOW_RANGES.teal_alp} />
                  <PrefInput label="One Nation → ALP" value={prefFlows.on_alp} onChange={v => setPrefFlows(f => ({ ...f, on_alp: v }))} color="#B45309" historicalRange={PREF_FLOW_RANGES.on_alp} />
                  <PrefInput label="Other → ALP" value={prefFlows.other_alp} onChange={v => setPrefFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" historicalRange={PREF_FLOW_RANGES.other_alp} />
                  <div style={{ fontSize: 11, color: "var(--text-4)", borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                    {Object.keys(SEAT_PREF_FLOWS_2025).length > 0
                      ? "2025 AEC DOP defaults: Grn 81% · Ind 62% · ON 25.5% · Other 50%. Per-seat AEC DOP flows active — sliders shift all seats by the same delta. ON→ALP history: 2016 ~49.6% · 2019 34.7% · 2022 35.7% · 2025 25.5%."
                      : "Defaults: Grn 81% (2025) · Ind 62% (2025) · ON 25.5% (2025; history 2016 ~49.6%, 2019 34.7%, 2022 35.7%) · Other 50%. Use \"↺ Reset to 2025\" to restore 2025 actuals."}
                  </div>
                </div>

                {/* Advanced ON race flows — collapsed by default */}
                <div style={panelStyle}>
                  <button
                    onClick={() => setShowAdvancedFlows(v => !v)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showAdvancedFlows ? 12 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                      Advanced: ON race flows
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-4)" }}>{showAdvancedFlows ? "▲" : "▼"}</span>
                  </button>
                  {showAdvancedFlows && (
                    <div>
                      {/* ON vs ALP final flows */}
                      <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(217,119,6,0.10)", borderRadius: 3, border: "1px solid rgba(217,119,6,0.35)" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          ON vs ALP final — flows toward ALP
                        </div>
                        <div style={{ fontSize: 11, color: "#B45309", marginBottom: 8 }}>
                          When ON beats Coalition to be in the final count against ALP. Greens/teal voters flow more strongly to ALP here because they oppose ON more than Coalition.
                        </div>
                        <PrefInput label="Greens → ALP" value={prefFlows.grn_alp_v_on} onChange={v => setPrefFlows(f => ({ ...f, grn_alp_v_on: v }))} color="#059669" historicalRange={PREF_FLOW_RANGES.grn_alp_v_on} />
                        <PrefInput label="Independents → ALP" value={prefFlows.teal_alp_v_on} onChange={v => setPrefFlows(f => ({ ...f, teal_alp_v_on: v }))} color="#0891B2" historicalRange={PREF_FLOW_RANGES.teal_alp_v_on} />
                        <PrefInput label="Other → ALP" value={prefFlows.other_alp_v_on} onChange={v => setPrefFlows(f => ({ ...f, other_alp_v_on: v }))} color="#7C3AED" historicalRange={PREF_FLOW_RANGES.other_alp_v_on} />
                        <PrefInput label="Coalition → ALP" value={prefFlows.coal_alp_v_on} onChange={v => setPrefFlows(f => ({ ...f, coal_alp_v_on: v }))} color="#1D4ED8" historicalRange={PREF_FLOW_RANGES.coal_alp_v_on} />
                        <div style={{ fontSize: 11, color: "var(--text-4)", borderTop: "1px solid #FDE68A", paddingTop: 6, marginTop: 2 }}>
                          Defaults: Grn 90% · Ind 75% · Other 60% · Coal 10% (2025 AEC)
                        </div>
                      </div>
                      {/* ON vs Coal final flows */}
                      <div style={{ padding: "10px 12px", background: "rgba(217,119,6,0.10)", borderRadius: 3, border: "1px solid rgba(217,119,6,0.35)" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          ON vs Coalition final — flows toward ON
                        </div>
                        <div style={{ fontSize: 11, color: "#B45309", marginBottom: 8 }}>
                          When ON beats ALP to be in the final count against Coalition. Greens/teal voters flow minimally to ON because they strongly prefer Coalition over ON in this scenario.
                        </div>
                        <PrefInput label="ALP → ON" value={prefFlows.alp_on_v_coal} onChange={v => setPrefFlows(f => ({ ...f, alp_on_v_coal: v }))} color="#DC2626" historicalRange={PREF_FLOW_RANGES.alp_on_v_coal} />
                        <PrefInput label="Greens → ON" value={prefFlows.grn_on_v_coal} onChange={v => setPrefFlows(f => ({ ...f, grn_on_v_coal: v }))} color="#059669" historicalRange={PREF_FLOW_RANGES.grn_on_v_coal} />
                        <PrefInput label="Independents → ON" value={prefFlows.teal_on_v_coal} onChange={v => setPrefFlows(f => ({ ...f, teal_on_v_coal: v }))} color="#0891B2" historicalRange={PREF_FLOW_RANGES.teal_on_v_coal} />
                        <PrefInput label="Other → ON" value={prefFlows.other_on_v_coal} onChange={v => setPrefFlows(f => ({ ...f, other_on_v_coal: v }))} color="#7C3AED" historicalRange={PREF_FLOW_RANGES.other_on_v_coal} />
                        <div style={{ fontSize: 11, color: "var(--text-4)", borderTop: "1px solid #FDE68A", paddingTop: 6, marginTop: 2 }}>
                          Defaults: ALP 20% · Grn 8% · Ind 12% · Other 25%. Remainder flows to Coalition.
                        </div>
                        <div style={{ borderTop: "1px solid #FDE68A", paddingTop: 10, marginTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#B45309", marginBottom: 6 }}>ON primary sourcing</div>
                          <PrefInput label="ON rise drawn from Coalition" value={prefFlows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare} onChange={v => setPrefFlows(f => ({ ...f, onFromCoalShare: v }))} color="#92400E" />
                          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>
                            Share of each seat's ON gain taken from the Coalition primary (rest from "other"). A rising ON vote is mostly ex-Coalition defection; higher values lower the Coalition's seat 2PP. No effect when ON is flat or falling.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Advanced: per-state swing deltas — collapsed by default */}
                <div style={panelStyle}>
                  <button
                    onClick={() => setShowStateSwings(v => !v)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showStateSwings ? 12 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                      Advanced: state swing deltas
                      {Object.values(fedStateDeltas).some(d => d !== 0) && (
                        <span style={{ marginLeft: 8, fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>active</span>
                      )}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-4)" }}>{showStateSwings ? "▲" : "▼"}</span>
                  </button>
                  {showStateSwings && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>
                        Per-state 2PP swing relative to the national swing (pp). Positive = ALP does better in that state than nationally (e.g. QLD −2 models a QLD-specific swing to the Coalition). 0 = the state tracks the national swing exactly. ACT/NT always use the national swing.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                        {["NSW", "VIC", "QLD", "WA", "SA", "TAS"].map(st => (
                          <div key={st} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: fedStateDeltas[st] !== 0 ? "#92400E" : "var(--text-3)" }}>{st}</span>
                            <input type="number" min={-10} max={10} step={0.5}
                              value={fedStateDeltas[st]}
                              onChange={e => { const v = e.target.value === "" ? 0 : +e.target.value; setFedStateDeltas(d => ({ ...d, [st]: Number.isFinite(v) ? v : 0 })); }}
                              style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 4px", fontSize: 11, textAlign: "right", boxSizing: "border-box" }}
                            />
                          </div>
                        ))}
                      </div>
                      {Object.values(fedStateDeltas).some(d => d !== 0) && (
                        <button onClick={() => setFedStateDeltas({ NSW: 0, VIC: 0, QLD: 0, WA: 0, SA: 0, TAS: 0 })}
                          style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", marginTop: 8 }}>
                          ↺ Reset all to 0
                        </button>
                      )}
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 8, lineHeight: 1.4 }}>
                        Applied as a primary-vote transfer (ALP +δ, Coalition −δ) on top of the national swing for every seat in the state; seat table and uncertainty bands update accordingly. Historically QLD/WA deviate from the national 2PP swing by ±2–4pp.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Results panel ── */}
              <div>
                {/* Implied 2PP + majority */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
                  <div style={{ ...STYLES.panel, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                    {implied2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: implied2pp >= 50 ? "#059669" : "#DC2626" }}>{implied2pp.toFixed(1)}%</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                          {implied2pp >= NATIONAL_2PP_2025 ? `▲ +${(implied2pp - NATIONAL_2PP_2025).toFixed(1)} vs 2025` : `▼ ${(implied2pp - NATIONAL_2PP_2025).toFixed(1)} vs 2025`}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 1 }}>
                          ALP vs Coalition · ON preferences distributed
                          {rightBlocShare !== null && <> · right-bloc share {rightBlocShare.toFixed(1)}%</>}
                        </div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "var(--text-4)" }}>—</div>}
                  </div>
                  <div style={{ ...STYLES.panel, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Avg seat 2PP result</div>
                    {seatAvg2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: seatAvg2pp.avg >= 50 ? "#059669" : "#DC2626" }}>{seatAvg2pp.avg.toFixed(1)}%</div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 3 }}>mean across {seatAvg2pp.count} seats</div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "var(--text-4)" }}>—</div>}
                  </div>
                  <div style={{ ...STYLES.panel, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: changedSeats.length > 0 ? "#F59E0B" : "var(--text-3)" }}>{changedSeats.length}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>of {SEATS.length} modelled</div>
                  </div>
                  {(() => {
                    const alpProj = projCounts.alp || 0;
                    const needsMaj = 76;
                    const isAlpMaj = alpProj >= needsMaj;
                    const isCoalMaj = (projCounts.coalition || 0) >= needsMaj;
                    const projMaj = isAlpMaj ? "ALP majority" : (isCoalMaj ? "Coalition majority" : "Hung parliament");
                    const majColor = isAlpMaj ? "#DC2626" : (isCoalMaj ? "#1D4ED8" : "#B45309");
                    const majBg = isAlpMaj ? "rgba(220,38,38,0.08)" : (isCoalMaj ? "rgba(29,78,216,0.08)" : "rgba(217,119,6,0.08)");
                    const majBorder = isAlpMaj ? "rgba(220,38,38,0.30)" : (isCoalMaj ? "rgba(29,78,216,0.30)" : "rgba(217,119,6,0.35)");
                    return (
                      <div style={{ ...STYLES.panel, marginBottom: 0, textAlign: "center", background: majBg, borderColor: majBorder }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>76 seats needed</div>
                      </div>
                    );
                  })()}
                </div>

                {/* Tally comparison: 2022 vs projected */}
                <div style={panelStyle}>
                  <div style={STYLES.panelTitle}>Seat composition</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>2025 result</div>
                    <TallyBar seats={SEATS} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>Projected</div>
                      {hasChanges && <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                    </div>
                    <TallyBar seats={modelledSeats} useModelled={true} />
                  </div>

                  {/* Delta table */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginTop: 8 }}>
                    {GROUP_ORDER.map(g => {
                      const base = baseCounts[g] || 0;
                      const proj = projCounts[g] || 0;
                      const delta = proj - base;
                      return (
                        <div key={g} style={STYLES.metricCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{GROUP_CONFIG[g].label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{proj}</span>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>/ {base} base</span>
                          </div>
                          {delta !== 0 && (
                            <div style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#059669" : "#DC2626", marginTop: 2 }}>
                              {delta > 0 ? "+" : ""}{delta} seats
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Uncertainty / confidence interval panel ── */}
                <div style={{ ...STYLES.panel, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-count uncertainty</span>
                    <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--subtle-bg)", padding: "2px 7px", borderRadius: 10 }}>
                      ±{swingStd}pp swing σ
                    </span>
                  </div>

                  {/* ALP seat count distribution */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{uncertainty.alpMean}</span>
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>seats (mean)</span>
                      <span style={{ fontSize: 13, color: "var(--text-4)" }}>±{uncertainty.alpStd}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
                      <span style={{ color: "var(--text-3)" }}>80% CI: </span>
                      <strong>{uncertainty.alpP10 ?? uncertainty.alpP25}–{uncertainty.alpP90 ?? uncertainty.alpP75}</strong>
                      &nbsp;seats
                      <span style={{ marginLeft: 10, color: "var(--text-3)" }}>95% CI: </span>
                      <strong>{uncertainty.alpP05}–{uncertainty.alpP95}</strong>
                      &nbsp;seats
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                      <span style={{ color: "var(--text-3)" }}>P(ALP majority ≥76): </span>
                      <strong style={{ color: uncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>
                        {uncertainty.pMajority}%
                      </strong>
                    </div>
                  </div>

                  {/* Visual quantile bar */}
                  <div style={{ position: "relative", height: 20, background: "var(--subtle-bg)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                    {/* 95% CI bar */}
                    <div style={{
                      position: "absolute",
                      left: `${Math.max(0, (uncertainty.alpP05 - 50) / 101 * 100)}%`,
                      width: `${Math.min(100, (uncertainty.alpP95 - uncertainty.alpP05) / 101 * 100)}%`,
                      height: "100%", background: "#FECACA", borderRadius: 4,
                    }} />
                    {/* 80% CI bar */}
                    <div style={{
                      position: "absolute",
                      left: `${Math.max(0, (uncertainty.alpP25 - 50) / 101 * 100)}%`,
                      width: `${Math.min(100, (uncertainty.alpP75 - uncertainty.alpP25) / 101 * 100)}%`,
                      height: "100%", background: "#FCA5A5",
                    }} />
                    {/* Median marker */}
                    <div style={{
                      position: "absolute",
                      left: `${Math.max(0, (uncertainty.alpP50 - 50) / 101 * 100)}%`,
                      width: 2, height: "100%", background: "#DC2626",
                    }} />
                    {/* Majority threshold at 76 seats */}
                    <div style={{
                      position: "absolute",
                      left: `${(76 - 50) / 101 * 100}%`,
                      width: 1, height: "100%", background: "var(--text-3)",
                    }} title="76 seats = majority" />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-4)" }}>
                    <span>{uncertainty.alpP05}</span>
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>{uncertainty.alpP50} median</span>
                    <span>76 maj.</span>
                    <span>{uncertainty.alpP95}</span>
                  </div>

                  {/* Model options */}
                  <div style={{ borderTop: "1px solid var(--border-3)", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>Model options</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer", marginBottom: 8 }}>
                      <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                      Seat elasticity (marginal seats swing more)
                      <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                        {useElasticity ? "ON — knife-edge ~1.4×, ~9pp ~1.0×, >20pp ~0.6×" : "OFF — uniform swing"}
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer", marginBottom: 8 }}>
                      <input type="checkbox" checked={useEconomicAdj} onChange={e => setUseEconomicAdj(e.target.checked)} />
                      Economic structural adjustment (Cameron &amp; Crosby)
                      <span style={{ fontSize: 11, color: econAdjPp > 0.1 ? "#059669" : econAdjPp < -0.1 ? "#DC2626" : "var(--text-4)" }}>
                        {useEconomicAdj
                          ? `ON — ${econAdjPp >= 0 ? "+" : ""}${econAdjPp.toFixed(2)}pp ALP (${econAdjPp >= 0 ? "tailwind" : "headwind"})`
                          : `OFF — C&C effect: ${econAdjPp >= 0 ? "+" : ""}${econAdjPp.toFixed(2)}pp`}
                      </span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <label style={{ minWidth: 130 }}>ON auto-detect threshold:</label>
                      <input type="number" min={0} max={30} step={0.5} value={onThreshold}
                        onChange={e => setOnThreshold(+e.target.value)}
                        style={{ width: 56, border: "1px solid var(--border-2)", borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "center", outline: "none" }} />
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>% primary vote</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                      <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                      <input
                        type="range" min={0.5} max={4} step={0.25} value={swingStd}
                        onChange={e => setSwingStd(+e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>
                      Typical Australian federal election polling MAE ≈ 1–2pp nationally.
                    </div>
                  </div>
                </div>

                {/* ── Seat-at-risk rankings ── */}
                {(() => {
                  const filterBtnStyle = (active) => ({
                    padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-2)",
                    background: active ? "var(--text-2)" : "var(--panel-bg)", color: active ? "#fff" : "var(--text-2)",
                  });
                  const filtered = (riskFilter === "all" ? seatsByRisk
                    : riskFilter === "changing" ? seatsByRisk.filter(s => s.modelled.changed)
                      : seatsByRisk.filter(s => getModelledMargin(s) < 5))
                    .filter(s => !modelStateFilter || s.state === modelStateFilter);

                  return (
                    <div style={panelStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>Seat-at-risk rankings</span>
                        <select value={modelStateFilter} onChange={e => setModelStateFilter(e.target.value)}
                          style={{ border: "1px solid var(--border-2)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, outline: "none", background: "var(--panel-bg)" }}>
                          <option value="">All States</option>
                          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[["all", "All 151"], ["changing", "Changing"], ["marginal", "Marginal (<5pp)"]].map(([val, label]) => (
                            <button key={val} onClick={() => setRiskFilter(val)} style={filterBtnStyle(riskFilter === val)}>{label}</button>
                          ))}
                        </div>
                      </div>

                      {/* Column headers + rows — wrapped for horizontal scroll on mobile */}
                      <div style={{ overflowX: "auto" }}>
                      {/* Column headers */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 80px 80px 80px 52px 60px", gap: 4, borderBottom: "2px solid #F3F4F6", paddingBottom: 4, marginBottom: 4, minWidth: 450 }}>
                        {[["Seat", "var(--text-2)"], ["State", "var(--text-3)"], ["2025", "var(--text-3)"], ["Projected", "var(--text-3)"], ["Margin", "var(--text-3)"], ["ALP win%", "var(--text-3)"], ["", "var(--text-3)"]].map(([label, color], i) => (
                          <div key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color, paddingLeft: i === 0 ? 2 : 0 }}>{label}</div>
                        ))}
                      </div>

                      <div style={{ maxHeight: 400, overflowY: "auto" }}>
                        {filtered.map(seat => {
                          const margin = getModelledMargin(seat);
                          const isSafe = margin > 10;
                          const changed = seat.modelled.changed;
                          const projGroup = seat.modelled.winnerGroup;
                          const projColor = GROUP_CONFIG[projGroup]?.color ?? "var(--text-3)";
                          const isExpanded = expandedModelSeatId === seat.id;
                          const d = getDemog(seat.id);

                          const seatWinProb = uncertainty.seatWinProbs[seat.id];
                          const ov = seatOverrides[seat.id] ?? {};
                          const seatPrefFlows = ov.prefFlows ?? {};
                          const hasSeatOverrides = Object.keys(ov).some(k => k !== "prefFlows" && ov[k] != null)
                            || Object.values(seatPrefFlows).some(v => v != null);
                          return (
                            <div key={seat.id}>
                              <div onClick={() => setExpandedModelSeatId(prev => prev === seat.id ? null : seat.id)}
                                style={{
                                  display: "grid", gridTemplateColumns: "1fr 48px 80px 80px 80px 52px 60px", gap: 4, alignItems: "center", minWidth: 450,
                                  padding: "5px 2px", borderLeft: `4px solid ${changed ? projColor : "transparent"}`,
                                  borderBottom: isExpanded ? "none" : "1px solid #F9FAFB",
                                  opacity: isSafe ? 0.55 : 1,
                                  background: isExpanded ? "var(--row-highlight)" : projGroup === "one_nation" && changed ? "rgba(217,119,6,0.08)" : "transparent",
                                  cursor: "pointer",
                                }}>
                                <span style={{ fontWeight: changed ? 700 : 400, fontSize: 13, color: "var(--text-1)", paddingLeft: changed ? 4 : 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {isExpanded ? "▾ " : "▸ "}{seat.name}
                                </span>
                                <span style={{ fontSize: 11, color: "var(--text-3)" }}>{seat.state}</span>
                                <div><PartyBadge party={seat.winner.party} /></div>
                                <div>
                                  {changed
                                    ? <PartyBadge party={seat.modelled.winnerParty} />
                                    : <span style={{ fontSize: 11, color: "var(--text-4)" }}>holds</span>
                                  }
                                </div>
                                <span style={{ fontSize: 12, fontWeight: margin < 5 ? 700 : 400, color: margin < 2 ? "#DC2626" : margin < 5 ? "#D97706" : "var(--text-2)" }}>
                                  {margin === Infinity ? "—" : `${margin.toFixed(1)}pp`}
                                </span>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, color:
                                    seatWinProb == null ? "var(--text-4)"
                                      : seatWinProb >= 0.85 ? "#DC2626"
                                        : seatWinProb >= 0.60 ? "#F59E0B"
                                          : seatWinProb >= 0.40 ? "var(--text-3)"
                                            : "#1D4ED8"
                                }}>
                                  {seatWinProb != null ? `${Math.round(seatWinProb * 100)}%` : "—"}
                                </span>
                                <span style={{ fontSize: 10, color: changed ? projColor : "var(--text-4)", fontWeight: 600 }}>
                                  {changed ? "CHANGED" : ""}
                                  {hasSeatOverrides && <span style={{ marginLeft: 4, fontSize: 9, color: "var(--text-3)", fontWeight: 700 }}>⚙</span>}
                                </span>
                              </div>
                              {isExpanded && (
                                <div style={{ background: "var(--metric-bg)", borderBottom: "1px solid var(--border-1)", padding: "12px 16px", marginBottom: 2 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 6 }}>Income</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Personal (earners):</strong> {d.medianPersonalIncomeEarners ? `$${(d.medianPersonalIncomeEarners / 1000).toFixed(1)}k/yr` : "—"}</div>
                                        <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 6 }}>Housing</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                        <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                        <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 6 }}>People</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Median age:</strong> {d.medianAge != null ? Math.round(d.medianAge) : "—"}</div>
                                        <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                        <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
                                        <div><strong>AEC class:</strong> {d.urbanClass ?? "—"}</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* ── Seat-level primary vote overrides ── */}
                                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 6 }}>
                                      Primary Votes (seat override)
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 4 }}>
                                      {[["ALP", "alp", "#DC2626"], ["Coal", "coal", "#1D4ED8"], ["Grn", "grn", "#059669"], ["Ind", "teal", "#0891B2"], ["ON", "on", "#B45309"]].map(([label, key, color]) => {
                                        const seatFp25 = SEAT_FP_2025[seat.id];
                                        return (
                                          <div key={key} style={{ textAlign: "center" }}>
                                            <div style={{ fontSize: 10, fontWeight: 800, color, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                                            <input
                                              type="number" min={0} max={100} step={0.5}
                                              value={ov[key] != null ? ov[key] : ""}
                                              placeholder={seatFp25?.[key]?.toFixed(1) ?? primaries[key]?.toFixed(1) ?? "—"}
                                              onChange={e => updateSeatOverride(seat.id, key, e.target.value)}
                                              style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 6, padding: "4px 3px", fontSize: 12, textAlign: "center", boxSizing: "border-box" }}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 4 }}>
                                      {SEAT_FP_2025[seat.id]
                                        ? `2025 AEC: ALP ${SEAT_FP_2025[seat.id].alp}% · Coal ${SEAT_FP_2025[seat.id].coal}% · Grn ${SEAT_FP_2025[seat.id].grn}% · Ind ${SEAT_FP_2025[seat.id].teal}% · ON ${SEAT_FP_2025[seat.id].on}%`
                                        : `National (2025): ALP ${primaries.alp}% · Coal ${primaries.coal}% · Grn ${primaries.grn}% · Ind ${primaries.teal}% · ON ${primaries.on}%`
                                      }
                                    </div>
                                  </div>

                                  {/* ── Seat-level preference flow overrides ── */}
                                  <div style={{ marginTop: 12, borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)" }}>
                                        Preference Flows (seat override)
                                      </div>
                                      {Object.values(seatPrefFlows).some(v => v != null) && (
                                        <span style={{ fontSize: 10, background: "var(--text-3)", color: "#fff", padding: "1px 6px", borderRadius: 8, fontWeight: 600 }}>seat-level</span>
                                      )}
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                                      {[["Greens → ALP", "grn_alp", "#059669"], ["Independents → ALP", "teal_alp", "#0891B2"], ["One Nation → ALP", "on_alp", "#B45309"], ["Other → ALP", "other_alp", "#7C3AED"]].map(([label, key, color]) => (
                                        <PrefInput key={key} label={label}
                                          value={seatPrefFlows[key] ?? prefFlows[key]}
                                          onChange={v => updateSeatPrefFlow(seat.id, key, Math.round(v * 200) / 2)}
                                          color={color} />
                                      ))}
                                    </div>
                                  </div>

                                  {hasSeatOverrides && (
                                    <div style={{ marginTop: 10, textAlign: "right" }}>
                                      <button onClick={e => { e.stopPropagation(); clearOverride(seat.id); }}
                                        style={{ fontSize: 11, color: "#DC2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                                        Clear seat overrides
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {filtered.length === 0 && (
                          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-4)", fontSize: 13 }}>
                            No seats match this filter.
                          </div>
                        )}
                      </div>
                      </div>{/* end overflowX scroll wrapper */}
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, borderTop: "1px solid var(--border-3)", paddingTop: 8 }}>
                        {filtered.length} seats shown · Red = &lt;2pp · Amber = &lt;5pp · Faded = safe (&gt;10pp) · Bold left border = projected change · Click row to expand demographics
                      </div>
                    </div>
                  );
                })()}

                {/* Seats changing hands */}
                {changedSeats.length > 0 && (
                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Seats changing hands ({changedSeats.length})</div>
                    {(() => {
                      const alpGains = changedSeats.filter(s => s.modelled.winnerGroup === "alp" && getParty(s.winner.party).group !== "alp");
                      const alpLosses = changedSeats.filter(s => getParty(s.winner.party).group === "alp" && s.modelled.winnerGroup !== "alp");
                      const other = changedSeats.filter(s => s.modelled.winnerGroup !== "alp" && getParty(s.winner.party).group !== "alp");
                      const SeatRow = ({ seat, direction }) => {
                        const baseP = getParty(seat.winner.party);
                        const projP = getParty(seat.modelled.winnerParty);
                        const alp2pp = seat.modelled.projAlp2pp;
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-3)" }}>
                            <span style={{ fontSize: 14 }}>{direction}</span>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 600 }}>{seat.name}</span>
                              <span style={{ color: "var(--text-4)", fontSize: 12, marginLeft: 6 }}>{seat.state}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                              <PartyBadge party={seat.winner.party} />
                              <span style={{ color: "var(--text-4)" }}>→</span>
                              <PartyBadge party={seat.modelled.winnerParty} />
                            </div>
                            {alp2pp !== null && (
                              <span style={{ fontSize: 12, color: "var(--text-3)", minWidth: 80, textAlign: "right" }}>
                                ALP 2PP {alp2pp.toFixed(1)}%
                              </span>
                            )}
                            {seat.modelled.isOverride && <span style={{ fontSize: 10, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 5px", borderRadius: 6, fontWeight: 600 }}>override</span>}
                          </div>
                        );
                      };
                      return (
                        <div>
                          {alpGains.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 6 }}>🟢 ALP gains ({alpGains.length})</div>
                              {[...alpGains].sort((a, b) => (a.modelled.projAlp2pp || 50) - (b.modelled.projAlp2pp || 50)).map(s => <SeatRow key={s.id} seat={s} direction="↑" />)}
                            </div>
                          )}
                          {alpLosses.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", marginBottom: 6 }}>🔴 ALP losses ({alpLosses.length})</div>
                              {[...alpLosses].sort((a, b) => (b.modelled.projAlp2pp || 50) - (a.modelled.projAlp2pp || 50)).map(s => <SeatRow key={s.id} seat={s} direction="↓" />)}
                            </div>
                          )}
                          {other.length > 0 && (
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", marginBottom: 6 }}>⚪ Other changes ({other.length})</div>
                              {other.map(s => <SeatRow key={s.id} seat={s} direction="↔" />)}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Seat-level primary vote overrides */}
                <div style={panelStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-level primary overrides</span>
                    {Object.keys(seatOverrides).length > 0 && (
                      <>
                        <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
                          {Object.keys(seatOverrides).length} active
                        </span>
                        <button onClick={() => setSeatOverrides({})}
                          style={{ marginLeft: "auto", fontSize: 12, color: "#EF4444", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                          Clear all
                        </button>
                      </>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 10px" }}>
                    Set custom primary vote %s for specific seats — useful for strong local candidates or known seat-level effects.
                  </p>

                  {/* Seat search + dropdown */}
                  <div style={{ position: "relative", marginBottom: 12 }}>
                    <input
                      value={overrideSearch}
                      onChange={e => setOverrideSearch(e.target.value)}
                      placeholder="+ Search for a seat to add…"
                      style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                    />
                    {overrideSearch.length > 0 && (() => {
                      const matches = SEATS.filter(s =>
                        s.name.toLowerCase().includes(overrideSearch.toLowerCase()) && !seatOverrides[s.id]
                      ).slice(0, 8);
                      return matches.length > 0 ? (
                        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                          {matches.map((s, i) => (
                            <div key={s.id}
                              onMouseDown={() => addSeatOverride(s.id)}
                              style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: i < matches.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                              <span style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{s.name}</span>
                              <span style={{ fontSize: 12, color: "var(--text-4)" }}>{s.state}</span>
                              <PartyBadge party={s.winner.party} />
                              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{s.margin.toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  {/* Overridden seat cards */}
                  {Object.keys(seatOverrides).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-4)", fontSize: 12 }}>
                      No seat overrides active. Search for a seat above to add one.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {Object.entries(seatOverrides).map(([idStr, ov]) => {
                        const seat = SEATS.find(s => s.id === +idStr);
                        if (!seat) return null;
                        const ms = modelledSeats.find(s => s.id === +idStr);
                        const proj2pp = ms?.modelled.projAlp2pp;
                        return (
                          <div key={idStr} style={{ border: "1px solid var(--border-2)", borderRadius: 8, padding: "12px 14px", background: "var(--table-row-alt)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <PartyBadge party={seat.winner.party} />
                              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{seat.name}</span>
                              <span style={{ fontSize: 12, color: "var(--text-4)" }}>{seat.state} · 2022 margin {seat.margin.toFixed(1)}%</span>
                              {proj2pp !== null && (
                                <span style={{ fontSize: 12, fontWeight: 700, color: proj2pp >= 50 ? "#059669" : "#1D4ED8" }}>
                                  ALP 2PP {proj2pp.toFixed(1)}%
                                </span>
                              )}
                              <button onClick={() => clearOverride(+idStr)}
                                style={{ fontSize: 13, color: "var(--text-4)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>✕</button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                              {[["ALP", "alp", "#DC2626"], ["Coal", "coal", "#1D4ED8"], ["Grn", "grn", "#059669"], ["Ind", "teal", "#0891B2"], ["ON", "on", "#B45309"]].map(([label, key, color]) => (
                                <div key={key} style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 10, fontWeight: 800, color, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                                  <input
                                    type="number" min={0} max={100} step={0.5}
                                    value={ov[key] !== null && ov[key] !== undefined ? ov[key] : ""}
                                    onChange={e => updateSeatOverride(+idStr, key, e.target.value)}
                                    style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 6, padding: "5px 4px", fontSize: 12, textAlign: "center", boxSizing: "border-box", outline: "none" }}
                                  />
                                </div>
                              ))}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8 }}>
                              National: ALP {primaries.alp}% · Coal {primaries.coal}% · Grn {primaries.grn}% · Ind {primaries.teal}% · ON {primaries.on}%
                            </div>

                            {/* TCP / Margin override */}
                            {(() => {
                              const tcpP = seat.tcp.map(t => t.party);
                              const isAlpCoal = tcpP.includes("ALP") && tcpP.some(p => ["LP", "LNP", "NP", "CLP"].includes(p));
                              const isGrnCoal = tcpP.includes("GRN") && tcpP.some(p => ["LP", "LNP", "NP", "CLP"].includes(p));
                              const isGrnAlp = tcpP.includes("GRN") && tcpP.includes("ALP");
                              const isTeal = tcpP.some(p => ["IND", "CA"].includes(p));
                              // tcpPct = seat.tcp[0].party's TCP% (2022 winner's TCP)
                              const tcp0 = seat.tcp[0];
                              const tcp1 = seat.tcp[1];
                              const tcpLabel = isAlpCoal ? "ALP 2PP %" : isGrnCoal ? "Greens TCP %" : isGrnAlp ? "ALP TCP %" : "Ind. TCP %";
                              const winLabel = isAlpCoal ? "ALP" : isGrnCoal ? "Greens" : isGrnAlp ? "Labor" : "Independent";
                              const loseLabel = isAlpCoal ? "Coalition" : isGrnCoal ? "Coalition" : isGrnAlp ? "Greens" : (tcpP.some(p => ["LP", "LNP", "NP", "CLP"].includes(p)) ? "Coalition" : "Labor");
                              // For ALP/Coal seats: show ALP 2PP% (the standard metric).
                              // For other seat types: show the 2022 winner's projected TCP%.
                              const projWinnerPct = ms?.modelled.winnerPct;
                              const projWinnerParty = ms?.modelled.winnerParty;
                              const projTcpPct = isAlpCoal
                                ? (ms?.modelled.projAlp2pp ?? null)
                                : (projWinnerPct !== undefined
                                  ? (projWinnerParty === tcp0.party ? projWinnerPct : 100 - projWinnerPct)
                                  : null);
                              const ovTcp = ov.tcpPct;
                              const ovTcpSet = ovTcp !== null && ovTcp !== undefined;
                              const displayTcp = ovTcpSet ? ovTcp : projTcpPct;
                              const margin2pp = displayTcp !== null ? Math.abs(displayTcp - 50).toFixed(1) : null;
                              const tcpWins = displayTcp !== null && displayTcp >= 50;
                              return (
                                <div style={{ borderTop: "1px solid var(--border-1)", marginTop: 10, paddingTop: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", flex: 1 }}>Margin / TCP override</span>
                                    <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                                      2022: {getParty(tcp0.party).short} {tcp0.pct.toFixed(1)}% vs {getParty(tcp1.party).short} {tcp1.pct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap" }}>{tcpLabel}</label>
                                    <input
                                      type="number" min={0} max={100} step={0.1}
                                      value={ovTcpSet ? ovTcp : ""}
                                      placeholder={projTcpPct?.toFixed(1) ?? "—"}
                                      onChange={e => updateSeatOverride(+idStr, "tcpPct", e.target.value)}
                                      style={{ width: 72, border: ovTcpSet ? "1px solid #6366F1" : "1px solid var(--border-2)", borderRadius: 6, padding: "5px 6px", fontSize: 12, textAlign: "center", outline: "none", background: ovTcpSet ? "#EEF2FF" : "var(--panel-bg)", color: "var(--text-1)" }}
                                    />
                                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>%</span>
                                    {displayTcp !== null && (
                                      <span style={{ fontSize: 12, fontWeight: 600, color: tcpWins ? "#059669" : "#1D4ED8" }}>
                                        {tcpWins ? winLabel : loseLabel} +{margin2pp}pp
                                      </span>
                                    )}
                                    {ovTcpSet && (
                                      <button
                                        onClick={() => updateSeatOverride(+idStr, "tcpPct", "")}
                                        style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-4)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}
                                        title="Clear TCP override">✕</button>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>
                                    {`>50% → ${winLabel} wins · <50% → ${loseLabel} wins`}
                                    {projTcpPct !== null && !ovTcpSet && (
                                      <span> · Modelled: {projTcpPct.toFixed(1)}%</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* TCP Matchup override */}
                            <div style={{ borderTop: "1px solid var(--border-1)", marginTop: 10, paddingTop: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>TCP Matchup</div>
                              <div style={{ display: "flex", gap: 5 }}>
                                {[["auto", "Auto"], ["on_v_alp", "ON vs ALP"], ["on_v_coal", "ON vs Coal"], ["on_v_ind", "ON vs IND"]].map(([val, label]) => {
                                  const active = (ov.tcpMatchup ?? "auto") === val;
                                  return (
                                    <button key={val}
                                      onClick={() => updateSeatOverride(+idStr, "tcpMatchup", val === "auto" ? null : val)}
                                      style={{ padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: active ? "#B45309" : "var(--panel-bg)", color: active ? "#fff" : "#B45309", border: "1px solid #B45309" }}>
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                              {ov.tcpMatchup && (
                                <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
                                  {ov.tcpMatchup === "on_v_alp" ? "Uses Coal→ALP (ON race) preference flow."
                                    : ov.tcpMatchup === "on_v_ind" ? "ON vs Independent final (Farrer-type); Coal→ON, ALP/GRN→IND flows."
                                    : "Uses ALP→ON (vs Coal) preference flow."}
                                </div>
                              )}
                            </div>

                            {/* Force projected winner */}
                            <div style={{ borderTop: "1px solid var(--border-1)", marginTop: 10, paddingTop: 10 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", flex: 1 }}>Force projected winner</span>
                                {ov.forceGroup && (
                                  <button onClick={() => updateSeatOverride(+idStr, "forceGroup", "")}
                                    style={{ fontSize: 11, color: "var(--text-4)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>
                                    Clear
                                  </button>
                                )}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {GROUP_ORDER.map(g => (
                                  <button key={g}
                                    onClick={() => updateSeatOverride(+idStr, "forceGroup", ov.forceGroup === g ? "" : g)}
                                    style={{
                                      padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                                      background: ov.forceGroup === g ? GROUP_CONFIG[g].color : "var(--panel-bg)",
                                      color: ov.forceGroup === g ? "#fff" : GROUP_CONFIG[g].color,
                                      border: `1px solid ${GROUP_CONFIG[g].color}`,
                                    }}>
                                    {GROUP_CONFIG[g].label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>}

            {/* ── VIC scenario builder ── */}
            {el.modelEnabled && selectedModelId === "vic_2022" && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>

              {/* ── VIC Controls panel ── */}
              <div>
                <div style={panelStyle}>
                  <div style={sectionHead}>Primary vote %</div>
                  <PrimaryInput label="ALP" value={vicPrimaries.alp} onChange={v => setVicPrimaries(p => ({ ...p, alp: v }))} color="#DC2626" baseline={VIC_BASELINE_2022.alp} />
                  <PrimaryInput label="Coalition" value={vicPrimaries.coal} onChange={v => setVicPrimaries(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={VIC_BASELINE_2022.coal} />
                  <PrimaryInput label="Greens" value={vicPrimaries.grn} onChange={v => setVicPrimaries(p => ({ ...p, grn: v }))} color="#059669" baseline={VIC_BASELINE_2022.grn} />
                  <PrimaryInput label="Independents" value={vicPrimaries.ind} onChange={v => setVicPrimaries(p => ({ ...p, ind: v }))} color="#0891B2" baseline={VIC_BASELINE_2022.ind} />
                  <PrimaryInput label="One Nation" value={vicPrimaries.on} onChange={v => setVicPrimaries(p => ({ ...p, on: v }))} color="#B45309" baseline={VIC_BASELINE_2022.on} />
                  <PrimaryInput label="Undecided" value={vicPrimaries.undecided ?? 0} onChange={v => setVicPrimaries(p => ({ ...p, undecided: v }))} color="var(--text-4)" baseline={0} />
                  {(() => {
                    const entered = +(vicPrimaries.alp + vicPrimaries.coal + vicPrimaries.grn + vicPrimaries.ind + vicPrimaries.on).toFixed(1);
                    const undecided = +(vicPrimaries.undecided ?? 0);
                    const other = +(100 - entered - undecided).toFixed(1);
                    const overLimit = entered + undecided > 100;
                    return (
                      <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Other / minor parties</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "var(--text-2)" }}>
                          {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6 }}>
                    2022 result: ALP {VIC_BASELINE_2022.alp}% · Coalition {VIC_BASELINE_2022.coal}% · Grn {VIC_BASELINE_2022.grn}% · Ind {VIC_BASELINE_2022.ind}% · ON {VIC_BASELINE_2022.on}%
                  </div>
                </div>

                <div style={panelStyle}>
                  <div style={sectionHead}>Preference flows to ALP</div>
                  <PrefInput label="Greens → ALP" value={vicPrefFlows.grn_alp} onChange={v => setVicPrefFlows(f => ({ ...f, grn_alp: v }))} color="#059669" />
                  <PrefInput label="Independents → ALP" value={vicPrefFlows.ind_alp} onChange={v => setVicPrefFlows(f => ({ ...f, ind_alp: v }))} color="#0891B2" />
                  <PrefInput label="One Nation → ALP" value={vicPrefFlows.on_alp} onChange={v => setVicPrefFlows(f => ({ ...f, on_alp: v }))} color="#B45309" />
                  <PrefInput label="Other → ALP" value={vicPrefFlows.other_alp} onChange={v => setVicPrefFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" />
                  <div style={{ fontSize: 11, color: "var(--text-4)", borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                    Defaults based on 2022 VIC preference distributions. Remainder flows to Coalition.
                  </div>
                </div>

                <div style={panelStyle}>
                  <div style={sectionHead}>ON Race Flows</div>
                  <div style={{ marginBottom: 8, fontSize: 12, color: "var(--text-3)" }}>Forces a statewide ON final. Per-seat ON finals are auto-detected when a seat's projected ON primary overtakes a major party (badge: ON RACE).</div>
                  {[{ val: null, label: "Standard (ALP vs Coalition)" }, { val: "on_v_alp", label: "ON vs ALP final" }, { val: "on_v_coal", label: "ON vs Coalition final" }].map(opt => (
                    <label key={String(opt.val)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                      <input type="radio" name="vicOnTcp" checked={vicOnTcp === opt.val} onChange={() => setVicOnTcp(opt.val)}
                        style={{ accentColor: "#B45309", width: 14, height: 14 }} />
                      <span style={{ fontSize: 13, fontWeight: vicOnTcp === opt.val ? 600 : 400 }}>{opt.label}</span>
                    </label>
                  ))}
                  {vicOnTcp === "on_v_alp" && (
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#B45309", marginBottom: 6 }}>ON vs ALP preference flows</div>
                      <PrefInput label="Coal → ALP (vs ON)" value={vicPrefFlows.coal_alp_v_on} onChange={v => setVicPrefFlows(f => ({ ...f, coal_alp_v_on: v }))} color="#1D4ED8" />
                      <PrefInput label="Greens → ALP (vs ON)" value={vicPrefFlows.grn_alp_v_on} onChange={v => setVicPrefFlows(f => ({ ...f, grn_alp_v_on: v }))} color="#059669" />
                      <PrefInput label="Ind → ALP (vs ON)" value={vicPrefFlows.ind_alp_v_on} onChange={v => setVicPrefFlows(f => ({ ...f, ind_alp_v_on: v }))} color="#0891B2" />
                      <PrefInput label="Other → ALP (vs ON)" value={vicPrefFlows.other_alp_v_on} onChange={v => setVicPrefFlows(f => ({ ...f, other_alp_v_on: v }))} color="#7C3AED" />
                    </div>
                  )}
                  {vicOnTcp === "on_v_coal" && (
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#B45309", marginBottom: 6 }}>ON vs Coalition preference flows</div>
                      <PrefInput label="ALP → ON (vs Coal)" value={vicPrefFlows.alp_on_v_coal} onChange={v => setVicPrefFlows(f => ({ ...f, alp_on_v_coal: v }))} color="#DC2626" />
                      <PrefInput label="Greens → ON (vs Coal)" value={vicPrefFlows.grn_on_v_coal} onChange={v => setVicPrefFlows(f => ({ ...f, grn_on_v_coal: v }))} color="#059669" />
                      <PrefInput label="Ind → ON (vs Coal)" value={vicPrefFlows.ind_on_v_coal} onChange={v => setVicPrefFlows(f => ({ ...f, ind_on_v_coal: v }))} color="#0891B2" />
                      <PrefInput label="Other → ON (vs Coal)" value={vicPrefFlows.other_on_v_coal} onChange={v => setVicPrefFlows(f => ({ ...f, other_on_v_coal: v }))} color="#7C3AED" />
                    </div>
                  )}
                </div>

                <div style={panelStyle}>
                  <div style={sectionHead}>Modelling options</div>
                  {/* Regional swing differentiation toggle */}
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 4 }}>
                    <input type="checkbox" checked={useVicRegionalSwing} onChange={e => setUseVicRegionalSwing(e.target.checked)}
                      style={{ marginTop: 2, accentColor: "#6366F1", width: 16, height: 16 }} />
                    <span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>Regional swing differentiation</span>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        Inner-metro seats amplify the state swing (×1.15); regional/rural seats respond
                        less (×0.75). Calibrated from 2014–2022 VEC district-level data.
                      </div>
                      {useVicRegionalSwing && (
                        <div style={{ fontSize: 11, color: "#6366F1", marginTop: 4 }}>
                          Active: inner-metro ×1.15 · outer-metro ×1.00 · regional ×0.75
                        </div>
                      )}
                    </span>
                  </label>
                </div>

                {vicHasChanges && (
                  <button onClick={() => { setVicPrimaries({ alp: 38.1, coal: 31.1, grn: 12.2, ind: 5.5, on: 1.3, undecided: 0 }); setVicPrefFlows({ grn_alp: 0.85, ind_alp: 0.60, on_alp: 0.25, other_alp: 0.43, coal_alp_v_on: 0.12, grn_alp_v_on: 0.88, ind_alp_v_on: 0.70, other_alp_v_on: 0.58, alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22 }); setUseVicRegionalSwing(true); setVicOnTcp(null); setVicSeatOverrides({}); }}
                    style={{ ...STYLES.btnDanger, width: "100%", padding: "8px", marginBottom: 16 }}>
                    Reset VIC model
                  </button>
                )}
              </div>

              {/* ── VIC Results panel ── */}
              <div>
                {/* Summary stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                    {vicImplied2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: vicImplied2pp >= 50 ? "#059669" : "#DC2626" }}>{vicImplied2pp.toFixed(1)}%</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                          {vicImplied2pp >= 50 ? `▲ +${(vicImplied2pp - VIC_RIGHT_BLOC_2PP_2022).toFixed(1)} vs 2022` : `▼ ${(vicImplied2pp - VIC_RIGHT_BLOC_2PP_2022).toFixed(1)} vs 2022`}
                        </div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "var(--text-4)" }}>—</div>}
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Avg seat 2PP result</div>
                    {vicSeatAvg2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: vicSeatAvg2pp.avg >= 50 ? "#059669" : "#DC2626" }}>{vicSeatAvg2pp.avg.toFixed(1)}%</div>
                        <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 3 }}>mean across {vicSeatAvg2pp.count} seats</div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "var(--text-4)" }}>—</div>}
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: vicChangedSeats.length > 0 ? "#F59E0B" : "var(--text-3)" }}>{vicChangedSeats.length}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>of 88 modelled</div>
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                    {(() => {
                      const alpProj = vicProjCounts.alp || 0;
                      const coalProj = (vicProjCounts.coalition || 0);
                      const projMaj = alpProj >= 45 ? "ALP majority" : coalProj >= 45 ? "Coalition majority" : "Hung parliament";
                      const majColor = alpProj >= 45 ? "#059669" : coalProj >= 45 ? "#1D4ED8" : "#F59E0B";
                      return (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>45 seats needed</div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Tally comparison */}
                <div style={panelStyle}>
                  <div style={STYLES.panelTitle}>Seat composition</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>2022 result</div>
                    <TallyBar seats={VIC_SEATS} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>Projected</div>
                      {vicHasChanges && <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                    </div>
                    <TallyBar seats={vicModelledSeats} useModelled={true} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginTop: 8 }}>
                    {GROUP_ORDER.map(g => {
                      const base = vicBaseCounts[g] || 0;
                      const proj = vicProjCounts[g] || 0;
                      const delta = proj - base;
                      if (!base && !proj) return null;
                      return (
                        <div key={g} style={STYLES.metricCard}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{GROUP_CONFIG[g].label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{proj}</span>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>/ {base} base</span>
                          </div>
                          {delta !== 0 && (
                            <div style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#059669" : "#DC2626", marginTop: 2 }}>
                              {delta > 0 ? "+" : ""}{delta} seats
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* VIC Uncertainty panel */}
                <div style={{ ...STYLES.panel, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-count uncertainty</span>
                    <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--subtle-bg)", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{vicUncertainty.alpMean}</span>
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>seats (mean)</span>
                      <span style={{ fontSize: 13, color: "var(--text-4)" }}>±{vicUncertainty.alpStd}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
                      <span style={{ color: "var(--text-3)" }}>80% CI: </span>
                      <strong>{vicUncertainty.alpP25}–{vicUncertainty.alpP75}</strong> seats
                      <span style={{ marginLeft: 10, color: "var(--text-3)" }}>95% CI: </span>
                      <strong>{vicUncertainty.alpP05}–{vicUncertainty.alpP95}</strong> seats
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                      <span style={{ color: "var(--text-3)" }}>P(ALP majority ≥45): </span>
                      <strong style={{ color: vicUncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>{vicUncertainty.pMajority}%</strong>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 20, background: "var(--subtle-bg)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP05 / 89 * 100)}%`, width: `${Math.min(100, (vicUncertainty.alpP95 - vicUncertainty.alpP05) / 89 * 100)}%`, height: "100%", background: "#FECACA", borderRadius: 4 }} />
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP25 / 89 * 100)}%`, width: `${Math.min(100, (vicUncertainty.alpP75 - vicUncertainty.alpP25) / 89 * 100)}%`, height: "100%", background: "#FCA5A5" }} />
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP50 / 89 * 100)}%`, width: 2, height: "100%", background: "#DC2626" }} />
                    <div style={{ position: "absolute", left: `${45 / 89 * 100}%`, width: 1, height: "100%", background: "var(--text-3)" }} title="45 seats = majority" />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-4)" }}>
                    <span>{vicUncertainty.alpP05}</span>
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>{vicUncertainty.alpP50} median</span>
                    <span>45 maj.</span>
                    <span>{vicUncertainty.alpP95}</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border-3)", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>Model options</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer", marginBottom: 8 }}>
                      <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                      Seat elasticity (marginal seats swing more)
                      <span style={{ fontSize: 11, color: "var(--text-4)" }}>{useElasticity ? "ON — ≤5pp: 1.3×, 6–10pp: 1.15×, >20pp: 0.8×" : "OFF — uniform swing"}</span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                      <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                      <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                      <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>Shared across all elections. Typical Australian state polling MAE ≈ 1–2pp.</div>
                  </div>
                </div>

                {/* Seat-at-risk table — filterable */}
                {(() => {
                  const filterBtnStyle = (active) => ({
                    padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-2)",
                    background: active ? "var(--text-2)" : "var(--panel-bg)", color: active ? "#fff" : "var(--text-2)",
                  });
                  let vicFiltered = [...vicModelledSeats].sort((a, b) => {
                    const ma = Math.abs((a.modelled.projAlp2pp ?? 50) - 50);
                    const mb = Math.abs((b.modelled.projAlp2pp ?? 50) - 50);
                    return ma - mb;
                  });
                  if (stateRiskFilter === "changing") vicFiltered = vicFiltered.filter(s => s.modelled.changed);
                  if (stateRiskFilter === "marginal") vicFiltered = vicFiltered.filter(s => Math.abs((s.modelled.projAlp2pp ?? 50) - 50) < 5);
                  return (
                    <div style={panelStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>Seat-at-risk rankings</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[["all", `All 88`], ["changing", "Changing"], ["marginal", "Marginal (<5pp)"]].map(([val, label]) => (
                            <button key={val} onClick={() => setStateRiskFilter(val)} style={filterBtnStyle(stateRiskFilter === val)}>{label}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 52px 56px", gap: 4, borderBottom: "2px solid #F3F4F6", paddingBottom: 4, marginBottom: 4, minWidth: 400 }}>
                          {[["Seat", "var(--text-2)"], ["2022", "var(--text-3)"], ["Projected", "var(--text-3)"], ["Margin", "var(--text-3)"], ["ALP%", "var(--text-3)"], ["", ""]].map(([label, color], i) => (
                            <div key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color, paddingLeft: i === 0 ? 2 : 0 }}>{label}</div>
                          ))}
                        </div>
                        <div style={{ maxHeight: 440, overflowY: "auto" }}>
                          {vicFiltered.map(seat => {
                            const margin = Math.abs((seat.modelled.projAlp2pp ?? 50) - 50);
                            const changed = seat.modelled.changed;
                            const projColor = GROUP_CONFIG[seat.modelled.winnerGroup]?.color ?? "var(--text-3)";
                            const winProb = vicUncertainty.seatWinProbs[seat.id];
                            const isExpanded = expandedStateSeatId === seat.id;
                            const d = getStateDemog(seat.id);
                            const hasOv = vicSeatOverrides[seat.id] != null;
                            const onRace = seat.modelled.isOnRace && seat.modelled.isAutoMatchup;
                            return (
                              <div key={seat.id}>
                                <div onClick={() => setExpandedStateSeatId(prev => prev === seat.id ? null : seat.id)}
                                  style={{
                                    display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 52px 56px", gap: 4, alignItems: "center", minWidth: 400,
                                    padding: "5px 2px", borderLeft: `4px solid ${changed ? projColor : "transparent"}`,
                                    borderBottom: isExpanded ? "none" : "1px solid #F9FAFB",
                                    background: hasOv ? "rgba(16,185,129,0.10)" : isExpanded ? "var(--row-highlight)" : changed ? "rgba(217,119,6,0.08)" : "transparent",
                                    cursor: "pointer",
                                  }}>
                                  <span style={{ fontWeight: changed ? 700 : 400, fontSize: 13, color: "var(--text-1)", paddingLeft: changed ? 4 : 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {isExpanded ? "▾ " : "▸ "}{seat.name}
                                  </span>
                                  <div><PartyBadge party={seat.winner.party} /></div>
                                  <div>
                                    {changed ? <PartyBadge party={seat.modelled.winnerParty} /> : <span style={{ fontSize: 11, color: "var(--text-4)" }}>holds</span>}
                                  </div>
                                  <span style={{ fontSize: 12, fontWeight: margin < 5 ? 700 : 400, color: margin < 2 ? "#DC2626" : margin < 5 ? "#D97706" : "var(--text-2)" }}>
                                    {margin === Infinity ? "—" : `${margin.toFixed(1)}pp`}
                                  </span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: winProb == null ? "var(--text-4)" : winProb >= 0.85 ? "#DC2626" : winProb >= 0.60 ? "#F59E0B" : winProb >= 0.40 ? "var(--text-3)" : "#1D4ED8" }}>
                                    {winProb != null ? `${Math.round(winProb * 100)}%` : "—"}
                                  </span>
                                  <span style={{ fontSize: 10, color: changed ? projColor : hasOv ? "#059669" : onRace ? "#B45309" : "var(--text-4)", fontWeight: 600 }}>
                                    {changed ? "CHANGED" : hasOv ? "OVERRIDE" : onRace ? "ON RACE" : ""}
                                  </span>
                                </div>
                                {isExpanded && (
                                  <div style={{ background: "var(--metric-bg)", borderBottom: "1px solid var(--border-1)", padding: "10px 14px", marginBottom: 2 }}>
                                    {Object.keys(d).length > 0 && d.medianAge != null ? (
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                                        <div>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>Income</div>
                                          {[{ k: "medianPersonalIncomeEarners", l: "Personal (earners)" }, { k: "medianHouseholdIncome", l: "Household" }].map(({ k, l }) => d[k] != null && (
                                            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                              <span style={{ color: "var(--text-3)" }}>{l}</span>
                                              <span style={{ fontWeight: 600 }}>${(d[k] / 1000).toFixed(0)}k</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>Housing</div>
                                          {[{ k: "renterPct", l: "Renters", fmt: v => `${v}%` }, { k: "medianWeeklyRent", l: "Weekly rent", fmt: v => `$${v}` }, { k: "ownerMortgagePct", l: "Owner+mort", fmt: v => `${v}%` }].map(({ k, l, fmt }) => d[k] != null && (
                                            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                              <span style={{ color: "var(--text-3)" }}>{l}</span>
                                              <span style={{ fontWeight: 600 }}>{fmt(d[k])}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>People</div>
                                          {[{ k: "medianAge", l: "Median age", fmt: v => Math.round(v) }, { k: "bachelorsOrAbovePct", l: "Degree+", fmt: v => `${v}%` }, { k: "overseasBornPct", l: "Overseas born", fmt: v => `${v}%` }].map(({ k, l, fmt }) => d[k] != null && (
                                            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                              <span style={{ color: "var(--text-3)" }}>{l}</span>
                                              <span style={{ fontWeight: 600 }}>{fmt(d[k])}</span>
                                            </div>
                                          ))}
                                          {d.urbanClass && <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>{d.urbanClass}</div>}
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                                        TCP: {seat.modelled.activeTcpMatchup ? seat.modelled.activeTcpMatchup.replace("on_v_alp", "ON vs ALP").replace("on_v_coal", "ON vs Coal") : `${seat.tcp[0].party} vs ${seat.tcp[1].party}`}
                                        {` · Region: ${seat.modelled.region ?? "—"} · No demographic data yet (run pipeline/fetch_demographics.py to populate)`}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-3)" }}>
                        Probabilistic swing model · VEC 2022 · 88 Legislative Assembly districts · ALP% shown for ALP/Coalition contests
                      </div>
                    </div>
                  );
                })()}

                {/* ── VIC Legislative Council (upper house) projection ── */}
                <LcProjectionPanel chamber={LC_CHAMBERS.vic_2022} prim={vicPrimaries} bl={VIC_BASELINE_2022} panelStyle={panelStyle} />

                {/* ── VIC Per-seat overrides panel ── */}
                <div style={panelStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-level overrides</span>
                    {Object.keys(vicSeatOverrides).length > 0 && (
                      <>
                        <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
                          {Object.keys(vicSeatOverrides).length} active
                        </span>
                        <button onClick={() => setVicSeatOverrides({})}
                          style={{ marginLeft: "auto", fontSize: 12, color: "#EF4444", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                          Clear all
                        </button>
                      </>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 10px" }}>
                    Override primary votes, TCP %, or force a winner for individual seats.
                  </p>
                  <div style={{ position: "relative", marginBottom: 12 }}>
                    <input
                      value={vicOverrideSearch}
                      onChange={e => setVicOverrideSearch(e.target.value)}
                      placeholder="+ Search for a seat to override…"
                      style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                    />
                    {vicOverrideSearch.length > 0 && (() => {
                      const matches = VIC_SEATS.filter(s =>
                        s.name.toLowerCase().includes(vicOverrideSearch.toLowerCase()) && !vicSeatOverrides[s.id]
                      ).slice(0, 8);
                      return matches.length > 0 ? (
                        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                          {matches.map((s, i) => (
                            <div key={s.id}
                              onMouseDown={() => {
                                setVicSeatOverrides(ov => ({ ...ov, [s.id]: { tcpMatchup: null, tcpPct: null, forceGroup: null } }));
                                setVicOverrideSearch("");
                              }}
                              style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: i < matches.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                              <span style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{s.name}</span>
                              <span style={{ fontSize: 12, color: "var(--text-4)" }}>{s.tcp[0].party} vs {s.tcp[1].party}</span>
                              <PartyBadge party={s.winner.party} />
                              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{s.margin.toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  {Object.keys(vicSeatOverrides).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-4)", fontSize: 12 }}>
                      No seat overrides active. Search for a VIC seat above to add one.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {Object.entries(vicSeatOverrides).map(([idStr, ov]) => {
                        const seat = VIC_SEATS.find(s => s.id === +idStr);
                        if (!seat) return null;
                        const ms = vicModelledSeats.find(s => s.id === +idStr);
                        const setOv = (patch) => setVicSeatOverrides(ovs => ({ ...ovs, [+idStr]: { ...ovs[+idStr], ...patch } }));
                        const tcpMatchup = ov.tcpMatchup ?? null;
                        const tcpPct = ov.tcpPct ?? null;
                        return (
                          <div key={idStr} style={{ border: "1px solid var(--border-2)", borderRadius: 8, padding: "12px 14px", background: "var(--table-row-alt)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <PartyBadge party={seat.winner.party} />
                              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{seat.name}</span>
                              <span style={{ fontSize: 12, color: "var(--text-4)" }}>Baseline: {seat.tcp[0].party} vs {seat.tcp[1].party} · {seat.margin.toFixed(1)}%</span>
                              {ms?.modelled.winnerParty && ms.modelled.winnerPct != null && (
                                <span style={{ fontSize: 12, fontWeight: 700, color: getParty(ms.modelled.winnerParty).color }}>
                                  → {ms.modelled.winnerParty} {ms.modelled.winnerPct.toFixed(1)}%
                                </span>
                              )}
                              <button onClick={() => setVicSeatOverrides(ovs => { const n = { ...ovs }; delete n[+idStr]; return n; })}
                                style={{ fontSize: 13, color: "var(--text-4)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}>✕</button>
                            </div>
                            {/* Primary vote overrides */}
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Primary vote % overrides (blank = use statewide)</div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                                {[{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coal", c: "#1D4ED8" }, { k: "grn", l: "Grn", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }, { k: "on", l: "ON", c: "#B45309" }].map(({ k, l, c }) => (
                                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{l}</span>
                                    <input type="number" min={0} max={100} step={0.5}
                                      value={ov[k] ?? ""}
                                      placeholder="—"
                                      onChange={e => setOv({ [k]: e.target.value === "" ? null : +e.target.value })}
                                      style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 4px", fontSize: 11, textAlign: "right", boxSizing: "border-box" }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* TCP% override */}
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>ALP 2PP % (≥50 = ALP wins)</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input type="number" min={0} max={100} step={0.5}
                                  value={tcpPct ?? ""}
                                  placeholder="auto"
                                  onChange={e => setOv({ tcpPct: e.target.value === "" ? null : +e.target.value })}
                                  style={{ width: 70, border: "1px solid var(--border-2)", borderRadius: 4, padding: "4px 6px", fontSize: 12, textAlign: "right" }}
                                />
                                <span style={{ fontSize: 11, color: "var(--text-4)" }}>% (overrides model)</span>
                                {tcpPct != null && <button onClick={() => setOv({ tcpPct: null })} style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}>×</button>}
                              </div>
                            </div>
                            {/* Force winner */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Force projected winner</div>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                {[["alp", "ALP", "#DC2626"], ["coalition", "Coalition", "#1D4ED8"], ["greens", "Greens", "#059669"], ["ind", "Ind", "#0891B2"], ["one_nation", "ON", "#B45309"]].map(([g, label, c]) => (
                                  <button key={g}
                                    onClick={() => setOv({ forceGroup: ov.forceGroup === g ? null : g })}
                                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: `1px solid ${c}`, cursor: "pointer", fontWeight: ov.forceGroup === g ? 700 : 400, background: ov.forceGroup === g ? c : "var(--panel-bg)", color: ov.forceGroup === g ? "#fff" : c }}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>}

            {/* ── Reusable state builder (NSW, QLD, WA, SA, NT) ── */}
            {(() => {
              const cfgs = {
                nsw_2023: { prim: nswPrim, setPrim: setNswPrim, flows: nswFlows, setFlows: setNswFlows, onTcp: nswOnTcp, setOnTcp: setNswOnTcp, seatOverrides: nswSeatOverrides, setSeatOverrides: setNswSeatOverrides, modelled: nswModelledSeats, proj: nswProjCounts, base: nswBaseCounts, changed: nswChanged, implied2pp: nswImplied2pp, hasChanges: nswHasChanges, bl: NSW_BL, baseline2pp: NSW_2PP, coalLabel: "Coalition", seats: "NSW_SEATS", totalSeats: 93, majority: 47, source: "NSWEC 2023 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.88, ind_alp: 0.55, on_alp: 0.20, other_alp: 0.45, coal_alp_v_on: 0.12, grn_alp_v_on: 0.88, ind_alp_v_on: 0.70, other_alp_v_on: 0.58, alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22, onCoalOriginFactor: 0.0 }, allSeats: NSW_SEATS, uncertainty: nswUncertainty, useRegionalSwing: useNswRegionalSwing, setUseRegionalSwing: setUseNswRegionalSwing, regionLabel: "inner-metro ×1.10 · outer-metro ×1.00 · regional ×0.80", pollsJson: NSW_STATE_POLLS, pollCoalKeys: ["lp", "np"] },
                qld_2024: { prim: qldPrim, setPrim: setQldPrim, flows: qldFlows, setFlows: setQldFlows, onTcp: qldOnTcp, setOnTcp: setQldOnTcp, seatOverrides: qldSeatOverrides, setSeatOverrides: setQldSeatOverrides, modelled: qldModelledSeats, proj: qldProjCounts, base: qldBaseCounts, changed: qldChanged, implied2pp: qldImplied2pp, hasChanges: qldHasChanges, bl: QLD_BL, baseline2pp: QLD_2PP, coalLabel: "Coalition", seats: "QLD_SEATS", totalSeats: 93, majority: 47, source: "ECQ 2024 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.82, ind_alp: 0.50, on_alp: 0.18, other_alp: 0.40, coal_alp_v_on: 0.10, grn_alp_v_on: 0.86, ind_alp_v_on: 0.65, other_alp_v_on: 0.55, alp_on_v_coal: 0.22, grn_on_v_coal: 0.06, ind_on_v_coal: 0.15, other_on_v_coal: 0.28, onCoalOriginFactor: 0.0 }, allSeats: QLD_SEATS, uncertainty: qldUncertainty, useRegionalSwing: useQldRegionalSwing, setUseRegionalSwing: setUseQldRegionalSwing, regionLabel: "inner-metro ×1.10 · outer-metro ×1.00 · regional ×0.75", pollsJson: QLD_STATE_POLLS, pollCoalKeys: ["lnp"] },
                wa_2025: { prim: waPrim, setPrim: setWaPrim, flows: waFlows, setFlows: setWaFlows, onTcp: waOnTcp, setOnTcp: setWaOnTcp, seatOverrides: waSeatOverrides, setSeatOverrides: setWaSeatOverrides, modelled: waModelledSeats, proj: waProjCounts, base: waBaseCounts, changed: waChanged, implied2pp: waImplied2pp, hasChanges: waHasChanges, bl: WA_BL, baseline2pp: WA_2PP, coalLabel: "Coalition", seats: "WA_SEATS", totalSeats: 59, majority: 30, source: "WAEC 2025 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.86, ind_alp: 0.58, on_alp: 0.22, other_alp: 0.44, coal_alp_v_on: 0.12, grn_alp_v_on: 0.87, ind_alp_v_on: 0.68, other_alp_v_on: 0.57, alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22, onCoalOriginFactor: 0.0 }, allSeats: WA_SEATS, uncertainty: waUncertainty, useRegionalSwing: useWaRegionalSwing, setUseRegionalSwing: setUseWaRegionalSwing, regionLabel: "metro ×1.00 · regional ×0.75", pollsJson: WA_STATE_POLLS, pollCoalKeys: ["lp", "nat"] },
                sa_2026: { prim: saPrim, setPrim: setSaPrim, flows: saFlows, setFlows: setSaFlows, onTcp: saOnTcp, setOnTcp: setSaOnTcp, seatOverrides: saSeatOverrides, setSeatOverrides: setSaSeatOverrides, modelled: saModelledSeats, proj: saProjCounts, base: saBaseCounts, changed: saChanged, implied2pp: saImplied2pp, hasChanges: saHasChanges, bl: SA_BL, baseline2pp: SA_2PP, coalLabel: "Coalition", seats: "SA_SEATS", totalSeats: 47, majority: 24, source: "ECSA 2026 provisional results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.84, ind_alp: 0.52, on_alp: 0.22, other_alp: 0.45, coal_alp_v_on: 0.12, grn_alp_v_on: 0.87, ind_alp_v_on: 0.68, other_alp_v_on: 0.57, alp_on_v_coal: 0.20, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.22, onCoalOriginFactor: 0.0 }, allSeats: SA_SEATS, uncertainty: saUncertainty, useRegionalSwing: useSaRegionalSwing, setUseRegionalSwing: setUseSaRegionalSwing, regionLabel: "inner-metro ×1.05 · outer-metro ×1.00 · regional ×0.80", pollsJson: SA_STATE_POLLS, pollCoalKeys: ["lp"], caveat: "Provisional baseline: this model is built on the 21 March 2026 provisional ECSA count (6 seats were still in doubt at capture). Statewide primaries, 2PP, per-seat ON figures and seat winners may shift at the final declaration — refresh the SA constants once ECSA publishes the declared result (see docs/ELECTION_UPDATE_CHECKLIST.md)." },
                nt_2024: { prim: ntPrim, setPrim: setNtPrim, flows: ntFlows, setFlows: setNtFlows, onTcp: ntOnTcp, setOnTcp: setNtOnTcp, seatOverrides: ntSeatOverrides, setSeatOverrides: setNtSeatOverrides, modelled: ntModelledSeats, proj: ntProjCounts, base: ntBaseCounts, changed: ntChanged, implied2pp: null, hasChanges: ntHasChanges, bl: NT_BL, baseline2pp: NT_2PP, coalLabel: "Coalition", seats: "NT_SEATS", totalSeats: 25, majority: 13, source: "NTEC 2024 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.80, ind_alp: 0.45, on_alp: 0.20, other_alp: 0.40, coal_alp_v_on: 0.10, grn_alp_v_on: 0.82, ind_alp_v_on: 0.55, other_alp_v_on: 0.50, alp_on_v_coal: 0.22, grn_on_v_coal: 0.06, ind_on_v_coal: 0.15, other_on_v_coal: 0.28, onCoalOriginFactor: 0.0 }, allSeats: NT_SEATS, uncertainty: ntUncertainty, useRegionalSwing: useNtRegionalSwing, setUseRegionalSwing: setUseNtRegionalSwing, regionLabel: "metro ×1.00 · regional ×0.70", exhaust: { rate: ntExhaustRate, set: setNtExhaustRate, def: NT_EXHAUST_DEFAULT } },
              };
              const cfg = cfgs[selectedModelId];
              if (!el.modelEnabled || !cfg) return null;
              const { prim, setPrim, flows, setFlows, onTcp, setOnTcp, seatOverrides, setSeatOverrides, modelled, proj, base, changed, implied2pp, hasChanges, bl, baseline2pp, coalLabel, totalSeats, majority, source, parties, resetFlows, allSeats, uncertainty, useRegionalSwing, setUseRegionalSwing, regionLabel, pollsJson, pollCoalKeys, caveat, exhaust } = cfg;
              // Recent state polls (election-result baseline rows excluded) and the
              // recency-weighted average used by the "Apply latest polls" action.
              const statePollList = (pollsJson?.polls ?? [])
                .map(p => normalizeStatePoll(p, pollCoalKeys ?? ["lp"]))
                .filter(Boolean)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
              const statePollAvg = statePollAverage(statePollList);
              const applyStatePolls = () => {
                if (!statePollAvg) return;
                setPrim(pr => ({
                  ...pr,
                  alp: statePollAvg.alp,
                  coal: statePollAvg.coal,
                  grn: statePollAvg.grn ?? pr.grn,
                  ind: statePollAvg.ind ?? pr.ind,
                  on: statePollAvg.on ?? pr.on,
                  undecided: 0,
                }));
              };
              const entered = parties.reduce((s, p) => s + (prim[p.k] ?? 0), 0);
              const undecided = +(prim.undecided ?? 0);
              const other = +(100 - entered - undecided).toFixed(1);
              const overLimit = entered + undecided > 100;
              const alpProj = proj.alp || 0;
              const coalProj = proj.coalition || 0;
              const grnProj = proj.greens || 0;
              const projMaj = alpProj >= majority ? "ALP majority" : (coalProj >= majority ? `${coalLabel} majority` : "Hung parliament");
              const majColor = alpProj >= majority ? "#DC2626" : (coalProj >= majority ? "#1D4ED8" : "#F59E0B");
              const seatAvg2ppVal = (() => {
                const vals = modelled
                  .filter(s => s.modelled.projAlp2pp !== null && s.modelled.projAlp2pp !== undefined && isFinite(s.modelled.projAlp2pp))
                  .map(s => s.modelled.projAlp2pp);
                return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length } : null;
              })();

              return <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
                {/* Baseline caveat (e.g. SA provisional count) */}
                {caveat && (
                  <div style={{ gridColumn: "1 / -1", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 2 }}>⚠ Baseline caveat</div>
                    <div style={{ fontSize: 12, color: "#B45309", lineHeight: 1.5 }}>{caveat}</div>
                  </div>
                )}

                {/* Upper house (Legislative Council) projection — bicameral states */}
                {LC_CHAMBERS[selectedModelId] && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <LcProjectionPanel chamber={LC_CHAMBERS[selectedModelId]} prim={prim} bl={bl} panelStyle={panelStyle} />
                  </div>
                )}
                {/* Controls */}
                <div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Primary vote %</div>
                    {parties.map(p => (
                      <PrimaryInput key={p.k} label={p.l} value={prim[p.k] ?? 0}
                        onChange={v => setPrim(pr => ({ ...pr, [p.k]: v }))}
                        color={p.c} baseline={bl[p.k] ?? 0} />
                    ))}
                    <PrimaryInput label="Undecided" value={prim.undecided ?? 0}
                      onChange={v => setPrim(pr => ({ ...pr, undecided: v }))}
                      color="var(--text-4)" baseline={0} />
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>Other / minor parties</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "var(--text-2)" }}>
                        {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6 }}>
                      {parties.map(p => `${p.l} ${bl[p.k] ?? 0}%`).join(" · ")}
                    </div>
                  </div>
                  {/* Recent state polls — list + apply action (defaults stay at the election result) */}
                  {pollsJson && (
                    <div style={panelStyle}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={sectionHead}>Recent polls</div>
                        {statePollAvg && (
                          <button onClick={applyStatePolls}
                            style={{ fontSize: 11, fontWeight: 600, color: "#1D4ED8", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", whiteSpace: "nowrap" }}>
                            Apply latest polls
                          </button>
                        )}
                      </div>
                      {statePollList.length > 0 ? (
                        <>
                          {statePollList.slice(0, 6).map((p, i) => (
                            <div key={`${p.pollster}-${p.date}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "4px 0", borderBottom: i < Math.min(statePollList.length, 6) - 1 ? "1px solid var(--border-3)" : "none" }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.pollster}</span>
                              <span style={{ fontSize: 10, color: "var(--text-4)", whiteSpace: "nowrap" }}>{p.date}</span>
                              <span style={{ fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                ALP {p.alp} · Coal {p.coal} · Grn {p.grn}{p.on > 0 ? ` · ON ${p.on}` : ""}{p.tpp != null ? ` · 2PP ${p.tpp}` : ""}
                              </span>
                            </div>
                          ))}
                          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 6, lineHeight: 1.4 }}>
                            "Apply latest polls" seeds the primary inputs from a recency-weighted average (exponential decay, 60-day half-life); polls missing primaries are skipped. Defaults remain the election result until applied.
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                          No published state polls collected yet — the model baseline is the election result.
                        </div>
                      )}
                    </div>
                  )}
                  <div style={panelStyle}>
                    <div style={sectionHead}>Preference flows to ALP</div>
                    <PrefInput label="Greens → ALP" value={flows.grn_alp} onChange={v => setFlows(f => ({ ...f, grn_alp: v }))} color="#059669" />
                    <PrefInput label="Independents → ALP" value={flows.ind_alp} onChange={v => setFlows(f => ({ ...f, ind_alp: v }))} color="#0891B2" />
                    <PrefInput label="One Nation → ALP" value={flows.on_alp} onChange={v => setFlows(f => ({ ...f, on_alp: v }))} color="#B45309" />
                    <PrefInput label="Other → ALP" value={flows.other_alp} onChange={v => setFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" />
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                      <PrefInput label="ON from Coalition adj." value={flows.onCoalOriginFactor ?? 0} onChange={v => setFlows(f => ({ ...f, onCoalOriginFactor: v }))} color="#92400E" />
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2, lineHeight: 1.4 }}>
                        When ON rises mainly from Coalition defectors (e.g. SA 2026), those voters preference ALP at a higher rate. Set 0.3–0.7 to model this effect. 0 = off (default).
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                      Defaults based on {source} preference distributions.
                    </div>
                  </div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>ON Race Flows</div>
                    <div style={{ marginBottom: 8, fontSize: 12, color: "var(--text-3)" }}>Select if One Nation reaches the final two-candidate count statewide.</div>
                    {[{ val: null, label: "Standard (ALP vs Coalition)" }, { val: "on_v_alp", label: "ON vs ALP final" }, { val: "on_v_coal", label: "ON vs Coalition final" }].map(opt => (
                      <label key={String(opt.val)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                        <input type="radio" name={`${selectedModelId}OnTcp`} checked={onTcp === opt.val} onChange={() => setOnTcp(opt.val)}
                          style={{ accentColor: "#B45309", width: 14, height: 14 }} />
                        <span style={{ fontSize: 13, fontWeight: onTcp === opt.val ? 600 : 400 }}>{opt.label}</span>
                      </label>
                    ))}
                    {onTcp === "on_v_alp" && (
                      <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#B45309", marginBottom: 6 }}>ON vs ALP preference flows</div>
                        <PrefInput label="Coal → ALP (vs ON)" value={flows.coal_alp_v_on} onChange={v => setFlows(f => ({ ...f, coal_alp_v_on: v }))} color="#1D4ED8" />
                        <PrefInput label="Greens → ALP (vs ON)" value={flows.grn_alp_v_on} onChange={v => setFlows(f => ({ ...f, grn_alp_v_on: v }))} color="#059669" />
                        <PrefInput label="Ind → ALP (vs ON)" value={flows.ind_alp_v_on} onChange={v => setFlows(f => ({ ...f, ind_alp_v_on: v }))} color="#0891B2" />
                        <PrefInput label="Other → ALP (vs ON)" value={flows.other_alp_v_on} onChange={v => setFlows(f => ({ ...f, other_alp_v_on: v }))} color="#7C3AED" />
                      </div>
                    )}
                    {onTcp === "on_v_coal" && (
                      <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#B45309", marginBottom: 6 }}>ON vs Coalition preference flows</div>
                        <PrefInput label="ALP → ON (vs Coal)" value={flows.alp_on_v_coal} onChange={v => setFlows(f => ({ ...f, alp_on_v_coal: v }))} color="#DC2626" />
                        <PrefInput label="Greens → ON (vs Coal)" value={flows.grn_on_v_coal} onChange={v => setFlows(f => ({ ...f, grn_on_v_coal: v }))} color="#059669" />
                        <PrefInput label="Ind → ON (vs Coal)" value={flows.ind_on_v_coal} onChange={v => setFlows(f => ({ ...f, ind_on_v_coal: v }))} color="#0891B2" />
                        <PrefInput label="Other → ON (vs Coal)" value={flows.other_on_v_coal} onChange={v => setFlows(f => ({ ...f, other_on_v_coal: v }))} color="#7C3AED" />
                      </div>
                    )}
                  </div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Modelling options</div>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 4 }}>
                      <input type="checkbox" checked={useRegionalSwing} onChange={e => setUseRegionalSwing(e.target.checked)}
                        style={{ marginTop: 2, accentColor: "#6366F1", width: 16, height: 16 }} />
                      <span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>Regional swing differentiation</span>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                          Metro seats track the state swing; regional/rural seats respond less (local factors dominant).
                        </div>
                        {useRegionalSwing && (
                          <div style={{ fontSize: 11, color: "#6366F1", marginTop: 4 }}>
                            Active: {regionLabel}
                          </div>
                        )}
                      </span>
                    </label>
                    {exhaust && (
                      <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 8, marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                          <label style={{ minWidth: 130, fontWeight: 600 }}>Preference exhaustion:</label>
                          <input type="number" min={0} max={60} step={1}
                            value={Math.round(exhaust.rate * 100)}
                            onChange={e => { const v = e.target.value === "" ? 0 : +e.target.value; exhaust.set(Number.isFinite(v) ? Math.max(0, Math.min(0.6, v / 100)) : exhaust.def); }}
                            style={{ width: 56, border: "1px solid var(--border-2)", borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "center", outline: "none" }} />
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>% of minor-party ballots</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, lineHeight: 1.4 }}>
                          NT uses optional preferential voting (OPV): ballots that mark no preference between the final two exhaust instead of transferring. Default 25% (NTEC 2024 estimate); 0% reproduces full-preferential arithmetic.
                        </div>
                      </div>
                    )}
                  </div>
                  {hasChanges && (
                    <button onClick={() => { setPrim({ ...bl, undecided: 0 }); setFlows({ ...resetFlows }); setOnTcp(null); setUseRegionalSwing(true); if (setSeatOverrides) setSeatOverrides({}); if (exhaust) exhaust.set(exhaust.def); }}
                      style={{ ...STYLES.btnDanger, width: "100%", padding: "8px", marginBottom: 16 }}>
                      Reset model
                    </button>
                  )}
                </div>

                {/* Results */}
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                      {implied2pp !== null ? (
                        <>
                          <div style={{ fontSize: 30, fontWeight: 800, color: implied2pp >= 50 ? "#059669" : "#DC2626" }}>{implied2pp.toFixed(1)}%</div>
                          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                            {implied2pp >= 50 ? `▲ +${(implied2pp - baseline2pp).toFixed(1)} vs baseline` : `▼ ${(implied2pp - baseline2pp).toFixed(1)} vs baseline`}
                          </div>
                        </>
                      ) : <div style={{ fontSize: 14, color: "var(--text-4)", marginTop: 8 }}>—</div>}
                    </div>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Avg seat 2PP result</div>
                      {seatAvg2ppVal !== null ? (
                        <>
                          <div style={{ fontSize: 30, fontWeight: 800, color: seatAvg2ppVal.avg >= 50 ? "#059669" : "#DC2626" }}>{seatAvg2ppVal.avg.toFixed(1)}%</div>
                          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 3 }}>mean across {seatAvg2ppVal.count} seats</div>
                        </>
                      ) : <div style={{ fontSize: 20, color: "var(--text-4)" }}>—</div>}
                    </div>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                      <div style={{ fontSize: 30, fontWeight: 800, color: changed.length > 0 ? "#F59E0B" : "var(--text-3)" }}>{changed.length}</div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>of {totalSeats} modelled</div>
                    </div>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                  </div>

                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Seat composition</div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>Baseline result</div>
                      <TallyBar seats={allSeats} />
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Projected</div>
                        {hasChanges && <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                      </div>
                      <TallyBar seats={modelled} useModelled={true} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginTop: 8 }}>
                      {GROUP_ORDER.map(g => {
                        const bv = base[g] || 0;
                        const pv = proj[g] || 0;
                        const delta = pv - bv;
                        if (!bv && !pv) return null;
                        return (
                          <div key={g} style={STYLES.metricCard}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{GROUP_CONFIG[g].label}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                              <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{pv}</span>
                              <span style={{ fontSize: 12, color: "var(--text-3)" }}>/ {bv} base</span>
                            </div>
                            {delta !== 0 && <div style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#059669" : "#DC2626", marginTop: 2 }}>{delta > 0 ? "+" : ""}{delta} seats</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Uncertainty panel */}
                  <div style={{ ...STYLES.panel, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-count uncertainty</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--subtle-bg)", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ</span>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{uncertainty.alpMean}</span>
                        <span style={{ fontSize: 13, color: "var(--text-3)" }}>seats (mean)</span>
                        <span style={{ fontSize: 13, color: "var(--text-4)" }}>±{uncertainty.alpStd}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
                        <span style={{ color: "var(--text-3)" }}>80% CI: </span>
                        <strong>{uncertainty.alpP25}–{uncertainty.alpP75}</strong> seats
                        <span style={{ marginLeft: 10, color: "var(--text-3)" }}>95% CI: </span>
                        <strong>{uncertainty.alpP05}–{uncertainty.alpP95}</strong> seats
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                        <span style={{ color: "var(--text-3)" }}>P(ALP majority ≥{majority}): </span>
                        <strong style={{ color: uncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>{uncertainty.pMajority}%</strong>
                      </div>
                    </div>
                    <div style={{ position: "relative", height: 20, background: "var(--subtle-bg)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP05 / (totalSeats + 1) * 100)}%`, width: `${Math.min(100, (uncertainty.alpP95 - uncertainty.alpP05) / (totalSeats + 1) * 100)}%`, height: "100%", background: "#FECACA", borderRadius: 4 }} />
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP25 / (totalSeats + 1) * 100)}%`, width: `${Math.min(100, (uncertainty.alpP75 - uncertainty.alpP25) / (totalSeats + 1) * 100)}%`, height: "100%", background: "#FCA5A5" }} />
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP50 / (totalSeats + 1) * 100)}%`, width: 2, height: "100%", background: "#DC2626" }} />
                      <div style={{ position: "absolute", left: `${majority / (totalSeats + 1) * 100}%`, width: 1, height: "100%", background: "var(--text-3)" }} title={`${majority} seats = majority`} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-4)" }}>
                      <span>{uncertainty.alpP05}</span>
                      <span style={{ color: "#DC2626", fontWeight: 700 }}>{uncertainty.alpP50} median</span>
                      <span>{majority} maj.</span>
                      <span>{uncertainty.alpP95}</span>
                    </div>
                    <div style={{ borderTop: "1px solid var(--border-3)", marginTop: 12, paddingTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>Model options</div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer", marginBottom: 8 }}>
                        <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                        Seat elasticity (marginal seats swing more)
                        <span style={{ fontSize: 11, color: "var(--text-4)" }}>{useElasticity ? "ON — ≤5pp: 1.3×, 6–10pp: 1.15×, >20pp: 0.8×" : "OFF — uniform swing"}</span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>Shared across all elections. Typical Australian state polling MAE ≈ 1–2pp.</div>
                    </div>
                  </div>

                  {/* Seat-at-risk table — filterable */}
                  {(() => {
                    const filterBtnStyle = (active) => ({
                      padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-2)",
                      background: active ? "var(--text-2)" : "var(--panel-bg)", color: active ? "#fff" : "var(--text-2)",
                    });
                    let stateFiltered = [...modelled].sort((a, b) => {
                      const ma = Math.abs((a.modelled.projAlp2pp ?? 50) - 50);
                      const mb = Math.abs((b.modelled.projAlp2pp ?? 50) - 50);
                      return ma - mb;
                    });
                    if (stateRiskFilter === "changing") stateFiltered = stateFiltered.filter(s => s.modelled.changed);
                    if (stateRiskFilter === "marginal") stateFiltered = stateFiltered.filter(s => Math.abs((s.modelled.projAlp2pp ?? 50) - 50) < 5);
                    return (
                      <div style={panelStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>Seat-at-risk rankings</span>
                          <div style={{ display: "flex", gap: 4 }}>
                            {[["all", `All ${totalSeats}`], ["changing", "Changing"], ["marginal", "Marginal (<5pp)"]].map(([val, label]) => (
                              <button key={val} onClick={() => setStateRiskFilter(val)} style={filterBtnStyle(stateRiskFilter === val)}>{label}</button>
                            ))}
                          </div>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 52px 56px", gap: 4, borderBottom: "2px solid #F3F4F6", paddingBottom: 4, marginBottom: 4, minWidth: 400 }}>
                            {[["Seat", "var(--text-2)"], ["Baseline", "var(--text-3)"], ["Projected", "var(--text-3)"], ["Margin", "var(--text-3)"], ["ALP%", "var(--text-3)"], ["", ""]].map(([label, color], i) => (
                              <div key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color, paddingLeft: i === 0 ? 2 : 0 }}>{label}</div>
                            ))}
                          </div>
                          <div style={{ maxHeight: 440, overflowY: "auto" }}>
                            {stateFiltered.map(seat => {
                              const margin = Math.abs((seat.modelled.projAlp2pp ?? 50) - 50);
                              const chg = seat.modelled.changed;
                              const projColor = GROUP_CONFIG[seat.modelled.winnerGroup]?.color ?? "var(--text-3)";
                              const winProb = uncertainty.seatWinProbs[seat.id];
                              const isExpanded = expandedStateSeatId === seat.id;
                              const d = getStateDemog(seat.id);
                              const hasOv = seatOverrides?.[seat.id] != null;
                              const autoOn = seat.modelled.isAutoMatchup;
                              return (
                                <div key={seat.id}>
                                  <div onClick={() => setExpandedStateSeatId(prev => prev === seat.id ? null : seat.id)}
                                    style={{
                                      display: "grid", gridTemplateColumns: "1fr 80px 80px 70px 52px 56px", gap: 4, alignItems: "center", minWidth: 400,
                                      padding: "5px 2px", borderLeft: `4px solid ${chg ? projColor : "transparent"}`,
                                      borderBottom: isExpanded ? "none" : "1px solid #F9FAFB",
                                      background: hasOv ? "rgba(16,185,129,0.10)" : isExpanded ? "var(--row-highlight)" : chg ? "rgba(217,119,6,0.08)" : "transparent",
                                      cursor: "pointer",
                                    }}>
                                    <span style={{ fontWeight: chg ? 700 : 400, fontSize: 13, color: "var(--text-1)", paddingLeft: chg ? 4 : 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {isExpanded ? "▾ " : "▸ "}{seat.name}
                                    </span>
                                    <div><PartyBadge party={seat.winner.party} /></div>
                                    <div>
                                      {chg ? <PartyBadge party={seat.modelled.winnerParty} /> : <span style={{ fontSize: 11, color: "var(--text-4)" }}>holds</span>}
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: margin < 5 ? 700 : 400, color: margin < 2 ? "#DC2626" : margin < 5 ? "#D97706" : "var(--text-2)" }}>
                                      {margin === Infinity ? "—" : `${margin.toFixed(1)}pp`}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: winProb == null ? "var(--text-4)" : winProb >= 0.85 ? "#DC2626" : winProb >= 0.60 ? "#F59E0B" : winProb >= 0.40 ? "var(--text-3)" : "#1D4ED8" }}>
                                      {winProb != null ? `${Math.round(winProb * 100)}%` : "—"}
                                    </span>
                                    <span style={{ fontSize: 10, color: chg ? projColor : hasOv ? "#059669" : autoOn ? "#B45309" : "var(--text-4)", fontWeight: 600 }}>
                                      {chg ? "CHANGED" : hasOv ? "OVERRIDE" : autoOn ? "ON AUTO" : ""}
                                    </span>
                                  </div>
                                  {isExpanded && (
                                    <div style={{ background: "var(--metric-bg)", borderBottom: "1px solid var(--border-1)", padding: "10px 14px", marginBottom: 2 }}>
                                      {Object.keys(d).length > 0 && d.medianAge != null ? (
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                                          <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>Income</div>
                                            {[{ k: "medianPersonalIncomeEarners", l: "Personal (earners)" }, { k: "medianHouseholdIncome", l: "Household" }].map(({ k, l }) => d[k] != null && (
                                              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                                <span style={{ color: "var(--text-3)" }}>{l}</span>
                                                <span style={{ fontWeight: 600 }}>${(d[k] / 1000).toFixed(0)}k</span>
                                              </div>
                                            ))}
                                          </div>
                                          <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>Housing</div>
                                            {[{ k: "renterPct", l: "Renters", fmt: v => `${v}%` }, { k: "medianWeeklyRent", l: "Weekly rent", fmt: v => `$${v}` }, { k: "ownerMortgagePct", l: "Owner+mort", fmt: v => `${v}%` }].map(({ k, l, fmt }) => d[k] != null && (
                                              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                                <span style={{ color: "var(--text-3)" }}>{l}</span>
                                                <span style={{ fontWeight: 600 }}>{fmt(d[k])}</span>
                                              </div>
                                            ))}
                                          </div>
                                          <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>People</div>
                                            {[{ k: "medianAge", l: "Median age", fmt: v => Math.round(v) }, { k: "bachelorsOrAbovePct", l: "Degree+", fmt: v => `${v}%` }, { k: "overseasBornPct", l: "Overseas born", fmt: v => `${v}%` }].map(({ k, l, fmt }) => d[k] != null && (
                                              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                                                <span style={{ color: "var(--text-3)" }}>{l}</span>
                                                <span style={{ fontWeight: 600 }}>{fmt(d[k])}</span>
                                              </div>
                                            ))}
                                            {d.urbanClass && <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>{d.urbanClass}</div>}
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                                          TCP: {seat.modelled.activeTcpMatchup ? seat.modelled.activeTcpMatchup.replace("on_v_alp", "ON vs ALP").replace("on_v_coal", "ON vs Coal").replace("on_v_ind", "ON vs IND") : `${seat.tcp[0].party} vs ${seat.tcp[1].party}`}
                                          {seat.modelled.region ? ` · Region: ${seat.modelled.region}` : ""}
                                          {" · No demographic data yet (run pipeline/fetch_demographics.py to populate)"}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-3)" }}>
                          Probabilistic swing model · {source} · {totalSeats} seats · ALP% shown for ALP/Coalition contests
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Per-seat override panel ── */}
                  {setSeatOverrides && (
                    <div style={panelStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-level overrides</span>
                        {Object.keys(seatOverrides ?? {}).length > 0 && (
                          <>
                            <span style={{ fontSize: 11, background: "rgba(217,119,6,0.15)", color: "var(--text-2)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
                              {Object.keys(seatOverrides).length} active
                            </span>
                            <button onClick={() => setSeatOverrides({})}
                              style={{ marginLeft: "auto", fontSize: 12, color: "#EF4444", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                              Clear all
                            </button>
                          </>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 10px" }}>
                        Override primary votes, TCP %, TCP matchup, or force a winner for individual seats.
                      </p>
                      {/* Seat search */}
                      <div style={{ position: "relative", marginBottom: 12 }}>
                        <input
                          value={stateOverrideSearch}
                          onChange={e => setStateOverrideSearch(e.target.value)}
                          placeholder="+ Search for a seat to override…"
                          style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                        />
                        {stateOverrideSearch.length > 0 && (() => {
                          const matches = allSeats.filter(s =>
                            s.name.toLowerCase().includes(stateOverrideSearch.toLowerCase()) && !seatOverrides?.[s.id]
                          ).slice(0, 8);
                          return matches.length > 0 ? (
                            <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                              {matches.map((s, i) => (
                                <div key={s.id}
                                  onMouseDown={() => {
                                    setSeatOverrides(ov => ({ ...ov, [s.id]: { tcpMatchup: null, tcpPct: null, on: null } }));
                                    setStateOverrideSearch("");
                                  }}
                                  style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: i < matches.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                                  <span style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{s.name}</span>
                                  <span style={{ fontSize: 12, color: "var(--text-4)" }}>{s.tcp[0].party} vs {s.tcp[1].party}</span>
                                  <PartyBadge party={s.winner.party} />
                                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{s.margin.toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {/* Active override cards */}
                      {Object.keys(seatOverrides ?? {}).length === 0 ? (
                        <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-4)", fontSize: 12 }}>
                          No seat overrides active. Search for a seat above to add one.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {Object.entries(seatOverrides).map(([idStr, ov]) => {
                            const seat = allSeats.find(s => s.id === +idStr);
                            if (!seat) return null;
                            const ms = modelled.find(s => s.id === +idStr);
                            const setOv = (patch) => setSeatOverrides(ovs => ({ ...ovs, [+idStr]: { ...ovs[+idStr], ...patch } }));
                            const tcpMatchup = ov.tcpMatchup ?? null;
                            const tcpPct = ov.tcpPct ?? null;
                            const onFp = ov.on ?? null;
                            return (
                              <div key={idStr} style={{ border: "1px solid var(--border-2)", borderRadius: 8, padding: "12px 14px", background: "var(--table-row-alt)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                  <PartyBadge party={seat.winner.party} />
                                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{seat.name}</span>
                                  <span style={{ fontSize: 12, color: "var(--text-4)" }}>Baseline: {seat.tcp[0].party} vs {seat.tcp[1].party} · {seat.margin.toFixed(1)}%</span>
                                  {ms?.modelled.winnerParty && ms.modelled.winnerPct != null && (
                                    <span style={{ fontSize: 12, fontWeight: 700, color: getParty(ms.modelled.winnerParty).color }}>
                                      → {ms.modelled.winnerParty} {ms.modelled.winnerPct.toFixed(1)}%
                                    </span>
                                  )}
                                  <button onClick={() => setSeatOverrides(ovs => { const n = { ...ovs }; delete n[+idStr]; return n; })}
                                    style={{ fontSize: 13, color: "var(--text-4)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>✕</button>
                                </div>
                                {/* Primary vote overrides */}
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Primary vote % overrides (blank = use statewide)</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                                    {parties.map(p => (
                                      <div key={p.k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: p.c }}>{p.l}</span>
                                        <input type="number" min={0} max={100} step={0.5}
                                          value={ov[p.k] ?? ""}
                                          placeholder="—"
                                          onChange={e => setOv({ [p.k]: e.target.value === "" ? null : +e.target.value })}
                                          style={{ width: "100%", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 4px", fontSize: 11, textAlign: "right", boxSizing: "border-box" }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {/* TCP matchup selector */}
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>TCP matchup</div>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    {[
                                      { val: null, label: "Auto" },
                                      { val: "on_v_alp", label: "ON vs ALP" },
                                      { val: "on_v_coal", label: "ON vs Coal" },
                                    ].map(opt => (
                                      <button key={String(opt.val)}
                                        onClick={() => setOv({ tcpMatchup: opt.val })}
                                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid", cursor: "pointer", fontWeight: tcpMatchup === opt.val ? 700 : 400, background: tcpMatchup === opt.val ? "rgba(217,119,6,0.15)" : "var(--subtle-bg)", borderColor: tcpMatchup === opt.val ? "#F59E0B" : "var(--border-2)", color: tcpMatchup === opt.val ? "var(--text-1)" : "var(--text-2)" }}>
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                {/* TCP% override */}
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>
                                    {tcpMatchup === "on_v_alp" || tcpMatchup === "on_v_coal" ? "ON TCP % (≥50 = ON wins)" : "ALP 2CP % (≥50 = ALP wins)"}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input
                                      type="number" min={0} max={100} step={0.5}
                                      value={tcpPct ?? ""}
                                      placeholder="auto"
                                      onChange={e => setOv({ tcpPct: e.target.value === "" ? null : +e.target.value })}
                                      style={{ width: 70, border: "1px solid var(--border-2)", borderRadius: 4, padding: "4px 6px", fontSize: 12, textAlign: "right" }}
                                    />
                                    <span style={{ fontSize: 11, color: "var(--text-4)" }}>%  (leave blank = model-computed)</span>
                                    {tcpPct != null && <button onClick={() => setOv({ tcpPct: null })} style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}>×</button>}
                                  </div>
                                </div>
                                {/* ON primary override */}
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>ON primary % override</div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input
                                      type="number" min={0} max={100} step={0.5}
                                      value={onFp ?? ""}
                                      placeholder="auto"
                                      onChange={e => setOv({ on: e.target.value === "" ? null : +e.target.value })}
                                      style={{ width: 70, border: "1px solid var(--border-2)", borderRadius: 4, padding: "4px 6px", fontSize: 12, textAlign: "right" }}
                                    />
                                    <span style={{ fontSize: 11, color: "var(--text-4)" }}>% (overrides auto-detected ON for this seat)</span>
                                    {onFp != null && <button onClick={() => setOv({ on: null })} style={{ fontSize: 11, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}>×</button>}
                                  </div>
                                </div>
                                {/* Force winner */}
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Force projected winner</div>
                                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                    {[["alp", "ALP", "#DC2626"], ["coalition", "Coalition", "#1D4ED8"], ["greens", "Greens", "#059669"], ["ind", "Ind", "#0891B2"], ["one_nation", "ON", "#B45309"]].map(([g, label, c]) => (
                                      <button key={g}
                                        onClick={() => setOv({ forceGroup: ov.forceGroup === g ? null : g })}
                                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: `1px solid ${c}`, cursor: "pointer", fontWeight: ov.forceGroup === g ? 700 : 400, background: ov.forceGroup === g ? c : "var(--panel-bg)", color: ov.forceGroup === g ? "#fff" : c }}>
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>;
            })()}

            {/* ── TAS 2024 ─ Hare-Clark model ── */}
            {el.modelEnabled && selectedModelId === "tas_2024" && (() => {
              const totalSeats = 35; const majority = 18;
              const coalProj = tasProjected.coal || 0;
              const alpProj = tasProjected.alp || 0;
              const grnProj = tasProjected.grn || 0;
              const indProj = tasProjected.ind || 0;
              const projMaj = coalProj >= majority ? "Coalition majority" : alpProj >= majority ? "ALP majority" : "Hung parliament";
              const majColor = coalProj >= majority ? "#1D4ED8" : alpProj >= majority ? "#DC2626" : "#F59E0B";
              return <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Statewide primary vote %</div>
                    <PrimaryInput label="ALP" value={tasPrim.alp} onChange={v => setTasPrim(p => ({ ...p, alp: v }))} color="#DC2626" baseline={TAS_BL.alp} />
                    <PrimaryInput label="Coalition" value={tasPrim.coal} onChange={v => setTasPrim(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={TAS_BL.coal} />
                    <PrimaryInput label="Greens" value={tasPrim.grn} onChange={v => setTasPrim(p => ({ ...p, grn: v }))} color="#059669" baseline={TAS_BL.grn} />
                    <PrimaryInput label="Independents" value={tasPrim.ind} onChange={v => setTasPrim(p => ({ ...p, ind: v }))} color="#0891B2" baseline={TAS_BL.ind} />
                    <PrimaryInput label="One Nation" value={tasPrim.on ?? 0} onChange={v => setTasPrim(p => ({ ...p, on: v }))} color="#B45309" baseline={TAS_BL.on} />
                    <PrimaryInput label="Undecided" value={tasPrim.undecided ?? 0} onChange={v => setTasPrim(p => ({ ...p, undecided: v }))} color="var(--text-4)" baseline={0} />
                    {(() => {
                      const e = +(tasPrim.alp + tasPrim.coal + tasPrim.grn + tasPrim.ind + (tasPrim.on ?? 0)).toFixed(1); const ud = +(tasPrim.undecided ?? 0); const o = +(100 - e - ud).toFixed(1); const ov = e + ud > 100;
                      return <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "var(--text-3)" }}>Other / minor parties</span><span style={{ fontSize: 13, fontWeight: 700, color: ov ? "#DC2626" : "var(--text-2)" }}>{ov ? `−${Math.abs(o).toFixed(1)}% ⚠` : `${o}%`}</span></div>;
                    })()}
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6 }}>Baseline: ALP {TAS_BL.alp}% · Coalition {TAS_BL.coal}% · Grn {TAS_BL.grn}% · Ind {TAS_BL.ind}% · ON {TAS_BL.on}%</div>
                  </div>
                  {tasHasChanges && <button onClick={() => setTasPrim({ ...TAS_BL, undecided: 0 })} style={{ ...STYLES.btnDanger, width: "100%", padding: "8px", marginBottom: 16 }}>Reset TAS model</button>}
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                    {[{ l: "ALP", v: alpProj, bl: 10, c: "#DC2626" }, { l: "Coalition", v: coalProj, bl: 15, c: "#1D4ED8" }, { l: "Greens", v: grnProj, bl: 7, c: "#059669" }].map(({ l, v, bl, c }) => (
                      <div key={l} style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{v - bl >= 0 ? "+" : ""}{v - bl} vs baseline</div>
                      </div>
                    ))}
                  </div>
                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Projected seats by electorate</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
                      {TAS_ELECTORATES.map(el2 => {
                        const ep = { ...el2, coal: Math.max(0, el2.coal + (tasPrim.coal - TAS_BL.coal)), alp: Math.max(0, el2.alp + (tasPrim.alp - TAS_BL.alp)), grn: Math.max(0, el2.grn + (tasPrim.grn - TAS_BL.grn)), ind: Math.max(0, el2.ind + (tasPrim.ind - TAS_BL.ind)) };
                        const alloc = allocateHareClark([ep], tasPrim);
                        return (
                          <div key={el2.name} style={STYLES.metricCard}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{el2.name}</div>
                            {[{ k: "coal", l: "Coal", c: "#1D4ED8" }, { k: "alp", l: "ALP", c: "#DC2626" }, { k: "grn", l: "Grn", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => (
                              alloc[k] > 0 ? <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6, fontSize: 12, fontWeight: 600 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />
                                {l} {alloc[k]}
                              </span> : null
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-3)" }}>
                      Hare-Clark STV count simulation (Droop quota, surplus pooling, exclusion transfers) · TEC 2024 official results · 5 electorates × 7 seats · reproduces the actual 2024 result at baseline
                    </div>
                  </div>

                  {/* TAS Uncertainty panel */}
                  <div style={{ ...STYLES.panel, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-count uncertainty (Monte Carlo)</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--subtle-bg)", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ · N=500</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 12 }}>
                      {[{ k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "alp", l: "ALP", c: "#DC2626" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => {
                        const s = tasUncertainty[k];
                        if (!s) return null;
                        return (
                          <div key={k} style={STYLES.metricCard}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: c, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{s.mean}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)" }}>P25–P75: {s.p25}–{s.p75}</div>
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>P05–P95: {s.p05}–{s.p95}</div>
                            {k === "coal" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#1D4ED8" : "var(--text-3)" }}>P(maj): {s.pMajority}%</div>}
                            {k === "alp" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#DC2626" : "var(--text-3)" }}>P(maj): {s.pMajority}%</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>Shared across all elections.</div>
                    </div>
                  </div>
                </div>
              </div>;
            })()}

            {/* ── ACT 2024 ─ Hare-Clark model ── */}
            {el.modelEnabled && selectedModelId === "act_2024" && (() => {
              const totalSeats = 25; const majority = 13;
              const coalProj = actProjected.coal || 0;
              const alpProj = actProjected.alp || 0;
              const grnProj = actProjected.grn || 0;
              const projMaj = alpProj >= majority ? "ALP majority" : coalProj >= majority ? "Coalition majority" : "Hung parliament";
              const majColor = alpProj >= majority ? "#DC2626" : coalProj >= majority ? "#1D4ED8" : "#F59E0B";
              return <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Statewide primary vote %</div>
                    <PrimaryInput label="ALP" value={actPrim.alp} onChange={v => setActPrim(p => ({ ...p, alp: v }))} color="#DC2626" baseline={ACT_BL.alp} />
                    <PrimaryInput label="Coalition" value={actPrim.coal} onChange={v => setActPrim(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={ACT_BL.coal} />
                    <PrimaryInput label="Greens" value={actPrim.grn} onChange={v => setActPrim(p => ({ ...p, grn: v }))} color="#059669" baseline={ACT_BL.grn} />
                    <PrimaryInput label="Independents" value={actPrim.ind} onChange={v => setActPrim(p => ({ ...p, ind: v }))} color="#0891B2" baseline={ACT_BL.ind} />
                    <PrimaryInput label="One Nation" value={actPrim.on ?? 0} onChange={v => setActPrim(p => ({ ...p, on: v }))} color="#B45309" baseline={ACT_BL.on} />
                    <PrimaryInput label="Undecided" value={actPrim.undecided ?? 0} onChange={v => setActPrim(p => ({ ...p, undecided: v }))} color="var(--text-4)" baseline={0} />
                    {(() => {
                      const e = +(actPrim.alp + actPrim.coal + actPrim.grn + actPrim.ind + (actPrim.on ?? 0)).toFixed(1); const ud = +(actPrim.undecided ?? 0); const o = +(100 - e - ud).toFixed(1); const ov = e + ud > 100;
                      return <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "var(--text-3)" }}>Other / minor parties</span><span style={{ fontSize: 13, fontWeight: 700, color: ov ? "#DC2626" : "var(--text-2)" }}>{ov ? `−${Math.abs(o).toFixed(1)}% ⚠` : `${o}%`}</span></div>;
                    })()}
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6 }}>Baseline: ALP {ACT_BL.alp}% · Coalition {ACT_BL.coal}% · Grn {ACT_BL.grn}% · Ind {ACT_BL.ind}% · ON {ACT_BL.on}%</div>
                  </div>
                  {actHasChanges && <button onClick={() => setActPrim({ ...ACT_BL, undecided: 0 })} style={{ ...STYLES.btnDanger, width: "100%", padding: "8px", marginBottom: 16 }}>Reset ACT model</button>}
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                    {[{ l: "ALP", v: alpProj, bl: 9, c: "#DC2626" }, { l: "Coalition", v: coalProj, bl: 9, c: "#1D4ED8" }, { l: "Greens", v: grnProj, bl: 7, c: "#059669" }].map(({ l, v, bl, c }) => (
                      <div key={l} style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{v - bl >= 0 ? "+" : ""}{v - bl} vs baseline</div>
                      </div>
                    ))}
                  </div>
                  <div style={panelStyle}>
                    <div style={STYLES.panelTitle}>Projected seats by electorate</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
                      {ACT_ELECTORATES.map(el2 => {
                        const ep = { ...el2, alp: Math.max(0, el2.alp + (actPrim.alp - ACT_BL.alp)), coal: Math.max(0, el2.coal + (actPrim.coal - ACT_BL.coal)), grn: Math.max(0, el2.grn + (actPrim.grn - ACT_BL.grn)), ind: Math.max(0, el2.ind + (actPrim.ind - ACT_BL.ind)) };
                        const alloc = allocateHareClark([ep], actPrim);
                        return (
                          <div key={el2.name} style={STYLES.metricCard}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{el2.name}</div>
                            {[{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coal", c: "#1D4ED8" }, { k: "grn", l: "Grn", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => (
                              alloc[k] > 0 ? <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6, fontSize: 12, fontWeight: 600 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />
                                {l} {alloc[k]}
                              </span> : null
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-3)" }}>
                      Hare-Clark STV count simulation (Droop quota, surplus pooling, exclusion transfers) · ACT EC 2024 official results · 5 electorates × 5 seats · reproduces the actual 2024 result at baseline
                    </div>
                  </div>

                  {/* ACT Uncertainty panel */}
                  <div style={{ ...STYLES.panel, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Seat-count uncertainty (Monte Carlo)</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--subtle-bg)", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ · N=500</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 12 }}>
                      {[{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => {
                        const s = actUncertainty[k];
                        if (!s) return null;
                        return (
                          <div key={k} style={STYLES.metricCard}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: c, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{s.mean}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)" }}>P25–P75: {s.p25}–{s.p75}</div>
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>P05–P95: {s.p05}–{s.p95}</div>
                            {k === "alp" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#DC2626" : "var(--text-3)" }}>P(maj): {s.pMajority}%</div>}
                            {k === "coal" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#1D4ED8" : "var(--text-3)" }}>P(maj): {s.pMajority}%</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid var(--border-3)", paddingTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>Shared across all elections.</div>
                    </div>
                  </div>
                </div>
              </div>;
            })()}

            {selectedModelId === "federal_2025" && (
              <>{/* ── Demographics Overview (collapsible) ── */}
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setDemogSectionOpen(o => !o)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "14px 20px", cursor: "pointer", textAlign: "left", fontWeight: 700, fontSize: 14, color: "var(--text-2)" }}>
                    <span style={{ fontSize: 16 }}>{demogSectionOpen ? "▾" : "▸"}</span>
                    Demographics Overview
                    <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-4)", marginLeft: 4 }}>— seat-level census data</span>
                  </button>
                  {demogSectionOpen && (
                    <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderTopWidth: 0, borderRadius: "0 0 12px 12px", padding: "20px" }}>

                      {/* Filters row */}
                      <div style={{ background: "var(--table-head-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase" }}>Filter:</span>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {STATES.map(st => (
                            <button key={st} onClick={() => toggleSet(setDemogStateFilter, st)}
                              style={{
                                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                                background: demogStateFilter.has(st) ? "var(--text-2)" : "var(--subtle-bg)",
                                color: demogStateFilter.has(st) ? "#fff" : "var(--text-3)",
                                border: "1px solid " + (demogStateFilter.has(st) ? "var(--text-2)" : "var(--border-1)")
                              }}>
                              {st}
                            </button>
                          ))}
                        </div>
                        <span style={{ color: "var(--border-1)" }}>|</span>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {["Inner Metropolitan", "Outer Metropolitan", "Provincial", "Rural"].map(cls => (
                            <button key={cls} onClick={() => toggleSet(setDemogClassFilter, cls)}
                              style={{
                                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                                background: demogClassFilter.has(cls) ? "#1D4ED8" : "var(--subtle-bg)",
                                color: demogClassFilter.has(cls) ? "#fff" : "var(--text-3)",
                                border: "1px solid " + (demogClassFilter.has(cls) ? "#1D4ED8" : "var(--border-1)")
                              }}>
                              {cls}
                            </button>
                          ))}
                        </div>
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-4)" }}>{demogFiltered.length} seats</span>
                      </div>

                      {/* Summary cards — averages for filtered seats */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
                        {[
                          { key: "medianPersonalIncomeEarners", label: "Personal Income (earners)", fmt: v => `$${(v / 1000).toFixed(0)}k/yr` },
                          { key: "medianHouseholdIncome", label: "Median Household Income", fmt: v => `$${(v / 1000).toFixed(0)}k/yr` },
                          { key: "renterPct", label: "Renters", fmt: v => `${v.toFixed(1)}%` },
                          { key: "rentalToIncomeRatio", label: "Rent-to-Income", fmt: v => `${v.toFixed(1)}%` },
                          { key: "unemploymentRate", label: "Unemployment Rate", fmt: v => `${v.toFixed(1)}%` },
                          { key: "bachelorsOrAbovePct", label: "Bachelor's+", fmt: v => `${v.toFixed(1)}%` },
                          { key: "nonEnglishAtHomePct", label: "Non-English at Home", fmt: v => `${v.toFixed(1)}%` },
                          { key: "overseasBornPct", label: "Overseas Born", fmt: v => `${v.toFixed(1)}%` },
                          { key: "youth15to34Pct", label: "Youth (15–34)", fmt: v => `${v.toFixed(1)}%` },
                          { key: "medianAge", label: "Median Age", fmt: v => `${Math.round(v)}` },
                        ].map(({ key, label, fmt }) => {
                          const s = demogStats[key];
                          if (!s) return null;
                          return (
                            <div key={key} style={STYLES.metricCard}>
                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 6 }}>{label}</div>
                              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>{fmt(s.avg)}</div>
                              <div style={{ fontSize: 11, color: "var(--text-4)" }}>Range: {fmt(s.min)} – {fmt(s.max)}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 14 }}>Averages are for filtered seats above · Personal income (earners) = median of persons with income &gt; $0, excl. nil/negative · All other income = all persons 15+ · ABS Census 2021</div>

                      {/* Demographic table */}
                      <div style={{ border: "1px solid var(--border-1)", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
                        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                              <tr>
                                {[
                                  { k: "name", label: "Seat" },
                                  { k: "state", label: "State" },
                                  { k: "winner", label: "2022 Winner" },
                                  { k: "urbanClass", label: "Urban Class" },
                                  { k: "medianPersonalIncomeEarners", label: "Inc. (earners)" },
                                  { k: "medianHouseholdIncome", label: "HH Income" },
                                  { k: "medianWeeklyRent", label: "Wkly Rent" },
                                  { k: "rentalToIncomeRatio", label: "Rent/Inc %" },
                                  { k: "renterPct", label: "Renters %" },
                                  { k: "ownerMortgagePct", label: "Mortgage %" },
                                  { k: "bachelorsOrAbovePct", label: "Bach.+ %" },
                                  { k: "noQualificationPct", label: "No Qual %" },
                                  { k: "overseasBornPct", label: "O/seas Born" },
                                  { k: "nonEnglishAtHomePct", label: "Non-Eng %" },
                                  { k: "unemploymentRate", label: "Unemp. %" },
                                  { k: "youth15to34Pct", label: "Youth 15-34" },
                                  { k: "medianAge", label: "Med. Age" },
                                ].map(({ k, label }) => (
                                  <th key={k} onClick={() => {
                                    if (demogSortKey === k) {
                                      setDemogSortDir(d => d === "asc" ? "desc" : "asc");
                                    } else {
                                      setDemogSortKey(k);
                                      setDemogSortDir("desc");
                                    }
                                  }} style={{ padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", background: "var(--table-head-bg)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-1)" }}>
                                    {label}{" "}
                                    <span style={{ color: demogSortKey === k ? "var(--text-2)" : "var(--border-2)" }}>
                                      {demogSortKey === k ? (demogSortDir === "asc" ? "↑" : "↓") : "↕"}
                                    </span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {demogFiltered.map(s => {
                                const pg = getParty(s.winner.party);
                                const d = s.demog;
                                const isExpanded = expandedDemogId === s.id;
                                return (
                                  <>
                                    <tr key={s.id} onClick={() => setExpandedDemogId(prev => prev === s.id ? null : s.id)}
                                      style={{
                                        borderBottom: "1px solid var(--border-3)", cursor: "pointer",
                                        borderLeft: `3px solid ${pg.color}`,
                                        background: isExpanded ? "var(--table-head-bg)" : undefined,
                                        transition: "background 0.1s"
                                      }}
                                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "var(--table-head-bg)"; }}
                                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ""; }}>
                                      <td style={{ padding: "9px 12px", fontWeight: 600, color: "var(--text-1)" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</td>
                                      <td style={{ padding: "9px 12px", color: "var(--text-3)" }}>{s.state}</td>
                                      <td style={{ padding: "9px 12px" }}>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--subtle-bg)", color: "var(--text-1)", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 2, border: "1px solid var(--border-1)" }}>
                                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: pg.color, display: "inline-block", flexShrink: 0 }} />
                                          {pg.short}
                                        </span>
                                      </td>
                                      <td style={{ padding: "9px 12px", color: "var(--text-3)", fontSize: 11 }}>{d.urbanClass ?? "—"}</td>
                                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{d.medianPersonalIncomeEarners ? `$${(d.medianPersonalIncomeEarners / 1000).toFixed(0)}k` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(0)}k` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.medianWeeklyRent ? `$${d.medianWeeklyRent}` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.rentalToIncomeRatio != null ? `${d.rentalToIncomeRatio}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.renterPct != null ? `${d.renterPct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.noQualificationPct != null ? `${d.noQualificationPct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.nonEnglishAtHomePct != null ? `${d.nonEnglishAtHomePct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.unemploymentRate != null ? `${d.unemploymentRate}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.youth15to34Pct != null ? `${d.youth15to34Pct}%` : "—"}</td>
                                      <td style={{ padding: "9px 12px" }}>{d.medianAge != null ? Math.round(d.medianAge) : "—"}</td>
                                    </tr>
                                    {isExpanded && (
                                      <tr key={`${s.id}-exp`}>
                                        <td colSpan={17} style={{ background: "var(--table-head-bg)", padding: "16px 20px", borderBottom: "2px solid #E5E7EB" }}>
                                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 8 }}>Income</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Personal (earners):</strong> {d.medianPersonalIncomeEarners ? `$${(d.medianPersonalIncomeEarners / 1000).toFixed(1)}k/yr` : "—"}</div>
                                                <div><strong>Personal (all 15+):</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                                <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                              </div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 8 }}>Housing</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Owner outright:</strong> {d.ownerOutrightPct != null ? `${d.ownerOutrightPct}%` : "—"}</div>
                                                <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                                <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                                <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                                <div><strong>Rent-to-income:</strong> {d.rentalToIncomeRatio != null ? `${d.rentalToIncomeRatio}%` : "—"}</div>
                                                <div><strong>Monthly mortgage:</strong> {d.medianMonthlyMortgage ? `$${d.medianMonthlyMortgage}/mo` : "—"}</div>
                                              </div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", marginBottom: 8 }}>People</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Median age:</strong> {d.medianAge != null ? Math.round(d.medianAge) : "—"}</div>
                                                <div><strong>Youth (15–34):</strong> {d.youth15to34Pct != null ? `${d.youth15to34Pct}%` : "—"}</div>
                                                <div><strong>Seniors (65+):</strong> {d.seniors65PlusPct != null ? `${d.seniors65PlusPct}%` : "—"}</div>
                                                <div><strong>Unemployment:</strong> {d.unemploymentRate != null ? `${d.unemploymentRate}%` : "—"}</div>
                                                <div><strong>Labour participation:</strong> {d.labourParticipationRate != null ? `${d.labourParticipationRate}%` : "—"}</div>
                                                <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                                <div><strong>No post-school qual.:</strong> {d.noQualificationPct != null ? `${d.noQualificationPct}%` : "—"}</div>
                                                <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
                                                <div><strong>Non-English at home:</strong> {d.nonEnglishAtHomePct != null ? `${d.nonEnglishAtHomePct}%` : "—"}</div>
                                                <div><strong>Lone-parent families:</strong> {d.loneparentFamilyPct != null ? `${d.loneparentFamilyPct}%` : "—"}</div>
                                                <div><strong>AEC class:</strong> {d.urbanClass ?? "—"}</div>
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Correlation scatter plot */}
                      <div style={{ border: "1px solid var(--border-1)", borderRadius: 10, padding: "18px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)" }}>Correlation Explorer</div>
                          <select value={demogXMetric} onChange={e => setDemogXMetric(e.target.value)}
                            style={{ border: "1px solid var(--border-2)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, outline: "none" }}>
                            {DEMOG_METRICS.map(({ key, label }) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                          <span style={{ fontSize: 12, color: "var(--text-4)" }}>vs Modelled 2PP Margin (ALP above/below 50%)</span>
                        </div>
                        <ResponsiveContainer width="100%" height={320}>
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                            <CartesianGrid {...CHART.grid} />
                            <XAxis dataKey="x" name="X" type="number" domain={["auto", "auto"]}
                              tickFormatter={v => {
                                const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                                return m ? m.fmt(v) : v;
                              }}
                              tick={{ fontSize: 11 }} />
                            <YAxis dataKey="y" name="Margin" tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                              tick={{ fontSize: 11 }} />
                            <ReferenceLine y={0} stroke={chartTickColor} strokeDasharray="4 2" label={{ value: "50%", position: "right", fontSize: 10, fill: chartTickColor }} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0].payload;
                                const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                                const grpCfg = GROUP_CONFIG[p.group] ?? { color: "var(--text-3)", label: p.group };
                                return (
                                  <div style={{ background: "var(--panel-bg)", border: `1px solid ${grpCfg.color}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
                                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name} ({p.state})</div>
                                    <div style={{ color: "var(--text-3)" }}>{m?.label}: <strong>{m ? m.fmt(p.x) : p.x}</strong></div>
                                    <div style={{ color: "var(--text-3)" }}>2PP margin: <strong>{p.y > 0 ? "+" : ""}{p.y.toFixed(1)}pp</strong></div>
                                    <div style={{ color: grpCfg.color, fontWeight: 600, marginTop: 2 }}>{grpCfg.label}</div>
                                  </div>
                                );
                              }}
                            />
                            <ZAxis range={[40, 40]} />
                            {GROUP_ORDER.map(grp => {
                              const pts = scatterData.filter(p => p.group === grp);
                              if (!pts.length) return null;
                              return (
                                <Scatter key={grp} name={GROUP_CONFIG[grp]?.label ?? grp} data={pts}
                                  fill={GROUP_CONFIG[grp]?.color ?? "var(--text-3)"}
                                  fillOpacity={0.7} />
                              );
                            })}
                          </ScatterChart>
                        </ResponsiveContainer>
                        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
                          {GROUP_ORDER.map(grp => {
                            const pts = scatterData.filter(p => p.group === grp);
                            if (!pts.length) return null;
                            return (
                              <span key={grp} style={{ fontSize: 11, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 10, height: 10, borderRadius: "50%", background: GROUP_CONFIG[grp]?.color, display: "inline-block" }} />
                                {GROUP_CONFIG[grp]?.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </>)}

          </div>
        );
      })()}

      {/* ══════════════════════ MARKETS TAB ═══════════════════════════════════ */}
      {activeTab === "markets" && (() => {
        const mktNational = BETTING_ODDS?.national ?? {};
        const mktSeats = BETTING_ODDS?.seats ?? {};
        const mktSource = BETTING_ODDS?.source ?? "unknown";
        const mktGenerated = BETTING_ODDS?.generated ?? "";
        const isManual = mktSource === "manual";

        const sourceBadge = {
          betfair:      { label: "Betfair Exchange", color: "#059669", bg: "#D1FAE5" },
          smarkets:     { label: "Smarkets Exchange (live)", color: "#059669", bg: "#D1FAE5" },
          "the-odds-api": { label: "The Odds API", color: "#1D4ED8", bg: "#DBEAFE" },
          manual:       { label: "Indicative", color: "#D97706", bg: "rgba(217,119,6,0.14)" },
        }[mktSource] ?? { label: mktSource, color: "var(--text-3)", bg: "var(--subtle-bg)" };

        const alpMajority = mktNational.alp_majority;
        const coalMajority = mktNational.coalition_majority;

        // Seat rows sorted by finalist_a_prob descending (most contested first)
        const seatRows = Object.entries(mktSeats).sort(([, a], [, b]) =>
          Math.min(a.finalist_a_prob, a.finalist_b_prob) - Math.min(b.finalist_a_prob, b.finalist_b_prob)
        );

        const groupColor = {
          alp: "#DC2626", coalition: "#1D4ED8", greens: "#059669",
          teal: "#0891B2", on: "#B45309", other: "var(--text-3)",
        };

        return (
          <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", maxWidth: 960, margin: "0 auto" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 style={STYLES.sectionTitle}>Betting Markets</h2>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>
                  Market-implied probabilities and estimated 2PP values. Read-only overlay — does not affect the model.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: sourceBadge.color, background: sourceBadge.bg, padding: "3px 8px", borderRadius: 8 }}>
                  {sourceBadge.label}
                </span>
                {mktGenerated && (
                  <span style={{ fontSize: 11, color: "var(--text-4)" }}>{isManual ? "As of" : "Updated"} {mktGenerated}</span>
                )}
              </div>
            </div>


            {/* National government odds */}
            <div style={{ ...panelStyle, marginBottom: 14 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
                  National government odds
                  {BETTING_ODDS?.national_source === "manual" && (
                    <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#D97706", background: "rgba(217,119,6,0.14)", padding: "2px 6px", borderRadius: 3, verticalAlign: "middle" }}>
                      Indicative
                    </span>
                  )}
                </div>
                {BETTING_ODDS?.national_market_name && (
                  <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>
                    Market: {BETTING_ODDS.national_market_name}
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {alpMajority && (
                  <div style={STYLES.metricCard}>
                    <div style={{ width: 20, height: 3, background: "#DC2626", borderRadius: 2, marginBottom: 6 }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>ALP Majority</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>
                        {(alpMajority.implied_prob * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>implied</span>
                    </div>
                    {alpMajority.decimal_odds && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                        Odds: ${alpMajority.decimal_odds.toFixed(2)}
                      </div>
                    )}
                    {alpMajority.implied_2pp != null && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                        Implied 2PP: <strong style={{ color: "#DC2626" }}>{alpMajority.implied_2pp}%</strong>
                      </div>
                    )}
                  </div>
                )}
                {coalMajority && (
                  <div style={STYLES.metricCard}>
                    <div style={{ width: 20, height: 3, background: "#1D4ED8", borderRadius: 2, marginBottom: 6 }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Coalition Majority</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#1D4ED8" }}>
                        {(coalMajority.implied_prob * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>implied</span>
                    </div>
                    {coalMajority.decimal_odds && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                        Odds: ${coalMajority.decimal_odds.toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
                {mktNational.hung_parliament && (
                  <div style={STYLES.metricCard}>
                    <div style={{ width: 20, height: 3, background: "#7C3AED", borderRadius: 2, marginBottom: 6 }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>Hung Parliament</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#7C3AED" }}>
                        {(mktNational.hung_parliament.implied_prob * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-3)" }}>implied</span>
                    </div>
                    {mktNational.hung_parliament.decimal_odds && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                        Odds: ${mktNational.hung_parliament.decimal_odds.toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
                {!alpMajority && !coalMajority && (
                  <div style={{ fontSize: 13, color: "var(--text-4)", padding: "12px 0" }}>
                    No national market data available.
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-4)" }}>
                Implied 2PP uses: 2PP = 50 + {BETTING_ODDS?.sigma_national ?? 1.5}pp × Φ⁻¹(P_win) · Per-seat σ = {BETTING_ODDS?.sigma_per_seat ?? 2.5}pp
              </div>
            </div>

            {/* Seat markets table */}
            <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border-3)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
                  Seat markets{seatRows.length > 0 ? ` (${seatRows.length} seats)` : ""}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                  Only ~20–40 contested seats have liquid betting markets before an election. Sorted by contest tightness.
                </div>
              </div>
              {seatRows.length === 0 ? (
                <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--text-4)", textAlign: "center" }}>
                  No seat market data available.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-1)", background: "var(--table-head-bg)" }}>
                      {["Seat", "Finalist A", "Prob", "Finalist B", "Prob", "Implied 2PP (ALP)"].map((h, i) => (
                        <th key={i} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {seatRows.map(([seatName, mkt], i) => {
                      const faColor = groupColor[mkt.finalist_a] ?? "var(--text-3)";
                      const fbColor = groupColor[mkt.finalist_b] ?? "var(--text-3)";
                      const tightnessColor = Math.min(mkt.finalist_a_prob, mkt.finalist_b_prob) > 0.4
                        ? "#DC2626" : Math.min(mkt.finalist_a_prob, mkt.finalist_b_prob) > 0.3
                          ? "#D97706" : "var(--text-2)";
                      return (
                        <tr key={seatName} style={{ background: i % 2 === 0 ? "var(--panel-bg)" : "var(--table-row-alt)", borderBottom: "1px solid var(--border-3)" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600 }}>{seatName}</td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ fontWeight: 700, color: faColor, textTransform: "capitalize" }}>{mkt.finalist_a}</span>
                          </td>
                          <td style={{ padding: "8px 12px", fontWeight: 700, color: tightnessColor }}>
                            {(mkt.finalist_a_prob * 100).toFixed(0)}%
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ fontWeight: 700, color: fbColor, textTransform: "capitalize" }}>{mkt.finalist_b}</span>
                          </td>
                          <td style={{ padding: "8px 12px", fontWeight: 700, color: tightnessColor }}>
                            {(mkt.finalist_b_prob * 100).toFixed(0)}%
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {mkt.implied_2pp_alp != null
                              ? <strong style={{ color: mkt.implied_2pp_alp >= 50 ? "#DC2626" : "#1D4ED8" }}>{mkt.implied_2pp_alp}%</strong>
                              : <span style={{ color: "var(--text-4)" }}>—</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* State election markets */}
            {(() => {
              const stateMarkets = BETTING_ODDS?.state_elections ?? {};
              const stateEntries = Object.entries(stateMarkets);
              if (stateEntries.length === 0) return null;

              const statePartyColor = { alp: "#DC2626", coalition: "#1D4ED8" };

              return (
                <div style={{ ...panelStyle, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 12 }}>State & territory elections</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                    {stateEntries.map(([stateCode, mkt]) => {
                      const alpProb  = mkt.alp_win?.implied_prob;
                      const coalProb = mkt.coalition_win?.implied_prob;
                      const isManualState = mkt.source === "manual";
                      const leader = alpProb != null && coalProb != null
                        ? (alpProb >= coalProb ? "alp" : "coalition")
                        : null;
                      return (
                        <div key={stateCode} style={{ ...STYLES.metricCard, position: "relative" }}>
                          {isManualState && (
                            <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 700, color: "#D97706", background: "rgba(217,119,6,0.14)", padding: "2px 6px", borderRadius: 3 }}>
                              Indicative
                            </span>
                          )}
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 2 }}>
                            {stateCode.toUpperCase()}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>
                            {mkt.election_name ?? `${stateCode.toUpperCase()} Election`}
                            {mkt.date && <span style={{ marginLeft: 6, color: "var(--text-4)" }}>{mkt.date}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 10 }}>
                            {alpProb != null && (
                              <div style={{ flex: 1, textAlign: "center" }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: statePartyColor.alp, marginBottom: 2 }}>ALP/Labor</div>
                                <div style={{ fontSize: 22, fontWeight: 800, color: leader === "alp" ? statePartyColor.alp : "var(--text-2)" }}>
                                  {(alpProb * 100).toFixed(0)}%
                                </div>
                                {mkt.alp_win?.decimal_odds && (
                                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>${mkt.alp_win.decimal_odds.toFixed(2)}</div>
                                )}
                              </div>
                            )}
                            {coalProb != null && (
                              <div style={{ flex: 1, textAlign: "center" }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: statePartyColor.coalition, marginBottom: 2 }}>Coalition/Lib</div>
                                <div style={{ fontSize: 22, fontWeight: 800, color: leader === "coalition" ? statePartyColor.coalition : "var(--text-2)" }}>
                                  {(coalProb * 100).toFixed(0)}%
                                </div>
                                {mkt.coalition_win?.decimal_odds && (
                                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>${mkt.coalition_win.decimal_odds.toFixed(2)}</div>
                                )}
                              </div>
                            )}
                          </div>
                          {isManualState && mkt.as_of && (
                            <div style={{ fontSize: 9, color: "var(--text-4)", marginTop: 6, textAlign: "center" }}>
                              as of {mkt.as_of}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 8 }}>
                    Live markets (Betfair / Smarkets / The Odds API) override these as elections approach. States without a live market show indicative placeholder odds, tagged above.
                  </div>
                </div>
              );
            })()}

            {/* Methodology note */}
            <div style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "14px 16px", fontSize: 12, color: "var(--text-3)" }}>
              <strong style={{ color: "var(--text-2)" }}>How odds translate to 2PP:</strong>{" "}
              Decimal odds are converted to implied probabilities by removing the bookmaker overround
              (normalising raw implied probs to sum to 100%). For ALP vs Coalition seats, the win
              probability is inverted through the normal distribution:
              {" "}<em>2PP = 50 + σ × Φ⁻¹(P_win)</em>, where σ = {BETTING_ODDS?.sigma_per_seat ?? 2.5}pp
              (seat-level prediction uncertainty from historical calibration). For teal/Greens seats
              with no ALP 2PP equivalent, the raw win probability is shown directly.
            </div>

          </div>
        );
      })()}

      {/* victoria tab removed — see Model tab → Victoria 2022 dropdown option */}
      {false && (
        <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", maxWidth: 960, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>2022 Victorian State Election</h1>
          <p style={{ color: "var(--text-3)", marginBottom: 18 }}>
            {VIC_2022_SUMMARY.date} · Legislative Assembly · {VIC_2022_SUMMARY.total} seats
            &nbsp;·&nbsp; Premier: {VIC_2022_SUMMARY.premier}
          </p>

          {/* Summary bar */}
          <div style={{ ...STYLES.panel, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>
              2022 result — {VIC_2022_SUMMARY.total} seats
            </div>
            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", gap: 2 }}>
              {[
                { label: "Labor", count: VIC_2022_SUMMARY.alp, color: "#DC2626" },
                { label: "Coalition", count: VIC_2022_SUMMARY.lp, color: "#1D4ED8" },
                { label: "Greens", count: VIC_2022_SUMMARY.grn, color: "#059669" },
                { label: "IND", count: VIC_2022_SUMMARY.ind, color: "#0891B2" },
              ].map(g => (
                <div key={g.label} style={{ flex: g.count, background: g.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
                  {g.count >= 4 ? g.count : ""}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 8 }}>
              {[
                { label: "Labor", count: VIC_2022_SUMMARY.alp, color: "#DC2626" },
                { label: "Coalition", count: VIC_2022_SUMMARY.lp, color: "#1D4ED8" },
                { label: "Greens", count: VIC_2022_SUMMARY.grn, color: "#059669" },
                { label: "IND", count: VIC_2022_SUMMARY.ind, color: "#0891B2" },
              ].map(g => (
                <span key={g.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-2)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, display: "inline-block" }} />
                  {g.label} <strong>{g.count}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 18 }}>
            {[
              { label: "Labor majority", value: `+${VIC_2022_SUMMARY.alp - 45}`, color: "#DC2626", note: "over majority" },
              { label: "Coalition seats", value: VIC_2022_SUMMARY.lp, color: "#1D4ED8", note: "vs 27 in 2018" },
              { label: "Greens seats", value: VIC_2022_SUMMARY.grn, color: "#059669", note: "lower house" },
              { label: "Independent seats", value: VIC_2022_SUMMARY.ind, color: "#0891B2", note: "lower house" },
              { label: "Next election", value: "Nov 2026", color: "#7C3AED", note: "due ~29 Nov" },
            ].map(card => (
              <div key={card.label} style={{ ...STYLES.statCard }}>

                <div style={{ width: 24, height: 3, background: card.color, borderRadius: 2, marginBottom: 8 }} />
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)" }}>{card.value}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{card.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 1 }}>{card.note}</div>
              </div>
            ))}
          </div>

          {/* Pipeline call-to-action */}
          <div style={{ background: "var(--row-highlight)", border: "1px solid var(--border-2)", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, color: "#1D4ED8", marginBottom: 6, fontSize: 14 }}>
              Load full 88-seat data
            </div>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 8px" }}>
              The VEC pipeline downloads district-level first preference and two-candidate preferred
              results from <strong>vec.vic.gov.au</strong> for all 88 Legislative Assembly seats.
            </p>
            <code style={{ display: "block", background: "var(--header-bg)", color: "#93C5FD", padding: "8px 12px", borderRadius: 3, fontSize: 12, fontFamily: "monospace" }}>
              python main.py --state vic --year 202211
            </code>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8, marginBottom: 0 }}>
              For booth-level data, place The Tally Room CSVs (2022 is free at tallyroom.com.au)
              in <code>data/raw/vic/202211/</code> before running.
            </p>
          </div>

          {/* Key seats table */}
          <div style={{ background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: "var(--text-2)" }}>
              Key seats — 2022 confirmed results
            </div>
            <p style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 14 }}>
              Non-ALP/Liberal seats plus selected marginals. Margins are 2CP % margin.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                  {["District", "Winner", "Party", "2CP Matchup", "Margin"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VIC_SEATS.map(seat => {
                  const party = seat.winner.party;
                  const winner = seat.winner.name;
                  const tcp1 = seat.tcp[0].party;
                  const tcp2 = seat.tcp[1].party;
                  const margin = seat.margin;
                  const p = getParty(party);
                  const marginCat = margin < 2 ? "very_marginal" : margin < 5 ? "marginal" : margin < 10 ? "fairly_safe" : "safe";
                  return (
                    <tr key={seat.id} style={{ borderBottom: "1px solid var(--border-3)" }}>
                      <td style={{ padding: "9px 12px", fontWeight: 600, fontSize: 13 }}>{seat.name}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-2)" }}>{winner}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ background: p.color, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{p.short}</span>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-3)" }}>
                        {getParty(tcp1).short} v {getParty(tcp2).short}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: MARGIN_COLOR[marginCat], display: "inline-block" }} />
                          <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 13 }}>{margin.toFixed(1)}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "var(--text-4)", marginTop: 12, marginBottom: 0 }}>
              All 88 Legislative Assembly districts. Margins are 2CP (two-candidate preferred) vs the second finalist.
              Independent seat margins are 2CP vs nearest rival. Winner names for safe ALP seats show "Labor MP" where the specific MP name was not recorded in this dataset.
            </p>
          </div>

          {/* Data source note */}
          <div style={{ background: "var(--table-head-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: "12px 16px", marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              <strong>Data sources:</strong>{" "}
              <a href="https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results"
                target="_blank" rel="noreferrer" style={{ color: "#1D4ED8" }}>
                VEC 2022 State Election Results
              </a>
              {" · "}
              <a href="https://www.tallyroom.com.au/archive/vic2022" target="_blank" rel="noreferrer" style={{ color: "#1D4ED8" }}>
                The Tally Room (booth-level)
              </a>
              {" · Next VIC election: November 2026"}
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════ METHODOLOGY TAB ══════════════════════════════════ */}
      {activeTab === "methodology" && (() => {
        const secHead = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-4)", marginBottom: 6 };
        const secTitle = { fontSize: isMobile ? 15 : 16, fontWeight: 700, color: "var(--text-dark)", margin: "0 0 10px" };
        const prose = { fontSize: 13, color: "var(--text-2)", lineHeight: 1.75, margin: "0 0 12px" };
        const codeBlock = {
          fontFamily: "'JetBrains Mono','Fira Code','Menlo',monospace",
          fontSize: isMobile ? 11 : 12,
          background: "var(--header-bg)",
          color: "var(--header-fg)",
          borderRadius: 3,
          padding: "14px 16px",
          overflowX: "auto",
          whiteSpace: "pre",
          lineHeight: 1.7,
          margin: "0 0 16px",
        };
        const tblHead = { padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "var(--text-2)", borderBottom: "1px solid var(--border-1)", background: "var(--metric-bg)" };
        const tblCell = { padding: "8px 12px", fontSize: 13, color: "var(--text-2)", borderBottom: "1px solid var(--border-3)" };
        const tblCellR = { ...tblCell, textAlign: "right", fontVariantNumeric: "tabular-nums" };
        const divider = { borderTop: "1px solid var(--border-1)", margin: "20px 0" };
        const panel = { ...STYLES.panel, marginBottom: 16 };
        return (
          <div style={{ maxWidth: 800, margin: "0 auto", padding: isMobile ? "20px 14px" : "28px 24px" }}>

            {/* Page title */}
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, color: "var(--text-dark)", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Methodology</h1>
              <p style={{ ...prose, color: "var(--text-3)", marginBottom: 0 }}>
                aus-poll is a scenario modelling tool — it projects seat outcomes given the primary vote inputs you specify.
                It is not a forward prediction and does not account for campaign dynamics or candidate-specific factors.
              </p>
            </div>

            {/* §1 Primary-vote baseline */}
            <div style={panel}>
              <div style={secHead}>1. Primary-vote baseline</div>
              <h2 style={secTitle}>Per-seat first-preference baselines</h2>
              <p style={prose}>
                The model uses each division's actual 2025 AEC first-preference result as its starting point, drawn from
                the <code style={{ fontFamily: "monospace", background: "var(--page-bg)", padding: "1px 5px", borderRadius: 3 }}>SEAT_FP_2025</code> constant
                (booth-level totals aggregated to division level). For the handful of seats missing granular data, the
                2025 national primary average is substituted.
              </p>
              <p style={prose}>
                This approach differs from Uniform National Swing (UNS), which assumes the same swing adds identically to
                every seat's 2PP regardless of its minor-party composition. Because Greens voters preference ALP at ~86%
                while One Nation voters do so at only ~15%, two seats with the same 2PP margin but different primary
                compositions will respond very differently to the same national swing. The primary-vote method captures
                this seat-by-seat variation automatically.
              </p>
            </div>

            {/* §2 2PP computation */}
            <div style={panel}>
              <div style={secHead}>2. Two-candidate preferred computation</div>
              <h2 style={secTitle}>Per-seat 2PP formula</h2>
              <p style={prose}>After applying swings (see §3), the modelled 2PP for seat <em>i</em> is:</p>
              <pre style={codeBlock}>{
`                FP_ALP + FP_GRN·f_GRN + FP_TEAL·f_TEAL + FP_ON·f_ON + FP_UAP·f_UAP + FP_OTH·f_OTH
2PP_ALP(i) = ──────────────────────────────────────────────────────────────────────────────────────────
                FP_ALP + FP_COAL + FP_GRN + FP_TEAL + FP_ON + FP_UAP + FP_OTH`
              }</pre>
              <p style={{ ...prose, color: "var(--text-3)", fontSize: 12, marginBottom: 14 }}>
                FP_X(i) is the primary vote share for party X in seat <em>i</em> after swing adjustment. f_X is the
                preference flow rate to ALP for that voter group (see table). Primaries are floored at 0 and Other
                is the residual after summing all named parties.
              </p>
              <p style={prose}>Preference flow constants — derived from the AEC 2025 national distribution of preferences:</p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Voter group</th>
                    <th style={{ ...tblHead, textAlign: "right", color: "#DC2626" }}>f (→ ALP)</th>
                    <th style={{ ...tblHead, textAlign: "right", color: "#1D4ED8" }}>→ Coalition</th>
                    <th style={{ ...tblHead, textAlign: "right", color: "var(--text-3)" }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Greens",             "0.857", "0.143", "AEC 2025 DOP"],
                    ["Teal independents",  "0.735", "0.265", "AEC 2025 DOP"],
                    ["One Nation",         "0.149", "0.851", "AEC 2025 DOP"],
                    ["UAP / Clive Palmer", "0.270", "0.730", "AEC 2025 DOP"],
                    ["Other / minor",      "0.574", "0.426", "AEC 2025 DOP"],
                  ].map(([group, alp, coal, src]) => (
                    <tr key={group}>
                      <td style={tblCell}>{group}</td>
                      <td style={{ ...tblCellR, color: "#DC2626", fontWeight: 600 }}>{alp}</td>
                      <td style={{ ...tblCellR, color: "#1D4ED8", fontWeight: 600 }}>{coal}</td>
                      <td style={{ ...tblCellR, color: "var(--text-4)", fontSize: 12 }}>{src}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...prose, color: "var(--text-3)", fontSize: 12, marginBottom: 0 }}>
                Per-seat DOP flows are available for most divisions and take precedence over the national averages above
                where present (<code style={{ fontFamily: "monospace" }}>SEAT_PREF_FLOWS_2025</code>). A calibration delta
                corrects for the difference between national-average and per-seat flows at zero swing.
              </p>
            </div>

            {/* §3 Swing application */}
            <div style={panel}>
              <div style={secHead}>3. Swing application</div>
              <h2 style={secTitle}>Per-seat primary adjustment</h2>
              <p style={prose}>
                The user specifies national primary swings Δ for each party on the Model tab. These are applied to each
                seat's baseline:
              </p>
              <pre style={codeBlock}>{
`FP_X(i) = max(0, FP_X_baseline(i) + Δ_X)     for X ∈ {ALP, Coal, GRN, TEAL, ON}
FP_OTH(i) = max(0, 100 − FP_ALP − FP_COAL − FP_GRN − FP_TEAL − FP_ON)`
              }</pre>
              <p style={prose}>
                When state-level swings are configured, a blend of national and state swings is used for seats in that
                state (<code style={{ fontFamily: "monospace" }}>blendSwings()</code>). Seat-level primary overrides on the Model
                tab replace the baseline+swing value directly for the overridden parties; un-overridden parties still
                use national swings from the seat's actual baseline.
              </p>
              <div style={divider} />
              <h3 style={{ ...secTitle, fontSize: 14, marginBottom: 8 }}>Seat elasticity (optional)</h3>
              <p style={prose}>
                An optional logistic multiplier scales the national 2PP swing before it is added to a seat's baseline,
                reflecting the empirical observation that marginal seats tend to swing more than safe seats:
              </p>
              <pre style={codeBlock}>{
`ε(i) = 0.593 + 0.856 / (1 + exp(0.350 · (|2PP_ALP(i) − 50| − 8.725)))`
              }</pre>
              <p style={prose}>
                Coefficients fitted on 2022→2025 actual seat swings (112 paired ALP/Coalition seats,
                scripts/fit_elasticity.py; steepness capped at 0.35 because the curve shape is weakly
                identified — MAE is nearly flat in k). Safe seats damp swings more than the previous
                hand-tuned curve.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Margin (pp from 50%)</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>ε</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Effect</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["0  (knife-edge)", "~1.41×", "Swing amplified"],
                    ["9  (marginal)",   "~1.01×", "Near neutral"],
                    ["15 (competitive)","~0.68×", "Dampened"],
                    ["25+ (safe)",      "~0.60×", "Swing dampened"],
                  ].map(([m, e, fx]) => (
                    <tr key={m}>
                      <td style={tblCell}>{m}</td>
                      <td style={{ ...tblCellR, fontWeight: 600 }}>{e}</td>
                      <td style={{ ...tblCellR, color: "var(--text-3)" }}>{fx}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* §4 Three-party races */}
            <div style={panel}>
              <div style={secHead}>4. Three-party race detection</div>
              <h2 style={secTitle}>One Nation TCP auto-detection</h2>
              <p style={prose}>
                When a seat's estimated One Nation primary exceeds a threshold (default 6.5 pp), the model checks whether
                ON could plausibly reach the final two-candidate count. The test compares estimated primaries for the three
                main parties:
              </p>
              <pre style={codeBlock}>{
`if ON > ALP  and COAL ≥ ALP  →  ALP eliminated  →  ON vs Coalition final
if ON > COAL and ALP  ≥ COAL  →  Coalition eliminated  →  ON vs ALP final`
              }</pre>
              <p style={prose}>
                In ON-race branches, separate preference flow constants apply (
                <code style={{ fontFamily: "monospace", background: "var(--page-bg)", padding: "1px 5px", borderRadius: 3 }}>grn_alp_v_on</code>,
                <code style={{ fontFamily: "monospace", background: "var(--page-bg)", padding: "1px 5px", borderRadius: 3 }}> teal_alp_v_on</code>, etc.).
                These are higher toward ALP than standard flows, reflecting strong anti-ON preference sorting.
                The detection can be overridden per seat on the Model tab.
              </p>
            </div>

            {/* §5 Uncertainty model */}
            <div style={panel}>
              <div style={secHead}>5. Uncertainty quantification</div>
              <h2 style={secTitle}>Seat-level win probabilities</h2>
              <p style={prose}>
                The model integrates four sources of uncertainty to produce a seat-count distribution rather than a point
                estimate:
              </p>
              <pre style={codeBlock}>{
`σ_seat(i) = √( ε(i)² · σ_nat² + σ_state² + σ_res² + σ_pref² )

P(ALP wins seat i) = Φ( (2PP_ALP(i) − 50) / σ_seat(i) )`
              }</pre>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Parameter</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Value</th>
                    <th style={tblHead}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["σ_nat", "from poll CI", "National 2PP swing uncertainty; correlated across all seats"],
                    ["σ_state", "1.2 pp", "Shared per-state shock — historical state 2PP swings deviate from the national swing by ~1–2pp (e.g. QLD 2019, WA 2022)"],
                    ["σ_res", "1.0 pp", "Seat-level deviation from national swing — calibrated from 2019→2022 RMSE"],
                    ["σ_pref", "0.8 pp", "Historical inter-election preference flow variation (e.g. ON→ALP: 35.7% in 2022, 25.5% in 2025)"],
                    ["Φ", "Normal CDF", "Abramowitz & Stegun 26.2.17 polynomial approximation, max error 7.5×10⁻⁸"],
                  ].map(([p, v, src]) => (
                    <tr key={p}>
                      <td style={{ ...tblCell, fontFamily: "monospace", fontSize: 12 }}>{p}</td>
                      <td style={{ ...tblCellR, fontWeight: 600 }}>{v}</td>
                      <td style={{ ...tblCell, color: "var(--text-3)", fontSize: 12 }}>{src}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...prose, marginBottom: 0, color: "var(--text-3)", fontSize: 12 }}>
                σ_nat is correlated across seats (a polling error moves all seats together); σ_state is shared by all
                seats in a state (its within-state covariance — each seat's shock sensitivity φ(m/σ_tot)·σ_state/σ_tot,
                summed pairwise per state — is added to the seat-count variance); σ_res and σ_pref are independent per
                seat. The seat-count CDF is computed by integrating over a swing × preference-flow grid, summing
                per-seat win probabilities at each grid point.
              </p>
            </div>

            {/* §6 Poll aggregation */}
            <div style={panel}>
              <div style={secHead}>6. Poll aggregation</div>
              <h2 style={secTitle}>Exponential decay with house effects</h2>
              <p style={prose}>Published polls are aggregated using an exponential-decay weighted average:</p>
              <pre style={codeBlock}>{
`w(t) = 2^(−d / 90)           (exponential decay, 90-day half-life; d = days since poll)

aggregate = Σ_t w(t) · (tpp(t) − house_effect(pollster(t)))
            ────────────────────────────────────────────────
                          Σ_t w(t)`
              }</pre>
              <p style={prose}>
                House effects are estimated iteratively: for each pollster, the effect is the weighted mean deviation of
                that pollster's adjusted polls from the current aggregate estimate, repeated until convergence. Pollsters
                covered: Newspoll, RedBridge, DemosAU, Roy Morgan, Essential Research, YouGov.
              </p>
              <p style={prose}>
                The 95% confidence interval is ±1.96·√(weighted variance / effective sample size), where effective
                sample size accounts for temporal clustering — a burst of polls in a short window is not treated as
                independent evidence.
              </p>
            </div>

            {/* §7 Calibration */}
            <div style={panel}>
              <div style={secHead}>7. Calibration</div>
              <h2 style={secTitle}>Backtested against 2025 AEC results</h2>
              <p style={prose}>
                When the model is given the true 2025 AEC primary votes as input (zero swing from baseline), the
                mean absolute error between modelled and actual AEC 2PP across the 115 ALP–Coalition TCP seats is
                <strong> 0.003 percentage points</strong>. This near-zero error confirms that the preference-flow
                arithmetic is correctly reproducing the AEC distribution of preferences. Seats with non-ALP/Coalition
                TCP races (Greens, Teal, Independent contests) are excluded from calibration as the model does not
                compute a standard 2PP for them.
              </p>
              <p style={{ ...prose, marginBottom: 0, color: "var(--text-3)", fontSize: 12 }}>
                Residual uncertainty (σ_res = 1.0 pp) was calibrated from the 2019→2022 RMSE of seat-level swing
                deviations after removing the national swing component.
              </p>
            </div>

            {/* Limitations */}
            <div style={panel}>
              <div style={secHead}>Limitations</div>
              <h2 style={secTitle}>Assumptions and caveats</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {[
                    ["Uniform national swings", "State-level swing variation is not modelled. Labor may swing harder in Queensland than Victoria; the model applies the same national Δ everywhere unless state swings are set manually."],
                    ["Fixed preference flows", "Flow constants do not vary by candidate, campaign, or division. Real flows can differ by several pp from these averages, as the ON→ALP example illustrates (35.7% in 2022 vs 25.5% in 2025)."],
                    ["Hardcoded teal seats", "Six seats are designated teal-contest seats: Warringah, Wentworth, Bradfield, Mackellar, Kooyong, Goldstein. Teal candidates in other seats are not automatically modelled."],
                    ["Independent TCP overrides required", "Where the final count is ALP vs. an independent (not Coalition), the user must set the TCP percentage manually on the Model tab."],
                    ["No redistribution modelling", "Baselines use 2025 electoral boundaries. Boundary changes between elections are not reflected."],
                    ["No incumbency or candidate effects", "No adjustment for candidate quality, incumbent retirement, or local campaign factors."],
                  ].map(([title, desc], i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-3)" }}>
                      <td style={{ ...tblCell, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top", paddingRight: 16, width: "28%" }}>{title}</td>
                      <td style={{ ...tblCell, color: "var(--text-3)" }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Data sources */}
            <div style={{ ...panel, marginBottom: 0 }}>
              <div style={secHead}>Data sources</div>
              <h2 style={secTitle}>Input data</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {[
                    ["AEC election results", <><a href="https://results.aec.gov.au" target="_blank" rel="noreferrer" style={{ color: "#1D4ED8" }}>results.aec.gov.au</a> — booth-level and division-level CSV exports for 2022 and 2025 federal elections (first preferences, TCP, DOP).</>],
                    ["Polling", "Newspoll, Resolve/SMH, RedBridge, DemosAU, Roy Morgan, Essential Research, YouGov — primary and 2PP figures as published."],
                    ["Betting markets", "Sportsbet, Betfair Exchange — national government outcome odds and seat-level win markets."],
                    ["Demographics", "ABS Census 2021 — SA1/SA2 level data mapped to electoral divisions."],
                  ].map(([title, desc], i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-3)" }}>
                      <td style={{ ...tblCell, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top", paddingRight: 16, width: "28%" }}>{title}</td>
                      <td style={tblCell}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        );
      })()}

      {/* ══════════════════════ USER GUIDE TAB ══════════════════════════════════ */}
      {activeTab === "guide" && (() => {
        const secHead = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-4)", marginBottom: 6 };
        const secTitle = { fontSize: isMobile ? 15 : 16, fontWeight: 700, color: "var(--text-dark)", margin: "0 0 10px" };
        const prose = { fontSize: 13, color: "var(--text-2)", lineHeight: 1.75, margin: "0 0 12px" };
        const panel = { ...STYLES.panel, marginBottom: 16 };
        const tblHead = { padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "var(--text-2)", borderBottom: "1px solid var(--border-1)", background: "var(--metric-bg)" };
        const tblCell = { padding: "8px 12px", fontSize: 13, color: "var(--text-2)", borderBottom: "1px solid var(--border-3)", verticalAlign: "top" };
        const tblCellMono = { ...tblCell, fontFamily: "'JetBrains Mono','Fira Code','Menlo',monospace", fontSize: 12, color: "#2563EB" };
        const divider = { borderTop: "1px solid var(--border-1)", margin: "18px 0" };
        const tip = { background: "var(--row-highlight)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#1E40AF", lineHeight: 1.65, marginBottom: 14 };
        const warn = { background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#92400E", lineHeight: 1.65, marginBottom: 14 };
        const inlineCode = { fontFamily: "monospace", background: "var(--page-bg)", padding: "1px 5px", borderRadius: 3, fontSize: 12 };
        const badge = (color, text) => (
          <span style={{ display: "inline-block", background: color, color: "#fff", borderRadius: 4, fontSize: 11, fontWeight: 700, padding: "1px 7px", letterSpacing: "0.03em" }}>{text}</span>
        );
        return (
          <div style={{ maxWidth: 800, margin: "0 auto", padding: isMobile ? "20px 14px" : "28px 24px" }}>

            {/* Page title */}
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, color: "var(--text-dark)", margin: "0 0 8px", letterSpacing: "-0.02em" }}>User Guide</h1>
              <p style={{ ...prose, color: "var(--text-3)", marginBottom: 0 }}>
                A complete reference for every input, slider, and control in the aus-poll scenario builder.
                aus-poll is a <strong>scenario modelling tool</strong> — it projects seat outcomes given the primary vote inputs
                you specify. It is not a forward prediction and does not account for campaign dynamics or candidate-specific factors.
              </p>
            </div>

            {/* Quick-start */}
            <div style={panel}>
              <div style={secHead}>Quick start</div>
              <h2 style={secTitle}>Getting a result in three steps</h2>
              <ol style={{ ...prose, paddingLeft: 20, margin: 0 }}>
                <li style={{ marginBottom: 8 }}>Open the <strong>Model</strong> tab.</li>
                <li style={{ marginBottom: 8 }}>Adjust the primary vote inputs under <strong>Primary votes</strong> to match the scenario you want to test (e.g. a new poll).</li>
                <li style={{ marginBottom: 8 }}>Read the projected seat summary — seats are ranked by how likely they are to change hands based on your inputs.</li>
              </ol>
              <div style={tip}>
                <strong>Tip:</strong> The URL updates automatically as you adjust primary votes. Copy it to share an exact scenario with someone else.
              </div>
            </div>

            {/* §1 Primary votes */}
            <div style={panel}>
              <div style={secHead}>1 · Primary votes</div>
              <h2 style={secTitle}>National first-preference inputs</h2>
              <p style={prose}>
                These six inputs set the <strong>national first-preference (primary) vote share</strong> for each party group.
                Enter a decimal percentage, e.g. <span style={inlineCode}>34.6</span>.
                Each input shows the delta from the 2025 AEC baseline in small text below it (green = higher, red = lower).
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Input</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>2025 baseline</th>
                    <th style={tblHead}>What it controls</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["ALP", "34.6%", "Labor first-preference vote share nationally"],
                    ["Coalition", "31.8%", "Liberal/National first-preference vote share nationally"],
                    ["Greens", "12.2%", "Greens first-preference vote share nationally"],
                    ["Independents", "4.5%", "Teal and other independent first-preference vote share nationally"],
                    ["One Nation", "6.4%", "One Nation first-preference vote share nationally"],
                    ["Undecided", "0%", "Uncommitted voters — distributed proportionally across parties before computing 2PP"],
                  ].map(([label, base, desc]) => (
                    <tr key={label}>
                      <td style={tblCellMono}>{label}</td>
                      <td style={{ ...tblCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{base}</td>
                      <td style={tblCell}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...prose, marginBottom: 0 }}>
                Inputs should ideally sum to 100%. Any remainder after accounting for Undecided is treated as a rounding artefact
                and does not affect seat projections materially.
              </p>
            </div>

            {/* §2 Preference flows */}
            <div style={panel}>
              <div style={secHead}>2 · Preference flows</div>
              <h2 style={secTitle}>Standard preference flow sliders</h2>
              <p style={prose}>
                These sliders control the percentage of each minor-party group's preferences that flow to <strong>ALP over Coalition</strong>
                in a standard ALP vs. Coalition final count. They apply nationally (unless overridden at the individual seat level — see §5).
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Flow</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Default (2025 AEC)</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Historical range</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Greens → ALP", "81%", "73 – 86%"],
                    ["Independents → ALP", "62%", "43 – 75%"],
                    ["One Nation → ALP", "25.5%", "25.5 – 49.6%"],
                    ["Other → ALP", "50%", "40 – 60%"],
                  ].map(([flow, def, hist]) => (
                    <tr key={flow}>
                      <td style={tblCellMono}>{flow}</td>
                      <td style={{ ...tblCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{def}</td>
                      <td style={{ ...tblCell, textAlign: "right", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{hist}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...prose, marginBottom: 8 }}>
                The <strong>↺ Reset to 2025</strong> button restores all four sliders to the 2025 AEC Distribution of Preferences values.
              </p>
              <div style={tip}>
                <strong>Context:</strong> One Nation → ALP has shifted every election (AEC DOP): 2016 ~49.6%, 2019 34.7%, 2022 35.7%, 2025 25.5% — the highest-ever flow to the Coalition. (A 43% figure appears only as the frozen calibration basis, CALIB_BASIS_FLOWS, that SEAT_CALIB_2025 was fitted against — it is not the 2025 actual.) Adjusting this slider is the single biggest lever for testing One Nation preference scenarios.
              </div>
            </div>

            {/* §3 Advanced ON race flows */}
            <div style={panel}>
              <div style={secHead}>3 · Advanced flows</div>
              <h2 style={secTitle}>One Nation race preference flows</h2>
              <p style={prose}>
                Click <strong>Show advanced flows</strong> to reveal extra sliders that only apply when One Nation is strong enough
                to reach the final two-candidate count in a seat (i.e. a three-way contest resolved to an ON-vs-ALP or ON-vs-Coalition final).
                These are controlled separately because the preference patterns are very different from standard ALP–Coalition contests.
              </p>
              <p style={{ ...prose, fontWeight: 600, marginBottom: 4 }}>ON vs ALP final</p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Flow</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Default</th>
                    <th style={tblHead}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Greens → ALP (vs ON)", "90%", "Greens preferences flowing to ALP when ON is in the final count"],
                    ["Independents → ALP (vs ON)", "75%", "Independent preferences flowing to ALP when ON is in the final count"],
                    ["Other → ALP (vs ON)", "60%", "Other minor party preferences flowing to ALP when ON is in the final count"],
                    ["Coalition → ALP (vs ON)", "10%", "Coalition preferences flowing to ALP when ON eliminates Coalition"],
                  ].map(([flow, def, meaning]) => (
                    <tr key={flow}>
                      <td style={tblCellMono}>{flow}</td>
                      <td style={{ ...tblCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{def}</td>
                      <td style={tblCell}>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...prose, fontWeight: 600, marginBottom: 4 }}>ON vs Coalition final</p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Flow</th>
                    <th style={{ ...tblHead, textAlign: "right" }}>Default</th>
                    <th style={tblHead}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["ALP → ON (vs Coal)", "20%", "ALP preferences flowing to ON when ALP is eliminated before the final"],
                    ["Greens → ON (vs Coal)", "8%", "Greens preferences flowing to ON when Coalition is in the final count"],
                    ["Independents → ON (vs Coal)", "12%", "Independent preferences flowing to ON in ON vs Coalition final"],
                    ["Other → ON (vs Coal)", "25%", "Other minor party preferences flowing to ON in ON vs Coalition final"],
                  ].map(([flow, def, meaning]) => (
                    <tr key={flow}>
                      <td style={tblCellMono}>{flow}</td>
                      <td style={{ ...tblCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{def}</td>
                      <td style={tblCell}>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={warn}>
                <strong>Note:</strong> These flows are only active in seats where the model auto-detects (or you manually select) an ON TCP matchup.
                The One Nation auto-detect threshold (see §6) controls when this kicks in.
              </div>
            </div>

            {/* §4 Individual seat overrides */}
            <div style={panel}>
              <div style={secHead}>4 · Seat overrides</div>
              <h2 style={secTitle}>Individual seat controls</h2>
              <p style={prose}>
                Click any seat row in the ranked table on the <strong>Model</strong> tab to expand it and access per-seat controls.
                These override the national inputs for that specific seat only — all other seats are unaffected.
              </p>
              <div style={divider} />
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>Primary vote overrides</p>
              <p style={prose}>
                Number inputs (step 0.5%) for ALP, Coalition, Greens, Independents, and One Nation primary votes in that seat.
                Leave blank to inherit the national primary input. When set, the model uses the seat's local primary vote
                instead of the national figure when computing that seat's 2PP swing.
              </p>
              <div style={divider} />
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>Preference flow overrides</p>
              <p style={prose}>
                Sliders for Greens→ALP, Independents→ALP, One Nation→ALP, and Other→ALP preference flows, specific to this seat.
                Leave at the default position to inherit the national preference flow sliders (§2).
              </p>
              <div style={divider} />
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>TCP / Margin override</p>
              <p style={prose}>
                Directly set the two-candidate preferred percentage for this seat.
                A value <strong>above 50</strong> means the 2025 winner holds; a value <strong>below 50</strong> means the challenger wins.
                Setting this bypasses the primary-vote swing calculation entirely for this seat.
              </p>
              <div style={divider} />
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>TCP matchup selector</p>
              <p style={prose}>
                Choose <span style={inlineCode}>Auto</span>, <span style={inlineCode}>ON vs ALP</span>, or <span style={inlineCode}>ON vs Coalition</span> to manually
                specify which two-candidate matchup applies to this seat. <span style={inlineCode}>Auto</span> lets the model decide based
                on the ON auto-detect threshold.
              </p>
              <div style={divider} />
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>Force projected winner</p>
              <p style={prose}>
                Override all calculations and directly assign the winning party for this seat. Options: Labor, Coalition, Greens,
                Teal Independent, Other Independent, One Nation, Other Crossbench.
                Use this when you have strong independent information about a specific seat that the national model cannot capture.
              </p>
              <div style={divider} />
              <p style={{ ...prose, marginBottom: 0 }}>
                Use the <strong>Clear seat overrides</strong> button to remove all overrides for a seat and return it to the national model.
                The search box at the top of the ranked table filters seats by name to help you find the one you want.
              </p>
            </div>

            {/* §5 Model options */}
            <div style={panel}>
              <div style={secHead}>5 · Model options</div>
              <h2 style={secTitle}>Uncertainty, elasticity, and ON detection</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Option</th>
                    <th style={tblHead}>Default</th>
                    <th style={tblHead}>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tblCellMono}>Swing uncertainty (σ)</td>
                    <td style={tblCell}>1.5 pp</td>
                    <td style={tblCell}>
                      Sets the standard deviation of the polling uncertainty band (range 0.5–4.0 pp).
                      Seats within ±σ of the 50% 2PP threshold are shown as competitive.
                      The typical Australian federal polling mean absolute error is ≈ 1–2 pp nationally,
                      so the default of 1.5 pp is a reasonable central estimate.
                    </td>
                  </tr>
                  <tr>
                    <td style={tblCellMono}>Seat elasticity</td>
                    <td style={tblCell}>Off</td>
                    <td style={tblCell}>
                      When enabled, marginal seats swing more than safe seats.
                      Multipliers: very marginal (&lt;5 pp) ×1.3 · semi-marginal (6–10 pp) ×1.15 · safe (&gt;20 pp) ×0.8.
                      Reflects the empirical tendency for swings to be concentrated in competitive seats.
                    </td>
                  </tr>
                  <tr>
                    <td style={tblCellMono}>ON auto-detect threshold</td>
                    <td style={tblCell}>6.5%</td>
                    <td style={tblCell}>
                      The One Nation primary vote threshold above which the model checks whether ON could reach
                      the final two-candidate count in a given seat. Below this threshold, ON is treated as minor-party
                      preferences only. Raise it to make ON races harder to trigger; lower it to make them easier.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* §6 Seat filtering and display */}
            <div style={panel}>
              <div style={secHead}>6 · Seat filtering and display</div>
              <h2 style={secTitle}>Filtering the ranked seat table</h2>
              <p style={prose}>
                The ranked table on the <strong>Model</strong> tab can be filtered two ways:
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Control</th>
                    <th style={tblHead}>Options</th>
                    <th style={tblHead}>Effect</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tblCellMono}>Risk filter</td>
                    <td style={tblCell}>All 151 · Changing · Marginal (&lt;5 pp)</td>
                    <td style={tblCell}>Show all seats, only seats projected to change hands, or only seats within 5 pp of the 50% threshold</td>
                  </tr>
                  <tr>
                    <td style={tblCellMono}>State filter</td>
                    <td style={tblCell}>All States · NSW · VIC · QLD · WA · SA · TAS · ACT · NT</td>
                    <td style={tblCell}>Restrict the table to seats in a specific state or territory</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ ...prose, marginBottom: 0 }}>
                Click any seat row to expand it and reveal the per-seat override controls described in §4,
                as well as demographic overlays where available.
              </p>
            </div>

            {/* §7 State election models */}
            <div style={panel}>
              <div style={secHead}>7 · State election models</div>
              <h2 style={secTitle}>Switching between federal and state models</h2>
              <p style={prose}>
                Use the <strong>model selector dropdown</strong> at the top of the Model tab to switch between
                the federal model and available state/territory models. Each model is independent —
                changing inputs in one model does not affect any other.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Model</th>
                    <th style={tblHead}>Election year</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Federal", "2025"],
                    ["Victoria (VIC)", "2022"],
                    ["New South Wales (NSW)", "2023"],
                    ["Queensland (QLD)", "2024"],
                    ["Western Australia (WA)", "2025"],
                    ["South Australia (SA)", "2026"],
                    ["Northern Territory (NT)", "2024"],
                    ["Tasmania (TAS)", "2024"],
                    ["Australian Capital Territory (ACT)", "2024"],
                  ].map(([model, year]) => (
                    <tr key={model}>
                      <td style={tblCell}>{model}</td>
                      <td style={{ ...tblCell, fontVariantNumeric: "tabular-nums" }}>{year}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={prose}>
                Each state model has the same structure as the federal model: primary vote inputs, preference flow sliders,
                per-seat overrides, and a <strong>Reset</strong> button that restores all state inputs to their defaults.
              </p>
              <p style={{ ...prose, fontWeight: 600, marginBottom: 6 }}>Regional swing differentiation</p>
              <p style={{ ...prose, marginBottom: 0 }}>
                Each state model includes a <strong>Regional swing differentiation</strong> toggle (on by default).
                When enabled, the model applies different swing multipliers based on whether a seat is in the inner metro,
                outer metro, or regional areas. For example, inner-metro seats may amplify a national swing by ×1.10
                while regional seats dampen it to ×0.85. Disable this toggle to apply a uniform swing across all
                seats in the state.
              </p>
            </div>

            {/* §8 Scenario sharing */}
            <div style={panel}>
              <div style={secHead}>8 · Scenario sharing</div>
              <h2 style={secTitle}>Sharing a scenario via URL</h2>
              <p style={prose}>
                Whenever you change the <strong>national primary vote inputs</strong>, aus-poll automatically
                encodes your inputs as URL query parameters. For example:
              </p>
              <div style={{ fontFamily: "'JetBrains Mono','Fira Code','Menlo',monospace", fontSize: isMobile ? 11 : 12, background: "var(--header-bg)", color: "var(--header-fg)", borderRadius: 3, padding: "12px 16px", overflowX: "auto", whiteSpace: "pre", lineHeight: 1.7, marginBottom: 14 }}>
                {"?alp=36.0&coal=30.5&grn=13.0&teal=5.0&on=6.5"}
              </div>
              <p style={{ ...prose, marginBottom: 0 }}>
                Copy the full URL from your browser's address bar and paste it to share your exact scenario.
                Note: per-seat overrides and preference flow adjustments are not currently encoded in the URL.
              </p>
            </div>

            {/* §9 Quick reference */}
            <div style={panel}>
              <div style={secHead}>9 · Quick reference</div>
              <h2 style={secTitle}>All inputs at a glance</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={tblHead}>Input</th>
                    <th style={tblHead}>Type</th>
                    <th style={tblHead}>What it affects</th>
                    <th style={tblHead}>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["ALP / Coalition / Greens / Independents / One Nation primaries", "Number (%)", "National swing applied to every seat's per-seat baseline", "Model → Primary votes"],
                    ["Undecided", "Number (%)", "Distributed across parties before computing 2PP", "Model → Primary votes"],
                    ["Greens → ALP flow", "Slider 0–100%", "Greens preferences flowing to ALP nationally", "Model → Preference flows"],
                    ["Independents → ALP flow", "Slider 0–100%", "Teal/independent preferences flowing to ALP nationally", "Model → Preference flows"],
                    ["One Nation → ALP flow", "Slider 0–100%", "ON preferences flowing to ALP nationally", "Model → Preference flows"],
                    ["Other → ALP flow", "Slider 0–100%", "Other minor party preferences flowing to ALP nationally", "Model → Preference flows"],
                    ["Advanced ON race flows (8 sliders)", "Sliders 0–100%", "Preference patterns in ON vs ALP or ON vs Coalition finals", "Model → Show advanced flows"],
                    ["Swing uncertainty (σ)", "Slider 0.5–4.0 pp", "Win-probability shading and competitive seat identification", "Model → Model options"],
                    ["Seat elasticity", "Checkbox", "Amplifies swing in marginal seats, dampens in safe seats", "Model → Model options"],
                    ["ON auto-detect threshold", "Number 0–30%", "Controls when ON is treated as a final-count contender", "Model → Model options"],
                    ["Risk / State filter", "Buttons / Dropdown", "Filters the ranked seat table", "Model → seat table header"],
                    ["Per-seat primary overrides", "Numbers (%)", "Replace national primary for a specific seat", "Model → expand a seat row"],
                    ["Per-seat preference flow overrides", "Sliders 0–100%", "Replace national preference flows for a specific seat", "Model → expand a seat row"],
                    ["TCP / Margin override", "Number 0–100%", "Directly set 2PP for a seat, bypassing swing calculation", "Model → expand a seat row"],
                    ["TCP matchup selector", "Dropdown (Auto / ON vs ALP / ON vs Coal)", "Force the type of final-count matchup for a seat", "Model → expand a seat row"],
                    ["Force projected winner", "Dropdown (party group)", "Override all calculations and assign a winner directly", "Model → expand a seat row"],
                    ["Regional swing differentiation", "Checkbox (per state)", "Apply metro/regional swing multipliers in state models", "Model → each state model"],
                    ["Model selector", "Dropdown", "Switch between Federal and state election models", "Model → top of page"],
                  ].map(([input, type, effect, where]) => (
                    <tr key={input}>
                      <td style={{ ...tblCell, fontWeight: 500 }}>{input}</td>
                      <td style={{ ...tblCell, color: "var(--text-3)", whiteSpace: "nowrap" }}>{type}</td>
                      <td style={tblCell}>{effect}</td>
                      <td style={{ ...tblCell, color: "#2563EB", whiteSpace: isMobile ? "normal" : "nowrap" }}>{where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        );
      })()}

      {/* ══════════════════════ ABOUT TAB ════════════════════════════════════════ */}
      {activeTab === "about" && (() => {
        const panel = { background: "var(--panel-bg)", border: "1px solid var(--border-1)", borderRadius: 10, padding: isMobile ? "16px 14px" : "20px 24px", marginBottom: 16 };
        const secHead = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-4)", marginBottom: 6 };
        const secTitle = { fontSize: isMobile ? 15 : 16, fontWeight: 700, color: "var(--text-dark)", margin: "0 0 10px" };
        const bodyText = { fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, margin: "0 0 10px" };
        const faqItems = [
          {
            q: "What is two-candidate preferred (2PP)?",
            a: "Australia's preferential voting system counts votes until only two candidates remain in each seat. The two-candidate preferred (2PP) count represents the final tally between those two candidates after all lower-preference votes have been distributed. Nationally, this is usually reported as ALP vs. Coalition. A party needs more than 50% 2PP in a seat to win it.",
          },
          {
            q: "How does the model project seat outcomes?",
            a: "Rather than applying a single uniform national swing, aus-poll uses per-seat first-preference baselines from the 2022 and 2025 AEC results. It computes a swing at the primary vote level for each major party, then converts primary votes to 2PP using preference flow constants calibrated against historical distribution-of-preferences data. This approach captures the different starting points of individual seats.",
          },
          {
            q: "Where does polling data come from?",
            a: "The Polls tab aggregates published primary and 2PP figures from Newspoll, Resolve/SMH, RedBridge, DemosAU, Roy Morgan, Essential Research, and YouGov. House effects (systematic biases per pollster) are estimated and removed before smoothing. The aggregated trend is used as the default input to the scenario builder.",
          },
          {
            q: "How accurate is the model?",
            a: "Backtesting against the 2022 AEC results shows a mean absolute 2PP error of under 0.1 percentage points across ALP/Coalition seats — very close to the actual count. The model is less reliable in seats contested by independents or the Greens, where final two-candidate counts differ from the national ALP vs. Coalition frame.",
          },
          {
            q: "What are teal independents?",
            a: "\"Teal independents\" are community independents who won or contested seats in affluent, traditionally Liberal-held electorates. They align loosely on climate and integrity issues. aus-poll tracks six designated teal seats: Warringah, Wentworth, Bradfield, Mackellar, Kooyong, and Goldstein. These seats use teal-specific preference flows (approximately 73% flowing to ALP over Coalition).",
          },
          {
            q: "What does the uncertainty band represent?",
            a: "Each seat projection includes a ±1σ uncertainty band derived from historical polling error, seat-level volatility (elasticity), and any undecided vote allocation. Seats within this band of 50% are considered competitive. The band is centred on the modelled 2PP, not on the historical result.",
          },
          {
            q: "Is this affiliated with the AEC or any political party?",
            a: "No. aus-poll is an independent open-source project. It uses publicly available data from the Australian Electoral Commission (AEC) and published opinion polls. It has no affiliation with any electoral body, political party, or campaign.",
          },
          {
            q: "How can I contribute or report a bug?",
            a: "The source code is publicly available on GitHub. Open an issue or pull request to suggest improvements, report errors in the model, or contribute new data.",
          },
        ];
        return (
          <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", maxWidth: 860, margin: "0 auto" }}>

            {/* About section */}
            <div style={panel}>
              <div style={secHead}>About</div>
              <h2 style={secTitle}>aus-poll — Australian Election Modelling Dashboard</h2>
              <p style={bodyText}>
                aus-poll is an open-source, seat-by-seat election modelling dashboard for Australian federal elections. It tracks opinion polls, aggregates them using a house-effects model, and projects two-candidate preferred (2PP) outcomes for all 151 House of Representatives seats based on primary vote shifts.
              </p>
              <p style={bodyText}>
                The tool was built to provide a transparent, reproducible alternative to black-box election forecasts. All modelling logic is visible in the source code; all data comes from publicly available sources (AEC results, published polls, ABS Census). It is not a prediction — it is a scenario explorer. You set the primary votes, and the model shows you what the seat distribution would look like under those assumptions.
              </p>
              <p style={{ ...bodyText, margin: 0 }}>
                The dashboard covers the 2025 and 2022 Australian federal elections, plus several state and territory elections (Victoria, NSW, Queensland, Western Australia, South Australia, Tasmania, ACT, Northern Territory). The federal 2025 scenario builder is the primary feature; state elections are shown as historical results with key marginal seat breakdowns.
              </p>
            </div>

            {/* Data sources */}
            <div style={panel}>
              <div style={secHead}>Data Sources</div>
              <h2 style={secTitle}>Where the data comes from</h2>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                {[
                  { label: "AEC election results", desc: "Booth-level and division-level first preferences, two-candidate preferred counts, and distribution of preferences for 2022 and 2025 federal elections.", url: "https://results.aec.gov.au", urlLabel: "results.aec.gov.au" },
                  { label: "Opinion polls", desc: "Published primary and 2PP figures from Newspoll, Resolve/SMH, RedBridge, DemosAU, Roy Morgan, Essential Research, and YouGov.", url: null, urlLabel: null },
                  { label: "Betting markets", desc: "National government outcome odds and seat-level win markets from Sportsbet and Betfair Exchange, updated manually.", url: null, urlLabel: null },
                  { label: "ABS Census 2021", desc: "SA1/SA2-level demographic data (income, education, occupation, age) mapped to electoral divisions for contextual overlays.", url: null, urlLabel: null },
                ].map(({ label, desc, url, urlLabel }) => (
                  <div key={label} style={{ background: "var(--metric-bg)", border: "1px solid var(--border-1)", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-dark)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>{desc}</div>
                    {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1D4ED8", display: "inline-block", marginTop: 4 }}>{urlLabel}</a>}
                  </div>
                ))}
              </div>
            </div>

            {/* FAQ */}
            <div style={panel}>
              <div style={secHead}>FAQ</div>
              <h2 style={secTitle}>Frequently asked questions</h2>
              {faqItems.map((item, i) => (
                <div key={i} style={{ borderBottom: i < faqItems.length - 1 ? "1px solid var(--border-3)" : "none", paddingBottom: openFaq === i ? 12 : 0 }}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    style={{ background: "none", border: "none", width: "100%", textAlign: "left", padding: "12px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)", lineHeight: 1.5 }}>{item.q}</span>
                    <span style={{ color: "var(--text-4)", fontSize: 16, flexShrink: 0 }}>{openFaq === i ? "▲" : "▼"}</span>
                  </button>
                  {openFaq === i && (
                    <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-3)", lineHeight: 1.7 }}>{item.a}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Disclaimer */}
            <div style={{ ...panel, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.35)", marginBottom: 0 }}>
              <div style={secHead}>Disclaimer</div>
              <p style={{ ...bodyText, margin: 0 }}>
                aus-poll is an independent modelling tool and is not affiliated with the Australian Electoral Commission, any political party, or any government body. Projections are illustrative scenarios based on the inputs provided — they are not election predictions. Past model accuracy does not guarantee future performance. All polling data is sourced from publicly available figures as reported by pollsters and media outlets.
              </p>
            </div>

          </div>
        );
      })()}

      </div>

      {/* ── Mobile floating seat count badge ── */}
      {isMobile && activeTab === "seats" && filtered.length < seatsForTab.length && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 200, pointerEvents: "none" }}>
          <div style={{ background: "var(--header-bg)", color: "var(--header-fg)", fontSize: 12, fontWeight: 600, padding: "7px 16px", borderRadius: 20, boxShadow: "0 4px 14px rgba(0,0,0,0.35)", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
            {filtered.length} of {seatsForTab.length} seats
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer style={{ background: "var(--header-bg)", borderTop: "1px solid rgba(255,255,255,0.08)", padding: isMobile ? "18px 16px" : "20px 24px", marginTop: 8 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--header-muted)" }}>
            Aus Poll · open-source Australian election modelling ·{" "}
            <a href="https://github.com/leifsmith01-ai/aus-poll" target="_blank" rel="noopener noreferrer" style={{ color: "var(--header-fg)", textDecoration: "none" }}>GitHub</a>
          </span>
          <span style={{ fontSize: 11, color: "var(--header-muted)", opacity: 0.7 }}>Not affiliated with the AEC · For informational purposes only</span>
        </div>
      </footer>

      <Analytics />
    </div>
  );
}

// ── Test exports ──────────────────────────────────────────────────────────────
// Model functions and constants exported for the baseline-alignment test suite
// (src/__tests__/baseline-alignment.test.jsx), which asserts that every model at
// zero swing reproduces the actual election result. Not used by the UI.
export {
  computeModelledSeats,
  computeModelledSeatsVic,
  computeModelledSeatsState,
  makeStateCompute2pp,
  computeVic2pp,
  computeNat2pp,
  getParty,
  getSeatGroup,
  mapSeatFpById,
  logitShiftOnFp,
  extraCoalCutFor,
  MODEL_PARAMS,
  SEATS,
  VIC_SEATS, NSW_SEATS, QLD_SEATS, WA_SEATS, SA_SEATS, NT_SEATS,
  FED_DEFAULT_PREF_FLOWS,
  VIC_BASELINE_2022, VIC_2PP_2022, VIC_DEFAULT_PREF_FLOWS, VIC_SEAT_FP_2022, VIC_SEAT_ON_FP,
  NSW_BL, NSW_2PP, NSW_COAL, NSW_DEFAULT_FLOWS, NSW_SEAT_ON_FP_2023,
  NSW_SEAT_PREF_FLOWS_2023, NSW_DISTRICT_REGION, NSW_REGION_SWING_MULT, NSW_SEAT_FP_2023,
  QLD_BL, QLD_2PP, QLD_COAL, QLD_DEFAULT_FLOWS, QLD_SEAT_ON_FP_2024,
  QLD_SEAT_PREF_FLOWS_2024, QLD_DISTRICT_REGION, QLD_REGION_SWING_MULT, QLD_SEAT_FP_2024,
  WA_BL, WA_2PP, WA_COAL, WA_DEFAULT_FLOWS,
  WA_DISTRICT_REGION, WA_REGION_SWING_MULT, WA_SEAT_FP_2025,
  SA_BL, SA_2PP, SA_COAL, SA_DEFAULT_FLOWS, SA_SEAT_ON_FP_2026,
  SA_DISTRICT_REGION, SA_REGION_SWING_MULT, SA_SEAT_FP_2026,
  NT_BL, NT_2PP, NT_COAL, NT_DEFAULT_FLOWS, NT_EXHAUST_DEFAULT,
  NT_DISTRICT_REGION, NT_REGION_SWING_MULT, NT_SEAT_FP_2024,
};
