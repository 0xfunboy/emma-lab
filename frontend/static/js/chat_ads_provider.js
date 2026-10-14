/* Un loader per pagina, un push per lease. Nessun URL/HTML configurabile. */
(function (root) {
    "use strict";
    var loader = null, publisher = null;
    function pause() { if (root.adsbygoogle) root.adsbygoogle.pauseAdRequests = 1; }
    function bootstrap(configuration) {
        if (!/^ca-pub-[0-9]{16}$/.test(configuration?.publisher_id || "")) return Promise.reject(new Error("Publisher non valido"));
        if (publisher && publisher !== configuration.publisher_id) return Promise.reject(new Error("Nuovo publisher: ricaricare la pagina"));
        if (loader) return loader;
        publisher = configuration.publisher_id;
        root.adsbygoogle = root.adsbygoogle || [];
        pause(); // Il tag avvia anche la CMP, ma nessun push prima del consenso.
        loader = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.async = true; script.crossOrigin = "anonymous";
            script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + publisher;
            var timer = setTimeout(function () { script.remove(); reject(new Error("Loader non disponibile")); }, 15000);
            script.onload = function () { clearTimeout(timer); resolve(); };
            script.onerror = function () { clearTimeout(timer); script.remove(); reject(new Error("Loader non disponibile")); };
            document.head.appendChild(script);
        });
        return loader;
    }
    function adapter(panel, onChange) {
        return { prepare: function (options) {
            var config = options.configuration;
            if (!options.isCurrent() || options.revision !== options.candidate.revision || !config || config.publisher_id !== publisher || !/^[0-9]{1,64}$/.test(config.slot_id)) throw new Error("Configurazione non corrente");
            if (!options.candidate.anchor?.isConnected || options.candidate.anchor.parentNode !== panel) throw new Error("Risposta non disponibile");
            var view = root.EmmaAdsView.create({ panel: panel, anchor: options.candidate.anchor });
            var ins = document.createElement("ins");
            ins.className = "adsbygoogle"; ins.style.display = "block";
            ins.dataset.adClient = config.publisher_id; ins.dataset.adSlot = config.slot_id;
            ins.dataset.adFormat = "auto"; ins.dataset.fullWidthResponsive = "true";
            view.content.appendChild(ins);
            var requested = false, disposed = false;
            var observer = new MutationObserver(function () {
                if (disposed || !options.isCurrent()) return;
                // unfill-optimized può contenere la soluzione alternativa di Google.
                if (ins.dataset.adStatus === "unfilled") dispose();
            });
            observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
            function dispose() { if (disposed) return; disposed = true; observer.disconnect(); view.dispose(); if (onChange) onChange(); }
            return { dispose: dispose, request: function () {
                if (requested || disposed || !options.isCurrent() || !ins.isConnected || ins.getBoundingClientRect().width <= 0) throw new Error("Slot non disponibile");
                requested = true;
                root.adsbygoogle.pauseAdRequests = 0;
                root.adsbygoogle.push({});
                // Il fill fuori viewport può tardare: nessun timeout che lo scambi per no-fill.
                return "requested";
            } };
        } };
    }
    root.EmmaAdsProvider = Object.freeze({ bootstrap: bootstrap, adapter: adapter, pause: pause });
})(window);
