/* Controller headless: dipendenze esplicite, epoch e cleanup; nessun timer di refresh. */
(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.EmmaAds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    var REASONS = ["flag_off", "ad_free", "integration_unavailable", "config_missing", "config_incomplete", "ready"];

    function validStatus(value) {
        return value && typeof value.eligible === "boolean" && REASONS.includes(value.reason) &&
            Number.isSafeInteger(value.revision) && value.revision >= 0 &&
            value.eligible === (value.reason === "ready") && (!value.eligible || value.revision > 0);
    }

    // Riusa il refresh autenticato Emma. Non passa prompt, identità o consenso nell'URL.
    // EmmaAuth non supporta AbortSignal: l'epoch scarta la risposta tardiva senza
    // promettere di annullare il trasporto HTTP o la rotazione del refresh cookie.
    function createStatusReader(apiFetch) {
        if (typeof apiFetch !== "function") throw new TypeError("apiFetch richiesto");
        return async function () {
            var timer;
            var response;
            try {
                response = await Promise.race([
                    apiFetch("/api/ads/status", { method: "GET" }),
                    new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Stato ads non disponibile")); }, 15000); }),
                ]);
            } finally { clearTimeout(timer); }
            if (!response || response.ok !== true || !validStatus(response.data)) {
                throw new Error("Stato ads non disponibile");
            }
            var config = response.data.configuration;
            if (response.data.eligible && (typeof config?.publisher_id !== "string" || typeof config?.slot_id !== "string" || !/^ca-pub-[0-9]{16}$/.test(config.publisher_id) || !/^[0-9]{1,64}$/.test(config.slot_id))) throw new Error("Configurazione ads non valida");
            return Object.freeze({ eligible: response.data.eligible, reason: response.data.reason,
                revision: response.data.revision, configuration: response.data.eligible ? Object.freeze({ publisher_id: config.publisher_id, slot_id: config.slot_id }) : null });
        };
    }

    function createController(options) {
        options = options || {};
        var readStatus = options.readStatus;
        var adapter = options.adapter;
        // Deadline tecnica del tentativo, non frequenza pubblicitaria né setting operatore.
        var timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Deadline non valida");
        var context = { sessionKey: null, conversationKey: null, flagEnabled: false,
            connectionReady: false, consent: "unknown" };
        var epoch = 0, active = null, disposed = false;
        var consumed = new Set();
        var state = Object.freeze({ phase: "inactive", reason: "not_ready" });

        function transition(phase, reason) {
            state = Object.freeze({ phase: phase, reason: reason });
            return state;
        }

        function release(attempt) {
            if (!attempt || !attempt.lease || attempt.released) return;
            attempt.released = true;
            try {
                // Anche un dispose asincrono fallito non deve propagarsi nella chat.
                Promise.resolve(attempt.lease.dispose()).catch(function () {});
            } catch (_) { /* il confine esterno non blocca il cleanup locale */ }
        }

        function invalidate(reason) {
            reason = disposed ? "disposed" : (reason || "invalidated");
            epoch += 1;
            var previous = active;
            active = null;
            if (previous) {
                previous.abort.abort();
                release(previous);
                previous.cancel(reason);
            }
            return transition("inactive", reason);
        }

        function gate() {
            if (disposed) return "disposed";
            if (!context.sessionKey || !context.conversationKey) return "session_unknown";
            if (!context.flagEnabled) return "flag_off";
            if (!context.connectionReady) return "connection_unknown";
            if (context.consent !== "allowed") return "consent_required";
            if (typeof readStatus !== "function" || !adapter || typeof adapter.prepare !== "function") {
                return "integration_unavailable";
            }
            return null;
        }

        function setContext(update) {
            if (disposed) return state;
            update = update || {};
            var next = Object.assign({}, context);
            ["sessionKey", "conversationKey", "flagEnabled", "connectionReady", "consent"].forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(update, key)) next[key] = update[key];
            });
            ["sessionKey", "conversationKey"].forEach(function (key) {
                if (typeof next[key] !== "string" || !next[key].trim()) next[key] = null;
            });
            next.flagEnabled = next.flagEnabled === true;
            next.connectionReady = next.connectionReady === true;
            if (!["unknown", "allowed", "denied"].includes(next.consent)) next.consent = "unknown";
            var identityChanged = next.sessionKey !== context.sessionKey || next.conversationKey !== context.conversationKey;
            var changed = Object.keys(context).some(function (key) { return context[key] !== next[key]; });
            context = next;
            if (identityChanged) consumed.clear();
            if (changed) invalidate(gate() || "context_changed");
            return state; // nessuna richiesta all'arrivo del consenso o del flag
        }

        function offer(candidate) {
            var blocked = gate();
            if (blocked) return Promise.resolve(transition("inactive", blocked));
            if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim() || candidate.allowed !== true) {
                return Promise.resolve(state); // la politica degli eventi verrà scelta con la UX
            }
            if (active && active.pending) {
                return active.id === candidate.id ? active.promise :
                    Promise.resolve(Object.freeze({ phase: "inactive", reason: "busy" }));
            }
            if (consumed.has(candidate.id)) return Promise.resolve(state);

            invalidate("new_candidate");
            candidate = Object.freeze(Object.assign({}, candidate));
            var candidateId = candidate.id;
            var attempt = { id: candidateId, epoch: epoch, abort: new AbortController(), lease: null,
                released: false, pending: true, cancel: function () {} };
            active = attempt;
            function isCurrent() { return !disposed && active === attempt && epoch === attempt.epoch && !gate(); }
            var cancelled = new Promise(function (resolve) {
                attempt.cancel = function (reason) { resolve(Object.freeze({ phase: "inactive", reason: reason })); };
            });
            var timer;
            var deadline = new Promise(function (resolve) {
                timer = setTimeout(function () {
                    if (isCurrent()) invalidate("timeout");
                    resolve(Object.freeze({ phase: "inactive", reason: "timeout" }));
                }, timeoutMs);
            });
            async function execute() {
                try {
                    if (!isCurrent()) return state;
                    transition("checking", "checking_status");
                    var status = await readStatus({ signal: attempt.abort.signal });
                    if (!isCurrent()) return state;
                    if (!validStatus(status)) throw new Error("Contratto stato non valido");
                    if (!status.eligible) return transition("inactive", status.reason);
                    transition("preparing", "preparing_adapter");
                    // Il lease appartiene a questo tentativo: un cleanup tardivo non può
                    // eliminare quello di una nuova chat. L'adapter deve rispettare isCurrent
                    // prima di ogni proprio effetto asincrono (DOM/rete).
                    var lease = await adapter.prepare({ revision: status.revision, configuration: status.configuration, candidate: candidate,
                        signal: attempt.abort.signal, isCurrent: isCurrent });
                    attempt.lease = lease;
                    if (!isCurrent()) { release(attempt); return state; }
                    if (!lease || typeof lease.request !== "function" || typeof lease.dispose !== "function") {
                        throw new Error("Contratto adapter non valido");
                    }
                    consumed.add(candidateId);
                    transition("requesting", "requesting");
                    var result = await lease.request({ signal: attempt.abort.signal, isCurrent: isCurrent });
                    if (!isCurrent()) { release(attempt); return state; }
                    if (result === "filled") return transition("present", "filled");
                    if (result === "requested") return transition("present", "requested");
                    release(attempt);
                    return transition("inactive", result === "empty" ? "no_fill" : "provider_error");
                } catch (_) {
                    release(attempt);
                    if (isCurrent()) return transition("inactive", "unavailable");
                    return state;
                }
            }
            // L'avvio differito assegna promise prima di eseguire dipendenze rientranti.
            attempt.promise = Promise.race([Promise.resolve().then(execute), cancelled, deadline]).finally(function () {
                clearTimeout(timer);
                attempt.pending = false;
            });
            return attempt.promise;
        }

        return Object.freeze({
            setContext: setContext,
            offer: offer,
            invalidate: invalidate,
            getState: function () { return state; },
            dispose: function () { disposed = true; invalidate("disposed"); consumed.clear(); },
        });
    }

    return Object.freeze({ createController: createController, createStatusReader: createStatusReader });
});
