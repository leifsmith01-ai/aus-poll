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
  [9001, "Prahran",  "GRN", "Sam Hibbins",     "GRN", "LP",  2.2 ],
  [9002, "Brunswick","GRN", "Tim Read",         "GRN", "ALP", 11.1],
  [9003, "Northcote","GRN", "Kat Theophanous",  "GRN", "ALP",  5.0],
  [9004, "Richmond", "GRN", "Gabrielle De Vietri","GRN","ALP",  3.1],
  // ── Independents (2 seats) ──────────────────────────────────────────────────
  [9005, "Mildura",    "IND", "Ali Cupper",     "IND", "LP",  8.5 ],
  [9006, "Shepparton", "IND", "Kim O'Keeffe",   "IND", "ALP", 4.8 ],
  // ── Sample ALP holds (inner suburban) ──────────────────────────────────────
  [9010, "Albert Park",  "ALP", "Nina Taylor",      "ALP", "LP",  18.4],
  [9011, "Altona",       "ALP", "Juliana Addison",  "ALP", "LP",  28.1],
  [9012, "Footscray",    "ALP", "Katie Hall",        "ALP", "GRN", 14.9],
  [9013, "Williamstown", "ALP", "Melissa Horne",    "ALP", "LP",  26.3],
  [9014, "Geelong",      "ALP", "Christine Couzens","ALP", "LP",  20.7],
  [9015, "Wendouree",    "ALP", "Juliana Addison",  "ALP", "LP",  22.4],
  // ── Sample LP holds ────────────────────────────────────────────────────────
  [9020, "Kew",           "LP",  "Tim Smith",        "LP",  "ALP", 11.3],
  [9021, "Brighton",      "LP",  "James Newbury",    "LP",  "ALP", 16.8],
  [9022, "Hawthorn",      "LP",  "John Pesutto",     "LP",  "ALP",  2.9],
  [9023, "Box Hill",      "LP",  "Paul Hamer",       "ALP", "LP",   1.4],  // ALP flipped LP
];

// 2022 VIC state result summary (88 seats total)
const VIC_2022_SUMMARY = {
  alp: 56, lp: 26, grn: 4, ind: 2, total: 88,
  date: "26 November 2022",
  premier: "Daniel Andrews (ALP)",
};

// ─── Party config ─────────────────────────────────────────────────────────────
const PARTY = {
  ALP: { short:"Labor",       color:"#DC2626", bg:"#FEE2E2", group:"alp"        },
  LP:  { short:"Liberal",     color:"#1D4ED8", bg:"#DBEAFE", group:"coalition"  },
  LNP: { short:"LNP",         color:"#1D4ED8", bg:"#DBEAFE", group:"coalition"  },
  NP:  { short:"Nationals",   color:"#065F46", bg:"#D1FAE5", group:"coalition"  },
  CLP: { short:"CLP",         color:"#1E40AF", bg:"#DBEAFE", group:"coalition"  },
  GRN: { short:"Greens",      color:"#059669", bg:"#D1FAE5", group:"greens"     },
  IND: { short:"Independent", color:"#0891B2", bg:"#CFFAFE", group:"teal"       },
  KAP: { short:"KAP",         color:"#92400E", bg:"#FEF3C7", group:"crossbench" },
  CA:  { short:"Centre All.", color:"#7C3AED", bg:"#EDE9FE", group:"teal"       },
  ON:  { short:"One Nation",  color:"#B45309", bg:"#FEF3C7", group:"one_nation" },
};
const getParty = (ab) => PARTY[ab] ?? { short:ab||"?", color:"#6B7280", bg:"#F3F4F6", group:"crossbench" };

const GROUP_CONFIG = {
  alp:        { label:"Labor",              color:"#DC2626" },
  coalition:  { label:"Coalition",          color:"#1D4ED8" },
  greens:     { label:"Greens",             color:"#059669" },
  teal:       { label:"Independents",       color:"#0891B2" },
  one_nation: { label:"One Nation",         color:"#B45309" },
  crossbench: { label:"Other Crossbench",   color:"#7C3AED" },
};
const GROUP_ORDER = ["alp","coalition","greens","teal","one_nation","crossbench"];

const STATES = ["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"];
const MARGINS = ["very_marginal","marginal","fairly_safe","safe"];
const MARGIN_LABEL = {very_marginal:"Very marginal (<2%)",marginal:"Marginal (2–5%)",fairly_safe:"Fairly safe (5–10%)",safe:"Safe (>10%)"};
const MARGIN_COLOR = {very_marginal:"#DC2626",marginal:"#F59E0B",fairly_safe:"#10B981",safe:"#6B7280"};

// 2022 actual national primary vote % (baseline for swing calculations)
const BASELINE_2022 = { alp:32.6, coal:35.7, grn:12.2, teal:5.1, on:4.7 };
const NATIONAL_2PP_2022 = 52.13; // ALP 2PP at 2022 election

// Seat-level 2022 ON first-preference %, extracted from AEC results.
// Seats omitted here use the national baseline (4.7%) + national ON swing.
const ON_FP_2022 = {
  // QLD — regional seats where ON is historically strongest
  166: 13.8, // Hinkler
  178: 11.2, // Wide Bay
  158: 10.5, // Dawson
  157: 10.1, // Capricornia
  167:  9.2, // Kennedy
  165:  8.7, // Herbert
  311:  8.6, // Flynn
  168:  8.1, // Leichhardt
  170:  8.0, // Maranoa
  316:  7.8, // Wright
  162:  6.9, // Forde
  304:  6.8, // Blair
  302:  6.5, // Longman
  175:  6.3, // Petrie
  161:  6.1, // Fisher
  171:  6.0, // McPherson
  310:  5.9, // Bonner
  155:  5.8, // Bowman
  252:  5.7, // Dickson
  160:  5.6, // Fairfax
  172:  5.3, // Moncrieff
  164:  4.6, // Groom
  163:  4.5, // Griffith
  // NSW — regional seats
  126: 10.5, // Hunter
  138:  9.5, // Page
  139:  8.1, // Parkes
  135:  7.9, // New England
  249:  7.5, // Paterson
  115:  7.3, // Dobell
  130:  7.4, // Lyne
  145:  7.1, // Richmond
  148:  7.0, // Shortland
  146:  6.8, // Robertson
  250:  6.5, // Riverina
  117:  6.0, // Eden-Monaro
  // WA — regional
  312:  9.8, // Durack
  243:  7.6, // O'Connor
  239:  7.0, // Forrest
  236:  6.5, // Canning
  305:  5.8, // Hasluck
  242:  5.5, // Moore
  // SA
  180:  7.2, // Barker
  183:  6.8, // Grey
  // TAS
  193:  7.2, // Braddon
  192:  6.4, // Bass
  196:  6.1, // Lyons
  // NT
  306:  8.1, // Lingiari
  307:  5.3, // Solomon
  // VIC — regional only (metro seats default to national ~4.7%)
  213:  7.0, // Gippsland
  224:  6.1, // Mallee
  324:  5.3, // Nicholls
};

// Estimate seat-level ON first preference using 2022 seat baseline + national swing.
function estimateSeatOnFp(seatId, swings) {
  const base = ON_FP_2022[seatId] ?? BASELINE_2022.on;
  return Math.max(0, base + swings.on);
}

// ─── Seat data (151 seats, 2022 AEC final results incl. postal/absent votes) ──
// Format: [id,name,state,winnerParty,winnerName,tcpP1,tcpP2,margin]
const _S=[
  [318,"Bean","ACT","ALP","David Smith","ALP","LP",25.89],
  [101,"Canberra","ACT","ALP","Alicia Payne","ALP","GRN",24.39],
  [102,"Fenner","ACT","ALP","Andrew Leigh","ALP","LP",31.39],
  [103,"Banks","NSW","LP","David Coleman","LP","ALP",6.4],
  [104,"Barton","NSW","ALP","Linda Burney","ALP","LP",31.09],
  [105,"Bennelong","NSW","ALP","Jerome Laxale","ALP","LP",1.96],
  [106,"Berowra","NSW","LP","Julian Leeser","LP","ALP",19.54],
  [107,"Blaxland","NSW","ALP","Jason Clare","ALP","LP",29.87],
  [108,"Bradfield","NSW","LP","Paul Fletcher","LP","IND",8.47],
  [109,"Calare","NSW","NP","Andrew Gee","NP","IND",19.36],
  [111,"Chifley","NSW","ALP","Ed Husic","ALP","LP",26.93],
  [112,"Cook","NSW","LP","Scott Morrison","LP","ALP",24.89],
  [113,"Cowper","NSW","NP","Pat Conaghan","NP","IND",4.65],
  [114,"Cunningham","NSW","ALP","Alison Byrnes","ALP","LP",29.4],
  [115,"Dobell","NSW","ALP","Emma Mcbride","ALP","LP",13.04],
  [117,"Eden-Monaro","NSW","ALP","Kristy Mcbain","ALP","LP",16.4],
  [118,"Farrer","NSW","LP","Sussan Ley","LP","ALP",32.71],
  [119,"Fowler","NSW","IND","Dai Le","IND","ALP",3.25],
  [120,"Gilmore","NSW","ALP","Fiona Phillips","ALP","LP",0.33],
  [121,"Grayndler","NSW","ALP","Anthony Albanese","ALP","GRN",34.1],
  [122,"Greenway","NSW","ALP","Michelle Rowland","ALP","LP",23.06],
  [124,"Hughes","NSW","LP","Jenny Ware","LP","ALP",14.01],
  [125,"Hume","NSW","LP","Angus Taylor","LP","ALP",15.44],
  [126,"Hunter","NSW","ALP","Dan Repacholi","ALP","NP",8.05],
  [127,"Kingsford Smith","NSW","ALP","Matt Thistlethwaite","ALP","LP",29.0],
  [128,"Lindsay","NSW","LP","Melissa Mcintosh","LP","ALP",12.68],
  [130,"Lyne","NSW","NP","David Gillespie","NP","ALP",27.59],
  [131,"Macarthur","NSW","ALP","Mike Freelander","ALP","LP",17.05],
  [132,"Mackellar","NSW","IND","Sophie Scamps","IND","LP",5.01],
  [133,"Macquarie","NSW","ALP","Susan Templeman","ALP","LP",15.54],
  [315,"McMahon","NSW","ALP","Chris Bowen","ALP","LP",18.98],
  [134,"Mitchell","NSW","LP","Alex Hawke","LP","ALP",21.38],
  [135,"New England","NSW","NP","Barnaby Joyce","NP","ALP",32.87],
  [136,"Newcastle","NSW","ALP","Sharon Claydon","ALP","LP",35.96],
  [137,"North Sydney","NSW","IND","Kylea Jane Tink","IND","LP",5.83],
  [138,"Page","NSW","NP","Kevin Hogan","NP","ALP",21.47],
  [139,"Parkes","NSW","NP","Mark Coulton","NP","ALP",35.68],
  [140,"Parramatta","NSW","ALP","Andrew Charlton","ALP","LP",9.13],
  [249,"Paterson","NSW","ALP","Meryl Swanson","ALP","LP",6.62],
  [144,"Reid","NSW","ALP","Sally Sitou","ALP","LP",10.39],
  [145,"Richmond","NSW","ALP","Justine Elliot","ALP","NP",16.46],
  [250,"Riverina","NSW","NP","Michael Mccormack","NP","ALP",29.69],
  [146,"Robertson","NSW","ALP","Gordon Reid","ALP","LP",4.52],
  [148,"Shortland","NSW","ALP","Pat Conroy","ALP","LP",11.64],
  [149,"Sydney","NSW","ALP","Tanya Plibersek","ALP","GRN",33.37],
  [151,"Warringah","NSW","IND","Zali Steggall","IND","LP",21.91],
  [251,"Watson","NSW","ALP","Tony Burke","ALP","LP",30.2],
  [152,"Wentworth","NSW","IND","Allegra Spender","IND","LP",8.38],
  [153,"Werriwa","NSW","ALP","Anne Maree Stanley","ALP","LP",11.64],
  [150,"Whitlam","NSW","ALP","Stephen Jones","ALP","LP",20.15],
  [306,"Lingiari","NT","ALP","Marion Scrymgour","ALP","CLP",1.89],
  [307,"Solomon","NT","ALP","Luke Gosling","ALP","CLP",18.73],
  [304,"Blair","QLD","ALP","Shayne Neumann","ALP","LNP",10.46],
  [310,"Bonner","QLD","LNP","Ross Vasta","LNP","ALP",6.82],
  [155,"Bowman","QLD","LNP","Henry Pike","LNP","ALP",11.02],
  [156,"Brisbane","QLD","GRN","Stephen Bates","GRN","LNP",7.47],
  [157,"Capricornia","QLD","LNP","Michelle Landry","LNP","ALP",13.18],
  [158,"Dawson","QLD","LNP","Andrew Willcox","LNP","ALP",20.83],
  [252,"Dickson","QLD","LNP","Peter Dutton","LNP","ALP",3.4],
  [159,"Fadden","QLD","LNP","Stuart Robert","LNP","ALP",21.25],
  [160,"Fairfax","QLD","LNP","Ted O'brien","LNP","ALP",17.9],
  [161,"Fisher","QLD","LNP","Andrew Wallace","LNP","ALP",17.34],
  [311,"Flynn","QLD","LNP","Colin Boyce","LNP","ALP",7.64],
  [162,"Forde","QLD","LNP","Bert Van Manen","LNP","ALP",8.47],
  [163,"Griffith","QLD","GRN","Max Chandler-mather","GRN","LNP",20.91],
  [164,"Groom","QLD","LNP","Garth Hamilton","LNP","IND",13.77],
  [165,"Herbert","QLD","LNP","Phillip Thompson","LNP","ALP",23.55],
  [166,"Hinkler","QLD","LNP","Keith Pitt","LNP","ALP",20.15],
  [167,"Kennedy","QLD","KAP","Bob Katter","KAP","LNP",26.19],
  [168,"Leichhardt","QLD","LNP","Warren Entsch","LNP","ALP",6.88],
  [169,"Lilley","QLD","ALP","Anika Wells","ALP","LNP",21.08],
  [302,"Longman","QLD","LNP","Terry Young","LNP","ALP",6.16],
  [170,"Maranoa","QLD","LNP","David Littleproud","LNP","ALP",44.24],
  [171,"McPherson","QLD","LNP","Karen Andrews","LNP","ALP",18.67],
  [172,"Moncrieff","QLD","LNP","Angie Bell","LNP","ALP",22.39],
  [173,"Moreton","QLD","ALP","Graham Perrett","ALP","LNP",18.18],
  [174,"Oxley","QLD","ALP","Milton Dick","ALP","LNP",23.19],
  [175,"Petrie","QLD","LNP","Luke Howarth","LNP","ALP",8.87],
  [176,"Rankin","QLD","ALP","Jim Chalmers","ALP","LNP",18.18],
  [177,"Ryan","QLD","GRN","Elizabeth Watson-brown","GRN","LNP",5.29],
  [178,"Wide Bay","QLD","LNP","Llew O'brien","LNP","ALP",22.69],
  [316,"Wright","QLD","LNP","Scott Buchholz","LNP","ALP",21.79],
  [179,"Adelaide","SA","ALP","Steve Georganas","ALP","LP",23.83],
  [180,"Barker","SA","LP","Tony Pasin","LP","ALP",33.24],
  [182,"Boothby","SA","ALP","Louise Miller-frost","ALP","LP",6.55],
  [183,"Grey","SA","LP","Rowan Ramsey","LP","ALP",20.13],
  [185,"Hindmarsh","SA","ALP","Mark Butler","ALP","LP",17.89],
  [186,"Kingston","SA","ALP","Amanda Rishworth","ALP","LP",32.7],
  [187,"Makin","SA","ALP","Tony Zappia","ALP","LP",21.6],
  [188,"Mayo","SA","XEN","Rebekha Sharkie","XEN","LP",24.52],
  [325,"Spence","SA","ALP","Matt Burnell","ALP","LP",25.8],
  [190,"Sturt","SA","LP","James Stevens","LP","ALP",0.9],
  [192,"Bass","TAS","LP","Bridget Kathleen Archer","LP","ALP",2.87],
  [193,"Braddon","TAS","LP","Gavin Pearce","LP","ALP",16.06],
  [319,"Clark","TAS","IND","Andrew Wilkie","IND","ALP",41.65],
  [195,"Franklin","TAS","ALP","Julie Collins","ALP","LP",27.4],
  [196,"Lyons","TAS","ALP","Brian Mitchell","ALP","LP",1.83],
  [197,"Aston","VIC","LP","Alan Tudge","LP","ALP",5.62],
  [198,"Ballarat","VIC","ALP","Catherine King","ALP","LP",25.95],
  [200,"Bendigo","VIC","ALP","Lisa Chesters","ALP","LP",24.21],
  [201,"Bruce","VIC","ALP","Julian Hill","ALP","LP",13.17],
  [203,"Calwell","VIC","ALP","Maria Vamvakinou","ALP","LP",24.79],
  [204,"Casey","VIC","LP","Aaron Violi","LP","ALP",2.96],
  [205,"Chisholm","VIC","ALP","Carina Garland","ALP","LP",12.82],
  [320,"Cooper","VIC","ALP","Ged Kearney","ALP","GVIC",17.35],
  [328,"Corangamite","VIC","ALP","Libby Coker","ALP","LP",15.21],
  [208,"Corio","VIC","ALP","Richard Marles","ALP","LP",25.68],
  [209,"Deakin","VIC","LP","Michael Sukkar","LP","ALP",0.37],
  [210,"Dunkley","VIC","ALP","Peta Murphy","ALP","LP",12.54],
  [211,"Flinders","VIC","LP","Zoe Mckenzie","LP","ALP",13.4],
  [321,"Fraser","VIC","ALP","Daniel Mulino","ALP","LP",33.01],
  [212,"Gellibrand","VIC","ALP","Tim Watts","ALP","LP",23.08],
  [213,"Gippsland","VIC","NP","Darren Chester","NP","ALP",41.13],
  [214,"Goldstein","VIC","IND","Zoe Daniel","IND","LP",5.74],
  [309,"Gorton","VIC","ALP","Brendan O'connor","ALP","LP",19.94],
  [326,"Hawke","VIC","ALP","Sam Rae","ALP","LP",15.25],
  [215,"Higgins","VIC","ALP","Michelle Ananda-rajah","ALP","LP",4.13],
  [216,"Holt","VIC","ALP","Cassandra Fernando","ALP","LP",14.24],
  [217,"Hotham","VIC","ALP","Clare O'neil","ALP","LP",28.5],
  [218,"Indi","VIC","IND","Helen Haines","IND","LP",17.88],
  [219,"Isaacs","VIC","ALP","Mark Dreyfus","ALP","LP",13.7],
  [220,"Jagajaga","VIC","ALP","Kate Thwaites","ALP","LP",24.69],
  [221,"Kooyong","VIC","IND","Monique Ryan","IND","LP",5.89],
  [223,"La Trobe","VIC","LP","Jason Wood","LP","ALP",17.38],
  [222,"Lalor","VIC","ALP","Joanne Ryan","ALP","LP",25.65],
  [322,"Macnamara","VIC","ALP","Josh Burns","ALP","LP",24.5],
  [224,"Mallee","VIC","NP","Anne Webster","NP","ALP",37.97],
  [225,"Maribyrnong","VIC","ALP","Bill Shorten","ALP","LP",24.89],
  [226,"McEwen","VIC","ALP","Rob Mitchell","ALP","LP",6.56],
  [228,"Melbourne","VIC","GVIC","Adam Bandt","GVIC","ALP",20.3],
  [229,"Menzies","VIC","LP","Keith Wolahan","LP","ALP",1.36],
  [323,"Monash","VIC","LP","Russell Broadbent","LP","ALP",5.79],
  [324,"Nicholls","VIC","NP","Sam Birrell","NP","IND",7.62],
  [232,"Scullin","VIC","ALP","Andrew Giles","ALP","LP",31.17],
  [233,"Wannon","VIC","LP","Dan Tehan","LP","IND",7.85],
  [234,"Wills","VIC","ALP","Peter Khalil","ALP","GVIC",17.14],
  [235,"Brand","WA","ALP","Madeleine King","ALP","LP",33.42],
  [317,"Burt","WA","ALP","Matt Keogh","ALP","LP",30.43],
  [236,"Canning","WA","LP","Andrew Hastie","LP","ALP",7.17],
  [237,"Cowan","WA","ALP","Anne Aly","ALP","LP",21.63],
  [238,"Curtin","WA","IND","Kate Chaney","IND","LP",2.53],
  [312,"Durack","WA","LP","Melissa Price","LP","ALP",8.54],
  [239,"Forrest","WA","LP","Nola Marino","LP","ALP",8.58],
  [240,"Fremantle","WA","ALP","Josh Wilson","ALP","LP",33.77],
  [305,"Hasluck","WA","ALP","Tania Lawrence","ALP","LP",12.0],
  [242,"Moore","WA","LP","Ian Goodenough","LP","ALP",1.32],
  [243,"O'Connor","WA","LP","Rick Wilson","LP","ALP",13.95],
  [244,"Pearce","WA","ALP","Tracey Roberts","ALP","LP",18.08],
  [245,"Perth","WA","ALP","Patrick Gorman","ALP","LP",29.6],
  [247,"Swan","WA","ALP","Zaneta Mascarenhas","ALP","LP",17.55],
  [248,"Tangney","WA","ALP","Sam Lim","ALP","LP",4.76],
];
const SEATS=_S.map(([id,name,state,wp,wn,t1,t2,m])=>({
  id,name,state,margin:m,swing:0,fp:[],
  winner:{party:wp,name:wn},
  tcp:[{party:t1,pct:+(50+m/2).toFixed(2)},{party:t2,pct:+(50-m/2).toFixed(2)}]
}));

