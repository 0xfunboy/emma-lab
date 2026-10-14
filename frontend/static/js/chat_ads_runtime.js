/* Un'opportunità per conversazione/sessione. Solo terminali live: mai lo storico. */
(function (root) {
    "use strict";
    root.EmmaAdsRuntime = Object.freeze({ create: function (options) {
        // Un asset opzionale bloccato/non caricato non deve interrompere la chat.
        if (!options?.panel || typeof root.EmmaAds?.createStatusReader !== "function" ||
            typeof root.EmmaAds?.createController !== "function" ||
            typeof root.EmmaAdsProvider?.adapter !== "function" ||
            typeof root.EmmaAdsProvider?.bootstrap !== "function" ||
            typeof root.EmmaAdsConsent?.create !== "function" ||
            typeof root.EmmaAdsView?.create !== "function") return null;
        var panel = options.panel, user = null, sessionReady = false, conversation = null, generating = false, epoch = 0;
        // Scelta del banner cookie di Emma: può solo escludere la pubblicità, mai consentirla.
        var cookiesAllowed = typeof options.cookiesAllowed === "function" ? options.cookiesAllowed : function () { return true; };
        var candidate = null, running = false, consumed = new Set(), alive = true, flag = false, connected = false, lastConnection = null, rechecking = false;
        var read = root.EmmaAds.createStatusReader(options.apiFetch);
        var controller = root.EmmaAds.createController({ readStatus: read, adapter: root.EmmaAdsProvider.adapter(panel, function () { preview?.sync(); }) });
        var preview = root.EmmaAdsPreview?.create({ button: document.getElementById("adsPreviewBtn"), panel: panel, apiFetch: options.apiFetch,
            realPresent: function () { return !!panel.querySelector('[data-ad-kind="display"]'); } });
        var consent = root.EmmaAdsConsent.create({ preferences: document.getElementById("adsPreferencesBtn"), onChange: function (value) {
            controller.setContext({ consent: value });
            if (value !== "allowed") root.EmmaAdsProvider.pause();
            if (value === "allowed") attempt();
        } });
        function context() { controller.setContext({ sessionKey: user?.id || null, conversationKey: conversation, flagEnabled: flag,
            connectionReady: connected, consent: consent.getState() }); }
        function eligible() { return alive && sessionReady && user?.id && !user.is_supporter && flag && connected && conversation && cookiesAllowed() === true; }
        function clear() {
            epoch++; running = false; candidate = null;
            controller.invalidate("context_changed"); root.EmmaAdsProvider.pause(); preview?.sync();
        }
        async function attempt() {
            if (!candidate || running || generating || !eligible() || preview?.active()) return;
            var current = candidate, ticket = epoch;
            function fresh() { return ticket === epoch && candidate === current && eligible() && !preview?.active() && current.anchor.isConnected; }
            running = true;
            try {
                var status = await read();
                if (!fresh()) return;
                if (!status.eligible) { clear(); return; }
                if (generating) return;
                consumed.add(conversation);
                if (current.revision === undefined) current.revision = status.revision;
                if (current.revision !== status.revision) { clear(); return; }
                consent.start();
                await root.EmmaAdsProvider.bootstrap(status.configuration);
                if (!fresh() || generating || consent.getState() !== "allowed") return;
                context();
                // Il controller rilegge dal server immediatamente prima di preparare il lease.
                current.requested = true;
                await controller.offer({ id: current.id, allowed: true, anchor: current.anchor, revision: current.revision });
                if (fresh() && !generating) candidate = null;
            } catch (_) { if (fresh()) clear(); }
            finally { if (ticket === epoch) { running = false; preview?.sync(); } }
        }
        function flags(snapshot) {
            var next = snapshot ? snapshot.enabled.has("fs:ads") : !!root.EmmaFlags?.isEnabled("fs:ads");
            var connection = snapshot?.connection || root.EmmaFlags?.connectionState;
            // Una lettura autenticata fresca riconcilia anche il fallback polling.
            var changed = connection !== lastConnection;
            lastConnection = connection; flag = next;
            if (changed) connected = connection === "connected";
            if (!next || (changed && !connected)) clear();
            context(); // un cambio flag/reconnect non crea opportunità
            if (next && user && (changed || connection === "polling")) recheck();
        }
        var unsubscribe = root.EmmaFlags?.onChange(flags); flags();
        async function recheck() {
            if (!alive || !sessionReady || !user?.id || !flag || rechecking) return;
            var ticket = epoch;
            rechecking = true;
            try {
                var status = await read();
                if (ticket !== epoch) return;
                // Anche il ritorno alla scheda può recuperare da un errore HTTP:
                // non aspettare una transizione SSE che potrebbe non avvenire.
                connected = true; context();
                if (!status.eligible) clear();
            } catch (_) { if (ticket === epoch) { connected = false; clear(); context(); } }
            finally { rechecking = false; }
        }
        function visible() { if (document.visibilityState === "visible") { recheck(); preview?.refresh(); } }
        function online() { recheck(); preview?.refresh(); }
        document.addEventListener("visibilitychange", visible);
        root.addEventListener("online", online);
        return Object.freeze({
            session: function (value) {
                if (value?.id !== user?.id) { clear(); consumed.clear(); }
                user = value; sessionReady = !!value; preview?.session(value);
                if (!value || value.is_supporter) clear(); context();
            },
            uncertain: function () { sessionReady = false; clear(); preview?.session(null); controller.setContext({ connectionReady: false }); },
            conversation: function (key) { if (conversation !== key) { clear(); preview?.clear(); conversation = key; context(); } },
            generating: function (value) {
                generating = value; preview?.generating(value);
                if (value && candidate?.requested) { controller.invalidate("generation_started"); candidate.requested = false; }
            },
            terminal: function (data) {
                if (data.conversation !== conversation || !data.text?.trim() || !["eos", "sentence_boundary", "stop_sequence"].includes(data.reason)) return;
                if (!eligible() || consumed.has(conversation) || candidate || preview?.active()) { if (candidate && !candidate.requested) attempt(); return; }
                candidate = { id: conversation, anchor: data.anchor, requested: false }; attempt();
            },
            dispose: function () { alive = false; clear(); preview?.dispose(); controller.dispose(); consent.dispose(); unsubscribe?.(); document.removeEventListener("visibilitychange", visible); root.removeEventListener("online", online); },
        });
    } });
})(window);
