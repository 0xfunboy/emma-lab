/* Helper credenziali di sviluppo: il markup esiste solo quando il server conferma localhost. */
(function () {
    "use strict";

    function fallbackCopy(value) {
        var input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.top = "-9999px";
        document.body.appendChild(input);
        input.select();
        var copied = Boolean(document.execCommand && document.execCommand("copy"));
        input.remove();
        return copied;
    }

    function copyValue(value) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            return navigator.clipboard.writeText(value)
                .then(function () { return true; })
                .catch(function () { return fallbackCopy(value); });
        }
        return Promise.resolve(fallbackCopy(value));
    }

    document.querySelectorAll("[data-local-login]").forEach(function (component) {
        var feedback = component.querySelector("[data-local-login-feedback]");
        component.querySelectorAll("[data-local-login-copy]").forEach(function (button) {
            button.addEventListener("click", function () {
                var value = button.dataset.copyValue || "";
                var label = button.dataset.copyLabel || "Valore";
                var text = button.querySelector("span");
                button.disabled = true;
                copyValue(value)
                    .then(function (copied) {
                        if (!copied) throw new Error("copy-failed");
                        if (text) text.textContent = "Copiato";
                        if (feedback) {
                            feedback.textContent = label + " copiata negli appunti.";
                            feedback.classList.remove("local-login__feedback--error");
                            feedback.hidden = false;
                        }
                    })
                    .catch(function () {
                        if (feedback) {
                            feedback.textContent = "Copia non riuscita. Le credenziali restano precompilate nei campi.";
                            feedback.classList.add("local-login__feedback--error");
                            feedback.hidden = false;
                        }
                    })
                    .finally(function () {
                        window.setTimeout(function () {
                            button.disabled = false;
                            if (text) text.textContent = "Copia";
                        }, 1400);
                    });
            });
        });
    });
})();
