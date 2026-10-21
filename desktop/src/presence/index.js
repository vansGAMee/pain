/**
 * Pain Audio Companion — Presence Engine: Modular Entry Point
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Signals = require('./signals');
    const Baselines = require('./baselines');
    const Evidence = require('./evidence');
    const Detectors = require('./detectors');
    const Grammar = require('./grammar');
    const Memory = require('./memory');
    const Engine = require('./engine');
    module.exports = {
      Signals,
      Baselines,
      Evidence,
      Detectors,
      Grammar,
      Memory,
      Engine,
      ...Engine
    };
  } else {
    root.Presence = {
      Signals: root.PresenceSignals,
      Baselines: root.PresenceBaselines,
      Evidence: root.PresenceEvidence,
      Detectors: root.PresenceDetectors,
      Grammar: root.PresenceGrammar,
      Memory: root.PresenceMemory,
      Engine: root.PresenceEngine
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {});
