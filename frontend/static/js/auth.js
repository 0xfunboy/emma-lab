/* ═══════════════════════════════════════════════
   EmmaLLM — Modulo sessione client (iterazione 06)
   Token access in sessionStorage; refresh via cookie HttpOnly (/api/auth).
   Espone window.EmmaAuth, usato da app.js (home) e dashboard.js.
   ═══════════════════════════════════════════════ */
(function () {
    "use strict";

    var TOKEN_KEY = "emma_access_token";

    function saveToken(t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
    function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
    function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }

    // Risposta uniforme per i chiamanti: niente eccezioni da gestire a monte.
    // { ok, status, data, networkError }
    async function request(url, opts) {
        opts = opts || {};
        var headers = Object.assign({}, opts.headers || {});
        // FormData (es. upload file store iter. 54): lascia che il browser imposti il
        // Content-Type col boundary corretto e NON serializzare in JSON.
        var isForm = (typeof FormData !== "undefined") && (opts.body instanceof FormData);
        if (opts.body !== undefined && !isForm && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        var token = getToken();
        if (token && !headers["Authorization"]) headers["Authorization"] = "Bearer " + token;
        try {
            var res = await fetch(url, {
                method: opts.method || "GET",
                headers: headers,
                body: opts.body !== undefined ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
                credentials: "include",
            });
            var data = null;
            if (res.status !== 204) {
                try { data = await res.json(); } catch (e) { data = null; }
            }
            return { ok: res.ok, status: res.status, data: data, networkError: false };
        } catch (e) {
            return { ok: false, status: 0, data: null, networkError: true };
        }
    }

    // Scambia il cookie refresh per un nuovo access token. true se riuscito.
    // SINGLE-FLIGHT (fix 03-refresh-race): al cambio pagina con access scaduto partono N fetch
    // parallele → N×401 → senza mutex N refresh simultanei con lo stesso cookie. Il backend
    // ruota al primo e tratta gli altri come RIUSO di un token revocato → difesa anti-furto:
    // revoca l'INTERA catena (incluso il token appena emesso) → sessione distrutta, loader
    // appesi ("caricamento infinito"). Qui: un solo refresh in volo, gli altri ne attendono l'esito.
    var _refreshInFlight = null;
    function refresh() {
        if (_refreshInFlight) return _refreshInFlight;
        _refreshInFlight = (async function () {
            try {
                var r = await request("/api/auth/refresh", { method: "POST" });
                if (r.ok && r.data && r.data.access_token) { saveToken(r.data.access_token); return true; }
                clearToken();
                return false;
            } finally {
                _refreshInFlight = null;
            }
        })();
        return _refreshInFlight;
    }

    // Fetch autenticata con un solo retry su 401 via refresh (copre anche "nessun token": refresh dal cookie).
    async function apiFetch(url, opts) {
        var r = await request(url, opts);
        if (r.status === 401) {
            var refreshed = await refresh();
            if (refreshed) r = await request(url, opts);
        }
        return r;
    }

    async function register(payload) {
        return request("/api/auth/register", { method: "POST", body: payload });
    }

    async function login(email, password, opts) {
        // Con 2FA attivo la risposta è { otp_required, pre_auth_token, ... } (nessun token da salvare):
        // il chiamante prosegue con verify2fa. Senza 2FA arriva { access_token } → lo salviamo subito.
        // opts.remember=false → il refresh-cookie è di sessione browser ("Resta connesso" spento, iter. 24).
        var body = { email: email, password: password };
        if (opts && opts.remember === false) body.remember = false;
        var r = await request("/api/auth/login", { method: "POST", body: body });
        if (r.ok && r.data && r.data.access_token) saveToken(r.data.access_token);
        return r;
    }

    // Secondo fattore (2FA): scambia il pre-auth token + codice per i token finali.
    async function verify2fa(preAuthToken, otp) {
        var r = await request("/api/auth/login/verify-otp", { method: "POST", body: { pre_auth_token: preAuthToken, otp: otp } });
        if (r.ok && r.data && r.data.access_token) saveToken(r.data.access_token);
        return r;
    }

    // Reinvio del codice 2FA in corso.
    async function resend2fa(preAuthToken) {
        return request("/api/auth/login/resend-otp", { method: "POST", body: { pre_auth_token: preAuthToken } });
    }

    async function me() {
        var r = await apiFetch("/api/auth/me");
        return r.ok ? r.data : null;
    }

    async function logout() {
        try { await request("/api/auth/logout", { method: "POST" }); } catch (e) {}
        clearToken();
    }

    function redirect(path) { window.location.assign(path); }

    /* ── Toggle mostra/nascondi password (iter. 24) ──
       Decora OGNI input[type=password] della pagina (home, /login, /register, dashboard):
       wrappa l'input in .pw-wrap e aggiunge l'occhio. Idempotente (data-pw-enhanced). */
    var EYE_SHOW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    var EYE_HIDE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    function enhancePasswordFields(root) {
        var scope = root || document;
        scope.querySelectorAll('input[type="password"]').forEach(function (input) {
            if (input.dataset.pwEnhanced) return;
            input.dataset.pwEnhanced = "1";
            var wrap = document.createElement("span");
            wrap.className = "pw-wrap";
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pw-toggle";
            btn.setAttribute("aria-label", "Mostra password");
            btn.setAttribute("aria-pressed", "false");
            btn.setAttribute("tabindex", "-1");  // il focus resta sul flusso dei campi
            btn.innerHTML = EYE_SHOW;
            btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                var show = input.type === "password";
                input.type = show ? "text" : "password";
                btn.innerHTML = show ? EYE_HIDE : EYE_SHOW;
                btn.setAttribute("aria-pressed", show ? "true" : "false");
                btn.setAttribute("aria-label", show ? "Nascondi password" : "Mostra password");
                input.focus({ preventScroll: true });
            });
            wrap.appendChild(btn);
        });
    }
    enhancePasswordFields();

    window.EmmaAuth = {
        saveToken: saveToken, getToken: getToken, clearToken: clearToken,
        apiFetch: apiFetch, refresh: refresh,
        register: register, login: login, verify2fa: verify2fa, resend2fa: resend2fa,
        me: me, logout: logout, redirect: redirect,
        enhancePasswordFields: enhancePasswordFields,
    };
})();