// ─── Sample polling data (pre-loaded) ────────────────────────────────────────
// BludgerTrack national polls — sourced from pollbludger.net/fed2028/bludgertrack
// 'on' = One Nation first-preference %; 'oth' computed as 100 - alp - coal - grn - on
// tpp = ALP two-party preferred (null if not reported by pollster)
const INITIAL_POLLS = [
  { id:1,  pollster:"Election Result",   date:"2025-05-02", alp:34.6, coal:31.8, grn:12.2, on:6.4,  tpp:55.2 },
  { id:2,  pollster:"Roy Morgan",        date:"2025-05-31", alp:37,   coal:31,   grn:11.5, on:6,    tpp:58.5 },
  { id:3,  pollster:"Roy Morgan",        date:"2025-06-21", alp:37.5, coal:31,   grn:12,   on:6,    tpp:58   },
  { id:4,  pollster:"RedBridge Group",   date:"2025-06-29", alp:37,   coal:31,   grn:11,   on:9,    tpp:55.5 },
  { id:5,  pollster:"Roy Morgan",        date:"2025-06-28", alp:36.5, coal:30.5, grn:12,   on:8.5,  tpp:56.5 },
  { id:6,  pollster:"DemosAU",           date:"2025-07-05", alp:36,   coal:26,   grn:14,   on:9,    tpp:59   },
  { id:7,  pollster:"Roy Morgan",        date:"2025-07-26", alp:36.5, coal:31,   grn:12,   on:7,    tpp:57   },
  { id:8,  pollster:"Newspoll",          date:"2025-07-16", alp:36,   coal:29,   grn:12,   on:8,    tpp:57   },
  { id:9,  pollster:"Resolve Strategic", date:"2025-07-18", alp:35,   coal:29,   grn:12,   on:8,    tpp:56   },
  { id:10, pollster:"Roy Morgan",        date:"2025-08-23", alp:34,   coal:30,   grn:12,   on:9,    tpp:55.5 },
  { id:11, pollster:"Newspoll",          date:"2025-08-13", alp:36,   coal:30,   grn:12,   on:9,    tpp:56   },
  { id:12, pollster:"Resolve Strategic", date:"2025-08-15", alp:37,   coal:29,   grn:12,   on:9,    tpp:59   },
  { id:13, pollster:"RedBridge Group",   date:"2025-09-07", alp:35,   coal:30,   grn:11,   on:11,   tpp:53.5 },
  { id:14, pollster:"Roy Morgan",        date:"2025-09-20", alp:34,   coal:30,   grn:12,   on:9.5,  tpp:55.5 },
  { id:15, pollster:"Newspoll",          date:"2025-09-10", alp:36,   coal:27,   grn:13,   on:10,   tpp:58   },
  { id:16, pollster:"Resolve Strategic", date:"2025-09-12", alp:35,   coal:27,   grn:11,   on:12,   tpp:55   },
  { id:17, pollster:"Essential Research",date:"2025-09-28", alp:35,   coal:27,   grn:11,   on:13,   tpp:51   },
  { id:18, pollster:"YouGov",            date:"2025-09-29", alp:34,   coal:27,   grn:12,   on:12,   tpp:56   },
  { id:19, pollster:"Newspoll",          date:"2025-10-01", alp:37,   coal:28,   grn:12,   on:11,   tpp:57   },
  { id:20, pollster:"RedBridge Group",   date:"2025-10-06", alp:34,   coal:29,   grn:11,   on:14,   tpp:54   },
  { id:21, pollster:"Roy Morgan",        date:"2025-10-18", alp:35,   coal:27,   grn:13,   on:12,   tpp:57   },
  { id:22, pollster:"Resolve Strategic", date:"2025-10-11", alp:34,   coal:28,   grn:11,   on:12,   tpp:55   },
  { id:23, pollster:"Freshwater Strategy",date:"2025-10-19",alp:33,   coal:31,   grn:14,   on:10,   tpp:55   },
  { id:24, pollster:"Essential Research",date:"2025-10-26", alp:36,   coal:26,   grn:9,    on:15,   tpp:50   },
  { id:25, pollster:"DemosAU",           date:"2025-11-10", alp:33,   coal:24,   grn:13,   on:17,   tpp:56   },
  { id:26, pollster:"Newspoll",          date:"2025-10-29", alp:36,   coal:24,   grn:11,   on:15,   tpp:57   },
  { id:27, pollster:"Roy Morgan",        date:"2025-11-15", alp:33,   coal:27,   grn:12.5, on:14,   tpp:55   },
  { id:28, pollster:"Resolve Strategic", date:"2025-11-07", alp:33,   coal:29,   grn:12,   on:12,   tpp:53   },
  { id:29, pollster:"YouGov",            date:"2025-11-10", alp:32,   coal:25,   grn:12,   on:18,   tpp:null },
  { id:30, pollster:"RedBridge Group",   date:"2025-11-12", alp:38,   coal:24,   grn:9,    on:18,   tpp:56   },
  { id:31, pollster:"Spectre Strategy",  date:"2025-11-16", alp:33,   coal:25,   grn:12.5, on:17.5, tpp:53   },
  { id:32, pollster:"YouGov",            date:"2025-11-16", alp:34,   coal:26,   grn:12,   on:18,   tpp:null },
  { id:33, pollster:"RedBridge Group",   date:"2025-11-25", alp:35,   coal:26,   grn:10,   on:18,   tpp:54   },
  { id:34, pollster:"Newspoll",          date:"2025-11-19", alp:36,   coal:24,   grn:13,   on:15,   tpp:58   },
  { id:35, pollster:"Essential Research",date:"2025-11-23", alp:36,   coal:27,   grn:11,   on:15,   tpp:50   },
  { id:36, pollster:"Roy Morgan",        date:"2025-12-13", alp:32,   coal:26.5, grn:13.5, on:15.5, tpp:55   },
  { id:37, pollster:"YouGov",            date:"2025-12-01", alp:32,   coal:24,   grn:13,   on:19,   tpp:null },
  { id:38, pollster:"Resolve Strategic", date:"2025-12-06", alp:35,   coal:26,   grn:11,   on:14,   tpp:55   },
  { id:39, pollster:"Essential Research",date:"2025-12-07", alp:34,   coal:26,   grn:10,   on:17,   tpp:49   },
  { id:40, pollster:"RedBridge Group",   date:"2025-12-11", alp:35,   coal:26,   grn:13,   on:17,   tpp:56   },
  { id:41, pollster:"Resolve Strategic", date:"2025-12-19", alp:32,   coal:28,   grn:12,   on:16,   tpp:54   },
  { id:42, pollster:"YouGov",            date:"2025-12-22", alp:30,   coal:24,   grn:13,   on:20,   tpp:null },
  { id:43, pollster:"DemosAU",           date:"2026-01-05", alp:29,   coal:23,   grn:12,   on:23,   tpp:52   },
  { id:44, pollster:"Fox & Hedgehog",    date:"2026-01-05", alp:29,   coal:25,   grn:14,   on:21,   tpp:53   },
  { id:45, pollster:"Roy Morgan",        date:"2026-01-10", alp:30,   coal:30.5, grn:13.5, on:15,   tpp:52   },
  { id:46, pollster:"Resolve Strategic", date:"2026-01-15", alp:30,   coal:28,   grn:10,   on:18,   tpp:52   },
  { id:47, pollster:"Newspoll",          date:"2026-01-14", alp:32,   coal:21,   grn:12,   on:22,   tpp:55   },
  { id:48, pollster:"Freshwater Strategy",date:"2026-01-17",alp:33,   coal:28,   grn:11,   on:19,   tpp:53   },
  { id:49, pollster:"Roy Morgan",        date:"2026-01-17", alp:28.5, coal:24,   grn:13.5, on:21,   tpp:53   },
  { id:50, pollster:"DemosAU",           date:"2026-01-20", alp:30,   coal:21,   grn:13,   on:24,   tpp:null },
  { id:51, pollster:"Roy Morgan",        date:"2026-01-24", alp:30.5, coal:22.5, grn:13.5, on:22.5, tpp:54.5 },
  { id:52, pollster:"YouGov",            date:"2026-01-26", alp:31,   coal:20,   grn:12,   on:25,   tpp:55   },
  { id:53, pollster:"Essential Research",date:"2026-01-27", alp:31,   coal:25,   grn:9,    on:22,   tpp:49   },
  { id:54, pollster:"RedBridge Group",   date:"2026-01-28", alp:34,   coal:19,   grn:11,   on:26,   tpp:56   },
  { id:55, pollster:"Roy Morgan",        date:"2026-01-31", alp:30.5, coal:20.5, grn:12.5, on:25,   tpp:54.5 },
  { id:56, pollster:"Newspoll",          date:"2026-02-07", alp:33,   coal:18,   grn:12,   on:27,   tpp:null },
  { id:57, pollster:"Roy Morgan",        date:"2026-02-07", alp:28.5, coal:22.5, grn:13.5, on:24.5, tpp:53   },
  { id:58, pollster:"YouGov",            date:"2026-02-09", alp:30,   coal:19,   grn:12,   on:28,   tpp:54   },
  { id:59, pollster:"Roy Morgan",        date:"2026-02-12", alp:30.5, coal:20,   grn:13,   on:25,   tpp:55   },
  { id:60, pollster:"Resolve Strategic", date:"2026-02-13", alp:32,   coal:23,   grn:11,   on:23,   tpp:55   },
  { id:61, pollster:"Roy Morgan",        date:"2026-02-15", alp:32,   coal:23.5, grn:12.5, on:21.5, tpp:55   },
  { id:62, pollster:"Fox & Hedgehog",    date:"2026-02-18", alp:30,   coal:24,   grn:12,   on:25,   tpp:51   },
  { id:63, pollster:"DemosAU",           date:"2026-02-19", alp:29,   coal:21,   grn:12,   on:28,   tpp:null },
  { id:64, pollster:"Roy Morgan",        date:"2026-02-21", alp:31,   coal:24,   grn:12.5, on:20.5, tpp:54   },
  { id:65, pollster:"Essential Research",date:"2026-02-20", alp:30,   coal:26,   grn:11,   on:22,   tpp:47   },
  { id:66, pollster:"YouGov",            date:"2026-02-23", alp:29,   coal:22,   grn:13,   on:24,   tpp:53   },
  { id:67, pollster:"Newspoll",          date:"2026-02-25", alp:32,   coal:20,   grn:11,   on:27,   tpp:null },
  { id:68, pollster:"RedBridge Group",   date:"2026-02-26", alp:32,   coal:19,   grn:12,   on:28,   tpp:54   },
];

// ─── Election data ────────────────────────────────────────────────────────────
// Helper: build a seat object from a flat tuple
const mkSeat = (id, name, state, party, winner, margin) =>
  ({ id, name, state, margin, winner: { party, name: winner } });

// Helper: build a virtual full-seat array from group counts for TallyBar
const mkSeatsFromCounts = counts => {
  const G2P = { alp:"ALP", coalition:"LP", greens:"GRN", teal:"IND", one_nation:"ON", crossbench:"IND" };
  let vid = 99000;
  return Object.entries(counts).flatMap(([g, n]) =>
    Array.from({ length: n }, () => ({ id: vid++, winner: { party: G2P[g] ?? "IND" } }))
  );
};

