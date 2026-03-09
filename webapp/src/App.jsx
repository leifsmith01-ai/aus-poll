// ── AEC Election Dashboard — Self-contained preview ──────────────────────────
// Tabs: Overview · Seats · Polls · Model
// All data, config and logic inlined — no external local imports.

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";

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
function computeModelledSeats(seats, swings, prefFlows, overrides, nat2ppSwing) {
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

    const tcpP = seat.tcp.map(t => t.party);
    const hasAlp  = tcpP.includes("ALP");
    const hasCoal = tcpP.some(p => ["LP","LNP","NP","CLP"].includes(p));
    const hasGrn  = tcpP.includes("GRN");
    const hasTeal = tcpP.some(p => ["IND","CA"].includes(p));

    // tcpPct override: represents the 2022 winner's TCP% (seat.tcp[0].party).
    // >50 means the 2022 winner holds; <50 means the challenger wins.
    const hasTcpOverride = override?.tcpPct !== null && override?.tcpPct !== undefined;

    let projWinnerParty, projWinnerGroup, projWinnerPct, projAlp2pp = null;

    if (hasAlp && hasCoal) {
      const isAlpWinner = seat.tcp[0].party === "ALP";
      const baseAlp2pp  = isAlpWinner ? seat.tcp[0].pct : seat.tcp[1].pct;

      if (hasTcpOverride) {
        // For ALP/Coal seats, tcpPct is ALP 2PP% directly (>50 = ALP wins)
        projAlp2pp = override.tcpPct;
      } else if (override) {
        // Compute 2PP from override first preferences via preference flows
        const a2 = newFp.alp + newFp.grn*prefFlows.grn_alp + newFp.teal*prefFlows.teal_alp + newFp.on*prefFlows.on_alp + newFp.other*prefFlows.other_alp;
        const c2 = newFp.coal + newFp.grn*(1-prefFlows.grn_alp) + newFp.teal*(1-prefFlows.teal_alp) + newFp.on*(1-prefFlows.on_alp) + newFp.other*(1-prefFlows.other_alp);
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

  // ── Polls tab state ──
  const [polls,       setPolls]       = useState(INITIAL_POLLS);
  const [showAddPoll, setShowAddPoll] = useState(false);
  const [nextPollId,  setNextPollId]  = useState(INITIAL_POLLS.length + 1);
  const [newPoll,     setNewPoll]     = useState({ pollster:"", date:"", alp:"", coal:"", grn:"", oth:"", tpp:"" });

  // ── Model tab state ──
  const [primaries,      setPrimaries]      = useState({ alp:BASELINE_2022.alp, coal:BASELINE_2022.coal, grn:BASELINE_2022.grn, teal:BASELINE_2022.teal, on:BASELINE_2022.on });
  const [prefFlows,      setPrefFlows]      = useState({ grn_alp:0.81, teal_alp:0.62, on_alp:0.43, other_alp:0.50 });
  // Derive swings from primaries vs 2022 baseline — used by computeModelledSeats
  const swings = {
    alp:  +(primaries.alp  - BASELINE_2022.alp ).toFixed(2),
    coal: +(primaries.coal - BASELINE_2022.coal).toFixed(2),
    grn:  +(primaries.grn  - BASELINE_2022.grn ).toFixed(2),
    teal: +(primaries.teal - BASELINE_2022.teal).toFixed(2),
    on:   +(primaries.on   - BASELINE_2022.on  ).toFixed(2),
  };
  const [seatOverrides,  setSeatOverrides]  = useState({});  // {seatId: {alp,coal,grn,teal,on}}
  const [overrideSearch, setOverrideSearch] = useState("");

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
    computeModelledSeats(SEATS, swings, prefFlows, seatOverrides, nat2ppSwing),
    [swings, prefFlows, seatOverrides, nat2ppSwing]);

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

  const implied2pp = useMemo(() => {
    const relevant = modelledSeats.filter(s => s.modelled.projAlp2pp !== null);
    if (!relevant.length) return null;
    return relevant.reduce((sum, s) => sum + s.modelled.projAlp2pp, 0) / relevant.length;
  }, [modelledSeats]);

  const hasChanges =
    primaries.alp !== BASELINE_2022.alp || primaries.coal !== BASELINE_2022.coal ||
    primaries.grn !== BASELINE_2022.grn || primaries.teal !== BASELINE_2022.teal || primaries.on !== BASELINE_2022.on ||
    prefFlows.grn_alp !== 0.81 || prefFlows.teal_alp !== 0.62 || prefFlows.on_alp !== 0.43 || prefFlows.other_alp !== 0.50 ||
    Object.keys(seatOverrides).length > 0;

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
    setPrefFlows({ grn_alp:0.81, teal_alp:0.62, on_alp:0.43, other_alp:0.50 });
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
    const val = rawVal === "" ? null : parseFloat(rawVal);
    setSeatOverrides(prev => ({ ...prev, [seatId]: { ...prev[seatId], [key]: isNaN(val) ? null : val } }));
  };

  const clearOverride = (seatId) => {
    setSeatOverrides(prev => { const n={...prev}; delete n[seatId]; return n; });
  };

  const SortTh = ({ k, children }) => (
    <th onClick={() => handleSort(k)} style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#6B7280", background:"#F9FAFB", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap" }}>
      {children}{" "}<span style={{ color: sortKey===k?"#374151":"#D1D5DB" }}>{sortKey===k?(sortDir==="asc"?"↑":"↓"):"↕"}</span>
    </th>
  );

  const tabs = [
    { id:"overview", label:"Overview" },
    { id:"seats",    label:"Seats" },
    { id:"polls",    label:"Polls" },
    { id:"model",    label:`Model${hasChanges?" ●":""}` },
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
        <span style={{ marginLeft:"auto", color:"#6B7280", fontSize:12 }}>2022 Federal Election · sample data</span>
      </div>

      {/* ══════════════════════ OVERVIEW TAB ══════════════════════════════════ */}
      {activeTab === "overview" && (
        <div style={{ padding:"20px 24px", maxWidth:900, margin:"0 auto" }}>
          <h1 style={{ fontSize:22, fontWeight:800, marginBottom:2 }}>2022 Federal Election</h1>
          <p style={{ color:"#6B7280", marginBottom:18 }}>21 May 2022 · House of Representatives · {SEATS.length} seats (sample)</p>
          <TallyBar seats={SEATS} />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:18 }}>
            {[
              { label:"Labor seats",     value:SEATS.filter(s=>getParty(s.winner.party).group==="alp").length,       color:"#DC2626" },
              { label:"Coalition seats", value:SEATS.filter(s=>getParty(s.winner.party).group==="coalition").length, color:"#1D4ED8" },
              { label:"Crossbench",      value:SEATS.filter(s=>!["alp","coalition"].includes(getParty(s.winner.party).group)).length, color:"#059669" },
              { label:"Marginal (<5%)",  value:SEATS.filter(s=>s.margin<5).length,                                  color:"#F59E0B" },
              { label:"Very marginal",   value:SEATS.filter(s=>s.margin<2).length,                                  color:"#EF4444" },
            ].map(card => (
              <div key={card.label} style={{ background:"#fff", borderRadius:10, border:"1px solid #E5E7EB", padding:"14px 16px" }}>
                <div style={{ width:24, height:3, background:card.color, borderRadius:2, marginBottom:8 }} />
                <div style={{ fontSize:26, fontWeight:800, color:"#111" }}>{card.value}</div>
                <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>{card.label}</div>
              </div>
            ))}
          </div>
          <div style={panelStyle}>
            <div style={{ fontWeight:700, marginBottom:12, color:"#374151" }}>10 tightest seats</div>
            {[...SEATS].sort((a,b)=>a.margin-b.margin).slice(0,10).map(s => {
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
          </div>
        </div>
      )}

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
                      return (
                        <tr key={s.id} style={{ background:i%2===0?"#fff":"#FAFAFA", borderBottom:"1px solid #F3F4F6" }}
                          onMouseEnter={e=>e.currentTarget.style.background="#EFF6FF"}
                          onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#fff":"#FAFAFA"}>
                          <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                              <div style={{ width:3, height:30, background:p.color, borderRadius:2, flexShrink:0 }} />
                              <div>
                                <div style={{ fontWeight:700, color:"#111" }}>{s.name}</div>
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
      {activeTab === "model" && (
        <div style={{ padding:"20px 24px", maxWidth:1200, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div>
              <h2 style={{ fontSize:20, fontWeight:800, margin:0 }}>Scenario Builder</h2>
              <p style={{ color:"#6B7280", fontSize:13, margin:"4px 0 0" }}>Adjust primary vote swings and preference flows to model different election outcomes.</p>
            </div>
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
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:16, alignItems:"start" }}>

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

              <div style={panelStyle}>
                <div style={sectionHead}>Preference flows to ALP</div>
                <PrefInput label="Greens → ALP"      value={prefFlows.grn_alp}   onChange={v=>setPrefFlows(f=>({...f,grn_alp:v}))}   color="#059669" />
                <PrefInput label="Independents → ALP" value={prefFlows.teal_alp} onChange={v=>setPrefFlows(f=>({...f,teal_alp:v}))} color="#0891B2" />
                <PrefInput label="One Nation → ALP"  value={prefFlows.on_alp}    onChange={v=>setPrefFlows(f=>({...f,on_alp:v}))}    color="#B45309" />
                <PrefInput label="Other → ALP"       value={prefFlows.other_alp} onChange={v=>setPrefFlows(f=>({...f,other_alp:v}))} color="#7C3AED" />
                <div style={{ fontSize:11, color:"#9CA3AF", borderTop:"1px solid #F3F4F6", paddingTop:8, marginTop:4 }}>
                  Defaults based on 2022 preference distributions (ON→ALP historically ~43%). Remainder flows to Coalition.
                </div>
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
