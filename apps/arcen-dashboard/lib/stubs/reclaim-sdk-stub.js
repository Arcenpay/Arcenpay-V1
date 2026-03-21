// Stub for @reclaimprotocol/js-sdk
// The real SDK is loaded at runtime on the server when RECLAIM_APP_ID is configured.
// This stub prevents bundler errors when the package is not installed.
module.exports = {
  ReclaimClient: class ReclaimClient {
    constructor() { throw new Error("@reclaimprotocol/js-sdk is not installed"); }
  },
  verifyProof: async () => { throw new Error("@reclaimprotocol/js-sdk is not installed"); },
};