// NSW 2023 — representative marginal seats
const NSW_2023_SEATS = [
  [8001,"Penrith",        "NSW","ALP","Karen McKeown",       0.3],
  [8002,"East Hills",     "NSW","ALP","Cameron Murphy",      0.6],
  [8003,"Ryde",           "NSW","ALP","Jordan Lane",         0.8],
  [8004,"Monaro",         "NSW","LP", "Nichole Overall",     0.7],
  [8005,"Heathcote",      "NSW","LP", "Lee Evans",           1.1],
  [8006,"Strathfield",    "NSW","ALP","Zac Poole",           1.2],
  [8007,"Gosford",        "NSW","LP", "Adam Crouch",         2.3],
  [8008,"Keira",          "NSW","ALP","Ryan Park",           3.0],
  [8009,"Newtown",        "NSW","GRN","Jenny Leong",         8.1],
  [8010,"Balmain",        "NSW","GRN","Kobi Shetty",         7.3],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// QLD 2024 — representative marginal seats
const QLD_2024_SEATS = [
  [8101,"Mount Ommaney",  "QLD","LNP","Jacob Madsen",        0.3],
  [8102,"Inala",          "QLD","ALP","Shayne Sutton",        0.4],
  [8103,"Oodgeroo",       "QLD","LNP","Mark Robinson",       0.5],
  [8104,"Macalister",     "QLD","LNP","Laura Gerber",        0.8],
  [8105,"Greenslopes",    "QLD","LNP","Brent Mickelberg",    1.1],
  [8106,"South Brisbane", "QLD","GRN","Amy MacMahon",        1.3],
  [8107,"McConnel",       "QLD","LNP","David Janetzki",      1.5],
  [8108,"Everton",        "QLD","LNP","Tim Mander",          2.0],
  [8109,"Toohey",         "QLD","ALP","Peter Russo",         2.5],
  [8110,"Maiwar",         "QLD","GRN","Michael Berkman",     5.1],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// WA 2025 — representative marginal seats
const WA_2025_SEATS = [
  [8201,"Carine",         "WA", "LP", "David Honey",         0.4],
  [8202,"Vasse",          "WA", "LP", "Libby Mettam",        0.8],
  [8203,"Kalamunda",      "WA", "LP", "Peter Rundle",        0.9],
  [8204,"Bateman",        "WA", "LP", "David Michael",       1.0],
  [8205,"Roe",            "WA", "NP", "Peter Rundle",        1.2],
  [8206,"Moore",          "WA", "LP", "Shane Love",          1.5],
  [8207,"Bicton",         "WA", "ALP","Lisa O'Malley",       2.5],
  [8208,"Dawesville",     "WA", "ALP","Matthew Hughes",      3.1],
  [8209,"Churchlands",    "WA", "LP", "Sean L'Estrange",     2.2],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// SA 2022 — representative marginal seats
const SA_2022_SEATS = [
  [8301,"King",           "SA", "ALP","Dana Wortley",        0.1],
  [8302,"Gibson",         "SA", "ALP","Eddie Hughes",        0.4],
  [8303,"Heysen",         "SA", "LP", "Josh Teague",         0.3],
  [8304,"Newland",        "SA", "ALP","Blair Boyer",         0.6],
  [8305,"Florey",         "SA", "ALP","Frances Bedford",     1.0],
  [8306,"Colton",         "SA", "LP", "Jeff Brock",          1.8],
  [8307,"Morialta",       "SA", "LP", "John Gardner",        2.0],
  [8308,"Waite",          "SA", "LP", "Sam Duluk",           2.5],
  [8309,"Adelaide",       "SA", "ALP","Lucy Hood",           3.0],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// TAS 2024 — representative seats (Hare-Clark approximated)
const TAS_2024_SEATS = [
  [8401,"Bass (1)",       "TAS","LP", "Sarah Courtney",      0.2],
  [8402,"Darwin (1)",     "TAS","LP", "Madeleine Ogilvie",   0.3],
  [8403,"Braddon (1)",    "TAS","LP", "Felix Ellis",         0.4],
  [8404,"Clark (1)",      "TAS","GRN","Rosalie Woodruff",    0.5],
  [8405,"Lyons (1)",      "TAS","ALP","Dean Winter",         0.8],
  [8406,"Franklin (1)",   "TAS","ALP","David O'Byrne",       1.1],
  [8407,"Bass (2)",       "TAS","ALP","Michelle O'Byrne",    1.2],
  [8408,"Braddon (2)",    "TAS","LP", "Roger Jaensch",       1.5],
  [8409,"Lyons (2)",      "TAS","LP", "Mark Shelton",        2.0],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// ACT 2024 — representative seats (multi-member electorates approximated)
const ACT_2024_SEATS = [
  [8501,"Ginninderra (1)","ACT","LP", "Elizabeth Lee",       0.4],
  [8502,"Brindabella (1)","ACT","ALP","Joy Burch",           0.5],
  [8503,"Ginninderra (2)","ACT","GRN","Rebecca Vassarotti",  0.6],
  [8504,"Murrumbidgee (1)","ACT","LP","Jeremy Hanson",       0.8],
  [8505,"Kurrajong (1)", "ACT","ALP","Andrew Barr",          1.2],
  [8506,"Brindabella (2)","ACT","LP","Mark Parton",          1.5],
  [8507,"Kurrajong (2)", "ACT","GRN","Shane Rattenbury",     1.8],
  [8508,"Murrumbidgee (2)","ACT","ALP","Mick Gentleman",     2.0],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// NT 2024 — representative marginal seats
const NT_2024_SEATS = [
  [8601,"Blain",          "NT", "CLP","Bill Yan",            0.3],
  [8602,"Casuarina",      "NT", "ALP","Selena Uibo",         0.4],
  [8603,"Arafura",        "NT", "CLP","Chansey Paech",       0.6],
  [8604,"Karama",         "NT", "CLP","Kate Worden",         0.5],
  [8605,"Fannie Bay",     "NT", "ALP","Eva Lawler",          0.8],
  [8606,"Johnston",       "NT", "CLP","Wayne Gyemore",       1.2],
  [8607,"Nhulunbuy",      "NT", "ALP","Yingiya Guyula",      2.0],
  [8608,"Namatjira",      "NT", "CLP","Mark Turner",         1.5],
].map(([id,nm,st,wp,wn,m]) => mkSeat(id,nm,st,wp,wn,m));

// VIC 2022 — use existing VIC_SEATS_KNOWN (14 seats already defined)
// Transform to standard seat format for reuse
const VIC_2022_SEATS_STD = VIC_SEATS_KNOWN.map(([id,name,party,,,,margin]) =>
  mkSeat(id, name, "VIC", party, "", margin ?? 5));

// ─── VIC 2022 full seat data (88 LA districts, VEC official 2PP results) ──────
// Source: VEC 2022 State Election — vec.vic.gov.au
// Format: [id, name, state, winnerParty, winnerName, tcp1Party, tcp2Party, margin]
const _VS = [
  [9001,"Altona","VIC","ALP","Juliana Addison","ALP","LP",28.1],
  [9002,"Albert Park","VIC","ALP","Nina Taylor","ALP","LP",11.15],
  [9003,"Ashwood","VIC","ALP","Labor MP","ALP","LP",6.15],
  [9004,"Bass","VIC","ALP","Labor MP","ALP","LP",0.24],
  [9005,"Bayswater","VIC","ALP","Labor MP","ALP","LP",4.23],
  [9006,"Bellarine","VIC","ALP","Labor MP","ALP","LP",8.46],
  [9007,"Benambra","VIC","LP","Bill Tilley","LP","ALP",13.26],
  [9008,"Bendigo East","VIC","ALP","Labor MP","ALP","LP",10.91],
  [9009,"Bendigo West","VIC","ALP","Labor MP","ALP","LP",14.35],
  [9010,"Bentleigh","VIC","ALP","Labor MP","ALP","LP",8.04],
  [9011,"Berwick","VIC","LP","Brad Battin","LP","ALP",4.71],
  [9012,"Box Hill","VIC","ALP","Paul Hamer","ALP","LP",7.23],
  [9013,"Brighton","VIC","LP","James Newbury","LP","ALP",4.21],
  [9014,"Broadmeadows","VIC","ALP","Labor MP","ALP","LP",15.45],
  [9015,"Brunswick","VIC","GRN","Tim Read","GRN","ALP",11.1],
  [9016,"Bulleen","VIC","LP","Matthew Guy","LP","ALP",5.94],
  [9017,"Bundoora","VIC","ALP","Labor MP","ALP","LP",12.74],
  [9018,"Carrum","VIC","ALP","Labor MP","ALP","LP",9.94],
  [9019,"Caulfield","VIC","LP","David Southwick","LP","ALP",2.07],
  [9020,"Clarinda","VIC","ALP","Labor MP","ALP","LP",10.37],
  [9021,"Cranbourne","VIC","ALP","Labor MP","ALP","LP",9.0],
  [9022,"Croydon","VIC","LP","David Hodgett","LP","ALP",1.37],
  [9023,"Dandenong","VIC","ALP","Labor MP","ALP","LP",19.11],
  [9024,"Eildon","VIC","LP","Cindy McLeish","LP","ALP",7.08],
  [9025,"Eltham","VIC","ALP","Labor MP","ALP","LP",9.0],
  [9026,"Essendon","VIC","ALP","Labor MP","ALP","LP",12.45],
  [9027,"Eureka","VIC","ALP","Labor MP","ALP","LP",7.17],
  [9028,"Euroa","VIC","NP","Steph Ryan","NP","ALP",9.93],
  [9029,"Evelyn","VIC","LP","Nick McGowan","LP","ALP",5.21],
  [9030,"Footscray","VIC","ALP","Katie Hall","ALP","LP",25.66],
  [9031,"Frankston","VIC","ALP","Labor MP","ALP","LP",8.66],
  [9032,"Geelong","VIC","ALP","Labor MP","ALP","LP",14.71],
  [9033,"Gippsland East","VIC","NP","Tim Bull","NP","ALP",23.92],
  [9034,"Gippsland South","VIC","NP","Danny O'Brien","NP","ALP",15.25],
  [9035,"Glen Waverley","VIC","ALP","Labor MP","ALP","LP",3.3],
  [9036,"Greenvale","VIC","ALP","Labor MP","ALP","LP",6.92],
  [9037,"Hastings","VIC","ALP","Labor MP","ALP","LP",1.35],
  [9038,"Hawthorn","VIC","LP","John Pesutto","LP","ALP",1.74],
  [9039,"Ivanhoe","VIC","ALP","Labor MP","ALP","LP",12.75],
  [9040,"Kalkallo","VIC","ALP","Labor MP","ALP","LP",16.43],
  [9041,"Kew","VIC","LP","David Davis","LP","ALP",3.98],
  [9042,"Kororoit","VIC","ALP","Labor MP","ALP","LP",14.25],
  [9043,"Lara","VIC","ALP","Labor MP","ALP","LP",16.15],
  [9044,"Laverton","VIC","ALP","Labor MP","ALP","LP",18.01],
  [9045,"Lowan","VIC","NP","Emma Kealy","NP","ALP",21.61],
  [9046,"Macedon","VIC","ALP","Labor MP","ALP","LP",9.54],
  [9047,"Malvern","VIC","LP","Michael O'Brien","LP","ALP",8.28],
  [9048,"Melbourne","VIC","ALP","Labor MP","ALP","LP",25.01],
  [9049,"Melton","VIC","ALP","Labor MP","ALP","LP",4.59],
  [9050,"Mildura","VIC","IND","Ali Cupper","IND","NP",8.5],
  [9051,"Mill Park","VIC","ALP","Labor MP","ALP","LP",11.43],
  [9052,"Monbulk","VIC","ALP","Labor MP","ALP","LP",7.55],
  [9053,"Mordialloc","VIC","ALP","Labor MP","ALP","LP",8.19],
  [9054,"Mornington","VIC","LP","Chris Crewther","LP","ALP",8.28],
  [9055,"Morwell","VIC","NP","Martin Cameron","NP","ALP",4.42],
  [9056,"Mulgrave","VIC","ALP","Labor MP","ALP","LP",10.2],
  [9057,"Murray Plains","VIC","NP","Peter Walsh","NP","ALP",22.89],
  [9058,"Narre Warren North","VIC","ALP","Labor MP","ALP","LP",9.16],
  [9059,"Narre Warren South","VIC","ALP","Labor MP","ALP","LP",8.5],
  [9060,"Nepean","VIC","LP","Sam Groth","LP","ALP",6.68],
  [9061,"Niddrie","VIC","ALP","Labor MP","ALP","LP",6.69],
  [9062,"Northcote","VIC","GRN","Kat Theophanous","GRN","ALP",5.0],
  [9063,"Oakleigh","VIC","ALP","Labor MP","ALP","LP",13.48],
  [9064,"Ovens Valley","VIC","NP","Tim McCurdy","NP","ALP",17.97],
  [9065,"Pakenham","VIC","ALP","Labor MP","ALP","LP",0.39],
  [9066,"Pascoe Vale","VIC","ALP","Labor MP","ALP","LP",22.25],
  [9067,"Point Cook","VIC","ALP","Labor MP","ALP","LP",8.34],
  [9068,"Polwarth","VIC","LP","Martha Haylett","LP","ALP",1.79],
  [9069,"Prahran","VIC","GRN","Sam Hibbins","GRN","LP",2.2],
  [9070,"Preston","VIC","ALP","Labor MP","ALP","LP",19.67],
  [9071,"Richmond","VIC","GRN","Gabrielle De Vietri","GRN","ALP",3.1],
  [9072,"Ringwood","VIC","ALP","Labor MP","ALP","LP",7.53],
  [9073,"Ripon","VIC","ALP","Labor MP","ALP","LP",2.99],
  [9074,"Rowville","VIC","LP","Richard Riordan","LP","ALP",3.67],
  [9075,"Sandringham","VIC","LP","Brad Battin","LP","ALP",5.15],
  [9076,"Shepparton","VIC","IND","Kim O'Keeffe","IND","ALP",4.8],
  [9077,"South Barwon","VIC","ALP","Labor MP","ALP","LP",9.8],
  [9078,"South-West Coast","VIC","LP","Roma Britnell","LP","ALP",8.05],
  [9079,"St Albans","VIC","ALP","Labor MP","ALP","LP",9.56],
  [9080,"Sunbury","VIC","ALP","Labor MP","ALP","LP",6.41],
  [9081,"Sydenham","VIC","ALP","Labor MP","ALP","LP",8.73],
  [9082,"Tarneit","VIC","ALP","Labor MP","ALP","LP",12.58],
  [9083,"Thomastown","VIC","ALP","Labor MP","ALP","LP",16.0],
  [9084,"Warrandyte","VIC","LP","Ryan Smith","LP","ALP",4.15],
  [9085,"Wendouree","VIC","ALP","Labor MP","ALP","LP",13.46],
  [9086,"Werribee","VIC","ALP","Labor MP","ALP","LP",10.5],
  [9087,"Williamstown","VIC","ALP","Melissa Horne","ALP","LP",13.44],
  [9088,"Yan Yean","VIC","ALP","Labor MP","ALP","LP",4.45],
];

const VIC_SEATS = _VS.map(([id,name,state,wp,wn,t1,t2,m]) => ({
  id, name, state, margin:m,
  winner: { party:wp, name:wn },
  tcp: [{party:t1, pct:+(50+m/2).toFixed(2)}, {party:t2, pct:+(50-m/2).toFixed(2)}],
}));

const ELECTION_DATA = {
  federal_2022: {
    label:"Federal 2022", jurisdiction:"Federal",
    chamber:"House of Representatives", date:"21 May 2022",
    totalSeats:151, majority:76, twopp:52.13,
    seats:SEATS, counts:null,
    incumbent:"Anthony Albanese (ALP)", incumbentParty:"ALP",
    modelEnabled:true,
  },
  nsw_2023: {
    label:"NSW 2023", jurisdiction:"New South Wales",
    chamber:"Legislative Assembly", date:"25 March 2023",
    totalSeats:93, majority:47, twopp:53.2,
    seats:NSW_2023_SEATS,
    counts:{ alp:45, coalition:44, greens:3, teal:0, one_nation:0, crossbench:1 },
    incumbent:"Chris Minns (ALP)", incumbentParty:"ALP",
    modelEnabled:false,
  },
  vic_2022: {
    label:"Victoria 2022", jurisdiction:"Victoria",
    chamber:"Legislative Assembly", date:"26 November 2022",
    totalSeats:88, majority:45, twopp:57.3,
    seats:VIC_SEATS,
    counts:{ alp:56, coalition:26, greens:4, teal:2, one_nation:0, crossbench:0 },
    incumbent:"Daniel Andrews (ALP)", incumbentParty:"ALP",
    modelEnabled:true,
  },
  qld_2024: {
    label:"Queensland 2024", jurisdiction:"Queensland",
    chamber:"Legislative Assembly", date:"26 October 2024",
    totalSeats:93, majority:47, twopp:53.7,
    seats:QLD_2024_SEATS,
    counts:{ alp:27, coalition:51, greens:7, teal:0, one_nation:0, crossbench:8 },
    incumbent:"David Crisafulli (LNP)", incumbentParty:"LNP",
    modelEnabled:false,
  },
  wa_2025: {
    label:"W. Australia 2025", jurisdiction:"Western Australia",
    chamber:"Legislative Assembly", date:"8 March 2025",
    totalSeats:59, majority:30, twopp:63.1,
    seats:WA_2025_SEATS,
    counts:{ alp:46, coalition:10, greens:2, teal:1, one_nation:0, crossbench:0 },
    incumbent:"Roger Cook (ALP)", incumbentParty:"ALP",
    modelEnabled:false,
  },
  sa_2022: {
    label:"South Aus. 2022", jurisdiction:"South Australia",
    chamber:"House of Assembly", date:"19 March 2022",
    totalSeats:47, majority:24, twopp:54.9,
    seats:SA_2022_SEATS,
    counts:{ alp:26, coalition:17, greens:0, teal:2, one_nation:0, crossbench:2 },
    incumbent:"Peter Malinauskas (ALP)", incumbentParty:"ALP",
    modelEnabled:false,
  },
  tas_2024: {
    label:"Tasmania 2024", jurisdiction:"Tasmania",
    chamber:"House of Assembly", date:"23 March 2024",
    totalSeats:35, majority:18, twopp:null,
    seats:TAS_2024_SEATS,
    counts:{ alp:10, coalition:15, greens:7, teal:3, one_nation:0, crossbench:0 },
    incumbent:"Jeremy Rockliff (Liberal)", incumbentParty:"LP",
    modelEnabled:false,
  },
  act_2024: {
    label:"ACT 2024", jurisdiction:"Australian Capital Territory",
    chamber:"Legislative Assembly", date:"19 October 2024",
    totalSeats:25, majority:13, twopp:null,
    seats:ACT_2024_SEATS,
    counts:{ alp:9, coalition:9, greens:7, teal:0, one_nation:0, crossbench:0 },
    incumbent:"Andrew Barr (ALP)", incumbentParty:"ALP",
    modelEnabled:false,
  },
  nt_2024: {
    label:"N. Territory 2024", jurisdiction:"Northern Territory",
    chamber:"Legislative Assembly", date:"24 August 2024",
    totalSeats:25, majority:13, twopp:null,
    seats:NT_2024_SEATS,
    counts:{ alp:8, coalition:17, greens:0, teal:0, one_nation:0, crossbench:0 },
    incumbent:"Lia Finocchiaro (CLP)", incumbentParty:"CLP",
    modelEnabled:false,
  },
};
const ELECTION_OPTIONS = [
  "federal_2022","nsw_2023","vic_2022","qld_2024",
  "wa_2025","sa_2022","tas_2024","act_2024","nt_2024",
];

// ─── Helper functions ─────────────────────────────────────────────────────────
function getMarginCat(m) {
  if (m == null) return "marginal";
  if (m < 2)  return "very_marginal";
  if (m < 5)  return "marginal";
  if (m < 10) return "fairly_safe";
  return "safe";
}

function getFpGroups(seat) {
  const fp = { alp:0, coal:0, grn:0, teal:0, on:0, other:0 };
  let tot = 0;
  (seat.fp || []).forEach(f => {
    const g = getParty(f.party).group;
    if      (g === "alp")        fp.alp  += f.pct;
    else if (g === "coalition")  fp.coal += f.pct;
    else if (g === "greens")     fp.grn  += f.pct;
    else if (g === "teal")       fp.teal += f.pct;
    else if (g === "one_nation") fp.on   += f.pct;
    else                         fp.other += f.pct;
    tot += f.pct;
  });
  fp.other += Math.max(0, 100 - tot);
  return fp;
}

// Compute implied national ALP 2PP from primary votes and preference flows.
// Used to derive nat2ppSwing for the uniform swing model.
function computeNat2pp(prim, flows) {
  const other = Math.max(0, 100 - prim.alp - prim.coal - prim.grn - prim.teal - prim.on);
  const a = prim.alp + prim.grn*flows.grn_alp + prim.teal*flows.teal_alp + prim.on*flows.on_alp + other*flows.other_alp;
  const c = prim.coal + prim.grn*(1-flows.grn_alp) + prim.teal*(1-flows.teal_alp) + prim.on*(1-flows.on_alp) + other*(1-flows.other_alp);
  return a/(a+c)*100;
}

// Methodology:
//  - ALP/Coalition seats (no primary override): uniform national swing — nat2ppSwing is
//    applied to each seat's actual 2022 ALP 2PP baseline. This correctly models each seat
//    starting from its own 2022 result rather than treating all seats identically.
//  - ALP/Coalition seats (primary vote override): TCP is computed from the override
//    first-preference percentages via the standard preference-flow formula.
//  - Non-ALP/Coalition seats (GRN, TEAL): swing differential is applied to the seat's
//    2022 TCP baseline (same approach, already correct).
//  - tcpPct override: bypasses all calculations; directly sets the 2022 winner's TCP%.
//    tcpPct > 50 → 2022 winner holds; tcpPct < 50 → challenger wins.
//  - ON auto-detection: when ON's estimated seat-level primary (using seat-level 2022
//    baseline + national swing) exceeds onThreshold, the model automatically determines
//    whether the seat enters an ON vs ALP or ON vs Coalition TCP. Manual tcpMatchup
//    overrides always take precedence over auto-detection.
function computeModelledSeats(seats, swings, prefFlows, overrides, nat2ppSwing, onThreshold) {
  return seats.map(seat => {
    const override = overrides[seat.id];

    // For seats with a primary vote override, derive effective swings from override
    // primaries relative to the 2022 national baseline (used for non-ALP/Coal branches).
    let effAlpSwing, effCoalSwing, effGrnSwing, effTealSwing;
    let newFp = null;
    if (override) {
      newFp = {
        alp:  Math.max(0, override.alp  ?? (BASELINE_2022.alp  + swings.alp)),
        coal: Math.max(0, override.coal ?? (BASELINE_2022.coal + swings.coal)),
        grn:  Math.max(0, override.grn  ?? (BASELINE_2022.grn  + swings.grn)),
        teal: Math.max(0, override.teal ?? (BASELINE_2022.teal + swings.teal)),
        on:   Math.max(0, override.on   ?? (BASELINE_2022.on   + swings.on)),
      };
      newFp.other = Math.max(0, 100 - newFp.alp - newFp.coal - newFp.grn - newFp.teal - newFp.on);
      effAlpSwing  = newFp.alp  - BASELINE_2022.alp;
      effCoalSwing = newFp.coal - BASELINE_2022.coal;
      effGrnSwing  = newFp.grn  - BASELINE_2022.grn;
      effTealSwing = newFp.teal - BASELINE_2022.teal;
    } else {
      effAlpSwing  = swings.alp;
      effCoalSwing = swings.coal;
      effGrnSwing  = swings.grn;
      effTealSwing = swings.teal;
    }

    // Estimate ON's primary in this seat using seat-level 2022 baseline + national swing.
    // If the seat has a primary override for ON, use that value directly.
    const estOnFp = override?.on != null
      ? override.on
      : estimateSeatOnFp(seat.id, swings);

    // Auto-detect ON TCP matchup when ON is above threshold, unless manually overridden.
    // Compares estimated ON primary against estimated ALP and Coalition primaries.
    let activeTcpMatchup = override?.tcpMatchup ?? null;
    if (!activeTcpMatchup && estOnFp >= onThreshold) {
      const estAlp  = override?.alp  != null ? override.alp  : Math.max(0, BASELINE_2022.alp  + swings.alp);
      const estCoal = override?.coal != null ? override.coal : Math.max(0, BASELINE_2022.coal + swings.coal);
      if (estOnFp > estAlp && estCoal >= estAlp) {
        // ON beats ALP on primaries → ON vs ALP final
        activeTcpMatchup = "on_v_alp";
      } else if (estOnFp > estCoal && estAlp >= estCoal) {
        // ON beats Coalition on primaries → ON vs Coalition final
        activeTcpMatchup = "on_v_coal";
      }
    }
    const isAutoMatchup = activeTcpMatchup !== null && !(override?.tcpMatchup);

    const tcpP = seat.tcp.map(t => t.party);
    const hasAlp  = tcpP.includes("ALP");
    const hasCoal = tcpP.some(p => ["LP","LNP","NP","CLP"].includes(p));
    const hasGrn  = tcpP.includes("GRN");
    const hasTeal = tcpP.some(p => ["IND","CA"].includes(p));

    // tcpPct override: represents the 2022 winner's TCP% (seat.tcp[0].party).
    // >50 means the 2022 winner holds; <50 means the challenger wins.
    const hasTcpOverride = override?.tcpPct !== null && override?.tcpPct !== undefined;

    let projWinnerParty, projWinnerGroup, projWinnerPct, projAlp2pp = null;

    // Force winner override: bypass all TCP calculation
    if (override?.forceGroup) {
      const fg = override.forceGroup;
      const forcePartyMap = { alp:"ALP", coalition:"LP", greens:"GRN", teal:"IND", one_nation:"ON", crossbench:"KAP" };
      return {
        ...seat,
        modelled: {
          winnerParty: forcePartyMap[fg] ?? seat.winner.party,
          winnerGroup: fg,
          winnerPct:   null,
          projAlp2pp:  null,
          changed:     fg !== getParty(seat.winner.party).group,
        }
      };
    }

    // ON vs ALP branch: ON and ALP are the two final candidates.
    // Uses ON-race-specific preference flows (grn_alp_v_on etc.) which are typically
    // higher toward ALP than standard flows because voters more strongly oppose ON.
    if (activeTcpMatchup === "on_v_alp") {
      const ef = override?.prefFlows ?? prefFlows;
      const fp = newFp ?? (() => {
        const a = Math.max(0, BASELINE_2022.alp + swings.alp);
        const c = Math.max(0, BASELINE_2022.coal + swings.coal);
        const g = Math.max(0, BASELINE_2022.grn + swings.grn);
        const t = Math.max(0, BASELINE_2022.teal + swings.teal);
        const o = Math.max(0, BASELINE_2022.on + swings.on);
        return { alp:a, coal:c, grn:g, teal:t, on:o, other:Math.max(0, 100-a-c-g-t-o) };
      })();
      // Use ON-race-specific flows: grn_alp_v_on, teal_alp_v_on, other_alp_v_on (all higher
      // toward ALP than standard rates because voters strongly oppose ON over ALP)
      const alpTcp = fp.alp + fp.grn*ef.grn_alp_v_on + fp.teal*ef.teal_alp_v_on
                   + fp.coal*prefFlows.coal_alp_v_on + fp.other*ef.other_alp_v_on;
      const onTcp  = fp.on  + fp.grn*(1-ef.grn_alp_v_on) + fp.teal*(1-ef.teal_alp_v_on)
                   + fp.coal*(1-prefFlows.coal_alp_v_on) + fp.other*(1-ef.other_alp_v_on);
      const onPct  = hasTcpOverride ? override.tcpPct : onTcp / (alpTcp + onTcp) * 100;
      const wGroup = onPct >= 50 ? "one_nation" : "alp";
      const wParty = onPct >= 50 ? "ON" : "ALP";
      const wPct   = onPct >= 50 ? onPct : 100 - onPct;
      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: 100 - onPct,
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
        const a = Math.max(0, BASELINE_2022.alp + swings.alp);
        const c = Math.max(0, BASELINE_2022.coal + swings.coal);
        const g = Math.max(0, BASELINE_2022.grn + swings.grn);
        const t = Math.max(0, BASELINE_2022.teal + swings.teal);
        const o = Math.max(0, BASELINE_2022.on + swings.on);
        return { alp:a, coal:c, grn:g, teal:t, on:o, other:Math.max(0, 100-a-c-g-t-o) };
      })();
      // Use ON-race-specific flows: grn_on_v_coal, teal_on_v_coal, other_on_v_coal (all low
      // toward ON because Greens/teal voters strongly prefer Coalition over ON when forced to choose)
      const onTcp   = fp.on + fp.alp*prefFlows.alp_on_v_coal + fp.grn*ef.grn_on_v_coal
                    + fp.teal*ef.teal_on_v_coal + fp.other*ef.other_on_v_coal;
      const coalTcp = fp.coal + fp.alp*(1-prefFlows.alp_on_v_coal) + fp.grn*(1-ef.grn_on_v_coal)
                    + fp.teal*(1-ef.teal_on_v_coal) + fp.other*(1-ef.other_on_v_coal);
      const onPct   = hasTcpOverride ? override.tcpPct : onTcp / (onTcp + coalTcp) * 100;
      const coalP   = seat.tcp.find(t => ["LP","LNP","NP","CLP"].includes(t.party))?.party ?? "LP";
      const wGroup  = onPct >= 50 ? "one_nation" : "coalition";
      const wParty  = onPct >= 50 ? "ON" : coalP;
      const wPct    = onPct >= 50 ? onPct : 100 - onPct;
      return {
        ...seat,
        modelled: {
          winnerParty: wParty, winnerGroup: wGroup, winnerPct: wPct,
          projAlp2pp: null,
          changed: wGroup !== getParty(seat.winner.party).group,
          isOverride: !isAutoMatchup,
          isAutoMatchup,
          activeTcpMatchup: "on_v_coal",
        },
      };
    }

    if (hasAlp && hasCoal) {
      const isAlpWinner = seat.tcp[0].party === "ALP";
      const baseAlp2pp  = isAlpWinner ? seat.tcp[0].pct : seat.tcp[1].pct;

      if (hasTcpOverride) {
        // For ALP/Coal seats, tcpPct is ALP 2PP% directly (>50 = ALP wins)
        projAlp2pp = override.tcpPct;
      } else if (override) {
        // Compute 2PP from override first preferences via preference flows
        // Use seat-level preference flows if set, otherwise fall back to national flows
        const ef = override.prefFlows ?? prefFlows;
        const a2 = newFp.alp + newFp.grn*ef.grn_alp + newFp.teal*ef.teal_alp + newFp.on*ef.on_alp + newFp.other*ef.other_alp;
        const c2 = newFp.coal + newFp.grn*(1-ef.grn_alp) + newFp.teal*(1-ef.teal_alp) + newFp.on*(1-ef.on_alp) + newFp.other*(1-ef.other_alp);
        projAlp2pp = a2 / (a2 + c2) * 100;
      } else {
        // Uniform national swing applied to this seat's 2022 ALP 2PP baseline
        projAlp2pp = Math.max(0, Math.min(100, baseAlp2pp + nat2ppSwing));
      }
      projWinnerGroup = projAlp2pp >= 50 ? "alp" : "coalition";
      projWinnerParty = projAlp2pp >= 50 ? "ALP" : seat.tcp.find(t => t.party !== "ALP")?.party;
      projWinnerPct   = projAlp2pp >= 50 ? projAlp2pp : 100 - projAlp2pp;

    } else if (hasGrn && hasCoal) {
      const base = seat.tcp.find(t => t.party === "GRN")?.pct ?? 50;
      const adj  = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + effGrnSwing - effCoalSwing));
      projWinnerGroup = adj >= 50 ? "greens" : "coalition";
      projWinnerParty = adj >= 50 ? "GRN" : seat.tcp.find(t => t.party !== "GRN")?.party;
      projWinnerPct   = adj >= 50 ? adj : 100 - adj;

    } else if (hasGrn && hasAlp) {
      const base = seat.tcp.find(t => t.party === "ALP")?.pct ?? 50;
      const adj  = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + effAlpSwing - effGrnSwing));
      projWinnerGroup = adj >= 50 ? "alp" : "greens";
      projWinnerParty = adj >= 50 ? "ALP" : "GRN";
      projWinnerPct   = adj >= 50 ? adj : 100 - adj;
      projAlp2pp      = adj;

    } else if (hasTeal && hasCoal) {
      const tealP = seat.tcp.find(t => ["IND","CA"].includes(t.party));
      const base  = tealP?.pct ?? 50;
      const adj   = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + effTealSwing - effCoalSwing));
      projWinnerGroup = adj >= 50 ? "teal" : "coalition";
      projWinnerParty = adj >= 50 ? tealP?.party : seat.tcp.find(t => ["LP","LNP","NP","CLP"].includes(t.party))?.party;
      projWinnerPct   = adj >= 50 ? adj : 100 - adj;

    } else if (hasTeal && hasAlp) {
      const tealP = seat.tcp.find(t => ["IND","CA"].includes(t.party));
      const base  = tealP?.pct ?? 50;
      const adj   = hasTcpOverride
        ? override.tcpPct
        : Math.max(0, Math.min(100, base + effTealSwing - effAlpSwing));
      projWinnerGroup = adj >= 50 ? "teal" : "alp";
      projWinnerParty = adj >= 50 ? tealP?.party : "ALP";
      projWinnerPct   = adj >= 50 ? adj : 100 - adj;

    } else {
      projWinnerGroup = getParty(seat.winner.party).group;
      projWinnerParty = seat.winner.party;
      projWinnerPct   = seat.tcp[0]?.pct ?? 50;
    }

    return {
      ...seat,
      modelled: {
        winnerParty: projWinnerParty,
        winnerGroup: projWinnerGroup,
        winnerPct:   projWinnerPct,
        projAlp2pp,
        changed: projWinnerGroup !== getParty(seat.winner.party).group,
        isOverride: override !== undefined,
        isAutoMatchup: false,
      },
    };
  });
}

// VIC 2022 statewide primary vote % baseline
const VIC_BASELINE_2022 = { alp:38.1, lp:25.3, np:5.8, grn:12.2, ind:5.5 };
const VIC_2PP_2022 = 57.3; // ALP 2PP at 2022 VIC election

function computeVic2pp(primaries, prefFlows) {
  const { alp, lp, np, grn, ind } = primaries;
  const others = Math.max(0, 100 - alp - lp - np - grn - ind);
  return alp + grn * prefFlows.grn_alp + ind * prefFlows.ind_alp + others * prefFlows.other_alp;
}

