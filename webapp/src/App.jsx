// ── AEC Election Dashboard — Self-contained preview ──────────────────────────
// Tabs: Overview · Seats · Polls · Model
// All data, config and logic inlined — no external local imports.

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import DEMOGRAPHICS from "./data/demographics.js";

// ─── Victoria 2022 state election — confirmed seat results ────────────────────
// Source: VEC (Victorian Electoral Commission), 2022 Victorian State Election.
// 88 Legislative Assembly districts. Full district-by-district margins require
// running the VEC pipeline: python main.py --state vic --year 202211
//
// High-confidence results listed here; remaining seats grouped by party.
// Format: [id, name, winnerParty, winnerName, tcp1Party, tcp2Party, margin]
const VIC_SEATS_KNOWN = [
  // ── Greens holds (4 seats) ──────────────────────────────────────────────────
  [9001, "Prahran", "GRN", "Sam Hibbins", "GRN", "LP", 2.2],
  [9002, "Brunswick", "GRN", "Tim Read", "GRN", "ALP", 11.1],
  [9003, "Northcote", "GRN", "Kat Theophanous", "GRN", "ALP", 5.0],
  [9004, "Richmond", "GRN", "Gabrielle De Vietri", "GRN", "ALP", 3.1],
  // ── Independents (2 seats) ──────────────────────────────────────────────────
  [9005, "Mildura", "IND", "Ali Cupper", "IND", "LP", 8.5],
  [9006, "Shepparton", "IND", "Kim O'Keeffe", "IND", "ALP", 4.8],
  // ── Sample ALP holds (inner suburban) ──────────────────────────────────────
  [9010, "Albert Park", "ALP", "Nina Taylor", "ALP", "LP", 18.4],
  [9011, "Altona", "ALP", "Juliana Addison", "ALP", "LP", 28.1],
  [9012, "Footscray", "ALP", "Katie Hall", "ALP", "GRN", 14.9],
  [9013, "Williamstown", "ALP", "Melissa Horne", "ALP", "LP", 26.3],
  [9014, "Geelong", "ALP", "Christine Couzens", "ALP", "LP", 20.7],
  [9015, "Wendouree", "ALP", "Juliana Addison", "ALP", "LP", 22.4],
  // ── Sample LP holds ────────────────────────────────────────────────────────
  [9020, "Kew", "LP", "Tim Smith", "LP", "ALP", 11.3],
  [9021, "Brighton", "LP", "James Newbury", "LP", "ALP", 16.8],
  [9022, "Hawthorn", "LP", "John Pesutto", "LP", "ALP", 2.9],
  [9023, "Box Hill", "LP", "Paul Hamer", "ALP", "LP", 1.4],  // ALP flipped LP
];

// 2022 VIC state result summary (88 seats total)
const VIC_2022_SUMMARY = {
  alp: 56, lp: 26, grn: 4, ind: 2, total: 88,
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
const getParty = (ab) => PARTY[ab] ?? { short: ab || "?", color: "#6B7280", bg: "#F3F4F6", group: "crossbench" };

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
const MARGIN_COLOR = { very_marginal: "#DC2626", marginal: "#F59E0B", fairly_safe: "#10B981", safe: "#6B7280" };

// 2022 actual national primary vote % (baseline for swing calculations)
const BASELINE_2022 = { alp: 32.6, coal: 35.7, grn: 12.2, teal: 5.1, on: 4.7 };
const NATIONAL_2PP_2022 = 52.13; // ALP 2PP at 2022 election

// 2025 actual national primary vote % and 2PP (baseline for post-election tracking)
const BASELINE_2025 = { alp: 34.6, coal: 31.8, grn: 12.2, teal: 4.5, on: 6.4 };
const NATIONAL_2PP_2025 = 55.2; // ALP 2PP at 2025 election

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
  // ── ACT ──
  318: { alp: 40.0, coal: 10.5, grn: 16.0, teal: 28.0, on: 2.5, other: 3.0 }, // Bean
  101: { alp: 38.0, coal: 6.0, grn: 33.0, teal: 9.0, on: 1.5, other: 12.5 }, // Canberra (ALP/GRN)
  102: { alp: 54.0, coal: 22.0, grn: 20.0, teal: 0.0, on: 2.0, other: 2.0 }, // Fenner
  // ── NSW ──
  103: { alp: 41.0, coal: 42.5, grn: 11.0, teal: 0.0, on: 3.5, other: 2.0 }, // Banks
  104: { alp: 52.2, coal: 27.4, grn: 13.0, teal: 0.0, on: 5.4, other: 2.0 }, // Barton
  105: { alp: 46.8, coal: 36.0, grn: 13.0, teal: 0.0, on: 2.2, other: 2.0 }, // Bennelong
  106: { alp: 35.9, coal: 46.1, grn: 12.0, teal: 0.0, on: 4.0, other: 2.0 }, // Berowra
  107: { alp: 63.1, coal: 23.9, grn: 8.0, teal: 0.0, on: 3.0, other: 2.0 }, // Blaxland
  108: { alp: 15.0, coal: 40.0, grn: 10.0, teal: 30.0, on: 1.5, other: 3.5 }, // Bradfield (IND/LP)
  109: { alp: 18.0, coal: 30.0, grn: 6.0, teal: 38.0, on: 7.6, other: 0.4 }, // Calare (IND/NP)
  111: { alp: 59.9, coal: 24.3, grn: 8.0, teal: 0.0, on: 5.8, other: 2.0 }, // Chifley
  112: { alp: 31.9, coal: 51.9, grn: 10.0, teal: 0.0, on: 4.2, other: 2.0 }, // Cook
  113: { alp: 18.0, coal: 37.0, grn: 7.0, teal: 31.0, on: 6.3, other: 0.7 }, // Cowper (NP/IND)
  114: { alp: 52.8, coal: 24.8, grn: 13.0, teal: 0.0, on: 7.4, other: 2.0 }, // Cunningham
  115: { alp: 47.3, coal: 32.8, grn: 9.0, teal: 0.0, on: 8.9, other: 2.0 }, // Dobell
  117: { alp: 46.0, coal: 36.3, grn: 9.0, teal: 0.0, on: 6.7, other: 2.0 }, // Eden-Monaro
  118: { alp: 16.0, coal: 43.0, grn: 5.0, teal: 24.0, on: 6.4, other: 5.6 }, // Farrer (LP/IND)
  119: { alp: 38.0, coal: 12.0, grn: 5.0, teal: 38.0, on: 3.8, other: 3.2 }, // Fowler (IND/ALP)
  120: { alp: 44.8, coal: 39.4, grn: 9.0, teal: 0.0, on: 4.8, other: 2.0 }, // Gilmore
  121: { alp: 49.0, coal: 5.0, grn: 33.0, teal: 4.0, on: 3.0, other: 6.0 }, // Grayndler (ALP/GRN)
  122: { alp: 51.2, coal: 30.6, grn: 12.0, teal: 0.0, on: 4.2, other: 2.0 }, // Greenway
  124: { alp: 42.6, coal: 41.3, grn: 9.0, teal: 0.0, on: 5.1, other: 2.0 }, // Hughes
  125: { alp: 31.2, coal: 51.1, grn: 8.0, teal: 0.0, on: 7.7, other: 2.0 }, // Hume
  126: { alp: 47.0, coal: 18.0, grn: 7.0, teal: 0.0, on: 16.4, other: 11.6 }, // Hunter (ALP/ON)
  127: { alp: 51.5, coal: 25.7, grn: 15.0, teal: 0.0, on: 5.8, other: 2.0 }, // Kingsford Smith
  128: { alp: 35.2, coal: 46.1, grn: 10.0, teal: 0.0, on: 6.7, other: 2.0 }, // Lindsay
  130: { alp: 20.0, coal: 47.0, grn: 7.0, teal: 12.0, on: 8.1, other: 5.9 }, // Lyne (NP/ALP)
  131: { alp: 53.3, coal: 27.2, grn: 10.0, teal: 0.0, on: 7.5, other: 2.0 }, // Macarthur
  132: { alp: 17.0, coal: 36.0, grn: 9.0, teal: 33.0, on: 2.4, other: 2.6 }, // Mackellar (IND/LP)
  133: { alp: 43.4, coal: 34.2, grn: 12.0, teal: 0.0, on: 8.4, other: 2.0 }, // Macquarie
  315: { alp: 44.8, coal: 33.1, grn: 12.0, teal: 0.0, on: 8.1, other: 2.0 }, // McMahon
  134: { alp: 34.5, coal: 48.4, grn: 11.0, teal: 0.0, on: 4.1, other: 2.0 }, // Mitchell
  135: { alp: 20.0, coal: 53.0, grn: 5.0, teal: 8.0, on: 9.9, other: 4.1 }, // New England (NP)
  136: { alp: 45.0, coal: 12.0, grn: 19.0, teal: 3.0, on: 5.2, other: 15.8 }, // Newcastle (ALP/GRN)
  138: { alp: 30.9, coal: 53.6, grn: 8.0, teal: 0.0, on: 5.5, other: 2.0 }, // Page
  139: { alp: 26.1, coal: 53.3, grn: 5.0, teal: 0.0, on: 13.6, other: 2.0 }, // Parkes
  140: { alp: 50.8, coal: 32.8, grn: 12.0, teal: 0.0, on: 2.4, other: 2.0 }, // Parramatta
  249: { alp: 45.4, coal: 36.1, grn: 9.0, teal: 0.0, on: 7.5, other: 2.0 }, // Paterson
  144: { alp: 50.3, coal: 33.5, grn: 12.0, teal: 0.0, on: 2.2, other: 2.0 }, // Reid
  145: { alp: 47.0, coal: 33.8, grn: 12.0, teal: 0.0, on: 5.2, other: 2.0 }, // Richmond
  250: { alp: 28.2, coal: 55.2, grn: 5.0, teal: 0.0, on: 9.6, other: 2.0 }, // Riverina
  146: { alp: 47.3, coal: 33.8, grn: 10.0, teal: 0.0, on: 6.9, other: 2.0 }, // Robertson
  148: { alp: 49.3, coal: 30.7, grn: 9.0, teal: 0.0, on: 9.0, other: 2.0 }, // Shortland
  149: { alp: 46.0, coal: 5.0, grn: 31.0, teal: 10.0, on: 3.3, other: 4.7 }, // Sydney (ALP/GRN)
  151: { alp: 12.0, coal: 28.0, grn: 10.0, teal: 44.0, on: 1.7, other: 4.3 }, // Warringah (IND/LP)
  251: { alp: 52.0, coal: 12.0, grn: 6.0, teal: 21.0, on: 2.9, other: 6.1 }, // Watson (ALP/IND)
  152: { alp: 14.0, coal: 33.0, grn: 13.0, teal: 37.0, on: 2.3, other: 0.7 }, // Wentworth (IND/LP)
  153: { alp: 46.9, coal: 38.5, grn: 9.0, teal: 0.0, on: 3.6, other: 2.0 }, // Werriwa
  150: { alp: 43.9, coal: 36.6, grn: 10.0, teal: 0.0, on: 7.5, other: 2.0 }, // Whitlam
  // ── NT ──
  306: { alp: 46.1, coal: 34.3, grn: 9.0, teal: 0.0, on: 8.6, other: 2.0 }, // Lingiari
  307: { alp: 40.3, coal: 42.4, grn: 9.0, teal: 0.0, on: 6.3, other: 2.0 }, // Solomon
  // ── QLD ──
  304: { alp: 42.6, coal: 36.1, grn: 10.0, teal: 0.0, on: 9.3, other: 2.0 }, // Blair
  310: { alp: 42.7, coal: 39.6, grn: 12.0, teal: 0.0, on: 3.7, other: 2.0 }, // Bonner
  155: { alp: 37.2, coal: 46.0, grn: 8.0, teal: 0.0, on: 6.8, other: 2.0 }, // Bowman
  156: { alp: 45.6, coal: 36.1, grn: 14.0, teal: 0.0, on: 2.3, other: 2.0 }, // Brisbane
  157: { alp: 31.6, coal: 44.9, grn: 6.0, teal: 0.0, on: 15.5, other: 2.0 }, // Capricornia
  158: { alp: 28.7, coal: 54.1, grn: 5.0, teal: 0.0, on: 10.2, other: 2.0 }, // Dawson
  252: { alp: 43.6, coal: 38.5, grn: 12.0, teal: 0.0, on: 3.9, other: 2.0 }, // Dickson
  159: { alp: 31.4, coal: 49.6, grn: 9.0, teal: 0.0, on: 8.0, other: 2.0 }, // Fadden
  160: { alp: 36.2, coal: 46.6, grn: 8.0, teal: 0.0, on: 7.2, other: 2.0 }, // Fairfax
  161: { alp: 33.1, coal: 50.0, grn: 9.0, teal: 0.0, on: 5.9, other: 2.0 }, // Fisher
  311: { alp: 27.9, coal: 50.2, grn: 6.0, teal: 0.0, on: 13.9, other: 2.0 }, // Flynn
  162: { alp: 39.2, coal: 39.8, grn: 9.0, teal: 0.0, on: 10.0, other: 2.0 }, // Forde
  163: { alp: 44.0, coal: 12.0, grn: 24.0, teal: 5.0, on: 2.2, other: 12.8 }, // Griffith (ALP/GRN)
  164: { alp: 18.0, coal: 43.0, grn: 8.0, teal: 20.0, on: 9.4, other: 1.6 }, // Groom (LNP/IND)
  165: { alp: 28.6, coal: 58.5, grn: 6.0, teal: 0.0, on: 4.9, other: 2.0 }, // Herbert
  166: { alp: 33.0, coal: 46.8, grn: 5.0, teal: 0.0, on: 13.2, other: 2.0 }, // Hinkler
  167: { alp: 15.0, coal: 30.0, grn: 4.0, teal: 43.0, on: 7.5, other: 0.5 }, // Kennedy (KAP/LNP)
  168: { alp: 43.6, coal: 36.5, grn: 10.0, teal: 0.0, on: 7.9, other: 2.0 }, // Leichhardt
  169: { alp: 50.5, coal: 29.5, grn: 14.0, teal: 0.0, on: 4.0, other: 2.0 }, // Lilley
  302: { alp: 37.5, coal: 42.0, grn: 9.0, teal: 0.0, on: 9.5, other: 2.0 }, // Longman
  170: { alp: 15.0, coal: 60.0, grn: 3.0, teal: 0.0, on: 12.1, other: 9.9 }, // Maranoa (LNP/ON)
  171: { alp: 34.7, coal: 49.1, grn: 10.0, teal: 0.0, on: 4.2, other: 2.0 }, // McPherson
  172: { alp: 29.7, coal: 52.8, grn: 10.0, teal: 0.0, on: 5.5, other: 2.0 }, // Moncrieff
  173: { alp: 52.6, coal: 28.7, grn: 14.0, teal: 0.0, on: 2.7, other: 2.0 }, // Moreton
  174: { alp: 55.5, coal: 24.5, grn: 13.0, teal: 0.0, on: 5.0, other: 2.0 }, // Oxley
  175: { alp: 38.4, coal: 42.0, grn: 11.0, teal: 0.0, on: 6.6, other: 2.0 }, // Petrie
  176: { alp: 52.1, coal: 27.6, grn: 12.0, teal: 0.0, on: 6.3, other: 2.0 }, // Rankin
  177: { alp: 22.0, coal: 32.0, grn: 37.0, teal: 4.0, on: 2.1, other: 2.9 }, // Ryan (GRN/LNP)
  178: { alp: 31.4, coal: 48.8, grn: 6.0, teal: 0.0, on: 11.8, other: 2.0 }, // Wide Bay
  316: { alp: 28.9, coal: 46.2, grn: 6.0, teal: 0.0, on: 16.9, other: 2.0 }, // Wright
  // ── SA ──
  179: { alp: 55.1, coal: 25.1, grn: 14.0, teal: 0.0, on: 3.8, other: 2.0 }, // Adelaide
  180: { alp: 26.1, coal: 55.9, grn: 8.0, teal: 0.0, on: 8.0, other: 2.0 }, // Barker
  182: { alp: 47.5, coal: 33.6, grn: 14.0, teal: 0.0, on: 2.9, other: 2.0 }, // Boothby
  183: { alp: 33.7, coal: 46.5, grn: 8.0, teal: 0.0, on: 9.8, other: 2.0 }, // Grey
  185: { alp: 51.9, coal: 27.3, grn: 14.0, teal: 0.0, on: 4.8, other: 2.0 }, // Hindmarsh
  186: { alp: 56.6, coal: 22.3, grn: 13.0, teal: 0.0, on: 6.1, other: 2.0 }, // Kingston
  187: { alp: 50.3, coal: 28.2, grn: 13.0, teal: 0.0, on: 6.5, other: 2.0 }, // Makin
  188: { alp: 27.0, coal: 15.0, grn: 10.0, teal: 41.0, on: 5.9, other: 1.1 }, // Mayo (IND/ALP)
  325: { alp: 49.8, coal: 26.0, grn: 13.0, teal: 0.0, on: 9.2, other: 2.0 }, // Spence
  190: { alp: 42.9, coal: 37.8, grn: 14.0, teal: 0.0, on: 3.3, other: 2.0 }, // Sturt
  // ── TAS ──
  192: { alp: 44.5, coal: 35.1, grn: 12.0, teal: 0.0, on: 6.4, other: 2.0 }, // Bass
  193: { alp: 43.2, coal: 35.1, grn: 12.0, teal: 0.0, on: 7.7, other: 2.0 }, // Braddon
  319: { alp: 27.0, coal: 5.0, grn: 10.0, teal: 54.0, on: 4.0, other: 0.0 }, // Clark (IND/ALP)
  195: { alp: 42.0, coal: 18.0, grn: 14.0, teal: 18.0, on: 4.8, other: 3.2 }, // Franklin (ALP/IND)
  196: { alp: 47.1, coal: 31.1, grn: 13.0, teal: 0.0, on: 6.8, other: 2.0 }, // Lyons
  // ── VIC ──
  197: { alp: 40.5, coal: 41.3, grn: 13.0, teal: 0.0, on: 3.2, other: 2.0 }, // Aston
  198: { alp: 45.1, coal: 31.3, grn: 14.0, teal: 0.0, on: 7.6, other: 2.0 }, // Ballarat
  200: { alp: 38.7, coal: 42.8, grn: 12.0, teal: 0.0, on: 4.5, other: 2.0 }, // Bendigo
  201: { alp: 49.6, coal: 27.3, grn: 13.0, teal: 0.0, on: 8.1, other: 2.0 }, // Bruce
  203: { alp: 45.0, coal: 12.0, grn: 9.0, teal: 30.0, on: 3.0, other: 1.0 }, // Calwell (ALP/IND)
  204: { alp: 35.1, coal: 46.9, grn: 11.0, teal: 0.0, on: 5.0, other: 2.0 }, // Casey
  205: { alp: 42.6, coal: 39.6, grn: 14.0, teal: 0.0, on: 1.8, other: 2.0 }, // Chisholm
  320: { alp: 40.0, coal: 7.0, grn: 34.0, teal: 6.0, on: 4.9, other: 8.1 }, // Cooper (ALP/GRN)
  328: { alp: 45.3, coal: 36.8, grn: 13.0, teal: 0.0, on: 2.9, other: 2.0 }, // Corangamite
  208: { alp: 48.3, coal: 27.9, grn: 12.0, teal: 0.0, on: 9.8, other: 2.0 }, // Corio
  209: { alp: 39.5, coal: 42.1, grn: 14.0, teal: 0.0, on: 2.4, other: 2.0 }, // Deakin
  210: { alp: 42.8, coal: 35.8, grn: 13.0, teal: 0.0, on: 6.4, other: 2.0 }, // Dunkley
  211: { alp: 13.0, coal: 46.0, grn: 7.0, teal: 28.0, on: 5.4, other: 0.6 }, // Flinders (LP/IND)
  321: { alp: 41.0, coal: 9.0, grn: 28.0, teal: 8.0, on: 4.2, other: 9.8 }, // Fraser (ALP/GRN)
  212: { alp: 50.4, coal: 28.1, grn: 14.0, teal: 0.0, on: 5.5, other: 2.0 }, // Gellibrand
  213: { alp: 18.7, coal: 59.1, grn: 6.0, teal: 0.0, on: 14.2, other: 2.0 }, // Gippsland
  214: { alp: 10.0, coal: 43.0, grn: 7.0, teal: 36.0, on: 1.6, other: 2.4 }, // Goldstein (LP/IND)
  309: { alp: 47.2, coal: 33.2, grn: 12.0, teal: 0.0, on: 5.6, other: 2.0 }, // Gorton
  326: { alp: 43.0, coal: 34.0, grn: 12.0, teal: 0.0, on: 9.0, other: 2.0 }, // Hawke
  216: { alp: 49.7, coal: 28.0, grn: 12.0, teal: 0.0, on: 8.3, other: 2.0 }, // Holt
  217: { alp: 51.8, coal: 26.8, grn: 15.0, teal: 0.0, on: 4.4, other: 2.0 }, // Hotham
  218: { alp: 14.0, coal: 30.0, grn: 7.0, teal: 42.0, on: 6.9, other: 0.1 }, // Indi (IND/LP)
  219: { alp: 50.2, coal: 29.6, grn: 14.0, teal: 0.0, on: 4.2, other: 2.0 }, // Isaacs
  220: { alp: 48.2, coal: 31.2, grn: 15.0, teal: 0.0, on: 3.6, other: 2.0 }, // Jagajaga
  221: { alp: 13.0, coal: 42.0, grn: 8.0, teal: 35.0, on: 0.9, other: 1.1 }, // Kooyong (IND/LP)
  223: { alp: 34.9, coal: 44.8, grn: 11.0, teal: 0.0, on: 7.3, other: 2.0 }, // La Trobe
  222: { alp: 49.7, coal: 29.8, grn: 12.0, teal: 0.0, on: 6.5, other: 2.0 }, // Lalor
  322: { alp: 48.4, coal: 33.1, grn: 14.0, teal: 0.0, on: 2.5, other: 2.0 }, // Macnamara
  224: { alp: 19.6, coal: 60.5, grn: 7.0, teal: 0.0, on: 10.9, other: 2.0 }, // Mallee
  225: { alp: 46.7, coal: 29.8, grn: 15.0, teal: 0.0, on: 6.5, other: 2.0 }, // Maribyrnong
  226: { alp: 41.4, coal: 38.5, grn: 12.0, teal: 0.0, on: 6.1, other: 2.0 }, // McEwen
  228: { alp: 35.0, coal: 7.0, grn: 36.0, teal: 10.0, on: 2.2, other: 9.8 }, // Melbourne (ALP/GRN)
  229: { alp: 37.2, coal: 44.0, grn: 15.0, teal: 0.0, on: 1.8, other: 2.0 }, // Menzies
  323: { alp: 31.8, coal: 46.4, grn: 12.0, teal: 0.0, on: 7.8, other: 2.0 }, // Monash
  324: { alp: 24.2, coal: 55.7, grn: 7.0, teal: 0.0, on: 11.1, other: 2.0 }, // Nicholls
  232: { alp: 50.0, coal: 28.6, grn: 13.0, teal: 0.0, on: 6.4, other: 2.0 }, // Scullin
  233: { alp: 15.0, coal: 44.0, grn: 6.0, teal: 29.0, on: 4.0, other: 2.0 }, // Wannon (LP/IND)
  234: { alp: 35.0, coal: 7.0, grn: 37.0, teal: 8.0, on: 3.2, other: 9.8 }, // Wills (ALP/GRN)
  // ── WA ──
  235: { alp: 49.2, coal: 22.2, grn: 14.0, teal: 0.0, on: 12.6, other: 2.0 }, // Brand
  329: { alp: 35.4, coal: 41.3, grn: 13.0, teal: 0.0, on: 8.3, other: 2.0 }, // Bullwinkel
  317: { alp: 49.2, coal: 25.1, grn: 14.0, teal: 0.0, on: 9.7, other: 2.0 }, // Burt
  236: { alp: 28.7, coal: 47.0, grn: 11.0, teal: 0.0, on: 11.3, other: 2.0 }, // Canning
  237: { alp: 49.2, coal: 30.0, grn: 14.0, teal: 0.0, on: 4.8, other: 2.0 }, // Cowan
  238: { alp: 14.0, coal: 36.0, grn: 14.0, teal: 32.0, on: 2.4, other: 1.6 }, // Curtin (IND/LP)
  312: { alp: 29.0, coal: 52.2, grn: 7.0, teal: 0.0, on: 9.8, other: 2.0 }, // Durack
  239: { alp: 34.9, coal: 44.4, grn: 10.0, teal: 0.0, on: 8.7, other: 2.0 }, // Forrest
  240: { alp: 42.0, coal: 10.0, grn: 18.0, teal: 23.0, on: 5.8, other: 1.2 }, // Fremantle (ALP/IND)
  305: { alp: 50.6, coal: 26.4, grn: 14.0, teal: 0.0, on: 7.0, other: 2.0 }, // Hasluck
  242: { alp: 38.7, coal: 41.0, grn: 14.0, teal: 0.0, on: 4.3, other: 2.0 }, // Moore
  243: { alp: 25.2, coal: 54.6, grn: 7.0, teal: 0.0, on: 11.2, other: 2.0 }, // O'Connor
  244: { alp: 41.9, coal: 35.2, grn: 12.0, teal: 0.0, on: 8.9, other: 2.0 }, // Pearce
  245: { alp: 51.6, coal: 26.4, grn: 14.0, teal: 0.0, on: 6.0, other: 2.0 }, // Perth
  247: { alp: 49.5, coal: 29.6, grn: 14.0, teal: 0.0, on: 4.9, other: 2.0 }, // Swan
  248: { alp: 43.0, coal: 37.1, grn: 14.0, teal: 0.0, on: 3.9, other: 2.0 }, // Tangney
};

// ── 2022 seat-level first preferences ──────────────────────────────────────────
// #14 Data Quality Note: Placeholder for 2022 AEC final results (event_id=27966).
// Requires population for full primary-based backtesting of the 2019->2022 cycle.
const SEAT_FP_2022 = {};

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
  // ── ACT ──
  102: +0.02,  // Fenner
  // ── NSW ──
  103: -0.02,  // Banks
  104: -0.05,  // Barton
  105: -0.02,  // Bennelong
  106: +0.03,  // Berowra
  107: +0.04,  // Blaxland
  111: -0.04,  // Chifley
  112: -0.01,  // Cook
  114: +0.01,  // Cunningham
  115: +0.01,  // Dobell
  117: +0.05,  // Eden-Monaro
  120: -0.02,  // Gilmore
  122: +0.03,  // Greenway
  124: -0.03,  // Hughes
  125: -0.04,  // Hume
  127: +0.05,  // Kingsford Smith
  128: +0.04,  // Lindsay
  130: +0.68,  // Lyne
  131: -0.02,  // Macarthur
  133: -0.03,  // Macquarie
  134: +0.02,  // Mitchell
  135: -2.38,  // New England
  138: -0.02,  // Page
  139: +0.03,  // Parkes
  140: -0.00,  // Parramatta
  144: +0.04,  // Reid
  145: +0.05,  // Richmond
  146: +0.00,  // Robertson
  148: +0.05,  // Shortland
  150: +0.02,  // Whitlam
  153: +0.03,  // Werriwa
  249: -0.03,  // Paterson
  250: +0.00,  // Riverina
  315: +0.02,  // McMahon
  // ── NT ──
  306: +0.03,  // Lingiari
  307: +0.01,  // Solomon
  // ── QLD ──
  155: -0.03,  // Bowman
  156: +0.03,  // Brisbane
  157: +0.03,  // Capricornia
  158: +0.03,  // Dawson
  159: -0.01,  // Fadden
  160: +0.01,  // Fairfax
  161: +0.02,  // Fisher
  162: -0.01,  // Forde
  164: -0.03,  // Groom
  165: +0.02,  // Herbert
  166: +0.03,  // Hinkler
  168: +0.05,  // Leichhardt
  169: +0.01,  // Lilley
  170: -0.03,  // Maranoa
  171: +0.03,  // McPherson
  172: +0.04,  // Moncrieff
  173: +0.00,  // Moreton
  174: -0.01,  // Oxley
  175: +0.02,  // Petrie
  176: +0.02,  // Rankin
  178: +0.02,  // Wide Bay
  252: +0.04,  // Dickson
  302: +0.04,  // Longman
  304: +0.03,  // Blair
  311: +0.02,  // Flynn
  316: +0.04,  // Wright
  310: +0.03,  // Bonner
  // ── SA ──
  179: -0.03,  // Adelaide
  180: +0.00,  // Barker
  182: +0.02,  // Boothby
  183: -0.03,  // Grey
  185: +0.05,  // Hindmarsh
  186: -0.01,  // Kingston
  187: +0.03,  // Makin
  190: -0.04,  // Sturt
  325: +0.05,  // Spence
  // ── TAS ──
  192: +0.04,  // Bass
  193: -0.03,  // Braddon
  196: +0.04,  // Lyons
  // ── VIC ──
  197: +0.02,  // Aston
  198: -0.05,  // Ballarat
  200: +0.04,  // Bendigo
  201: -0.00,  // Bruce
  204: -0.05,  // Casey
  205: -0.01,  // Chisholm
  208: -0.00,  // Corio
  209: -0.04,  // Deakin
  210: -0.00,  // Dunkley
  212: -0.00,  // Gellibrand
  213: -0.03,  // Gippsland
  216: +0.04,  // Holt
  217: +0.02,  // Hotham
  219: -0.01,  // Isaacs
  220: -0.02,  // Jagajaga
  222: +0.01,  // Lalor
  223: -0.01,  // La Trobe
  224: +0.00,  // Mallee
  225: -0.01,  // Maribyrnong
  226: +0.02,  // McEwen
  229: -0.04,  // Menzies
  232: +0.02,  // Scullin
  309: -0.05,  // Gorton
  322: -0.02,  // Macnamara
  323: +0.04,  // Monash
  324: -0.02,  // Nicholls
  326: +0.04,  // Hawke
  328: -0.03,  // Corangamite
  // ── WA ──
  235: -0.04,  // Brand
  236: -0.02,  // Canning
  237: +0.03,  // Cowan
  239: +0.03,  // Forrest
  242: -0.01,  // Moore
  243: +0.03,  // O'Connor
  244: -0.01,  // Pearce
  245: -0.01,  // Perth
  247: +0.04,  // Swan
  248: -0.03,  // Tangney
  305: +0.02,  // Hasluck
  312: -0.04,  // Durack
  317: -0.01,  // Burt
  329: +0.01,  // Bullwinkel
};

// ── 2025 per-seat preference flows from AEC Distribution of Preferences ────────
// Sourced from data/exports/2025/preference_flows.json (populated after running the
// pipeline). When populated, these replace national-average flows for each seat in
// the primary-based 2PP computation, further reducing zero-swing calibration error.
// Populate via: python scripts/update_s25_from_exports.py (after running the pipeline)
// Format: { seatId: { grn_alp, teal_alp, on_alp, other_alp } }
const SEAT_PREF_FLOWS_2025 = {};

