(function () {
    "use strict";

    // Guardie tecniche del solo formatter: oltre soglia il testo NON è troncato
    // né respinto; resta originale senza attestazione di validità.
    const MAX_ANALYSIS_CHARACTERS = 1_000_000;
    const MAX_ANALYSIS_DEPTH = 256;
    const STRICT = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };
    // SyntaxKind è const enum TypeScript: non viene esportato nel bundle JS.
    const TOKEN = { OPEN_OBJECT: 1, CLOSE_OBJECT: 2, OPEN_ARRAY: 3, CLOSE_ARRAY: 4, EOF: 17 };

    function lexemes(parser, text) {
        const scanner = parser.createScanner(text, true);
        const values = [];
        let depth = 0;
        for (let kind = scanner.scan(); kind !== TOKEN.EOF; kind = scanner.scan()) {
            if (kind === TOKEN.OPEN_OBJECT || kind === TOKEN.OPEN_ARRAY) depth++;
            if (kind === TOKEN.CLOSE_OBJECT || kind === TOKEN.CLOSE_ARRAY) depth--;
            if (depth > MAX_ANALYSIS_DEPTH) throw new Error("analysis_depth");
            values.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
        }
        return values;
    }

    function analyse(value, prettify = true) {
        const raw = String(value == null ? "" : value);
        const result = { syntax: "not_checked", warnings: [], formatted: raw, errorOffset: null };
        const parser = window.EmmaJsonParser;
        if (!parser || raw.length > MAX_ANALYSIS_CHARACTERS) return result;
        try {
            const originalTokens = lexemes(parser, raw);
            const objects = [];
            let error = false;
            let duplicate = false;
            parser.visit(raw, {
                onObjectBegin() { objects.push(new Set()); },
                onObjectProperty(key) {
                    const keys = objects[objects.length - 1];
                    if (!keys) return;
                    if (keys.has(key)) duplicate = true;
                    keys.add(key);
                },
                onObjectEnd() { objects.pop(); },
                onError(_code, offset) {
                    if (!error) result.errorOffset = offset;
                    error = true;
                },
            }, STRICT);
            result.syntax = error ? "invalid" : "valid";
            if (error) return result;
            if (duplicate) result.warnings.push("duplicate_keys");
            if (prettify) {
                const edits = parser.format(raw, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" });
                const formatted = parser.applyEdits(raw, edits);
                const formattedTokens = lexemes(parser, formatted);
                if (originalTokens.length === formattedTokens.length && originalTokens.every((token, i) => token === formattedTokens[i])) {
                    result.formatted = formatted;
                }
            }
            return result;
        } catch (_) {
            // Un parser indisponibile/oltre capacità non autorizza repair o validità.
            return { syntax: "not_checked", warnings: [], formatted: raw, errorOffset: null };
        }
    }

    // Chat-only opt-in inferred from a direct instruction, never from history
    // or the word JSON alone. API/playground callers keep their explicit enum.
    function requestsJsonOnly(message) {
        const text = String(message == null ? "" : message).trim();
        const instruction = /^(?:(?:per favore|per cortesia|please)[,\s]+)?(?:restituisci|rispondi|fornisci|genera|produci|scrivi|return|respond|reply|output|generate|produce)\s+(?:(?:solo|soltanto|esclusivamente|unicamente)\s+(?:in\s+)?(?:formato\s+)?json|(?:only|exclusively)\s+(?:in\s+)?json|(?:in\s+)?(?:formato\s+)?json\s+(?:only|soltanto|esclusivamente))(?=$|[\s:.,;!])/iu;
        if (!instruction.test(text)) return false;
        // A request for accompanying prose is ambiguous: keep normal output.
        // Quoted data does not count as another instruction.
        const outsideStrings = text.replace(/"(?:\\.|[^"\\])*"/gsu, '""');
        return !/\b(?:spiega(?:mi|lo|la|li|le)?|commenta(?:lo|la|li|le)?|descrivi|explain|describe|comment|non\s+(?:usare|restituire|rispondere)|do\s+not)\b/iu.test(outsideStrings);
    }

    window.EmmaJsonOutput = Object.freeze({ analyse, requestsJsonOnly });
})();