// VIC uniform swing model — applies statewide 2PP swing to each seat's 2022 margin
function computeModelledSeatsVic(vicSeats, swings, prefFlows) {
  const newPrim = {
    alp: Math.max(0, VIC_BASELINE_2022.alp + swings.alp),
    lp:  Math.max(0, VIC_BASELINE_2022.lp  + swings.lp),
    np:  Math.max(0, VIC_BASELINE_2022.np  + swings.np),
    grn: Math.max(0, VIC_BASELINE_2022.grn + swings.grn),
    ind: Math.max(0, VIC_BASELINE_2022.ind + swings.ind),
  };
  const new2pp = computeVic2pp(newPrim, prefFlows);
  const vic2ppSwing = new2pp - VIC_2PP_2022;

  return vicSeats.map(seat => {
    const t1 = seat.tcp[0].party, t2 = seat.tcp[1].party;
    let swingToT1 = 0;
    if (t1 === "ALP" && ["LP","NP"].includes(t2)) {
      swingToT1 = vic2ppSwing;
    } else if (["LP","NP"].includes(t1) && t2 === "ALP") {
      swingToT1 = -vic2ppSwing;
    } else if (t1 === "GRN" && t2 === "ALP") {
      swingToT1 = (swings.grn - swings.alp) / 2;
    } else if (t1 === "GRN" && ["LP","NP"].includes(t2)) {
      swingToT1 = (swings.grn - (t2 === "LP" ? swings.lp : swings.np)) / 2;
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

// ─── Small reusable components ────────────────────────────────────────────────
function PartyBadge({ party }) {
  const p = getParty(party);
  return <span style={{ background:p.color, color:"#fff", fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:4 }}>{p.short}</span>;
}

function MarginDot({ margin }) {
  const c = MARGIN_COLOR[getMarginCat(margin)];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
      <span style={{ width:8, height:8, borderRadius:"50%", background:c, display:"inline-block" }} />
      <span style={{ fontWeight:600, color:"#111" }}>{margin?.toFixed(1)}%</span>
    </span>
  );
}

function SwingBadge({ swing }) {
  if (swing == null) return <span style={{ color:"#9CA3AF" }}>—</span>;
  const pos = swing > 0;
  return <span style={{ color: pos ? "#059669":"#DC2626", fontWeight:600 }}>{pos?"+":""}{swing.toFixed(1)}%</span>;
}

function TcpBar({ tcp, winnerParty }) {
  const winner = tcp.find(t => t.party === winnerParty);
  if (!winner) return null;
  const p = getParty(winnerParty);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
      <span style={{ width:64, height:6, background:"#E5E7EB", borderRadius:3, overflow:"hidden", display:"inline-block" }}>
        <span style={{ display:"block", width:`${Math.min(winner.pct,100)}%`, height:"100%", background:p.color, borderRadius:3 }} />
      </span>
      <span style={{ fontWeight:600, fontSize:13 }}>{winner.pct.toFixed(1)}%</span>
    </span>
  );
}

function TallyBar({ seats, useModelled=false }) {
  const counts = {};
  seats.forEach(s => {
    const g = useModelled ? (s.modelled?.winnerGroup ?? getParty(s.winner.party).group) : getParty(s.winner.party).group;
    counts[g] = (counts[g]||0) + 1;
  });
  const total = seats.length;
  return (
    <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:"14px 18px", marginBottom:14 }}>
      <div style={{ fontSize:13, fontWeight:600, color:"#6B7280", marginBottom:8 }}>
        {useModelled ? "Projected" : "2022 result"} — {total} seats shown
      </div>
      <div style={{ display:"flex", height:26, borderRadius:6, overflow:"hidden", gap:2 }}>
        {GROUP_ORDER.filter(g => counts[g]).map(g => (
          <div key={g} style={{ flex:counts[g], background:GROUP_CONFIG[g].color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700 }}>
            {counts[g] >= 3 ? counts[g] : ""}
          </div>
        ))}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 14px", marginTop:8 }}>
        {GROUP_ORDER.filter(g => counts[g]).map(g => (
          <span key={g} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"#374151" }}>
            <span style={{ width:9, height:9, borderRadius:2, background:GROUP_CONFIG[g].color, display:"inline-block" }} />
            {GROUP_CONFIG[g].label} <strong>{counts[g]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Primary vote % input ─────────────────────────────────────────────────────
function PrimaryInput({ label, value, onChange, color="#6B7280", baseline }) {
  const delta = +(value - baseline).toFixed(1);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
      <div style={{ width:10, height:10, borderRadius:2, background:color, flexShrink:0 }} />
      <label style={{ fontSize:13, fontWeight:600, color:"#374151", minWidth:112 }}>{label}</label>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <input
          type="number" min={0} max={100} step={0.1}
          value={value}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.max(0, Math.min(100, +v.toFixed(1))));
          }}
          style={{ width:68, border:"1px solid #D1D5DB", borderRadius:6, padding:"5px 8px",
            fontSize:14, fontWeight:700, textAlign:"right", outline:"none",
            borderColor: delta !== 0 ? color : "#D1D5DB" }}
        />
        <span style={{ fontSize:13, color:"#6B7280" }}>%</span>
      </div>
      <span style={{ fontSize:12, fontWeight:600, minWidth:58, textAlign:"right",
        color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : "#9CA3AF" }}>
        {delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta} pp`}
      </span>
    </div>
  );
}

function PrefInput({ label, value, onChange, color="#6B7280" }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <label style={{ fontSize:12, fontWeight:600, color:"#374151" }}>{label}</label>
        <span style={{ fontSize:13, fontWeight:700, color:"#111" }}>{pct}%</span>
      </div>
      <input type="range" min={0} max={100} step={1} value={pct}
        onChange={e => onChange(parseInt(e.target.value)/100)}
        style={{ width:"100%", accentColor:color, cursor:"pointer" }} />
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
export default function App() {
  // ── Seats tab state ──
  const [search,       setSearch]       = useState("");
  const [stateFilter,  setStateFilter]  = useState(new Set(STATES));
  const [groupFilter,  setGroupFilter]  = useState(new Set(GROUP_ORDER));
  const [marginFilter, setMarginFilter] = useState(new Set(MARGINS));
  const [sortKey,      setSortKey]      = useState("margin");
  const [sortDir,      setSortDir]      = useState("asc");
  const [activeTab,    setActiveTab]    = useState("overview");
  // Overview uses all elections; Model uses only elections with a full model built
  const [selectedOverviewId, setSelectedOverviewId] = useState("federal_2022");
  const [selectedModelId,    setSelectedModelId]    = useState("federal_2022");

  // ── Polls tab state ──
  const [polls,       setPolls]       = useState(INITIAL_POLLS);
  const [showAddPoll, setShowAddPoll] = useState(false);
  const [nextPollId,  setNextPollId]  = useState(INITIAL_POLLS.length + 1);
  const [newPoll,     setNewPoll]     = useState({ pollster:"", date:"", alp:"", coal:"", grn:"", oth:"", tpp:"" });

  // ── Model tab state ──
  const [primaries,      setPrimaries]      = useState({ alp:BASELINE_2022.alp, coal:BASELINE_2022.coal, grn:BASELINE_2022.grn, teal:BASELINE_2022.teal, on:BASELINE_2022.on });
  const [prefFlows,      setPrefFlows]      = useState({
    // Standard flows (used in ALP vs Coalition finals)
    grn_alp:         0.81,
    teal_alp:        0.62,
    on_alp:          0.43,
    other_alp:       0.50,
    // ON vs ALP final — sources distribute between ALP and ON
    coal_alp_v_on:   0.10,  // Coalition → ALP (low; conservatives reluctant to boost ALP over ON)
    grn_alp_v_on:    0.90,  // Greens → ALP (high; Greens voters strongly oppose ON)
    teal_alp_v_on:   0.75,  // Independents → ALP
    other_alp_v_on:  0.60,  // Other → ALP
    // ON vs Coalition final — sources distribute between ON and Coalition
    alp_on_v_coal:   0.20,  // ALP → ON (low; ALP voters prefer Coalition over ON in this race)
    grn_on_v_coal:   0.08,  // Greens → ON (very low; Greens strongly prefer Coalition over ON)
    teal_on_v_coal:  0.12,  // Independents → ON
    other_on_v_coal: 0.25,  // Other → ON
  });
  // Derive swings from primaries vs 2022 baseline — used by computeModelledSeats
  const swings = {
    alp:  +(primaries.alp  - BASELINE_2022.alp ).toFixed(2),
    coal: +(primaries.coal - BASELINE_2022.coal).toFixed(2),
    grn:  +(primaries.grn  - BASELINE_2022.grn ).toFixed(2),
    teal: +(primaries.teal - BASELINE_2022.teal).toFixed(2),
    on:   +(primaries.on   - BASELINE_2022.on  ).toFixed(2),
  };
  const [seatOverrides,  setSeatOverrides]  = useState({});  // {seatId: {alp,coal,grn,teal,on,prefFlows?}}
  const [overrideSearch, setOverrideSearch] = useState("");

  // ── One Nation seats panel state ──
  const [expandedOnSeat,    setExpandedOnSeat]    = useState(null);  // seat id or null
  const [onSeatSort,        setOnSeatSort]        = useState({ field:"name", dir:"asc" });
  const [onSeatFilter,      setOnSeatFilter]      = useState("");
  const [onThreshold,       setOnThreshold]       = useState(6.5);   // % ON primary to auto-detect TCP
  const [onCompetitiveOnly, setOnCompetitiveOnly] = useState(false); // filter panel to competitive seats only
  const [showAdvancedFlows, setShowAdvancedFlows] = useState(false); // show/hide advanced ON race flows

  // ── Seat-at-risk table state ──
  const [riskFilter, setRiskFilter] = useState("all"); // "all" | "changing" | "marginal"
  const [modelStateFilter, setModelStateFilter] = useState(""); // "" = All States
  const [expandedModelSeatId, setExpandedModelSeatId] = useState(null);
  const [expandedSeatTabDemogId, setExpandedSeatTabDemogId] = useState(null);
  const [demogSectionOpen, setDemogSectionOpen] = useState(false);

  // ── VIC model state ──
  const [vicPrimaries, setVicPrimaries] = useState({ alp:38.1, lp:25.3, np:5.8, grn:12.2, ind:5.5 });
  const [vicPrefFlows, setVicPrefFlows] = useState({ grn_alp:0.85, ind_alp:0.60, other_alp:0.43 });

  // ── Demographics tab state ──
  const [demogSortKey,    setDemogSortKey]    = useState("medianHouseholdIncome");
  const [demogSortDir,    setDemogSortDir]    = useState("desc");
  const [demogStateFilter,setDemogStateFilter]= useState(new Set(STATES));
  const [demogClassFilter,setDemogClassFilter]= useState(new Set(["Inner Metropolitan","Outer Metropolitan","Provincial","Rural"]));
  const [expandedDemogId, setExpandedDemogId] = useState(null);
  const [demogXMetric,    setDemogXMetric]    = useState("medianHouseholdIncome");

  const toggleSet = (setter, val) =>
    setter(prev => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });

  const handleSort = (key) => {
    setSortDir(prev => sortKey === key ? (prev==="asc"?"desc":"asc") : "asc");
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
      if (!groupFilter.has(getParty(s.winner.party).group)) return false;
      if (!marginFilter.has(getMarginCat(s.margin))) return false;
      return true;
    });
    return [...r].sort((a,b) => {
      let cmp = 0;
      if (sortKey==="name")   cmp = a.name.localeCompare(b.name);
      if (sortKey==="state")  cmp = a.state.localeCompare(b.state) || a.name.localeCompare(b.name);
      if (sortKey==="party")  cmp = getParty(a.winner.party).group.localeCompare(getParty(b.winner.party).group);
      if (sortKey==="margin") cmp = (a.margin??99)-(b.margin??99);
      if (sortKey==="swing")  cmp = (a.swing??0)-(b.swing??0);
      return sortDir==="asc" ? cmp : -cmp;
    });
  }, [search, stateFilter, groupFilter, marginFilter, sortKey, sortDir]);

  const stateCounts  = useMemo(() => Object.fromEntries(STATES.map(s => [s, SEATS.filter(d => d.state===s).length])), []);
  const groupCounts  = useMemo(() => { const c={}; SEATS.forEach(s => { const g=getParty(s.winner.party).group; c[g]=(c[g]||0)+1; }); return c; }, []);
  const marginCounts = useMemo(() => { const c={}; SEATS.forEach(s => { const cat=getMarginCat(s.margin); c[cat]=(c[cat]||0)+1; }); return c; }, []);

  // ── Modelling ──
  const nat2ppSwing = useMemo(() =>
    computeNat2pp(primaries, prefFlows) - NATIONAL_2PP_2022,
    [primaries, prefFlows]);

  const modelledSeats = useMemo(() =>
    computeModelledSeats(SEATS, swings, prefFlows, seatOverrides, nat2ppSwing, onThreshold),
    [swings, prefFlows, seatOverrides, nat2ppSwing, onThreshold]);

  const projCounts = useMemo(() => {
    const c = {};
    modelledSeats.forEach(s => { const g=s.modelled.winnerGroup; c[g]=(c[g]||0)+1; });
    return c;
  }, [modelledSeats]);

  const baseCounts = useMemo(() => {
    const c = {};
    SEATS.forEach(s => { const g=getParty(s.winner.party).group; c[g]=(c[g]||0)+1; });
    return c;
  }, []);

  const changedSeats = useMemo(() =>
    modelledSeats.filter(s => s.modelled.changed),
    [modelledSeats]);

  const projectedOnSeats = useMemo(() =>
    modelledSeats.filter(s => s.modelled.winnerGroup === "one_nation"),
    [modelledSeats]);

  // Count seats auto-detected as ON TCP contests (not manually overridden)
  const autoOnCount = useMemo(() =>
    modelledSeats.filter(s => s.modelled.isAutoMatchup).length,
    [modelledSeats]);

  const sortedOnSeatList = useMemo(() => {
    let list = [...modelledSeats];
    // If competitive-only filter is active, show only ON-relevant seats
    if (onCompetitiveOnly) {
      list = list.filter(s =>
        s.modelled.winnerGroup === "one_nation" ||
        s.modelled.isAutoMatchup ||
        seatOverrides[s.id]?.tcpMatchup?.startsWith("on_")
      );
    }
    if (onSeatFilter) {
      const q = onSeatFilter.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.state.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (onSeatSort.field === "name")    cmp = a.name.localeCompare(b.name);
      if (onSeatSort.field === "state")   cmp = a.state.localeCompare(b.state) || a.name.localeCompare(b.name);
      if (onSeatSort.field === "holder")  cmp = getParty(a.winner.party).group.localeCompare(getParty(b.winner.party).group);
      if (onSeatSort.field === "margin")  cmp = (a.margin ?? 99) - (b.margin ?? 99);
      if (onSeatSort.field === "proj")    cmp = a.modelled.winnerGroup.localeCompare(b.modelled.winnerGroup);
      if (onSeatSort.field === "onFp")    cmp = estimateSeatOnFp(b.id, swings) - estimateSeatOnFp(a.id, swings);
      return onSeatSort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [modelledSeats, onSeatSort, onSeatFilter, onCompetitiveOnly, seatOverrides, swings]);

  const implied2pp = useMemo(() => {
    const relevant = modelledSeats.filter(s => s.modelled.projAlp2pp !== null);
    if (!relevant.length) return null;
    return relevant.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / relevant.length;
  }, [modelledSeats]);

  // ── VIC modelling ──
  const vicModelledSeats = useMemo(() => {
    const s = {
      alp: +(vicPrimaries.alp - VIC_BASELINE_2022.alp).toFixed(2),
      lp:  +(vicPrimaries.lp  - VIC_BASELINE_2022.lp ).toFixed(2),
      np:  +(vicPrimaries.np  - VIC_BASELINE_2022.np ).toFixed(2),
      grn: +(vicPrimaries.grn - VIC_BASELINE_2022.grn).toFixed(2),
      ind: +(vicPrimaries.ind - VIC_BASELINE_2022.ind).toFixed(2),
    };
    return computeModelledSeatsVic(VIC_SEATS, s, vicPrefFlows);
  }, [vicPrimaries, vicPrefFlows]);

  const vicProjCounts = useMemo(() => {
    const c = {};
    vicModelledSeats.forEach(s => { const g=s.modelled.winnerGroup; c[g]=(c[g]||0)+1; });
    return c;
  }, [vicModelledSeats]);

  const vicBaseCounts = useMemo(() => {
    const c = {};
    VIC_SEATS.forEach(s => { const g=getParty(s.winner.party).group; c[g]=(c[g]||0)+1; });
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

  const vicHasChanges = vicPrimaries.alp !== 38.1 || vicPrimaries.lp !== 25.3 ||
    vicPrimaries.np !== 5.8 || vicPrimaries.grn !== 12.2 || vicPrimaries.ind !== 5.5 ||
    vicPrefFlows.grn_alp !== 0.85 || vicPrefFlows.ind_alp !== 0.60 || vicPrefFlows.other_alp !== 0.43;

  const hasChanges =
    primaries.alp !== BASELINE_2022.alp || primaries.coal !== BASELINE_2022.coal ||
    primaries.grn !== BASELINE_2022.grn || primaries.teal !== BASELINE_2022.teal || primaries.on !== BASELINE_2022.on ||
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
    { key:"medianPersonalIncome",   label:"Median Personal Income",    fmt:v=>`$${(v/1000).toFixed(0)}k` },
    { key:"medianHouseholdIncome",  label:"Median Household Income",   fmt:v=>`$${(v/1000).toFixed(0)}k` },
    { key:"medianWeeklyRent",       label:"Median Weekly Rent",        fmt:v=>`$${v}` },
    { key:"medianMonthlyMortgage",  label:"Median Monthly Mortgage",   fmt:v=>`$${v}` },
    { key:"ownerOutrightPct",       label:"Owner Outright %",          fmt:v=>`${v}%` },
    { key:"ownerMortgagePct",       label:"Owner w/ Mortgage %",       fmt:v=>`${v}%` },
    { key:"renterPct",              label:"Renters %",                 fmt:v=>`${v}%` },
    { key:"bachelorsOrAbovePct",    label:"Bachelor's+ %",             fmt:v=>`${v}%` },
    { key:"overseasBornPct",        label:"Overseas Born %",           fmt:v=>`${v}%` },
    { key:"medianAge",              label:"Median Age",                fmt:v=>`${v}` },
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
        avg: vals.reduce((a,b) => a+b, 0) / vals.length,
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
        return { x: xVal, y: +(m.modelled.projAlp2pp != null ? m.modelled.projAlp2pp - 50 : m.modelled.winnerPct - 50).toFixed(2),
                 name: s.name, state: s.state, group, xLabel: xVal };
      })
      .filter(Boolean);
  }, [demogWithSeats, modelledSeats, demogXMetric]);

  // ── Polling data ──
  const sortedPolls = useMemo(() => [...polls].sort((a,b) => b.date.localeCompare(a.date)), [polls]);
  const latestPoll  = sortedPolls[0];

  const pollAvg = useMemo(() => {
    const recent = sortedPolls.slice(0,3);
    if (!recent.length) return null;
    const avg = f => +(recent.reduce((s,p) => s + p[f], 0) / recent.length).toFixed(1);
    return { alp:avg("alp"), coal:avg("coal"), grn:avg("grn"), oth:avg("oth"), tpp:avg("tpp"), n:recent.length };
  }, [sortedPolls]);

  const pollChartData = useMemo(() => {
    return [...polls]
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(p => {
        const d = new Date(p.date);
        const label = d.toLocaleDateString("en-AU", { month:"short", day:"numeric" });
        return { date:label, ALP:p.alp, Coalition:p.coal, Greens:p.grn, "2PP (ALP)":p.tpp };
      });
  }, [polls]);

  const loadFromPoll = () => {
    if (!latestPoll) return;
    setPrimaries(p => ({
      ...p,
      alp:  latestPoll.alp,
      coal: latestPoll.coal,
      grn:  latestPoll.grn,
      // teal and on remain unchanged — not tracked separately in most polls
    }));
    setActiveTab("model");
  };

  const resetModel = () => {
    setPrimaries({ alp:BASELINE_2022.alp, coal:BASELINE_2022.coal, grn:BASELINE_2022.grn, teal:BASELINE_2022.teal, on:BASELINE_2022.on });
    setPrefFlows({
      grn_alp:0.81, teal_alp:0.62, on_alp:0.43, other_alp:0.50,
      coal_alp_v_on:0.10, grn_alp_v_on:0.90, teal_alp_v_on:0.75, other_alp_v_on:0.60,
      alp_on_v_coal:0.20, grn_on_v_coal:0.08, teal_on_v_coal:0.12, other_on_v_coal:0.25,
    });
    setOnThreshold(6.5);
    setSeatOverrides({});
  };

  const addPoll = () => {
    const { pollster, date, alp, coal, grn, tpp } = newPoll;
    if (!pollster || !date || !alp || !coal || !grn || !tpp) return;
    const a=+alp, c=+coal, g=+grn;
    setPolls(prev => [...prev, {
      id: nextPollId,
      pollster, date,
      alp:a, coal:c, grn:g,
      oth: +(100-a-c-g).toFixed(1),
      tpp: +tpp,
    }]);
    setNextPollId(id => id+1);
    setNewPoll({ pollster:"", date:"", alp:"", coal:"", grn:"", oth:"", tpp:"" });
    setShowAddPoll(false);
  };

  const deletePoll = (id) => setPolls(prev => prev.filter(p => p.id !== id));

  const addSeatOverride = (seatId) => {
    setSeatOverrides(prev => ({
      ...prev,
      [seatId]: { alp: primaries.alp, coal: primaries.coal, grn: primaries.grn, teal: primaries.teal, on: primaries.on },
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
    setSeatOverrides(prev => { const n={...prev}; delete n[seatId]; return n; });
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
          grn_alp:         prefFlows.grn_alp,
          teal_alp:        prefFlows.teal_alp,
          on_alp:          prefFlows.on_alp,
          other_alp:       prefFlows.other_alp,
          grn_alp_v_on:    prefFlows.grn_alp_v_on,
          teal_alp_v_on:   prefFlows.teal_alp_v_on,
          other_alp_v_on:  prefFlows.other_alp_v_on,
          grn_on_v_coal:   prefFlows.grn_on_v_coal,
          teal_on_v_coal:  prefFlows.teal_on_v_coal,
          other_on_v_coal: prefFlows.other_on_v_coal,
        },
      },
    }));
  };

  const toggleExpandedOnSeat = (seatId) => {
    setExpandedOnSeat(prev => {
      const next = prev === seatId ? null : seatId;
      // Ensure a minimal override exists so pref flows have somewhere to live
      if (next !== null && !seatOverrides[seatId]) {
        setSeatOverrides(ov => ({
          ...ov,
          [seatId]: { alp: null, coal: null, grn: null, teal: null, on: null },
        }));
      }
      return next;
    });
  };

  const handleOnSeatSort = (field) => {
    setOnSeatSort(prev => ({
      field,
      dir: prev.field === field ? (prev.dir === "asc" ? "desc" : "asc") : "asc",
    }));
  };

  const SortTh = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap" }}>
      {children}{" "}<span style={{ color: sortKey===k?"#374151":"#D1D5DB" }}>{sortKey===k?(sortDir==="asc"?"↑":"↓"):"↕"}</span>
    </th>
  );

  const tabs = [
    { id:"overview",     label:"Overview" },
    { id:"seats",        label:"Seats" },
    { id:"polls",        label:"Polls" },
    { id:"model",        label:`Model${hasChanges?" ●":""}` },
  ];

  const panelStyle = { background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:"18px 20px", marginBottom:16 };
  const sectionHead = { fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:10 };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Inter',system-ui,sans-serif", background:"#F3F4F6", minHeight:"100vh" }}>

      {/* ── Header ── */}
      <div style={{ background:"#111827", color:"#fff", padding:"0 20px", display:"flex", alignItems:"center", gap:16, height:50, position:"sticky", top:0, zIndex:100 }}>
        <span style={{ fontSize:17, fontWeight:800, letterSpacing:"-0.02em", marginRight:8 }}>🦘 AU Election Dashboard</span>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ background:activeTab===t.id?"#374151":"transparent", color:activeTab===t.id?"#fff":"#9CA3AF",
              border:"none", padding:"5px 13px", borderRadius:6, cursor:"pointer", fontSize:13, fontWeight:500 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ OVERVIEW TAB ══════════════════════════════════ */}
      {activeTab === "overview" && (() => {
        const el = ELECTION_DATA[selectedOverviewId];
        const tallySeats = el.counts ? mkSeatsFromCounts(el.counts) : el.seats;
        const tightest = [...el.seats].sort((a,b) => a.margin - b.margin).slice(0, 10);
        const alpCount  = el.counts ? el.counts.alp      : el.seats.filter(s => getParty(s.winner.party).group === "alp").length;
        const coalCount = el.counts ? el.counts.coalition : el.seats.filter(s => getParty(s.winner.party).group === "coalition").length;
        const crossCount = el.counts
          ? Object.entries(el.counts).filter(([g]) => g !== "alp" && g !== "coalition").reduce((a,[,v]) => a+v, 0)
          : el.seats.filter(s => !["alp","coalition"].includes(getParty(s.winner.party).group)).length;
        const marginalCount  = el.seats.filter(s => s.margin < 5).length;
        const veryMargCount  = el.seats.filter(s => s.margin < 2).length;
        const incumbentColor = GROUP_CONFIG[PARTY[el.incumbentParty]?.group]?.color ?? "#374151";
        return (
          <div style={{ padding:"20px 24px", maxWidth:900, margin:"0 auto" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:4 }}>
              <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>{el.jurisdiction} Election Results</h1>
              <select value={selectedOverviewId} onChange={e => setSelectedOverviewId(e.target.value)}
                style={{ border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 10px", fontSize:13, fontWeight:700, outline:"none", background:"#fff", cursor:"pointer" }}>
                {ELECTION_OPTIONS.map(id => <option key={id} value={id}>{ELECTION_DATA[id].label}</option>)}
              </select>
            </div>
            <p style={{ color:"#6B7280", marginBottom:18 }}>
              {el.date} · {el.chamber} · {el.totalSeats} seats
              {el.twopp ? ` · ${el.twopp}% 2PP (ALP)` : ""}
              {" · "}<span style={{ fontWeight:600, color:incumbentColor }}>{el.incumbent}</span>
            </p>
            <TallyBar seats={tallySeats} />
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:18 }}>
              {[
                { label:`${GROUP_CONFIG.alp.label} seats`,       value:alpCount,      color:GROUP_CONFIG.alp.color },
                { label:`${GROUP_CONFIG.coalition.label} seats`,  value:coalCount,     color:GROUP_CONFIG.coalition.color },
                { label:"Crossbench",                             value:crossCount,    color:"#059669" },
                { label:`Marginal (<5%)${el.counts?" *":""}`,     value:marginalCount, color:"#F59E0B" },
                { label:`Very marginal${el.counts?" *":""}`,      value:veryMargCount, color:"#EF4444" },
              ].map(card => (
                <div key={card.label} style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"14px 16px" }}>
                  <div style={{ width:24, height:3, background:card.color, borderRadius:2, marginBottom:8 }} />
                  <div style={{ fontSize:26, fontWeight:800, color:"#111" }}>{card.value}</div>
                  <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>{card.label}</div>
                </div>
              ))}
            </div>
            <div style={panelStyle}>
              <div style={{ fontWeight:700, marginBottom:12, color:"#374151" }}>
                {tightest.length > 0 ? `${Math.min(tightest.length, 10)} tightest seats` : "No seat data available"}
              </div>
              {tightest.map(s => {
                const p = getParty(s.winner.party);
                return (
                  <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid #F3F4F6" }}>
                    <div style={{ width:3, height:34, background:p.color, borderRadius:2, flexShrink:0 }} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{s.name} <span style={{ color:"#9CA3AF", fontWeight:400 }}>({s.state})</span></div>
                      <div style={{ fontSize:11, color:"#6B7280" }}>{s.winner.name}</div>
                    </div>
                    <PartyBadge party={s.winner.party} />
                    <span style={{ fontWeight:700, color:MARGIN_COLOR[getMarginCat(s.margin)], minWidth:40, textAlign:"right" }}>{s.margin.toFixed(1)}%</span>
                  </div>
                );
              })}
              {el.counts && (
                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:8, paddingTop:8, borderTop:"1px solid #F3F4F6" }}>
                  * Showing representative marginal seats only · Full seat-by-seat data not available for state elections
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════ SEATS TAB ═════════════════════════════════════ */}
      {activeTab === "seats" && (
        <div style={{ display:"flex", maxWidth:1400, margin:"0 auto" }}>
          <aside style={{ width:215, flexShrink:0, padding:"16px 0 16px 16px" }}>
            <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:14, position:"sticky", top:60, fontSize:13 }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search seats…"
                style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:7, padding:"7px 9px", fontSize:13, boxSizing:"border-box", marginBottom:14, outline:"none" }} />
              <div style={sectionHead}>State / Territory</div>
              <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                <button onClick={()=>setStateFilter(new Set(STATES))} style={{ fontSize:11, color:"#2563EB", background:"none", border:"none", cursor:"pointer", padding:0 }}>All</button>
                <button onClick={()=>setStateFilter(new Set())} style={{ fontSize:11, color:"#2563EB", background:"none", border:"none", cursor:"pointer", padding:0 }}>None</button>
              </div>
              {STATES.map(s=>(
                <label key={s} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4, cursor:"pointer" }}>
                  <input type="checkbox" checked={stateFilter.has(s)} onChange={()=>toggleSet(setStateFilter,s)} style={{ accentColor:"#2563EB" }} />
                  <span style={{ flex:1 }}>{s}</span>
                  <span style={{ color:"#9CA3AF", fontSize:11 }}>{stateCounts[s]}</span>
                </label>
              ))}
              <div style={{ borderTop:"1px solid #F3F4F6", margin:"10px 0" }} />
              <div style={sectionHead}>Party / Group</div>
              <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                <button onClick={()=>setGroupFilter(new Set(GROUP_ORDER))} style={{ fontSize:11, color:"#2563EB", background:"none", border:"none", cursor:"pointer", padding:0 }}>All</button>
                <button onClick={()=>setGroupFilter(new Set())} style={{ fontSize:11, color:"#2563EB", background:"none", border:"none", cursor:"pointer", padding:0 }}>None</button>
              </div>
              {GROUP_ORDER.map(g=>(
                <label key={g} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4, cursor:"pointer" }}>
                  <input type="checkbox" checked={groupFilter.has(g)} onChange={()=>toggleSet(setGroupFilter,g)} style={{ accentColor:GROUP_CONFIG[g].color }} />
                  <span style={{ width:8, height:8, borderRadius:2, background:GROUP_CONFIG[g].color, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:12 }}>{GROUP_CONFIG[g].label}</span>
                  <span style={{ color:"#9CA3AF", fontSize:11 }}>{groupCounts[g]||0}</span>
                </label>
              ))}
              <div style={{ borderTop:"1px solid #F3F4F6", margin:"10px 0" }} />
              <div style={sectionHead}>Margin</div>
              {MARGINS.map(m=>(
                <label key={m} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4, cursor:"pointer" }}>
                  <input type="checkbox" checked={marginFilter.has(m)} onChange={()=>toggleSet(setMarginFilter,m)} style={{ accentColor:MARGIN_COLOR[m] }} />
                  <span style={{ width:8, height:8, borderRadius:"50%", background:MARGIN_COLOR[m], flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:12 }}>{MARGIN_LABEL[m]}</span>
                  <span style={{ color:"#9CA3AF", fontSize:11 }}>{marginCounts[m]||0}</span>
                </label>
              ))}
              <button onClick={()=>{setSearch("");setStateFilter(new Set(STATES));setGroupFilter(new Set(GROUP_ORDER));setMarginFilter(new Set(MARGINS));}}
                style={{ marginTop:12, width:"100%", padding:"7px 0", background:"#F3F4F6", border:"none", borderRadius:7, cursor:"pointer", fontSize:12, color:"#374151", fontWeight:600 }}>
                Clear all filters
              </button>
            </div>
          </aside>
          <div style={{ flex:1, padding:16, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <span style={{ fontWeight:700, fontSize:19, color:"#111" }}>All Seats</span>
              <span style={{ fontSize:13, color:"#6B7280" }}>{filtered.length} of {SEATS.length} seats</span>
            </div>
            <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, overflow:"hidden" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ borderBottom:"1px solid #E5E7EB" }}>
                      <SortTh k="name">Division</SortTh>
                      <SortTh k="state">State</SortTh>
                      <SortTh k="party">Party</SortTh>
                      <th style={{ padding:"10px 12px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", textAlign:"left" }}>Winner</th>
                      <th style={{ padding:"10px 12px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", whiteSpace:"nowrap", textAlign:"left" }}>TCP %</th>
                      <SortTh k="margin">Margin</SortTh>
                      <SortTh k="swing">Swing</SortTh>
                      <th style={{ padding:"10px 12px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", textAlign:"left" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding:40, textAlign:"center", color:"#9CA3AF" }}>No seats match current filters.</td></tr>
                    ) : filtered.map((s,i) => {
                      const p = getParty(s.winner.party);
                      const cat = getMarginCat(s.margin);
                      const isExpanded = expandedSeatTabDemogId === s.id;
                      const d = getDemog(s.id);
                      return (
                        <>
                          <tr key={s.id}
                            onClick={() => setExpandedSeatTabDemogId(prev => prev === s.id ? null : s.id)}
                            style={{ background: isExpanded ? "#EFF6FF" : i%2===0?"#fff":"#FAFAFA", borderBottom: isExpanded ? "none" : "1px solid #F3F4F6", cursor:"pointer" }}
                            onMouseEnter={e=>{ if (!isExpanded) e.currentTarget.style.background="#EFF6FF"; }}
                            onMouseLeave={e=>{ if (!isExpanded) e.currentTarget.style.background=i%2===0?"#fff":"#FAFAFA"; }}>
                            <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                                <div style={{ width:3, height:30, background:p.color, borderRadius:2, flexShrink:0 }} />
                                <div>
                                  <div style={{ fontWeight:700, color:"#111" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</div>
                                  <div style={{ fontSize:11, color:"#9CA3AF" }}>ID {s.id}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding:"9px 12px" }}>
                              <span style={{ background:"#F3F4F6", color:"#374151", fontWeight:600, fontSize:12, padding:"2px 7px", borderRadius:4 }}>{s.state}</span>
                            </td>
                            <td style={{ padding:"9px 12px" }}><PartyBadge party={s.winner.party} /></td>
                            <td style={{ padding:"9px 12px", color:"#374151" }}>{s.winner.name}</td>
                            <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}><TcpBar tcp={s.tcp} winnerParty={s.winner.party} /></td>
                            <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}><MarginDot margin={s.margin} /></td>
                            <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}><SwingBadge swing={s.swing} /></td>
                            <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                              <span style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:20, background:MARGIN_COLOR[cat]+"20", color:MARGIN_COLOR[cat] }}>
                                {cat==="very_marginal"?"Very marginal":cat==="marginal"?"Marginal":cat==="fairly_safe"?"Fairly safe":"Safe"}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${s.id}-demog`}>
                              <td colSpan={8} style={{ background:"#F0F9FF", padding:"14px 20px", borderBottom:"2px solid #BFDBFE" }}>
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>Income</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
                                      <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                      <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                      <div><strong>ATO Taxable:</strong> {d.avgTaxableIncome ? `$${(d.avgTaxableIncome/1000).toFixed(0)}k` : <span style={{color:"#9CA3AF"}}>n/a</span>}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>Housing</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
                                      <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                      <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                      <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                      <div><strong>Owner outright:</strong> {d.ownerOutrightPct != null ? `${d.ownerOutrightPct}%` : "—"}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>People</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
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
              <div style={{ padding:"9px 16px", background:"#F9FAFB", borderTop:"1px solid #F3F4F6", fontSize:12, color:"#9CA3AF", display:"flex", justifyContent:"space-between" }}>
                <span>Showing <strong style={{color:"#374151"}}>{filtered.length}</strong> seats · Sorted by <strong style={{color:"#374151"}}>{sortKey}</strong> ({sortDir})</span>
                <span>Click headers to sort</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ POLLS TAB ═════════════════════════════════════ */}
      {activeTab === "polls" && (
        <div style={{ padding:"20px 24px", maxWidth:1000, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div>
              <h2 style={{ fontSize:20, fontWeight:800, margin:0 }}>Polling Tracker</h2>
              <p style={{ color:"#6B7280", fontSize:13, margin:"4px 0 0" }}>{polls.length} polls · manually entered · tap "Load into Model" to run scenarios</p>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={loadFromPoll}
                style={{ padding:"7px 14px", background:"#1D4ED8", color:"#fff", border:"none", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600 }}>
                Load latest → Model
              </button>
              <button onClick={()=>setShowAddPoll(s=>!s)}
                style={{ padding:"7px 14px", background:"#F3F4F6", color:"#374151", border:"1px solid #D1D5DB", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600 }}>
                {showAddPoll ? "Cancel" : "+ Add poll"}
              </button>
            </div>
          </div>

          {/* Add poll form */}
          {showAddPoll && (
            <div style={{ ...panelStyle, background:"#F0F9FF", borderColor:"#BAE6FD", marginBottom:16 }}>
              <div style={{ fontWeight:700, marginBottom:12, color:"#0369A1" }}>Add new poll</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:12 }}>
                {[
                  { key:"pollster", label:"Pollster",    type:"text",   placeholder:"e.g. Newspoll" },
                  { key:"date",     label:"Date",        type:"date",   placeholder:"" },
                  { key:"alp",      label:"ALP %",       type:"number", placeholder:"e.g. 33" },
                  { key:"coal",     label:"Coalition %", type:"number", placeholder:"e.g. 38" },
                  { key:"grn",      label:"Greens %",    type:"number", placeholder:"e.g. 13" },
                  { key:"tpp",      label:"2PP ALP %",   type:"number", placeholder:"e.g. 49" },
                ].map(({ key, label, type, placeholder }) => (
                  <div key={key}>
                    <label style={{ fontSize:11, fontWeight:700, color:"#374151", display:"block", marginBottom:3 }}>{label}</label>
                    <input type={type} value={newPoll[key]} placeholder={placeholder}
                      onChange={e => setNewPoll(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:6, padding:"6px 9px", fontSize:13, boxSizing:"border-box", outline:"none" }} />
                  </div>
                ))}
              </div>
              {newPoll.alp && newPoll.coal && newPoll.grn && (
                <div style={{ fontSize:12, color:"#6B7280", marginBottom:10 }}>
                  Other / minor parties: {(100 - (+newPoll.alp||0) - (+newPoll.coal||0) - (+newPoll.grn||0)).toFixed(1)}%
                </div>
              )}
              <button onClick={addPoll}
                style={{ padding:"8px 20px", background:"#0369A1", color:"#fff", border:"none", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:700 }}>
                Save poll
              </button>
            </div>
          )}

          {/* Latest poll summary */}
          {latestPoll && (
            <div style={{ ...panelStyle, marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontWeight:700, color:"#374151" }}>Latest: {latestPoll.pollster} · {new Date(latestPoll.date).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"})}</div>
                {pollAvg && <div style={{ fontSize:12, color:"#6B7280" }}>{pollAvg.n}-poll avg shown in brackets</div>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
                {[
                  { label:"ALP primary",       value:latestPoll.alp,  avg:pollAvg?.alp,  color:"#DC2626", delta: latestPoll.alp - BASELINE_2022.alp },
                  { label:"Coalition primary",  value:latestPoll.coal, avg:pollAvg?.coal, color:"#1D4ED8", delta: latestPoll.coal - BASELINE_2022.coal },
                  { label:"Greens primary",     value:latestPoll.grn,  avg:pollAvg?.grn,  color:"#059669", delta: latestPoll.grn - BASELINE_2022.grn },
                  { label:"Other / minor",      value:latestPoll.oth,  avg:pollAvg?.oth,  color:"#7C3AED", delta: null },
                  { label:"2PP (ALP)",          value:latestPoll.tpp,  avg:pollAvg?.tpp,  color:"#DC2626", delta: latestPoll.tpp - NATIONAL_2PP_2022 },
                ].map(card => (
                  <div key={card.label} style={{ background:"#F9FAFB", borderRadius:8, border:"1px solid #E5E7EB", padding:"12px 14px" }}>
                    <div style={{ width:20, height:3, background:card.color, borderRadius:2, marginBottom:6 }} />
                    <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                      <span style={{ fontSize:24, fontWeight:800, color:"#111" }}>{card.value}%</span>
                      {card.avg !== undefined && <span style={{ fontSize:12, color:"#9CA3AF" }}>({card.avg}%)</span>}
                    </div>
                    {card.delta !== null && (
                      <div style={{ fontSize:11, fontWeight:600, color: card.delta>0?"#059669":card.delta<0?"#DC2626":"#9CA3AF", marginTop:2 }}>
                        {card.delta>0?"+":""}{card.delta.toFixed(1)} vs 2022
                      </div>
                    )}
                    <div style={{ fontSize:11, color:"#6B7280", marginTop:2 }}>{card.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trend chart */}
          <div style={panelStyle}>
            <div style={{ fontWeight:700, color:"#374151", marginBottom:14 }}>Polling trends</div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={pollChartData} margin={{ top:4, right:10, left:-10, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize:11 }} />
                <YAxis domain={[0,60]} tick={{ fontSize:11 }} tickFormatter={v=>`${v}%`} />
                <Tooltip formatter={(v,name) => [`${v}%`, name]} contentStyle={{ fontSize:12, borderRadius:8, border:"1px solid #E5E7EB" }} />
                <Legend wrapperStyle={{ fontSize:12 }} />
                <ReferenceLine y={50} stroke="#9CA3AF" strokeDasharray="5 5" label={{ value:"50%", fontSize:10, fill:"#9CA3AF", position:"insideRight" }} />
                <Line type="monotone" dataKey="ALP"        stroke="#DC2626" strokeWidth={2} dot={{ r:3 }} />
                <Line type="monotone" dataKey="Coalition"  stroke="#1D4ED8" strokeWidth={2} dot={{ r:3 }} />
                <Line type="monotone" dataKey="Greens"     stroke="#059669" strokeWidth={2} dot={{ r:3 }} />
                <Line type="monotone" dataKey="2PP (ALP)"  stroke="#DC2626" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r:4 }} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize:11, color:"#9CA3AF", marginTop:6, textAlign:"center" }}>Dashed red = 2PP ALP · Solid red = ALP primary · Dashed line at 50% = majority</div>
          </div>

          {/* Polls table */}
          <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #E5E7EB" }}>
                  {["Pollster","Date","ALP %","Coalition %","Greens %","Other %","2PP ALP %",""].map((h,i) => (
                    <th key={i} style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPolls.map((p,i) => (
                  <tr key={p.id} style={{ background:i%2===0?"#fff":"#FAFAFA", borderBottom:"1px solid #F3F4F6" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#EFF6FF"}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#fff":"#FAFAFA"}>
                    <td style={{ padding:"9px 12px", fontWeight:600 }}>{p.pollster}</td>
                    <td style={{ padding:"9px 12px", color:"#6B7280" }}>{new Date(p.date).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"})}</td>
                    {[p.alp, p.coal, p.grn, p.oth].map((v,j) => (
                      <td key={j} style={{ padding:"9px 12px" }}>
                        <span style={{ fontWeight:600, color:["#DC2626","#1D4ED8","#059669","#7C3AED"][j] }}>{v}%</span>
                      </td>
                    ))}
                    <td style={{ padding:"9px 12px" }}>
                      <span style={{ fontWeight:700, fontSize:14, color:p.tpp>=50?"#059669":"#DC2626" }}>{p.tpp}%</span>
                      <span style={{ fontSize:11, color:"#9CA3AF", marginLeft:5 }}>({p.tpp>=50?"ALP ahead":"Coalition ahead"})</span>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <button onClick={()=>deletePoll(p.id)}
                        style={{ fontSize:11, color:"#EF4444", background:"none", border:"none", cursor:"pointer", padding:0 }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
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
            style={{ border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 10px", fontSize:13, fontWeight:700, outline:"none", background:"#fff", cursor:"pointer" }}>
            {modelElectionOptions.map(id => <option key={id} value={id}>{ELECTION_DATA[id].label}</option>)}
          </select>
        );
        return (
        <div style={{ padding:"20px 24px", maxWidth:1200, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:4 }}>
                <h2 style={{ fontSize:20, fontWeight:800, margin:0 }}>
                  {el.modelEnabled ? "Scenario Builder" : `${el.label} — Results`}
                </h2>
                {elSelector}
              </div>
              <p style={{ color:"#6B7280", fontSize:13, margin:0 }}>
                {el.modelEnabled
                  ? `${el.date} · ${el.chamber} · Adjust primary vote swings and preference flows.`
                  : `${el.date} · ${el.chamber} · ${el.totalSeats} seats · Majority: ${el.majority}`}
              </p>
            </div>
            {el.modelEnabled && selectedModelId === "federal_2022" && (
              <div style={{ display:"flex", gap:8 }}>
                {hasChanges && (
                  <button onClick={resetModel}
                    style={{ padding:"7px 14px", background:"#FEF2F2", color:"#DC2626", border:"1px solid #FECACA", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600 }}>
                    Reset model
                  </button>
                )}
                {polls.length > 0 && (
                  <button onClick={loadFromPoll}
                    style={{ padding:"7px 14px", background:"#F0F9FF", color:"#0369A1", border:"1px solid #BAE6FD", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600 }}>
                    Load from latest poll
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── State election results view ── */}
          {!el.modelEnabled && (() => {
            const tallySeats = mkSeatsFromCounts(el.counts);
            const tightest = [...el.seats].sort((a,b) => a.margin - b.margin).slice(0, 10);
            return (
              <div style={{ maxWidth:900 }}>
                <div style={panelStyle}>
                  <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Seat composition</div>
                  <TallyBar seats={tallySeats} />
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:8, marginTop:16 }}>
                    {GROUP_ORDER.map(g => {
                      const n = el.counts[g];
                      if (!n) return null;
                      return (
                        <div key={g} style={{ background:"#F9FAFB", borderRadius:8, border:"1px solid #E5E7EB", padding:"10px 12px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                            <span style={{ width:9, height:9, borderRadius:2, background:GROUP_CONFIG[g].color, display:"inline-block" }} />
                            <span style={{ fontSize:11, fontWeight:700, color:"#374151" }}>{GROUP_CONFIG[g].label}</span>
                          </div>
                          <div style={{ fontSize:22, fontWeight:800, color:"#111" }}>{n}</div>
                          <div style={{ fontSize:11, color:"#9CA3AF" }}>of {el.totalSeats} seats</div>
                        </div>
                      );
                    })}
                  </div>
                  {el.twopp && (
                    <div style={{ marginTop:12, fontSize:13, color:"#6B7280" }}>
                      2PP (ALP): <strong style={{ color: el.twopp >= 50 ? "#059669" : "#DC2626" }}>{el.twopp}%</strong>
                    </div>
                  )}
                </div>
                <div style={panelStyle}>
                  <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Key marginal seats</div>
                  {tightest.map(s => {
                    const p = getParty(s.winner.party);
                    return (
                      <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid #F3F4F6" }}>
                        <div style={{ width:3, height:34, background:p.color, borderRadius:2, flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:600, fontSize:13 }}>{s.name} <span style={{ color:"#9CA3AF", fontWeight:400 }}>({s.state})</span></div>
                          <div style={{ fontSize:11, color:"#6B7280" }}>{s.winner.name}</div>
                        </div>
                        <PartyBadge party={s.winner.party} />
                        <span style={{ fontWeight:700, color:MARGIN_COLOR[getMarginCat(s.margin)], minWidth:40, textAlign:"right" }}>{s.margin.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize:11, color:"#9CA3AF", marginTop:8, paddingTop:8, borderTop:"1px solid #F3F4F6" }}>
                    Representative marginal seats only · Full seat-by-seat data not available for state elections
                  </div>
                </div>
                <div style={{ ...panelStyle, background:"#F9FAFB", padding:"16px 20px" }}>
                  <div style={{ fontSize:13, color:"#6B7280" }}>
                    Interactive scenario builders are available for <strong>Federal 2022</strong> and <strong>Victoria 2022</strong>. Select them from the dropdown above.
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Federal scenario builder ── */}
          {el.modelEnabled && selectedModelId === "federal_2022" && <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:16, alignItems:"start" }}>

            {/* ── Controls panel ── */}
            <div>
              <div style={panelStyle}>
                <div style={sectionHead}>Primary vote %</div>
                <PrimaryInput label="ALP"          value={primaries.alp}  onChange={v=>setPrimaries(p=>({...p,alp:v}))}  color="#DC2626" baseline={BASELINE_2022.alp}  />
                <PrimaryInput label="Coalition"    value={primaries.coal} onChange={v=>setPrimaries(p=>({...p,coal:v}))} color="#1D4ED8" baseline={BASELINE_2022.coal} />
                <PrimaryInput label="Greens"       value={primaries.grn}  onChange={v=>setPrimaries(p=>({...p,grn:v}))}  color="#059669" baseline={BASELINE_2022.grn}  />
                <PrimaryInput label="Independents" value={primaries.teal} onChange={v=>setPrimaries(p=>({...p,teal:v}))} color="#0891B2" baseline={BASELINE_2022.teal} />
                <PrimaryInput label="One Nation"   value={primaries.on}   onChange={v=>setPrimaries(p=>({...p,on:v}))}   color="#B45309" baseline={BASELINE_2022.on}   />
                {(() => {
                  const entered = +(primaries.alp + primaries.coal + primaries.grn + primaries.teal + primaries.on).toFixed(1);
                  const other   = +(100 - entered).toFixed(1);
                  const overLimit = entered > 100;
                  return (
                    <div style={{ borderTop:"1px solid #F3F4F6", paddingTop:10, marginTop:4, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:"#6B7280" }}>Other / minor parties</span>
                      <span style={{ fontSize:13, fontWeight:700, color: overLimit ? "#DC2626" : "#374151" }}>
                        {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                      </span>
                    </div>
                  );
                })()}
                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:6 }}>
                  2022 result: ALP {BASELINE_2022.alp}% · Coal {BASELINE_2022.coal}% · Grn {BASELINE_2022.grn}% · Ind {BASELINE_2022.teal}% · ON {BASELINE_2022.on}%
                </div>
              </div>

              {/* ON scenario presets + auto-detect threshold */}
              <div style={panelStyle}>
                <div style={sectionHead}>One Nation scenarios</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
                  {[[4.7,"2022 baseline"],[7,"Moderate rise"],[9,"Strong rise"],[11,"Peak (~2016)"]].map(([pct, label]) => {
                    const active = Math.abs(primaries.on - pct) < 0.05;
                    return (
                      <button key={pct} onClick={() => setPrimaries(p=>({...p,on:pct}))}
                        style={{ padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
                          background:active?"#B45309":"#FEF3C7", color:active?"#fff":"#92400E",
                          border:`1px solid ${active?"#B45309":"#FDE68A"}` }}>
                        {label} ({pct}%)
                      </button>
                    );
                  })}
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"8px 10px", background:"#FFFBEB", borderRadius:7, border:"1px solid #FDE68A" }}>
                  <label style={{ fontSize:12, fontWeight:600, color:"#92400E", whiteSpace:"nowrap" }}>
                    Auto-detect TCP above:
                  </label>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <input type="number" min={0} max={30} step={0.5} value={onThreshold}
                      onChange={e => setOnThreshold(+e.target.value)}
                      style={{ width:56, border:"1px solid #FDE68A", borderRadius:5, padding:"3px 6px", fontSize:13, fontWeight:700, textAlign:"center", background:"#fff", outline:"none" }} />
                    <span style={{ fontSize:12, color:"#B45309", fontWeight:600 }}>%</span>
                  </div>
                </div>
                {autoOnCount > 0 && (
                  <div style={{ fontSize:11, color:"#B45309", marginTop:6, fontWeight:600 }}>
                    {autoOnCount} seat{autoOnCount!==1?"s":""} auto-detected as ON TCP contest{autoOnCount!==1?"s":""}
                  </div>
                )}
                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:6 }}>
                  Uses seat-level 2022 ON primary as baseline. When ON's estimated primary exceeds this threshold and beats ALP or Coalition in a seat, that seat is automatically modelled as an ON vs ALP or ON vs Coalition final.
                </div>
              </div>

              {/* Standard preference flows (ALP vs Coalition finals) */}
              <div style={panelStyle}>
                <div style={sectionHead}>Preference flows to ALP</div>
                <div style={{ fontSize:11, color:"#9CA3AF", marginBottom:8 }}>Used in standard ALP vs Coalition finals. Remainder flows to Coalition.</div>
                <PrefInput label="Greens → ALP"      value={prefFlows.grn_alp}   onChange={v=>setPrefFlows(f=>({...f,grn_alp:v}))}   color="#059669" />
                <PrefInput label="Independents → ALP" value={prefFlows.teal_alp} onChange={v=>setPrefFlows(f=>({...f,teal_alp:v}))} color="#0891B2" />
                <PrefInput label="One Nation → ALP"  value={prefFlows.on_alp}    onChange={v=>setPrefFlows(f=>({...f,on_alp:v}))}    color="#B45309" />
                <PrefInput label="Other → ALP"       value={prefFlows.other_alp} onChange={v=>setPrefFlows(f=>({...f,other_alp:v}))} color="#7C3AED" />
                <div style={{ fontSize:11, color:"#9CA3AF", borderTop:"1px solid #F3F4F6", paddingTop:8, marginTop:4 }}>
                  Defaults based on 2022 distributions (Grn 81%, Ind 62%, ON 43%, Other 50%).
                </div>
              </div>

              {/* Advanced ON race flows — collapsed by default */}
              <div style={panelStyle}>
                <button
                  onClick={() => setShowAdvancedFlows(v => !v)}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", cursor:"pointer", padding:0, marginBottom: showAdvancedFlows ? 12 : 0 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#374151" }}>
                    Advanced: ON race flows
                    {autoOnCount > 0 && (
                      <span style={{ marginLeft:7, fontSize:10, background:"#B45309", color:"#fff", padding:"1px 7px", borderRadius:8, fontWeight:600 }}>
                        {autoOnCount} seat{autoOnCount!==1?"s":""} affected
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize:13, color:"#9CA3AF" }}>{showAdvancedFlows ? "▲" : "▼"}</span>
                </button>
                {showAdvancedFlows && (
                  <div>
                    {/* ON vs ALP final flows */}
                    <div style={{ marginBottom:12, padding:"10px 12px", background:"#FEF3C7", borderRadius:8, border:"1px solid #FDE68A" }}>
                      <div style={{ fontSize:11, fontWeight:800, color:"#92400E", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                        ON vs ALP final — flows toward ALP
                      </div>
                      <div style={{ fontSize:11, color:"#B45309", marginBottom:8 }}>
                        When ON beats Coalition to be in the final count against ALP. Greens/teal voters flow more strongly to ALP here because they oppose ON more than Coalition.
                      </div>
                      <PrefInput label="Greens → ALP"      value={prefFlows.grn_alp_v_on}   onChange={v=>setPrefFlows(f=>({...f,grn_alp_v_on:v}))}   color="#059669" />
                      <PrefInput label="Independents → ALP" value={prefFlows.teal_alp_v_on}  onChange={v=>setPrefFlows(f=>({...f,teal_alp_v_on:v}))}  color="#0891B2" />
                      <PrefInput label="Other → ALP"        value={prefFlows.other_alp_v_on} onChange={v=>setPrefFlows(f=>({...f,other_alp_v_on:v}))} color="#7C3AED" />
                      <PrefInput label="Coalition → ALP"    value={prefFlows.coal_alp_v_on}  onChange={v=>setPrefFlows(f=>({...f,coal_alp_v_on:v}))}  color="#1D4ED8" />
                      <div style={{ fontSize:11, color:"#9CA3AF", borderTop:"1px solid #FDE68A", paddingTop:6, marginTop:2 }}>
                        Defaults: Grn 90% · Ind 75% · Other 60% · Coal 10%
                      </div>
                    </div>
                    {/* ON vs Coal final flows */}
                    <div style={{ padding:"10px 12px", background:"#FEF3C7", borderRadius:8, border:"1px solid #FDE68A" }}>
                      <div style={{ fontSize:11, fontWeight:800, color:"#92400E", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                        ON vs Coalition final — flows toward ON
                      </div>
                      <div style={{ fontSize:11, color:"#B45309", marginBottom:8 }}>
                        When ON beats ALP to be in the final count against Coalition. Greens/teal voters flow minimally to ON because they strongly prefer Coalition over ON in this scenario.
                      </div>
                      <PrefInput label="ALP → ON"           value={prefFlows.alp_on_v_coal}   onChange={v=>setPrefFlows(f=>({...f,alp_on_v_coal:v}))}   color="#DC2626" />
                      <PrefInput label="Greens → ON"        value={prefFlows.grn_on_v_coal}   onChange={v=>setPrefFlows(f=>({...f,grn_on_v_coal:v}))}   color="#059669" />
                      <PrefInput label="Independents → ON"  value={prefFlows.teal_on_v_coal}  onChange={v=>setPrefFlows(f=>({...f,teal_on_v_coal:v}))}  color="#0891B2" />
                      <PrefInput label="Other → ON"         value={prefFlows.other_on_v_coal} onChange={v=>setPrefFlows(f=>({...f,other_on_v_coal:v}))} color="#7C3AED" />
                      <div style={{ fontSize:11, color:"#9CA3AF", borderTop:"1px solid #FDE68A", paddingTop:6, marginTop:2 }}>
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
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Implied 2PP (ALP)</div>
                  {implied2pp !== null ? (
                    <>
                      <div style={{ fontSize:30, fontWeight:800, color: implied2pp>=50?"#059669":"#DC2626" }}>{implied2pp.toFixed(1)}%</div>
                      <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>
                        {implied2pp>=50 ? `▲ +${(implied2pp-NATIONAL_2PP_2022).toFixed(1)} vs 2022` : `▼ ${(implied2pp-NATIONAL_2PP_2022).toFixed(1)} vs 2022`}
                      </div>
                    </>
                  ) : <div style={{ fontSize:20, color:"#9CA3AF" }}>—</div>}
                </div>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Seats changing</div>
                  <div style={{ fontSize:30, fontWeight:800, color: changedSeats.length>0?"#F59E0B":"#6B7280" }}>{changedSeats.length}</div>
                  <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>of {SEATS.length} modelled</div>
                </div>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Majority</div>
                  {(() => {
                    const alpProj = projCounts.alp || 0;
                    const needsMaj = 76;
                    const projMaj = alpProj >= needsMaj ? "ALP majority" : (((projCounts.coalition||0) >= needsMaj) ? "Coalition majority" : "Hung parliament");
                    const majColor = alpProj >= needsMaj ? "#059669" : (((projCounts.coalition||0) >= needsMaj) ? "#1D4ED8" : "#F59E0B");
                    return (
                      <>
                        <div style={{ fontSize:16, fontWeight:800, color:majColor, marginTop:4 }}>{projMaj}</div>
                        <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>76 seats needed</div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Tally comparison: 2022 vs projected */}
              <div style={panelStyle}>
                <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Seat composition</div>
                <div style={{ marginBottom:8 }}>
                  <div style={{ fontSize:12, color:"#6B7280", marginBottom:4 }}>2022 result</div>
                  <TallyBar seats={SEATS} />
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <div style={{ fontSize:12, color:"#6B7280" }}>Projected</div>
                    {hasChanges && <span style={{ fontSize:11, background:"#FEF3C7", color:"#92400E", padding:"1px 6px", borderRadius:10, fontWeight:600 }}>scenario active</span>}
                  </div>
                  <TallyBar seats={modelledSeats} useModelled={true} />
                </div>

                {/* Delta table */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:8, marginTop:8 }}>
                  {GROUP_ORDER.map(g => {
                    const base = baseCounts[g] || 0;
                    const proj = projCounts[g] || 0;
                    const delta = proj - base;
                    return (
                      <div key={g} style={{ background:"#F9FAFB", borderRadius:8, border:"1px solid #E5E7EB", padding:"10px 12px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                          <span style={{ width:9, height:9, borderRadius:2, background:GROUP_CONFIG[g].color, display:"inline-block" }} />
                          <span style={{ fontSize:11, fontWeight:700, color:"#374151" }}>{GROUP_CONFIG[g].label}</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                          <span style={{ fontSize:22, fontWeight:800, color:"#111" }}>{proj}</span>
                          <span style={{ fontSize:12, color:"#6B7280" }}>/ {base} base</span>
                        </div>
                        {delta !== 0 && (
                          <div style={{ fontSize:12, fontWeight:700, color:delta>0?"#059669":"#DC2626", marginTop:2 }}>
                            {delta>0?"+":""}{delta} seats
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Seat-at-risk rankings ── */}
              {(() => {
                const filterBtnStyle = (active) => ({
                  padding:"4px 12px", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid #D1D5DB",
                  background: active ? "#374151" : "#fff", color: active ? "#fff" : "#374151",
                });
                const filtered = (riskFilter === "all" ? seatsByRisk
                  : riskFilter === "changing" ? seatsByRisk.filter(s => s.modelled.changed)
                  : seatsByRisk.filter(s => getModelledMargin(s) < 5))
                  .filter(s => !modelStateFilter || s.state === modelStateFilter);

                return (
                  <div style={panelStyle}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, color:"#374151", flex:1 }}>Seat-at-risk rankings</span>
                      <select value={modelStateFilter} onChange={e => setModelStateFilter(e.target.value)}
                        style={{ border:"1px solid #D1D5DB", borderRadius:6, padding:"4px 8px", fontSize:12, fontWeight:600, outline:"none", background:"#fff" }}>
                        <option value="">All States</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <div style={{ display:"flex", gap:4 }}>
                        {[["all","All 151"],["changing","Changing"],["marginal","Marginal (<5pp)"]].map(([val, label]) => (
                          <button key={val} onClick={() => setRiskFilter(val)} style={filterBtnStyle(riskFilter === val)}>{label}</button>
                        ))}
                      </div>
                    </div>

                    {/* Column headers */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 48px 80px 80px 80px 70px", gap:4, borderBottom:"2px solid #F3F4F6", paddingBottom:4, marginBottom:4 }}>
                      {[["Seat","#374151"],["State","#6B7280"],["2022","#6B7280"],["Projected","#6B7280"],["Margin","#6B7280"],["",""]].map(([label, color], i) => (
                        <div key={i} style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color, paddingLeft: i===0?2:0 }}>{label}</div>
                      ))}
                    </div>

                    <div style={{ maxHeight:400, overflowY:"auto" }}>
                      {filtered.map(seat => {
                        const margin = getModelledMargin(seat);
                        const isSafe = margin > 10;
                        const changed = seat.modelled.changed;
                        const projGroup = seat.modelled.winnerGroup;
                        const projColor = GROUP_CONFIG[projGroup]?.color ?? "#6B7280";
                        const isExpanded = expandedModelSeatId === seat.id;
                        const d = getDemog(seat.id);

                        return (
                          <div key={seat.id}>
                            <div onClick={() => setExpandedModelSeatId(prev => prev === seat.id ? null : seat.id)}
                              style={{
                                display:"grid", gridTemplateColumns:"1fr 48px 80px 80px 80px 70px", gap:4, alignItems:"center",
                                padding:"5px 2px", borderLeft: `4px solid ${changed ? projColor : "transparent"}`,
                                borderBottom: isExpanded ? "none" : "1px solid #F9FAFB",
                                opacity: isSafe ? 0.55 : 1,
                                background: isExpanded ? "#F0F9FF" : projGroup === "one_nation" && changed ? "#FFFBEB" : "transparent",
                                cursor:"pointer",
                              }}>
                              <span style={{ fontWeight: changed ? 700 : 400, fontSize:13, color:"#111", paddingLeft: changed?4:8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                {isExpanded ? "▾ " : "▸ "}{seat.name}
                              </span>
                              <span style={{ fontSize:11, color:"#6B7280" }}>{seat.state}</span>
                              <div><PartyBadge party={seat.winner.party} /></div>
                              <div>
                                {changed
                                  ? <PartyBadge party={seat.modelled.winnerParty} />
                                  : <span style={{ fontSize:11, color:"#9CA3AF" }}>holds</span>
                                }
                              </div>
                              <span style={{ fontSize:12, fontWeight: margin < 5 ? 700 : 400, color: margin < 2 ? "#DC2626" : margin < 5 ? "#D97706" : "#374151" }}>
                                {margin === Infinity ? "—" : `${margin.toFixed(1)}pp`}
                              </span>
                              <span style={{ fontSize:10, color: changed ? projColor : "#9CA3AF", fontWeight:600 }}>
                                {changed ? "CHANGED" : ""}
                              </span>
                            </div>
                            {isExpanded && (
                              <div style={{ background:"#F8FAFC", borderBottom:"1px solid #E5E7EB", padding:"12px 16px", marginBottom:2 }}>
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>Income</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
                                      <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                      <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>Housing</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
                                      <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                      <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                      <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>People</div>
                                    <div style={{ fontSize:12, lineHeight:1.8 }}>
                                      <div><strong>Median age:</strong> {d.medianAge ?? "—"}</div>
                                      <div><strong>Bachelor's+:</strong> {d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</div>
                                      <div><strong>Overseas born:</strong> {d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</div>
                                      <div><strong>AEC class:</strong> {d.urbanClass ?? "—"}</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filtered.length === 0 && (
                        <div style={{ padding:"20px 0", textAlign:"center", color:"#9CA3AF", fontSize:13 }}>
                          No seats match this filter.
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:"#9CA3AF", marginTop:8, borderTop:"1px solid #F3F4F6", paddingTop:8 }}>
                      {filtered.length} seats shown · Red = &lt;2pp · Amber = &lt;5pp · Faded = safe (&gt;10pp) · Bold left border = projected change · Click row to expand demographics
                    </div>
                  </div>
                );
              })()}

              {/* ── One Nation Seats panel ── */}
              {(() => {
                const ON_COLOR = "#B45309";
                const ON_BG    = "#FEF3C7";
                const ON_LIGHT = "#FFFBEB";

                const SortColBtn = ({ field, label }) => {
                  const active = onSeatSort.field === field;
                  return (
                    <button
                      onClick={() => handleOnSeatSort(field)}
                      style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 6px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color: active ? ON_COLOR : "#9CA3AF", display:"flex", alignItems:"center", gap:3, userSelect:"none", whiteSpace:"nowrap" }}>
                      {label}
                      <span style={{ fontSize:10 }}>{active ? (onSeatSort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  );
                };

                return (
                  <div style={{ border:`2px solid ${ON_COLOR}`, borderRadius:12, marginBottom:16, overflow:"hidden" }}>
                    {/* Orange header */}
                    <div style={{ background:ON_COLOR, padding:"12px 16px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:800, fontSize:14, color:"#fff" }}>One Nation Seats</span>
                      <span style={{ background:"rgba(255,255,255,0.25)", color:"#fff", fontSize:12, fontWeight:700, padding:"2px 10px", borderRadius:10 }}>
                        {projectedOnSeats.length} projected
                      </span>
                      {autoOnCount > 0 && (
                        <span style={{ background:"rgba(0,0,0,0.25)", color:"#fff", fontSize:11, fontWeight:700, padding:"2px 10px", borderRadius:10 }}>
                          {autoOnCount} auto-detected
                        </span>
                      )}
                      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
                        <button
                          onClick={() => setOnCompetitiveOnly(v => !v)}
                          style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:6, cursor:"pointer",
                            background:onCompetitiveOnly?"#fff":"rgba(255,255,255,0.2)",
                            color:onCompetitiveOnly?ON_COLOR:"#fff",
                            border:"1px solid rgba(255,255,255,0.5)" }}>
                          {onCompetitiveOnly ? "Show all seats" : "Competitive only"}
                        </button>
                        <span style={{ color:"rgba(255,255,255,0.75)", fontSize:12 }}>
                          {sortedOnSeatList.length} listed
                        </span>
                      </div>
                    </div>

                    <div style={{ background:"#fff", padding:"12px 14px" }}>
                      {/* Search filter */}
                      <input
                        value={onSeatFilter}
                        onChange={e => setOnSeatFilter(e.target.value)}
                        placeholder="Filter seats by name or state…"
                        style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:7, padding:"7px 10px", fontSize:13, boxSizing:"border-box", outline:"none", marginBottom:8 }}
                      />

                      {/* Column headers — now includes ON% column */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 55px 80px 55px 70px 90px 24px", gap:4, alignItems:"center", borderBottom:`2px solid ${ON_BG}`, paddingBottom:4, marginBottom:4 }}>
                        <SortColBtn field="name"   label="Seat" />
                        <SortColBtn field="state"  label="State" />
                        <SortColBtn field="holder" label="2022 Holder" />
                        <SortColBtn field="margin" label="Margin" />
                        <SortColBtn field="onFp"   label="Est. ON%" />
                        <SortColBtn field="proj"   label="Projected" />
                        <div />
                      </div>

                      {/* Seat rows */}
                      <div style={{ maxHeight:480, overflowY:"auto" }}>
                        {sortedOnSeatList.map(seat => {
                          const isOnProj  = seat.modelled.winnerGroup === "one_nation";
                          const isExpanded = expandedOnSeat === seat.id;
                          const ov = seatOverrides[seat.id] ?? {};
                          const ms = seat.modelled;
                          const seatPrefFlows = ov.prefFlows;
                          const hasSeatPrefFlows = seatPrefFlows && Object.values(seatPrefFlows).some(v => v !== null);
                          const estOn = estimateSeatOnFp(seat.id, swings);
                          const isAboveThreshold = estOn >= onThreshold;
                          // Row highlight: orange if ON projected to win, amber bg if auto-detected contest
                          const isOnContest = isOnProj || ms.isAutoMatchup || ov.tcpMatchup?.startsWith("on_");
                          const rowBg = isOnProj ? ON_LIGHT : ms.isAutoMatchup ? "#FFFBEB" : "transparent";
                          const rowBorder = isOnProj ? `4px solid ${ON_COLOR}` : ms.isAutoMatchup ? "4px solid #F59E0B" : "4px solid transparent";

                          return (
                            <div key={seat.id}>
                              {/* Collapsed row */}
                              <div
                                onClick={() => toggleExpandedOnSeat(seat.id)}
                                style={{ display:"grid", gridTemplateColumns:"1fr 55px 80px 55px 70px 90px 24px", gap:4, alignItems:"center", padding:"6px 2px", cursor:"pointer", background:rowBg, borderLeft:rowBorder, borderRadius:4, marginBottom:1 }}>
                                <span style={{ fontWeight: isOnContest ? 700 : 500, fontSize:13, color:"#111", paddingLeft: isOnContest ? 4 : 8 }}>{seat.name}</span>
                                <span style={{ fontSize:12, color:"#6B7280" }}>{seat.state}</span>
                                <div><PartyBadge party={seat.winner.party} /></div>
                                <span style={{ fontSize:12, color:"#374151" }}>{seat.margin?.toFixed(1)}%</span>
                                <span style={{ fontSize:12, fontWeight: isAboveThreshold ? 700 : 400, color: isAboveThreshold ? ON_COLOR : "#9CA3AF" }}>
                                  {estOn.toFixed(1)}%
                                </span>
                                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                                  {isOnProj
                                    ? <span style={{ background:ON_COLOR, color:"#fff", fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:4 }}>One Nation</span>
                                    : ms.isAutoMatchup
                                      ? <span style={{ background:"#F59E0B", color:"#fff", fontSize:10, fontWeight:700, padding:"1px 5px", borderRadius:4 }}>
                                          {ms.activeTcpMatchup === "on_v_alp" ? "ON v ALP" : "ON v Coal"}
                                        </span>
                                      : <PartyBadge party={ms.winnerParty} />
                                  }
                                  {ms.isAutoMatchup && !isOnProj && (
                                    <span style={{ fontSize:9, color:"#9CA3AF", fontWeight:600 }}>auto</span>
                                  )}
                                  {ov.tcpMatchup && (
                                    <span style={{ fontSize:9, color:"#9CA3AF", fontWeight:600 }}>⚙</span>
                                  )}
                                </div>
                                <span style={{ fontSize:12, color:"#9CA3AF", textAlign:"center" }}>{isExpanded ? "▲" : "▼"}</span>
                              </div>

                              {/* Expanded panel */}
                              {isExpanded && (
                                <div style={{ background:ON_LIGHT, border:`1px solid ${ON_BG}`, borderRadius:8, padding:"12px 14px", marginBottom:6, marginLeft:4 }}>

                                  {/* Auto-detection context */}
                                  {(ms.isAutoMatchup || ov.tcpMatchup) && (
                                    <div style={{ fontSize:11, color:"#92400E", background:"#FEF3C7", border:"1px solid #FDE68A", borderRadius:6, padding:"6px 10px", marginBottom:10 }}>
                                      {ms.isAutoMatchup
                                        ? `Auto-detected: ON estimated at ${estOn.toFixed(1)}% (threshold ${onThreshold}%) → modelled as ${ms.activeTcpMatchup === "on_v_alp" ? "ON vs ALP" : "ON vs Coalition"} final`
                                        : `Manual override: ${ov.tcpMatchup === "on_v_alp" ? "ON vs ALP" : "ON vs Coalition"} final`
                                      }
                                    </div>
                                  )}

                                  {/* Primary vote inputs */}
                                  <div style={{ fontSize:11, fontWeight:800, color:ON_COLOR, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Primary votes</div>
                                  <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:12 }}>
                                    {[["ALP","alp","#DC2626"],["Coal","coal","#1D4ED8"],["Grn","grn","#059669"],["Ind","teal","#0891B2"],["ON","on",ON_COLOR]].map(([label, key, color]) => (
                                      <div key={key} style={{ textAlign:"center" }}>
                                        <div style={{ fontSize:10, fontWeight:800, color, marginBottom:3, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
                                        <input
                                          type="number" min={0} max={100} step={0.5}
                                          value={ov[key] !== null && ov[key] !== undefined ? ov[key] : ""}
                                          placeholder={key === "on" ? estOn.toFixed(1) : (primaries[key]?.toFixed(1) ?? "—")}
                                          onChange={e => updateSeatOverride(seat.id, key, e.target.value)}
                                          style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:5, padding:"5px 4px", fontSize:12, textAlign:"center", boxSizing:"border-box", outline:"none" }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ fontSize:11, color:"#9CA3AF", marginBottom:12 }}>
                                    National: ALP {primaries.alp}% · Coal {primaries.coal}% · Grn {primaries.grn}% · Ind {primaries.teal}% · ON {primaries.on}%
                                    {ON_FP_2022[seat.id] && ` · 2022 seat ON: ${ON_FP_2022[seat.id]}%`}
                                  </div>

                                  {/* Per-seat preference flows */}
                                  <div style={{ borderTop:`1px solid ${ON_BG}`, paddingTop:10 }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                                      <span style={{ fontSize:11, fontWeight:800, color:ON_COLOR, textTransform:"uppercase", letterSpacing:"0.06em" }}>Preference flows</span>
                                      {hasSeatPrefFlows
                                        ? <span style={{ fontSize:10, background:ON_COLOR, color:"#fff", padding:"1px 7px", borderRadius:8, fontWeight:600 }}>seat-level</span>
                                        : (
                                          <button
                                            onClick={() => initSeatPrefFlows(seat.id)}
                                            style={{ fontSize:11, color:ON_COLOR, background:"#fff", border:`1px solid ${ON_COLOR}`, borderRadius:5, padding:"2px 8px", cursor:"pointer", fontWeight:600 }}>
                                            Customise for this seat
                                          </button>
                                        )
                                      }
                                      {hasSeatPrefFlows && (
                                        <button
                                          onClick={() => setSeatOverrides(prev => { const n={...prev}; delete n[seat.id].prefFlows; return {...n, [seat.id]: {...n[seat.id]}}; })}
                                          style={{ fontSize:11, color:"#9CA3AF", background:"none", border:"none", cursor:"pointer", padding:"2px 4px" }}>
                                          Reset to national
                                        </button>
                                      )}
                                    </div>
                                    {hasSeatPrefFlows ? (
                                      <div>
                                        {/* Standard ALP vs Coal flows */}
                                        <div style={{ fontSize:10, fontWeight:700, color:"#6B7280", textTransform:"uppercase", marginBottom:4 }}>Standard (ALP vs Coal)</div>
                                        {[["Greens → ALP","grn_alp","#059669"],["Independents → ALP","teal_alp","#0891B2"],["One Nation → ALP","on_alp",ON_COLOR],["Other → ALP","other_alp","#7C3AED"]].map(([label, key, color]) => (
                                          <PrefInput key={key} label={label} value={seatPrefFlows[key] ?? prefFlows[key]} onChange={v => updateSeatPrefFlow(seat.id, key, Math.round(v * 100))} color={color} />
                                        ))}
                                        {/* ON vs ALP flows */}
                                        {(ms.activeTcpMatchup === "on_v_alp" || ov.tcpMatchup === "on_v_alp") && (
                                          <>
                                            <div style={{ fontSize:10, fontWeight:700, color:"#92400E", textTransform:"uppercase", marginBottom:4, marginTop:10 }}>ON vs ALP final — flows to ALP</div>
                                            {[["Greens → ALP","grn_alp_v_on","#059669"],["Independents → ALP","teal_alp_v_on","#0891B2"],["Other → ALP","other_alp_v_on","#7C3AED"],["Coalition → ALP","coal_alp_v_on","#1D4ED8"]].map(([label, key, color]) => (
                                              <PrefInput key={key} label={label} value={seatPrefFlows[key] ?? prefFlows[key]} onChange={v => updateSeatPrefFlow(seat.id, key, Math.round(v * 100))} color={color} />
                                            ))}
                                          </>
                                        )}
                                        {/* ON vs Coal flows */}
                                        {(ms.activeTcpMatchup === "on_v_coal" || ov.tcpMatchup === "on_v_coal") && (
                                          <>
                                            <div style={{ fontSize:10, fontWeight:700, color:"#92400E", textTransform:"uppercase", marginBottom:4, marginTop:10 }}>ON vs Coalition final — flows to ON</div>
                                            {[["ALP → ON","alp_on_v_coal","#DC2626"],["Greens → ON","grn_on_v_coal","#059669"],["Independents → ON","teal_on_v_coal","#0891B2"],["Other → ON","other_on_v_coal","#7C3AED"]].map(([label, key, color]) => (
                                              <PrefInput key={key} label={label} value={seatPrefFlows[key] ?? prefFlows[key]} onChange={v => updateSeatPrefFlow(seat.id, key, Math.round(v * 100))} color={color} />
                                            ))}
                                          </>
                                        )}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize:12, color:"#9CA3AF" }}>
                                        {ms.activeTcpMatchup === "on_v_alp" || ov.tcpMatchup === "on_v_alp"
                                          ? `Using ON vs ALP flows: Grn ${Math.round(prefFlows.grn_alp_v_on*100)}% · Ind ${Math.round(prefFlows.teal_alp_v_on*100)}% · Other ${Math.round(prefFlows.other_alp_v_on*100)}% · Coal ${Math.round(prefFlows.coal_alp_v_on*100)}% → ALP`
                                          : ms.activeTcpMatchup === "on_v_coal" || ov.tcpMatchup === "on_v_coal"
                                            ? `Using ON vs Coal flows: ALP ${Math.round(prefFlows.alp_on_v_coal*100)}% · Grn ${Math.round(prefFlows.grn_on_v_coal*100)}% · Ind ${Math.round(prefFlows.teal_on_v_coal*100)}% · Other ${Math.round(prefFlows.other_on_v_coal*100)}% → ON`
                                            : `Using national flows: Grn ${Math.round(prefFlows.grn_alp*100)}% · Ind ${Math.round(prefFlows.teal_alp*100)}% · ON ${Math.round(prefFlows.on_alp*100)}% · Other ${Math.round(prefFlows.other_alp*100)}% → ALP`
                                        }
                                      </div>
                                    )}
                                  </div>

                                  {/* TCP Matchup */}
                                  <div style={{ borderTop:`1px solid ${ON_BG}`, paddingTop:10, marginTop:10 }}>
                                    <div style={{ fontSize:11, fontWeight:700, color:ON_COLOR, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>TCP Matchup</div>
                                    <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                                      {[["auto","Auto (threshold-based)"],["on_v_alp","Force ON vs ALP"],["on_v_coal","Force ON vs Coal"]].map(([val, label]) => {
                                        const active = (ov.tcpMatchup ?? "auto") === val;
                                        return (
                                          <button key={val}
                                            onClick={() => updateSeatOverride(seat.id, "tcpMatchup", val === "auto" ? null : val)}
                                            style={{ padding:"3px 9px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background:active?ON_COLOR:"#fff", color:active?"#fff":ON_COLOR, border:`1px solid ${ON_COLOR}` }}>
                                            {label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {ms.isAutoMatchup && !ov.tcpMatchup && (
                                      <div style={{ fontSize:11, color:"#B45309", marginTop:5 }}>
                                        Currently auto-detected as {ms.activeTcpMatchup === "on_v_alp" ? "ON vs ALP" : "ON vs Coalition"}. Select "Force" to lock in manually.
                                      </div>
                                    )}
                                  </div>

                                  {/* Modelled outcome */}
                                  <div style={{ borderTop:`1px solid ${ON_BG}`, paddingTop:10, marginTop:10, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:11, fontWeight:700, color:"#374151" }}>Modelled:</span>
                                    {isOnProj
                                      ? <span style={{ background:ON_COLOR, color:"#fff", fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:5 }}>One Nation wins</span>
                                      : <PartyBadge party={ms.winnerParty} />
                                    }
                                    {ms.projAlp2pp !== null && (
                                      <span style={{ fontSize:12, color:"#6B7280" }}>ALP 2PP {ms.projAlp2pp.toFixed(1)}%</span>
                                    )}
                                    {ms.winnerPct !== null && (
                                      <span style={{ fontSize:12, color:"#6B7280" }}>
                                        {isOnProj ? `ON TCP ${ms.winnerPct?.toFixed(1)}%` : `margin ${Math.abs(ms.winnerPct - 50).toFixed(1)}pp`}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => clearOverride(seat.id)}
                                      style={{ marginLeft:"auto", fontSize:11, color:"#EF4444", background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:5, padding:"3px 8px", cursor:"pointer", fontWeight:600 }}>
                                      Clear overrides
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Seats changing hands */}
              {changedSeats.length > 0 && (
                <div style={panelStyle}>
                  <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Seats changing hands ({changedSeats.length})</div>
                  {(() => {
                    const alpGains  = changedSeats.filter(s => s.modelled.winnerGroup === "alp" && getParty(s.winner.party).group !== "alp");
                    const alpLosses = changedSeats.filter(s => getParty(s.winner.party).group === "alp" && s.modelled.winnerGroup !== "alp");
                    const other     = changedSeats.filter(s => s.modelled.winnerGroup !== "alp" && getParty(s.winner.party).group !== "alp");
                    const SeatRow = ({ seat, direction }) => {
                      const baseP = getParty(seat.winner.party);
                      const projP = getParty(seat.modelled.winnerParty);
                      const alp2pp = seat.modelled.projAlp2pp;
                      return (
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid #F3F4F6" }}>
                          <span style={{ fontSize:14 }}>{direction}</span>
                          <div style={{ flex:1 }}>
                            <span style={{ fontWeight:600 }}>{seat.name}</span>
                            <span style={{ color:"#9CA3AF", fontSize:12, marginLeft:6 }}>{seat.state}</span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:12 }}>
                            <PartyBadge party={seat.winner.party} />
                            <span style={{ color:"#9CA3AF" }}>→</span>
                            <PartyBadge party={seat.modelled.winnerParty} />
                          </div>
                          {alp2pp !== null && (
                            <span style={{ fontSize:12, color:"#6B7280", minWidth:80, textAlign:"right" }}>
                              ALP 2PP {alp2pp.toFixed(1)}%
                            </span>
                          )}
                          {seat.modelled.isOverride && <span style={{ fontSize:10, background:"#FEF3C7", color:"#92400E", padding:"1px 5px", borderRadius:6, fontWeight:600 }}>override</span>}
                        </div>
                      );
                    };
                    return (
                      <div>
                        {alpGains.length > 0 && (
                          <div style={{ marginBottom:12 }}>
                            <div style={{ fontSize:12, fontWeight:700, color:"#059669", marginBottom:6 }}>🟢 ALP gains ({alpGains.length})</div>
                            {[...alpGains].sort((a,b)=>(a.modelled.projAlp2pp||50)-(b.modelled.projAlp2pp||50)).map(s=><SeatRow key={s.id} seat={s} direction="↑" />)}
                          </div>
                        )}
                        {alpLosses.length > 0 && (
                          <div style={{ marginBottom:12 }}>
                            <div style={{ fontSize:12, fontWeight:700, color:"#DC2626", marginBottom:6 }}>🔴 ALP losses ({alpLosses.length})</div>
                            {[...alpLosses].sort((a,b)=>(b.modelled.projAlp2pp||50)-(a.modelled.projAlp2pp||50)).map(s=><SeatRow key={s.id} seat={s} direction="↓" />)}
                          </div>
                        )}
                        {other.length > 0 && (
                          <div>
                            <div style={{ fontSize:12, fontWeight:700, color:"#6B7280", marginBottom:6 }}>⚪ Other changes ({other.length})</div>
                            {other.map(s=><SeatRow key={s.id} seat={s} direction="↔" />)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Seat-level primary vote overrides */}
              <div style={panelStyle}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontWeight:700, color:"#374151" }}>Seat-level primary overrides</span>
                  {Object.keys(seatOverrides).length > 0 && (
                    <>
                      <span style={{ fontSize:11, background:"#FEF3C7", color:"#92400E", padding:"1px 8px", borderRadius:10, fontWeight:600 }}>
                        {Object.keys(seatOverrides).length} active
                      </span>
                      <button onClick={() => setSeatOverrides({})}
                        style={{ marginLeft:"auto", fontSize:12, color:"#EF4444", background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:6, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>
                        Clear all
                      </button>
                    </>
                  )}
                </div>
                <p style={{ fontSize:12, color:"#6B7280", margin:"0 0 10px" }}>
                  Set custom primary vote %s for specific seats — useful for strong local candidates or known seat-level effects.
                </p>

                {/* Seat search + dropdown */}
                <div style={{ position:"relative", marginBottom:12 }}>
                  <input
                    value={overrideSearch}
                    onChange={e => setOverrideSearch(e.target.value)}
                    placeholder="+ Search for a seat to add…"
                    style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:7, padding:"7px 10px", fontSize:13, boxSizing:"border-box", outline:"none" }}
                  />
                  {overrideSearch.length > 0 && (() => {
                    const matches = SEATS.filter(s =>
                      s.name.toLowerCase().includes(overrideSearch.toLowerCase()) && !seatOverrides[s.id]
                    ).slice(0, 8);
                    return matches.length > 0 ? (
                      <div style={{ position:"absolute", top:"calc(100% + 2px)", left:0, right:0, background:"#fff", border:"1px solid #E5E7EB", borderRadius:7, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:100, overflow:"hidden" }}>
                        {matches.map((s, i) => (
                          <div key={s.id}
                            onMouseDown={() => addSeatOverride(s.id)}
                            style={{ padding:"8px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, borderBottom: i < matches.length-1 ? "1px solid #F3F4F6" : "none" }}>
                            <span style={{ fontWeight:600, flex:1, fontSize:13 }}>{s.name}</span>
                            <span style={{ fontSize:12, color:"#9CA3AF" }}>{s.state}</span>
                            <PartyBadge party={s.winner.party} />
                            <span style={{ fontSize:12, color:"#6B7280" }}>{s.margin.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* Overridden seat cards */}
                {Object.keys(seatOverrides).length === 0 ? (
                  <div style={{ textAlign:"center", padding:"16px 0", color:"#9CA3AF", fontSize:12 }}>
                    No seat overrides active. Search for a seat above to add one.
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {Object.entries(seatOverrides).map(([idStr, ov]) => {
                      const seat = SEATS.find(s => s.id === +idStr);
                      if (!seat) return null;
                      const ms = modelledSeats.find(s => s.id === +idStr);
                      const proj2pp = ms?.modelled.projAlp2pp;
                      return (
                        <div key={idStr} style={{ border:"1px solid #D1D5DB", borderRadius:8, padding:"12px 14px", background:"#FAFAFA" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                            <PartyBadge party={seat.winner.party} />
                            <span style={{ fontWeight:700, fontSize:13, flex:1 }}>{seat.name}</span>
                            <span style={{ fontSize:12, color:"#9CA3AF" }}>{seat.state} · 2022 margin {seat.margin.toFixed(1)}%</span>
                            {proj2pp !== null && (
                              <span style={{ fontSize:12, fontWeight:700, color: proj2pp>=50?"#059669":"#1D4ED8" }}>
                                ALP 2PP {proj2pp.toFixed(1)}%
                              </span>
                            )}
                            <button onClick={() => clearOverride(+idStr)}
                              style={{ fontSize:13, color:"#9CA3AF", background:"none", border:"none", cursor:"pointer", padding:"2px 4px", lineHeight:1 }}>✕</button>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
                            {[["ALP","alp","#DC2626"],["Coal","coal","#1D4ED8"],["Grn","grn","#059669"],["Ind","teal","#0891B2"],["ON","on","#B45309"]].map(([label, key, color]) => (
                              <div key={key} style={{ textAlign:"center" }}>
                                <div style={{ fontSize:10, fontWeight:800, color, marginBottom:3, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
                                <input
                                  type="number" min={0} max={100} step={0.5}
                                  value={ov[key] !== null && ov[key] !== undefined ? ov[key] : ""}
                                  onChange={e => updateSeatOverride(+idStr, key, e.target.value)}
                                  style={{ width:"100%", border:"1px solid #D1D5DB", borderRadius:5, padding:"5px 4px", fontSize:12, textAlign:"center", boxSizing:"border-box", outline:"none" }}
                                />
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize:11, color:"#9CA3AF", marginTop:8 }}>
                            National: ALP {primaries.alp}% · Coal {primaries.coal}% · Grn {primaries.grn}% · Ind {primaries.teal}% · ON {primaries.on}%
                          </div>

                          {/* TCP / Margin override */}
                          {(() => {
                            const tcpP = seat.tcp.map(t => t.party);
                            const isAlpCoal = tcpP.includes("ALP") && tcpP.some(p => ["LP","LNP","NP","CLP"].includes(p));
                            const isGrnCoal = tcpP.includes("GRN") && tcpP.some(p => ["LP","LNP","NP","CLP"].includes(p));
                            const isGrnAlp  = tcpP.includes("GRN") && tcpP.includes("ALP");
                            const isTeal    = tcpP.some(p => ["IND","CA"].includes(p));
                            // tcpPct = seat.tcp[0].party's TCP% (2022 winner's TCP)
                            const tcp0 = seat.tcp[0];
                            const tcp1 = seat.tcp[1];
                            const tcpLabel = isAlpCoal ? "ALP 2PP %" : isGrnCoal ? "Greens TCP %" : isGrnAlp ? "ALP TCP %" : "Ind. TCP %";
                            const winLabel = isAlpCoal ? "ALP" : isGrnCoal ? "Greens" : isGrnAlp ? "Labor" : "Independent";
                            const loseLabel = isAlpCoal ? "Coalition" : isGrnCoal ? "Coalition" : isGrnAlp ? "Greens" : (tcpP.some(p => ["LP","LNP","NP","CLP"].includes(p)) ? "Coalition" : "Labor");
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
                              <div style={{ borderTop:"1px solid #E5E7EB", marginTop:10, paddingTop:10 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                                  <span style={{ fontSize:11, fontWeight:700, color:"#374151", flex:1 }}>Margin / TCP override</span>
                                  <span style={{ fontSize:11, color:"#9CA3AF" }}>
                                    2022: {getParty(tcp0.party).short} {tcp0.pct.toFixed(1)}% vs {getParty(tcp1.party).short} {tcp1.pct.toFixed(1)}%
                                  </span>
                                </div>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <label style={{ fontSize:12, fontWeight:600, color:"#374151", whiteSpace:"nowrap" }}>{tcpLabel}</label>
                                  <input
                                    type="number" min={0} max={100} step={0.1}
                                    value={ovTcpSet ? ovTcp : ""}
                                    placeholder={projTcpPct?.toFixed(1) ?? "—"}
                                    onChange={e => updateSeatOverride(+idStr, "tcpPct", e.target.value)}
                                    style={{ width:72, border: ovTcpSet ? "1px solid #6366F1" : "1px solid #D1D5DB", borderRadius:5, padding:"5px 6px", fontSize:12, textAlign:"center", outline:"none", background: ovTcpSet ? "#EEF2FF" : "#fff" }}
                                  />
                                  <span style={{ fontSize:12, color:"#6B7280" }}>%</span>
                                  {displayTcp !== null && (
                                    <span style={{ fontSize:12, fontWeight:600, color: tcpWins ? "#059669" : "#1D4ED8" }}>
                                      {tcpWins ? winLabel : loseLabel} +{margin2pp}pp
                                    </span>
                                  )}
                                  {ovTcpSet && (
                                    <button
                                      onClick={() => updateSeatOverride(+idStr, "tcpPct", "")}
                                      style={{ marginLeft:"auto", fontSize:11, color:"#9CA3AF", background:"none", border:"none", cursor:"pointer", padding:"2px 4px", lineHeight:1 }}
                                      title="Clear TCP override">✕</button>
                                  )}
                                </div>
                                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:4 }}>
                                  {`>50% → ${winLabel} wins · <50% → ${loseLabel} wins`}
                                  {projTcpPct !== null && !ovTcpSet && (
                                    <span> · Modelled: {projTcpPct.toFixed(1)}%</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* TCP Matchup override */}
                          <div style={{ borderTop:"1px solid #E5E7EB", marginTop:10, paddingTop:10 }}>
                            <div style={{ fontSize:11, fontWeight:700, color:"#374151", marginBottom:6 }}>TCP Matchup</div>
                            <div style={{ display:"flex", gap:5 }}>
                              {[["auto","Auto"],["on_v_alp","ON vs ALP"],["on_v_coal","ON vs Coal"]].map(([val, label]) => {
                                const active = (ov.tcpMatchup ?? "auto") === val;
                                return (
                                  <button key={val}
                                    onClick={() => updateSeatOverride(+idStr, "tcpMatchup", val === "auto" ? null : val)}
                                    style={{ padding:"3px 9px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background: active?"#B45309":"#fff", color: active?"#fff":"#B45309", border:"1px solid #B45309" }}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                            {ov.tcpMatchup && (
                              <div style={{ fontSize:10, color:"#9CA3AF", marginTop:4 }}>
                                {ov.tcpMatchup === "on_v_alp" ? "Uses Coal→ALP (ON race) preference flow." : "Uses ALP→ON (vs Coal) preference flow."}
                              </div>
                            )}
                          </div>

                          {/* Force projected winner */}
                          <div style={{ borderTop:"1px solid #E5E7EB", marginTop:10, paddingTop:10 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:"#374151", flex:1 }}>Force projected winner</span>
                              {ov.forceGroup && (
                                <button onClick={() => updateSeatOverride(+idStr, "forceGroup", "")}
                                  style={{ fontSize:11, color:"#9CA3AF", background:"none", border:"none", cursor:"pointer", padding:"2px 4px", lineHeight:1 }}>
                                  Clear
                                </button>
                              )}
                            </div>
                            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                              {GROUP_ORDER.map(g => (
                                <button key={g}
                                  onClick={() => updateSeatOverride(+idStr, "forceGroup", ov.forceGroup === g ? "" : g)}
                                  style={{
                                    padding:"3px 10px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer",
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
          {el.modelEnabled && selectedModelId === "vic_2022" && <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:16, alignItems:"start" }}>

            {/* ── VIC Controls panel ── */}
            <div>
              <div style={panelStyle}>
                <div style={sectionHead}>Primary vote %</div>
                <PrimaryInput label="ALP"          value={vicPrimaries.alp} onChange={v=>setVicPrimaries(p=>({...p,alp:v}))} color="#DC2626" baseline={VIC_BASELINE_2022.alp} />
                <PrimaryInput label="Liberal"       value={vicPrimaries.lp}  onChange={v=>setVicPrimaries(p=>({...p,lp:v}))}  color="#1D4ED8" baseline={VIC_BASELINE_2022.lp}  />
                <PrimaryInput label="Nationals"     value={vicPrimaries.np}  onChange={v=>setVicPrimaries(p=>({...p,np:v}))}  color="#065F46" baseline={VIC_BASELINE_2022.np}  />
                <PrimaryInput label="Greens"        value={vicPrimaries.grn} onChange={v=>setVicPrimaries(p=>({...p,grn:v}))} color="#059669" baseline={VIC_BASELINE_2022.grn} />
                <PrimaryInput label="Independents"  value={vicPrimaries.ind} onChange={v=>setVicPrimaries(p=>({...p,ind:v}))} color="#0891B2" baseline={VIC_BASELINE_2022.ind} />
                {(() => {
                  const entered = +(vicPrimaries.alp + vicPrimaries.lp + vicPrimaries.np + vicPrimaries.grn + vicPrimaries.ind).toFixed(1);
                  const other   = +(100 - entered).toFixed(1);
                  const overLimit = entered > 100;
                  return (
                    <div style={{ borderTop:"1px solid #F3F4F6", paddingTop:10, marginTop:4, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:"#6B7280" }}>Other / minor parties</span>
                      <span style={{ fontSize:13, fontWeight:700, color: overLimit ? "#DC2626" : "#374151" }}>
                        {overLimit ? `−${Math.abs(other).toFixed(1)}% ⚠` : `${other}%`}
                      </span>
                    </div>
                  );
                })()}
                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:6 }}>
                  2022 result: ALP {VIC_BASELINE_2022.alp}% · Lib {VIC_BASELINE_2022.lp}% · Nat {VIC_BASELINE_2022.np}% · Grn {VIC_BASELINE_2022.grn}% · Ind {VIC_BASELINE_2022.ind}%
                </div>
              </div>

              <div style={panelStyle}>
                <div style={sectionHead}>Preference flows to ALP</div>
                <PrefInput label="Greens → ALP"       value={vicPrefFlows.grn_alp}   onChange={v=>setVicPrefFlows(f=>({...f,grn_alp:v}))}   color="#059669" />
                <PrefInput label="Independents → ALP"  value={vicPrefFlows.ind_alp}  onChange={v=>setVicPrefFlows(f=>({...f,ind_alp:v}))}   color="#0891B2" />
                <PrefInput label="Other → ALP"         value={vicPrefFlows.other_alp} onChange={v=>setVicPrefFlows(f=>({...f,other_alp:v}))} color="#7C3AED" />
                <div style={{ fontSize:11, color:"#9CA3AF", borderTop:"1px solid #F3F4F6", paddingTop:8, marginTop:4 }}>
                  Defaults based on 2022 VIC preference distributions. Remainder flows to Liberal/Nationals.
                </div>
              </div>

              {vicHasChanges && (
                <button onClick={() => { setVicPrimaries({ alp:38.1, lp:25.3, np:5.8, grn:12.2, ind:5.5 }); setVicPrefFlows({ grn_alp:0.85, ind_alp:0.60, other_alp:0.43 }); }}
                  style={{ width:"100%", padding:"8px", background:"#FEF2F2", color:"#DC2626", border:"1px solid #FECACA", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600, marginBottom:16 }}>
                  Reset VIC model
                </button>
              )}
            </div>

            {/* ── VIC Results panel ── */}
            <div>
              {/* Summary stat cards */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Implied 2PP (ALP)</div>
                  {vicImplied2pp !== null ? (
                    <>
                      <div style={{ fontSize:30, fontWeight:800, color: vicImplied2pp>=50?"#059669":"#DC2626" }}>{vicImplied2pp.toFixed(1)}%</div>
                      <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>
                        {vicImplied2pp>=50 ? `▲ +${(vicImplied2pp-VIC_2PP_2022).toFixed(1)} vs 2022` : `▼ ${(vicImplied2pp-VIC_2PP_2022).toFixed(1)} vs 2022`}
                      </div>
                    </>
                  ) : <div style={{ fontSize:20, color:"#9CA3AF" }}>—</div>}
                </div>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Seats changing</div>
                  <div style={{ fontSize:30, fontWeight:800, color: vicChangedSeats.length>0?"#F59E0B":"#6B7280" }}>{vicChangedSeats.length}</div>
                  <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>of 88 modelled</div>
                </div>
                <div style={{ ...panelStyle, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Majority</div>
                  {(() => {
                    const alpProj = vicProjCounts.alp || 0;
                    const coalProj = (vicProjCounts.coalition || 0);
                    const projMaj = alpProj >= 45 ? "ALP majority" : coalProj >= 45 ? "Coalition majority" : "Hung parliament";
                    const majColor = alpProj >= 45 ? "#059669" : coalProj >= 45 ? "#1D4ED8" : "#F59E0B";
                    return (
                      <>
                        <div style={{ fontSize:16, fontWeight:800, color:majColor, marginTop:4 }}>{projMaj}</div>
                        <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>45 seats needed</div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Tally comparison */}
              <div style={panelStyle}>
                <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Seat composition</div>
                <div style={{ marginBottom:8 }}>
                  <div style={{ fontSize:12, color:"#6B7280", marginBottom:4 }}>2022 result</div>
                  <TallyBar seats={VIC_SEATS} />
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <div style={{ fontSize:12, color:"#6B7280" }}>Projected</div>
                    {vicHasChanges && <span style={{ fontSize:11, background:"#FEF3C7", color:"#92400E", padding:"1px 6px", borderRadius:10, fontWeight:600 }}>scenario active</span>}
                  </div>
                  <TallyBar seats={vicModelledSeats} useModelled={true} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:8, marginTop:8 }}>
                  {GROUP_ORDER.map(g => {
                    const base = vicBaseCounts[g] || 0;
                    const proj = vicProjCounts[g] || 0;
                    const delta = proj - base;
                    if (!base && !proj) return null;
                    return (
                      <div key={g} style={{ background:"#F9FAFB", borderRadius:8, border:"1px solid #E5E7EB", padding:"10px 12px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                          <span style={{ width:9, height:9, borderRadius:2, background:GROUP_CONFIG[g].color, display:"inline-block" }} />
                          <span style={{ fontSize:11, fontWeight:700, color:"#374151" }}>{GROUP_CONFIG[g].label}</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                          <span style={{ fontSize:22, fontWeight:800, color:"#111" }}>{proj}</span>
                          <span style={{ fontSize:12, color:"#6B7280" }}>/ {base} base</span>
                        </div>
                        {delta !== 0 && (
                          <div style={{ fontSize:12, fontWeight:700, color:delta>0?"#059669":"#DC2626", marginTop:2 }}>
                            {delta>0?"+":""}{delta} seats
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Seat-at-risk table */}
              <div style={panelStyle}>
                <div style={{ fontWeight:700, color:"#374151", marginBottom:12 }}>Seats at risk (tightest 25)</div>
                <div style={{ maxHeight:440, overflowY:"auto" }}>
                  {[...vicModelledSeats].sort((a,b) => a.margin - b.margin).slice(0,25).map(seat => {
                    const base = getParty(seat.winner.party);
                    const proj = getParty(seat.modelled.winnerParty);
                    const changed = seat.modelled.changed;
                    return (
                      <div key={seat.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid #F3F4F6", background: changed ? "#FFF7ED" : "transparent" }}>
                        <div style={{ width:3, height:28, background: changed ? proj.color : base.color, borderRadius:2, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                            {seat.name}
                            {changed && <span style={{ fontSize:10, background:"#FEF3C7", color:"#92400E", padding:"1px 5px", borderRadius:8, fontWeight:700 }}>CHANGES</span>}
                          </div>
                          <div style={{ fontSize:11, color:"#6B7280" }}>{seat.tcp[0].party} vs {seat.tcp[1].party}</div>
                        </div>
                        <PartyBadge party={seat.winner.party} />
                        {changed && <><span style={{ fontSize:11, color:"#6B7280" }}>→</span><PartyBadge party={seat.modelled.winnerParty} /></>}
                        <span style={{ fontWeight:700, fontSize:13, color:MARGIN_COLOR[getMarginCat(seat.margin)], minWidth:40, textAlign:"right" }}>
                          {seat.margin.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize:11, color:"#9CA3AF", marginTop:8, paddingTop:8, borderTop:"1px solid #F3F4F6" }}>
                  Uniform swing model · VEC 2022 official results · 88 Legislative Assembly districts
                </div>
              </div>
            </div>
          </div>}

          {selectedModelId === "federal_2022" && (
          <>{/* ── Demographics Overview (collapsible) ── */}
          <div style={{ marginTop:8 }}>
            <button onClick={() => setDemogSectionOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:8, width:"100%", background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:"14px 20px", cursor:"pointer", textAlign:"left", fontWeight:700, fontSize:14, color:"#374151" }}>
              <span style={{ fontSize:16 }}>{demogSectionOpen ? "▾" : "▸"}</span>
              Demographics Overview
              <span style={{ fontSize:12, fontWeight:400, color:"#9CA3AF", marginLeft:4 }}>— seat-level census data</span>
            </button>
            {demogSectionOpen && (
              <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderTopWidth:0, borderRadius:"0 0 12px 12px", padding:"20px" }}>

                {/* National summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { key:"medianPersonalIncome",  label:"Median Personal Income",  fmt:v=>`$${(v/1000).toFixed(0)}k/yr` },
                    { key:"medianHouseholdIncome", label:"Median Household Income",  fmt:v=>`$${(v/1000).toFixed(0)}k/yr` },
                    { key:"renterPct",             label:"Renters",                  fmt:v=>`${v.toFixed(1)}%` },
                    { key:"bachelorsOrAbovePct",   label:"Bachelor's+",              fmt:v=>`${v.toFixed(1)}%` },
                    { key:"overseasBornPct",       label:"Overseas Born",            fmt:v=>`${v.toFixed(1)}%` },
                    { key:"medianAge",             label:"Median Age",               fmt:v=>`${v}` },
                  ].map(({ key, label, fmt }) => {
                    const s = demogStats[key];
                    if (!s) return null;
                    return (
                      <div key={key} style={{ background:"#F9FAFB", border:"1px solid #E5E7EB", borderRadius:10, padding:"14px 16px" }}>
                        <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:6 }}>{label}</div>
                        <div style={{ fontSize:22, fontWeight:800, color:"#111", marginBottom:4 }}>{fmt(s.avg)}</div>
                        <div style={{ fontSize:11, color:"#9CA3AF" }}>Range: {fmt(s.min)} – {fmt(s.max)}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Filters row */}
                <div style={{ background:"#F9FAFB", border:"1px solid #E5E7EB", borderRadius:10, padding:"12px 16px", marginBottom:14, display:"flex", flexWrap:"wrap", gap:12, alignItems:"center" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#6B7280", textTransform:"uppercase" }}>Filter:</span>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {STATES.map(st => (
                      <button key={st} onClick={() => toggleSet(setDemogStateFilter, st)}
                        style={{ padding:"3px 10px", borderRadius:5, fontSize:12, fontWeight:600, cursor:"pointer",
                          background: demogStateFilter.has(st) ? "#374151" : "#F3F4F6",
                          color: demogStateFilter.has(st) ? "#fff" : "#6B7280",
                          border: "1px solid " + (demogStateFilter.has(st) ? "#374151" : "#E5E7EB") }}>
                        {st}
                      </button>
                    ))}
                  </div>
                  <span style={{ color:"#E5E7EB" }}>|</span>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {["Inner Metropolitan","Outer Metropolitan","Provincial","Rural"].map(cls => (
                      <button key={cls} onClick={() => toggleSet(setDemogClassFilter, cls)}
                        style={{ padding:"3px 10px", borderRadius:5, fontSize:12, fontWeight:600, cursor:"pointer",
                          background: demogClassFilter.has(cls) ? "#1D4ED8" : "#F3F4F6",
                          color: demogClassFilter.has(cls) ? "#fff" : "#6B7280",
                          border: "1px solid " + (demogClassFilter.has(cls) ? "#1D4ED8" : "#E5E7EB") }}>
                        {cls}
                      </button>
                    ))}
                  </div>
                  <span style={{ marginLeft:"auto", fontSize:12, color:"#9CA3AF" }}>{demogFiltered.length} seats</span>
                </div>

                {/* Demographic table */}
                <div style={{ border:"1px solid #E5E7EB", borderRadius:10, marginBottom:20, overflow:"hidden" }}>
                  <div style={{ overflowX:"auto", maxHeight:520, overflowY:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                      <thead style={{ position:"sticky", top:0, zIndex:2 }}>
                        <tr>
                          {[
                            { k:"name",                label:"Seat" },
                            { k:"state",               label:"State" },
                            { k:"winner",              label:"2022 Winner" },
                            { k:"urbanClass",          label:"Urban Class" },
                            { k:"medianHouseholdIncome",label:"HH Income" },
                            { k:"medianPersonalIncome", label:"Personal Inc." },
                            { k:"medianWeeklyRent",     label:"Wkly Rent" },
                            { k:"renterPct",            label:"Renters %" },
                            { k:"ownerMortgagePct",     label:"Mortgage %" },
                            { k:"bachelorsOrAbovePct",  label:"Bach.+ %" },
                            { k:"overseasBornPct",      label:"O/seas Born" },
                            { k:"medianAge",            label:"Med. Age" },
                          ].map(({ k, label }) => (
                            <th key={k} onClick={() => {
                              if (demogSortKey === k) {
                                setDemogSortDir(d => d === "asc" ? "desc" : "asc");
                              } else {
                                setDemogSortKey(k);
                                setDemogSortDir("desc");
                              }
                            }} style={{ padding:"10px 10px", textAlign:"left", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", borderBottom:"1px solid #E5E7EB" }}>
                              {label}{" "}
                              <span style={{ color: demogSortKey===k?"#374151":"#D1D5DB" }}>
                                {demogSortKey===k ? (demogSortDir==="asc"?"↑":"↓") : "↕"}
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
                                style={{ borderBottom:"1px solid #F3F4F6", cursor:"pointer",
                                  borderLeft: `3px solid ${pg.color}`,
                                  background: isExpanded ? "#F9FAFB" : undefined,
                                  transition:"background 0.1s" }}
                                onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background="#F9FAFB"; }}
                                onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background=""; }}>
                                <td style={{ padding:"8px 10px", fontWeight:600, color:"#111" }}>{isExpanded ? "▾ " : "▸ "}{s.name}</td>
                                <td style={{ padding:"8px 10px", color:"#6B7280" }}>{s.state}</td>
                                <td style={{ padding:"8px 10px" }}>
                                  <span style={{ background:pg.bg, color:pg.color, fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:4 }}>{pg.short}</span>
                                </td>
                                <td style={{ padding:"8px 10px", color:"#6B7280", fontSize:11 }}>{d.urbanClass ?? "—"}</td>
                                <td style={{ padding:"8px 10px", fontWeight:600 }}>{d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome/1000).toFixed(0)}k` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.medianPersonalIncome ? `$${(d.medianPersonalIncome/1000).toFixed(0)}k` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.medianWeeklyRent ? `$${d.medianWeeklyRent}` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.renterPct != null ? `${d.renterPct}%` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.bachelorsOrAbovePct != null ? `${d.bachelorsOrAbovePct}%` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.overseasBornPct != null ? `${d.overseasBornPct}%` : "—"}</td>
                                <td style={{ padding:"8px 10px" }}>{d.medianAge ?? "—"}</td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${s.id}-exp`}>
                                  <td colSpan={12} style={{ background:"#F9FAFB", padding:"16px 20px", borderBottom:"2px solid #E5E7EB" }}>
                                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:8 }}>Income</div>
                                        <div style={{ fontSize:12, lineHeight:1.8 }}>
                                          <div><strong>Personal:</strong> {d.medianPersonalIncome ? `$${(d.medianPersonalIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                          <div><strong>Household:</strong> {d.medianHouseholdIncome ? `$${(d.medianHouseholdIncome/1000).toFixed(1)}k/yr` : "—"}</div>
                                          <div><strong>ATO Taxable Income:</strong> {d.avgTaxableIncome ? `$${(d.avgTaxableIncome/1000).toFixed(0)}k` : <span style={{color:"#9CA3AF"}}>n/a</span>}</div>
                                          <div><strong>Investment Property:</strong> {d.investPropertyPct != null ? `${d.investPropertyPct}%` : <span style={{color:"#9CA3AF"}}>n/a</span>}</div>
                                        </div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:8 }}>Housing</div>
                                        <div style={{ fontSize:12, lineHeight:1.8 }}>
                                          <div><strong>Owner outright:</strong> {d.ownerOutrightPct != null ? `${d.ownerOutrightPct}%` : "—"}</div>
                                          <div><strong>Owner w/ mortgage:</strong> {d.ownerMortgagePct != null ? `${d.ownerMortgagePct}%` : "—"}</div>
                                          <div><strong>Renters:</strong> {d.renterPct != null ? `${d.renterPct}%` : "—"}</div>
                                          <div><strong>Weekly rent:</strong> {d.medianWeeklyRent ? `$${d.medianWeeklyRent}/wk` : "—"}</div>
                                          <div><strong>Monthly mortgage:</strong> {d.medianMonthlyMortgage ? `$${d.medianMonthlyMortgage}/mo` : "—"}</div>
                                        </div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF", marginBottom:8 }}>People</div>
                                        <div style={{ fontSize:12, lineHeight:1.8 }}>
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
                <div style={{ border:"1px solid #E5E7EB", borderRadius:10, padding:"18px 20px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", color:"#9CA3AF" }}>Correlation Explorer</div>
                    <select value={demogXMetric} onChange={e => setDemogXMetric(e.target.value)}
                      style={{ border:"1px solid #D1D5DB", borderRadius:6, padding:"4px 8px", fontSize:12, fontWeight:600, outline:"none" }}>
                      {DEMOG_METRICS.map(({ key, label }) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <span style={{ fontSize:12, color:"#9CA3AF" }}>vs Modelled 2PP Margin (ALP above/below 50%)</span>
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <ScatterChart margin={{ top:10, right:20, bottom:20, left:10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="x" name="X" type="number" domain={["auto","auto"]}
                        tickFormatter={v => {
                          const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                          return m ? m.fmt(v) : v;
                        }}
                        tick={{ fontSize:11 }} />
                      <YAxis dataKey="y" name="Margin" tickFormatter={v => `${v>0?"+":""}${v.toFixed(1)}`}
                        tick={{ fontSize:11 }} />
                      <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 2" label={{ value:"50%", position:"right", fontSize:10, fill:"#6B7280" }} />
                      <Tooltip cursor={{ strokeDasharray:"3 3" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload;
                          const m = DEMOG_METRICS.find(m => m.key === demogXMetric);
                          const grpCfg = GROUP_CONFIG[p.group] ?? { color:"#6B7280", label:p.group };
                          return (
                            <div style={{ background:"#fff", border:`1px solid ${grpCfg.color}`, borderRadius:8, padding:"8px 12px", fontSize:12, boxShadow:"0 2px 8px rgba(0,0,0,0.1)" }}>
                              <div style={{ fontWeight:700, marginBottom:4 }}>{p.name} ({p.state})</div>
                              <div style={{ color:"#6B7280" }}>{m?.label}: <strong>{m ? m.fmt(p.x) : p.x}</strong></div>
                              <div style={{ color:"#6B7280" }}>2PP margin: <strong>{p.y > 0 ? "+" : ""}{p.y.toFixed(1)}pp</strong></div>
                              <div style={{ color: grpCfg.color, fontWeight:600, marginTop:2 }}>{grpCfg.label}</div>
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
                  <div style={{ display:"flex", gap:14, justifyContent:"center", flexWrap:"wrap", marginTop:8 }}>
                    {GROUP_ORDER.map(grp => {
                      const pts = scatterData.filter(p => p.group === grp);
                      if (!pts.length) return null;
                      return (
                        <span key={grp} style={{ fontSize:11, color:"#374151", display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ width:10, height:10, borderRadius:"50%", background:GROUP_CONFIG[grp]?.color, display:"inline-block" }} />
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
        <div style={{ padding:"20px 24px", maxWidth:960, margin:"0 auto" }}>
          <h1 style={{ fontSize:22, fontWeight:800, marginBottom:2 }}>2022 Victorian State Election</h1>
          <p style={{ color:"#6B7280", marginBottom:18 }}>
            {VIC_2022_SUMMARY.date} · Legislative Assembly · {VIC_2022_SUMMARY.total} seats
            &nbsp;·&nbsp; Premier: {VIC_2022_SUMMARY.premier}
          </p>

          {/* Summary bar */}
          <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:"14px 18px", marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:600, color:"#6B7280", marginBottom:8 }}>
              2022 result — {VIC_2022_SUMMARY.total} seats
            </div>
            <div style={{ display:"flex", height:26, borderRadius:6, overflow:"hidden", gap:2 }}>
              {[
                { label:"Labor",    count:VIC_2022_SUMMARY.alp,  color:"#DC2626" },
                { label:"Liberal",  count:VIC_2022_SUMMARY.lp,   color:"#1D4ED8" },
                { label:"Greens",   count:VIC_2022_SUMMARY.grn,  color:"#059669" },
                { label:"IND",      count:VIC_2022_SUMMARY.ind,  color:"#0891B2" },
              ].map(g => (
                <div key={g.label} style={{ flex:g.count, background:g.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700 }}>
                  {g.count >= 4 ? g.count : ""}
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 16px", marginTop:8 }}>
              {[
                { label:"Labor",   count:VIC_2022_SUMMARY.alp,  color:"#DC2626" },
                { label:"Liberal", count:VIC_2022_SUMMARY.lp,   color:"#1D4ED8" },
                { label:"Greens",  count:VIC_2022_SUMMARY.grn,  color:"#059669" },
                { label:"IND",     count:VIC_2022_SUMMARY.ind,  color:"#0891B2" },
              ].map(g => (
                <span key={g.label} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"#374151" }}>
                  <span style={{ width:9, height:9, borderRadius:2, background:g.color, display:"inline-block" }} />
                  {g.label} <strong>{g.count}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Stat cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:18 }}>
            {[
              { label:"Labor majority",   value:`+${VIC_2022_SUMMARY.alp - 45}`, color:"#DC2626", note:"over majority" },
              { label:"Liberal seats",    value:VIC_2022_SUMMARY.lp,             color:"#1D4ED8", note:"vs 27 in 2018" },
              { label:"Greens seats",     value:VIC_2022_SUMMARY.grn,            color:"#059669", note:"lower house" },
              { label:"Independent seats",value:VIC_2022_SUMMARY.ind,            color:"#0891B2", note:"2 crossbench" },
              { label:"Next election",    value:"Nov 2026",                       color:"#7C3AED", note:"due ~29 Nov" },
            ].map(card => (
              <div key={card.label} style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"14px 16px" }}>
                <div style={{ width:24, height:3, background:card.color, borderRadius:2, marginBottom:8 }} />
                <div style={{ fontSize:22, fontWeight:800, color:"#111" }}>{card.value}</div>
                <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>{card.label}</div>
                <div style={{ fontSize:10, color:"#9CA3AF", marginTop:1 }}>{card.note}</div>
              </div>
            ))}
          </div>

          {/* Pipeline call-to-action */}
          <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:10, padding:"14px 18px", marginBottom:18 }}>
            <div style={{ fontWeight:700, color:"#1D4ED8", marginBottom:6, fontSize:14 }}>
              Load full 88-seat data
            </div>
            <p style={{ fontSize:13, color:"#374151", margin:"0 0 8px" }}>
              The VEC pipeline downloads district-level first preference and two-candidate preferred
              results from <strong>vec.vic.gov.au</strong> for all 88 Legislative Assembly seats.
            </p>
            <code style={{ display:"block", background:"#1E293B", color:"#93C5FD", padding:"8px 12px", borderRadius:6, fontSize:12, fontFamily:"monospace" }}>
              python main.py --state vic --year 202211
            </code>
            <p style={{ fontSize:12, color:"#6B7280", marginTop:8, marginBottom:0 }}>
              For booth-level data, place The Tally Room CSVs (2022 is free at tallyroom.com.au)
              in <code>data/raw/vic/202211/</code> before running.
            </p>
          </div>

          {/* Key seats table */}
          <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:"18px 20px" }}>
            <div style={{ fontWeight:700, marginBottom:2, color:"#374151" }}>
              Key seats — 2022 confirmed results
            </div>
            <p style={{ fontSize:12, color:"#9CA3AF", marginBottom:14 }}>
              Non-ALP/Liberal seats plus selected marginals. Margins are 2CP % margin.
            </p>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #E5E7EB" }}>
                  {["District","Winner","Party","2CP Matchup","Margin"].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VIC_SEATS_KNOWN.map(([id, name, party, winner, tcp1, tcp2, margin]) => {
                  const p = getParty(party);
                  const marginCat = margin < 2 ? "very_marginal" : margin < 5 ? "marginal" : margin < 10 ? "fairly_safe" : "safe";
                  return (
                    <tr key={id} style={{ borderBottom:"1px solid #F3F4F6" }}>
                      <td style={{ padding:"8px 10px", fontWeight:600, fontSize:13 }}>{name}</td>
                      <td style={{ padding:"8px 10px", fontSize:12, color:"#374151" }}>{winner}</td>
                      <td style={{ padding:"8px 10px" }}>
                        <span style={{ background:p.color, color:"#fff", fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:4 }}>{p.short}</span>
                      </td>
                      <td style={{ padding:"8px 10px", fontSize:12, color:"#6B7280" }}>
                        {getParty(tcp1).short} v {getParty(tcp2).short}
                      </td>
                      <td style={{ padding:"8px 10px" }}>
                        <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
                          <span style={{ width:8, height:8, borderRadius:"50%", background:MARGIN_COLOR[marginCat], display:"inline-block" }} />
                          <span style={{ fontWeight:600, color:"#111", fontSize:13 }}>{margin.toFixed(1)}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize:11, color:"#9CA3AF", marginTop:12, marginBottom:0 }}>
              Note: Some winner names and margins shown here are approximate pending full VEC data pipeline run.
              Independent seat margins are 2CP vs nearest rival.
            </p>
          </div>

          {/* Data source note */}
          <div style={{ background:"#F9FAFB", border:"1px solid #E5E7EB", borderRadius:10, padding:"12px 16px", marginTop:14 }}>
            <div style={{ fontSize:12, color:"#6B7280" }}>
              <strong>Data sources:</strong>{" "}
              <a href="https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results"
                 target="_blank" rel="noreferrer" style={{ color:"#1D4ED8" }}>
                VEC 2022 State Election Results
              </a>
              {" · "}
              <a href="https://www.tallyroom.com.au/archive/vic2022" target="_blank" rel="noreferrer" style={{ color:"#1D4ED8" }}>
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
