// Partial per-seat preference-flow overrides must never produce NaN.
//
// updateSeatPrefFlow() builds override.prefFlows incrementally — editing a single
// slider yields an override containing only that one key, and clearing an input
// stores an explicit null. Every 2CP branch in computeModelledSeats therefore has
// to fall back to the national defaults for any flow key the override omits.
// A missing fallback multiplies a swing by undefined (NaN even at zero swing,
// since 0 * undefined === NaN), silently misclassifying the seat.

import { describe, it, expect } from "vitest";
import { computeModelledSeats, SEATS, FED_DEFAULT_PREF_FLOWS } from "../App.jsx";

const SWINGS = { alp: -1.5, coal: 2.0, grn: 0.5, teal: -0.5, on: 1.0 };

const expectFiniteModelled = (seat) => {
  const m = seat.modelled;
  expect(Number.isFinite(m.winnerPct), `${seat.name}: winnerPct=${m.winnerPct}`).toBe(true);
  if (m.projAlp2pp != null) {
    expect(Number.isFinite(m.projAlp2pp), `${seat.name}: projAlp2pp=${m.projAlp2pp}`).toBe(true);
  }
  expect(m.winnerParty, `${seat.name}: winnerParty`).toBeTruthy();
};

describe("partial per-seat prefFlows overrides", () => {
  it("a single-key override never yields NaN in any seat/branch", () => {
    // One override key per seat, mirroring a user who edited exactly one slider.
    const overrides = {};
    SEATS.forEach((s) => { overrides[s.id] = { prefFlows: { grn_teal: 0.55 } }; });
    const modelled = computeModelledSeats(
      SEATS, SWINGS, FED_DEFAULT_PREF_FLOWS, overrides, -1.2, 6.5, false, null,
    );
    modelled.forEach(expectFiniteModelled);
  });

  it("an explicit null flow value (cleared input) falls back to defaults", () => {
    // updateSeatPrefFlow stores null when the input is emptied.
    const overrides = {};
    SEATS.forEach((s) => {
      overrides[s.id] = { prefFlows: { on_alp: null, other_alp: null } };
    });
    const modelled = computeModelledSeats(
      SEATS, SWINGS, FED_DEFAULT_PREF_FLOWS, overrides, -1.2, 6.5, false, null,
    );
    modelled.forEach(expectFiniteModelled);
  });
});
