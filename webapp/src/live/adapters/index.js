// Adapter registry — maps a source's `adapter` name to its raw->contract transform.
import passthrough from "./passthrough.js";
import vec from "./vec.js";
import aec from "./aec.js";

const ADAPTERS = { passthrough, vec, aec };

export function getAdapter(name) {
  return ADAPTERS[name] || passthrough;
}
