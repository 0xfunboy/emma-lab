/* Shared NDJSON protocol and technical status; never model-generated HTML. */
(function () {
    "use strict";
    // Testo scritto per l'utente: il chiamante può mostrarlo; ogni altra eccezione resta tecnica.
    function userError(message, name) {
        const error = new Error(message);
        error.userFacing = true;
        if (name) error.name = name;
        return error;
    }
    async function consume(response, onEvent) {
        if (!response.body) throw userError("Il browser non riesce a leggere la risposta di Emma.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let buffer = "", terminal = false;
        async function line(raw) {
            if (!raw.trim() || terminal) return;
            let event;
            try { event = JSON.parse(raw); }
            catch (_) { throw userError("La risposta del server non è leggibile. Il testo ricevuto è conservato."); }
            if (!event || typeof event.type !== "string") throw userError("Evento del server non valido.");
            if (event.type === "error") {
                throw userError(typeof event.message === "string" && event.message.trim() ? event.message : "Generazione interrotta dal server.");
            }
            if (event.type === "done") terminal = true;
            await onEvent(event);
        }
        try {
            while (!terminal) {
                const chunk = await reader.read();
                buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
                let offset;
                while (!terminal && (offset = buffer.indexOf("\n")) !== -1) {
                    const raw = buffer.slice(0, offset);
                    buffer = buffer.slice(offset + 1);
                    await line(raw);
                }
                if (chunk.done) {
                    if (!terminal) await line(buffer);
                    break;
                }
            }
            if (!terminal) {
                throw userError("Connessione interrotta prima della fine della generazione. Il testo ricevuto è conservato.", "PrematureEOFError");
            }
        } finally { reader.releaseLock?.(); }
    }
    function status() {
        // Diagnostica conservata nei metadati, senza avvisi sotto le risposte.
        return "";
    }
    function setStatus(article) {
        article?.querySelectorAll(".message__generation-status").forEach(node => node.remove());
    }
    window.EmmaChatStream = { consume, status, setStatus };
}());
