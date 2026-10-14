/* EmmaLLM — client feature flag pubblico (RF-8).
 * window.EmmaFlags.isEnabled('fs:foo'); gating dichiarativo via attributo [data-feature].
 * Realtime SSE con fallback polling 5s (riconciliazione anche in multi-worker).
 * Endpoint pubblico: ritorna solo i flag ATTIVI (key + scope). */
(function () {
  "use strict";

  var API = "/api/feature-flags";
  var STREAM = "/api/feature-flags/stream";
  var POLL_MS = 5000;

  var enabled = new Set();
  var listeners = new Set();
  var es = null;
  var pollTimer = null;
  var connection = "connecting";

  function applyGating(root) {
    (root || document).querySelectorAll("[data-feature]").forEach(function (el) {
      el.hidden = !enabled.has(el.getAttribute("data-feature"));
    });
  }

  function notify() {
    listeners.forEach(function (cb) {
      try { cb({ enabled: enabled, connection: connection }); } catch (e) { /* noop */ }
    });
  }

  function fetchFlags() {
    return fetch(API, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        enabled = new Set((data || []).map(function (f) { return f.key; }));
        applyGating();
        notify();
      })
      .catch(function () { /* offline: riprova al prossimo poll */ });
  }

  function startPoll() { if (!pollTimer) pollTimer = setInterval(fetchFlags, POLL_MS); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function applyEvent(msg) {
    if (msg.type === "flag.updated") {
      msg.enabled ? enabled.add(msg.key) : enabled.delete(msg.key);
    } else if (msg.type === "flag.deleted") {
      enabled.delete(msg.key);
    } // flag.created nasce OFF → no-op
    applyGating();
    notify();
  }

  function connect() {
    if (!window.EventSource) { connection = "polling"; startPoll(); notify(); return; }
    es = new EventSource(STREAM);
    es.onopen = function () { connection = "connected"; stopPoll(); notify(); };
    es.onmessage = function (ev) { try { applyEvent(JSON.parse(ev.data)); } catch (e) { /* keep-alive */ } };
    es.onerror = function () {
      if (es) { es.close(); es = null; }
      connection = "polling";
      startPoll();
      notify();
      setTimeout(connect, POLL_MS); // tenta di riconnettere l'SSE
    };
  }

  function init() { fetchFlags().then(connect); }

  window.EmmaFlags = {
    init: init,
    isEnabled: function (key) { return enabled.has(key); },
    onChange: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    applyGating: applyGating,
    get connectionState() { return connection; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