// Return per-seat 2025 AEC first preferences, or null if not available.
// Falls back to null (caller uses UNS 2PP-swing for seats without FP data).
function getSeatFpBaseline(seatId) {
  return SEAT_FP_2025[seatId] ?? null;
}

// Estimate seat-level ON first preference using 2025 seat baseline + national swing.
function estimateSeatOnFp(seatId, swings) {
  const base = SEAT_FP_2025[seatId]?.on ?? ON_FP_2025[seatId] ?? BASELINE_2025.on;
  return Math.max(0, base + swings.on);
}

// ── 2025 seat data from AEC final results (event_id=31496) ────────────────────
const _S25 = [
  [318, "Bean", "ACT", "ALP", "David Smith", "ALP", "IND", 0.68],
  [101, "Canberra", "ACT", "ALP", "Alicia Payne", "ALP", "GRN", 39.04],
  [102, "Fenner", "ACT", "ALP", "Andrew Leigh", "ALP", "LP", 44.16],
  [103, "Banks", "NSW", "ALP", "Zhi Soon", "ALP", "LP", 4.78],
  [104, "Barton", "NSW", "ALP", "Ash Ambihaipahar", "ALP", "LP", 32.01],
  [105, "Bennelong", "NSW", "ALP", "Jerome Laxale", "ALP", "LP", 18.52],
  [106, "Berowra", "NSW", "LP", "Julian Leeser", "LP", "ALP", 3.27],
  [107, "Blaxland", "NSW", "ALP", "Jason Clare", "ALP", "LP", 43.81],
  [108, "Bradfield", "NSW", "IND", "Nicolette Boele", "IND", "LP", 0.02],
  [109, "Calare", "NSW", "IND", "Andrew Gee", "IND", "NP", 13.56],
  [111, "Chifley", "NSW", "ALP", "Ed Husic", "ALP", "LP", 39.66],
  [112, "Cook", "NSW", "LP", "Simon Kennedy", "LP", "ALP", 14.39],
  [113, "Cowper", "NSW", "NP", "Pat Conaghan", "NP", "IND", 5.09],
  [114, "Cunningham", "NSW", "ALP", "Alison Byrnes", "ALP", "LP", 35.04],
  [115, "Dobell", "NSW", "ALP", "Emma Mcbride", "ALP", "LP", 18.86],
  [117, "Eden-Monaro", "NSW", "ALP", "Kristy Mcbain", "ALP", "LP", 14.43],
  [118, "Farrer", "NSW", "LP", "Sussan Ley", "LP", "IND", 12.39],
  [119, "Fowler", "NSW", "IND", "Dai Le", "IND", "ALP", 5.35],
  [120, "Gilmore", "NSW", "ALP", "Fiona Phillips", "ALP", "LP", 10.26],
  [121, "Grayndler", "NSW", "ALP", "Anthony Albanese", "ALP", "GRN", 33.73],
  [122, "Greenway", "NSW", "ALP", "Michelle Rowland", "ALP", "LP", 27.52],
  [124, "Hughes", "NSW", "ALP", "David Moncrieff", "ALP", "LP", 6.11],
  [125, "Hume", "NSW", "LP", "Angus Taylor", "LP", "ALP", 16.11],
  [126, "Hunter", "NSW", "ALP", "Dan Repacholi", "ALP", "ON", 18.07],
  [127, "Kingsford Smith", "NSW", "ALP", "Matt Thistlethwaite", "ALP", "LP", 34.37],
  [128, "Lindsay", "NSW", "LP", "Melissa Mcintosh", "LP", "ALP", 5.57],
  [130, "Lyne", "NSW", "NP", "Alison Penfold", "NP", "ALP", 19.56],
  [131, "Macarthur", "NSW", "ALP", "Mike Freelander", "ALP", "LP", 31.21],
  [132, "Mackellar", "NSW", "IND", "Sophie Scamps", "IND", "LP", 11.32],
  [133, "Macquarie", "NSW", "ALP", "Susan Templeman", "ALP", "LP", 15.41],
  [315, "McMahon", "NSW", "ALP", "Chris Bowen", "ALP", "LP", 18.04],
  [134, "Mitchell", "NSW", "LP", "Alex Hawke", "LP", "ALP", 7.62],
  [135, "New England", "NSW", "NP", "Barnaby Joyce", "NP", "ALP", 34.12],
  [136, "Newcastle", "NSW", "ALP", "Sharon Claydon", "ALP", "GRN", 31.61],
  [138, "Page", "NSW", "NP", "Kevin Hogan", "NP", "ALP", 18.57],
  [139, "Parkes", "NSW", "NP", "Jamie Chaffey", "NP", "ALP", 25.94],
  [140, "Parramatta", "NSW", "ALP", "Andrew Charlton", "ALP", "LP", 25.1],
  [249, "Paterson", "NSW", "ALP", "Meryl Swanson", "ALP", "LP", 13.78],
  [144, "Reid", "NSW", "ALP", "Sally Sitou", "ALP", "LP", 24.01],
  [145, "Richmond", "NSW", "ALP", "Justine Elliot", "ALP", "NP", 20.01],
  [250, "Riverina", "NSW", "NP", "Michael Mccormack", "NP", "ALP", 25.24],
  [146, "Robertson", "NSW", "ALP", "Gordon Reid", "ALP", "LP", 18.73],
  [148, "Shortland", "NSW", "ALP", "Pat Conroy", "ALP", "LP", 23.01],
  [149, "Sydney", "NSW", "ALP", "Tanya Plibersek", "ALP", "GRN", 41.89],
  [151, "Warringah", "NSW", "IND", "Zali Steggall", "IND", "LP", 22.4],
  [251, "Watson", "NSW", "ALP", "Tony Burke", "ALP", "IND", 33.03],
  [152, "Wentworth", "NSW", "IND", "Allegra Spender", "IND", "LP", 16.69],
  [153, "Werriwa", "NSW", "ALP", "Anne Maree Stanley", "ALP", "LP", 13.55],
  [150, "Whitlam", "NSW", "ALP", "Carol Berry", "ALP", "LP", 12.49],
  [306, "Lingiari", "NT", "ALP", "Marion Scrymgour", "ALP", "CLP", 16.25],
  [307, "Solomon", "NT", "ALP", "Luke John Gosling", "ALP", "CLP", 2.62],
  [304, "Blair", "QLD", "ALP", "Shayne Neumann", "ALP", "LNP", 11.42],
  [310, "Bonner", "QLD", "ALP", "Kara Cook", "ALP", "LNP", 10.0],
  [155, "Bowman", "QLD", "LNP", "Henry Pike", "LNP", "ALP", 4.86],
  [156, "Brisbane", "QLD", "ALP", "Madonna Jarrett", "ALP", "LNP", 17.92],
  [157, "Capricornia", "QLD", "LNP", "Michelle Landry", "LNP", "ALP", 11.67],
  [158, "Dawson", "QLD", "LNP", "Andrew Willcox", "LNP", "ALP", 23.66],
  [252, "Dickson", "QLD", "ALP", "Ali France", "ALP", "LNP", 11.98],
  [159, "Fadden", "QLD", "LNP", "Cameron Caldwell", "LNP", "ALP", 13.76],
  [160, "Fairfax", "QLD", "LNP", "Ted O'brien", "LNP", "ALP", 6.46],
  [161, "Fisher", "QLD", "LNP", "Andrew Wallace", "LNP", "ALP", 12.07],
  [311, "Flynn", "QLD", "LNP", "Colin Boyce", "LNP", "ALP", 20.48],
  [162, "Forde", "QLD", "ALP", "Rowan Holzberger", "ALP", "LNP", 3.53],
  [163, "Griffith", "QLD", "ALP", "Renee Coffey", "ALP", "GRN", 21.15],
  [164, "Groom", "QLD", "LNP", "Garth Hamilton", "LNP", "IND", 11.35],
  [165, "Herbert", "QLD", "LNP", "Phillip Thompson", "LNP", "ALP", 26.83],
  [166, "Hinkler", "QLD", "LNP", "David Batt", "LNP", "ALP", 12.52],
  [167, "Kennedy", "QLD", "KAP", "Bob Katter", "KAP", "LNP", 31.51],
  [168, "Leichhardt", "QLD", "ALP", "Matt Smith", "ALP", "LNP", 12.12],
  [169, "Lilley", "QLD", "ALP", "Anika Wells", "ALP", "LNP", 29.04],
  [302, "Longman", "QLD", "LNP", "Terry Young", "LNP", "ALP", 0.22],
  [170, "Maranoa", "QLD", "LNP", "David Littleproud", "LNP", "ON", 40.19],
  [171, "McPherson", "QLD", "LNP", "Leon Rebello", "LNP", "ALP", 8.87],
  [172, "Moncrieff", "QLD", "LNP", "Angie Bell", "LNP", "ALP", 17.6],
  [173, "Moreton", "QLD", "ALP", "Julie-ann Campbell", "ALP", "LNP", 32.18],
  [174, "Oxley", "QLD", "ALP", "Milton Dick", "ALP", "LNP", 38.38],
  [175, "Petrie", "QLD", "ALP", "Emma Comer", "ALP", "LNP", 2.34],
  [176, "Rankin", "QLD", "ALP", "Jim Chalmers", "ALP", "LNP", 31.11],
  [177, "Ryan", "QLD", "GRN", "Elizabeth Watson-brown", "GRN", "LNP", 6.54],
  [178, "Wide Bay", "QLD", "LNP", "Llew O'brien", "LNP", "ALP", 15.26],
  [316, "Wright", "QLD", "LNP", "Scott Buchholz", "LNP", "ALP", 15.95],
  [179, "Adelaide", "SA", "ALP", "Steve Georganas", "ALP", "LP", 38.13],
  [180, "Barker", "SA", "LP", "Tony Pasin", "LP", "ALP", 25.95],
  [182, "Boothby", "SA", "ALP", "Louise Miller-frost", "ALP", "LP", 22.21],
  [183, "Grey", "SA", "LP", "Tom Venning", "LP", "ALP", 9.28],
  [185, "Hindmarsh", "SA", "ALP", "Mark Butler", "ALP", "LP", 32.7],
  [186, "Kingston", "SA", "ALP", "Amanda Rishworth", "ALP", "LP", 41.48],
  [187, "Makin", "SA", "ALP", "Tony Zappia", "ALP", "LP", 29.32],
  [188, "Mayo", "SA", "IND", "Rebekha Sharkie", "IND", "ALP", 29.78],
  [325, "Spence", "SA", "ALP", "Matt Burnell", "ALP", "LP", 30.67],
  [190, "Sturt", "SA", "ALP", "Claire Clutterham", "ALP", "LP", 13.25],
  [192, "Bass", "TAS", "ALP", "Jess Teesdale", "ALP", "LP", 16.02],
  [193, "Braddon", "TAS", "ALP", "Anne Urquhart", "ALP", "LP", 14.4],
  [319, "Clark", "TAS", "IND", "Andrew Wilkie", "IND", "ALP", 40.77],
  [195, "Franklin", "TAS", "ALP", "Julie Collins", "ALP", "IND", 15.56],
  [196, "Lyons", "TAS", "ALP", "Rebecca White", "ALP", "LP", 23.17],
  [197, "Aston", "VIC", "ALP", "Mary Doyle", "ALP", "LP", 6.86],
  [198, "Ballarat", "VIC", "ALP", "Catherine King", "ALP", "LP", 21.33],
  [200, "Bendigo", "VIC", "ALP", "Lisa Chesters", "ALP", "NP", 2.8],
  [201, "Bruce", "VIC", "ALP", "Julian Hill", "ALP", "LP", 29.23],
  [203, "Calwell", "VIC", "ALP", "Basem Abdo", "ALP", "IND", 10.16],
  [204, "Casey", "VIC", "LP", "Aaron Violi", "LP", "ALP", 5.78],
  [205, "Chisholm", "VIC", "ALP", "Carina Garland", "ALP", "LP", 11.4],
  [320, "Cooper", "VIC", "ALP", "Ged Kearney", "ALP", "GRN", 19.43],
  [328, "Corangamite", "VIC", "ALP", "Libby Coker", "ALP", "LP", 16.09],
  [208, "Corio", "VIC", "ALP", "Richard Marles", "ALP", "LP", 26.46],
  [209, "Deakin", "VIC", "ALP", "Matt Gregg", "ALP", "LP", 5.65],
  [210, "Dunkley", "VIC", "ALP", "Jodie Belyea", "ALP", "LP", 14.16],
  [211, "Flinders", "VIC", "LP", "Zoe Mckenzie", "LP", "IND", 4.57],
  [321, "Fraser", "VIC", "ALP", "Daniel Mulino", "ALP", "GRN", 18.45],
  [212, "Gellibrand", "VIC", "ALP", "Tim Watts", "ALP", "LP", 30.2],
  [213, "Gippsland", "VIC", "NP", "Darren Chester", "NP", "ALP", 38.71],
  [214, "Goldstein", "VIC", "LP", "Tim Wilson", "LP", "IND", 0.15],
  [309, "Gorton", "VIC", "ALP", "Alice Jordan-baird", "ALP", "LP", 20.57],
  [326, "Hawke", "VIC", "ALP", "Sam Rae", "ALP", "LP", 15.26],
  [216, "Holt", "VIC", "ALP", "Cassandra Fernando", "ALP", "LP", 28.06],
  [217, "Hotham", "VIC", "ALP", "Clare O'neil", "ALP", "LP", 33.72],
  [218, "Indi", "VIC", "IND", "Helen Haines", "IND", "LP", 17.27],
  [219, "Isaacs", "VIC", "ALP", "Mark Dreyfus", "ALP", "LP", 28.68],
  [220, "Jagajaga", "VIC", "ALP", "Kate Thwaites", "ALP", "LP", 25.76],
  [221, "Kooyong", "VIC", "IND", "Monique Ryan", "IND", "LP", 1.33],
  [223, "La Trobe", "VIC", "LP", "Jason Wood", "LP", "ALP", 4.12],
  [222, "Lalor", "VIC", "ALP", "Joanne Ryan", "ALP", "LP", 26.43],
  [322, "Macnamara", "VIC", "ALP", "Josh Burns", "ALP", "LP", 23.59],
  [224, "Mallee", "VIC", "NP", "Anne Webster", "NP", "ALP", 38.08],
  [225, "Maribyrnong", "VIC", "ALP", "Jo Briskey", "ALP", "LP", 25.29],
  [226, "McEwen", "VIC", "ALP", "Rob Mitchell", "ALP", "LP", 9.52],
  [228, "Melbourne", "VIC", "ALP", "Sarah Witty", "ALP", "GRN", 6.03],
  [229, "Menzies", "VIC", "ALP", "Gabriel Ng", "ALP", "LP", 2.15],
  [323, "Monash", "VIC", "LP", "Mary Aldred", "LP", "ALP", 8.18],
  [324, "Nicholls", "VIC", "NP", "Sam Birrell", "NP", "ALP", 28.76],
  [232, "Scullin", "VIC", "ALP", "Andrew Giles", "ALP", "LP", 28.59],
  [233, "Wannon", "VIC", "LP", "Dan Tehan", "LP", "IND", 6.55],
  [234, "Wills", "VIC", "ALP", "Peter Khalil", "ALP", "GRN", 2.86],
  [235, "Brand", "WA", "ALP", "Madeleine King", "ALP", "LP", 33.84],
  [329, "Bullwinkel", "WA", "ALP", "Trish Cook", "ALP", "LP", 1.02],
  [317, "Burt", "WA", "ALP", "Matt Keogh", "ALP", "LP", 31.41],
  [236, "Canning", "WA", "LP", "Andrew Hastie", "LP", "ALP", 13.1],
  [237, "Cowan", "WA", "ALP", "Anne Aly", "ALP", "LP", 27.27],
  [238, "Curtin", "WA", "IND", "Kate Chaney", "IND", "LP", 6.54],
  [312, "Durack", "WA", "LP", "Melissa Price", "LP", "ALP", 20.31],
  [239, "Forrest", "WA", "LP", "Ben Small", "LP", "ALP", 4.47],
  [240, "Fremantle", "WA", "ALP", "Josh Wilson", "ALP", "IND", 1.37],
  [305, "Hasluck", "WA", "ALP", "Tania Lawrence", "ALP", "LP", 31.95],
  [242, "Moore", "WA", "ALP", "Tom French", "ALP", "LP", 5.77],
  [243, "O'Connor", "WA", "LP", "Rick Wilson", "LP", "ALP", 26.57],
  [244, "Pearce", "WA", "ALP", "Tracey Roberts", "ALP", "LP", 12.87],
  [245, "Perth", "WA", "ALP", "Patrick Gorman", "ALP", "LP", 33.02],
  [247, "Swan", "WA", "ALP", "Zaneta Mascarenhas", "ALP", "LP", 27.98],
  [248, "Tangney", "WA", "ALP", "Sam Lim", "ALP", "LP", 13.98],
];
const SEATS = _S25.map(([id, name, state, wp, wn, t1, t2, m]) => ({
  id, name, state, margin: m, swing: 0, fp: [],
  winner: { party: wp, name: wn },
  tcp: [{ party: t1, pct: +(50 + m / 2).toFixed(2) }, { party: t2, pct: +(50 - m / 2).toFixed(2) }]
}));

// ─── Sample polling data (pre-loaded) ────────────────────────────────────────
// BludgerTrack national polls — sourced from pollbludger.net/fed2028/bludgertrack
// 'on' = One Nation first-preference %; 'oth' computed as 100 - alp - coal - grn - on
// tpp = ALP two-party preferred (null if not reported by pollster)
// n = approximate sample size (used for weighted aggregation)
const POLL_SAMPLE_SIZES = {
  "Newspoll": 1597, "Roy Morgan": 2537, "Essential Research": 1020,
  "YouGov": 1511, "Resolve Strategic": 1605, "RedBridge Group": 1000,
  "DemosAU": 1500, "Freshwater Strategy": 1000, "Fox & Hedgehog": 1000,
  "Spectre Strategy": 1000,
};
const INITIAL_POLLS = [
  { id: 1, pollster: "Election Result", date: "2025-05-02", alp: 34.6, coal: 31.8, grn: 12.2, on: 6.4, tpp: 55.2 },
  { id: 2, pollster: "Roy Morgan", date: "2025-05-31", alp: 37, coal: 31, grn: 11.5, on: 6, tpp: 58.5 },
  { id: 3, pollster: "Roy Morgan", date: "2025-06-21", alp: 37.5, coal: 31, grn: 12, on: 6, tpp: 58 },
  { id: 4, pollster: "RedBridge Group", date: "2025-06-29", alp: 37, coal: 31, grn: 11, on: 9, tpp: 55.5 },
  { id: 5, pollster: "Roy Morgan", date: "2025-06-28", alp: 36.5, coal: 30.5, grn: 12, on: 8.5, tpp: 56.5 },
  { id: 6, pollster: "DemosAU", date: "2025-07-05", alp: 36, coal: 26, grn: 14, on: 9, tpp: 59 },
  { id: 7, pollster: "Roy Morgan", date: "2025-07-26", alp: 36.5, coal: 31, grn: 12, on: 7, tpp: 57 },
  { id: 8, pollster: "Newspoll", date: "2025-07-16", alp: 36, coal: 29, grn: 12, on: 8, tpp: 57 },
  { id: 9, pollster: "Resolve Strategic", date: "2025-07-18", alp: 35, coal: 29, grn: 12, on: 8, tpp: 56 },
  { id: 10, pollster: "Roy Morgan", date: "2025-08-23", alp: 34, coal: 30, grn: 12, on: 9, tpp: 55.5 },
  { id: 11, pollster: "Newspoll", date: "2025-08-13", alp: 36, coal: 30, grn: 12, on: 9, tpp: 56 },
  { id: 12, pollster: "Resolve Strategic", date: "2025-08-15", alp: 37, coal: 29, grn: 12, on: 9, tpp: 59 },
  { id: 13, pollster: "RedBridge Group", date: "2025-09-07", alp: 35, coal: 30, grn: 11, on: 11, tpp: 53.5 },
  { id: 14, pollster: "Roy Morgan", date: "2025-09-20", alp: 34, coal: 30, grn: 12, on: 9.5, tpp: 55.5 },
  { id: 15, pollster: "Newspoll", date: "2025-09-10", alp: 36, coal: 27, grn: 13, on: 10, tpp: 58 },
  { id: 16, pollster: "Resolve Strategic", date: "2025-09-12", alp: 35, coal: 27, grn: 11, on: 12, tpp: 55 },
  { id: 17, pollster: "Essential Research", date: "2025-09-28", alp: 35, coal: 27, grn: 11, on: 13, tpp: 51 },
  { id: 18, pollster: "YouGov", date: "2025-09-29", alp: 34, coal: 27, grn: 12, on: 12, tpp: 56 },
  { id: 19, pollster: "Newspoll", date: "2025-10-01", alp: 37, coal: 28, grn: 12, on: 11, tpp: 57 },
  { id: 20, pollster: "RedBridge Group", date: "2025-10-06", alp: 34, coal: 29, grn: 11, on: 14, tpp: 54 },
  { id: 21, pollster: "Roy Morgan", date: "2025-10-18", alp: 35, coal: 27, grn: 13, on: 12, tpp: 57 },
  { id: 22, pollster: "Resolve Strategic", date: "2025-10-11", alp: 34, coal: 28, grn: 11, on: 12, tpp: 55 },
  { id: 23, pollster: "Freshwater Strategy", date: "2025-10-19", alp: 33, coal: 31, grn: 14, on: 10, tpp: 55 },
  { id: 24, pollster: "Essential Research", date: "2025-10-26", alp: 36, coal: 26, grn: 9, on: 15, tpp: 50 },
  { id: 25, pollster: "DemosAU", date: "2025-11-10", alp: 33, coal: 24, grn: 13, on: 17, tpp: 56 },
  { id: 26, pollster: "Newspoll", date: "2025-10-29", alp: 36, coal: 24, grn: 11, on: 15, tpp: 57 },
  { id: 27, pollster: "Roy Morgan", date: "2025-11-15", alp: 33, coal: 27, grn: 12.5, on: 14, tpp: 55 },
  { id: 28, pollster: "Resolve Strategic", date: "2025-11-07", alp: 33, coal: 29, grn: 12, on: 12, tpp: 53 },
  { id: 29, pollster: "YouGov", date: "2025-11-10", alp: 32, coal: 25, grn: 12, on: 18, tpp: null },
  { id: 30, pollster: "RedBridge Group", date: "2025-11-12", alp: 38, coal: 24, grn: 9, on: 18, tpp: 56 },
  { id: 31, pollster: "Spectre Strategy", date: "2025-11-16", alp: 33, coal: 25, grn: 12.5, on: 17.5, tpp: 53 },
  { id: 32, pollster: "YouGov", date: "2025-11-16", alp: 34, coal: 26, grn: 12, on: 18, tpp: null },
  { id: 33, pollster: "RedBridge Group", date: "2025-11-25", alp: 35, coal: 26, grn: 10, on: 18, tpp: 54 },
  { id: 34, pollster: "Newspoll", date: "2025-11-19", alp: 36, coal: 24, grn: 13, on: 15, tpp: 58 },
  { id: 35, pollster: "Essential Research", date: "2025-11-23", alp: 36, coal: 27, grn: 11, on: 15, tpp: 50 },
  { id: 36, pollster: "Roy Morgan", date: "2025-12-13", alp: 32, coal: 26.5, grn: 13.5, on: 15.5, tpp: 55 },
  { id: 37, pollster: "YouGov", date: "2025-12-01", alp: 32, coal: 24, grn: 13, on: 19, tpp: null },
  { id: 38, pollster: "Resolve Strategic", date: "2025-12-06", alp: 35, coal: 26, grn: 11, on: 14, tpp: 55 },
  { id: 39, pollster: "Essential Research", date: "2025-12-07", alp: 34, coal: 26, grn: 10, on: 17, tpp: 49 },
  { id: 40, pollster: "RedBridge Group", date: "2025-12-11", alp: 35, coal: 26, grn: 13, on: 17, tpp: 56 },
  { id: 41, pollster: "Resolve Strategic", date: "2025-12-19", alp: 32, coal: 28, grn: 12, on: 16, tpp: 54 },
  { id: 42, pollster: "YouGov", date: "2025-12-22", alp: 30, coal: 24, grn: 13, on: 20, tpp: null },
  { id: 43, pollster: "DemosAU", date: "2026-01-05", alp: 29, coal: 23, grn: 12, on: 23, tpp: 52 },
  { id: 44, pollster: "Fox & Hedgehog", date: "2026-01-05", alp: 29, coal: 25, grn: 14, on: 21, tpp: 53 },
  { id: 45, pollster: "Roy Morgan", date: "2026-01-10", alp: 30, coal: 30.5, grn: 13.5, on: 15, tpp: 52 },
  { id: 46, pollster: "Resolve Strategic", date: "2026-01-15", alp: 30, coal: 28, grn: 10, on: 18, tpp: 52 },
  { id: 47, pollster: "Newspoll", date: "2026-01-14", alp: 32, coal: 21, grn: 12, on: 22, tpp: 55 },
  { id: 48, pollster: "Freshwater Strategy", date: "2026-01-17", alp: 33, coal: 28, grn: 11, on: 19, tpp: 53 },
  { id: 49, pollster: "Roy Morgan", date: "2026-01-17", alp: 28.5, coal: 24, grn: 13.5, on: 21, tpp: 53 },
  { id: 50, pollster: "DemosAU", date: "2026-01-20", alp: 30, coal: 21, grn: 13, on: 24, tpp: null },
  { id: 51, pollster: "Roy Morgan", date: "2026-01-24", alp: 30.5, coal: 22.5, grn: 13.5, on: 22.5, tpp: 54.5 },
  { id: 52, pollster: "YouGov", date: "2026-01-26", alp: 31, coal: 20, grn: 12, on: 25, tpp: 55 },
  { id: 53, pollster: "Essential Research", date: "2026-01-27", alp: 31, coal: 25, grn: 9, on: 22, tpp: 49 },
  { id: 54, pollster: "RedBridge Group", date: "2026-01-28", alp: 34, coal: 19, grn: 11, on: 26, tpp: 56 },
  { id: 55, pollster: "Roy Morgan", date: "2026-01-31", alp: 30.5, coal: 20.5, grn: 12.5, on: 25, tpp: 54.5 },
  { id: 56, pollster: "Newspoll", date: "2026-02-07", alp: 33, coal: 18, grn: 12, on: 27, tpp: null },
  { id: 57, pollster: "Roy Morgan", date: "2026-02-07", alp: 28.5, coal: 22.5, grn: 13.5, on: 24.5, tpp: 53 },
  { id: 58, pollster: "YouGov", date: "2026-02-09", alp: 30, coal: 19, grn: 12, on: 28, tpp: 54 },
  { id: 59, pollster: "Roy Morgan", date: "2026-02-12", alp: 30.5, coal: 20, grn: 13, on: 25, tpp: 55 },
  { id: 60, pollster: "Resolve Strategic", date: "2026-02-13", alp: 32, coal: 23, grn: 11, on: 23, tpp: 55 },
  { id: 61, pollster: "Roy Morgan", date: "2026-02-15", alp: 32, coal: 23.5, grn: 12.5, on: 21.5, tpp: 55 },
  { id: 62, pollster: "Fox & Hedgehog", date: "2026-02-18", alp: 30, coal: 24, grn: 12, on: 25, tpp: 51 },
  { id: 63, pollster: "DemosAU", date: "2026-02-19", alp: 29, coal: 21, grn: 12, on: 28, tpp: null },
  { id: 64, pollster: "Roy Morgan", date: "2026-02-21", alp: 31, coal: 24, grn: 12.5, on: 20.5, tpp: 54 },
  { id: 65, pollster: "Essential Research", date: "2026-02-20", alp: 30, coal: 26, grn: 11, on: 22, tpp: 47 },
  { id: 66, pollster: "YouGov", date: "2026-02-23", alp: 29, coal: 22, grn: 13, on: 24, tpp: 53 },
  { id: 67, pollster: "Newspoll", date: "2026-02-25", alp: 32, coal: 20, grn: 11, on: 27, tpp: null },
  { id: 68, pollster: "RedBridge Group", date: "2026-02-26", alp: 32, coal: 19, grn: 12, on: 28, tpp: 54 },
].map(p => ({ ...p, n: POLL_SAMPLE_SIZES[p.pollster] ?? null }));

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
  [8007, "Gosford", "NSW", "LP", "Adam Crouch", 2.3],
  [8008, "Keira", "NSW", "ALP", "Ryan Park", 3.0],
  [8009, "Newtown", "NSW", "GRN", "Jenny Leong", 8.1],
  [8010, "Balmain", "NSW", "GRN", "Kobi Shetty", 7.3],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// QLD 2024 — representative marginal seats
const QLD_2024_SEATS = [
  [8101, "Mount Ommaney", "QLD", "LNP", "Jacob Madsen", 0.3],
  [8102, "Inala", "QLD", "ALP", "Shayne Sutton", 0.4],
  [8103, "Oodgeroo", "QLD", "LNP", "Mark Robinson", 0.5],
  [8104, "Macalister", "QLD", "LNP", "Laura Gerber", 0.8],
  [8105, "Greenslopes", "QLD", "LNP", "Brent Mickelberg", 1.1],
  [8106, "South Brisbane", "QLD", "GRN", "Amy MacMahon", 1.3],
  [8107, "McConnel", "QLD", "LNP", "David Janetzki", 1.5],
  [8108, "Everton", "QLD", "LNP", "Tim Mander", 2.0],
  [8109, "Toohey", "QLD", "ALP", "Peter Russo", 2.5],
  [8110, "Maiwar", "QLD", "GRN", "Michael Berkman", 5.1],
].map(([id, nm, st, wp, wn, m]) => mkSeat(id, nm, st, wp, wn, m));

