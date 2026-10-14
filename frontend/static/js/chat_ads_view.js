/* Vista comune: fuori dal messaggio, mai serializzata come contenuto della chat. */
(function (root) {
    "use strict";
    root.EmmaAdsView = Object.freeze({ create: function (options) {
        var document = options.panel.ownerDocument;
        var shell = document.createElement("section");
        shell.className = "chat-ad";
        shell.setAttribute("aria-live", "off");
        shell.setAttribute("aria-label", options.preview ? "Pubblicità di prova" : "Pubblicità");
        shell.dataset.adKind = options.preview ? "preview" : "display";
        var label = document.createElement("p");
        label.className = "chat-ad__label"; label.textContent = "Pubblicità";
        shell.appendChild(label);
        var content = document.createElement("div"); content.className = "chat-ad__content";
        shell.appendChild(content);
        if (options.anchor && options.anchor.parentNode === options.panel) options.anchor.after(shell);
        else options.panel.appendChild(shell);
        return Object.freeze({ element: shell, content: content, dispose: function () {
            var panel = options.panel, before = panel.scrollTop, height = panel.scrollHeight;
            var above = shell.getBoundingClientRect().bottom < panel.getBoundingClientRect().top;
            shell.remove();
            if (above) panel.scrollTop = Math.max(0, before - (height - panel.scrollHeight));
        } });
    } });
})(window);
