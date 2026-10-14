(function () {
    "use strict";

    const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
    const LANGUAGE = /^[a-z0-9_+#.-]{1,24}$/i;
    const CODE_FENCE_LANGUAGES = new Set([
        "bash", "c", "c#", "c++", "cpp", "cs", "csharp", "css", "dockerfile", "go", "html", "java",
        "javascript", "js", "json", "jsx", "kotlin", "markdown", "md", "php", "plaintext", "powershell",
        "py", "python", "r", "ruby", "rust", "scss", "sh", "shell", "sql", "swift", "text", "ts", "tsx",
        "typescript", "xml", "yaml", "yml",
    ]);
    const FLATTENED_FENCE = /^([a-z][\w+#-]*)\s+([\s\S]+)$/i;

    /* Markdown attivo. La modalità testo dell'iter. 99 (a capo su `###`, solo
       grassetto) resta disponibile per singola chiamata con `markdown: false`. */
    const MARKDOWN_RESPONSES = true;

    /* Emma-6 scrive su una riga sola: il tokenizer cancella gli a capo. Solo per la
       visualizzazione si ricostruiscono le righe di titoli, elenchi, tabelle e separatori
       scritti a metà riga; il codice e il raw non cambiano. */
    const TITLE_MAX_WORDS = 12;
    const SENTENCE_STARTERS = new Set([
        "il", "lo", "la", "l", "i", "gli", "le", "un", "uno", "una", "è", "ecco", "questo",
        "questa", "questi", "queste", "quello", "quella", "per", "in", "nel", "nella", "con",
        "se", "non", "ci", "si", "puoi", "posso", "sono", "ho", "hai", "ha", "esiste",
        "esistono", "ogni", "inoltre", "quindi", "tuttavia", "anche", "come", "dove", "quando",
        "perché", "mentre", "qui", "oggi",
    ]);
    const LIST_AFTER = /[.:!?;)\]…]$/;
    const TABLE_DELIMITER = /\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+/;
    const CODE_SLOT = /(\d+)/g;

    /* Emma separa le parti della risposta con `###` (a volte più lungo): nel testo è un a capo. */
    const HASH_BREAK = /[ \t]*#{3,}[ \t]*/;

    /* Grassetto della modalità testo: contenuto non vuoto che non inizia né finisce con uno spazio. */
    const BOLD = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;

    function normalizeNewlines(value) {
        return String(value == null ? "" : value).replace(/\r\n?/g, "\n");
    }

    function fenceMarker(line) {
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        return match ? { character: match[1][0], length: match[1].length, tail: match[2] } : null;
    }

    function closesFence(marker, openFence) {
        return Boolean(marker)
            && marker.character === openFence.character
            && marker.length >= openFence.length
            && !marker.tail.trim();
    }

    /* Corpo di un recinto schiacciato: `python def f()…` dichiara il linguaggio in testa. */
    function flattenedCode(body) {
        const flattened = FLATTENED_FENCE.exec(body);
        const known = flattened && CODE_FENCE_LANGUAGES.has(flattened[1].toLowerCase());
        return {
            language: known ? flattened[1] : "",
            code: known ? flattened[2] : body,
            flattened: Boolean(flattened),
        };
    }

    /* Recinto schiacciato su una riga (dev fix 19): chiuso sulla stessa riga, oppure ultima riga
       ancora aperta. Ritorna linguaggio, codice e se il recinto si chiude; altrimenti null. */
    function flattenedFence(marker, isLastLine) {
        const end = new RegExp(marker.character + "{" + marker.length + ",}\\s*$").exec(marker.tail);
        const body = (end ? marker.tail.slice(0, end.index) : marker.tail).trim();
        const parsed = flattenedCode(body);
        if (!((end || isLastLine) && body && (end || parsed.flattened || /[<>]/.test(body)))) return null;
        return { language: parsed.language, code: parsed.code, closed: Boolean(end) };
    }

    function inlineFenceParts(line) {
        // Heading markers as in reflowHeadings: `#`+space or `##` at the start, `##` mid-line.
        const match = /^([^`~"\\\n]+:[ \t]*)(`{3,}|~{3,})([a-z][\w+#-]*)(?=[ \t]|$)(.*)$/i.exec(line)
            || /^((?:[ \t]{0,3}(?:#[ \t]+|#{2,6}[ \t]*)|[^`~"\\\n]*[ \t]#{2,6}[ \t]*)[^\s`~"\\#](?:[^`~"\\\n#]*?[^\s`~"\\#])?[ \t]+)(`{3,}|~{3,})([a-z][\w+#-]*)(?=[ \t]|$)(.*)$/i.exec(line);
        if (!match || !CODE_FENCE_LANGUAGES.has(match[3].toLowerCase())) return null;
        // Italian elisions are prose, but quoted examples are not new blocks.
        return match[1].replace(/\p{L}'(?=\p{L})/gu, "").includes("'") ? null : match;
    }

    // Presentation-only repair: an introduction ending in ':' or a heading title
    // may share a line with an explicit, labelled fence. Never rewrite inside an
    // existing fence, infer missing delimiters, or change the caller's raw response.
    function separateInlineFences(value) {
        const lines = normalizeNewlines(value).split("\n");
        const result = [];
        let openFence = null;
        for (let line of lines) {
            const marker = fenceMarker(line);
            if (openFence) {
                result.push(line);
                if (closesFence(marker, openFence)) openFence = null;
                continue;
            }
            if (marker) {
                result.push(line);
                if (!new RegExp(marker.character + "{" + marker.length + ",}").test(marker.tail)) openFence = marker;
                continue;
            }
            while (line) {
                const inline = inlineFenceParts(line);
                if (!inline) break;
                const [, intro, delimiter, language, body] = inline;
                const closingPattern = new RegExp(delimiter[0] + "{" + delimiter.length + ",}");
                const close = closingPattern.exec(body);
                const after = close ? body.slice(close.index + close[0].length) : "";
                // Quoted delimiters and multiple possible endings are ambiguous.
                // Do not truncate the code at the first run inside a literal.
                if (close && ((!/^(?:[ \t]|$)/.test(after))
                    || (closingPattern.test(after) && !inlineFenceParts(after)))) break;
                result.push(intro, delimiter + language);
                if (!close) {
                    if (body.trim()) result.push(body.trim());
                    openFence = { character: delimiter[0], length: delimiter.length };
                    line = "";
                    break;
                }
                result.push(body.slice(0, close.index).trim(), delimiter);
                line = after;
            }
            if (line || !openFence) result.push(line);
        }
        return result.join("\n");
    }

    /* Il codice inline (sequenza di backtick chiusa dalla stessa lunghezza, altrimenti fino a
       fine riga) diventa un segnaposto: nessuna regola di ricostruzione lo tocca. */
    function maskInlineCode(text) {
        const runs = [...text.matchAll(/`+/g)].map((match) => ({
            start: match.index, end: match.index + match[0].length,
        }));
        const closing = new Array(runs.length).fill(-1);
        const lastByLength = new Map();
        for (let index = runs.length - 1; index >= 0; index -= 1) {
            const length = runs[index].end - runs[index].start;
            if (lastByLength.has(length)) closing[index] = lastByLength.get(length);
            lastByLength.set(length, index);
        }
        const spans = [];
        let masked = "";
        let cursor = 0;
        for (let index = 0; index < runs.length; index += 1) {
            if (runs[index].start < cursor) continue;
            const end = closing[index] >= 0 ? runs[closing[index]].end : text.length;
            masked += text.slice(cursor, runs[index].start) + "" + spans.length + "";
            spans.push(text.slice(runs[index].start, end));
            cursor = end;
        }
        masked += text.slice(cursor);
        return { text: masked, restore: (value) => value.replace(CODE_SLOT, (_, slot) => spans[Number(slot)]) };
    }

    /* Tabella su una riga: serve la riga `| --- |`. L'intestazione la precede, le righe
       successive si separano a ogni `| |`; il testo attorno diventa paragrafo. */
    function reflowTable(line) {
        const delimiter = TABLE_DELIMITER.exec(line);
        if (!delimiter) return line;
        const columns = delimiter[0].split("|").length - 2;
        let start = -1;
        let pipes = 0;
        for (let index = delimiter.index - 1; index >= 0 && pipes < columns + 1; index -= 1) {
            if (line[index] === "|") {
                pipes += 1;
                start = index;
            }
        }
        const header = start >= 0 ? line.slice(start, delimiter.index).trim() : "";
        if (pipes < 2 || !header.endsWith("|")) return line;
        const tail = line.slice(delimiter.index + delimiter[0].length);
        const lastPipe = tail.lastIndexOf("|");
        const rows = lastPipe >= 0 ? tail.slice(0, lastPipe + 1).trim().split(/(?<=\|)[ \t]+(?=\|)/) : [];
        const after = tail.slice(lastPipe + 1).trim();
        const table = [header, delimiter[0], ...rows.filter(Boolean)].join("\n");
        return [line.slice(0, start).trim(), table, after && reflowTable(after)].filter(Boolean).join("\n\n");
    }

    /* Parola che apre una frase dopo il titolo (`## Colore Il colore di…`), seguita da almeno
       tre parole: articoli e connettivi italiani, perché Emma risponde in italiano. */
    function opensSentence(word) {
        if (!/^\p{Lu}/u.test(word)) return false;
        return SENTENCE_STARTERS.has(word.toLowerCase().replace(/['’].*$/u, "").replace(/[^\p{L}]+$/u, ""));
    }

    function sentenceStart(content) {
        const words = [...content.matchAll(/\S+/g)];
        for (let index = 1; index < words.length - 3; index += 1) {
            if (opensSentence(words[index][0])) return words[index].index;
        }
        return -1;
    }

    /* Fine del titolo: grassetto, voce di elenco, tabella, separatore, inizio di frase o
       domanda. Se prima arriva un punto, o il titolo supera TITLE_MAX_WORDS parole, il
       marcatore separava prosa (stile `###` storico) e non c'è titolo. */
    function headingTitle(content) {
        const bold = /^\*\*(?=\S)[^*]*?\S\*\*/.exec(content);
        if (bold) return { title: bold[0], rest: content.slice(bold[0].length).trim() };
        if (content.startsWith("")) return null;
        let end = content.length;
        const boundary = (index) => { if (index >= 0 && index < end) end = index; };
        for (const pattern of [/[ \t]\*\*(?=\S)/, /[ \t]1[.)][ \t]+(?=\S)/, /[ \t]\|/,
            /[ \t](?:-{3,}|\*{3,}|_{3,})(?=[ \t]|$)/]) {
            boundary(pattern.exec(content)?.index ?? -1);
        }
        for (const dash of content.matchAll(/[ \t]-[ \t]+(\S+)/g)) {
            if (dash[1].startsWith("**") || opensSentence(dash[1])) {
                boundary(dash.index);
                break;
            }
        }
        const sentence = /[.!?…](?=[ \t]+\S)/.exec(content);
        if (sentence) boundary(sentence.index + 1);
        boundary(sentenceStart(content));
        const title = content.slice(0, end).trim();
        if (!title || /[.!…]$/.test(title) || title.split(/\s+/).length > TITLE_MAX_WORDS) return null;
        return { title, rest: content.slice(end).trim() };
    }

    /* Titoli: `#`–`######` a inizio riga (con spazio, o `##`+ attaccati), `##`–`######` a metà
       riga. Un titolo già da solo sulla sua riga resta com'è. */
    function reflowHeadings(line) {
        if (/^[ \t]*\|/.test(line)) return line;
        const markers = [];
        for (const match of line.matchAll(/(^[ \t]{0,3}|[ \t]+)(#{1,6})([ \t]*)(?=[^\s#])/g)) {
            const atStart = match.index === 0;
            if ((atStart && (match[3] || match[2].length >= 2)) || (!atStart && match[2].length >= 2)) {
                markers.push({ start: match.index, hashes: match[2], content: match.index + match[0].length });
            }
        }
        if (!markers.length) return line;
        const blocks = [line.slice(0, markers[0].start).trim()];
        let untouched = markers.length === 1 && markers[0].start === 0;
        markers.forEach((marker, index) => {
            const stop = index + 1 < markers.length ? markers[index + 1].start : line.length;
            const content = line.slice(marker.content, stop).trim();
            const parsed = headingTitle(content);
            if (!parsed || parsed.rest) untouched = false;
            if (!parsed) blocks.push(content);
            else blocks.push(marker.hashes + " " + parsed.title, parsed.rest);
        });
        return untouched ? line : blocks.filter(Boolean).join("\n\n");
    }

    /* Voci di elenco a metà riga: ` - `, ` * `, ` + ` dopo punteggiatura di fine frase, due
       punti o parentesi; ` - **` apre una voce anche senza. Numeri: `1.` dopo punteggiatura,
       oppure il numero successivo alla voce precedente. Il trattino nella prosa resta testo. */
    function reflowLists(line) {
        const body = line.trimStart();
        if (!body || /^(?:\||#{1,6}[ \t]|)/.test(body)) return line;
        const first = /^(?:[-*+]|(\d{1,2})[.)])[ \t]+\S/.exec(body);
        let context = first ? (first[1] ? Number(first[1]) : "bullet") : null;
        let output = "";
        let cursor = 0;
        for (const match of body.matchAll(/[ \t]+([-*+]|\d{1,2}[.)])[ \t]+(?=\S)/g)) {
            const marker = match[1];
            const punctuated = LIST_AFTER.test(body.slice(0, match.index));
            const number = /^\d/.test(marker) ? parseInt(marker, 10) : null;
            const item = number !== null
                ? (typeof context === "number" && number === context + 1) || (punctuated && number === 1)
                : punctuated || (marker === "-" && body.startsWith("**", match.index + match[0].length));
            if (!item) continue;
            output += body.slice(cursor, match.index) + (context === null ? "\n\n" : "\n") + marker + " ";
            cursor = match.index + match[0].length;
            context = number === null ? "bullet" : number;
        }
        return cursor ? line.slice(0, line.length - body.length) + output + body.slice(cursor) : line;
    }

    function reflowRules(line) {
        if (/^[ \t]*\|/.test(line)) return line;
        return line.replace(/(\S)[ \t]+(-{3,}|\*{3,}|_{3,})(?=[ \t]|$)[ \t]*/g, "$1\n\n$2\n\n");
    }

    function reflowFlattenedLine(line) {
        if (/^(?: {4}|\t)/.test(line) || !/[#|*+_-]|\d[.)]/.test(line)) return line;
        const masked = maskInlineCode(line);
        const reflowed = reflowTable(masked.text).split("\n").map(reflowHeadings).join("\n")
            .split("\n").map((part) => reflowRules(reflowLists(part))).join("\n");
        return masked.restore(reflowed);
    }

    /* Ricostruzione fence-aware: le righe dentro un recinto restano intatte. */
    function reflowFlattenedMarkdown(value) {
        let openFence = null;
        return value.split("\n").map((line) => {
            const marker = fenceMarker(line);
            if (openFence) {
                if (closesFence(marker, openFence)) openFence = null;
                return line;
            }
            if (marker) {
                if (!new RegExp(marker.character + "{" + marker.length + ",}").test(marker.tail)) openFence = marker;
                return line;
            }
            return reflowFlattenedLine(line);
        }).join("\n");
    }

    function formatThinkingBlocks(value) {
        if (!value || typeof value !== "string") return value;
        // Closed <think>...</think>
        let res = value.replace(/<think>([\s\S]*?)<\/think>/gi, (match, p1) => {
            const clean = p1.trim();
            if (!clean) return "";
            return "\n\n> 🧠 **Ragionamento:**\n> " + clean.replace(/\n/g, "\n> ") + "\n\n";
        });
        // Unclosed <think> during streaming
        res = res.replace(/<think>([\s\S]*)$/gi, (match, p1) => {
            const clean = p1.trim();
            return "\n\n> 🧠 **Ragionamento in corso...**\n> " + clean.replace(/\n/g, "\n> ");
        });
        return res;
    }

    /* Compatibilità iter. 89: Emma può emettere `###Titolo`. La normalizzazione
       è deliberatamente stretta e fence-aware: `#hashtag` e il codice restano raw.
       Prima ricostruisce le righe dei blocchi scritti a metà riga. */
    function normalizeEmmaMarkdown(value) {
        const lines = reflowFlattenedMarkdown(separateInlineFences(formatThinkingBlocks(value))).split("\n");
        let openFence = null;
        return lines.map((line, index) => {
            const marker = fenceMarker(line);
            if (openFence) {
                if (closesFence(marker, openFence)) openFence = null;
                return line;
            }
            if (marker) {
                // Preserve dev fix 19: an explicit fence may arrive flattened.
                // Only expand same-line closed fences or the final unclosed line;
                // ordinary multiline info strings and nested code stay untouched.
                const flat = flattenedFence(marker, index === lines.length - 1);
                if (flat) {
                    const delimiter = marker.character.repeat(marker.length);
                    openFence = flat.closed ? null : marker;
                    return delimiter + flat.language + "\n" + flat.code + (flat.closed ? "\n" + delimiter : "");
                }
                openFence = marker;
                return line;
            }

            const attached = /^( {0,3})(#{2,})(?![\s#]|$)(.*)$/.exec(line);
            if (attached) {
                return attached[1] + "#".repeat(Math.min(attached[2].length, 6)) + " " + attached[3];
            }
            const tooMany = /^( {0,3})(#{7,})\s*(.*)$/.exec(line);
            if (tooMany) return tooMany[1] + "###### " + tooMany[3];
            return line;
        }).join("\n");
    }

    /* Modalità testo: la risposta si divide in testo e blocchi di codice recintati. Fuori dal
       codice `###` è un a capo, e come un a capo vero può aprire un recinto: Emma-6 scrive su una
       riga sola, quindi un recinto può anche chiudersi a metà riga. Nel codice `###` resta com'è.
       `source` conserva il testo di presentazione del recinto per l'anteprima;
       il raw integrale resta separato e invariato, anche per i fence inline. */
    function splitPlainText(value) {
        const pending = separateInlineFences(value).split("\n");
        const segments = [];
        let text = [];
        let fence = null;
        const flushText = () => {
            if (text.length) segments.push({ type: "text", text: text.join("\n") });
            text = [];
        };
        const pushCode = (language, content, source) => {
            flushText();
            segments.push({ type: "code", language, content, source });
        };
        while (pending.length) {
            const line = pending.shift();
            const marker = fenceMarker(line);
            if (fence) {
                fence.source.push(line);
                if (closesFence(marker, fence.marker)) {
                    pushCode(fence.language, fence.code.join("\n"), fence.source.join("\n"));
                    fence = null;
                } else fence.code.push(line);
                continue;
            }
            if (marker) {
                const close = new RegExp(marker.character + "{" + marker.length + ",}").exec(marker.tail);
                const body = (close ? marker.tail.slice(0, close.index) : marker.tail).trim();
                const parsed = flattenedCode(body);
                if (close && body) {
                    const after = marker.tail.slice(close.index + close[0].length);
                    pushCode(parsed.language, parsed.code, line.slice(0, line.length - after.length));
                    if (after.trim()) pending.unshift(after);
                    continue;
                }
                if (!pending.length && body && (parsed.flattened || /[<>]/.test(body))) {
                    pushCode(parsed.language, parsed.code, line);
                    continue;
                }
                flushText();
                fence = { marker, language: sanitizeLanguage(marker.tail), code: [], source: [line] };
                continue;
            }
            const hashes = HASH_BREAK.exec(line);
            if (hashes) {
                text.push(line.slice(0, hashes.index));
                pending.unshift(line.slice(hashes.index + hashes[0].length));
                continue;
            }
            text.push(line);
        }
        if (fence) pushCode(fence.language, fence.code.join("\n"), fence.source.join("\n"));
        flushText();
        return segments;
    }

    /* Anteprima dello stream in modalità testo: gli stessi a capo della resa finale, codice intatto. */
    function plainPreview(value) {
        const raw = String(value);
        const segments = splitPlainText(raw);
        // Explicit fences retain priority; inferred regions never swallow adjacent prose.
        if (!segments.some(segment => segment.type === "code")) {
            const inferred = detectUnfencedCode(raw);
            if (inferred) return inferred.map(segment => segment.type === "code"
                ? raw.slice(segment.start, segment.end)
                : raw.slice(segment.start, segment.end).replace(/[ \t]*#{3,}[ \t]*/g, "\n")).join("");
        }
        return segments
            .map((segment) => (segment.type === "text" ? segment.text : segment.source))
            .join("\n");
    }

    function createParser() {
        if (typeof window.markdownit !== "function") return null;
        return window.markdownit({
            html: false,
            breaks: true,
            linkify: false,
            typographer: false,
        });
    }

    let parser = createParser();

    function parserInstance() {
        if (!parser && typeof window.markdownit === "function") parser = createParser();
        return parser;
    }

    function tokenAttribute(token, name) {
        if (!token) return null;
        if (typeof token.attrGet === "function") return token.attrGet(name);
        const found = Array.isArray(token.attrs)
            ? token.attrs.find((attribute) => attribute[0] === name)
            : null;
        return found ? found[1] : null;
    }

    function safeLinkHref(value) {
        const href = String(value == null ? "" : value).trim();
        return SAFE_LINK.test(href) ? href : "";
    }

    function sanitizeLanguage(value) {
        const candidate = String(value == null ? "" : value).trim().split(/\s+/, 1)[0] || "";
        return LANGUAGE.test(candidate) ? candidate : "";
    }

    function inferCodeLanguage(value) {
        const text = value.trim();
        // Firme ancorate: una keyword nella prosa non basta. Nessuna riscrittura del codice.
        const htmlTags = text.match(/<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/gi) || [];
        if (/^(?:<!doctype\s+html\b|<(?:html|head|body)[\s>])/i.test(text) && htmlTags.length >= 2) return "html";
        if (/^<(div|section|main|article|header|footer|nav|form|ul|ol|table)\b/i.test(text)
            && htmlTags.length >= 3 && /<\/[a-z][\w:-]*>/i.test(text)) return "html";
        const brace = text.indexOf("{");
        if (brace >= 0 && isCssSelector(text.slice(0, brace))
            && /^\s*(?:--[\w-]+|[a-z-]+)\s*:/i.test(text.slice(brace + 1))) return "css";
        if (/^(?:(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:|class\s+\w+\s*(?:\([^)]*\))?\s*:|from\s+[\w.]+\s+import\s+\w+|import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*\n|$)|print\s*\(|if\s+[^:\n]+:\s*(?:\n|pass\b|print\s*\(|return\b))/.test(text)) return "python";
        if (/^(?:(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+[\w$]+\s*=|(?:export\s+)?(?:async\s+)?function\s+[\w$]*\s*\(|class\s+[\w$]+(?:\s+extends\s+[\w$.]+)?\s*\{|import\s+.+?\s+from\s+['"]|(?:console|document)\.[\w.]+\s*\()/s.test(text)
            && /[;{}]|=>|\([^)]*\)|=\s*['"`\d[]/.test(text)) return "javascript";
        if (/^(?:SELECT\s+[\w*"`[(][^;:]*\bFROM\s+[\w"`[]|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\s+\w+|(?:CREATE|ALTER|DROP)\s+TABLE\s+\w+)/i.test(text)) return "sql";
        if (/^(?:curl|npm|pnpm|yarn|python3?|pip|git)\s+(?:--?[\w-]+\b|(?:install|run|status|diff|log|clone|add|commit|push|pull|fetch)\b)/.test(text)) return "bash";
        return "";
    }

    // A small, deliberate selector subset: arbitrary words are not descendant selectors.
    const HTML_TAG_NAMES = new Set(("html head body main section article header footer nav div span p a h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tr th td form input button label textarea select option img svg pre code blockquote strong em small aside details summary video canvas").split(" "));

    function isCssSelector(value) {
        const selectors = value.trim().split(/\s*[,>+~]\s*|\s+/);
        return selectors.length > 0 && selectors.every(selector => {
            const match = /^(\*|[a-z][\w-]*)?((?:[.#][\w-]+|:{1,2}[\w-]+(?:\([\w+-]+\))?)*)$/i.exec(selector);
            return Boolean(match && (match[1] || match[2])
                && (!match[1] || match[1] === "*" || HTML_TAG_NAMES.has(match[1].toLowerCase())));
        });
    }

    // Lexical boundaries, not a formatter or an evaluator. Offsets always address the raw.
    // Strings/comments are masked only for classification; returned content is never masked.
    function* codeUnits(text, language) {
        const mask = text.split("");
        const stack = [];
        let start = 0, quote = "", blockComment = false, lineComment = false;
        let previous = "";
        const takeUnit = end => {
            const unit = { start, end, mask: mask.slice(start, end).join("") };
            start = end;
            return unit;
        };
        for (let i = 0; i < text.length; i++) {
            const ch = text[i], next = text[i + 1];
            if (lineComment) {
                if (ch !== "\n") { mask[i] = " "; continue; }
                lineComment = false;
            }
            if (blockComment) {
                mask[i] = /[\r\n]/.test(ch) ? ch : " ";
                if (ch === "*" && next === "/") { mask[++i] = " "; blockComment = false; }
                continue;
            }
            if (quote) {
                mask[i] = /[\r\n]/.test(ch) ? ch : " ";
                if (ch === "\\" && next) { mask[++i] = " "; continue; }
                if (text.startsWith(quote, i)) {
                    for (let j = 1; j < quote.length; j++) mask[i + j] = " ";
                    i += quote.length - 1; quote = "";
                }
                continue;
            }
            if ((language === "javascript" && ch === "/" && next === "/")
                || (language === "sql" && ch === "-" && next === "-")
                || (["python", "bash"].includes(language) && ch === "#")) {
                lineComment = true; mask[i] = " "; continue;
            }
            if (["css", "javascript", "sql"].includes(language) && ch === "/" && next === "*") {
                blockComment = true; mask[i] = " "; mask[++i] = " "; continue;
            }
            if (ch === '"' || ch === "'" || (language === "javascript" && ch === "`")) {
                quote = language === "python" && text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
                mask[i] = "0";
                for (let j = 1; j < quote.length; j++) mask[i + j] = " ";
                i += quote.length - 1; previous = "0"; continue;
            }
            if ("({[".includes(ch)) stack.push(ch);
            if (")}]".includes(ch)) {
                if (stack.pop() !== ({ ")": "(", "}": "{", "]": "[" })[ch]) {
                    yield { ...takeUnit(i + 1), malformed: true };
                    return;
                }
            }
            if (!stack.length && ((ch === ";" && language !== "bash")
                || (ch === "}" && ["css", "javascript"].includes(language))
                || (ch === "\n" && !/[=,+\\]/.test(previous)))) yield takeUnit(i + 1);
            if (!/\s/.test(ch)) previous = ch;
        }
        if (start < text.length) yield takeUnit(text.length);
    }

    function plausibleWords(mask, language) {
        // Two identifiers separated only by whitespace require a supported syntactic keyword.
        // This intentionally rejects ambiguous prose, including text after an initial signature.
        const words = language === "sql"
            ? /^(?:select|distinct|as|from|where|join|left|right|inner|outer|on|and|or|not|is|null|group|order|by|asc|desc|limit|offset|insert|into|values|update|set|delete|create|alter|drop|table|primary|key|int|integer|text|varchar|if|exists)$/i
            : /^(?:const|let|var|function|class|extends|return|new|throw|import|export|default|async|await|yield|typeof|void|delete|instanceof|in|of|else|case|def|from|as|for|if|elif|while|pass|print|raise|with|and|or|not|is|lambda)$/;
        let previous = null;
        for (const match of mask.matchAll(/[a-zA-Z_$][\w$]*/g)) {
            if (previous && /^[ \t]+$/.test(mask.slice(previous.index + previous[0].length, match.index))
                && !words.test(previous[0]) && !words.test(match[0])) return false;
            previous = match;
        }
        // Non-ASCII prose outside literals is ambiguous, not evidence of code.
        return !/[^\x00-\x7f]/.test(mask);
    }

    function validCodeUnit(mask, language) {
        const text = mask.trim();
        if (!text || /^[;)}\]]+$/.test(text)) return true;
        if (language === "css") {
            const brace = text.indexOf("{");
            if (brace < 0 || !isCssSelector(text.slice(0, brace))) return false;
            const body = text.slice(brace + 1).replace(/}\s*$/, "");
            return body.split(";").every(part => !part.trim() || /^\s*(?:--[\w-]+|[a-z][\w-]*)\s*:[^{}]*$/i.test(part));
        }
        if (language === "bash") {
            const args = text.replace(/\\\r?\n/g, " ").split(/\s+/);
            if (!/^(?:curl|npm|pnpm|yarn|python3?|pip|git)$/.test(args.shift())) return false;
            return args.every((arg, i) => /^(?:--?[\w-]+(?:=.*)?|0|\d+|install|run|status|diff|log|clone|add|commit|push|pull|fetch)$/.test(arg)
                || /^(?:https?:\/\/|[./])\S+$/.test(arg) || (i > 0 && /^--?[\w-]+$/.test(args[i - 1])));
        }
        if (!plausibleWords(text, language)) return false;
        if (language === "sql") return /^(?:SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|RIGHT|INNER|ON|GROUP|ORDER|LIMIT|OFFSET|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|VALUES|SET)\b/i.test(text);
        if (language === "python") return /^(?:(?:async\s+)?(?:def|class|from|import|if|elif|else|for|while|return|pass|raise|with)\b|[\w.]+\s*(?:\(|(?:\+|-|\*|\/)?=))/.test(text);
        return /^(?:(?:export\s+(?:default\s+)?)?(?:const|let|var|function|class|import|async)\b|(?:return|throw|if|else|for|while|try|catch|finally)\b|[\w$.]+\s*(?:\(|(?:\+|-|\*|\/)?=))/.test(text);
    }

    function htmlCodeEnd(text) {
        const stack = [];
        const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
        let i = 0, end = 0;
        while (i < text.length) {
            if (/\s/.test(text[i])) { i++; continue; }
            if (text.startsWith("<!--", i)) {
                const close = text.indexOf("-->", i + 4);
                if (close < 0) return stack.length ? text.length : end;
                i = close + 3; if (!stack.length) end = i; continue;
            }
            if (text[i] !== "<") {
                if (!stack.length) break;
                const next = text.indexOf("<", i); i = next < 0 ? text.length : next; continue;
            }
            let j = i + 1, quote = "";
            for (; j < text.length; j++) {
                if (quote) { if (text[j] === quote) quote = ""; }
                else if (text[j] === '"' || text[j] === "'") quote = text[j];
                else if (text[j] === ">") break;
            }
            if (j === text.length) return stack.length ? text.length : end;
            const tag = text.slice(i, j + 1);
            if (/^<!doctype\s+html\s*>$/i.test(tag)) { i = j + 1; end = i; continue; }
            const match = /^<(\/)?([a-z][\w:-]*)(?=[\s/>])/i.exec(tag);
            if (!match) return 0;
            if (match[1] && !/^<\/[a-z][\w:-]*\s*>$/i.test(tag)) return 0;
            const name = match[2].toLowerCase();
            if (match[1]) { if (stack.pop() !== name) return 0; }
            else if (!voidTags.has(name) && !/\/>$/.test(tag)) stack.push(name);
            i = j + 1;
            if (!match[1] && ["script", "style"].includes(name)) {
                // Raw-text elements: '<' and braces in JS/CSS are not HTML boundaries.
                const closing = new RegExp("</" + name + "\\s*>", "ig"); closing.lastIndex = i;
                const found = closing.exec(text);
                if (!found) return text.length;
                i = found.index + found[0].length; stack.pop();
            }
            if (!stack.length) end = i;
        }
        if (stack.length) return text.length; // Clearly started, incomplete HTML stays readable.
        if (text.slice(end).trim() && !/[\r\n]/.test(text.slice(end, i))) return 0;
        return text.slice(end).trim() ? end : text.length;
    }

    function inferredCodeEnd(text, language) {
        if (language === "html") return htmlCodeEnd(text);
        const units = codeUnits(text, language);
        let end = 0;
        const baseIndent = /^[ \t]*/.exec(text)[0].length;
        for (const unit of units) {
            if (!validCodeUnit(unit.mask, language)) {
                // A newline is a boundary; adjacent same-line prose is ambiguous.
                const gap = text.slice(end, unit.start) + /^\s*/.exec(text.slice(unit.start, unit.end))[0];
                if (language === "python" && /^[ \t]*/.exec(unit.mask)[0].length > baseIndent) return 0;
                return end && /[\r\n]/.test(gap) ? end : 0;
            }
            // Malformed code stays conservative; delimiters in later prose cannot
            // invalidate code already separated at the first non-code unit.
            if (unit.malformed) return 0;
            if (text.slice(unit.start, unit.end).trim()) end = unit.end - /\s*$/.exec(text.slice(unit.start, unit.end))[0].length;
        }
        return end ? text.length : 0;
    }

    function detectUnfencedCode(raw) {
        let content = raw;
        let intro = "";
        // Only an explicit, short introduction; never scan arbitrary prose for a keyword.
        const prefix = /^(?:Ecco|Qui|Di seguito|Here(?:'s| is))[^\n:]{0,160}\b(?:codice|esempio|code|example|script|HTML|CSS|JavaScript|Python|SQL)\b[^\n:]{0,80}:[ \t]*(?:\r?\n(?:[ \t]*\r?\n)*)?/i.exec(raw);
        if (prefix) {
            intro = prefix[0];
            content = raw.slice(intro.length);
        }
        const language = inferCodeLanguage(content);
        if (!language) return null;
        const end = inferredCodeEnd(content, language);
        if (!end) return null;
        const segments = [];
        if (intro) segments.push({ type: "text", start: 0, end: intro.length });
        segments.push({ type: "code", start: intro.length, end: intro.length + end,
            content: content.slice(0, end), language, inferred: true });
        if (end < content.length) segments.push({ type: "text", start: intro.length + end, end: raw.length });
        return segments;
    }

    function appendText(parent, value) {
        parent.appendChild(document.createTextNode(String(value == null ? "" : value)));
    }

    /* Testo della modalità testo: l'unica formattazione è il grassetto, sempre via DOM. */
    function appendPlainText(parent, text) {
        let last = 0;
        for (const match of text.matchAll(BOLD)) {
            if (match.index > last) appendText(parent, text.slice(last, match.index));
            const strong = document.createElement("strong");
            strong.textContent = match[1];
            parent.appendChild(strong);
            last = match.index + match[0].length;
        }
        if (last < text.length) appendText(parent, text.slice(last));
    }

    function appendInlineTokens(parent, tokens) {
        const parents = [parent];
        const current = () => parents[parents.length - 1];

        (tokens || []).forEach((token) => {
            if (["text", "text_special", "html_inline"].includes(token.type)) {
                appendText(current(), token.content);
                return;
            }
            if (["softbreak", "hardbreak"].includes(token.type)) {
                current().appendChild(document.createElement("br"));
                return;
            }
            if (token.type === "code_inline") {
                const code = document.createElement("code");
                code.className = "md-code";
                code.textContent = token.content;
                current().appendChild(code);
                return;
            }
            if (token.type === "image") {
                appendText(current(), token.content || tokenAttribute(token, "alt") || "");
                return;
            }

            const elements = {
                strong_open: ["strong", ""],
                em_open: ["em", ""],
                s_open: ["del", ""],
            };
            if (elements[token.type]) {
                const [tagName, className] = elements[token.type];
                const node = document.createElement(tagName);
                if (className) node.className = className;
                current().appendChild(node);
                parents.push(node);
                return;
            }
            if (["strong_close", "em_close", "s_close"].includes(token.type)) {
                if (parents.length > 1) parents.pop();
                return;
            }
            if (token.type === "link_open") {
                const href = safeLinkHref(tokenAttribute(token, "href"));
                if (!href) {
                    parents.push(current());
                    return;
                }
                const link = document.createElement("a");
                link.className = "md-link";
                link.href = href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                current().appendChild(link);
                parents.push(link);
                return;
            }
            if (token.type === "link_close") {
                if (parents.length > 1) parents.pop();
                return;
            }

            if (token.nesting === 1) parents.push(current());
            else if (token.nesting === -1 && parents.length > 1) parents.pop();
            else if (token.content) appendText(current(), token.content);
        });
    }

    function displayedCode(segment, prettify, exactJson) {
        const raw = exactJson ? String(segment.content == null ? "" : segment.content) : String(segment.content == null ? "" : segment.content).replace(/^\n/, "");
        if (!prettify || String(segment.language).toLowerCase() !== "json") return raw;
        return window.EmmaJsonOutput ? window.EmmaJsonOutput.analyse(raw).formatted : raw;
    }

    function createCodeBlock(segment, options) {
        const preserveRaw = options.exactJson || segment.inferred;
        const raw = preserveRaw ? String(segment.content == null ? "" : segment.content) : String(segment.content == null ? "" : segment.content).replace(/^\n/, "");
        const shown = displayedCode(segment, options.prettify !== false, preserveRaw);
        const figure = document.createElement("figure");
        figure.className = "code-block" + (segment.inferred ? " code-block--inferred" : "");
        const head = document.createElement("figcaption");
        head.className = "code-block__head";
        const label = document.createElement("span");
        label.className = "code-block__lang";
        label.textContent = segment.language || "Codice";
        const copyShown = document.createElement("button");
        copyShown.type = "button";
        copyShown.className = "code-block__copy";
        copyShown.textContent = shown === raw ? "Copia" : "Copia formattato";
        copyShown.setAttribute("aria-label", shown === raw ? "Copia codice negli appunti" : "Copia codice formattato negli appunti");
        copyShown.addEventListener("click", async () => {
            try {
                await options.copyText(preserveRaw ? shown : shown.replace(/\n$/, ""));
                copyShown.textContent = "Copiato";
            } catch (_) { copyShown.textContent = "Errore"; }
            window.setTimeout(() => { copyShown.textContent = shown === raw ? "Copia" : "Copia formattato"; }, 1400);
        });
        head.append(label, copyShown);
        if (shown !== raw) {
            const copyRaw = document.createElement("button");
            copyRaw.type = "button";
            copyRaw.className = "code-block__copy";
            copyRaw.textContent = "Copia originale";
            copyRaw.setAttribute("aria-label", "Copia codice originale negli appunti");
            copyRaw.addEventListener("click", async () => {
                try {
                    await options.copyText(options.exactJson ? raw : raw.replace(/\n$/, ""));
                    copyRaw.textContent = "Copiato";
                } catch (_) { copyRaw.textContent = "Errore"; }
                window.setTimeout(() => { copyRaw.textContent = "Copia originale"; }, 1400);
            });
            head.appendChild(copyRaw);
        }
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = shown;
        pre.appendChild(code);
        figure.append(head, pre);
        return figure;
    }

    function headingLevel(token) {
        const match = /^h([1-6])$/.exec(String(token.tag || ""));
        return match ? Number(match[1]) : 1;
    }

    function tableAlignmentClass(token) {
        const style = String(tokenAttribute(token, "style") || "").replace(/\s+/g, "").toLowerCase();
        if (style === "text-align:center") return "md-table__cell--center";
        if (style === "text-align:right") return "md-table__cell--right";
        if (style === "text-align:left") return "md-table__cell--left";
        return "";
    }

    function createBlockNode(token) {
        let node = null;
        if (token.type === "paragraph_open") {
            node = document.createElement("p");
            node.className = "md-paragraph";
        } else if (token.type === "heading_open") {
            const level = headingLevel(token);
            node = document.createElement("div");
            node.className = "md-heading md-heading--" + level;
            node.setAttribute("role", "heading");
            node.setAttribute("aria-level", String(Math.min(level + 2, 6)));
        } else if (token.type === "bullet_list_open") {
            node = document.createElement("ul");
            node.className = "md-list";
        } else if (token.type === "ordered_list_open") {
            node = document.createElement("ol");
            node.className = "md-list";
            const rawStart = tokenAttribute(token, "start");
            const start = rawStart == null ? 1 : Number(rawStart);
            if (Number.isInteger(start) && start !== 1) node.start = start;
        } else if (token.type === "list_item_open") {
            node = document.createElement("li");
            node.className = "md-list__item";
        } else if (token.type === "blockquote_open") {
            node = document.createElement("blockquote");
            node.className = "md-quote";
        } else if (token.type === "thead_open") node = document.createElement("thead");
        else if (token.type === "tbody_open") node = document.createElement("tbody");
        else if (token.type === "tr_open") node = document.createElement("tr");
        else if (token.type === "th_open") node = document.createElement("th");
        else if (token.type === "td_open") node = document.createElement("td");

        if (node && ["th_open", "td_open"].includes(token.type)) {
            const alignmentClass = tableAlignmentClass(token);
            if (alignmentClass) node.classList.add(alignmentClass);
        }
        return node;
    }

    function renderTokenFragment(tokens, options) {
        const fragment = document.createDocumentFragment();
        const parents = [fragment];
        const current = () => parents[parents.length - 1];

        for (let index = 0; index < tokens.length; index += 1) {
            const token = tokens[index];
            if (
                token.type === "heading_open"
                && tokens[index + 1]?.type === "inline"
                && !String(tokens[index + 1].content || "").trim()
                && tokens[index + 2]?.type === "heading_close"
            ) {
                index += 2;
                continue;
            }
            if (token.type === "inline") {
                appendInlineTokens(current(), token.children || []);
                continue;
            }
            if (["fence", "code_block"].includes(token.type)) {
                current().appendChild(createCodeBlock({
                    content: token.content,
                    language: token.type === "fence" ? sanitizeLanguage(token.info) : "",
                    inferred: false,
                }, options));
                continue;
            }
            if (token.type === "hr") {
                const rule = document.createElement("hr");
                rule.className = "md-rule";
                current().appendChild(rule);
                continue;
            }
            if (token.type === "table_open") {
                const wrapper = document.createElement("div");
                wrapper.className = "md-table-wrap";
                wrapper.tabIndex = 0;
                const table = document.createElement("table");
                table.className = "md-table";
                wrapper.appendChild(table);
                current().appendChild(wrapper);
                parents.push(table);
                continue;
            }
            if (token.type === "table_close") {
                if (parents.length > 1) parents.pop();
                continue;
            }
            if (token.type === "html_block") {
                appendText(current(), token.content);
                continue;
            }

            if (token.nesting === 1) {
                if (token.type === "paragraph_open" && token.hidden) {
                    parents.push(current());
                    continue;
                }
                const node = createBlockNode(token);
                if (node) {
                    current().appendChild(node);
                    parents.push(node);
                } else parents.push(current());
                continue;
            }
            if (token.nesting === -1) {
                if (parents.length > 1) parents.pop();
                continue;
            }
            if (token.content) appendText(current(), token.content);
        }
        return fragment;
    }

    function setContentClasses(target, hasCode, renderedMarkdown) {
        target.classList.toggle("message__content--md", Boolean(renderedMarkdown));
        target.classList.toggle("message__content--with-code", Boolean(hasCode));
        target.closest(".message")?.classList.toggle("message--with-code", Boolean(hasCode));
    }

    function renderTextFallback(target, raw) {
        target.replaceChildren(document.createTextNode(raw));
        target.dataset.raw = raw;
        setContentClasses(target, false, false);
    }

    /* Anteprima Markdown: le stesse righe della resa finale, sempre come testo. Come nella resa
       finale, i fence espliciti hanno precedenza e il codice riconosciuto resta raw. */
    function markdownPreview(raw) {
        try {
            const normalized = normalizeEmmaMarkdown(raw);
            if (/^ {0,3}(?:`{3,}|~{3,})/m.test(normalized)) return normalized;
            const inferred = detectUnfencedCode(raw);
            if (!inferred) return normalized;
            return inferred.map((segment) => {
                const text = raw.slice(segment.start, segment.end);
                return segment.type === "code" ? text : normalizeEmmaMarkdown(text).trim();
            }).filter(Boolean).join("\n");
        } catch (_) {
            return raw;
        }
    }

    function renderStreaming(target, rawText, options) {
        const raw = String(rawText == null ? "" : rawText);
        const markdown = typeof options?.markdown === "boolean" ? options.markdown : MARKDOWN_RESPONSES;
        let node = target.querySelector(":scope > .message__stream-text");
        if (!node || target.childElementCount !== 1) {
            node = document.createElement("span");
            node.className = "message__stream-text";
            target.replaceChildren(node);
        }
        node.textContent = markdown ? markdownPreview(raw) : plainPreview(raw);
        target.dataset.raw = raw;
        setContentClasses(target, false, false);
    }

    function renderPlainText(target, raw, opts) {
        const segments = splitPlainText(raw);
        const fenced = segments.some((segment) => segment.type === "code");
        const inferred = !fenced ? detectUnfencedCode(raw) : null;
        const fragment = document.createDocumentFragment();
        if (inferred) {
            inferred.forEach(segment => {
                if (segment.type === "code") fragment.appendChild(createCodeBlock(segment, opts));
                else appendPlainText(fragment, raw.slice(segment.start, segment.end)
                    .replace(/[ \t]*#{3,}[ \t]*/g, "\n").trim());
            });
        } else {
            segments.forEach((segment) => {
                if (segment.type === "code") {
                    fragment.appendChild(createCodeBlock({
                        content: segment.content,
                        language: segment.language,
                        inferred: false,
                    }, opts));
                    return;
                }
                const text = segment.text.replace(/^\n+|\n+$/g, "");
                if (text.trim()) appendPlainText(fragment, text);
            });
        }
        target.replaceChildren(fragment);
        target.dataset.raw = raw;
        setContentClasses(target, fenced || Boolean(inferred), false);
        return { rendered: true, reason: "plain_text" };
    }

    function isNearScrollEnd(container, thresholdPx) {
        if (!container) return true;
        const threshold = Number.isFinite(thresholdPx) ? Math.max(0, thresholdPx) : 72;
        const remaining = Number(container.scrollHeight || 0)
            - Number(container.clientHeight || 0)
            - Number(container.scrollTop || 0);
        return remaining <= threshold;
    }

    function renderFinal(target, rawText, options) {
        const opts = Object.assign({
            prettify: true,
            markdown: MARKDOWN_RESPONSES,
            copyText: (value) => navigator.clipboard.writeText(value),
        }, options || {});
        const raw = String(rawText == null ? "" : rawText);
        if (opts.outputMetadata && opts.outputMetadata.format === "json") {
            opts.exactJson = true;
            target.replaceChildren(createCodeBlock({ content: raw, language: "json" }, opts));
            target.dataset.raw = raw;
            setContentClasses(target, true, true);
            return { rendered: true, reason: "explicit_json" };
        }
        if (!opts.markdown) {
            try {
                return renderPlainText(target, raw, opts);
            } catch (_) {
                renderTextFallback(target, raw);
                return { rendered: false, reason: "render_error" };
            }
        }
        const markdownParser = parserInstance();
        if (!markdownParser) {
            renderTextFallback(target, raw);
            return { rendered: false, reason: "parser_unavailable" };
        }

        try {
            const normalized = normalizeEmmaMarkdown(raw);
            const tokens = markdownParser.parse(normalized, {});
            const inferred = !tokens.some((token) => token.type === "fence")
                ? detectUnfencedCode(raw) : null;
            let fragment;
            let hasCode;
            if (inferred) {
                fragment = document.createDocumentFragment();
                inferred.forEach(segment => {
                    if (segment.type === "code") fragment.appendChild(createCodeBlock(segment, opts));
                    else fragment.appendChild(renderTokenFragment(markdownParser.parse(
                        normalizeEmmaMarkdown(raw.slice(segment.start, segment.end)), {}), opts));
                });
                hasCode = true;
            } else {
                fragment = renderTokenFragment(tokens, opts);
                hasCode = tokens.some((token) => ["fence", "code_block"].includes(token.type));
            }
            target.replaceChildren(fragment);
            target.dataset.raw = raw;
            setContentClasses(target, hasCode, true);
            return { rendered: true, reason: "ok" };
        } catch (_) {
            renderTextFallback(target, raw);
            return { rendered: false, reason: "parser_error" };
        }
    }

    window.EmmaChatRenderer = Object.freeze({
        renderStreaming,
        renderFinal,
        isNearScrollEnd,
        normalizeEmmaMarkdown,
        safeLinkHref,
        sanitizeLanguage,
    });
})();
