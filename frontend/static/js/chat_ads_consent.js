/* Google Privacy & Messaging + TCF. Nessun consenso dedotto dal banner termini Emma. */
(function (root) {
    "use strict";
    function evaluate(data, success, outsideTcf) {
        if (!success || !data || data.cmpStatus !== "loaded") return "unknown";
        if (!["tcloaded", "useractioncomplete"].includes(data.eventStatus)) return "unknown";
        // Doppia esenzione esplicita CMP, non geolocalizzazione o cookie dedotti da Emma.
        if (data.gdprApplies === false) return outsideTcf === true ? "allowed" : "unknown";
        if (data.gdprApplies !== true || !data.tcString) return "unknown";
        var vendor = data.vendor || {}, purpose = data.purpose || {};
        function consent(id) { return purpose.consents?.[id] === true && vendor.consents?.[755] === true; }
        function interest(id) { return purpose.legitimateInterests?.[id] === true && vendor.legitimateInterests?.[755] === true; }
        function permitted(id, allowInterest) {
            var restriction = data.publisher?.restrictions?.[id]?.[755];
            if (restriction === 0) return false;
            if (restriction === 1) return consent(id);
            if (restriction === 2) return allowInterest && interest(id);
            return consent(id) || (allowInterest && interest(id));
        }
        return permitted(1, false) && [2, 7, 9, 10].every(function (id) { return permitted(id, true); }) ? "allowed" : "denied";
    }
    function create(options) {
        var started = false, alive = true, attached = false, listenerId, state = "unknown";
        var preferences = options.preferences;
        var lastData, lastSuccess, outsideTcf = false;
        function set(next) { if (alive && next !== state) { state = next; options.onChange(next); } }
        function start() {
            if (!alive || started) return;
            started = true;
            root.googlefc = root.googlefc || {};
            root.googlefc.callbackQueue = root.googlefc.callbackQueue || [];
            root.googlefc.callbackQueue.push({ INITIAL_US_STATES_OPT_OUT_DATA_READY: function () {
                if (!alive) return;
                var api = root.googlefc.usstatesoptout;
                outsideTcf = false;
                try {
                    outsideTcf = typeof api?.getInitialUsStatesOptOutStatus === "function" &&
                        typeof api.InitialUsStatesOptOutStatusEnum?.DOES_NOT_APPLY === "number" &&
                        api.getInitialUsStatesOptOutStatus() === api.InitialUsStatesOptOutStatusEnum.DOES_NOT_APPLY;
                } catch (_) { /* API terza indisponibile: nessuna esenzione dedotta */ }
                set(evaluate(lastData, lastSuccess, outsideTcf));
            } });
            root.googlefc.callbackQueue.push({ CONSENT_API_READY: function () {
                if (!alive || attached || typeof root.__tcfapi !== "function") return;
                attached = true;
                try { root.__tcfapi("addEventListener", 2, function (data, success) {
                    if (data?.listenerId !== undefined) listenerId = data.listenerId;
                    if (!alive) { removeListener(); return; }
                    if (preferences) preferences.hidden = !(success && data?.gdprApplies === true);
                    lastData = data; lastSuccess = success;
                    set(evaluate(data, success, outsideTcf));
                }); } catch (_) { attached = false; set("unknown"); }
            } });
        }
        function revoke() {
            set("unknown");
            try { root.googlefc?.callbackQueue?.push({ CONSENT_API_READY: function () {
                if (alive && typeof root.googlefc.showRevocationMessage === "function") root.googlefc.showRevocationMessage();
            } }); } catch (_) { /* La revoca locale resta chiusa anche se la CMP fallisce. */ }
        }
        function removeListener() {
            if (listenerId !== undefined && typeof root.__tcfapi === "function") {
                var previous = listenerId; listenerId = undefined;
                try { root.__tcfapi("removeEventListener", 2, function () {}, previous); } catch (_) { /* cleanup locale indipendente */ }
            }
        }
        preferences?.addEventListener("click", revoke);
        return Object.freeze({ start: start, getState: function () { return state; }, dispose: function () {
            alive = false; removeListener(); preferences?.removeEventListener("click", revoke);
            if (preferences) preferences.hidden = true;
        } });
    }
    root.EmmaAdsConsent = Object.freeze({ create: create, evaluate: evaluate });
})(window);
