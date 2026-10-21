/**
 * Pain Audio Companion — Presence Engine (Facade)
 * Delegates to modular components in desktop/src/presence/
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = require('./presence/engine');
  } else {
    root.PresenceEngine = root.PresenceEngine || factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return (typeof globalThis !== 'undefined' && globalThis.PresenceEngine)
    ? globalThis.PresenceEngine
    : {};
});
