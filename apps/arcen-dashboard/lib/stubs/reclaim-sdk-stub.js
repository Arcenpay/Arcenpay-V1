// Stub for @reclaimprotocol/js-sdk
// The real SDK is loaded at runtime on the server when RECLAIM_APP_ID is configured.
// This stub prevents bundler errors when the package is not installed.
module.exports = {
  ReclaimClient: class ReclaimClient {
    constructor() {
      if (typeof process !== "undefined" && process.env?.RECLAIM_APP_ID) {
        throw new Error(
          "@reclaimprotocol/js-sdk is not installed but RECLAIM_APP_ID is set. Install the package to enable Reclaim integration.",
        );
      }
    }
  },
  verifyProof: async () => { return false; },
};
