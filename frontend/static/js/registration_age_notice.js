/* Messaggi età alternativi; nessuna modifica a submit, consensi o payload. */
(function () {
    "use strict";
    const syncAll = [];
    document.querySelectorAll(".registration-age-notice[data-birth-input]").forEach(notice => {
        const input = document.getElementById(notice.dataset.birthInput);
        if (!input) return;
        const error = document.getElementById(input.id + "Error");
        const sync = () => {
            // Stessa soglia e calcolo dei validatori in app.js/register.js.
            const birth = new Date(input.value);
            const complete = !!input.value && !isNaN(birth.getTime());
            const today = new Date();
            let age = today.getFullYear() - birth.getFullYear();
            const monthDiff = today.getMonth() - birth.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
            const adult = complete && age >= 18;
            notice.hidden = !adult;
            if (error) error.hidden = !complete || adult;
        };
        input.addEventListener("input", sync);
        input.addEventListener("change", sync);
        // Il reset ripristina i valori dopo l'evento, prima della microtask.
        input.form?.addEventListener("reset", () => queueMicrotask(sync));
        syncAll.push(sync);
        sync();
    });
    window.addEventListener("pageshow", () => syncAll.forEach(sync => sync()));
}());
