// AEC (Australian Electoral Commission) adapter — STUB (federal genericity demo).
//
// The AEC Media Feed (https://www.aec.gov.au/media/mediafeed/) publishes EML/XML to an FTP
// location every ~90s on election night. It is booth-level, so a federal feed normalized
// here SHOULD populate meta.boothLevel=true and seat.booths[], which unlocks the
// booth-matched-swing path in project.js automatically.
//
// FTP + CORS mean the browser usually cannot fetch the raw AEC feed directly; the intended
// production path is a thin scheduled proxy that fetches the EML, converts to this contract,
// and publishes a same-origin JSON snapshot that this adapter passes through.
import { slugify } from "../contract.js";

export default {
  id: "aec",
  parse(raw, ctx) {
    if (raw && raw.contractVersion && Array.isArray(raw.seats)) return raw; // proxy snapshot
    void slugify; void ctx;
    throw new Error(
      "AEC adapter: EML media-feed mapping not yet wired. Use a proxy snapshot in contract " +
      "shape, or implement the EML->contract transform in webapp/src/live/adapters/aec.js."
    );
  },
};
