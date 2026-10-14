/**
 * Emma 6 Self-Hosted - Core Application Controller (Refactored & Optimized)
 * Clean, modular, non-bloated implementation for local bare-metal inference.
 */

(function () {
  "use strict";

  // Application State
  const state = {
    modelKey: "emma-6",
    isThinking: false,
    isStreaming: false,
    activePreset: "balanced",
    history: [],
    abortController: null,
  };

  const DISCLAIMER_TEXT = "Contenuto generato da Emma6, contiene sicuramente errori";

  const PRESETS = {
    precise: { label: "Focus", temp: 0.40, top_p: 0.80, top_k: 20, rep: 1.12, max: 768, desc: "Risposte brevi e dirette per domande semplici o fatti puntuali." },
    balanced: { label: "Articolata", temp: 0.70, top_p: 0.90, top_k: 40, rep: 1.10, max: 1536, desc: "Equilibrio tra sintesi e approfondimento. Default consigliato." },
    creative: { label: "Creativa", temp: 0.85, top_p: 0.95, top_k: 80, rep: 1.10, max: 2048, desc: "Risposte ampie ed elaborate, scrittura narrativa." },
  };

  const SUGGESTED_PROMPTS = [
    "Cos'è il futuro?",
    "Racconta una storia breve",
    "Che cos'è la RAM?",
    "Che cos'è un buco nero?",
    "Spiegami il Rinascimento",
    "Qual è la capitale della Francia?",
    "Come funziona un motore elettrico?",
    "Dimmi una curiosità sullo spazio",
    "Che cos'è un algoritmo?",
    "Scrivi una poesia sul mare",
  ];

  // DOM Elements Cache
  const el = {};

  function initElements() {
    el.themeBtn = document.getElementById("themeToggleBtn");
    el.themeSun = document.getElementById("themeIconSun");
    el.themeMoon = document.getElementById("themeIconMoon");
    el.xBtn = document.getElementById("xSocialBtn");

    el.messages = document.getElementById("messagesPanel");
    el.emptyState = document.getElementById("emptyState");
    el.promptChips = document.getElementById("suggestedPrompts");

    el.composer = document.getElementById("composerForm");
    el.input = document.getElementById("messageInput");
    el.sendBtn = document.getElementById("sendBtn");
    el.stopBtn = document.getElementById("stopBtn");
    el.clearBtn = document.getElementById("clearConversationBtn");

    el.telemetry = document.getElementById("telemetryBar");
    el.metricPrompt = document.getElementById("metricPromptTokens");
    el.metricOutput = document.getElementById("metricOutputTokens");
    el.metricPrefill = document.getElementById("metricPrefillSpeed");
    el.metricDecode = document.getElementById("metricDecodeSpeed");
    el.metricLatency = document.getElementById("metricLatency");
    el.metricTemp = document.getElementById("metricTemp");
    el.metricTopP = document.getElementById("metricTopP");
    el.metricRepP = document.getElementById("metricRepP");

    el.thinkingBtn = document.getElementById("thinkingFooterToggle");
    el.thinkingLed = document.getElementById("thinkingHwLed");
    el.thinkingText = document.getElementById("thinkingHwState");

    el.apiBtn = document.getElementById("apiBtn");
    el.apiClose = document.getElementById("apiCloseBtn");
    el.apiPanel = document.getElementById("apiPanel");
    el.apiBackdrop = document.getElementById("apiBackdrop");

    el.settingsBtn = document.getElementById("settingsToggleBtn");
    el.settingsClose = document.getElementById("settingsCloseBtn");
    el.settingsPanel = document.getElementById("settingsPanel");
    el.settingsBackdrop = document.getElementById("settingsBackdrop");
    el.presetControl = document.getElementById("presetControl");
    el.presetDesc = document.getElementById("presetDescription");
    el.ragToggle = document.getElementById("ragToggle");
    el.historyToggle = document.getElementById("historyToggle");

    el.infoClose = document.getElementById("infoCloseBtn");
    el.infoPanel = document.getElementById("infoPanel");
    el.infoBackdrop = document.getElementById("infoBackdrop");

    el.feedbackToast = document.getElementById("feedbackToast");
  }

  // --- Theme Management ---
  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-theme", isDark);
    document.documentElement.classList.toggle("dark-theme", isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");

    if (el.themeSun && el.themeMoon) {
      el.themeSun.style.display = isDark ? "inline-block" : "none";
      el.themeMoon.style.display = isDark ? "none" : "inline-block";
    }
  }

  function initTheme() {
    let saved = localStorage.getItem("emma_theme_v4");
    if (saved !== "dark") saved = "light";
    applyTheme(saved);

    if (el.themeBtn) {
      el.themeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const next = document.body.classList.contains("dark-theme") ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem("emma_theme_v4", next); } catch (_) {}
      });
    }
  }

  // --- Thinking Mode ---
  window.setThinkingState = function (active) {
    state.isThinking = Boolean(active);
    window.__isThinking = state.isThinking;

    if (el.thinkingBtn) {
      el.thinkingBtn.classList.toggle("is-active", state.isThinking);
      el.thinkingBtn.setAttribute("aria-pressed", state.isThinking ? "true" : "false");
    }
    if (el.thinkingText) {
      el.thinkingText.textContent = state.isThinking ? "ON" : "OFF";
    }
  };

  window.toggleThinkingMode = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    window.setThinkingState(!state.isThinking);
    return false;
  };

  // --- Drawers Management ---
  function toggleDrawer(panel, backdrop, show) {
    if (!panel) return;
    const isOpening = show !== undefined ? Boolean(show) : panel.hidden;
    panel.hidden = !isOpening;
    panel.setAttribute("aria-hidden", !isOpening);
    if (backdrop) backdrop.hidden = !isOpening;
  }

  function initDrawers() {
    if (el.apiBtn) el.apiBtn.addEventListener("click", () => toggleDrawer(el.apiPanel, el.apiBackdrop, true));
    if (el.apiClose) el.apiClose.addEventListener("click", () => toggleDrawer(el.apiPanel, el.apiBackdrop, false));
    if (el.apiBackdrop) el.apiBackdrop.addEventListener("click", () => toggleDrawer(el.apiPanel, el.apiBackdrop, false));

    if (el.settingsBtn) el.settingsBtn.addEventListener("click", () => toggleDrawer(el.settingsPanel, el.settingsBackdrop, true));
    if (el.settingsClose) el.settingsClose.addEventListener("click", () => toggleDrawer(el.settingsPanel, el.settingsBackdrop, false));
    if (el.settingsBackdrop) el.settingsBackdrop.addEventListener("click", () => toggleDrawer(el.settingsPanel, el.settingsBackdrop, false));

    if (el.infoClose) el.infoClose.addEventListener("click", () => toggleDrawer(el.infoPanel, el.infoBackdrop, false));
    if (el.infoBackdrop) el.infoBackdrop.addEventListener("click", () => toggleDrawer(el.infoPanel, el.infoBackdrop, false));

    // Preset Buttons inside settings
    if (el.presetControl) {
      el.presetControl.innerHTML = "";
      Object.entries(PRESETS).forEach(([key, preset]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `seg__btn ${state.activePreset === key ? "is-active" : ""}`;
        btn.textContent = preset.label;
        btn.addEventListener("click", () => {
          state.activePreset = key;
          el.presetControl.querySelectorAll(".seg__btn").forEach(b => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          if (el.presetDesc) el.presetDesc.textContent = preset.desc;
          updateSettingsSliders(preset);
        });
        el.presetControl.appendChild(btn);
      });
      if (el.presetDesc && PRESETS[state.activePreset]) {
        el.presetDesc.textContent = PRESETS[state.activePreset].desc;
      }
    }
  }

  function updateSettingsSliders(p) {
    const tVal = document.getElementById("temperatureValue");
    const pVal = document.getElementById("topPValue");
    const rVal = document.getElementById("repetitionPenaltyValue");
    const kVal = document.getElementById("topKValue");
    if (tVal) tVal.textContent = p.temp.toFixed(2);
    if (pVal) pVal.textContent = p.top_p.toFixed(2);
    if (rVal) rVal.textContent = p.rep.toFixed(2);
    if (kVal) kVal.textContent = p.top_k;
  }

  // --- Prompt Chips ---
  function initPromptChips() {
    if (!el.promptChips) return;
    el.promptChips.innerHTML = "";
    SUGGESTED_PROMPTS.slice(0, 6).forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "prompt-chip";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        if (state.isStreaming) return;
        el.input.value = text;
        submitChat();
      });
      el.promptChips.appendChild(chip);
    });
  }

  // --- Composer Input Auto-resize ---
  function autoGrow() {
    if (!el.input) return;
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
  }

  function initComposer() {
    if (!el.input) return;
    el.input.addEventListener("input", autoGrow);
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitChat();
      }
    });

    if (el.composer) {
      el.composer.addEventListener("submit", (e) => {
        e.preventDefault();
        submitChat();
      });
    }

    if (el.stopBtn) {
      el.stopBtn.addEventListener("click", () => {
        if (state.abortController) {
          state.abortController.abort();
          state.abortController = null;
        }
      });
    }

    if (el.clearBtn) {
      el.clearBtn.addEventListener("click", () => {
        if (state.isStreaming) return;
        state.history = [];
        if (el.messages) {
          const bubbles = el.messages.querySelectorAll(".message");
          bubbles.forEach(b => b.remove());
        }
        if (el.emptyState) el.emptyState.hidden = false;
        if (el.telemetry) el.telemetry.hidden = true;
        el.input.value = "";
        autoGrow();
      });
    }
  }

  // --- Messages UI ---
  function showToast(text) {
    if (!el.feedbackToast) return;
    const txt = el.feedbackToast.querySelector(".feedback-toast__text");
    if (txt) txt.textContent = text;
    el.feedbackToast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      el.feedbackToast.hidden = true;
    }, 2500);
  }

  function addMessage(role, text) {
    if (el.emptyState) el.emptyState.hidden = true;

    const msg = document.createElement("article");
    msg.className = `message message--${role}`;

    const hdr = document.createElement("header");
    hdr.className = "message__header";

    if (role === "user") {
      const meta = document.createElement("span");
      meta.className = "message__meta";
      meta.textContent = "Tu";
      hdr.appendChild(meta);
    } else {
      const rl = document.createElement("span");
      rl.className = "message__role";
      rl.textContent = "EMMA-6";
      hdr.appendChild(rl);
    }
    msg.appendChild(hdr);

    const body = document.createElement("section");
    body.className = "message__content";
    msg.appendChild(body);

    if (role === "assistant") {
      // Loader spinner placeholder
      const loader = document.createElement("div");
      loader.className = "message__loading";
      loader.innerHTML = '<img src="/img/emma_loading.gif" alt="In attesa..." class="composer__btn-loader" />';
      msg.appendChild(loader);

      // Footer disclaimer & action buttons
      const footer = document.createElement("footer");
      footer.className = "message__footer";
      footer.hidden = true;

      const disc = document.createElement("p");
      disc.className = "message__disclaimer";
      disc.textContent = DISCLAIMER_TEXT;
      footer.appendChild(disc);

      const actions = document.createElement("div");
      actions.className = "message__actions";

      // Thumbs
      const up = document.createElement("button");
      up.className = "message__feedback-btn";
      up.type = "button";
      up.title = "Pollice su";
      up.innerHTML = '<img src="/img/pollice_su.png" alt="Like" />';
      up.addEventListener("click", () => {
        showToast("Grazie per il feedback!");
        fetch("/api/chat/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: "up" }) }).catch(() => {});
      });

      const down = document.createElement("button");
      down.className = "message__feedback-btn";
      down.type = "button";
      down.title = "Pollice giù";
      down.innerHTML = '<img src="/img/pollice_giu.png" alt="Dislike" />';
      down.addEventListener("click", () => {
        showToast("Feedback inviato.");
        fetch("/api/chat/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: "down" }) }).catch(() => {});
      });

      // Copy
      const copy = document.createElement("button");
      copy.className = "message__copy";
      copy.type = "button";
      copy.title = "Copia risposta";
      copy.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copy.addEventListener("click", () => {
        const rawText = msg.__rawContent || body.innerText;
        navigator.clipboard.writeText(rawText).then(() => showToast("Testo copiato!")).catch(() => {});
      });

      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(copy);
      footer.appendChild(actions);
      msg.appendChild(footer);
    } else {
      body.textContent = text;
    }

    el.messages.appendChild(msg);
    el.messages.scrollTop = el.messages.scrollHeight;
    return msg;
  }

  function updateAssistantMessage(msg, fullText) {
    if (!msg) return;
    msg.__rawContent = fullText;
    const body = msg.querySelector(".message__content");
    const loader = msg.querySelector(".message__loading");

    if (loader && fullText) loader.style.display = "none";

    if (body) {
      if (window.EmmaChatRenderer && typeof window.EmmaChatRenderer.render === "function") {
        window.EmmaChatRenderer.render(body, fullText);
      } else {
        body.textContent = fullText;
      }
    }
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function finalizeAssistantMessage(msg) {
    if (!msg) return;
    const loader = msg.querySelector(".message__loading");
    if (loader) loader.style.display = "none";
    const footer = msg.querySelector(".message__footer");
    if (footer) footer.hidden = false;
  }

  // --- Telemetry Display ---
  function updateTelemetry(stats) {
    if (!el.telemetry || !stats) return;
    el.telemetry.hidden = false;
    if (el.metricPrompt) el.metricPrompt.textContent = stats.prompt_tokens || "—";
    if (el.metricOutput) el.metricOutput.textContent = stats.output_tokens || "—";
    if (el.metricPrefill) el.metricPrefill.textContent = stats.prefill_tok_s ? Math.round(stats.prefill_tok_s) : "—";
    if (el.metricDecode) el.metricDecode.textContent = stats.decode_tok_s ? stats.decode_tok_s.toFixed(1) : "—";
    if (el.metricLatency) {
      const sec = (stats.generation_ms / 1000).toFixed(2);
      el.metricLatency.textContent = `${sec}s`;
    }
    if (el.metricTemp) el.metricTemp.textContent = stats.temperature.toFixed(2);
    if (el.metricTopP) el.metricTopP.textContent = stats.top_p.toFixed(2);
    if (el.metricRepP) el.metricRepP.textContent = stats.rep_penalty.toFixed(2);
  }

  // --- Streaming Chat Submission ---
  async function submitChat() {
    if (state.isStreaming) return;
    const text = el.input.value.trim();
    if (!text) return;

    el.input.value = "";
    autoGrow();

    addMessage("user", text);
    const assistantMsg = addMessage("assistant", "");

    state.isStreaming = true;
    el.sendBtn.disabled = true;
    el.stopBtn.disabled = false;
    state.abortController = new AbortController();

    const payload = {
      message: text,
      history: el.historyToggle?.checked ? state.history.slice(-8) : [],
      preset: state.isThinking ? "thinking" : state.activePreset,
      use_history: el.historyToggle ? el.historyToggle.checked : true,
    };

    let fullGenerated = "";

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: state.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`Server returned error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Retain remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "delta" && event.content) {
              fullGenerated += event.content;
              updateAssistantMessage(assistantMsg, fullGenerated);
            } else if (event.type === "done") {
              finalizeAssistantMessage(assistantMsg);
              if (event.stats) updateTelemetry(event.stats);
              state.history.push({ user: text, assistant: fullGenerated });
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        fullGenerated += "\n\n*[Risposta interrotta dall'utente]*";
        updateAssistantMessage(assistantMsg, fullGenerated);
      } else {
        fullGenerated += `\n\n*[Errore di connessione: ${err.message}]*`;
        updateAssistantMessage(assistantMsg, fullGenerated);
      }
      finalizeAssistantMessage(assistantMsg);
    } finally {
      state.isStreaming = false;
      state.abortController = null;
      el.sendBtn.disabled = false;
      el.stopBtn.disabled = true;
      el.input.focus();
    }
  }

  // --- Neural Canvas Animation ---
  function initNeuralCanvas() {
    const canvas = document.getElementById("neuralCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let width, height;
    let particles = [];

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    const count = Math.min(Math.floor((width * height) / 22000), 50);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.5 + 1,
      });
    }

    function loop() {
      ctx.clearRect(0, 0, width, height);
      const isDark = document.body.classList.contains("dark-theme");
      ctx.fillStyle = isDark ? "rgba(45, 212, 191, 0.25)" : "rgba(13, 148, 136, 0.18)";
      ctx.strokeStyle = isDark ? "rgba(45, 212, 191, 0.08)" : "rgba(13, 148, 136, 0.06)";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // --- Bootstrap ---
  document.addEventListener("DOMContentLoaded", () => {
    initElements();
    initTheme();
    initDrawers();
    initPromptChips();
    initComposer();
    initNeuralCanvas();

    // Ensure thinking state is synchronized at boot
    window.setThinkingState(false);
  });
})();
