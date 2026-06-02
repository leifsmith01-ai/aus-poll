// Passthrough adapter — the raw feed is already in the normalized contract shape
// (used by the committed sample feeds). Validation happens in fetchLoop via validateFeed.
export default {
  id: "passthrough",
  parse(raw /*, ctx */) {
    return raw;
  },
};