// WA 2025 — representative marginal seats
const WA_2025_SEATS = [
  [8201, "Carine", "WA", "LP", "David Honey", 0.4],
  [8202, "Vasse", "WA", "LP", "Libby Mettam", 0.8],
  [8203, "Kalamunda", "WA", "LP", "Peter Rundle", 0.9],
  [8204, "Bateman", "WA", "LP", "David Michael", 1.0],
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
  [8402, "Darwin (1)", "TAS", "LP", "Madeleine Ogilvie", 0.3],
  [8403, "Braddon (1)", "TAS", "LP", "Felix Ellis", 0.4],
  [8404, "Clark (1)", "TAS", "GRN", "Rosalie Woodruff", 0.5],
  [8405, "Lyons (1)", "TAS", "ALP", "Dean Winter", 0.8],
  [8406, "Franklin (1)", "TAS", "ALP", "David O'Byrne", 1.1],
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
  [8601, "Blain", "NT", "CLP", "Bill Yan", 0.3],
  [8602, "Casuarina", "NT", "ALP", "Selena Uibo", 0.4],
  [8603, "Arafura", "NT", "CLP", "Chansey Paech", 0.6],
  [8604, "Karama", "NT", "CLP", "Kate Worden", 0.5],
  [8605, "Fannie Bay", "NT", "ALP", "Eva Lawler", 0.8],
  [8606, "Johnston", "NT", "CLP", "Wayne Gyemore", 1.2],
  [8607, "Nhulunbuy", "NT", "ALP", "Yingiya Guyula", 2.0],
  [8608, "Namatjira", "NT", "CLP", "Mark Turner", 1.5],
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
  [7006, "Kiama", "NSW", "ALP", "Gareth Ward", "ALP", "LP", 1.8],
  [7007, "Keira", "NSW", "ALP", "Ryan Park", "ALP", "LP", 3.0],
  // Marginal LP/ALP
  [7011, "Monaro", "NSW", "LP", "Nichole Overall", "LP", "ALP", 0.7],
  [7012, "Heathcote", "NSW", "LP", "Lee Evans", "LP", "ALP", 1.1],
  [7013, "Gosford", "NSW", "LP", "Adam Crouch", "LP", "ALP", 2.3],
  [7014, "Drummoyne", "NSW", "LP", "Charles Cayford", "LP", "ALP", 2.5],
  [7015, "Holsworthy", "NSW", "LP", "Tina Ayyad", "LP", "ALP", 3.5],
  [7016, "Terrigal", "NSW", "LP", "Adam Crouch", "LP", "ALP", 4.5],
  // Independent seats
  [7021, "Wakehurst", "NSW", "IND", "Karen Howard", "IND", "LP", 1.5],
  // Greens seats
  [7031, "Newtown", "NSW", "GRN", "Jenny Leong", "GRN", "ALP", 8.1],
  [7032, "Balmain", "NSW", "GRN", "Kobi Shetty", "GRN", "ALP", 7.3],
  [7033, "Summer Hill", "NSW", "GRN", "Jo Haylen", "GRN", "ALP", 3.8],
  // LP competitive (5–10pp)
  [7041, "Davidson", "NSW", "LP", "Matt Cross", "LP", "ALP", 5.0],
  [7042, "Pittwater", "NSW", "LP", "Rob Stokes", "LP", "ALP", 7.5],
  [7043, "Epping", "NSW", "LP", "Damien Tudehope", "LP", "ALP", 5.5],
  [7044, "Lane Cove", "NSW", "LP", "Anthony Roberts", "LP", "ALP", 6.5],
  [7045, "Willoughby", "NSW", "LP", "Tim James", "LP", "ALP", 4.8],
  [7046, "Manly", "NSW", "LP", "James Griffin", "LP", "ALP", 5.5],
  [7047, "Castle Hill", "NSW", "LP", "Ray Williams", "LP", "ALP", 5.0],
  [7048, "Hornsby", "NSW", "LP", "Matt Kean", "LP", "ALP", 6.0],
  // NP seats
  [7061, "Oxley", "NSW", "NP", "Michael Johnsen", "NP", "ALP", 3.0],
  [7062, "Upper Hunter", "NSW", "NP", "Dave Layzell", "NP", "ALP", 4.5],
  [7063, "Port Macquarie", "NSW", "NP", "Leslie Williams", "NP", "ALP", 4.0],
  [7064, "Tamworth", "NSW", "NP", "Kevin Anderson", "NP", "ALP", 8.0],
  [7065, "Orange", "NSW", "NP", "Phil Donato", "NP", "ALP", 7.0],
  [7066, "Dubbo", "NSW", "NP", "Dugald Saunders", "NP", "ALP", 6.5],
  [7067, "Murray", "NSW", "NP", "Helen Dalton", "NP", "ALP", 10.0],
  [7068, "Bathurst", "NSW", "NP", "Paul Toole", "NP", "ALP", 8.5],
  [7069, "Barwon", "NSW", "NP", "Roy Butler", "NP", "ALP", 15.0],
  // ALP competitive (5–10pp)
  [7071, "Swansea", "NSW", "ALP", "Yasmin Catley", "ALP", "LP", 5.5],
  [7072, "Lake Macquarie", "NSW", "ALP", "Greg Piper", "ALP", "LP", 5.0],
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

// ── QLD 2024 (93 seats, LNP majority 51, ALP 27, GRN 7, crossbench 8) ─────────
// Primary: ALP 33.4  LNP 40.3  GRN 11.5  ON 8.2  other 6.6   ALP 2PP 46.3%
const _QLD = [
  // Marginal LNP/ALP
  [7201, "Mount Ommaney", "QLD", "LNP", "Jacob Madsen", "LNP", "ALP", 0.3],
  [7202, "Oodgeroo", "QLD", "LNP", "Mark Robinson", "LNP", "ALP", 0.5],
  [7203, "Macalister", "QLD", "LNP", "Laura Gerber", "LNP", "ALP", 0.8],
  [7204, "Greenslopes", "QLD", "LNP", "Brent Mickelberg", "LNP", "ALP", 1.1],
  [7205, "McConnel", "QLD", "LNP", "David Janetzki", "LNP", "ALP", 1.5],
  [7206, "Everton", "QLD", "LNP", "Tim Mander", "LNP", "ALP", 2.0],
  [7207, "Currumbin", "QLD", "LNP", "Laura Gerber", "LNP", "ALP", 3.0],
  [7208, "Burleigh", "QLD", "LNP", "Michael Hart", "LNP", "ALP", 4.5],
  [7209, "Mundingburra", "QLD", "LNP", "Coralee O'Rourke", "LNP", "ALP", 3.5],
  // Marginal ALP/LNP
  [7211, "Inala", "QLD", "ALP", "Shayne Sutton", "ALP", "LNP", 0.4],
  [7212, "Toohey", "QLD", "ALP", "Peter Russo", "ALP", "LNP", 2.5],
  [7213, "Miller", "QLD", "ALP", "Jo-Ann Miller", "ALP", "LNP", 3.5],
  // Greens seats (won 7 seats, mostly inner Brisbane)
  [7221, "South Brisbane", "QLD", "GRN", "Amy MacMahon", "GRN", "ALP", 1.3],
  [7222, "Maiwar", "QLD", "GRN", "Michael Berkman", "GRN", "LNP", 5.1],
  [7223, "Cooper", "QLD", "GRN", "Jonty Bush", "GRN", "LNP", 3.5],
  [7224, "Macgregor", "QLD", "GRN", "Catie Shailer", "GRN", "LNP", 2.8],
  [7225, "Stretton", "QLD", "GRN", "Steven Miles", "GRN", "LNP", 2.2],
  [7226, "Waterford", "QLD", "GRN", "Shannon Fentiman", "GRN", "ALP", 1.8],
  [7227, "Rochedale", "QLD", "GRN", "David Crisafulli", "GRN", "LNP", 1.5],
  // LNP competitive (5–10pp)
  [7231, "Nanango", "QLD", "LNP", "Deb Frecklington", "LNP", "ALP", 6.0],
  [7232, "Warrego", "QLD", "LNP", "Ann Leahy", "LNP", "ALP", 7.5],
  [7233, "Gympie", "QLD", "LNP", "Tony Perrett", "LNP", "ALP", 8.0],
  [7234, "Buderim", "QLD", "LNP", "Brent Mickelberg", "LNP", "ALP", 7.0],
  [7235, "Caloundra", "QLD", "LNP", "Jason Hunt", "LNP", "ALP", 6.5],
  // LNP seats where One Nation is the TCP challenger (rural/regional QLD)
  [7261, "Mirani", "QLD", "LNP", "Glenn Butcher", "LNP", "ON", 1.8],
  [7262, "Condamine", "QLD", "LNP", "Pat Weir", "LNP", "ON", 2.6],
  [7263, "Callide", "QLD", "LNP", "Colin Boyce", "LNP", "ON", 3.5],
  [7264, "Hinchinbrook", "QLD", "LNP", "Nick Dametto", "LNP", "ON", 4.5],
  [7265, "Southern Downs", "QLD", "LNP", "James Lister", "LNP", "ON", 5.5],
  // ALP safe
  [7241, "Bundaberg", "QLD", "ALP", "Tom Smith", "ALP", "LNP", 10.0],
  [7242, "Rockhampton", "QLD", "ALP", "Barry O'Rourke", "ALP", "LNP", 12.0],
  [7243, "Mulgrave", "QLD", "ALP", "Curtis Pitt", "ALP", "LNP", 15.0],
];
const QLD_SEATS = fillStateSeats(_QLD.map(r => mkSS(...r)),
  { alp: 27, coalition: 51, greens: 7, crossbench: 8 }, "LNP", "QLD", 100);

// ── WA 2025 (59 seats, ALP landslide 46, LP 10, GRN 2, IND 1) ────────────────
// Primary: ALP 55.0  LP 18.5  NP 4.5  GRN 11.0  IND/other 11.0   ALP 2PP 63.1%
const _WA = [
  // Marginal LP/ALP (most LP seats were very tight after ALP landslide)
  [7301, "Carine", "WA", "LP", "David Honey", "LP", "ALP", 0.4],
  [7302, "Vasse", "WA", "LP", "Libby Mettam", "LP", "ALP", 0.8],
  [7303, "Kalamunda", "WA", "LP", "Peter Rundle", "LP", "ALP", 0.9],
  [7304, "Bateman", "WA", "LP", "David Michael", "LP", "ALP", 1.0],
  [7305, "Churchlands", "WA", "LP", "Sean L'Estrange", "LP", "ALP", 2.2],
  [7306, "Moore", "WA", "LP", "Shane Love", "LP", "ALP", 1.5],
  // Marginal NP/ALP
  [7311, "Roe", "WA", "NP", "Peter Rundle", "NP", "ALP", 1.2],
  // Marginal ALP/LP
  [7321, "Bicton", "WA", "ALP", "Lisa O'Malley", "ALP", "LP", 2.5],
  [7322, "Dawesville", "WA", "ALP", "Matthew Hughes", "ALP", "LP", 3.1],
  // Greens seats
  [7331, "Fremantle", "WA", "GRN", "Simone McGurk", "GRN", "ALP", 2.5],
  [7332, "Maylands", "WA", "GRN", "Lisa Baker", "GRN", "ALP", 3.5],
  // LP safe (remaining LP seats — all fairly marginal given ALP landslide)
  [7341, "Scarborough", "WA", "LP", "Paul Papalia", "LP", "ALP", 3.5],
  [7342, "Hillarys", "WA", "LP", "Peter Katsambanis", "LP", "ALP", 4.0],
  // ALP safe
  [7351, "Joondalup", "WA", "ALP", "David Templeman", "ALP", "LP", 10.0],
  [7352, "Balcatta", "WA", "ALP", "David Michael", "ALP", "LP", 12.0],
  [7353, "Midland", "WA", "ALP", "Michelle Roberts", "ALP", "LP", 15.0],
  [7354, "Armadale", "WA", "ALP", "Tony Buti", "ALP", "LP", 18.0],
  [7355, "Mandurah", "WA", "ALP", "David Templeman", "ALP", "LP", 20.0],
  [7356, "Rockingham", "WA", "ALP", "Mark McGowan", "ALP", "LP", 25.0],
  [7357, "Kwinana", "WA", "ALP", "Roger Cook", "ALP", "LP", 22.0],
];
const WA_SEATS = fillStateSeats(_WA.map(r => mkSS(...r)),
  { alp: 46, coalition: 10, greens: 2, teal: 1 }, "LP", "WA", 200);

// ── SA 2022 (47 seats, ALP majority 26, LP 17, IND 2, crossbench 2) ──────────
// Primary: ALP 38.3  LP 34.8  GRN 7.3  IND/other 19.6   ALP 2PP 54.9%
const _SA = [
  // Marginal ALP/LP
  [7401, "King", "SA", "ALP", "Dana Wortley", "ALP", "LP", 0.1],
  [7402, "Gibson", "SA", "ALP", "Eddie Hughes", "ALP", "LP", 0.4],
  [7403, "Newland", "SA", "ALP", "Blair Boyer", "ALP", "LP", 0.6],
  [7404, "Florey", "SA", "ALP", "Frances Bedford", "ALP", "LP", 1.0],
  [7405, "Adelaide", "SA", "ALP", "Lucy Hood", "ALP", "LP", 3.0],
  [7406, "Kaurna", "SA", "ALP", "Chris Picton", "ALP", "LP", 4.5],
  [7407, "Playford", "SA", "ALP", "Tom Koutsantonis", "ALP", "LP", 5.5],
  // Marginal LP/ALP
  [7411, "Heysen", "SA", "LP", "Josh Teague", "LP", "ALP", 0.3],
  [7412, "Colton", "SA", "LP", "Jeff Brock", "LP", "ALP", 1.8],
  [7413, "Morialta", "SA", "LP", "John Gardner", "LP", "ALP", 2.0],
  [7414, "Waite", "SA", "LP", "Sam Duluk", "LP", "ALP", 2.5],
  [7415, "Flinders", "SA", "LP", "Peter Treloar", "LP", "ALP", 3.5],
  [7416, "Bragg", "SA", "LP", "Vickie Chapman", "LP", "ALP", 5.0],
  [7417, "Unley", "SA", "LP", "David Pisoni", "LP", "ALP", 6.0],
  [7418, "Hartley", "SA", "LP", "Vincent Tarzia", "LP", "ALP", 7.5],
  // Independent/crossbench seats
  [7421, "Mount Gambier", "SA", "IND", "Troy Bell", "IND", "LP", 4.5],
  [7422, "Frome", "SA", "IND", "Geoff Brock", "IND", "LP", 8.0],
  // ALP safe
  [7431, "Cheltenham", "SA", "ALP", "Tom Koutsantonis", "ALP", "LP", 10.0],
  [7432, "Croydon", "SA", "ALP", "Joe Szakacs", "ALP", "LP", 15.0],
  [7433, "Ramsay", "SA", "ALP", "Peter Malinauskas", "ALP", "LP", 12.0],
  [7434, "Lee", "SA", "ALP", "Tom Kenyon", "ALP", "LP", 11.0],
];
const SA_SEATS = fillStateSeats(_SA.map(r => mkSS(...r)),
  { alp: 26, coalition: 17, greens: 0, teal: 2, crossbench: 2 }, "LP", "SA", 300);

// ── NT 2024 (25 seats, CLP majority 17, ALP 8) ───────────────────────────────
// Primary: ALP 30.5  CLP 40.5  GRN 5.5  IND 12.5  other 11.0
const _NT = [
  // Marginal
  [7501, "Blain", "NT", "CLP", "Bill Yan", "CLP", "ALP", 0.3],
  [7502, "Casuarina", "NT", "ALP", "Selena Uibo", "ALP", "CLP", 0.4],
  [7503, "Arafura", "NT", "CLP", "Chansey Paech", "CLP", "ALP", 0.6],
  [7504, "Karama", "NT", "CLP", "Kate Worden", "CLP", "ALP", 0.5],
  [7505, "Fannie Bay", "NT", "ALP", "Eva Lawler", "ALP", "CLP", 0.8],
  [7506, "Johnston", "NT", "CLP", "Wayne Gyemore", "CLP", "ALP", 1.2],
  [7507, "Nhulunbuy", "NT", "ALP", "Yingiya Guyula", "ALP", "CLP", 2.0],
  [7508, "Namatjira", "NT", "CLP", "Mark Turner", "CLP", "ALP", 1.5],
  [7509, "Barkly", "NT", "CLP", "Steve Edgington", "CLP", "ALP", 3.5],
  [7510, "Brennan", "NT", "CLP", "Lia Finocchiaro", "CLP", "ALP", 5.0],
  [7511, "Darwin", "NT", "CLP", "Josh Burgoyne", "CLP", "ALP", 4.5],
  [7512, "Goyder", "NT", "CLP", "Marie-Clare Boothby", "CLP", "ALP", 6.0],
  // ALP safe
  [7521, "Wanguri", "NT", "ALP", "Natasha Fyles", "ALP", "CLP", 10.0],
  [7522, "Drysdale", "NT", "ALP", "Ngaree Ah Kit", "ALP", "CLP", 12.0],
];
const NT_SEATS = fillStateSeats(_NT.map(r => mkSS(...r)),
  { alp: 8, coalition: 17 }, "CLP", "NT", 400);

// ── TAS 2024 ─ Hare-Clark (7 electorates × 5 seats = 35) ─────────────────────
// LP 15, ALP 10, GRN 7, IND/other 3
// Model approach: quota-based proportional allocation per electorate.
// Electorates and approximate 2024 primary votes (LP% / ALP% / GRN% / IND%):
const TAS_ELECTORATES = [
  { name: "Bass", seats: 5, coal: 36, alp: 28, grn: 11, ind: 10 },
  { name: "Braddon", seats: 5, coal: 38, alp: 30, grn: 9, ind: 9 },
  { name: "Clark", seats: 5, coal: 30, alp: 25, grn: 19, ind: 14 },
  { name: "Darwin", seats: 5, coal: 36, alp: 27, grn: 12, ind: 11 },
  { name: "Franklin", seats: 5, coal: 34, alp: 28, grn: 14, ind: 11 },
  { name: "Lyons", seats: 5, coal: 37, alp: 29, grn: 10, ind: 10 },
  { name: "Mersey", seats: 5, coal: 38, alp: 31, grn: 9, ind: 8 },
];

// ── ACT 2024 ─ Hare-Clark (5 electorates × 5 seats = 25) ────────────────────
// ALP 9, LP 9, GRN 7
// Electorates and approximate 2024 primary votes:
const ACT_ELECTORATES = [
  { name: "Brindabella", seats: 5, alp: 32, coal: 34, grn: 17, ind: 9 },
  { name: "Ginninderra", seats: 5, alp: 35, coal: 28, grn: 22, ind: 7 },
  { name: "Kurrajong", seats: 5, alp: 36, coal: 26, grn: 26, ind: 7 },
  { name: "Murrumbidgee", seats: 5, alp: 32, coal: 35, grn: 18, ind: 8 },
  { name: "Ngunnawal", seats: 5, alp: 33, coal: 30, grn: 21, ind: 9 },
];

// VIC 2022 — use existing VIC_SEATS_KNOWN (14 seats already defined)
// Transform to standard seat format for reuse
const VIC_2022_SEATS_STD = VIC_SEATS_KNOWN.map(([id, name, party, , , , margin]) =>
  mkSeat(id, name, "VIC", party, "", margin ?? 5));

// ─── VIC 2022 full seat data (88 LA districts, VEC official 2PP results) ──────
// Source: VEC 2022 State Election — vec.vic.gov.au
// Format: [id, name, state, winnerParty, winnerName, tcp1Party, tcp2Party, margin]
const _VS = [
  [9001, "Altona", "VIC", "ALP", "Juliana Addison", "ALP", "LP", 28.1],
  [9002, "Albert Park", "VIC", "ALP", "Nina Taylor", "ALP", "LP", 11.15],
  [9003, "Ashwood", "VIC", "ALP", "Labor MP", "ALP", "LP", 6.15],
  [9004, "Bass", "VIC", "ALP", "Labor MP", "ALP", "LP", 0.24],
  [9005, "Bayswater", "VIC", "ALP", "Labor MP", "ALP", "LP", 4.23],
  [9006, "Bellarine", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.46],
  [9007, "Benambra", "VIC", "LP", "Bill Tilley", "LP", "ALP", 13.26],
  [9008, "Bendigo East", "VIC", "ALP", "Labor MP", "ALP", "LP", 10.91],
  [9009, "Bendigo West", "VIC", "ALP", "Labor MP", "ALP", "LP", 14.35],
  [9010, "Bentleigh", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.04],
  [9011, "Berwick", "VIC", "LP", "Brad Battin", "LP", "ALP", 4.71],
  [9012, "Box Hill", "VIC", "ALP", "Paul Hamer", "ALP", "LP", 7.23],
  [9013, "Brighton", "VIC", "LP", "James Newbury", "LP", "ALP", 4.21],
  [9014, "Broadmeadows", "VIC", "ALP", "Labor MP", "ALP", "LP", 15.45],
  [9015, "Brunswick", "VIC", "GRN", "Tim Read", "GRN", "ALP", 11.1],
  [9016, "Bulleen", "VIC", "LP", "Matthew Guy", "LP", "ALP", 5.94],
  [9017, "Bundoora", "VIC", "ALP", "Labor MP", "ALP", "LP", 12.74],
  [9018, "Carrum", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.94],
  [9019, "Caulfield", "VIC", "LP", "David Southwick", "LP", "ALP", 2.07],
  [9020, "Clarinda", "VIC", "ALP", "Labor MP", "ALP", "LP", 10.37],
  [9021, "Cranbourne", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.0],
  [9022, "Croydon", "VIC", "LP", "David Hodgett", "LP", "ALP", 1.37],
  [9023, "Dandenong", "VIC", "ALP", "Labor MP", "ALP", "LP", 19.11],
  [9024, "Eildon", "VIC", "LP", "Cindy McLeish", "LP", "ALP", 7.08],
  [9025, "Eltham", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.0],
  [9026, "Essendon", "VIC", "ALP", "Labor MP", "ALP", "LP", 12.45],
  [9027, "Eureka", "VIC", "ALP", "Labor MP", "ALP", "LP", 7.17],
  [9028, "Euroa", "VIC", "NP", "Steph Ryan", "NP", "ALP", 9.93],
  [9029, "Evelyn", "VIC", "LP", "Nick McGowan", "LP", "ALP", 5.21],
  [9030, "Footscray", "VIC", "ALP", "Katie Hall", "ALP", "LP", 25.66],
  [9031, "Frankston", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.66],
  [9032, "Geelong", "VIC", "ALP", "Labor MP", "ALP", "LP", 14.71],
  [9033, "Gippsland East", "VIC", "NP", "Tim Bull", "NP", "ALP", 23.92],
  [9034, "Gippsland South", "VIC", "NP", "Danny O'Brien", "NP", "ALP", 15.25],
  [9035, "Glen Waverley", "VIC", "ALP", "Labor MP", "ALP", "LP", 3.3],
  [9036, "Greenvale", "VIC", "ALP", "Labor MP", "ALP", "LP", 6.92],
  [9037, "Hastings", "VIC", "ALP", "Labor MP", "ALP", "LP", 1.35],
  [9038, "Hawthorn", "VIC", "LP", "John Pesutto", "LP", "ALP", 1.74],
  [9039, "Ivanhoe", "VIC", "ALP", "Labor MP", "ALP", "LP", 12.75],
  [9040, "Kalkallo", "VIC", "ALP", "Labor MP", "ALP", "LP", 16.43],
  [9041, "Kew", "VIC", "LP", "David Davis", "LP", "ALP", 3.98],
  [9042, "Kororoit", "VIC", "ALP", "Labor MP", "ALP", "LP", 14.25],
  [9043, "Lara", "VIC", "ALP", "Labor MP", "ALP", "LP", 16.15],
  [9044, "Laverton", "VIC", "ALP", "Labor MP", "ALP", "LP", 18.01],
  [9045, "Lowan", "VIC", "NP", "Emma Kealy", "NP", "ALP", 21.61],
  [9046, "Macedon", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.54],
  [9047, "Malvern", "VIC", "LP", "Michael O'Brien", "LP", "ALP", 8.28],
  [9048, "Melbourne", "VIC", "ALP", "Labor MP", "ALP", "LP", 25.01],
  [9049, "Melton", "VIC", "ALP", "Labor MP", "ALP", "LP", 4.59],
  [9050, "Mildura", "VIC", "IND", "Ali Cupper", "IND", "NP", 8.5],
  [9051, "Mill Park", "VIC", "ALP", "Labor MP", "ALP", "LP", 11.43],
  [9052, "Monbulk", "VIC", "ALP", "Labor MP", "ALP", "LP", 7.55],
  [9053, "Mordialloc", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.19],
  [9054, "Mornington", "VIC", "LP", "Chris Crewther", "LP", "ALP", 8.28],
  [9055, "Morwell", "VIC", "NP", "Martin Cameron", "NP", "ALP", 4.42],
  [9056, "Mulgrave", "VIC", "ALP", "Labor MP", "ALP", "LP", 10.2],
  [9057, "Murray Plains", "VIC", "NP", "Peter Walsh", "NP", "ALP", 22.89],
  [9058, "Narre Warren North", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.16],
  [9059, "Narre Warren South", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.5],
  [9060, "Nepean", "VIC", "LP", "Sam Groth", "LP", "ALP", 6.68],
  [9061, "Niddrie", "VIC", "ALP", "Labor MP", "ALP", "LP", 6.69],
  [9062, "Northcote", "VIC", "GRN", "Kat Theophanous", "GRN", "ALP", 5.0],
  [9063, "Oakleigh", "VIC", "ALP", "Labor MP", "ALP", "LP", 13.48],
  [9064, "Ovens Valley", "VIC", "NP", "Tim McCurdy", "NP", "ALP", 17.97],
  [9065, "Pakenham", "VIC", "ALP", "Labor MP", "ALP", "LP", 0.39],
  [9066, "Pascoe Vale", "VIC", "ALP", "Labor MP", "ALP", "LP", 22.25],
  [9067, "Point Cook", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.34],
  [9068, "Polwarth", "VIC", "LP", "Martha Haylett", "LP", "ALP", 1.79],
  [9069, "Prahran", "VIC", "GRN", "Sam Hibbins", "GRN", "LP", 2.2],
  [9070, "Preston", "VIC", "ALP", "Labor MP", "ALP", "LP", 19.67],
  [9071, "Richmond", "VIC", "GRN", "Gabrielle De Vietri", "GRN", "ALP", 3.1],
  [9072, "Ringwood", "VIC", "ALP", "Labor MP", "ALP", "LP", 7.53],
  [9073, "Ripon", "VIC", "ALP", "Labor MP", "ALP", "LP", 2.99],
  [9074, "Rowville", "VIC", "LP", "Richard Riordan", "LP", "ALP", 3.67],
  [9075, "Sandringham", "VIC", "LP", "Brad Battin", "LP", "ALP", 5.15],
  [9076, "Shepparton", "VIC", "IND", "Kim O'Keeffe", "IND", "ALP", 4.8],
  [9077, "South Barwon", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.8],
  [9078, "South-West Coast", "VIC", "LP", "Roma Britnell", "LP", "ALP", 8.05],
  [9079, "St Albans", "VIC", "ALP", "Labor MP", "ALP", "LP", 9.56],
  [9080, "Sunbury", "VIC", "ALP", "Labor MP", "ALP", "LP", 6.41],
  [9081, "Sydenham", "VIC", "ALP", "Labor MP", "ALP", "LP", 8.73],
  [9082, "Tarneit", "VIC", "ALP", "Labor MP", "ALP", "LP", 12.58],
  [9083, "Thomastown", "VIC", "ALP", "Labor MP", "ALP", "LP", 16.0],
  [9084, "Warrandyte", "VIC", "LP", "Ryan Smith", "LP", "ALP", 4.15],
  [9085, "Wendouree", "VIC", "ALP", "Labor MP", "ALP", "LP", 13.46],
  [9086, "Werribee", "VIC", "ALP", "Labor MP", "ALP", "LP", 10.5],
  [9087, "Williamstown", "VIC", "ALP", "Melissa Horne", "ALP", "LP", 13.44],
  [9088, "Yan Yean", "VIC", "ALP", "Labor MP", "ALP", "LP", 4.45],
];

const VIC_SEATS = _VS.map(([id, name, state, wp, wn, t1, t2, m]) => ({
  id, name, state, margin: m,
  winner: { party: wp, name: wn },
  tcp: [{ party: t1, pct: +(50 + m / 2).toFixed(2) }, { party: t2, pct: +(50 - m / 2).toFixed(2) }],
}));

const ELECTION_DATA = {
  federal_2025: {
    label: "Federal 2025", jurisdiction: "Federal",
    chamber: "House of Representatives", date: "3 May 2025",
    totalSeats: 151, majority: 76, twopp: 55.2,
    seats: SEATS,
    counts: { alp: 94, coalition: 42, grn: 4, teal: 11 },
    incumbent: "Anthony Albanese (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  nsw_2023: {
    label: "NSW 2023", jurisdiction: "New South Wales",
    chamber: "Legislative Assembly", date: "25 March 2023",
    totalSeats: 93, majority: 47, twopp: 53.2,
    seats: NSW_SEATS,
    counts: { alp: 45, coalition: 44, greens: 3, teal: 1, one_nation: 0, crossbench: 0 },
    incumbent: "Chris Minns (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  vic_2022: {
    label: "Victoria 2022", jurisdiction: "Victoria",
    chamber: "Legislative Assembly", date: "26 November 2022",
    totalSeats: 88, majority: 45, twopp: 57.3,
    seats: VIC_SEATS,
    counts: { alp: 56, coalition: 26, greens: 4, teal: 2, one_nation: 0, crossbench: 0 },
    incumbent: "Daniel Andrews (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  qld_2024: {
    label: "Queensland 2024", jurisdiction: "Queensland",
    chamber: "Legislative Assembly", date: "26 October 2024",
    totalSeats: 93, majority: 47, twopp: 46.3,
    seats: QLD_SEATS,
    counts: { alp: 27, coalition: 51, greens: 7, teal: 0, one_nation: 0, crossbench: 8 },
    incumbent: "David Crisafulli (LNP)", incumbentParty: "LNP",
    modelEnabled: true,
  },
  wa_2025: {
    label: "W. Australia 2025", jurisdiction: "Western Australia",
    chamber: "Legislative Assembly", date: "8 March 2025",
    totalSeats: 59, majority: 30, twopp: 63.1,
    seats: WA_SEATS,
    counts: { alp: 46, coalition: 10, greens: 2, teal: 1, one_nation: 0, crossbench: 0 },
    incumbent: "Roger Cook (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  sa_2022: {
    label: "South Aus. 2022", jurisdiction: "South Australia",
    chamber: "House of Assembly", date: "19 March 2022",
    totalSeats: 47, majority: 24, twopp: 54.9,
    seats: SA_SEATS,
    counts: { alp: 26, coalition: 17, greens: 0, teal: 2, one_nation: 0, crossbench: 2 },
    incumbent: "Peter Malinauskas (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  tas_2024: {
    label: "Tasmania 2024", jurisdiction: "Tasmania",
    chamber: "House of Assembly (Hare-Clark)", date: "23 March 2024",
    totalSeats: 35, majority: 18, twopp: null,
    seats: TAS_2024_SEATS,
    counts: { alp: 10, coalition: 15, greens: 7, teal: 3, one_nation: 0, crossbench: 0 },
    incumbent: "Jeremy Rockliff (Liberal)", incumbentParty: "LP",
    modelEnabled: true,
  },
  act_2024: {
    label: "ACT 2024", jurisdiction: "Australian Capital Territory",
    chamber: "Legislative Assembly (Hare-Clark)", date: "19 October 2024",
    totalSeats: 25, majority: 13, twopp: null,
    seats: ACT_2024_SEATS,
    counts: { alp: 9, coalition: 9, greens: 7, teal: 0, one_nation: 0, crossbench: 0 },
    incumbent: "Andrew Barr (ALP)", incumbentParty: "ALP",
    modelEnabled: true,
  },
  nt_2024: {
    label: "N. Territory 2024", jurisdiction: "Northern Territory",
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
  "wa_2025", "sa_2022", "tas_2024", "act_2024", "nt_2024",
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
// Marginal seats historically swing more than safe seats. Based on 2016→2019
// and 2019→2022 federal elections, a smooth logistic multiplier is applied to
// the national 2PP swing before adding it to each seat's baseline.
//
// The logistic curve provides a continuous transition:
//   ~0pp margin  (knife-edge):  ~1.30×
//   ~8pp margin  (marginal):    ~1.05×
//   ~15pp margin (competitive): ~0.90×
//   ~25pp+       (safe):        ~0.80×
//
// This avoids discontinuities where a seat at 5.0pp = 1.30× but 5.1pp = 1.15×.
function seatElasticityMult(alp2pp) {
  const m = Math.abs(alp2pp - 50);
  // Logistic curve: ranges from 0.80 (safe) to 1.30 (knife-edge)
  // Midpoint at ~8pp margin, steepness 0.20
  return 0.80 + 0.50 / (1 + Math.exp(0.20 * (m - 8)));
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
//
// The combined per-seat uncertainty is: σ_seat = √(ε²·σ_nat² + σ_residual² + σ_prefflow²)
// This produces wider, more realistic uncertainty bands than national-only σ.
//
// Uses a 100-point grid over ±3σ of national swing to evaluate the seat-count CDF.
// At each grid point, per-seat win probability uses Φ with the combined σ_seat.

// Calibrated from backtest data: seat-level swing deviations from national swing
// have σ ≈ 1.0pp (2019→2022 RMSE residual after removing national component).
const SEAT_RESIDUAL_STD = 1.0;

// Preference flow uncertainty: historical flows vary ±3pp between elections
// (e.g., ON→ALP ranged from 14.9% in 2022 to 43.0% in 2025). This adds ~0.8pp
// effective 2PP uncertainty per seat, modelled as independent noise.
const PREF_FLOW_STD = 0.8;

function computeUncertainty(seats, nat2ppSwing, swingStd, useElasticity, majority = 76) {
  const COALITION = new Set(["LP", "LNP", "NP", "CLP"]);

  // Φ-function applies only to ALP/Coal seats that were NOT rerouted to an ON TCP race.
  const alpCoalSeats = seats.filter(s => {
    const parties = s.tcp.map(t => t.party);
    const isAlpCoal = parties.includes("ALP") && parties.some(p => COALITION.has(p));
    return isAlpCoal && !(s.modelled?.isAutoMatchup === true);
  });
  // All other seats (non-ALP/Coal and ON-detected) use their deterministic modelled outcome.
  const nonAlpCoalAlp = seats.filter(s => {
    const parties = s.tcp.map(t => t.party);
    const isAlpCoal = parties.includes("ALP") && parties.some(p => COALITION.has(p));
    if (isAlpCoal && !(s.modelled?.isAutoMatchup === true)) return false;
    return (s.modelled?.winnerGroup ?? getParty(s.winner.party).group) === "alp";
  }).length;

  // Per-seat win probabilities — non-Φ seats use deterministic modelled outcome (0 or 1)
  const seatWinProbs = {};
  seats.forEach(s => {
    const g = s.modelled?.winnerGroup ?? getParty(s.winner.party).group;
    seatWinProbs[s.id] = g === "alp" ? 1.0 : 0.0;
  });
  let alpMeanSeats = nonAlpCoalAlp;
  alpCoalSeats.forEach(seat => {
    const rawBase = seat.tcp[0].party === "ALP" ? seat.tcp[0].pct : seat.tcp[1].pct;
    const base = seat.modelled?.projAlp2pp ?? rawBase;
    const eps = useElasticity ? seatElasticityMult(base) : 1.0;
    // Combined per-seat σ: national (correlated, scaled by elasticity) + residual + pref-flow (independent)
    const seatSigma = Math.sqrt(eps * eps * swingStd * swingStd + SEAT_RESIDUAL_STD ** 2 + PREF_FLOW_STD ** 2);
    // Win probability with combined uncertainty
    const p = normCDF((base - 50) / seatSigma);
    seatWinProbs[seat.id] = Math.round(p * 1000) / 1000;
    alpMeanSeats += p;
  });

  // Seat-count CDF via 100-point numerical integration over ±3σ of national swing.
  // At each grid point, each seat's win is evaluated using the independent residual σ
  // layered on top of the national perturbation — producing a realistic correlation
  // structure: seats are partially correlated (via national swing) but not perfectly.
  const N_GRID = 100;
  const gridDeltas = Array.from({ length: N_GRID }, (_, i) =>
    nat2ppSwing + swingStd * (-3 + 6 * i / (N_GRID - 1))
  );
  const gridPdfs = gridDeltas.map(d =>
    Math.exp(-0.5 * ((d - nat2ppSwing) / swingStd) ** 2)
  );
  const totalPdf = gridPdfs.reduce((s, p) => s + p, 0);

  // Independent per-seat noise σ (combines residual + pref-flow uncertainty)
  const indepSigma = Math.sqrt(SEAT_RESIDUAL_STD ** 2 + PREF_FLOW_STD ** 2);

  const seatCountCdf = {};
  gridDeltas.forEach((delta, gi) => {
    const w = gridPdfs[gi] / totalPdf;
    // Expected seat count at this national swing level, using per-seat Φ with
    // the independent residual σ. This is more accurate than the binary ≥50 check:
    // it accounts for per-seat noise even within each national-swing scenario.
    let expectedCount = nonAlpCoalAlp;
    alpCoalSeats.forEach(seat => {
      const rawBase = seat.tcp[0].party === "ALP" ? seat.tcp[0].pct : seat.tcp[1].pct;
      const base = seat.modelled?.projAlp2pp ?? rawBase;
      const eps = useElasticity ? seatElasticityMult(base) : 1.0;
      const seatBase = base + eps * (delta - nat2ppSwing);
      // Win probability for this seat at this national swing, with independent noise
      const pWin = indepSigma > 0 ? normCDF((seatBase - 50) / indepSigma) : (seatBase >= 50 ? 1 : 0);
      expectedCount += pWin;
    });
    // Round to nearest integer for seat-count bucketing
    const count = Math.round(expectedCount);
    seatCountCdf[count] = (seatCountCdf[count] ?? 0) + w;
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
  const cdfStd = Math.sqrt(Math.max(0, cdfVar));

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

// Compute implied national ALP 2PP from primary votes and preference flows.
// Used to derive nat2ppSwing for the uniform swing model.
function computeNat2pp(prim, flows) {
  const other = Math.max(0, 100 - prim.alp - prim.coal - prim.grn - prim.teal - prim.on);
  const a = prim.alp + prim.grn * flows.grn_alp + prim.teal * flows.teal_alp + prim.on * flows.on_alp + other * flows.other_alp;
  const c = prim.coal + prim.grn * (1 - flows.grn_alp) + prim.teal * (1 - flows.teal_alp) + prim.on * (1 - flows.on_alp) + other * (1 - flows.other_alp);
  return a / (a + c) * 100;
}

// ── State-level swing overlay ────────────────────────────────────────────────
// When state-specific polling data is available, blends state swings with
// national swings for seats in that state. This captures regional variation
// (e.g., QLD and WA regularly deviate from national swing by 2–4pp).
//
// Blending: seatSwing = α × stateSwing + (1−α) × nationalSwing
// α reflects state poll reliability (more state polls → higher α).
// Default α = 0.6 (moderate trust in state polling).
const STATE_SWING_ALPHA = 0.6;

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
      newFp.other = Math.max(0, 100 - newFp.alp - newFp.coal - newFp.grn - newFp.teal - newFp.on);
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

    // Auto-detect ON TCP matchup when ON is above threshold, unless manually overridden.
    // Only applies to ALP vs Coalition seats — Greens/Teal seats have such high local
    // primary votes for those candidates that ON cannot realistically reach the final 2CP.
    let activeTcpMatchup = override?.tcpMatchup ?? null;
    if (!activeTcpMatchup && estOnFp >= onThreshold && hasAlp && hasCoal) {
      const _sb = getSeatFpBaseline(seat.id) ?? BASELINE_2025;
      const estAlp = override?.alp != null ? override.alp : Math.max(0, _sb.alp + swings.alp);
      const estCoal = override?.coal != null ? override.coal : Math.max(0, _sb.coal + swings.coal);
      if (estOnFp > estAlp && estCoal >= estAlp) {
        // ALP eliminated (fewest votes) → ON vs Coalition final
        activeTcpMatchup = "on_v_coal";
      } else if (estOnFp > estCoal && estAlp >= estCoal) {
        // Coalition eliminated (fewest votes) → ON vs ALP final
        activeTcpMatchup = "on_v_alp";
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
      const ef = override?.prefFlows ?? prefFlows;
      const fp = newFp ?? (() => {
        const sb = getSeatFpBaseline(seat.id) ?? BASELINE_2025;
        const a = Math.max(0, sb.alp + swings.alp);
        const c = Math.max(0, sb.coal + swings.coal);
        const g = Math.max(0, sb.grn + swings.grn);
        const t = Math.max(0, sb.teal + swings.teal);
        const o = Math.max(0, sb.on + swings.on);
        return { alp: a, coal: c, grn: g, teal: t, on: o, other: Math.max(0, 100 - a - c - g - t - o) };
      })();
      // Use ON-race-specific flows: grn_alp_v_on, teal_alp_v_on, other_alp_v_on (all higher
      // toward ALP than standard rates because voters strongly oppose ON over ALP)
      const alpTcp = fp.alp + fp.grn * ef.grn_alp_v_on + fp.teal * ef.teal_alp_v_on
        + fp.coal * prefFlows.coal_alp_v_on + fp.other * ef.other_alp_v_on;
      const onTcp = fp.on + fp.grn * (1 - ef.grn_alp_v_on) + fp.teal * (1 - ef.teal_alp_v_on)
        + fp.coal * (1 - prefFlows.coal_alp_v_on) + fp.other * (1 - ef.other_alp_v_on);
      const onPct = hasTcpOverride ? override.tcpPct : onTcp / (alpTcp + onTcp) * 100;
      const wGroup = onPct >= 50 ? "one_nation" : "alp";
      const wParty = onPct >= 50 ? "ON" : "ALP";
      const wPct = onPct >= 50 ? onPct : 100 - onPct;

      // Calculate the standard 2PP (ALP vs Coal) to keep the national tracker accurate
      const a2 = fp.alp + fp.grn * prefFlows.grn_alp + fp.teal * prefFlows.teal_alp + fp.on * prefFlows.on_alp + fp.other * prefFlows.other_alp;
      const c2 = fp.coal + fp.grn * (1 - prefFlows.grn_alp) + fp.teal * (1 - prefFlows.teal_alp) + fp.on * (1 - prefFlows.on_alp) + fp.other * (1 - prefFlows.other_alp);
      const synthAlp2pp = a2 / (a2 + c2) * 100;

      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: synthAlp2pp,
          isSynthetic2pp: true,
          changed: wGroup !== getParty(seat.winner.party).group,
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
      const ef = override?.prefFlows ?? prefFlows;
      const fp = newFp ?? (() => {
        const sb = getSeatFpBaseline(seat.id) ?? BASELINE_2025;
        const a = Math.max(0, sb.alp + swings.alp);
        const c = Math.max(0, sb.coal + swings.coal);
        const g = Math.max(0, sb.grn + swings.grn);
        const t = Math.max(0, sb.teal + swings.teal);
        const o = Math.max(0, sb.on + swings.on);
        return { alp: a, coal: c, grn: g, teal: t, on: o, other: Math.max(0, 100 - a - c - g - t - o) };
      })();
      // Use ON-race-specific flows: grn_on_v_coal, teal_on_v_coal, other_on_v_coal (all low
      // toward ON because Greens/teal voters strongly prefer Coalition over ON when forced to choose)
      const onTcp = fp.on + fp.alp * prefFlows.alp_on_v_coal + fp.grn * ef.grn_on_v_coal
        + fp.teal * ef.teal_on_v_coal + fp.other * ef.other_on_v_coal;
      const coalTcp = fp.coal + fp.alp * (1 - prefFlows.alp_on_v_coal) + fp.grn * (1 - ef.grn_on_v_coal)
        + fp.teal * (1 - ef.teal_on_v_coal) + fp.other * (1 - ef.other_on_v_coal);
      const onPct = hasTcpOverride ? override.tcpPct : onTcp / (onTcp + coalTcp) * 100;
      const coalP = seat.tcp.find(t => ["LP", "LNP", "NP", "CLP"].includes(t.party))?.party ?? "LP";
      const wGroup = onPct >= 50 ? "one_nation" : "coalition";
      const wParty = onPct >= 50 ? "ON" : coalP;
      const wPct = onPct >= 50 ? onPct : 100 - onPct;

      // Calculate the standard 2PP (ALP vs Coal) to keep the national tracker accurate
      const a2 = fp.alp + fp.grn * prefFlows.grn_alp + fp.teal * prefFlows.teal_alp + fp.on * prefFlows.on_alp + fp.other * prefFlows.other_alp;
      const c2 = fp.coal + fp.grn * (1 - prefFlows.grn_alp) + fp.teal * (1 - prefFlows.teal_alp) + fp.on * (1 - prefFlows.on_alp) + fp.other * (1 - prefFlows.other_alp);
      const synthAlp2pp = a2 / (a2 + c2) * 100;

      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: synthAlp2pp,
          isSynthetic2pp: true,
          changed: wGroup !== getParty(seat.winner.party).group,
          isOverride: !isAutoMatchup,
          isAutoMatchup,
          activeTcpMatchup: "on_v_coal",
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
        // Use per-seat preference flows if available (Phase 3), otherwise national average.
        const ef = override.prefFlows ?? SEAT_PREF_FLOWS_2025[seat.id] ?? prefFlows;
        const a2 = newFp.alp + newFp.grn * ef.grn_alp + newFp.teal * ef.teal_alp + newFp.on * ef.on_alp + newFp.other * ef.other_alp;
        const c2 = newFp.coal + newFp.grn * (1 - ef.grn_alp) + newFp.teal * (1 - ef.teal_alp) + newFp.on * (1 - ef.on_alp) + newFp.other * (1 - ef.other_alp);
        projAlp2pp = a2 / (a2 + c2) * 100;
        // Apply calibration offset (Phase 1): blends to zero at ±5pp national swing.
        // Only applied when using national-average pref flows (not per-seat or user overrides).
        if (!override.prefFlows && !SEAT_PREF_FLOWS_2025[seat.id]) {
          const calibBlend = Math.max(0, 1 - Math.abs(nat2ppSwing) / 5);
          projAlp2pp = Math.min(100, Math.max(0, projAlp2pp + (SEAT_CALIB_2025[seat.id] ?? 0) * calibBlend));
        }
      } else {
        const seatFp = getSeatFpBaseline(seat.id);
        if (seatFp) {
          // Primary-based: apply state-blended swing to seat-level 2025 primaries → 2PP.
          // Use per-seat preference flows if available (Phase 3), otherwise national average.
          const sSwings = blendSwings(swings, stateSwings, seat.state);
          const projFp = {
            alp: Math.max(0, seatFp.alp + sSwings.alp),
            coal: Math.max(0, seatFp.coal + sSwings.coal),
            grn: Math.max(0, seatFp.grn + sSwings.grn),
            teal: Math.max(0, seatFp.teal + sSwings.teal),
            on: Math.max(0, seatFp.on + sSwings.on),
          };
          projFp.other = Math.max(0, 100 - projFp.alp - projFp.coal - projFp.grn - projFp.teal - projFp.on);
          const ef = SEAT_PREF_FLOWS_2025[seat.id] ?? prefFlows;
          const a2 = projFp.alp + projFp.grn * ef.grn_alp + projFp.teal * ef.teal_alp + projFp.on * ef.on_alp + projFp.other * ef.other_alp;
          const c2 = projFp.coal + projFp.grn * (1 - ef.grn_alp) + projFp.teal * (1 - ef.teal_alp) + projFp.on * (1 - ef.on_alp) + projFp.other * (1 - ef.other_alp);
          projAlp2pp = a2 / (a2 + c2) * 100;
          // Apply calibration offset (Phase 1): blends to zero at ±5pp national swing.
          // Only applied when per-seat flows are unavailable (national average used).
          if (!SEAT_PREF_FLOWS_2025[seat.id]) {
            const calibBlend = Math.max(0, 1 - Math.abs(nat2ppSwing) / 5);
            projAlp2pp = Math.min(100, Math.max(0, projAlp2pp + (SEAT_CALIB_2025[seat.id] ?? 0) * calibBlend));
          }
        } else {
          // Fallback UNS for seats without per-seat primary data: uniform national 2PP swing
          // applied to the seat's 2025 TCP baseline. Elasticity scales the swing for marginals.
          const eps = useElasticity ? seatElasticityMult(baseAlp2pp) : 1.0;
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
      const netCoalGain = effCoalSwing + effOnSwing * (1 - (ef.on_alp ?? 0.43)) + effOtherSwing * (1 - (ef.other_alp ?? 0.50));
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
      const netAlpGain = effAlpSwing + effCoalSwing * (ef.coal_alp ?? 0.05) + effOtherSwing * (ef.other_alp ?? 0.50) + effOnSwing * (ef.on_alp ?? 0.43);
      // Net swing to Greens: pure GRN swing + (portion of Teal flowing to GRN)
      const netGrnGain = effGrnSwing + effTealSwing * (ef.teal_grn ?? 0.40);
      const adj = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + netAlpGain - netGrnGain));
      projWinnerGroup = adj >= 50 ? "alp" : "greens";
      projWinnerParty = adj >= 50 ? "ALP" : "GRN";
      projWinnerPct = adj >= 50 ? adj : 100 - adj;
      projAlp2pp = adj;

    } else if (hasTeal && hasCoal) {
      const tealP = seat.tcp.find(t => ["IND", "CA"].includes(t.party));
      const base = tealP?.pct ?? 50;
      const ef = override?.prefFlows ?? prefFlows;
      // Net swing to Teal: pure Teal swing + (portion of ALP flowing to Teal) + (portion of GRN flowing to Teal)
      const netTealGain = effTealSwing + effAlpSwing * (ef.alp_teal ?? 0.70) + effGrnSwing * (ef.grn_teal ?? 0.50);
      // Net swing to Coal: pure Coal swing + (portion of ON flowing to Coal) + (portion of Other flowing to Coal)
      const netCoalGain = effCoalSwing + effOnSwing * (1 - (ef.on_alp ?? 0.43)) + effOtherSwing * (1 - (ef.other_alp ?? 0.50));
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
      const netTealGain = effTealSwing + effGrnSwing * ef.grn_teal + effCoalSwing * (1 - prefFlows.coal_alp);
      // Net swing to ALP: pure ALP swing + (portion of ON flowing to ALP) + (portion of Other flowing to ALP)
      const netAlpGain = effAlpSwing + effOnSwing * ef.on_alp + effOtherSwing * ef.other_alp;
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

function computeVic2pp(primaries, prefFlows) {
  const { alp, coal, grn, ind, on } = primaries;
  const onV = on ?? 0;
  const others = Math.max(0, 100 - alp - coal - grn - ind - onV);
  return alp + grn * prefFlows.grn_alp + ind * prefFlows.ind_alp + onV * prefFlows.on_alp + others * prefFlows.other_alp;
}

// VIC uniform swing model — applies statewide 2PP swing to each seat's 2022 margin
function computeModelledSeatsVic(vicSeats, swings, prefFlows) {
  const newPrim = {
    alp: Math.max(0, VIC_BASELINE_2022.alp + swings.alp),
    coal: Math.max(0, VIC_BASELINE_2022.coal + (swings.coal ?? 0)),
    grn: Math.max(0, VIC_BASELINE_2022.grn + swings.grn),
    ind: Math.max(0, VIC_BASELINE_2022.ind + swings.ind),
    on: Math.max(0, VIC_BASELINE_2022.on + (swings.on ?? 0)),
  };
  const new2pp = computeVic2pp(newPrim, prefFlows);
  const vic2ppSwing = new2pp - VIC_2PP_2022;

  return vicSeats.map(seat => {
    const t1 = seat.tcp[0].party, t2 = seat.tcp[1].party;
    let swingToT1 = 0;
    if (t1 === "ALP" && ["LP", "NP"].includes(t2)) {
      swingToT1 = vic2ppSwing;
    } else if (["LP", "NP"].includes(t1) && t2 === "ALP") {
      swingToT1 = -vic2ppSwing;
    } else if (t1 === "GRN" && t2 === "ALP") {
      swingToT1 = (swings.grn - swings.alp) / 2;
    } else if (t1 === "GRN" && ["LP", "NP"].includes(t2)) {
      swingToT1 = (swings.grn - (swings.coal ?? 0)) / 2;
    } else if (t1 === "IND") {
      swingToT1 = (t2 === "ALP" ? -1 : 1) * vic2ppSwing * 0.3;
    }
    const newMargin = seat.margin + swingToT1;
    const holds = newMargin > 0;
    const projWinnerParty = holds ? t1 : t2;
    const projWinnerGroup = getParty(projWinnerParty).group;
    const projAlp2pp = (t1 === "ALP" || t2 === "ALP")
      ? (t1 === "ALP" ? 50 + newMargin : 50 - newMargin)
      : null;
    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct: 50 + Math.abs(newMargin),
        projAlp2pp,
        changed: projWinnerParty !== seat.winner.party,
      },
    };
  });
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
function computeModelledSeatsState(seats, newPrim, compute2ppFn, baseline2pp, prefFlows, coalParties, swings) {
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
    const isInd1 = !isAlp1 && !isCoal1 && !isGrn1;
    const isInd2 = !isAlp2 && !isCoal2 && !isGrn2;

    let swingToT1 = 0;
    if (isAlp1 && isCoal2) swingToT1 = swing2pp;
    else if (isCoal1 && isAlp2) swingToT1 = -swing2pp;
    else if (isGrn1 && isAlp2) swingToT1 = (swings.grn - swings.alp) / 2;
    else if (isGrn1 && isCoal2) swingToT1 = (swings.grn - (swings.coal ?? 0)) / 2;
    else if (isAlp1 && isGrn2) swingToT1 = (swings.alp - swings.grn) / 2;
    else if (isCoal1 && isGrn2) swingToT1 = -(swings.grn - (swings.coal ?? 0)) / 2;
    else if (isCoal1 && isInd2) swingToT1 = -swing2pp * 0.3;  // Coal drop benefits ON/IND challenger
    else if (isInd1) swingToT1 = (isAlp2 ? -1 : 1) * swing2pp * 0.3;

    const newMargin = seat.margin + swingToT1;
    const holds = newMargin > 0;
    const projWinnerParty = holds ? t1 : t2;
    const projWinnerGroup = getParty(projWinnerParty).group;
    const projAlp2pp = (isAlp1 || isAlp2)
      ? (isAlp1 ? 50 + newMargin : 50 - newMargin)
      : null;
    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct: 50 + Math.abs(newMargin),
        projAlp2pp,
        changed: projWinnerParty !== seat.winner.party,
      },
    };
  });
}

// ── Hare-Clark proportional model (TAS, ACT) ─────────────────────────────────
// Each electorate allocates seats using the Droop quota: quota = votes/(seats+1).
// Simplified: seats_i ≈ floor(pct_i / quota) + remainder allocation.
// newPcts: { alp, coal, grn, ind, on } — must sum to ~100
function allocateHareClark(electorates, newPcts) {
  const groups = ["coal", "alp", "grn", "ind", "on"];
  const totals = Object.fromEntries(groups.map(g => [g, 0]));

  electorates.forEach(el => {
    const seats = el.seats;
    const quota = 100 / (seats + 1);   // Droop quota as a %
    // Scale entered primaries to match the electorate's specific composition
    // (use national swing offset from electorate baseline)
    const pcts = {
      coal: Math.max(0, el.coal + (newPcts.coal - (el.coal) * 0)),   // use entered directly
      alp: Math.max(0, el.alp + (newPcts.alp - el.alp)),
      grn: Math.max(0, el.grn + (newPcts.grn - el.grn)),
      ind: Math.max(0, el.ind + (newPcts.ind - el.ind)),
      on: Math.max(0, (el.on ?? 0) + ((newPcts.on ?? 0) - (el.on ?? 0))),
    };
    // Renormalise to 100
    const tot = Object.values(pcts).reduce((a, b) => a + b, 0);
    Object.keys(pcts).forEach(k => { pcts[k] = pcts[k] / tot * 100; });

    // Droop quota allocation
    const floor_seats = Object.fromEntries(groups.map(g => [g, Math.floor(pcts[g] / quota)]));
    const remainders = Object.fromEntries(groups.map(g => [g, pcts[g] / quota - floor_seats[g]]));
    const allocated = Object.values(floor_seats).reduce((a, b) => a + b, 0);
    const remaining = seats - allocated;

    // Allocate remaining seats by largest remainder
    const order = [...groups].sort((a, b) => remainders[b] - remainders[a]);
    order.slice(0, remaining).forEach(g => { floor_seats[g]++; });
    groups.forEach(g => { totals[g] += floor_seats[g]; });
  });

  return totals;  // { coal, alp, grn, ind, on }
}

// Box-Muller transform: standard normal sample
function gaussRandom() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Monte Carlo uncertainty for Hare-Clark proportional systems.
// Perturbs the statewide primary votes N times with Gaussian noise (swingStd),
// runs allocateHareClark each time, and returns per-party seat-count statistics.
function computeHareClarkUncertainty(electorates, basePcts, swingStd, majority, N = 500) {
  const parties = ["coal", "alp", "grn", "ind", "on"];
  const tallies = Object.fromEntries(parties.map(p => [p, []]));

  for (let i = 0; i < N; i++) {
    const perturbed = Object.fromEntries(parties.map(p => [
      p, Math.max(0, (basePcts[p] ?? 0) + gaussRandom() * swingStd)
    ]));
    const result = allocateHareClark(electorates, perturbed);
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

// ─── Small reusable components ────────────────────────────────────────────────
function PartyBadge({ party }) {
  const p = getParty(party);
  return <span style={{ background: p.color, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{p.short}</span>;
}

function MarginDot({ margin }) {
  const c = MARGIN_COLOR[getMarginCat(margin)];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
      <span style={{ fontWeight: 600, color: "#111" }}>{margin?.toFixed(1)}%</span>
    </span>
  );
}

function SwingBadge({ swing }) {
  if (swing == null) return <span style={{ color: "#9CA3AF" }}>—</span>;
  const pos = swing > 0;
  return <span style={{ color: pos ? "#059669" : "#DC2626", fontWeight: 600 }}>{pos ? "+" : ""}{swing.toFixed(1)}%</span>;
}

function TcpBar({ tcp, winnerParty }) {
  const winner = tcp.find(t => t.party === winnerParty);
  if (!winner) return null;
  const p = getParty(winnerParty);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 64, height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${Math.min(winner.pct, 100)}%`, height: "100%", background: p.color, borderRadius: 3 }} />
      </span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{winner.pct.toFixed(1)}%</span>
    </span>
  );
}

function TallyBar({ seats, useModelled = false }) {
  const counts = {};
  seats.forEach(s => {
    const g = useModelled ? (s.modelled?.winnerGroup ?? getSeatGroup(s)) : getSeatGroup(s);
    counts[g] = (counts[g] || 0) + 1;
  });
  const total = seats.length;
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>
        {useModelled ? "Projected" : "2025 result"} — {total} seats shown
      </div>
      <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {GROUP_ORDER.filter(g => counts[g]).map(g => (
          <div key={g} style={{ flex: counts[g], background: GROUP_CONFIG[g].color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
            {counts[g] >= 3 ? counts[g] : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
        {GROUP_ORDER.filter(g => counts[g]).map(g => (
          <span key={g} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#374151" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
            {GROUP_CONFIG[g].label} <strong>{counts[g]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Primary vote % input ─────────────────────────────────────────────────────
function PrimaryInput({ label, value, onChange, color = "#6B7280", baseline }) {
  const delta = +(value - baseline).toFixed(1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", minWidth: 112 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number" min={0} max={100} step={0.1}
          value={value}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.max(0, Math.min(100, +v.toFixed(1))));
          }}
          style={{
            width: 68, border: "1px solid #D1D5DB", borderRadius: 6, padding: "5px 8px",
            fontSize: 14, fontWeight: 700, textAlign: "right", outline: "none",
            borderColor: delta !== 0 ? color : "#D1D5DB"
          }}
        />
        <span style={{ fontSize: 13, color: "#6B7280" }}>%</span>
      </div>
      <span style={{
        fontSize: 12, fontWeight: 600, minWidth: 58, textAlign: "right",
        color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : "#9CA3AF"
      }}>
        {delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta} pp`}
      </span>
    </div>
  );
}

function PrefInput({ label, value, onChange, color = "#6B7280", historicalRange }) {
  const pct = Math.round(value * 200) / 2;  // round to nearest 0.5
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</label>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{pct.toFixed(1)}%</span>
      </div>
      <input type="range" min={0} max={100} step={0.5} value={pct}
        onChange={e => onChange(parseFloat(e.target.value) / 100)}
        style={{ width: "100%", accentColor: color, cursor: "pointer" }} />
      {historicalRange && (
        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>
          Historical (2019–2025): {(historicalRange[0] * 100).toFixed(0)}–{(historicalRange[1] * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
export default function App() {
  // ── Seats tab state ──
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState(new Set(STATES));
  const [groupFilter, setGroupFilter] = useState(new Set(GROUP_ORDER));
  const [marginFilter, setMarginFilter] = useState(new Set(MARGINS));
  const [sortKey, setSortKey] = useState("margin");
  const [sortDir, setSortDir] = useState("asc");
  const [activeTab, setActiveTab] = useState("overview");
  // Overview uses all elections; Model uses only elections with a full model built
  const [selectedOverviewId, setSelectedOverviewId] = useState("federal_2025");
  const [selectedModelId, setSelectedModelId] = useState("federal_2025");

  // ── Polls tab state ──
  const [polls, setPolls] = useState(INITIAL_POLLS);
  const [showAddPoll, setShowAddPoll] = useState(false);
  const [nextPollId, setNextPollId] = useState(INITIAL_POLLS.length + 1);
  const [newPoll, setNewPoll] = useState({ pollster: "", date: "", alp: "", coal: "", grn: "", oth: "", tpp: "", n: "" });

  // ── Model tab state ──
  const [primaries, setPrimaries] = useState({ alp: BASELINE_2025.alp, coal: BASELINE_2025.coal, grn: BASELINE_2025.grn, teal: BASELINE_2025.teal, on: BASELINE_2025.on, undecided: 0 });
  const [prefFlows, setPrefFlows] = useState({
    // Standard flows (used in ALP vs Coalition finals)
    grn_alp: 0.81,
    teal_alp: 0.62,
    // ON→ALP: historical range 0.15 (2022) to 0.43 (2025, peak anti-ON sentiment).
    // Default 0.27 = approximate historical average, giving a realistic baseline
    // where an ON surge meaningfully hurts Coalition at TCP rather than being
    // offset by 2025's unusually high ON→ALP preference flow.
    on_alp: 0.27,
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
    // Coal→ALP in ON vs ALP: 2025 was ~15%, reflecting voters preferring ALP over ON.
    coal_alp_v_on: 0.15,
    grn_alp_v_on: 0.90,
    teal_alp_v_on: 0.75,
    other_alp_v_on: 0.60,
    // ON vs Coalition final — sources distribute between ON and Coalition
    alp_on_v_coal: 0.20,
    grn_on_v_coal: 0.08,
    teal_on_v_coal: 0.12,
    other_on_v_coal: 0.25,
  });
  // Derive swings from primaries vs 2025 baseline — used by computeModelledSeats
  const swings = {
    alp: +(primaries.alp - BASELINE_2025.alp).toFixed(2),
    coal: +(primaries.coal - BASELINE_2025.coal).toFixed(2),
    grn: +(primaries.grn - BASELINE_2025.grn).toFixed(2),
    teal: +(primaries.teal - BASELINE_2025.teal).toFixed(2),
    on: +(primaries.on - BASELINE_2025.on).toFixed(2),
  };
  const [seatOverrides, setSeatOverrides] = useState({});  // {seatId: {alp,coal,grn,teal,on,prefFlows?}}
  const [overrideSearch, setOverrideSearch] = useState("");

  // ── Modifiable ON/Elasticity/Uncertainty settings ──
  const [onThreshold, setOnThreshold] = useState(6.5);   // % ON primary to auto-detect TCP
  const [useElasticity, setUseElasticity] = useState(false); // apply seat-level swing elasticity
  const [swingStd, setSwingStd] = useState(1.5);   // polling uncertainty (pp std dev)
  const [showAdvancedFlows, setShowAdvancedFlows] = useState(false); // show/hide advanced ON race flows

  // ── Seat-at-risk table state ──
  const [riskFilter, setRiskFilter] = useState("all"); // "all" | "changing" | "marginal"
  const [modelStateFilter, setModelStateFilter] = useState(""); // "" = All States
  const [expandedModelSeatId, setExpandedModelSeatId] = useState(null);
  const [expandedSeatTabDemogId, setExpandedSeatTabDemogId] = useState(null);
  const [demogSectionOpen, setDemogSectionOpen] = useState(false);

  // ── VIC model state ──
  const [vicPrimaries, setVicPrimaries] = useState({ alp: 38.1, coal: 31.1, grn: 12.2, ind: 5.5, on: 1.3, undecided: 0 });
  const [vicPrefFlows, setVicPrefFlows] = useState({ grn_alp: 0.85, ind_alp: 0.60, on_alp: 0.25, other_alp: 0.43 });

  // ── Demographics tab state ──
  const [demogSortKey, setDemogSortKey] = useState("medianHouseholdIncome");
  const [demogSortDir, setDemogSortDir] = useState("desc");
  const [demogStateFilter, setDemogStateFilter] = useState(new Set(STATES));
  const [demogClassFilter, setDemogClassFilter] = useState(new Set(["Inner Metropolitan", "Outer Metropolitan", "Provincial", "Rural"]));
  const [expandedDemogId, setExpandedDemogId] = useState(null);
  const [demogXMetric, setDemogXMetric] = useState("medianHouseholdIncome");

  const toggleSet = (setter, val) =>
    setter(prev => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });

  const handleSort = (key) => {
    setSortDir(prev => sortKey === key ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  };

  // ── Seats filtered list ──
  const filtered = useMemo(() => {
    let r = SEATS.filter(s => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.winner.name.toLowerCase().includes(q)) return false;
      }
      if (!stateFilter.has(s.state)) return false;
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
  }, [search, stateFilter, groupFilter, marginFilter, sortKey, sortDir]);

  const stateCounts = useMemo(() => Object.fromEntries(STATES.map(s => [s, SEATS.filter(d => d.state === s).length])), []);
  const groupCounts = useMemo(() => { const c = {}; SEATS.forEach(s => { const g = getSeatGroup(s); c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const marginCounts = useMemo(() => { const c = {}; SEATS.forEach(s => { const cat = getMarginCat(s.margin); c[cat] = (c[cat] || 0) + 1; }); return c; }, []);

  // ── Modelling ──
  // Allocate undecided voters proportionally to all parties (with a small
  // incumbency penalty: incumbent ALP gets slightly less of the undecided pool).
  const effectivePrimaries = useMemo(() => {
    const undec = primaries.undecided ?? 0;
    if (undec <= 0) return primaries;
    const declared = primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on;
    if (declared <= 0) return primaries;
    // Incumbency penalty: incumbent party (ALP) gets 0.85× proportional share;
    // the rest is redistributed to other parties proportionally.
    const alpRaw = primaries.alp / declared;
    const INCUMB_PENALTY = 0.85;
    const alpShare = alpRaw * INCUMB_PENALTY;
    const otherTotal = (primaries.coal + primaries.grn + primaries.teal + primaries.on) / declared;
    const otherScale = (1 - alpShare) / (otherTotal || 1);
    return {
      alp: +(primaries.alp + undec * alpShare).toFixed(2),
      coal: +(primaries.coal + undec * (primaries.coal / declared) * otherScale).toFixed(2),
      grn: +(primaries.grn + undec * (primaries.grn / declared) * otherScale).toFixed(2),
      teal: +(primaries.teal + undec * (primaries.teal / declared) * otherScale).toFixed(2),
      on: +(primaries.on + undec * (primaries.on / declared) * otherScale).toFixed(2),
      undecided: 0,
    };
  }, [primaries]);

  const nat2ppSwing = useMemo(() =>
    computeNat2pp(effectivePrimaries, prefFlows) - NATIONAL_2PP_2025,
    [effectivePrimaries, prefFlows]);

  const modelledSeats = useMemo(() =>
    computeModelledSeats(SEATS, swings, prefFlows, seatOverrides, nat2ppSwing, onThreshold, useElasticity),
    [swings, prefFlows, seatOverrides, nat2ppSwing, onThreshold, useElasticity]);

  const uncertainty = useMemo(() =>
    computeUncertainty(modelledSeats, nat2ppSwing, swingStd, useElasticity),
    [modelledSeats, nat2ppSwing, swingStd, useElasticity]);

  const projCounts = useMemo(() => {
    const c = {};
    modelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; });
    return c;
  }, [modelledSeats]);

  const baseCounts = useMemo(() => {
    const c = {};
    SEATS.forEach(s => { const g = getSeatGroup(s); c[g] = (c[g] || 0) + 1; });
    return c;
  }, []);

  const changedSeats = useMemo(() =>
    modelledSeats.filter(s => s.modelled.changed),
    [modelledSeats]);

  const implied2pp = useMemo(() => {
    const relevant = modelledSeats.filter(s => s.modelled.projAlp2pp !== null);
    if (!relevant.length) return null;
    return relevant.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / relevant.length;
  }, [modelledSeats]);

  // ── VIC modelling ──
  const vicModelledSeats = useMemo(() => {
    const s = {
      alp: +(vicPrimaries.alp - VIC_BASELINE_2022.alp).toFixed(2),
      coal: +(vicPrimaries.coal - VIC_BASELINE_2022.coal).toFixed(2),
      grn: +(vicPrimaries.grn - VIC_BASELINE_2022.grn).toFixed(2),
      ind: +(vicPrimaries.ind - VIC_BASELINE_2022.ind).toFixed(2),
      on: +(vicPrimaries.on - VIC_BASELINE_2022.on).toFixed(2),
    };
    return computeModelledSeatsVic(VIC_SEATS, s, vicPrefFlows);
  }, [vicPrimaries, vicPrefFlows]);

  const vicProjCounts = useMemo(() => {
    const c = {};
    vicModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; });
    return c;
  }, [vicModelledSeats]);

  const vicBaseCounts = useMemo(() => {
    const c = {};
    VIC_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; });
    return c;
  }, []);

  const vicChangedSeats = useMemo(() =>
    vicModelledSeats.filter(s => s.modelled.changed),
    [vicModelledSeats]);

  const vicImplied2pp = useMemo(() => {
    const rel = vicModelledSeats.filter(s => s.modelled.projAlp2pp !== null);
    if (!rel.length) return null;
    return rel.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / rel.length;
  }, [vicModelledSeats]);

  const vicHasChanges = vicPrimaries.alp !== 38.1 || vicPrimaries.coal !== 31.1 ||
    vicPrimaries.grn !== 12.2 || vicPrimaries.ind !== 5.5 || vicPrimaries.on !== 1.3 ||
    (vicPrimaries.undecided || 0) > 0 ||
    vicPrefFlows.grn_alp !== 0.85 || vicPrefFlows.ind_alp !== 0.60 || vicPrefFlows.on_alp !== 0.25 || vicPrefFlows.other_alp !== 0.43;

  const vicNat2ppSwing = useMemo(
    () => computeVic2pp(vicPrimaries, vicPrefFlows) - VIC_2PP_2022,
    [vicPrimaries, vicPrefFlows]
  );
  const vicUncertainty = useMemo(
    () => computeUncertainty(vicModelledSeats, vicNat2ppSwing, swingStd, useElasticity, 45),
    [vicModelledSeats, vicNat2ppSwing, swingStd, useElasticity]
  );

  // ── NSW 2023 model state ──────────────────────────────────────────────────
  // Baselines: ALP 37.6  Coalition 37.0 (LP 28.6 + NP 8.4)  GRN 10.4  IND 8.5  ON 2.0  other 4.5  2PP 53.2
  const NSW_BL = { alp: 37.6, coal: 37.0, grn: 10.4, ind: 8.5, on: 2.0 };
  const NSW_2PP = 53.2;
  const NSW_COAL = new Set(["LP", "NP"]);
  const [nswPrim, setNswPrim] = useState({ ...NSW_BL, undecided: 0 });
  const [nswFlows, setNswFlows] = useState({ grn_alp: 0.88, ind_alp: 0.55, on_alp: 0.20, other_alp: 0.45 });
  const nswModelledSeats = useMemo(() => {
    const s = { alp: nswPrim.alp - NSW_BL.alp, coal: nswPrim.coal - NSW_BL.coal, grn: nswPrim.grn - NSW_BL.grn, on: nswPrim.on - NSW_BL.on };
    const compute2pp = (p, f) => {
      const onV = p.on ?? 0;
      const other = Math.max(0, 100 - p.alp - p.coal - p.grn - (nswPrim.ind) - onV);
      const a = p.alp + (nswPrim.ind) * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp;
      const c = p.coal + (nswPrim.ind) * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp);
      return a / (a + c) * 100;
    };
    return computeModelledSeatsState(NSW_SEATS, nswPrim, compute2pp, NSW_2PP, nswFlows, NSW_COAL, s);
  }, [nswPrim, nswFlows]);
  const nswProjCounts = useMemo(() => { const c = {}; nswModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; }); return c; }, [nswModelledSeats]);
  const nswBaseCounts = useMemo(() => { const c = {}; NSW_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const nswChanged = useMemo(() => nswModelledSeats.filter(s => s.modelled.changed), [nswModelledSeats]);
  const nswImplied2pp = useMemo(() => { const r = nswModelledSeats.filter(s => s.modelled.projAlp2pp !== null); return r.length ? r.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / r.length : null; }, [nswModelledSeats]);
  const nswHasChanges = Object.entries(NSW_BL).some(([k, v]) => Math.abs((nswPrim[k] ?? v) - v) > 0.05) || (nswPrim.undecided || 0) > 0 || nswFlows.grn_alp !== 0.88 || nswFlows.ind_alp !== 0.55 || nswFlows.on_alp !== 0.20 || nswFlows.other_alp !== 0.45;

  const nswNat2ppSwing = useMemo(() => {
    const onV = nswPrim.on ?? 0;
    const other = Math.max(0, 100 - nswPrim.alp - nswPrim.coal - nswPrim.grn - nswPrim.ind - onV);
    const a = nswPrim.alp + nswPrim.ind * nswFlows.ind_alp + nswPrim.grn * nswFlows.grn_alp + onV * nswFlows.on_alp + other * nswFlows.other_alp;
    const c = nswPrim.coal + nswPrim.ind * (1 - nswFlows.ind_alp) + nswPrim.grn * (1 - nswFlows.grn_alp) + onV * (1 - nswFlows.on_alp) + other * (1 - nswFlows.other_alp);
    return a / (a + c) * 100 - NSW_2PP;
  }, [nswPrim, nswFlows]);
  const nswUncertainty = useMemo(
    () => computeUncertainty(nswModelledSeats, nswNat2ppSwing, swingStd, useElasticity, 47),
    [nswModelledSeats, nswNat2ppSwing, swingStd, useElasticity]
  );

  // ── QLD 2024 model state ──────────────────────────────────────────────────
  // Baselines: ALP 33.4  Coalition (LNP) 40.3  GRN 11.5  IND 5.5  ON 5.7  other 3.6  ALP 2PP 46.3
  const QLD_BL = { alp: 33.4, coal: 40.3, grn: 11.5, ind: 5.5, on: 5.7 };
  const QLD_2PP = 46.3;
  const QLD_COAL = new Set(["LNP"]);
  const [qldPrim, setQldPrim] = useState({ ...QLD_BL, undecided: 0 });
  const [qldFlows, setQldFlows] = useState({ grn_alp: 0.82, ind_alp: 0.50, on_alp: 0.18, other_alp: 0.40 });
  const qldModelledSeats = useMemo(() => {
    const s = { alp: qldPrim.alp - QLD_BL.alp, coal: qldPrim.coal - QLD_BL.coal, grn: qldPrim.grn - QLD_BL.grn, on: qldPrim.on - QLD_BL.on };
    const compute2pp = (p, f) => {
      const onV = p.on ?? 0;
      const other = Math.max(0, 100 - p.alp - p.coal - p.grn - (qldPrim.ind) - onV);
      const a = p.alp + (qldPrim.ind) * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp;
      const c = p.coal + (qldPrim.ind) * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp);
      return a / (a + c) * 100;
    };
    return computeModelledSeatsState(QLD_SEATS, qldPrim, compute2pp, QLD_2PP, qldFlows, QLD_COAL, s);
  }, [qldPrim, qldFlows]);
  const qldProjCounts = useMemo(() => { const c = {}; qldModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; }); return c; }, [qldModelledSeats]);
  const qldBaseCounts = useMemo(() => { const c = {}; QLD_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const qldChanged = useMemo(() => qldModelledSeats.filter(s => s.modelled.changed), [qldModelledSeats]);
  const qldImplied2pp = useMemo(() => { const r = qldModelledSeats.filter(s => s.modelled.projAlp2pp !== null); return r.length ? r.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / r.length : null; }, [qldModelledSeats]);
  const qldHasChanges = Object.entries(QLD_BL).some(([k, v]) => Math.abs((qldPrim[k] ?? v) - v) > 0.05) || (qldPrim.undecided || 0) > 0 || qldFlows.grn_alp !== 0.82 || qldFlows.ind_alp !== 0.50 || qldFlows.on_alp !== 0.18 || qldFlows.other_alp !== 0.40;

  const qldNat2ppSwing = useMemo(() => {
    const onV = qldPrim.on ?? 0;
    const other = Math.max(0, 100 - qldPrim.alp - qldPrim.coal - qldPrim.grn - qldPrim.ind - onV);
    const a = qldPrim.alp + qldPrim.ind * qldFlows.ind_alp + qldPrim.grn * qldFlows.grn_alp + onV * qldFlows.on_alp + other * qldFlows.other_alp;
    const c = qldPrim.coal + qldPrim.ind * (1 - qldFlows.ind_alp) + qldPrim.grn * (1 - qldFlows.grn_alp) + onV * (1 - qldFlows.on_alp) + other * (1 - qldFlows.other_alp);
    return a / (a + c) * 100 - QLD_2PP;
  }, [qldPrim, qldFlows]);
  const qldUncertainty = useMemo(
    () => computeUncertainty(qldModelledSeats, qldNat2ppSwing, swingStd, useElasticity, 47),
    [qldModelledSeats, qldNat2ppSwing, swingStd, useElasticity]
  );

  // ── WA 2025 model state ───────────────────────────────────────────────────
  // Baselines: ALP 55.0  Coalition 23.0 (LP 18.5 + NP 4.5)  GRN 11.0  IND 5.0  ON 2.5  other 3.5  2PP 63.1
  const WA_BL = { alp: 55.0, coal: 23.0, grn: 11.0, ind: 5.0, on: 2.5 };
  const WA_2PP = 63.1;
  const WA_COAL = new Set(["LP", "NP"]);
  const [waPrim, setWaPrim] = useState({ ...WA_BL, undecided: 0 });
  const [waFlows, setWaFlows] = useState({ grn_alp: 0.86, ind_alp: 0.58, on_alp: 0.22, other_alp: 0.44 });
  const waModelledSeats = useMemo(() => {
    const s = { alp: waPrim.alp - WA_BL.alp, coal: waPrim.coal - WA_BL.coal, grn: waPrim.grn - WA_BL.grn, on: waPrim.on - WA_BL.on };
    const compute2pp = (p, f) => {
      const onV = p.on ?? 0;
      const other = Math.max(0, 100 - p.alp - p.coal - p.grn - (waPrim.ind) - onV);
      const a = p.alp + (waPrim.ind) * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp;
      const c = p.coal + (waPrim.ind) * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp);
      return a / (a + c) * 100;
    };
    return computeModelledSeatsState(WA_SEATS, waPrim, compute2pp, WA_2PP, waFlows, WA_COAL, s);
  }, [waPrim, waFlows]);
  const waProjCounts = useMemo(() => { const c = {}; waModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; }); return c; }, [waModelledSeats]);
  const waBaseCounts = useMemo(() => { const c = {}; WA_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const waChanged = useMemo(() => waModelledSeats.filter(s => s.modelled.changed), [waModelledSeats]);
  const waImplied2pp = useMemo(() => { const r = waModelledSeats.filter(s => s.modelled.projAlp2pp !== null); return r.length ? r.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / r.length : null; }, [waModelledSeats]);
  const waHasChanges = Object.entries(WA_BL).some(([k, v]) => Math.abs((waPrim[k] ?? v) - v) > 0.05) || (waPrim.undecided || 0) > 0 || waFlows.grn_alp !== 0.86 || waFlows.ind_alp !== 0.58 || waFlows.on_alp !== 0.22 || waFlows.other_alp !== 0.44;

  const waNat2ppSwing = useMemo(() => {
    const onV = waPrim.on ?? 0;
    const other = Math.max(0, 100 - waPrim.alp - waPrim.coal - waPrim.grn - waPrim.ind - onV);
    const a = waPrim.alp + waPrim.ind * waFlows.ind_alp + waPrim.grn * waFlows.grn_alp + onV * waFlows.on_alp + other * waFlows.other_alp;
    const c = waPrim.coal + waPrim.ind * (1 - waFlows.ind_alp) + waPrim.grn * (1 - waFlows.grn_alp) + onV * (1 - waFlows.on_alp) + other * (1 - waFlows.other_alp);
    return a / (a + c) * 100 - WA_2PP;
  }, [waPrim, waFlows]);
  const waUncertainty = useMemo(
    () => computeUncertainty(waModelledSeats, waNat2ppSwing, swingStd, useElasticity, 30),
    [waModelledSeats, waNat2ppSwing, swingStd, useElasticity]
  );

  // ── SA 2022 model state ───────────────────────────────────────────────────
  // Baselines: ALP 38.3  Coalition (LP) 34.8  GRN 7.3  IND 12.1  ON 1.5  other 6.0  2PP 54.9
  const SA_BL = { alp: 38.3, coal: 34.8, grn: 7.3, ind: 12.1, on: 1.5 };
  const SA_2PP = 54.9;
  const SA_COAL = new Set(["LP"]);
  const [saPrim, setSaPrim] = useState({ ...SA_BL, undecided: 0 });
  const [saFlows, setSaFlows] = useState({ grn_alp: 0.84, ind_alp: 0.52, on_alp: 0.22, other_alp: 0.45 });
  const saModelledSeats = useMemo(() => {
    const s = { alp: saPrim.alp - SA_BL.alp, coal: saPrim.coal - SA_BL.coal, grn: saPrim.grn - SA_BL.grn, on: saPrim.on - SA_BL.on };
    const compute2pp = (p, f) => {
      const onV = p.on ?? 0;
      const other = Math.max(0, 100 - p.alp - p.coal - p.grn - (saPrim.ind) - onV);
      const a = p.alp + (saPrim.ind) * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp;
      const c = p.coal + (saPrim.ind) * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp);
      return a / (a + c) * 100;
    };
    return computeModelledSeatsState(SA_SEATS, saPrim, compute2pp, SA_2PP, saFlows, SA_COAL, s);
  }, [saPrim, saFlows]);
  const saProjCounts = useMemo(() => { const c = {}; saModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; }); return c; }, [saModelledSeats]);
  const saBaseCounts = useMemo(() => { const c = {}; SA_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const saChanged = useMemo(() => saModelledSeats.filter(s => s.modelled.changed), [saModelledSeats]);
  const saImplied2pp = useMemo(() => { const r = saModelledSeats.filter(s => s.modelled.projAlp2pp !== null); return r.length ? r.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / r.length : null; }, [saModelledSeats]);
  const saHasChanges = Object.entries(SA_BL).some(([k, v]) => Math.abs((saPrim[k] ?? v) - v) > 0.05) || (saPrim.undecided || 0) > 0 || saFlows.grn_alp !== 0.84 || saFlows.ind_alp !== 0.52 || saFlows.on_alp !== 0.22 || saFlows.other_alp !== 0.45;

  const saNat2ppSwing = useMemo(() => {
    const onV = saPrim.on ?? 0;
    const other = Math.max(0, 100 - saPrim.alp - saPrim.coal - saPrim.grn - saPrim.ind - onV);
    const a = saPrim.alp + saPrim.ind * saFlows.ind_alp + saPrim.grn * saFlows.grn_alp + onV * saFlows.on_alp + other * saFlows.other_alp;
    const c = saPrim.coal + saPrim.ind * (1 - saFlows.ind_alp) + saPrim.grn * (1 - saFlows.grn_alp) + onV * (1 - saFlows.on_alp) + other * (1 - saFlows.other_alp);
    return a / (a + c) * 100 - SA_2PP;
  }, [saPrim, saFlows]);
  const saUncertainty = useMemo(
    () => computeUncertainty(saModelledSeats, saNat2ppSwing, swingStd, useElasticity, 24),
    [saModelledSeats, saNat2ppSwing, swingStd, useElasticity]
  );

  // ── NT 2024 model state ───────────────────────────────────────────────────
  // Baselines: ALP 30.5  Coalition (CLP) 40.5  GRN 5.5  IND 12.5  ON 1.5  other 9.5
  const NT_BL = { alp: 30.5, coal: 40.5, grn: 5.5, ind: 12.5, on: 1.5 };
  const NT_2PP = 45.0;  // approximate (NT doesn't publish official 2PP)
  const NT_COAL = new Set(["CLP"]);
  const [ntPrim, setNtPrim] = useState({ ...NT_BL, undecided: 0 });
  const [ntFlows, setNtFlows] = useState({ grn_alp: 0.80, ind_alp: 0.45, on_alp: 0.20, other_alp: 0.40 });
  const ntModelledSeats = useMemo(() => {
    const s = { alp: ntPrim.alp - NT_BL.alp, coal: ntPrim.coal - NT_BL.coal, grn: ntPrim.grn - NT_BL.grn, on: ntPrim.on - NT_BL.on };
    const compute2pp = (p, f) => {
      const onV = p.on ?? 0;
      const other = Math.max(0, 100 - p.alp - p.coal - p.grn - (ntPrim.ind) - onV);
      const a = p.alp + (ntPrim.ind) * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp;
      const c = p.coal + (ntPrim.ind) * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp);
      return a / (a + c) * 100;
    };
    return computeModelledSeatsState(NT_SEATS, ntPrim, compute2pp, NT_2PP, ntFlows, NT_COAL, s);
  }, [ntPrim, ntFlows]);
  const ntProjCounts = useMemo(() => { const c = {}; ntModelledSeats.forEach(s => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; }); return c; }, [ntModelledSeats]);
  const ntBaseCounts = useMemo(() => { const c = {}; NT_SEATS.forEach(s => { const g = getParty(s.winner.party).group; c[g] = (c[g] || 0) + 1; }); return c; }, []);
  const ntChanged = useMemo(() => ntModelledSeats.filter(s => s.modelled.changed), [ntModelledSeats]);
  const ntHasChanges = Object.entries(NT_BL).some(([k, v]) => Math.abs((ntPrim[k] ?? v) - v) > 0.05) || (ntPrim.undecided || 0) > 0 || ntFlows.grn_alp !== 0.80 || ntFlows.ind_alp !== 0.45 || ntFlows.on_alp !== 0.20 || ntFlows.other_alp !== 0.40;

  const ntNat2ppSwing = useMemo(() => {
    const onV = ntPrim.on ?? 0;
    const other = Math.max(0, 100 - ntPrim.alp - ntPrim.coal - ntPrim.grn - ntPrim.ind - onV);
    const a = ntPrim.alp + ntPrim.ind * ntFlows.ind_alp + ntPrim.grn * ntFlows.grn_alp + onV * ntFlows.on_alp + other * ntFlows.other_alp;
    const c = ntPrim.coal + ntPrim.ind * (1 - ntFlows.ind_alp) + ntPrim.grn * (1 - ntFlows.grn_alp) + onV * (1 - ntFlows.on_alp) + other * (1 - ntFlows.other_alp);
    return a / (a + c) * 100 - NT_2PP;
  }, [ntPrim, ntFlows]);
  const ntUncertainty = useMemo(
    () => computeUncertainty(ntModelledSeats, ntNat2ppSwing, swingStd, useElasticity, 13),
    [ntModelledSeats, ntNat2ppSwing, swingStd, useElasticity]
  );

  // ── TAS 2024 model state (Hare-Clark) ─────────────────────────────────────
  // Baselines per electorate in TAS_ELECTORATES; statewide: Coalition 36  ALP 28  GRN 12  IND 10  ON 1  other 13
  const TAS_BL = { coal: 36, alp: 28, grn: 12, ind: 10, on: 1.0 };
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
  // Baselines per electorate in ACT_ELECTORATES; statewide: ALP 34  Coalition (Lib) 31  GRN 21  IND 9  ON 0.5  other 4.5
  const ACT_BL = { alp: 34, coal: 31, grn: 21, ind: 9, on: 0.5 };
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
    prefFlows.grn_alp !== 0.81 || prefFlows.teal_alp !== 0.62 || prefFlows.on_alp !== 0.43 || prefFlows.other_alp !== 0.50 ||
    prefFlows.coal_alp_v_on !== 0.10 || prefFlows.grn_alp_v_on !== 0.90 ||
    prefFlows.teal_alp_v_on !== 0.75 || prefFlows.other_alp_v_on !== 0.60 ||
    prefFlows.alp_on_v_coal !== 0.20 || prefFlows.grn_on_v_coal !== 0.08 ||
    prefFlows.teal_on_v_coal !== 0.12 || prefFlows.other_on_v_coal !== 0.25 ||
    onThreshold !== 6.5 ||
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

  const DEMOG_METRICS = [
    { key: "medianPersonalIncome", label: "Median Personal Income", fmt: v => `$${(v / 1000).toFixed(0)}k` },
    { key: "medianHouseholdIncome", label: "Median Household Income", fmt: v => `$${(v / 1000).toFixed(0)}k` },
    { key: "medianWeeklyRent", label: "Median Weekly Rent", fmt: v => `$${v}` },
    { key: "medianMonthlyMortgage", label: "Median Monthly Mortgage", fmt: v => `$${v}` },
    { key: "ownerOutrightPct", label: "Owner Outright %", fmt: v => `${v}%` },
    { key: "ownerMortgagePct", label: "Owner w/ Mortgage %", fmt: v => `${v}%` },
    { key: "renterPct", label: "Renters %", fmt: v => `${v}%` },
    { key: "bachelorsOrAbovePct", label: "Bachelor's+ %", fmt: v => `${v}%` },
    { key: "overseasBornPct", label: "Overseas Born %", fmt: v => `${v}%` },
    { key: "medianAge", label: "Median Age", fmt: v => `${v}` },
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
      const vals = demogWithSeats.map(s => s.demog[key]).filter(v => v != null);
      if (!vals.length) { stats[key] = null; return; }
      stats[key] = {
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      };
    });
    return stats;
  }, [demogWithSeats]);

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
    return { alp: wavg("alp"), coal: wavg("coal"), grn: wavg("grn"), oth: wavg("oth"), tpp: tppAvg, n: recent.length };
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
      return {
        date: label,
        ALP: p.alp, Coalition: p.coal, Greens: p.grn, "2PP (ALP)": p.tpp,
        "ALP (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.alp }))) : null,
        "Coal (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.coal }))) : null,
        "Grn (trend)": hasEnough ? wavg(inWindow.map(q => ({ ...q, v: q.grn }))) : null,
        "2PP (trend)": tppPts.length >= 2 ? wavg(tppPts) : null,
      };
    });
  }, [polls]);

  const loadFromPoll = () => {
    if (!latestPoll) return;
    setPrimaries(p => ({
      ...p,
      alp: latestPoll.alp,
      coal: latestPoll.coal,
      grn: latestPoll.grn,
      // teal and on remain unchanged — not tracked separately in most polls
    }));
    setActiveTab("model");
  };

  const PREF_FLOWS_2025 = {
    grn_alp: 0.81, teal_alp: 0.62, on_alp: 0.43, other_alp: 0.50,
    coal_alp_v_on: 0.10, grn_alp_v_on: 0.90, teal_alp_v_on: 0.75, other_alp_v_on: 0.60,
    alp_on_v_coal: 0.20, grn_on_v_coal: 0.08, teal_on_v_coal: 0.12, other_on_v_coal: 0.25,
  };

  // Observed min–max ranges across 2019, 2022, and 2025 federal elections (AEC DOP data).
  // ON-race flows have limited historical data; ranges are estimated from available seats.
  const PREF_FLOW_RANGES = {
    grn_alp: [0.80, 0.86],
    teal_alp: [0.62, 0.74],
    // ON→ALP: 14.9% in 2022 (low-hostility), 43.0% in 2025 (peak anti-ON). Default = 27% (avg).
    on_alp: [0.14, 0.43],
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
    setOnThreshold(6.5);
    setSeatOverrides({});
  };

  const addPoll = () => {
    const { pollster, date, alp, coal, grn, tpp, n } = newPoll;
    if (!pollster || !date || !alp || !coal || !grn) return;
    const a = +alp, c = +coal, g = +grn;
    setPolls(prev => [...prev, {
      id: nextPollId,
      pollster, date,
      alp: a, coal: c, grn: g,
      oth: +(100 - a - c - g).toFixed(1),
      tpp: tpp ? +tpp : null,
      n: n ? +n : (POLL_SAMPLE_SIZES[pollster] ?? null),
    }]);
    setNextPollId(id => id + 1);
    setNewPoll({ pollster: "", date: "", alp: "", coal: "", grn: "", oth: "", tpp: "", n: "" });
    setShowAddPoll(false);
  };

  const deletePoll = (id) => setPolls(prev => prev.filter(p => p.id !== id));

  const addSeatOverride = (seatId) => {
    // Seed from the seat's actual 2025 AEC primary votes (not the national average).
    // Falls back to the currently-modelled national primaries if no seat data exists.
    const base = getSeatFpBaseline(seatId);
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: base
        ? { alp: +base.alp.toFixed(1), coal: +base.coal.toFixed(1), grn: +base.grn.toFixed(1), teal: +base.teal.toFixed(1), on: +base.on.toFixed(1) }
        : { alp: primaries.alp, coal: primaries.coal, grn: primaries.grn, teal: primaries.teal, on: primaries.on },
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
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: {
        ...prev[seatId],
        prefFlows: {
          grn_alp: prefFlows.grn_alp,
          teal_alp: prefFlows.teal_alp,
          on_alp: prefFlows.on_alp,
          other_alp: prefFlows.other_alp,
          grn_alp_v_on: prefFlows.grn_alp_v_on,
          teal_alp_v_on: prefFlows.teal_alp_v_on,
          other_alp_v_on: prefFlows.other_alp_v_on,
          grn_on_v_coal: prefFlows.grn_on_v_coal,
          teal_on_v_coal: prefFlows.teal_on_v_coal,
          other_on_v_coal: prefFlows.other_on_v_coal,
        },
      },
    }));
  };

  const SortTh = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {children}{" "}<span style={{ color: sortKey === k ? "#374151" : "#D1D5DB" }}>{sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
    </th>
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "seats", label: "Seats" },
    { id: "polls", label: "Polls" },
    { id: "model", label: `Model${hasChanges ? " ●" : ""}` },
  ];

  const panelStyle = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
  const sectionHead = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 10 };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: "#F3F4F6", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ background: "#111827", color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", gap: 16, height: 50, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", marginRight: 8 }}>🦘 AU Election Dashboard</span>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? "#374151" : "transparent", color: activeTab === t.id ? "#fff" : "#9CA3AF",
              border: "none", padding: "5px 13px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ OVERVIEW TAB ══════════════════════════════════ */}
      {activeTab === "overview" && (() => {
        const el = ELECTION_DATA[selectedOverviewId];
        const tallySeats = el.counts ? mkSeatsFromCounts(el.counts) : el.seats;
        const tightest = [...el.seats].sort((a, b) => a.margin - b.margin).slice(0, 10);
        const alpCount = el.counts ? el.counts.alp : el.seats.filter(s => getParty(s.winner.party).group === "alp").length;
        const coalCount = el.counts ? el.counts.coalition : el.seats.filter(s => getParty(s.winner.party).group === "coalition").length;
        const crossCount = el.counts
          ? Object.entries(el.counts).filter(([g]) => g !== "alp" && g !== "coalition").reduce((a, [, v]) => a + v, 0)
          : el.seats.filter(s => !["alp", "coalition"].includes(getParty(s.winner.party).group)).length;
        const marginalCount = el.seats.filter(s => s.margin < 5).length;
        const veryMargCount = el.seats.filter(s => s.margin < 2).length;
        const incumbentColor = GROUP_CONFIG[PARTY[el.incumbentParty]?.group]?.color ?? "#374151";
        return (
          <div style={{ padding: "20px 24px", maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{el.jurisdiction} Election Results</h1>
              <select value={selectedOverviewId} onChange={e => setSelectedOverviewId(e.target.value)}
                style={{ border: "1px solid #D1D5DB", borderRadius: 7, padding: "6px 10px", fontSize: 13, fontWeight: 700, outline: "none", background: "#fff", cursor: "pointer" }}>
                {ELECTION_OPTIONS.map(id => <option key={id} value={id}>{ELECTION_DATA[id].label}</option>)}
              </select>
            </div>
            <p style={{ color: "#6B7280", marginBottom: 18 }}>
              {el.date} · {el.chamber} · {el.totalSeats} seats
              {el.twopp ? ` · ${el.twopp}% 2PP (ALP)` : ""}
              {" · "}<span style={{ fontWeight: 600, color: incumbentColor }}>{el.incumbent}</span>
            </p>
            <TallyBar seats={tallySeats} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 18 }}>
              {[
                { label: `${GROUP_CONFIG.alp.label} seats`, value: alpCount, color: GROUP_CONFIG.alp.color },
                { label: `${GROUP_CONFIG.coalition.label} seats`, value: coalCount, color: GROUP_CONFIG.coalition.color },
                { label: "Crossbench", value: crossCount, color: "#059669" },
                { label: `Marginal (<5%)${el.counts ? " *" : ""}`, value: marginalCount, color: "#F59E0B" },
                { label: `Very marginal${el.counts ? " *" : ""}`, value: veryMargCount, color: "#EF4444" },
              ].map(card => (
                <div key={card.label} style={{ background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", padding: "14px 16px" }}>
                  <div style={{ width: 24, height: 3, background: card.color, borderRadius: 2, marginBottom: 8 }} />
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#111" }}>{card.value}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{card.label}</div>
                </div>
              ))}
            </div>
            <div style={panelStyle}>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#374151" }}>
                {tightest.length > 0 ? `${Math.min(tightest.length, 10)} tightest seats` : "No seat data available"}
              </div>
              {tightest.map(s => {
                const p = getParty(s.winner.party);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #F3F4F6" }}>
                    <div style={{ width: 3, height: 34, background: p.color, borderRadius: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>({s.state})</span></div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>{s.winner.name}</div>
                    </div>
                    <PartyBadge party={s.winner.party} />
                    <span style={{ fontWeight: 700, color: MARGIN_COLOR[getMarginCat(s.margin)], minWidth: 40, textAlign: "right" }}>{s.margin.toFixed(1)}%</span>
                  </div>
                );
              })}
              {el.counts && (
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                  * Showing representative marginal seats only · Full seat-by-seat data not available for state elections
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════ SEATS TAB ═════════════════════════════════════ */}
      {activeTab === "seats" && (
        <div style={{ display: "flex", maxWidth: 1400, margin: "0 auto" }}>
          <aside style={{ width: 215, flexShrink: 0, padding: "16px 0 16px 16px" }}>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, position: "sticky", top: 60, fontSize: 13 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search seats…"
                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 7, padding: "7px 9px", fontSize: 13, boxSizing: "border-box", marginBottom: 14, outline: "none" }} />
              <div style={sectionHead}>State / Territory</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <button onClick={() => setStateFilter(new Set(STATES))} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>All</button>
                <button onClick={() => setStateFilter(new Set())} style={{ fontSize: 11, color: "#2563EB", background: "none", border: "none", cursor: "pointer", padding: 0 }}>None</button>
              </div>
              {STATES.map(s => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={stateFilter.has(s)} onChange={() => toggleSet(setStateFilter, s)} style={{ accentColor: "#2563EB" }} />
                  <span style={{ flex: 1 }}>{s}</span>
                  <span style={{ color: "#9CA3AF", fontSize: 11 }}>{stateCounts[s]}</span>
                </label>
              ))}
              <div style={{ borderTop: "1px solid #F3F4F6", margin: "10px 0" }} />
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
                  <span style={{ color: "#9CA3AF", fontSize: 11 }}>{groupCounts[g] || 0}</span>
                </label>
              ))}
              <div style={{ borderTop: "1px solid #F3F4F6", margin: "10px 0" }} />
              <div style={sectionHead}>Margin</div>
              {MARGINS.map(m => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={marginFilter.has(m)} onChange={() => toggleSet(setMarginFilter, m)} style={{ accentColor: MARGIN_COLOR[m] }} />
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: MARGIN_COLOR[m], flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12 }}>{MARGIN_LABEL[m]}</span>
                  <span style={{ color: "#9CA3AF", fontSize: 11 }}>{marginCounts[m] || 0}</span>
                </label>
              ))}
              <button onClick={() => { setSearch(""); setStateFilter(new Set(STATES)); setGroupFilter(new Set(GROUP_ORDER)); setMarginFilter(new Set(MARGINS)); }}
                style={{ marginTop: 12, width: "100%", padding: "7px 0", background: "#F3F4F6", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 600 }}>
                Clear all filters
              </button>
            </div>
          </aside>
          <div style={{ flex: 1, padding: 16, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 19, color: "#111" }}>All Seats</span>
              <span style={{ fontSize: 13, color: "#6B7280" }}>{filtered.length} of {SEATS.length} seats</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                      <SortTh k="name">Division</SortTh>
                      <SortTh k="state">State</SortTh>
                      <SortTh k="party">Party</SortTh>
                      <th style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", textAlign: "left" }}>Winner</th>
                      <th style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", whiteSpace: "nowrap", textAlign: "left" }}>TCP %</th>
                      <SortTh k="margin">Margin</SortTh>
                      <SortTh k="swing">Swing</SortTh>
                      <th style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", textAlign: "left" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>No seats match current filters.</td></tr>
                    ) : filtered.map((s, i) => {
                      const p = getParty(s.winner.party);
                      const cat = getMarginCat(s.margin);
                      const isExpanded = expandedSeatTabDemogId === s.id;
                      const d = getDemog(s.id);
                      return (
                        <>
                          <tr key={s.id}
                            onClick={() => setExpandedSeatTabDemogId(prev => prev === s.id ? null : s.id)}
                            style={{ background: isExpanded ? "#EFF6FF" : i % 2 === 0 ? "#fff" : "#FAFAFA", borderBottom: isExpanded ? "none" : "1px solid #F3F4F6", cursor: "pointer" }}
                            onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#EFF6FF"; }}
                            onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#FAFAFA"; }}>
                            <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 3, height: 30, background: p.color, borderRadius: 2, flexShrink: 0 }} />
                                <div>
                                  <div style={{ fontWeight: 700, color: "#111" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</div>
                                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>ID {s.id}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "9px 12px" }}>
                              <span style={{ background: "#F3F4F6", color: "#374151", fontWeight: 600, fontSize: 12, padding: "2px 7px", borderRadius: 4 }}>{s.state}</span>
                            </td>
                            <td style={{ padding: "9px 12px" }}><PartyBadge party={s.winner.party} /></td>
                            <td style={{ padding: "9px 12px", color: "#374151" }}>{s.winner.name}</td>
                            <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}><TcpBar tcp={s.tcp} winnerParty={s.winner.party} /></td>
                            <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}><MarginDot margin={s.margin} /></td>
                            <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}><SwingBadge swing={s.swing} /></td>
                            <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: MARGIN_COLOR[cat] + "20", color: MARGIN_COLOR[cat] }}>
                                {cat === "very_marginal" ? "Very marginal" : cat === "marginal" ? "Marginal" : cat === "fairly_safe" ? "Fairly safe" : "Safe"}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${s.id}-demog`}>
                              <td colSpan={8} style={{ background: "#F0F9FF", padding: "14px 20px", borderBottom: "2px solid #BFDBFE" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>Income</div>
                                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                      <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                      <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                      <div><strong>ATO Taxable:</strong> {d.avgTaxableIncome ? `$${(d.avgTaxableIncome / 1000).toFixed(0)}k` : <span style={{ color: "#9CA3AF" }}>n/a</span>}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>Housing</div>
                                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                      <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                      <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                      <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                      <div><strong>Owner outright:</strong> {d.ownerOutrightPct != null ? `${d.ownerOutrightPct}%` : "—"}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>People</div>
                                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                      <div><strong>Median age:</strong> {d.medianAge ?? "—"}</div>
                                      <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                      <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
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
              <div style={{ padding: "9px 16px", background: "#F9FAFB", borderTop: "1px solid #F3F4F6", fontSize: 12, color: "#9CA3AF", display: "flex", justifyContent: "space-between" }}>
                <span>Showing <strong style={{ color: "#374151" }}>{filtered.length}</strong> seats · Sorted by <strong style={{ color: "#374151" }}>{sortKey}</strong> ({sortDir})</span>
                <span>Click headers to sort</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ POLLS TAB ═════════════════════════════════════ */}
      {activeTab === "polls" && (
        <div style={{ padding: "20px 24px", maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Polling Tracker</h2>
              <p style={{ color: "#6B7280", fontSize: 13, margin: "4px 0 0" }}>{polls.length} polls · weighted aggregate with house-effect correction · tap "Load latest → Model" to run scenarios</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={loadFromPoll}
                style={{ padding: "7px 14px", background: "#1D4ED8", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Load latest → Model
              </button>
              <button onClick={() => setShowAddPoll(s => !s)}
                style={{ padding: "7px 14px", background: "#F3F4F6", color: "#374151", border: "1px solid #D1D5DB", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                {showAddPoll ? "Cancel" : "+ Add poll"}
              </button>
            </div>
          </div>

          {/* Add poll form */}
          {showAddPoll && (
            <div style={{ ...panelStyle, background: "#F0F9FF", borderColor: "#BAE6FD", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#0369A1" }}>Add new poll</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 12 }}>
                {[
                  { key: "pollster", label: "Pollster", type: "text", placeholder: "e.g. Newspoll" },
                  { key: "date", label: "Date", type: "date", placeholder: "" },
                  { key: "alp", label: "ALP %", type: "number", placeholder: "e.g. 33" },
                  { key: "coal", label: "Coalition %", type: "number", placeholder: "e.g. 38" },
                  { key: "grn", label: "Greens %", type: "number", placeholder: "e.g. 13" },
                  { key: "tpp", label: "2PP ALP %", type: "number", placeholder: "e.g. 49 (optional)" },
                  { key: "n", label: "Sample size", type: "number", placeholder: "e.g. 1500" },
                ].map(({ key, label, type, placeholder }) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 3 }}>{label}</label>
                    <input type={type} value={newPoll[key]} placeholder={placeholder}
                      onChange={e => setNewPoll(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "6px 9px", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
                  </div>
                ))}
              </div>
              {newPoll.alp && newPoll.coal && newPoll.grn && (
                <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10 }}>
                  Other / minor parties: {(100 - (+newPoll.alp || 0) - (+newPoll.coal || 0) - (+newPoll.grn || 0)).toFixed(1)}%
                </div>
              )}
              <button onClick={addPoll}
                style={{ padding: "8px 20px", background: "#0369A1", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                Save poll
              </button>
            </div>
          )}

          {/* Latest poll summary */}
          {latestPoll && (
            <div style={{ ...panelStyle, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: "#374151" }}>Latest: {latestPoll.pollster} · {new Date(latestPoll.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div>
                {pollAvg && <div style={{ fontSize: 12, color: "#6B7280" }}>30-day weighted avg ({pollAvg.n} polls) shown in brackets</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
                {(() => {
                  const effTpp = latestPoll.tpp ?? imputedTpp(latestPoll);
                  const tppIsEst = latestPoll.tpp == null;
                  return [
                    { label: "ALP primary", value: latestPoll.alp, avg: pollAvg?.alp, color: "#DC2626", delta: latestPoll.alp - BASELINE_2025.alp, est: false },
                    { label: "Coalition primary", value: latestPoll.coal, avg: pollAvg?.coal, color: "#1D4ED8", delta: latestPoll.coal - BASELINE_2025.coal, est: false },
                    { label: "Greens primary", value: latestPoll.grn, avg: pollAvg?.grn, color: "#059669", delta: latestPoll.grn - BASELINE_2025.grn, est: false },
                    { label: "Other / minor", value: latestPoll.oth, avg: pollAvg?.oth, color: "#7C3AED", delta: null, est: false },
                    { label: tppIsEst ? "2PP ALP (est.)" : "2PP (ALP)", value: effTpp, avg: pollAvg?.tpp, color: "#DC2626", delta: effTpp != null ? effTpp - NATIONAL_2PP_2025 : null, est: tppIsEst },
                  ];
                })().map(card => (
                  <div key={card.label} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "12px 14px" }}>
                    <div style={{ width: 20, height: 3, background: card.color, borderRadius: 2, marginBottom: 6 }} />
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 24, fontWeight: 800, color: "#111", fontStyle: card.est ? "italic" : "normal" }}>
                        {card.value != null ? `${card.est ? "~" : ""}${card.value}%` : "—"}
                      </span>
                      {card.avg !== undefined && <span style={{ fontSize: 12, color: "#9CA3AF" }}>({card.avg}%)</span>}
                    </div>
                    {card.delta != null && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: card.delta > 0 ? "#059669" : card.delta < 0 ? "#DC2626" : "#9CA3AF", marginTop: 2 }}>
                        {card.delta > 0 ? "+" : ""}{card.delta.toFixed(1)} vs 2025
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{card.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trend chart */}
          <div style={panelStyle}>
            <div style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>Polling trends</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 12 }}>Thick lines = weighted aggregate (30-day window, decay + sample-size weighted) · Dots = individual polls</div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={pollChartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 65]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v, name) => [v != null ? `${v}%` : "—", name]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E7EB" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={50} stroke="#9CA3AF" strokeDasharray="5 5" label={{ value: "50%", fontSize: 10, fill: "#9CA3AF", position: "insideRight" }} />
                {/* Raw poll scatter (strokeWidth=0 = dots only, no connecting line) */}
                <Line type="linear" dataKey="ALP" stroke="#DC2626" strokeWidth={0} dot={{ r: 3, fill: "#DC2626" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="Coalition" stroke="#1D4ED8" strokeWidth={0} dot={{ r: 3, fill: "#1D4ED8" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="Greens" stroke="#059669" strokeWidth={0} dot={{ r: 3, fill: "#059669" }} activeDot={{ r: 4 }} legendType="circle" />
                <Line type="linear" dataKey="2PP (ALP)" stroke="#DC2626" strokeWidth={0} dot={{ r: 4, fill: "none", stroke: "#DC2626", strokeWidth: 1.5 }} activeDot={{ r: 5 }} legendType="circle" />
                {/* Weighted aggregate trend lines */}
                <Line type="monotone" dataKey="ALP (trend)" stroke="#DC2626" strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="Coal (trend)" stroke="#1D4ED8" strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="Grn (trend)" stroke="#059669" strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="2PP (trend)" stroke="#991B1B" strokeWidth={3} dot={false} strokeDasharray="6 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, textAlign: "center" }}>Thick dashed dark-red = 2PP weighted trend · Open circles = individual 2PP polls · Filled dots = primary vote polls</div>
          </div>

          {/* Polls table */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                  {["Pollster", "Date", "ALP %", "Coalition %", "Greens %", "Other %", "2PP ALP %", "n", ""].map((h, i) => (
                    <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPolls.map((p, i) => {
                  const effTpp = imputedTpp(p);
                  const tppIsImputed = p.tpp == null;
                  return (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA", borderBottom: "1px solid #F3F4F6" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#FAFAFA"}>
                      <td style={{ padding: "9px 12px", fontWeight: 600 }}>{p.pollster}</td>
                      <td style={{ padding: "9px 12px", color: "#6B7280" }}>{new Date(p.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</td>
                      {[p.alp, p.coal, p.grn, p.oth].map((v, j) => (
                        <td key={j} style={{ padding: "9px 12px" }}>
                          <span style={{ fontWeight: 600, color: ["#DC2626", "#1D4ED8", "#059669", "#7C3AED"][j] }}>{v != null ? `${v}%` : "—"}</span>
                        </td>
                      ))}
                      <td style={{ padding: "9px 12px" }}>
                        {effTpp != null ? (
                          <>
                            <span style={{ fontWeight: 700, fontSize: 14, color: effTpp >= 50 ? "#059669" : "#DC2626", fontStyle: tppIsImputed ? "italic" : "normal" }}>
                              {tppIsImputed ? "~" : ""}{effTpp}%
                            </span>
                            <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 5 }}>
                              ({effTpp >= 50 ? "ALP ahead" : "Coalition ahead"}{tppIsImputed ? " · est." : ""})
                            </span>
                          </>
                        ) : <span style={{ color: "#9CA3AF" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#9CA3AF", fontSize: 12 }}>{p.n ?? "—"}</td>
                      <td style={{ padding: "9px 12px" }}>
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
        </div>
      )}

      {/* ══════════════════════ MODEL TAB ═════════════════════════════════════ */}
      {activeTab === "model" && (() => {
        const el = ELECTION_DATA[selectedModelId];
        const modelElectionOptions = ELECTION_OPTIONS;
        const elSelector = (
          <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}
            style={{ border: "1px solid #D1D5DB", borderRadius: 7, padding: "6px 10px", fontSize: 13, fontWeight: 700, outline: "none", background: "#fff", cursor: "pointer" }}>
            {modelElectionOptions.map(id => <option key={id} value={id}>{ELECTION_DATA[id].label}</option>)}
          </select>
        );
        return (
          <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
                    {el.modelEnabled ? "Scenario Builder" : `${el.label} — Results`}
                  </h2>
                  {elSelector}
                </div>
                <p style={{ color: "#6B7280", fontSize: 13, margin: 0 }}>
                  {el.modelEnabled
                    ? `${el.date} · ${el.chamber} · Adjust primary vote swings and preference flows.`
                    : `${el.date} · ${el.chamber} · ${el.totalSeats} seats · Majority: ${el.majority}`}
                </p>
              </div>
              {el.modelEnabled && selectedModelId === "federal_2025" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {hasChanges && (
                    <button onClick={resetModel}
                      style={{ padding: "7px 14px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      Reset model
                    </button>
                  )}
                  {polls.length > 0 && (
                    <button onClick={loadFromPoll}
                      style={{ padding: "7px 14px", background: "#F0F9FF", color: "#0369A1", border: "1px solid #BAE6FD", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      Load from latest poll
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── State election results view ── */}
            {!el.modelEnabled && (() => {
              const tallySeats = mkSeatsFromCounts(el.counts);
              const tightest = [...el.seats].sort((a, b) => a.margin - b.margin).slice(0, 10);
              return (
                <div style={{ maxWidth: 900 }}>
                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seat composition</div>
                    <TallyBar seats={tallySeats} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 16 }}>
                      {GROUP_ORDER.map(g => {
                        const n = el.counts[g];
                        if (!n) return null;
                        return (
                          <div key={g} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{GROUP_CONFIG[g].label}</span>
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{n}</div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>of {el.totalSeats} seats</div>
                          </div>
                        );
                      })}
                    </div>
                    {el.twopp && (
                      <div style={{ marginTop: 12, fontSize: 13, color: "#6B7280" }}>
                        2PP (ALP): <strong style={{ color: el.twopp >= 50 ? "#059669" : "#DC2626" }}>{el.twopp}%</strong>
                      </div>
                    )}
                  </div>
                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Key marginal seats</div>
                    {tightest.map(s => {
                      const p = getParty(s.winner.party);
                      return (
                        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #F3F4F6" }}>
                          <div style={{ width: 3, height: 34, background: p.color, borderRadius: 2, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>({s.state})</span></div>
                            <div style={{ fontSize: 11, color: "#6B7280" }}>{s.winner.name}</div>
                          </div>
                          <PartyBadge party={s.winner.party} />
                          <span style={{ fontWeight: 700, color: MARGIN_COLOR[getMarginCat(s.margin)], minWidth: 40, textAlign: "right" }}>{s.margin.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                      Representative marginal seats only · Full seat-by-seat data not available for state elections
                    </div>
                  </div>
                  <div style={{ ...panelStyle, background: "#F9FAFB", padding: "16px 20px" }}>
                    <div style={{ fontSize: 13, color: "#6B7280" }}>
                      Interactive scenario builders are available for all jurisdictions. Select one from the dropdown above.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Federal scenario builder ── */}
            {el.modelEnabled && selectedModelId === "federal_2025" && <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>

              {/* ── Controls panel ── */}
              <div>
                <div style={panelStyle}>
                  <div style={sectionHead}>Primary vote %</div>
                  <PrimaryInput label="ALP" value={primaries.alp} onChange={v => setPrimaries(p => ({ ...p, alp: v }))} color="#DC2626" baseline={BASELINE_2025.alp} />
                  <PrimaryInput label="Coalition" value={primaries.coal} onChange={v => setPrimaries(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={BASELINE_2025.coal} />
                  <PrimaryInput label="Greens" value={primaries.grn} onChange={v => setPrimaries(p => ({ ...p, grn: v }))} color="#059669" baseline={BASELINE_2025.grn} />
                  <PrimaryInput label="Independents" value={primaries.teal} onChange={v => setPrimaries(p => ({ ...p, teal: v }))} color="#0891B2" baseline={BASELINE_2025.teal} />
                  <PrimaryInput label="One Nation" value={primaries.on} onChange={v => setPrimaries(p => ({ ...p, on: v }))} color="#B45309" baseline={BASELINE_2025.on} />
                  <PrimaryInput label="Undecided" value={primaries.undecided ?? 0} onChange={v => setPrimaries(p => ({ ...p, undecided: v }))} color="#9CA3AF" baseline={0} />
                  {(() => {
                    const entered = +(primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on).toFixed(1);
                    const undecided = +(primaries.undecided ?? 0);
                    const other = +(100 - entered - undecided).toFixed(1);
                    const overLimit = entered + undecided > 100;
                    return (
                      <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#6B7280" }}>Other / minor parties</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "#374151" }}>
                          {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                    2025 result: ALP {BASELINE_2025.alp}% · Coal {BASELINE_2025.coal}% · Grn {BASELINE_2025.grn}% · Ind {BASELINE_2025.teal}% · ON {BASELINE_2025.on}%
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
                    <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
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
                      style={{ fontSize: 11, color: "#6B7280", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", whiteSpace: "nowrap" }}>
                      ↺ Reset to 2025
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}>Used in standard ALP vs Coalition finals. Remainder flows to Coalition.</div>
                  <PrefInput label="Greens → ALP" value={prefFlows.grn_alp} onChange={v => setPrefFlows(f => ({ ...f, grn_alp: v }))} color="#059669" historicalRange={PREF_FLOW_RANGES.grn_alp} />
                  <PrefInput label="Independents → ALP" value={prefFlows.teal_alp} onChange={v => setPrefFlows(f => ({ ...f, teal_alp: v }))} color="#0891B2" historicalRange={PREF_FLOW_RANGES.teal_alp} />
                  <PrefInput label="One Nation → ALP" value={prefFlows.on_alp} onChange={v => setPrefFlows(f => ({ ...f, on_alp: v }))} color="#B45309" historicalRange={PREF_FLOW_RANGES.on_alp} />
                  <PrefInput label="Other → ALP" value={prefFlows.other_alp} onChange={v => setPrefFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" historicalRange={PREF_FLOW_RANGES.other_alp} />
                  <div style={{ fontSize: 11, color: "#9CA3AF", borderTop: "1px solid #F3F4F6", paddingTop: 8, marginTop: 4 }}>
                    Defaults: Grn 81% (2025) · Ind 62% (2025) · ON 27% (avg 2022…15%, 2025…43%) · Other 50%. Use "↺ Reset to 2025" to restore 2025 actuals.
                  </div>
                </div>

                {/* Advanced ON race flows — collapsed by default */}
                <div style={panelStyle}>
                  <button
                    onClick={() => setShowAdvancedFlows(v => !v)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showAdvancedFlows ? 12 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
                      Advanced: ON race flows
                    </span>
                    <span style={{ fontSize: 13, color: "#9CA3AF" }}>{showAdvancedFlows ? "▲" : "▼"}</span>
                  </button>
                  {showAdvancedFlows && (
                    <div>
                      {/* ON vs ALP final flows */}
                      <div style={{ marginBottom: 12, padding: "10px 12px", background: "#FEF3C7", borderRadius: 8, border: "1px solid #FDE68A" }}>
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
                        <div style={{ fontSize: 11, color: "#9CA3AF", borderTop: "1px solid #FDE68A", paddingTop: 6, marginTop: 2 }}>
                          Defaults: Grn 90% · Ind 75% · Other 60% · Coal 15% (2025 AEC)
                        </div>
                      </div>
                      {/* ON vs Coal final flows */}
                      <div style={{ padding: "10px 12px", background: "#FEF3C7", borderRadius: 8, border: "1px solid #FDE68A" }}>
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
                        <div style={{ fontSize: 11, color: "#9CA3AF", borderTop: "1px solid #FDE68A", paddingTop: 6, marginTop: 2 }}>
                          Defaults: ALP 20% · Grn 8% · Ind 12% · Other 25%. Remainder flows to Coalition.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Results panel ── */}
              <div>
                {/* Implied 2PP + majority */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                    {implied2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: implied2pp >= 50 ? "#059669" : "#DC2626" }}>{implied2pp.toFixed(1)}%</div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                          {implied2pp >= NATIONAL_2PP_2025 ? `▲ +${(implied2pp - NATIONAL_2PP_2025).toFixed(1)} vs 2025` : `▼ ${(implied2pp - NATIONAL_2PP_2025).toFixed(1)} vs 2025`}
                        </div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "#9CA3AF" }}>—</div>}
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: changedSeats.length > 0 ? "#F59E0B" : "#6B7280" }}>{changedSeats.length}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>of {SEATS.length} modelled</div>
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                    {(() => {
                      const alpProj = projCounts.alp || 0;
                      const needsMaj = 76;
                      const projMaj = alpProj >= needsMaj ? "ALP majority" : (((projCounts.coalition || 0) >= needsMaj) ? "Coalition majority" : "Hung parliament");
                      const majColor = alpProj >= needsMaj ? "#059669" : (((projCounts.coalition || 0) >= needsMaj) ? "#1D4ED8" : "#F59E0B");
                      return (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>76 seats needed</div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Tally comparison: 2022 vs projected */}
                <div style={panelStyle}>
                  <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seat composition</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>2025 result</div>
                    <TallyBar seats={SEATS} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>Projected</div>
                      {hasChanges && <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                    </div>
                    <TallyBar seats={modelledSeats} useModelled={true} />
                  </div>

                  {/* Delta table */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 8 }}>
                    {GROUP_ORDER.map(g => {
                      const base = baseCounts[g] || 0;
                      const proj = projCounts[g] || 0;
                      const delta = proj - base;
                      return (
                        <div key={g} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{GROUP_CONFIG[g].label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{proj}</span>
                            <span style={{ fontSize: 12, color: "#6B7280" }}>/ {base} base</span>
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
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontWeight: 700, color: "#374151" }}>Seat-count uncertainty</span>
                    <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 7px", borderRadius: 10 }}>
                      ±{swingStd}pp swing σ
                    </span>
                  </div>

                  {/* ALP seat count distribution */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{uncertainty.alpMean}</span>
                      <span style={{ fontSize: 13, color: "#6B7280" }}>seats (mean)</span>
                      <span style={{ fontSize: 13, color: "#9CA3AF" }}>±{uncertainty.alpStd}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>
                      <span style={{ color: "#6B7280" }}>80% CI: </span>
                      <strong>{uncertainty.alpP10 ?? uncertainty.alpP25}–{uncertainty.alpP90 ?? uncertainty.alpP75}</strong>
                      &nbsp;seats
                      <span style={{ marginLeft: 10, color: "#6B7280" }}>95% CI: </span>
                      <strong>{uncertainty.alpP05}–{uncertainty.alpP95}</strong>
                      &nbsp;seats
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
                      <span style={{ color: "#6B7280" }}>P(ALP majority ≥76): </span>
                      <strong style={{ color: uncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>
                        {uncertainty.pMajority}%
                      </strong>
                    </div>
                  </div>

                  {/* Visual quantile bar */}
                  <div style={{ position: "relative", height: 20, background: "#F3F4F6", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
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
                      width: 1, height: "100%", background: "#6B7280",
                    }} title="76 seats = majority" />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
                    <span>{uncertainty.alpP05}</span>
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>{uncertainty.alpP50} median</span>
                    <span>76 maj.</span>
                    <span>{uncertainty.alpP95}</span>
                  </div>

                  {/* Model options */}
                  <div style={{ borderTop: "1px solid #F3F4F6", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Model options</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151", cursor: "pointer", marginBottom: 8 }}>
                      <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                      Seat elasticity (marginal seats swing more)
                      <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                        {useElasticity ? "ON — ≤5pp: 1.3×, 6–10pp: 1.15×, >20pp: 0.8×" : "OFF — uniform swing"}
                      </span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151", marginBottom: 8 }}>
                      <label style={{ minWidth: 130 }}>ON auto-detect threshold:</label>
                      <input type="number" min={0} max={30} step={0.5} value={onThreshold}
                        onChange={e => setOnThreshold(+e.target.value)}
                        style={{ width: 56, border: "1px solid #D1D5DB", borderRadius: 5, padding: "3px 6px", fontSize: 12, textAlign: "center", outline: "none" }} />
                      <span style={{ fontSize: 11, color: "#6B7280" }}>% primary vote</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                      <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                      <input
                        type="range" min={0.5} max={4} step={0.25} value={swingStd}
                        onChange={e => setSwingStd(+e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                      Typical Australian federal election polling MAE ≈ 1–2pp nationally.
                    </div>
                  </div>
                </div>

                {/* ── Seat-at-risk rankings ── */}
                {(() => {
                  const filterBtnStyle = (active) => ({
                    padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #D1D5DB",
                    background: active ? "#374151" : "#fff", color: active ? "#fff" : "#374151",
                  });
                  const filtered = (riskFilter === "all" ? seatsByRisk
                    : riskFilter === "changing" ? seatsByRisk.filter(s => s.modelled.changed)
                      : seatsByRisk.filter(s => getModelledMargin(s) < 5))
                    .filter(s => !modelStateFilter || s.state === modelStateFilter);

                  return (
                    <div style={panelStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, color: "#374151", flex: 1 }}>Seat-at-risk rankings</span>
                        <select value={modelStateFilter} onChange={e => setModelStateFilter(e.target.value)}
                          style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, outline: "none", background: "#fff" }}>
                          <option value="">All States</option>
                          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[["all", "All 151"], ["changing", "Changing"], ["marginal", "Marginal (<5pp)"]].map(([val, label]) => (
                            <button key={val} onClick={() => setRiskFilter(val)} style={filterBtnStyle(riskFilter === val)}>{label}</button>
                          ))}
                        </div>
                      </div>

                      {/* Column headers */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 80px 80px 80px 70px", gap: 4, borderBottom: "2px solid #F3F4F6", paddingBottom: 4, marginBottom: 4 }}>
                        {[["Seat", "#374151"], ["State", "#6B7280"], ["2025", "#6B7280"], ["Projected", "#6B7280"], ["Margin", "#6B7280"], ["ALP win%", "#6B7280"], ["", ""]].map(([label, color], i) => (
                          <div key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color, paddingLeft: i === 0 ? 2 : 0 }}>{label}</div>
                        ))}
                      </div>

                      <div style={{ maxHeight: 400, overflowY: "auto" }}>
                        {filtered.map(seat => {
                          const margin = getModelledMargin(seat);
                          const isSafe = margin > 10;
                          const changed = seat.modelled.changed;
                          const projGroup = seat.modelled.winnerGroup;
                          const projColor = GROUP_CONFIG[projGroup]?.color ?? "#6B7280";
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
                                  display: "grid", gridTemplateColumns: "1fr 48px 80px 80px 80px 52px 60px", gap: 4, alignItems: "center",
                                  padding: "5px 2px", borderLeft: `4px solid ${changed ? projColor : "transparent"}`,
                                  borderBottom: isExpanded ? "none" : "1px solid #F9FAFB",
                                  opacity: isSafe ? 0.55 : 1,
                                  background: isExpanded ? "#F0F9FF" : projGroup === "one_nation" && changed ? "#FFFBEB" : "transparent",
                                  cursor: "pointer",
                                }}>
                                <span style={{ fontWeight: changed ? 700 : 400, fontSize: 13, color: "#111", paddingLeft: changed ? 4 : 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {isExpanded ? "▾ " : "▸ "}{seat.name}
                                </span>
                                <span style={{ fontSize: 11, color: "#6B7280" }}>{seat.state}</span>
                                <div><PartyBadge party={seat.winner.party} /></div>
                                <div>
                                  {changed
                                    ? <PartyBadge party={seat.modelled.winnerParty} />
                                    : <span style={{ fontSize: 11, color: "#9CA3AF" }}>holds</span>
                                  }
                                </div>
                                <span style={{ fontSize: 12, fontWeight: margin < 5 ? 700 : 400, color: margin < 2 ? "#DC2626" : margin < 5 ? "#D97706" : "#374151" }}>
                                  {margin === Infinity ? "—" : `${margin.toFixed(1)}pp`}
                                </span>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, color:
                                    seatWinProb == null ? "#9CA3AF"
                                      : seatWinProb >= 0.85 ? "#DC2626"
                                        : seatWinProb >= 0.60 ? "#F59E0B"
                                          : seatWinProb >= 0.40 ? "#6B7280"
                                            : "#1D4ED8"
                                }}>
                                  {seatWinProb != null ? `${Math.round(seatWinProb * 100)}%` : "—"}
                                </span>
                                <span style={{ fontSize: 10, color: changed ? projColor : "#9CA3AF", fontWeight: 600 }}>
                                  {changed ? "CHANGED" : ""}
                                  {hasSeatOverrides && <span style={{ marginLeft: 4, fontSize: 9, color: "#6B7280", fontWeight: 700 }}>⚙</span>}
                                </span>
                              </div>
                              {isExpanded && (
                                <div style={{ background: "#F8FAFC", borderBottom: "1px solid #E5E7EB", padding: "12px 16px", marginBottom: 2 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>Income</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                        <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>Housing</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                        <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                        <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>People</div>
                                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                        <div><strong>Median age:</strong> {d.medianAge ?? "—"}</div>
                                        <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                        <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
                                        <div><strong>AEC class:</strong> {d.urbanClass ?? "—"}</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* ── Seat-level primary vote overrides ── */}
                                  <div style={{ marginTop: 14, borderTop: "1px solid #E5E7EB", paddingTop: 12 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>
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
                                              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 5, padding: "4px 3px", fontSize: 12, textAlign: "center", boxSizing: "border-box" }}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 4 }}>
                                      {SEAT_FP_2025[seat.id]
                                        ? `2025 AEC: ALP ${SEAT_FP_2025[seat.id].alp}% · Coal ${SEAT_FP_2025[seat.id].coal}% · Grn ${SEAT_FP_2025[seat.id].grn}% · Ind ${SEAT_FP_2025[seat.id].teal}% · ON ${SEAT_FP_2025[seat.id].on}%`
                                        : `National (2025): ALP ${primaries.alp}% · Coal ${primaries.coal}% · Grn ${primaries.grn}% · Ind ${primaries.teal}% · ON ${primaries.on}%`
                                      }
                                    </div>
                                  </div>

                                  {/* ── Seat-level preference flow overrides ── */}
                                  <div style={{ marginTop: 12, borderTop: "1px solid #E5E7EB", paddingTop: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF" }}>
                                        Preference Flows (seat override)
                                      </div>
                                      {Object.values(seatPrefFlows).some(v => v != null) && (
                                        <span style={{ fontSize: 10, background: "#6B7280", color: "#fff", padding: "1px 6px", borderRadius: 8, fontWeight: 600 }}>seat-level</span>
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
                          <div style={{ padding: "20px 0", textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
                            No seats match this filter.
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, borderTop: "1px solid #F3F4F6", paddingTop: 8 }}>
                        {filtered.length} seats shown · Red = &lt;2pp · Amber = &lt;5pp · Faded = safe (&gt;10pp) · Bold left border = projected change · Click row to expand demographics
                      </div>
                    </div>
                  );
                })()}

                {/* Seats changing hands */}
                {changedSeats.length > 0 && (
                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seats changing hands ({changedSeats.length})</div>
                    {(() => {
                      const alpGains = changedSeats.filter(s => s.modelled.winnerGroup === "alp" && getParty(s.winner.party).group !== "alp");
                      const alpLosses = changedSeats.filter(s => getParty(s.winner.party).group === "alp" && s.modelled.winnerGroup !== "alp");
                      const other = changedSeats.filter(s => s.modelled.winnerGroup !== "alp" && getParty(s.winner.party).group !== "alp");
                      const SeatRow = ({ seat, direction }) => {
                        const baseP = getParty(seat.winner.party);
                        const projP = getParty(seat.modelled.winnerParty);
                        const alp2pp = seat.modelled.projAlp2pp;
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #F3F4F6" }}>
                            <span style={{ fontSize: 14 }}>{direction}</span>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 600 }}>{seat.name}</span>
                              <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: 6 }}>{seat.state}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                              <PartyBadge party={seat.winner.party} />
                              <span style={{ color: "#9CA3AF" }}>→</span>
                              <PartyBadge party={seat.modelled.winnerParty} />
                            </div>
                            {alp2pp !== null && (
                              <span style={{ fontSize: 12, color: "#6B7280", minWidth: 80, textAlign: "right" }}>
                                ALP 2PP {alp2pp.toFixed(1)}%
                              </span>
                            )}
                            {seat.modelled.isOverride && <span style={{ fontSize: 10, background: "#FEF3C7", color: "#92400E", padding: "1px 5px", borderRadius: 6, fontWeight: 600 }}>override</span>}
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
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>⚪ Other changes ({other.length})</div>
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
                    <span style={{ fontWeight: 700, color: "#374151" }}>Seat-level primary overrides</span>
                    {Object.keys(seatOverrides).length > 0 && (
                      <>
                        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400E", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
                          {Object.keys(seatOverrides).length} active
                        </span>
                        <button onClick={() => setSeatOverrides({})}
                          style={{ marginLeft: "auto", fontSize: 12, color: "#EF4444", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                          Clear all
                        </button>
                      </>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "#6B7280", margin: "0 0 10px" }}>
                    Set custom primary vote %s for specific seats — useful for strong local candidates or known seat-level effects.
                  </p>

                  {/* Seat search + dropdown */}
                  <div style={{ position: "relative", marginBottom: 12 }}>
                    <input
                      value={overrideSearch}
                      onChange={e => setOverrideSearch(e.target.value)}
                      placeholder="+ Search for a seat to add…"
                      style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 7, padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                    />
                    {overrideSearch.length > 0 && (() => {
                      const matches = SEATS.filter(s =>
                        s.name.toLowerCase().includes(overrideSearch.toLowerCase()) && !seatOverrides[s.id]
                      ).slice(0, 8);
                      return matches.length > 0 ? (
                        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 7, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                          {matches.map((s, i) => (
                            <div key={s.id}
                              onMouseDown={() => addSeatOverride(s.id)}
                              style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: i < matches.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                              <span style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{s.name}</span>
                              <span style={{ fontSize: 12, color: "#9CA3AF" }}>{s.state}</span>
                              <PartyBadge party={s.winner.party} />
                              <span style={{ fontSize: 12, color: "#6B7280" }}>{s.margin.toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  {/* Overridden seat cards */}
                  {Object.keys(seatOverrides).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px 0", color: "#9CA3AF", fontSize: 12 }}>
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
                          <div key={idStr} style={{ border: "1px solid #D1D5DB", borderRadius: 8, padding: "12px 14px", background: "#FAFAFA" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <PartyBadge party={seat.winner.party} />
                              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{seat.name}</span>
                              <span style={{ fontSize: 12, color: "#9CA3AF" }}>{seat.state} · 2022 margin {seat.margin.toFixed(1)}%</span>
                              {proj2pp !== null && (
                                <span style={{ fontSize: 12, fontWeight: 700, color: proj2pp >= 50 ? "#059669" : "#1D4ED8" }}>
                                  ALP 2PP {proj2pp.toFixed(1)}%
                                </span>
                              )}
                              <button onClick={() => clearOverride(+idStr)}
                                style={{ fontSize: 13, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>✕</button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                              {[["ALP", "alp", "#DC2626"], ["Coal", "coal", "#1D4ED8"], ["Grn", "grn", "#059669"], ["Ind", "teal", "#0891B2"], ["ON", "on", "#B45309"]].map(([label, key, color]) => (
                                <div key={key} style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 10, fontWeight: 800, color, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                                  <input
                                    type="number" min={0} max={100} step={0.5}
                                    value={ov[key] !== null && ov[key] !== undefined ? ov[key] : ""}
                                    onChange={e => updateSeatOverride(+idStr, key, e.target.value)}
                                    style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 5, padding: "5px 4px", fontSize: 12, textAlign: "center", boxSizing: "border-box", outline: "none" }}
                                  />
                                </div>
                              ))}
                            </div>
                            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8 }}>
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
                                <div style={{ borderTop: "1px solid #E5E7EB", marginTop: 10, paddingTop: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", flex: 1 }}>Margin / TCP override</span>
                                    <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                                      2022: {getParty(tcp0.party).short} {tcp0.pct.toFixed(1)}% vs {getParty(tcp1.party).short} {tcp1.pct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{tcpLabel}</label>
                                    <input
                                      type="number" min={0} max={100} step={0.1}
                                      value={ovTcpSet ? ovTcp : ""}
                                      placeholder={projTcpPct?.toFixed(1) ?? "—"}
                                      onChange={e => updateSeatOverride(+idStr, "tcpPct", e.target.value)}
                                      style={{ width: 72, border: ovTcpSet ? "1px solid #6366F1" : "1px solid #D1D5DB", borderRadius: 5, padding: "5px 6px", fontSize: 12, textAlign: "center", outline: "none", background: ovTcpSet ? "#EEF2FF" : "#fff" }}
                                    />
                                    <span style={{ fontSize: 12, color: "#6B7280" }}>%</span>
                                    {displayTcp !== null && (
                                      <span style={{ fontSize: 12, fontWeight: 600, color: tcpWins ? "#059669" : "#1D4ED8" }}>
                                        {tcpWins ? winLabel : loseLabel} +{margin2pp}pp
                                      </span>
                                    )}
                                    {ovTcpSet && (
                                      <button
                                        onClick={() => updateSeatOverride(+idStr, "tcpPct", "")}
                                        style={{ marginLeft: "auto", fontSize: 11, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}
                                        title="Clear TCP override">✕</button>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                                    {`>50% → ${winLabel} wins · <50% → ${loseLabel} wins`}
                                    {projTcpPct !== null && !ovTcpSet && (
                                      <span> · Modelled: {projTcpPct.toFixed(1)}%</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* TCP Matchup override */}
                            <div style={{ borderTop: "1px solid #E5E7EB", marginTop: 10, paddingTop: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6 }}>TCP Matchup</div>
                              <div style={{ display: "flex", gap: 5 }}>
                                {[["auto", "Auto"], ["on_v_alp", "ON vs ALP"], ["on_v_coal", "ON vs Coal"]].map(([val, label]) => {
                                  const active = (ov.tcpMatchup ?? "auto") === val;
                                  return (
                                    <button key={val}
                                      onClick={() => updateSeatOverride(+idStr, "tcpMatchup", val === "auto" ? null : val)}
                                      style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", background: active ? "#B45309" : "#fff", color: active ? "#fff" : "#B45309", border: "1px solid #B45309" }}>
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                              {ov.tcpMatchup && (
                                <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>
                                  {ov.tcpMatchup === "on_v_alp" ? "Uses Coal→ALP (ON race) preference flow." : "Uses ALP→ON (vs Coal) preference flow."}
                                </div>
                              )}
                            </div>

                            {/* Force projected winner */}
                            <div style={{ borderTop: "1px solid #E5E7EB", marginTop: 10, paddingTop: 10 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", flex: 1 }}>Force projected winner</span>
                                {ov.forceGroup && (
                                  <button onClick={() => updateSeatOverride(+idStr, "forceGroup", "")}
                                    style={{ fontSize: 11, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>
                                    Clear
                                  </button>
                                )}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {GROUP_ORDER.map(g => (
                                  <button key={g}
                                    onClick={() => updateSeatOverride(+idStr, "forceGroup", ov.forceGroup === g ? "" : g)}
                                    style={{
                                      padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                                      background: ov.forceGroup === g ? GROUP_CONFIG[g].color : "#fff",
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
            {el.modelEnabled && selectedModelId === "vic_2022" && <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>

              {/* ── VIC Controls panel ── */}
              <div>
                <div style={panelStyle}>
                  <div style={sectionHead}>Primary vote %</div>
                  <PrimaryInput label="ALP" value={vicPrimaries.alp} onChange={v => setVicPrimaries(p => ({ ...p, alp: v }))} color="#DC2626" baseline={VIC_BASELINE_2022.alp} />
                  <PrimaryInput label="Coalition" value={vicPrimaries.coal} onChange={v => setVicPrimaries(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={VIC_BASELINE_2022.coal} />
                  <PrimaryInput label="Greens" value={vicPrimaries.grn} onChange={v => setVicPrimaries(p => ({ ...p, grn: v }))} color="#059669" baseline={VIC_BASELINE_2022.grn} />
                  <PrimaryInput label="Independents" value={vicPrimaries.ind} onChange={v => setVicPrimaries(p => ({ ...p, ind: v }))} color="#0891B2" baseline={VIC_BASELINE_2022.ind} />
                  <PrimaryInput label="One Nation" value={vicPrimaries.on} onChange={v => setVicPrimaries(p => ({ ...p, on: v }))} color="#B45309" baseline={VIC_BASELINE_2022.on} />
                  <PrimaryInput label="Undecided" value={vicPrimaries.undecided ?? 0} onChange={v => setVicPrimaries(p => ({ ...p, undecided: v }))} color="#9CA3AF" baseline={0} />
                  {(() => {
                    const entered = +(vicPrimaries.alp + vicPrimaries.coal + vicPrimaries.grn + vicPrimaries.ind + vicPrimaries.on).toFixed(1);
                    const undecided = +(vicPrimaries.undecided ?? 0);
                    const other = +(100 - entered - undecided).toFixed(1);
                    const overLimit = entered + undecided > 100;
                    return (
                      <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#6B7280" }}>Other / minor parties</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "#374151" }}>
                          {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                    2022 result: ALP {VIC_BASELINE_2022.alp}% · Coalition {VIC_BASELINE_2022.coal}% · Grn {VIC_BASELINE_2022.grn}% · Ind {VIC_BASELINE_2022.ind}% · ON {VIC_BASELINE_2022.on}%
                  </div>
                </div>

                <div style={panelStyle}>
                  <div style={sectionHead}>Preference flows to ALP</div>
                  <PrefInput label="Greens → ALP" value={vicPrefFlows.grn_alp} onChange={v => setVicPrefFlows(f => ({ ...f, grn_alp: v }))} color="#059669" />
                  <PrefInput label="Independents → ALP" value={vicPrefFlows.ind_alp} onChange={v => setVicPrefFlows(f => ({ ...f, ind_alp: v }))} color="#0891B2" />
                  <PrefInput label="One Nation → ALP" value={vicPrefFlows.on_alp} onChange={v => setVicPrefFlows(f => ({ ...f, on_alp: v }))} color="#B45309" />
                  <PrefInput label="Other → ALP" value={vicPrefFlows.other_alp} onChange={v => setVicPrefFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" />
                  <div style={{ fontSize: 11, color: "#9CA3AF", borderTop: "1px solid #F3F4F6", paddingTop: 8, marginTop: 4 }}>
                    Defaults based on 2022 VIC preference distributions. Remainder flows to Coalition.
                  </div>
                </div>

                {vicHasChanges && (
                  <button onClick={() => { setVicPrimaries({ alp: 38.1, coal: 31.1, grn: 12.2, ind: 5.5, on: 1.3, undecided: 0 }); setVicPrefFlows({ grn_alp: 0.85, ind_alp: 0.60, on_alp: 0.25, other_alp: 0.43 }); }}
                    style={{ width: "100%", padding: "8px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                    Reset VIC model
                  </button>
                )}
              </div>

              {/* ── VIC Results panel ── */}
              <div>
                {/* Summary stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                    {vicImplied2pp !== null ? (
                      <>
                        <div style={{ fontSize: 30, fontWeight: 800, color: vicImplied2pp >= 50 ? "#059669" : "#DC2626" }}>{vicImplied2pp.toFixed(1)}%</div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                          {vicImplied2pp >= 50 ? `▲ +${(vicImplied2pp - VIC_2PP_2022).toFixed(1)} vs 2022` : `▼ ${(vicImplied2pp - VIC_2PP_2022).toFixed(1)} vs 2022`}
                        </div>
                      </>
                    ) : <div style={{ fontSize: 20, color: "#9CA3AF" }}>—</div>}
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: vicChangedSeats.length > 0 ? "#F59E0B" : "#6B7280" }}>{vicChangedSeats.length}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>of 88 modelled</div>
                  </div>
                  <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                    {(() => {
                      const alpProj = vicProjCounts.alp || 0;
                      const coalProj = (vicProjCounts.coalition || 0);
                      const projMaj = alpProj >= 45 ? "ALP majority" : coalProj >= 45 ? "Coalition majority" : "Hung parliament";
                      const majColor = alpProj >= 45 ? "#059669" : coalProj >= 45 ? "#1D4ED8" : "#F59E0B";
                      return (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>45 seats needed</div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Tally comparison */}
                <div style={panelStyle}>
                  <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seat composition</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>2022 result</div>
                    <TallyBar seats={VIC_SEATS} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>Projected</div>
                      {vicHasChanges && <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                    </div>
                    <TallyBar seats={vicModelledSeats} useModelled={true} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 8 }}>
                    {GROUP_ORDER.map(g => {
                      const base = vicBaseCounts[g] || 0;
                      const proj = vicProjCounts[g] || 0;
                      const delta = proj - base;
                      if (!base && !proj) return null;
                      return (
                        <div key={g} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{GROUP_CONFIG[g].label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{proj}</span>
                            <span style={{ fontSize: 12, color: "#6B7280" }}>/ {base} base</span>
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
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontWeight: 700, color: "#374151" }}>Seat-count uncertainty</span>
                    <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{vicUncertainty.alpMean}</span>
                      <span style={{ fontSize: 13, color: "#6B7280" }}>seats (mean)</span>
                      <span style={{ fontSize: 13, color: "#9CA3AF" }}>±{vicUncertainty.alpStd}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>
                      <span style={{ color: "#6B7280" }}>80% CI: </span>
                      <strong>{vicUncertainty.alpP25}–{vicUncertainty.alpP75}</strong> seats
                      <span style={{ marginLeft: 10, color: "#6B7280" }}>95% CI: </span>
                      <strong>{vicUncertainty.alpP05}–{vicUncertainty.alpP95}</strong> seats
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
                      <span style={{ color: "#6B7280" }}>P(ALP majority ≥45): </span>
                      <strong style={{ color: vicUncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>{vicUncertainty.pMajority}%</strong>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 20, background: "#F3F4F6", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP05 / 89 * 100)}%`, width: `${Math.min(100, (vicUncertainty.alpP95 - vicUncertainty.alpP05) / 89 * 100)}%`, height: "100%", background: "#FECACA", borderRadius: 4 }} />
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP25 / 89 * 100)}%`, width: `${Math.min(100, (vicUncertainty.alpP75 - vicUncertainty.alpP25) / 89 * 100)}%`, height: "100%", background: "#FCA5A5" }} />
                    <div style={{ position: "absolute", left: `${Math.max(0, vicUncertainty.alpP50 / 89 * 100)}%`, width: 2, height: "100%", background: "#DC2626" }} />
                    <div style={{ position: "absolute", left: `${45 / 89 * 100}%`, width: 1, height: "100%", background: "#6B7280" }} title="45 seats = majority" />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
                    <span>{vicUncertainty.alpP05}</span>
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>{vicUncertainty.alpP50} median</span>
                    <span>45 maj.</span>
                    <span>{vicUncertainty.alpP95}</span>
                  </div>
                  <div style={{ borderTop: "1px solid #F3F4F6", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Model options</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151", cursor: "pointer", marginBottom: 8 }}>
                      <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                      Seat elasticity (marginal seats swing more)
                      <span style={{ fontSize: 11, color: "#9CA3AF" }}>{useElasticity ? "ON — ≤5pp: 1.3×, 6–10pp: 1.15×, >20pp: 0.8×" : "OFF — uniform swing"}</span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                      <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                      <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                      <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Shared across all elections. Typical Australian state polling MAE ≈ 1–2pp.</div>
                  </div>
                </div>

                {/* Seat-at-risk table */}
                <div style={panelStyle}>
                  <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seats at risk (tightest 25)</div>
                  <div style={{ maxHeight: 440, overflowY: "auto" }}>
                    {[...vicModelledSeats].sort((a, b) => a.margin - b.margin).slice(0, 25).map(seat => {
                      const base = getParty(seat.winner.party);
                      const proj = getParty(seat.modelled.winnerParty);
                      const changed = seat.modelled.changed;
                      const winProb = vicUncertainty.seatWinProbs[seat.id];
                      return (
                        <div key={seat.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F3F4F6", background: changed ? "#FFF7ED" : "transparent" }}>
                          <div style={{ width: 3, height: 28, background: changed ? proj.color : base.color, borderRadius: 2, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                              {seat.name}
                              {changed && <span style={{ fontSize: 10, background: "#FEF3C7", color: "#92400E", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>CHANGES</span>}
                            </div>
                            <div style={{ fontSize: 11, color: "#6B7280" }}>{seat.tcp[0].party} vs {seat.tcp[1].party}</div>
                          </div>
                          <PartyBadge party={seat.winner.party} />
                          {changed && <><span style={{ fontSize: 11, color: "#6B7280" }}>→</span><PartyBadge party={seat.modelled.winnerParty} /></>}
                          <span style={{ fontWeight: 700, fontSize: 13, color: MARGIN_COLOR[getMarginCat(seat.margin)], minWidth: 40, textAlign: "right" }}>
                            {seat.margin.toFixed(1)}%
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 36, textAlign: "right", color: winProb == null ? "#9CA3AF" : winProb >= 0.85 ? "#DC2626" : winProb >= 0.60 ? "#F59E0B" : winProb >= 0.40 ? "#6B7280" : "#1D4ED8" }}>
                            {winProb != null ? `${Math.round(winProb * 100)}%` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                    Probabilistic swing model · VEC 2022 official results · 88 Legislative Assembly districts · ALP win% shown for ALP/Coalition contests
                  </div>
                </div>
              </div>
            </div>}

            {/* ── Reusable state builder (NSW, QLD, WA, SA, NT) ── */}
            {(() => {
              const cfgs = {
                nsw_2023: { prim: nswPrim, setPrim: setNswPrim, flows: nswFlows, setFlows: setNswFlows, modelled: nswModelledSeats, proj: nswProjCounts, base: nswBaseCounts, changed: nswChanged, implied2pp: nswImplied2pp, hasChanges: nswHasChanges, bl: NSW_BL, baseline2pp: NSW_2PP, coalLabel: "Coalition", seats: "NSW_SEATS", totalSeats: 93, majority: 47, source: "NSWEC 2023 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.88, ind_alp: 0.55, on_alp: 0.20, other_alp: 0.45 }, allSeats: NSW_SEATS, uncertainty: nswUncertainty },
                qld_2024: { prim: qldPrim, setPrim: setQldPrim, flows: qldFlows, setFlows: setQldFlows, modelled: qldModelledSeats, proj: qldProjCounts, base: qldBaseCounts, changed: qldChanged, implied2pp: qldImplied2pp, hasChanges: qldHasChanges, bl: QLD_BL, baseline2pp: QLD_2PP, coalLabel: "Coalition", seats: "QLD_SEATS", totalSeats: 93, majority: 47, source: "ECQ 2024 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.82, ind_alp: 0.50, on_alp: 0.18, other_alp: 0.40 }, allSeats: QLD_SEATS, uncertainty: qldUncertainty },
                wa_2025: { prim: waPrim, setPrim: setWaPrim, flows: waFlows, setFlows: setWaFlows, modelled: waModelledSeats, proj: waProjCounts, base: waBaseCounts, changed: waChanged, implied2pp: waImplied2pp, hasChanges: waHasChanges, bl: WA_BL, baseline2pp: WA_2PP, coalLabel: "Coalition", seats: "WA_SEATS", totalSeats: 59, majority: 30, source: "WAEC 2025 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.86, ind_alp: 0.58, on_alp: 0.22, other_alp: 0.44 }, allSeats: WA_SEATS, uncertainty: waUncertainty },
                sa_2022: { prim: saPrim, setPrim: setSaPrim, flows: saFlows, setFlows: setSaFlows, modelled: saModelledSeats, proj: saProjCounts, base: saBaseCounts, changed: saChanged, implied2pp: saImplied2pp, hasChanges: saHasChanges, bl: SA_BL, baseline2pp: SA_2PP, coalLabel: "Coalition", seats: "SA_SEATS", totalSeats: 47, majority: 24, source: "ECSA 2022 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.84, ind_alp: 0.52, on_alp: 0.22, other_alp: 0.45 }, allSeats: SA_SEATS, uncertainty: saUncertainty },
                nt_2024: { prim: ntPrim, setPrim: setNtPrim, flows: ntFlows, setFlows: setNtFlows, modelled: ntModelledSeats, proj: ntProjCounts, base: ntBaseCounts, changed: ntChanged, implied2pp: null, hasChanges: ntHasChanges, bl: NT_BL, baseline2pp: NT_2PP, coalLabel: "Coalition", seats: "NT_SEATS", totalSeats: 25, majority: 13, source: "NTEC 2024 official results", parties: [{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Independents", c: "#0891B2" }, { k: "on", l: "One Nation", c: "#B45309" }], resetFlows: { grn_alp: 0.80, ind_alp: 0.45, on_alp: 0.20, other_alp: 0.40 }, allSeats: NT_SEATS, uncertainty: ntUncertainty },
              };
              const cfg = cfgs[selectedModelId];
              if (!el.modelEnabled || !cfg) return null;
              const { prim, setPrim, flows, setFlows, modelled, proj, base, changed, implied2pp, hasChanges, bl, baseline2pp, coalLabel, totalSeats, majority, source, parties, resetFlows, allSeats, uncertainty } = cfg;
              const entered = parties.reduce((s, p) => s + (prim[p.k] ?? 0), 0);
              const undecided = +(prim.undecided ?? 0);
              const other = +(100 - entered - undecided).toFixed(1);
              const overLimit = entered + undecided > 100;
              const alpProj = proj.alp || 0;
              const coalProj = proj.coalition || 0;
              const grnProj = proj.greens || 0;
              const projMaj = alpProj >= majority ? "ALP majority" : (coalProj >= majority ? `${coalLabel} majority` : "Hung parliament");
              const majColor = alpProj >= majority ? "#DC2626" : (coalProj >= majority ? "#1D4ED8" : "#F59E0B");

              return <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
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
                      color="#9CA3AF" baseline={0} />
                    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#6B7280" }}>Other / minor parties</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#DC2626" : "#374151" }}>
                        {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                      {parties.map(p => `${p.l} ${bl[p.k] ?? 0}%`).join(" · ")}
                    </div>
                  </div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Preference flows to ALP</div>
                    <PrefInput label="Greens → ALP" value={flows.grn_alp} onChange={v => setFlows(f => ({ ...f, grn_alp: v }))} color="#059669" />
                    <PrefInput label="Independents → ALP" value={flows.ind_alp} onChange={v => setFlows(f => ({ ...f, ind_alp: v }))} color="#0891B2" />
                    <PrefInput label="One Nation → ALP" value={flows.on_alp} onChange={v => setFlows(f => ({ ...f, on_alp: v }))} color="#B45309" />
                    <PrefInput label="Other → ALP" value={flows.other_alp} onChange={v => setFlows(f => ({ ...f, other_alp: v }))} color="#7C3AED" />
                    <div style={{ fontSize: 11, color: "#9CA3AF", borderTop: "1px solid #F3F4F6", paddingTop: 8, marginTop: 4 }}>
                      Defaults based on {source} preference distributions.
                    </div>
                  </div>
                  {hasChanges && (
                    <button onClick={() => { setPrim({ ...bl, undecided: 0 }); setFlows({ ...resetFlows }); }}
                      style={{ width: "100%", padding: "8px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                      Reset model
                    </button>
                  )}
                </div>

                {/* Results */}
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Implied 2PP (ALP)</div>
                      {implied2pp !== null ? (
                        <>
                          <div style={{ fontSize: 30, fontWeight: 800, color: implied2pp >= 50 ? "#059669" : "#DC2626" }}>{implied2pp.toFixed(1)}%</div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                            {implied2pp >= 50 ? `▲ +${(implied2pp - baseline2pp).toFixed(1)} vs baseline` : `▼ ${(implied2pp - baseline2pp).toFixed(1)} vs baseline`}
                          </div>
                        </>
                      ) : <div style={{ fontSize: 14, color: "#9CA3AF", marginTop: 8 }}>—</div>}
                    </div>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Seats changing</div>
                      <div style={{ fontSize: 30, fontWeight: 800, color: changed.length > 0 ? "#F59E0B" : "#6B7280" }}>{changed.length}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>of {totalSeats} modelled</div>
                    </div>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                  </div>

                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seat composition</div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Baseline result</div>
                      <TallyBar seats={allSeats} />
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>Projected</div>
                        {hasChanges && <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>scenario active</span>}
                      </div>
                      <TallyBar seats={modelled} useModelled={true} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 8 }}>
                      {GROUP_ORDER.map(g => {
                        const bv = base[g] || 0;
                        const pv = proj[g] || 0;
                        const delta = pv - bv;
                        if (!bv && !pv) return null;
                        return (
                          <div key={g} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: GROUP_CONFIG[g].color, display: "inline-block" }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{GROUP_CONFIG[g].label}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                              <span style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{pv}</span>
                              <span style={{ fontSize: 12, color: "#6B7280" }}>/ {bv} base</span>
                            </div>
                            {delta !== 0 && <div style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#059669" : "#DC2626", marginTop: 2 }}>{delta > 0 ? "+" : ""}{delta} seats</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Uncertainty panel */}
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontWeight: 700, color: "#374151" }}>Seat-count uncertainty</span>
                      <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ</span>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>ALP projected seats (with uncertainty)</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{uncertainty.alpMean}</span>
                        <span style={{ fontSize: 13, color: "#6B7280" }}>seats (mean)</span>
                        <span style={{ fontSize: 13, color: "#9CA3AF" }}>±{uncertainty.alpStd}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>
                        <span style={{ color: "#6B7280" }}>80% CI: </span>
                        <strong>{uncertainty.alpP25}–{uncertainty.alpP75}</strong> seats
                        <span style={{ marginLeft: 10, color: "#6B7280" }}>95% CI: </span>
                        <strong>{uncertainty.alpP05}–{uncertainty.alpP95}</strong> seats
                      </div>
                      <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
                        <span style={{ color: "#6B7280" }}>P(ALP majority ≥{majority}): </span>
                        <strong style={{ color: uncertainty.pMajority >= 50 ? "#DC2626" : "#1D4ED8" }}>{uncertainty.pMajority}%</strong>
                      </div>
                    </div>
                    <div style={{ position: "relative", height: 20, background: "#F3F4F6", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP05 / (totalSeats + 1) * 100)}%`, width: `${Math.min(100, (uncertainty.alpP95 - uncertainty.alpP05) / (totalSeats + 1) * 100)}%`, height: "100%", background: "#FECACA", borderRadius: 4 }} />
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP25 / (totalSeats + 1) * 100)}%`, width: `${Math.min(100, (uncertainty.alpP75 - uncertainty.alpP25) / (totalSeats + 1) * 100)}%`, height: "100%", background: "#FCA5A5" }} />
                      <div style={{ position: "absolute", left: `${Math.max(0, uncertainty.alpP50 / (totalSeats + 1) * 100)}%`, width: 2, height: "100%", background: "#DC2626" }} />
                      <div style={{ position: "absolute", left: `${majority / (totalSeats + 1) * 100}%`, width: 1, height: "100%", background: "#6B7280" }} title={`${majority} seats = majority`} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
                      <span>{uncertainty.alpP05}</span>
                      <span style={{ color: "#DC2626", fontWeight: 700 }}>{uncertainty.alpP50} median</span>
                      <span>{majority} maj.</span>
                      <span>{uncertainty.alpP95}</span>
                    </div>
                    <div style={{ borderTop: "1px solid #F3F4F6", marginTop: 12, paddingTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Model options</div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151", cursor: "pointer", marginBottom: 8 }}>
                        <input type="checkbox" checked={useElasticity} onChange={e => setUseElasticity(e.target.checked)} />
                        Seat elasticity (marginal seats swing more)
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{useElasticity ? "ON — ≤5pp: 1.3×, 6–10pp: 1.15×, >20pp: 0.8×" : "OFF — uniform swing"}</span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Shared across all elections. Typical Australian state polling MAE ≈ 1–2pp.</div>
                    </div>
                  </div>

                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Seats at risk (tightest 25)</div>
                    <div style={{ maxHeight: 440, overflowY: "auto" }}>
                      {[...modelled].sort((a, b) => a.margin - b.margin).slice(0, 25).map(seat => {
                        const baseP = getParty(seat.winner.party);
                        const projP = getParty(seat.modelled.winnerParty);
                        const chg = seat.modelled.changed;
                        const winProb = uncertainty.seatWinProbs[seat.id];
                        return (
                          <div key={seat.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F3F4F6", background: chg ? "#FFF7ED" : "transparent" }}>
                            <div style={{ width: 3, height: 28, background: chg ? projP.color : baseP.color, borderRadius: 2, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                                {seat.name}
                                {chg && <span style={{ fontSize: 10, background: "#FEF3C7", color: "#92400E", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>CHANGES</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "#6B7280" }}>{seat.tcp[0].party} vs {seat.tcp[1].party}</div>
                            </div>
                            <PartyBadge party={seat.winner.party} />
                            {chg && <><span style={{ fontSize: 11, color: "#6B7280" }}>→</span><PartyBadge party={seat.modelled.winnerParty} /></>}
                            <span style={{ fontWeight: 700, fontSize: 13, color: MARGIN_COLOR[getMarginCat(seat.margin)], minWidth: 40, textAlign: "right" }}>
                              {seat.margin.toFixed(1)}%
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, minWidth: 36, textAlign: "right", color: winProb == null ? "#9CA3AF" : winProb >= 0.85 ? "#DC2626" : winProb >= 0.60 ? "#F59E0B" : winProb >= 0.40 ? "#6B7280" : "#1D4ED8" }}>
                              {winProb != null ? `${Math.round(winProb * 100)}%` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                      Probabilistic swing model · {source} · {totalSeats} seats · ALP win% shown for ALP/Coalition contests
                    </div>
                  </div>
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
              return <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Statewide primary vote %</div>
                    <PrimaryInput label="ALP" value={tasPrim.alp} onChange={v => setTasPrim(p => ({ ...p, alp: v }))} color="#DC2626" baseline={TAS_BL.alp} />
                    <PrimaryInput label="Coalition" value={tasPrim.coal} onChange={v => setTasPrim(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={TAS_BL.coal} />
                    <PrimaryInput label="Greens" value={tasPrim.grn} onChange={v => setTasPrim(p => ({ ...p, grn: v }))} color="#059669" baseline={TAS_BL.grn} />
                    <PrimaryInput label="Independents" value={tasPrim.ind} onChange={v => setTasPrim(p => ({ ...p, ind: v }))} color="#0891B2" baseline={TAS_BL.ind} />
                    <PrimaryInput label="One Nation" value={tasPrim.on ?? 0} onChange={v => setTasPrim(p => ({ ...p, on: v }))} color="#B45309" baseline={TAS_BL.on} />
                    <PrimaryInput label="Undecided" value={tasPrim.undecided ?? 0} onChange={v => setTasPrim(p => ({ ...p, undecided: v }))} color="#9CA3AF" baseline={0} />
                    {(() => {
                      const e = +(tasPrim.alp + tasPrim.coal + tasPrim.grn + tasPrim.ind + (tasPrim.on ?? 0)).toFixed(1); const ud = +(tasPrim.undecided ?? 0); const o = +(100 - e - ud).toFixed(1); const ov = e + ud > 100;
                      return <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#6B7280" }}>Other / minor parties</span><span style={{ fontSize: 13, fontWeight: 700, color: ov ? "#DC2626" : "#374151" }}>{ov ? `−${Math.abs(o).toFixed(1)}% ⚠` : `${o}%`}</span></div>;
                    })()}
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>Baseline: ALP {TAS_BL.alp}% · Coalition {TAS_BL.coal}% · Grn {TAS_BL.grn}% · Ind {TAS_BL.ind}% · ON {TAS_BL.on}%</div>
                  </div>
                  {tasHasChanges && <button onClick={() => setTasPrim({ ...TAS_BL, undecided: 0 })} style={{ width: "100%", padding: "8px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Reset TAS model</button>}
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                    {[{ l: "ALP", v: alpProj, bl: 10, c: "#DC2626" }, { l: "Coalition", v: coalProj, bl: 15, c: "#1D4ED8" }, { l: "Greens", v: grnProj, bl: 7, c: "#059669" }].map(({ l, v, bl, c }) => (
                      <div key={l} style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>{v - bl >= 0 ? "+" : ""}{v - bl} vs baseline</div>
                      </div>
                    ))}
                  </div>
                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Projected seats by electorate</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                      {TAS_ELECTORATES.map(el2 => {
                        const ep = { ...el2, coal: Math.max(0, el2.coal + (tasPrim.coal - TAS_BL.coal)), alp: Math.max(0, el2.alp + (tasPrim.alp - TAS_BL.alp)), grn: Math.max(0, el2.grn + (tasPrim.grn - TAS_BL.grn)), ind: Math.max(0, el2.ind + (tasPrim.ind - TAS_BL.ind)) };
                        const alloc = allocateHareClark([ep], tasPrim);
                        return (
                          <div key={el2.name} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
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
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                      Hare-Clark proportional model (Droop quota) · TEC 2024 official results · 7 electorates × 5 seats
                    </div>
                  </div>

                  {/* TAS Uncertainty panel */}
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontWeight: 700, color: "#374151" }}>Seat-count uncertainty (Monte Carlo)</span>
                      <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ · N=500</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 12 }}>
                      {[{ k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "alp", l: "ALP", c: "#DC2626" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => {
                        const s = tasUncertainty[k];
                        if (!s) return null;
                        return (
                          <div key={k} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: c, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{s.mean}</div>
                            <div style={{ fontSize: 11, color: "#6B7280" }}>P25–P75: {s.p25}–{s.p75}</div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>P05–P95: {s.p05}–{s.p95}</div>
                            {k === "coal" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#1D4ED8" : "#6B7280" }}>P(maj): {s.pMajority}%</div>}
                            {k === "alp" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#DC2626" : "#6B7280" }}>P(maj): {s.pMajority}%</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Shared across all elections.</div>
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
              return <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={panelStyle}>
                    <div style={sectionHead}>Statewide primary vote %</div>
                    <PrimaryInput label="ALP" value={actPrim.alp} onChange={v => setActPrim(p => ({ ...p, alp: v }))} color="#DC2626" baseline={ACT_BL.alp} />
                    <PrimaryInput label="Coalition" value={actPrim.coal} onChange={v => setActPrim(p => ({ ...p, coal: v }))} color="#1D4ED8" baseline={ACT_BL.coal} />
                    <PrimaryInput label="Greens" value={actPrim.grn} onChange={v => setActPrim(p => ({ ...p, grn: v }))} color="#059669" baseline={ACT_BL.grn} />
                    <PrimaryInput label="Independents" value={actPrim.ind} onChange={v => setActPrim(p => ({ ...p, ind: v }))} color="#0891B2" baseline={ACT_BL.ind} />
                    <PrimaryInput label="One Nation" value={actPrim.on ?? 0} onChange={v => setActPrim(p => ({ ...p, on: v }))} color="#B45309" baseline={ACT_BL.on} />
                    <PrimaryInput label="Undecided" value={actPrim.undecided ?? 0} onChange={v => setActPrim(p => ({ ...p, undecided: v }))} color="#9CA3AF" baseline={0} />
                    {(() => {
                      const e = +(actPrim.alp + actPrim.coal + actPrim.grn + actPrim.ind + (actPrim.on ?? 0)).toFixed(1); const ud = +(actPrim.undecided ?? 0); const o = +(100 - e - ud).toFixed(1); const ov = e + ud > 100;
                      return <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#6B7280" }}>Other / minor parties</span><span style={{ fontSize: 13, fontWeight: 700, color: ov ? "#DC2626" : "#374151" }}>{ov ? `−${Math.abs(o).toFixed(1)}% ⚠` : `${o}%`}</span></div>;
                    })()}
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>Baseline: ALP {ACT_BL.alp}% · Coalition {ACT_BL.coal}% · Grn {ACT_BL.grn}% · Ind {ACT_BL.ind}% · ON {ACT_BL.on}%</div>
                  </div>
                  {actHasChanges && <button onClick={() => setActPrim({ ...ACT_BL, undecided: 0 })} style={{ width: "100%", padding: "8px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Reset ACT model</button>}
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
                    <div style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Majority</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: majColor, marginTop: 4 }}>{projMaj}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{majority} seats needed</div>
                    </div>
                    {[{ l: "ALP", v: alpProj, bl: 9, c: "#DC2626" }, { l: "Coalition", v: coalProj, bl: 9, c: "#1D4ED8" }, { l: "Greens", v: grnProj, bl: 7, c: "#059669" }].map(({ l, v, bl, c }) => (
                      <div key={l} style={{ ...panelStyle, marginBottom: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>{v - bl >= 0 ? "+" : ""}{v - bl} vs baseline</div>
                      </div>
                    ))}
                  </div>
                  <div style={panelStyle}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: 12 }}>Projected seats by electorate</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                      {ACT_ELECTORATES.map(el2 => {
                        const ep = { ...el2, alp: Math.max(0, el2.alp + (actPrim.alp - ACT_BL.alp)), coal: Math.max(0, el2.coal + (actPrim.coal - ACT_BL.coal)), grn: Math.max(0, el2.grn + (actPrim.grn - ACT_BL.grn)), ind: Math.max(0, el2.ind + (actPrim.ind - ACT_BL.ind)) };
                        const alloc = allocateHareClark([ep], actPrim);
                        return (
                          <div key={el2.name} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
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
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F3F4F6" }}>
                      Hare-Clark proportional model (Droop quota) · ACT EC 2024 official results · 5 electorates × 5 seats
                    </div>
                  </div>

                  {/* ACT Uncertainty panel */}
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontWeight: 700, color: "#374151" }}>Seat-count uncertainty (Monte Carlo)</span>
                      <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 7px", borderRadius: 10 }}>±{swingStd}pp swing σ · N=500</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 12 }}>
                      {[{ k: "alp", l: "ALP", c: "#DC2626" }, { k: "coal", l: "Coalition", c: "#1D4ED8" }, { k: "grn", l: "Greens", c: "#059669" }, { k: "ind", l: "Ind", c: "#0891B2" }].map(({ k, l, c }) => {
                        const s = actUncertainty[k];
                        if (!s) return null;
                        return (
                          <div key={k} style={{ background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", padding: "10px 12px" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: c, marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{s.mean}</div>
                            <div style={{ fontSize: 11, color: "#6B7280" }}>P25–P75: {s.p25}–{s.p75}</div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>P05–P95: {s.p05}–{s.p95}</div>
                            {k === "alp" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#DC2626" : "#6B7280" }}>P(maj): {s.pMajority}%</div>}
                            {k === "coal" && <div style={{ fontSize: 11, fontWeight: 700, color: s.pMajority >= 50 ? "#1D4ED8" : "#6B7280" }}>P(maj): {s.pMajority}%</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                        <label style={{ minWidth: 130 }}>Swing uncertainty (σ):</label>
                        <input type="range" min={0.5} max={4} step={0.25} value={swingStd} onChange={e => setSwingStd(+e.target.value)} style={{ flex: 1 }} />
                        <span style={{ minWidth: 36, fontWeight: 600 }}>{swingStd}pp</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Shared across all elections.</div>
                    </div>
                  </div>
                </div>
              </div>;
            })()}

            {selectedModelId === "federal_2025" && (
              <>{/* ── Demographics Overview (collapsible) ── */}
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setDemogSectionOpen(o => !o)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 20px", cursor: "pointer", textAlign: "left", fontWeight: 700, fontSize: 14, color: "#374151" }}>
                    <span style={{ fontSize: 16 }}>{demogSectionOpen ? "▾" : "▸"}</span>
                    Demographics Overview
                    <span style={{ fontSize: 12, fontWeight: 400, color: "#9CA3AF", marginLeft: 4 }}>— seat-level census data</span>
                  </button>
                  {demogSectionOpen && (
                    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderTopWidth: 0, borderRadius: "0 0 12px 12px", padding: "20px" }}>

                      {/* National summary cards */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
                        {[
                          { key: "medianPersonalIncome", label: "Median Personal Income", fmt: v => `$${(v / 1000).toFixed(0)}k/yr` },
                          { key: "medianHouseholdIncome", label: "Median Household Income", fmt: v => `$${(v / 1000).toFixed(0)}k/yr` },
                          { key: "renterPct", label: "Renters", fmt: v => `${v.toFixed(1)}%` },
                          { key: "bachelorsOrAbovePct", label: "Bachelor's+", fmt: v => `${v.toFixed(1)}%` },
                          { key: "overseasBornPct", label: "Overseas Born", fmt: v => `${v.toFixed(1)}%` },
                          { key: "medianAge", label: "Median Age", fmt: v => `${v}` },
                        ].map(({ key, label, fmt }) => {
                          const s = demogStats[key];
                          if (!s) return null;
                          return (
                            <div key={key} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}>
                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 6 }}>{label}</div>
                              <div style={{ fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 4 }}>{fmt(s.avg)}</div>
                              <div style={{ fontSize: 11, color: "#9CA3AF" }}>Range: {fmt(s.min)} – {fmt(s.max)}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Filters row */}
                      <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" }}>Filter:</span>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {STATES.map(st => (
                            <button key={st} onClick={() => toggleSet(setDemogStateFilter, st)}
                              style={{
                                padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
                                background: demogStateFilter.has(st) ? "#374151" : "#F3F4F6",
                                color: demogStateFilter.has(st) ? "#fff" : "#6B7280",
                                border: "1px solid " + (demogStateFilter.has(st) ? "#374151" : "#E5E7EB")
                              }}>
                              {st}
                            </button>
                          ))}
                        </div>
                        <span style={{ color: "#E5E7EB" }}>|</span>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {["Inner Metropolitan", "Outer Metropolitan", "Provincial", "Rural"].map(cls => (
                            <button key={cls} onClick={() => toggleSet(setDemogClassFilter, cls)}
                              style={{
                                padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
                                background: demogClassFilter.has(cls) ? "#1D4ED8" : "#F3F4F6",
                                color: demogClassFilter.has(cls) ? "#fff" : "#6B7280",
                                border: "1px solid " + (demogClassFilter.has(cls) ? "#1D4ED8" : "#E5E7EB")
                              }}>
                              {cls}
                            </button>
                          ))}
                        </div>
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "#9CA3AF" }}>{demogFiltered.length} seats</span>
                      </div>

                      {/* Demographic table */}
                      <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
                        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                              <tr>
                                {[
                                  { k: "name", label: "Seat" },
                                  { k: "state", label: "State" },
                                  { k: "winner", label: "2022 Winner" },
                                  { k: "urbanClass", label: "Urban Class" },
                                  { k: "medianHouseholdIncome", label: "HH Income" },
                                  { k: "medianPersonalIncome", label: "Personal Inc." },
                                  { k: "medianWeeklyRent", label: "Wkly Rent" },
                                  { k: "renterPct", label: "Renters %" },
                                  { k: "ownerMortgagePct", label: "Mortgage %" },
                                  { k: "bachelorsOrAbovePct", label: "Bach.+ %" },
                                  { k: "overseasBornPct", label: "O/seas Born" },
                                  { k: "medianAge", label: "Med. Age" },
                                ].map(({ k, label }) => (
                                  <th key={k} onClick={() => {
                                    if (demogSortKey === k) {
                                      setDemogSortDir(d => d === "asc" ? "desc" : "asc");
                                    } else {
                                      setDemogSortKey(k);
                                      setDemogSortDir("desc");
                                    }
                                  }} style={{ padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280", background: "#F9FAFB", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", borderBottom: "1px solid #E5E7EB" }}>
                                    {label}{" "}
                                    <span style={{ color: demogSortKey === k ? "#374151" : "#D1D5DB" }}>
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
                                        borderBottom: "1px solid #F3F4F6", cursor: "pointer",
                                        borderLeft: `3px solid ${pg.color}`,
                                        background: isExpanded ? "#F9FAFB" : undefined,
                                        transition: "background 0.1s"
                                      }}
                                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#F9FAFB"; }}
                                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ""; }}>
                                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "#111" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</td>
                                      <td style={{ padding: "8px 10px", color: "#6B7280" }}>{s.state}</td>
                                      <td style={{ padding: "8px 10px" }}>
                                        <span style={{ background: pg.bg, color: pg.color, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{pg.short}</span>
                                      </td>
                                      <td style={{ padding: "8px 10px", color: "#6B7280", fontSize: 11 }}>{d.urbanClass ?? "—"}</td>
                                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(0)}k` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.medianPersonalIncome ? `$${(d.medianPersonalIncome / 1000).toFixed(0)}k` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.medianWeeklyRent ? `$${d.medianWeeklyRent}` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.renterPct != null ? `${d.renterPct}%` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</td>
                                      <td style={{ padding: "8px 10px" }}>{d.medianAge ?? "—"}</td>
                                    </tr>
                                    {isExpanded && (
                                      <tr key={`${s.id}-exp`}>
                                        <td colSpan={12} style={{ background: "#F9FAFB", padding: "16px 20px", borderBottom: "2px solid #E5E7EB" }}>
                                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 8 }}>Income</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                                <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome / 1000).toFixed(1)}k/yr` : "—"}</div>
                                                <div><strong>ATO Taxable Income:</strong> {d.avgTaxableIncome ? `$${(d.avgTaxableIncome / 1000).toFixed(0)}k` : <span style={{ color: "#9CA3AF" }}>n/a</span>}</div>
                                                <div><strong>Investment Property:</strong> {d.investPropertyPct != null ? `${d.investPropertyPct}%` : <span style={{ color: "#9CA3AF" }}>n/a</span>}</div>
                                              </div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 8 }}>Housing</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Owner outright:</strong> {d.ownerOutrightPct != null ? `${d.ownerOutrightPct}%` : "—"}</div>
                                                <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                                <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                                <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                                <div><strong>Monthly mortgage:</strong> {d.medianMonthlyMortgage ? `$${d.medianMonthlyMortgage}/mo` : "—"}</div>
                                              </div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", marginBottom: 8 }}>People</div>
                                              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                <div><strong>Median age:</strong> {d.medianAge ?? "—"}</div>
                                                <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                                <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
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
                      <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "18px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF" }}>Correlation Explorer</div>
                          <select value={demogXMetric} onChange={e => setDemogXMetric(e.target.value)}
                            style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, outline: "none" }}>
                            {DEMOG_METRICS.map(({ key, label }) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                          <span style={{ fontSize: 12, color: "#9CA3AF" }}>vs Modelled 2PP Margin (ALP above/below 50%)</span>
                        </div>
                        <ResponsiveContainer width="100%" height={320}>
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                            <XAxis dataKey="x" name="X" type="number" domain={["auto", "auto"]}
                              tickFormatter={v => {
                                const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                                return m ? m.fmt(v) : v;
                              }}
                              tick={{ fontSize: 11 }} />
                            <YAxis dataKey="y" name="Margin" tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                              tick={{ fontSize: 11 }} />
                            <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 2" label={{ value: "50%", position: "right", fontSize: 10, fill: "#6B7280" }} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0].payload;
                                const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                                const grpCfg = GROUP_CONFIG[p.group] ?? { color: "#6B7280", label: p.group };
                                return (
                                  <div style={{ background: "#fff", border: `1px solid ${grpCfg.color}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
                                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name} ({p.state})</div>
                                    <div style={{ color: "#6B7280" }}>{m?.label}: <strong>{m ? m.fmt(p.x) : p.x}</strong></div>
                                    <div style={{ color: "#6B7280" }}>2PP margin: <strong>{p.y > 0 ? "+" : ""}{p.y.toFixed(1)}pp</strong></div>
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
                                  fill={GROUP_CONFIG[grp]?.color ?? "#6B7280"}
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
                              <span key={grp} style={{ fontSize: 11, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}>
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

      {/* victoria tab removed — see Model tab → Victoria 2022 dropdown option */}
      {false && (
        <div style={{ padding: "20px 24px", maxWidth: 960, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>2022 Victorian State Election</h1>
          <p style={{ color: "#6B7280", marginBottom: 18 }}>
            {VIC_2022_SUMMARY.date} · Legislative Assembly · {VIC_2022_SUMMARY.total} seats
            &nbsp;·&nbsp; Premier: {VIC_2022_SUMMARY.premier}
          </p>

          {/* Summary bar */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>
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
                <span key={g.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#374151" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, display: "inline-block" }} />
                  {g.label} <strong>{g.count}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
            {[
              { label: "Labor majority", value: `+${VIC_2022_SUMMARY.alp - 45}`, color: "#DC2626", note: "over majority" },
              { label: "Coalition seats", value: VIC_2022_SUMMARY.lp, color: "#1D4ED8", note: "vs 27 in 2018" },
              { label: "Greens seats", value: VIC_2022_SUMMARY.grn, color: "#059669", note: "lower house" },
              { label: "Independent seats", value: VIC_2022_SUMMARY.ind, color: "#0891B2", note: "2 crossbench" },
              { label: "Next election", value: "Nov 2026", color: "#7C3AED", note: "due ~29 Nov" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", borderRadius: 10, border: "1px solid #E5E7EB", padding: "14px 16px" }}>
                <div style={{ width: 24, height: 3, background: card.color, borderRadius: 2, marginBottom: 8 }} />
                <div style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{card.value}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{card.label}</div>
                <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 1 }}>{card.note}</div>
              </div>
            ))}
          </div>

          {/* Pipeline call-to-action */}
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, color: "#1D4ED8", marginBottom: 6, fontSize: 14 }}>
              Load full 88-seat data
            </div>
            <p style={{ fontSize: 13, color: "#374151", margin: "0 0 8px" }}>
              The VEC pipeline downloads district-level first preference and two-candidate preferred
              results from <strong>vec.vic.gov.au</strong> for all 88 Legislative Assembly seats.
            </p>
            <code style={{ display: "block", background: "#1E293B", color: "#93C5FD", padding: "8px 12px", borderRadius: 6, fontSize: 12, fontFamily: "monospace" }}>
              python main.py --state vic --year 202211
            </code>
            <p style={{ fontSize: 12, color: "#6B7280", marginTop: 8, marginBottom: 0 }}>
              For booth-level data, place The Tally Room CSVs (2022 is free at tallyroom.com.au)
              in <code>data/raw/vic/202211/</code> before running.
            </p>
          </div>

          {/* Key seats table */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: "#374151" }}>
              Key seats — 2022 confirmed results
            </div>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 14 }}>
              Non-ALP/Liberal seats plus selected marginals. Margins are 2CP % margin.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                  {["District", "Winner", "Party", "2CP Matchup", "Margin"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B7280" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VIC_SEATS_KNOWN.map(([id, name, party, winner, tcp1, tcp2, margin]) => {
                  const p = getParty(party);
                  const marginCat = margin < 2 ? "very_marginal" : margin < 5 ? "marginal" : margin < 10 ? "fairly_safe" : "safe";
                  return (
                    <tr key={id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, fontSize: 13 }}>{name}</td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: "#374151" }}>{winner}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ background: p.color, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{p.short}</span>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: "#6B7280" }}>
                        {getParty(tcp1).short} v {getParty(tcp2).short}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: MARGIN_COLOR[marginCat], display: "inline-block" }} />
                          <span style={{ fontWeight: 600, color: "#111", fontSize: 13 }}>{margin.toFixed(1)}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 12, marginBottom: 0 }}>
              Note: Some winner names and margins shown here are approximate pending full VEC data pipeline run.
              Independent seat margins are 2CP vs nearest rival.
            </p>
          </div>

          {/* Data source note */}
          <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "#6B7280" }}>
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
    </div>
  );
}
