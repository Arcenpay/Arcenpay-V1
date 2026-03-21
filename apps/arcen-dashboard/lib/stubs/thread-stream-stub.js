// Browser stub for thread-stream (used by pino in WalletConnect packages)
// In the browser, pino doesn't need worker threads for streaming.
module.exports = class ThreadStream {
  write() {}
  end() {}
  flush() {}
  on() { return this; }
  once() { return this; }
  off() { return this; }
  emit() {}
};
