// ── Live Results — what changed between two updates ──────────────────────────
// Pure: compares the projected seats of the previous update with the current one and
// returns the changes worth telling a viewer about, most important first.
//
//   lead      the projected winner changed party group (a seat changing hands tonight)
//   called    the seat was declared / formally called
//   projected the seat became our projection (≥99% certain)
//   doubt     a seat that was likely/projected fell back into doubt
const ORDER = { lead: 0, called: 1, projected: 2, doubt: 3 };
const counting = (s) => s && s.status !== "not_started" && s.basis !== "baseline" && s.basis !== "swing";

export function seatEvents(prevSeats, curSeats) {
  if (!prevSeats || !curSeats) return [];
  const prev = new Map(prevSeats.map((s) => [s.seatId, s]));
  const out = [];
  for (const s of curSeats) {
    const o = prev.get(s.seatId);
    if (!o) continue;
    const base = { seatId: s.seatId, name: s.name, party: String(s.winnerParty).split("#")[0], group: s.winnerGroup };
    if (counting(o) && counting(s) && o.winnerGroup !== s.winnerGroup) {
      out.push({ ...base, kind: "lead", prevParty: String(o.winnerParty).split("#")[0] });
    }
    if (s.status === "called" && o.status !== "called") out.push({ ...base, kind: "called" });
    else if (s.status === "projected" && o.status !== "projected" && o.status !== "called") {
      out.push({ ...base, kind: "projected" });
    }
    if (s.status === "in_doubt" && (o.status === "likely" || o.status === "projected" || o.status === "called")) {
      out.push({ ...base, kind: "doubt" });
    }
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name));
}
