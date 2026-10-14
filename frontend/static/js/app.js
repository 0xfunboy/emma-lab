/* ═══════════════════════════════════════════════
   Emma-3 LLM Chat — Frontend logic
   ═══════════════════════════════════════════════ */
const CFG = window.APP_CONFIG || {};

/* ── helpers ──────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const txt = (node, v) => {
  if (node) node.textContent = v;
};
const SUGGESTED_PROMPTS_MOBILE_VISIBLE_COUNT = 4;
const SUGGESTED_PROMPTS_VISIBLE_COUNT = 5;
const SUGGESTED_PROMPTS_INITIAL_DELAY_MS = 2200;
const SUGGESTED_PROMPTS_VISIBLE_MS = 3400;
const SUGGESTED_PROMPTS_TRANSITION_MS = 1450;
const PROMPT_CHECK_VISIBLE_MS = 2000;
const RAG_DEBUG_ENABLED = Boolean(CFG.debug?.rag);
// Limiti messaggi per chat (iter. 24): valori dal BE (ui_config.limits), mai hardcoded qui.
// Anonimo → invito a registrarsi; loggato gratuito → invito a nuova chat (illimitati = RF-5).
// Iter. 56: l'anonimo deve registrarsi PRIMA del primo messaggio (vedi onSubmit) — il ramo
// anonimo di currentMessageLimit() è ora un fallback difensivo, non più normalmente raggiunto.
const MESSAGE_LIMIT_ANON = Number(CFG.limits?.anonMessages) || 7;
const MESSAGE_LIMIT_FREE = Number(CFG.limits?.freeMessages) || 8;
function currentMessageLimit() {
  return Infinity;
}
/* Turni di memoria INVIATI al modello: dal tuning del modello attivo (Emma-3: 2, Emma-4: 4,
   Emma-5: 6, Emma-6: 32), col tetto del contratto API (max 32). La conversazione completa
   resta in state.history: il server tiene i turni più recenti che entrano nel contesto. */
const HISTORY_TURNS_CONTRACT = 32;
function historyTurnCap() {
  var n = Number(state.modelConfig?.tuning?.max_history_turns);
  return n >= 1 && n <= HISTORY_TURNS_CONTRACT ? n : 4;
}

/* ── state ───────────────────────────────────── */
const state = {
  isThinking: false,
  history: [],
  generating: false,
  abort: null,
  meta: null,
  messageCount: 0,
  /* Il modello di partenza è quello REALMENTE attivo server-side (public_config.model_key):
       se il default dichiarato non ha i pesi, il BE serve l'effettivo e la pill deve dirlo. */
  modelKey:
    (CFG.model && CFG.model.model_key) ||
    CFG.defaultModel ||
    (CFG.availableModels &&
      CFG.availableModels[0] &&
      CFG.availableModels[0].key) ||
    "emma-4",
  modelConfig: CFG.model || null, // public_config del modello attivo (scheda info, tuning)
  availableModels: CFG.availableModels || [], // lista autoritativa riconciliata con GET /api/models al boot
  promptRotationTimer: null,
  promptVisibleCount: 0,
  promptRotationNonce: 0,
  contributionCloseTimer: null,
  questionCloseTimer: null,
  answerCloseTimer: null,
  evaluationCloseTimer: null,
  evaluationRating: null,
  // Contributing a rotazione (iter. 15): item servito + id già visti in questa sessione (anonimo).
  answerItem: null,
  answerSeenIds: [],
  evalItem: null,
  evalSeenIds: [],
  // Thread di conversazione (iter. 24): generato a ogni nuova chat, mandato nello stream;
  // permette di riaprire e continuare la chat dal drawer profilo.
  conversationId: null,
  isLoggedIn: true,
  historyUserOverride: false,
  // Profilo reale (iter. 24): popolato da /api/auth/me al boot e dopo il login.
  userProfile: {
    firstName: "",
    lastName: "",
    email: "",
    gender: "", // label leggibile ("Uomo", …) per drawer/meta
    genderValue: "", // valore BE (male|female|non-binary|prefer-not-to-say)
    birthDate: "",
    authProvider: "local",
    hasLocalPassword: false,
    isSupporter: true,
    isDeveloper: true,
    has_active_subscription: true,
    accountType: "personal",
    creditBalance: 999999,
  },
  sessionResolved: false,
};

/* ── DOM refs ────────────────────────────────── */
const el = {
  messages: $("messagesPanel"),
  emptyState: $("emptyState"),
  termsBtn: $("termsBtn"),
  termsClose: $("termsCloseBtn"),
  privacyBtn: $("privacyBtn"),
  privacyClose: $("privacyCloseBtn"),
  termsPrivacyBtn: $("termsPrivacyBtn"),
  manifestoBtn: $("manifestoBtn"),
  manifestoClose: $("manifestoCloseBtn"),
  termsModal: $("termsModal"),
  termsBackdrop: $("termsBackdrop"),
  privacyModal: $("privacyModal"),
  privacyBackdrop: $("privacyBackdrop"),
  guardrailsBtn: $("guardrailsBtn"),
  guardrailsClose: $("guardrailsCloseBtn"),
  guardrailsModal: $("guardrailsModal"),
  guardrailsBackdrop: $("guardrailsBackdrop"),
  input: $("messageInput"),
  form: $("composerForm"),
  apiBtn: $("apiBtn"),
  apiClose: $("apiCloseBtn"),
  apiPanel: $("apiPanel"),
  apiBackdrop: $("apiBackdrop"),
  registerOpen: $("registerOpenBtn"),
  apiDashboardLink: $("apiDashboardLink"),
  apiLoginHint: $("apiLoginHint"),
  registerBackdrop: $("registerBackdrop"),
  registerModal: $("registerModal"),
  registerClose: $("registerCloseBtn"),
  registerForm: $("registerForm"),
  registerTermsOpen: $("registerTermsOpenBtn"),
  registerTermsConsent: $("registerTermsConsent"),
  registerPassword: $("registerPassword"),
  registerConfirmPassword: $("registerConfirmPassword"),
  registerSubmit: $("registerSubmitBtn"),
  registerFeedback: $("registerFeedback"),
  profileBtn: $("profileBtn"),
  loginRegisterLink: $("loginRegisterLink"),
  profileBackdrop: $("profileBackdrop"),
  profilePanel: $("profilePanel"),
  profileClose: $("profileCloseBtn"),
  profileInitials: $("profileInitials"),
  profileName: $("profileName"),
  profileVerified: $("profileVerified"),
  profileEmail: $("profileEmail"),
  profileMeta: $("profileMeta"),
  profileLogout: $("profileLogoutBtn"),
  profileNewChatBtn: $("profileNewChatBtn"),
  profileUpgrade: $("profileUpgradeBtn"),
  profileEdit: $("profileEditBtn"),
  profileEditBackdrop: $("profileEditBackdrop"),
  profileEditModal: $("profileEditModal"),
  profileEditClose: $("profileEditCloseBtn"),
  profileEditForm: $("profileEditForm"),
  deleteAccountBackdrop: $("deleteAccountBackdrop"),
  deleteAccountModal: $("deleteAccountModal"),
  deleteAccountClose: $("deleteAccountCloseBtn"),
  deleteAccountCancel: $("deleteAccountCancelBtn"),
  deleteAccountConfirm: $("deleteAccountConfirmBtn"),
  deleteAccountError: $("deleteAccountError"),
  profileEditFirstName: $("profileEditFirstName"),
  profileEditLastName: $("profileEditLastName"),
  profileEditEmail: $("profileEditEmail"),
  profileEditGender: $("profileEditGender"),
  profileEditBirthDate: $("profileEditBirthDate"),
  profileEditBirthDateError: $("profileEditBirthDateError"),
  profileEditCurrentPassword: $("profileEditCurrentPassword"),
  profileEditPassword: $("profileEditPassword"),
  profileEditConfirmPassword: $("profileEditConfirmPassword"),
  profileEditPasswordHint: $("profileEditPasswordHint"),
  profileEditConfirmPasswordError: $("profileEditConfirmPasswordError"),
  profileEditSubmit: $("profileEditSubmitBtn"),
  profileEditDelete: $("profileEditDeleteBtn"),
  profileEditFeedback: $("profileEditFeedback"),
  userRegisterBackdrop: $("userRegisterBackdrop"),
  userRegisterModal: $("userRegisterModal"),
  userRegisterClose: $("userRegisterCloseBtn"),
  userRegisterForm: $("userRegisterForm"),
  userRegisterFirstName: $("userRegisterFirstName"),
  userRegisterLastName: $("userRegisterLastName"),
  userRegisterBirthDate: $("userRegisterBirthDate"),
  userRegisterBirthDateError: $("userRegisterBirthDateError"),
  userRegisterEmail: $("userRegisterEmail"),
  userRegisterPassword: $("userRegisterPassword"),
  userRegisterConfirmPassword: $("userRegisterConfirmPassword"),
  userRegisterGender: $("userRegisterGender"),
  userRegisterProductConsent: $("userRegisterProductConsent"),
  userRegisterMarketingConsent: $("userRegisterMarketingConsent"),
  userRegisterTermsConsent: $("userRegisterTermsConsent"),
  userRegisterSubmit: $("userRegisterSubmitBtn"),
  userRegisterFeedback: $("userRegisterFeedback"),
  userRegisterLoginLink: $("userRegisterLoginLink"),
  userRegisterPasswordHint: $("userRegisterPasswordHint"),
  userRegisterConfirmPasswordError: $("userRegisterConfirmPasswordError"),
  loginOpen: $("loginOpenBtn"),
  /* login utente */
  loginUserBackdrop: $("loginUserBackdrop"),
  loginUserModal: $("loginUserModal"),
  loginUserClose: $("loginUserCloseBtn"),
  loginForm: $("loginForm"),
  loginEmail: $("loginEmail"),
  loginPassword: $("loginPassword"),
  loginStayConnected: $("loginStayConnected"),
  loginGoogleBtn: $("loginGoogleBtn"),
  loginGoogleDivider: $("loginGoogleDivider"),
  userRegisterGoogleBtn: $("userRegisterGoogleBtn"),
  userRegisterGoogleHint: $("userRegisterGoogleHint"),
  loginGoogleHint: $("loginGoogleHint"),
  loginFeedback: $("loginFeedback"),
  /* Step 2FA in-modale (iter. 24) */
  loginOtpForm: $("loginOtpForm"),
  loginOtpIntro: $("loginOtpIntro"),
  loginOtpCode: $("loginOtpCode"),
  loginOtpDev: $("loginOtpDev"),
  loginOtpCountdown: $("loginOtpCountdown"),
  loginOtpResend: $("loginOtpResend"),
  loginOtpBack: $("loginOtpBack"),
  loginOtpFeedback: $("loginOtpFeedback"),
  /* Step recupero password in-modale (iter. 40/43) */
  loginForgotForm: $("loginForgotForm"),
  loginForgotLink: $("loginForgotLink"),
  loginForgotEmail: $("loginForgotEmail"),
  loginForgotFeedback: $("loginForgotFeedback"),
  loginForgotDev: $("loginForgotDev"),
  loginForgotBack: $("loginForgotBack"),
  /* login aziendale */
  companyLoginBackdrop: $("companyLoginBackdrop"),
  companyLoginModal: $("companyLoginModal"),
  companyLoginClose: $("companyLoginCloseBtn"),
  companyLoginForm: $("companyLoginForm"),
  companyLoginEmail: $("companyLoginEmail"),
  companyLoginPassword: $("companyLoginPassword"),
  companyLoginStayConnected: $("companyLoginStayConnected"),
  companyLoginFeedback: $("companyLoginFeedback"),
  companyToRegisterLink: $("companyToRegisterLink"),
  downloadBtn: $("downloadBtn"),
  downloadClose: $("downloadCloseBtn"),
  downloadBackdrop: $("downloadBackdrop"),
  fineTuningBtn: $("fineTuningBtn"),
  fineTuningClose: $("fineTuningCloseBtn"),
  fineTuningBackdrop: $("fineTuningBackdrop"),
  pretrainingContributionBtn: $("pretrainingContributionBtn"),
  pretrainingContributionBackdrop: $("pretrainingContributionBackdrop"),
  pretrainingContributionModal: $("pretrainingContributionModal"),
  pretrainingContributionClose: $("pretrainingContributionCloseBtn"),
  pretrainingContributionForm: $("pretrainingContributionForm"),
  pretrainingContributionTextarea: $("pretrainingContributionTextarea"),
  pretrainingContributionFeedback: $("pretrainingContributionFeedback"),
  pretrainingContributionConsent: $("pretrainingContributionConsent"),
  pretrainingContributionSubmit: $("pretrainingContributionSubmitBtn"),
  questionContributionBtn: $("questionContributionBtn"),
  questionContributionBackdrop: $("questionContributionBackdrop"),
  questionContributionModal: $("questionContributionModal"),
  questionContributionClose: $("questionContributionCloseBtn"),
  questionContributionForm: $("questionContributionForm"),
  questionContributionTextarea: $("questionContributionTextarea"),
  questionContributionFeedback: $("questionContributionFeedback"),
  questionContributionConsent: $("questionContributionConsent"),
  questionContributionSubmit: $("questionContributionSubmitBtn"),
  answerContributionBtn: $("answerContributionBtn"),
  answerContributionBackdrop: $("answerContributionBackdrop"),
  answerContributionModal: $("answerContributionModal"),
  answerContributionClose: $("answerContributionCloseBtn"),
  answerContributionForm: $("answerContributionForm"),
  answerContributionTextarea: $("answerContributionTextarea"),
  answerContributionFeedback: $("answerContributionFeedback"),
  answerContributionConsent: $("answerContributionConsent"),
  answerContributionSubmit: $("answerContributionSubmitBtn"),
  evaluationContributionBtn: $("evaluationContributionBtn"),
  evaluationContributionBackdrop: $("evaluationContributionBackdrop"),
  evaluationContributionModal: $("evaluationContributionModal"),
  evaluationContributionClose: $("evaluationContributionCloseBtn"),
  evaluationContributionForm: $("evaluationContributionForm"),
  evaluationRatingOptions: [
    ...document.querySelectorAll(".contribution-rating__option"),
  ],
  /* Item a rotazione (iter. 15): la domanda/coppia reale servita dal backend */
  answerSampleQuestion: document.querySelector(
    "#answerContributionModal .contribution-sample p",
  ),
  evaluationSampleQuestion: document.querySelector(
    "#evaluationContributionModal .contribution-sample p",
  ),
  evaluationSampleAnswer: document.querySelector(
    "#evaluationContributionModal .contribution-sample__answer",
  ),
  evaluationContributionFeedback: $("evaluationContributionFeedback"),
  evaluationContributionConsent: $("evaluationContributionConsent"),
  evaluationContributionSubmit: $("evaluationContributionSubmitBtn"),
  productsBtn: $("productsBtn"),
  productsClose: $("productsCloseBtn"),
  productsBackdrop: $("productsBackdrop"),
  send: $("sendBtn"),
  stop: $("stopBtn"),
  settingsBtn: $("settingsToggleBtn"),
  settingsClose: $("settingsCloseBtn"),
  settingsPanel: $("settingsPanel"),
  backdrop: $("settingsBackdrop"),
  premiumPreferences: $("premiumPreferences"),
  premiumPreferencesLock: $("premiumPreferencesLock"),
  premiumPreferencesBackdrop: $("premiumPreferencesBackdrop"),
  premiumPreferencesModal: $("premiumPreferencesModal"),
  premiumPreferencesClose: $("premiumPreferencesCloseBtn"),
  premiumPreferencesDismiss: $("premiumPreferencesDismissBtn"),
  premiumPreferencesCta: $("premiumPreferencesCta"),
  infoBtn: $("infoToggleBtn"),
  infoClose: $("infoCloseBtn"),
  infoPanel: $("infoPanel"),
  manifestoModal: $("manifestoModal"),
  manifestoBackdrop: $("manifestoBackdrop"),
  infoBackdrop: $("infoBackdrop"),
  clear: $("clearConversationBtn"),
  advancedBtn: $("toggleAdvancedBtn"),
  advancedPanel: $("advancedPanel"),
  mode: $("modeControl"),
  modeDesc: $("modeDescription"),
  historyToggle: $("historyToggle"),
  ragToggle: $("ragToggle"),
  ragState: $("ragToggleState"),
  ragDescription: $("ragDescription"),
  ragNotice: $("ragNotice"),
  ragSettingsCard: $("ragSettingsCard"),
  historyState: $("historyToggleState"),
  historyModelHint: $("historyModelHint"),
  preset: $("presetControl"),
  presetDesc: $("presetDescription"),
  chips: $("suggestedPrompts"),
  knowledgeCount: $("knowledgeDocumentCount"),
  pTokens: $("metricPromptTokens"),
  oTokens: $("metricOutputTokens"),
  prefillSpeed: $("metricPrefillSpeed"),
  decodeSpeed: $("metricDecodeSpeed"),
  latency: $("metricLatency"),
  latencyUnit: $("metricLatencyUnit"),
  metricTemp: $("metricTemp"),
  metricTopP: $("metricTopP"),
  metricRepP: $("metricRepP"),
  ragDebug: $("ragDebugMetrics"),
  ragMetricState: $("metricRagState"),
  ragMetricDetail: $("metricRagDetail"),
  thinkingToggle: $("thinkingFooterToggle"),
  thinkingStateText: $("thinkingHwState"),
  tRange: $("temperatureRange"),
  tVal: $("temperatureValue"),
  pRange: $("topPRange"),
  pVal: $("topPValue"),
  rRange: $("repetitionPenaltyRange"),
  rVal: $("repetitionPenaltyValue"),
  mRange: $("maxTokensRange"),
  mVal: $("maxTokensValue"),
  lengthMode: $("responseLengthMode"),
  kRange: $("topKRange"),
  kVal: $("topKValue"),
  telemetry: $("telemetryBar"),
  canvas: $("neuralCanvas"),
  downloadMenu: $("downloadMenu"),
  fineTuningMenu: $("fineTuningMenu"),
  productsMenu: $("productsMenu"),
  emma4FeaturesBackdrop: $("emma4FeaturesBackdrop"),
  emma4FeaturesModal: $("emma4FeaturesModal"),
  emma4FeaturesClose: $("emma4FeaturesCloseBtn"),
  emma3FeaturesBackdrop: $("emma3FeaturesBackdrop"),
  emma3FeaturesModal: $("emma3FeaturesModal"),
  emma3FeaturesClose: $("emma3FeaturesCloseBtn"),
  emma5FeaturesBackdrop: $("emma5FeaturesBackdrop"),
  emma5FeaturesModal: $("emma5FeaturesModal"),
  emma5FeaturesClose: $("emma5FeaturesCloseBtn"),
  emma6FeaturesBackdrop: $("emma6FeaturesBackdrop"),
  emma6FeaturesModal: $("emma6FeaturesModal"),
  emma6FeaturesClose: $("emma6FeaturesCloseBtn"),
  emmaBusinessFeaturesBackdrop: $("emmabusinessFeaturesBackdrop"),
  emmaBusinessFeaturesModal: $("emmabusinessFeaturesModal"),
  emmaBusinessFeaturesClose: $("emmabusinessFeaturesCloseBtn"),
  modelSelect: $("modelSelect"),
  modelPill: $("modelPill"),
  modelPillLabel: $("modelPillLabel"),
  modelDropdown: $("modelDropdown"),
  consentBanner: $("consentBanner"),
  consentAccept: $("consentAcceptBtn"),
  consentNecessary: $("consentNecessaryBtn"),
  storeToast: $("storeToast"),
  composerFeedback: $("composerFeedback"),
  trainingNotice: $("trainingNotice"),
  trainingNoticePremium: $("trainingNoticePremium"),
  chatGuardrailNotice: $("chatGuardrailNotice"),
  chatGuardrailTitle: $("chatGuardrailTitle"),
  chatGuardrailMessage: $("chatGuardrailMessage"),
  chatGuardrailCategory: $("chatGuardrailCategory"),
  chatGuardrailFeedback: $("chatGuardrailFeedback"),
  chatGuardrailFeedbackUp: $("chatGuardrailFeedbackUp"),
  chatGuardrailFeedbackDown: $("chatGuardrailFeedbackDown"),
  limitBackdrop: $("limitBackdrop"),
  limitModal: $("limitModal"),
  limitClose: $("limitCloseBtn"),
  limitRegister: $("limitRegisterBtn"),
  limitReset: $("limitResetBtn"),
};

/* ── init ────────────────────────────────────── */
/* ── Preferenze del drawer Settings persistenti (iter. 24) ──
   RAG e preset sopravvivono al reload (localStorage, per-browser); dal 2026-10-09
   memoria, modalità e lunghezza sono fisse sui default.
   Senza preferenza salvata valgono i default del server (ui_config.defaults). */
var PREFS_KEY = "emma_prefs";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function savePref(key, value) {
  try {
    var p = loadPrefs();
    p[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (e) {
    /* storage non disponibile: preferenza solo di sessione */
  }
}
function clearPref(key) {
  try {
    var p = loadPrefs();
    delete p[key];
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (e) {}
}

function init() {
  initConsentBanner();
  setProfileIcon(false);
  renderChips();
  renderModes();
  renderPresets();
  renderKnowledgeDocumentCount();
  wireEvents();
  updateMaxLength();
  var prefs = loadPrefs();
  /* Memoria sempre attiva; gestione dei prompt e lunghezza sono nascoste, quindi
       valgono i default e le preferenze salvate prima non si riapplicano (2026-10-09). */
  syncHistory(true);
  syncRag(
    typeof prefs.useRag === "boolean"
      ? prefs.useRag
      : CFG.defaults?.useRag !== false,
  );
  applyRagAvailability();
  if (el.advancedPanel) el.advancedPanel.hidden = false;
  var savedPreset =
    prefs.preset &&
    visiblePresets().some(function (p) {
      return p.key === prefs.preset;
    })
      ? prefs.preset
      : selectedPreset();
  applyPreset(savedPreset);
  updatePresetDescription();
  updatePremiumPreferenceAccess();
  initAdmissionHeartbeat();
  initNeuralCanvas();
  autoGrow();
}

/* Presenza/capacità: una home aperta è una SPA e potrebbe non fare altri GET per
   minuti. La lease viene rinnovata sempre per alimentare "Persone online"; il
   feature flag server-side decide soltanto se applicare il limite ingressi. */
var _admissionHeartbeatTimer = null;
var _admissionHeartbeatEnabled = false;
var _admissionHeartbeatInFlight = false;
var _admissionHeartbeatSeconds = 30;

function scheduleAdmissionHeartbeat(seconds) {
  window.clearTimeout(_admissionHeartbeatTimer);
  if (!_admissionHeartbeatEnabled) return;
  _admissionHeartbeatSeconds = Math.max(10, Number(seconds) || 30);
  _admissionHeartbeatTimer = window.setTimeout(
    runAdmissionHeartbeat,
    _admissionHeartbeatSeconds * 1000,
  );
}

async function runAdmissionHeartbeat() {
  if (!_admissionHeartbeatEnabled || _admissionHeartbeatInFlight) return;
  if (document.visibilityState === "hidden") {
    scheduleAdmissionHeartbeat(_admissionHeartbeatSeconds);
    return;
  }
  _admissionHeartbeatInFlight = true;
  try {
    var response = await fetch("/api/admission/heartbeat", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    var data = await response.json().catch(function () {
      return {};
    });
    if (response.status === 503 && data.admitted === false) {
      window.location.replace("/capacity");
      return;
    }
    if (!response.ok) throw new Error("admission_heartbeat_unavailable");
    scheduleAdmissionHeartbeat(data.heartbeat_seconds);
  } catch (_error) {
    // Il middleware è fail-open: anche il client non interrompe una chat per
    // un singolo errore di rete e ritenta con un intervallo limitato.
    scheduleAdmissionHeartbeat(Math.min(60, _admissionHeartbeatSeconds * 1.5));
  } finally {
    _admissionHeartbeatInFlight = false;
  }
}

function setAdmissionHeartbeatEnabled(enabled) {
  var next = Boolean(enabled);
  if (_admissionHeartbeatEnabled === next) return;
  _admissionHeartbeatEnabled = next;
  window.clearTimeout(_admissionHeartbeatTimer);
  if (next) runAdmissionHeartbeat();
}

function initAdmissionHeartbeat() {
  setAdmissionHeartbeatEnabled(true);
  document.addEventListener("visibilitychange", function () {
    if (_admissionHeartbeatEnabled && document.visibilityState === "visible") {
      runAdmissionHeartbeat();
    }
  });
}

/* ── render helpers ──────────────────────────── */
function getSuggestedPromptsVisibleCount() {
  return window.innerWidth >= 1024
    ? SUGGESTED_PROMPTS_VISIBLE_COUNT
    : SUGGESTED_PROMPTS_MOBILE_VISIBLE_COUNT;
}

function renderChips() {
  el.chips.innerHTML = "";
  const source = CFG.suggestedPrompts || [];
  const prompts = [...source];
  for (let i = prompts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
  }
  if (!prompts.length) return;

  const desiredVisibleCount = getSuggestedPromptsVisibleCount();
  state.promptVisibleCount = desiredVisibleCount;

  const viewport = document.createElement("nav");
  viewport.className = "prompt-rotator";
  viewport.setAttribute("aria-label", "Prompt suggeriti per Emma");

  const visibleCount = Math.min(desiredVisibleCount, prompts.length);
  const buttons = prompts.slice(0, visibleCount).map((promptText, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-chip prompt-chip--animated is-visible";
    button.textContent = promptText;
    button.dataset.promptIndex = String(index);
    button.onclick = () => submitSuggestedPrompt(button.textContent);
    viewport.appendChild(button);
    return button;
  });

  el.chips.appendChild(viewport);
  startPromptRotation(buttons, prompts);
}

function syncSuggestedPromptsLayout() {
  const desiredVisibleCount = getSuggestedPromptsVisibleCount();
  if (desiredVisibleCount === state.promptVisibleCount) return;

  renderChips();
}

function clearPromptRotationTimer() {
  if (!state.promptRotationTimer) return;
  window.clearTimeout(state.promptRotationTimer);
  state.promptRotationTimer = null;
}

function invalidatePromptRotation() {
  clearPromptRotationTimer();
  state.promptRotationNonce += 1;
}

function submitSuggestedPrompt(promptText) {
  if (!promptText || state.generating) return;
  el.input.value = promptText;
  autoGrow();
  el.input.focus();
  el.form.requestSubmit();
}

function animatePromptSwap(button, nextPrompt, nextIndex) {
  button.classList.remove("is-visible");
  button.classList.add("is-leaving");

  window.setTimeout(() => {
    button.textContent = nextPrompt;
    button.dataset.promptIndex = String(nextIndex);
    button.classList.remove("is-leaving");
    button.classList.add("is-entering");

    requestAnimationFrame(() => {
      button.classList.add("is-visible");
      button.classList.remove("is-entering");
    });
  }, SUGGESTED_PROMPTS_TRANSITION_MS);
}

function startPromptRotation(buttons, prompts) {
  invalidatePromptRotation();
  if (!buttons?.length) return;

  const visibleCount = buttons.length;
  if (prompts.length <= visibleCount) return;

  const rotationNonce = state.promptRotationNonce;
  let previousSlotIndex = -1;

  const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];

  const scheduleNext = (delay) => {
    clearPromptRotationTimer();
    state.promptRotationTimer = window.setTimeout(() => {
      if (rotationNonce !== state.promptRotationNonce) return;

      const slotCandidates = buttons
        .map((_, index) => index)
        .filter((index) => visibleCount < 2 || index !== previousSlotIndex);
      const rotatingSlotIndex = pickRandom(slotCandidates);
      const button = buttons[rotatingSlotIndex];

      const visiblePromptIndices = buttons.map((item) =>
        Number(item.dataset.promptIndex || 0),
      );
      const hiddenPromptIndices = prompts
        .map((_, index) => index)
        .filter((index) => !visiblePromptIndices.includes(index));

      if (!hiddenPromptIndices.length) return;

      const currentPromptIndex = Number(button.dataset.promptIndex || 0);
      const promptCandidates = hiddenPromptIndices.filter(
        (index) => index !== currentPromptIndex,
      );
      const nextPromptIndex = pickRandom(
        promptCandidates.length ? promptCandidates : hiddenPromptIndices,
      );

      animatePromptSwap(button, prompts[nextPromptIndex], nextPromptIndex);
      previousSlotIndex = rotatingSlotIndex;
      scheduleNext(
        SUGGESTED_PROMPTS_VISIBLE_MS + SUGGESTED_PROMPTS_TRANSITION_MS,
      );
    }, delay);
  };

  scheduleNext(
    SUGGESTED_PROMPTS_INITIAL_DELAY_MS + SUGGESTED_PROMPTS_VISIBLE_MS,
  );
}

function renderModes() {
  el.mode.innerHTML = "";
  (CFG.modes || []).forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = m.key;
    b.textContent = m.label;
    b.title = m.description;
    b.classList.toggle("is-active", m.key === CFG.defaults?.mode);
    b.onclick = () => {
      setMode(m.key);
      updateModeDescription();
      savePref("mode", m.key);
    };
    el.mode.appendChild(b);
  });
  updateModeDescription();
}
function updateModeDescription() {
  if (!el.modeDesc) return;
  const active = el.mode.querySelector(".is-active");
  el.modeDesc.textContent = active?.title || "";
}
/* Adattiva è nascosta per ora (2026-10-09): la chat offre Focus, Bilanciata e
   Creativa; l'API continua ad accettarla. */
var HIDDEN_PRESETS = ["adaptive"];
function visiblePresets() {
  return (CFG.model?.presets || []).filter(function (p) {
    return HIDDEN_PRESETS.indexOf(p.key) === -1;
  });
}
function renderPresets() {
  el.preset.innerHTML = "";
  visiblePresets().forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.preset = p.key;
    b.textContent = p.label;
    b.title = p.description;
    b.classList.toggle("is-active", p.key === CFG.defaults?.preset);
    b.onclick = () => {
      applyPreset(p.key);
      updatePresetDescription();
      savePref("preset", p.key);
    };
    el.preset.appendChild(b);
  });
  updatePresetDescription();
}
function updatePresetDescription() {
  if (!el.presetDesc) return;
  const active = el.preset.querySelector(".is-active");
  el.presetDesc.textContent = active?.title || "";
}

function renderKnowledgeDocumentCount() {
  if (!el.knowledgeCount) return;
  const count = Number(CFG.knowledge?.documentCount ?? 0);
  el.knowledgeCount.textContent = count > 0 ? String(count) : "—";
}

/* ── events ──────────────────────────────────── */
function wireEvents() {
  el.form.addEventListener("submit", onSubmit);
  el.stop.addEventListener("click", abortGen);
  el.apiBtn?.addEventListener("click", toggleApiMenu);
  el.apiClose?.addEventListener("click", closeApiMenu);
  el.apiBackdrop?.addEventListener("click", closeApiMenu);
  el.registerOpen?.addEventListener("click", openRegisterModal);
  el.registerClose?.addEventListener("click", closeRegisterModal);
  el.registerBackdrop?.addEventListener("click", closeRegisterModal);
  el.registerForm?.addEventListener("submit", handleRegisterSubmit);
  el.registerTermsConsent?.addEventListener("change", syncRegisterSubmit);
  el.registerTermsOpen?.addEventListener("click", openTermsFromRegister);
  el.registerPassword?.addEventListener("input", validatePasswordStrength);
  el.registerConfirmPassword?.addEventListener("input", validatePasswordMatch);
  $("registerBirthDate")?.addEventListener("input", function () {
    validateBirthDate($("registerBirthDate"), $("registerBirthDateError"));
  });
  /* login utente */
  el.loginUserClose?.addEventListener("click", closeLoginUserModal);
  el.loginUserBackdrop?.addEventListener("click", closeLoginUserModal);
  el.loginForm?.addEventListener("submit", handleLoginSubmit);
  /* iter. 31: l'errore login sparisce appena si corregge email/password */
  el.loginEmail?.addEventListener("input", resetLoginFeedback);
  el.loginPassword?.addEventListener("input", resetLoginFeedback);
  /* step 2FA in-modale (iter. 24) */
  el.loginOtpForm?.addEventListener("submit", handleLoginOtpSubmit);
  el.loginOtpResend?.addEventListener("click", handleLoginOtpResend);
  el.loginOtpBack?.addEventListener("click", function () {
    resetModalOtp();
    window.setTimeout(function () {
      el.loginEmail?.focus();
    }, 0);
  });
  el.loginOtpCode?.addEventListener("input", function () {
    setOtpModalFeedback("", null);
  });
  /* step recupero password in-modale (iter. 40/43) */
  el.loginForgotLink?.addEventListener("click", openLoginForgotStep);
  el.loginForgotForm?.addEventListener("submit", handleLoginForgotSubmit);
  el.loginForgotBack?.addEventListener("click", function () {
    showLoginForgotStep(false);
    window.setTimeout(function () {
      el.loginEmail?.focus();
    }, 0);
  });
  el.loginForgotEmail?.addEventListener("input", function () {
    if (el.loginForgotFeedback) el.loginForgotFeedback.hidden = true;
  });
  /* login aziendale */
  el.loginOpen?.addEventListener("click", openCompanyLoginModal);
  el.companyLoginClose?.addEventListener("click", closeCompanyLoginModal);
  el.companyLoginBackdrop?.addEventListener("click", closeCompanyLoginModal);
  el.companyLoginForm?.addEventListener("submit", handleCompanyLoginSubmit);
  el.companyLoginEmail?.addEventListener("input", function () {
    if (el.companyLoginFeedback) el.companyLoginFeedback.hidden = true;
  });
  el.companyLoginPassword?.addEventListener("input", function () {
    if (el.companyLoginFeedback) el.companyLoginFeedback.hidden = true;
  });
  el.companyToRegisterLink?.addEventListener("click", function (e) {
    e.stopPropagation();
    closeCompanyLoginModal();
    openRegisterModal();
  });
  el.profileClose?.addEventListener("click", closeProfileDrawer);
  el.profileBackdrop?.addEventListener("click", closeProfileDrawer);
  el.profileLogout?.addEventListener("click", doLogout);
  /* iter. 31: avvia una nuova chat dal drawer (riusa il reset esistente) */
  el.profileNewChatBtn?.addEventListener("click", function () {
    resetChat();
    closeProfileDrawer();
  });
  el.profileEdit?.addEventListener("click", function () {
    closeProfileDrawer();
    openProfileEditModal();
  });
  el.profileEditClose?.addEventListener("click", closeProfileEditModal);
  el.profileEditBackdrop?.addEventListener("click", closeProfileEditModal);
  el.profileEditForm?.addEventListener("submit", handleProfileEditSubmit);
  // fix 05: modale conferma cancellazione account
  el.deleteAccountClose?.addEventListener("click", closeDeleteAccountModal);
  el.deleteAccountCancel?.addEventListener("click", closeDeleteAccountModal);
  el.deleteAccountBackdrop?.addEventListener("click", closeDeleteAccountModal);
  el.deleteAccountConfirm?.addEventListener("click", performAccountDelete);
  el.profileEditPassword?.addEventListener(
    "input",
    validateProfileEditPasswordStrength,
  );
  el.profileEditConfirmPassword?.addEventListener(
    "input",
    validateProfileEditPasswordMatch,
  );
  el.profileEditBirthDate?.addEventListener("input", function () {
    validateBirthDate(el.profileEditBirthDate, el.profileEditBirthDateError);
  });
  el.profileEditDelete?.addEventListener("click", handleProfileDelete);
  el.profileUpgrade?.addEventListener("click", function () {
    /* Abbonamento "Sostieni Emma" (iter. 26): hub di gestione = pagina dedicata. */
    closeProfileDrawer();
    window.location.assign("/dashboard/abbonamento");
  });
  el.loginRegisterLink?.addEventListener("click", function (e) {
    e.stopPropagation();
    closeLoginUserModal();
    openUserRegisterModal();
  });
  el.userRegisterClose?.addEventListener("click", closeUserRegisterModal);
  el.userRegisterBackdrop?.addEventListener("click", closeUserRegisterModal);
  el.userRegisterForm?.addEventListener("submit", handleUserRegisterSubmit);
  el.userRegisterPassword?.addEventListener(
    "input",
    validateUserPasswordStrength,
  );
  el.userRegisterConfirmPassword?.addEventListener(
    "input",
    validateUserPasswordMatch,
  );
  el.userRegisterBirthDate?.addEventListener("input", function () {
    validateBirthDate(el.userRegisterBirthDate, el.userRegisterBirthDateError);
  });
  el.userRegisterProductConsent?.addEventListener(
    "change",
    syncUserRegisterSubmit,
  );
  el.userRegisterMarketingConsent?.addEventListener(
    "change",
    syncUserRegisterSubmit,
  );
  el.userRegisterTermsConsent?.addEventListener(
    "change",
    syncUserRegisterSubmit,
  );
  el.userRegisterLoginLink?.addEventListener("click", function (e) {
    e.stopPropagation();
    closeUserRegisterModal();
    openLoginUserModal();
  });
  el.downloadBtn?.addEventListener("click", toggleDownloadMenu);
  el.downloadClose?.addEventListener("click", closeDownloadMenu);
  el.downloadBackdrop?.addEventListener("click", closeDownloadMenu);
  el.fineTuningBtn?.addEventListener("click", toggleFineTuningMenu);
  el.fineTuningClose?.addEventListener("click", closeFineTuningMenu);
  el.fineTuningBackdrop?.addEventListener("click", closeFineTuningMenu);
  el.pretrainingContributionBtn?.addEventListener(
    "click",
    openPretrainingContributionModal,
  );
  el.pretrainingContributionClose?.addEventListener(
    "click",
    closePretrainingContributionModal,
  );
  el.pretrainingContributionBackdrop?.addEventListener(
    "click",
    closePretrainingContributionModal,
  );
  el.pretrainingContributionForm?.addEventListener(
    "submit",
    handlePretrainingContributionSubmit,
  );
  el.pretrainingContributionTextarea?.addEventListener(
    "input",
    resetPretrainingContributionFeedback,
  );
  el.pretrainingContributionConsent?.addEventListener(
    "change",
    syncPretrainingContributionSubmit,
  );
  el.questionContributionBtn?.addEventListener(
    "click",
    openQuestionContributionModal,
  );
  el.questionContributionClose?.addEventListener(
    "click",
    closeQuestionContributionModal,
  );
  el.questionContributionBackdrop?.addEventListener(
    "click",
    closeQuestionContributionModal,
  );
  el.questionContributionForm?.addEventListener(
    "submit",
    handleQuestionContributionSubmit,
  );
  el.questionContributionTextarea?.addEventListener(
    "input",
    resetQuestionContributionFeedback,
  );
  el.questionContributionConsent?.addEventListener(
    "change",
    syncQuestionContributionSubmit,
  );
  el.answerContributionBtn?.addEventListener(
    "click",
    openAnswerContributionModal,
  );
  el.answerContributionClose?.addEventListener(
    "click",
    closeAnswerContributionModal,
  );
  el.answerContributionBackdrop?.addEventListener(
    "click",
    closeAnswerContributionModal,
  );
  el.answerContributionForm?.addEventListener(
    "submit",
    handleAnswerContributionSubmit,
  );
  el.answerContributionTextarea?.addEventListener(
    "input",
    resetAnswerContributionFeedback,
  );
  el.answerContributionConsent?.addEventListener(
    "change",
    syncAnswerContributionSubmit,
  );
  el.evaluationContributionBtn?.addEventListener(
    "click",
    openEvaluationContributionModal,
  );
  el.evaluationContributionClose?.addEventListener(
    "click",
    closeEvaluationContributionModal,
  );
  el.evaluationContributionBackdrop?.addEventListener(
    "click",
    closeEvaluationContributionModal,
  );
  el.evaluationContributionForm?.addEventListener(
    "submit",
    handleEvaluationContributionSubmit,
  );
  el.evaluationRatingOptions.forEach((button) =>
    button.addEventListener("click", () => selectEvaluationRating(button)),
  );
  el.evaluationContributionConsent?.addEventListener(
    "change",
    syncEvaluationContributionSubmit,
  );
  // Guardrail manutenzione (iter. 21): disabilita i punti d'ingresso ai contributi quando fs:maintenance è ON.
  if (window.EmmaFlags && typeof window.EmmaFlags.onChange === "function") {
    window.EmmaFlags.onChange(function (s) {
      var on = s.enabled.has("fs:maintenance");
      [
        el.pretrainingContributionBtn,
        el.questionContributionBtn,
        el.answerContributionBtn,
        el.evaluationContributionBtn,
      ].forEach(function (b) {
        if (!b) return;
        b.disabled = on;
        if (on)
          b.setAttribute("title", "Non disponibile durante la manutenzione");
        else b.removeAttribute("title");
      });
    });
  }
  /* Pulsanti store iOS/Android */
  document
    .querySelectorAll(
      '.footer__store-link[aria-label*="App Store"], .footer__store-link[aria-label*="Google Play"]',
    )
    .forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        showStoreToast();
      });
    });
  el.limitClose?.addEventListener("click", closeLimitModal);
  el.limitBackdrop?.addEventListener("click", closeLimitModal);
  el.limitRegister?.addEventListener("click", function () {
    closeLimitModal();
    openUserRegisterModal();
  });
  el.limitReset?.addEventListener("click", resetChat);
  el.productsBtn?.addEventListener("click", toggleProductsMenu);
  el.emma4FeaturesClose?.addEventListener("click", closeEmma4Features);
  el.emma4FeaturesBackdrop?.addEventListener("click", closeEmma4Features);
  el.emma3FeaturesClose?.addEventListener("click", closeEmma3Features);
  el.emma3FeaturesBackdrop?.addEventListener("click", closeEmma3Features);
  el.emma5FeaturesClose?.addEventListener("click", closeEmma5Features);
  el.emma5FeaturesBackdrop?.addEventListener("click", closeEmma5Features);
  el.emma6FeaturesClose?.addEventListener("click", closeEmma6Features);
  el.emma6FeaturesBackdrop?.addEventListener("click", closeEmma6Features);
  el.emmaBusinessFeaturesClose?.addEventListener(
    "click",
    closeEmmaBusinessFeatures,
  );
  el.emmaBusinessFeaturesBackdrop?.addEventListener(
    "click",
    closeEmmaBusinessFeatures,
  );
  el.productsClose?.addEventListener("click", closeProductsMenu);
  el.productsBackdrop?.addEventListener("click", closeProductsMenu);
  document.addEventListener("click", handleOutsideClick);
  el.settingsBtn.addEventListener("click", toggleDrawer);
  el.settingsClose.addEventListener("click", closeDrawer);
  el.backdrop.addEventListener("click", closeDrawer);
  el.premiumPreferences?.addEventListener(
    "click",
    interceptLockedPremiumPreference,
    true,
  );
  el.premiumPreferences?.addEventListener(
    "keydown",
    interceptLockedPremiumPreference,
    true,
  );
  el.premiumPreferencesBackdrop?.addEventListener(
    "click",
    closePremiumPreferencesModal,
  );
  el.premiumPreferencesClose?.addEventListener(
    "click",
    closePremiumPreferencesModal,
  );
  el.premiumPreferencesDismiss?.addEventListener(
    "click",
    closePremiumPreferencesModal,
  );
  el.premiumPreferencesCta?.addEventListener("click", function (event) {
    event.preventDefault();
    closePremiumPreferencesModal();
    if (state.isLoggedIn) window.location.assign("/dashboard/abbonamento");
    else openLoginUserModal();
  });
  /* Senza sessione apri prima il login, come per le altre CTA Premium. */
  el.trainingNoticePremium?.addEventListener("click", function (event) {
    if (state.isLoggedIn) return;
    event.preventDefault();
    openLoginUserModal();
  });
  el.termsBtn?.addEventListener("click", openTerms);
  el.termsClose?.addEventListener("click", closeTerms);
  el.termsBackdrop?.addEventListener("click", closeTerms);
  el.privacyBtn?.addEventListener("click", function () {
    openPrivacy(el.privacyBtn);
  });
  el.termsPrivacyBtn?.addEventListener("click", function () {
    openPrivacy(el.termsBtn);
  });
  el.privacyClose?.addEventListener("click", closePrivacy);
  el.privacyBackdrop?.addEventListener("click", closePrivacy);
  el.manifestoBtn?.addEventListener("click", openManifesto);
  el.manifestoClose?.addEventListener("click", closeManifesto);
  el.manifestoBackdrop?.addEventListener("click", closeManifesto);
  el.guardrailsBtn?.addEventListener("click", openGuardrails);
  el.chatGuardrailFeedbackUp?.addEventListener("click", () =>
    sendGuardrailFeedback("up"),
  );
  el.chatGuardrailFeedbackDown?.addEventListener("click", () =>
    sendGuardrailFeedback("down"),
  );
  el.guardrailsClose?.addEventListener("click", closeGuardrails);
  el.guardrailsBackdrop?.addEventListener("click", closeGuardrails);
  el.infoBtn.addEventListener("click", toggleInfo);
  el.infoClose.addEventListener("click", closeInfo);
  el.infoBackdrop.addEventListener("click", closeInfo);
  el.clear.addEventListener("click", resetChat);
  el.historyToggle.addEventListener("change", () => {
    state.historyUserOverride = true;
    syncHistory(el.historyToggle.checked);
    savePref("useHistory", el.historyToggle.checked); // sopravvive al reload (iter. 24)
  });
  el.ragToggle?.addEventListener("change", () => {
    syncRag(el.ragToggle.checked);
    savePref("useRag", el.ragToggle.checked); // sopravvive al reload (iter. 24)
  });
  window.addEventListener("resize", syncSuggestedPromptsLayout);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePremiumPreferencesModal();
      closeDrawer();
      closeInfo();
      closeTerms();
      closePrivacy();
      closeManifesto();
      closeGuardrails();
      closeLoginUserModal();
      closeCompanyLoginModal();
      closeRegisterModal();
      closePretrainingContributionModal();
      closeQuestionContributionModal();
      closeAnswerContributionModal();
      closeEvaluationContributionModal();
      closeUserRegisterModal();
      closeProfileDrawer();
      closeProfileEditModal();
      closeDownloadMenu();
      closeFineTuningMenu();
      closeProductsMenu();
      closeApiMenu();
      closeEmma4Features();
      closeEmma3Features();
      closeEmma5Features();
      closeEmma6Features();
      closeEmmaBusinessFeatures();
      closeLimitModal();
    }
  });
  document.addEventListener("keydown", trapPrivacyFocus);

  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });
  el.input.addEventListener("input", function () {
    autoGrow();
    hideComposerFeedback();
    hideChatGuardrailNotice();
  });

  [
    [el.tRange, el.tVal, 2],
    [el.pRange, el.pVal, 2],
    [el.rRange, el.rVal, 2],
    [el.mRange, el.mVal, 0],
    [el.kRange, el.kVal, 0],
  ].forEach(([inp, lbl, d]) =>
    inp.addEventListener("input", () => {
      lbl.textContent = d ? Number(inp.value).toFixed(d) : inp.value;
    }),
  );
  el.lengthMode?.addEventListener("change", () => {
    savePref("lengthMode", el.lengthMode.value);
    savePref("maxTokens", Number(el.mRange.value));
    syncLengthControl();
  });
  el.mRange.addEventListener("input", () =>
    savePref("maxTokens", Number(el.mRange.value)),
  );
}

/* ── textarea auto-grow ──────────────────────── */
function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 140) + "px";
}

function getMaxInputLength() {
  if (state.modelKey === "emma-3") return 3000;
  if (state.modelKey === "emma-5" || state.modelKey === "emma-6") return 4500;
  return 4000;
}

/* Etichetta human-readable del modello corrente.
   Centralizza la mappa modelKey -> label per UI (header, pill, feedback,
   modali) ed evita di dover toccare ogni occorrenza quando si aggiungono
   nuovi modelli. */
function applyModelTuning(modelConfig) {
  /* Applica i clamp di sampling, l'hint sulla memoria e i default
       history derivati dal tuning per-modello esposto dal backend.
       Chiamata: dopo init() e dopo ogni switch modello. */
  if (!modelConfig || !modelConfig.tuning) return;
  var tuning = modelConfig.tuning;
  var clamps = tuning.sampling_clamps || {};

  /* Slider: aggiorna max + clamp del valore corrente se eccede */
  function clampSlider(rangeEl, labelEl, maxVal, decimals) {
    if (!rangeEl) return;
    rangeEl.max = maxVal;
    var cur = Number(rangeEl.value);
    if (cur > maxVal) {
      rangeEl.value = maxVal;
      if (labelEl)
        labelEl.textContent =
          decimals != null ? Number(maxVal).toFixed(decimals) : String(maxVal);
    }
  }
  function clampSliderMin(rangeEl, labelEl, minVal, decimals) {
    if (!rangeEl) return;
    rangeEl.min = minVal;
    var cur = Number(rangeEl.value);
    if (cur < minVal) {
      rangeEl.value = minVal;
      if (labelEl)
        labelEl.textContent =
          decimals != null ? Number(minVal).toFixed(decimals) : String(minVal);
    }
  }
  if (typeof clamps.temperature_max === "number") {
    clampSlider(el.tRange, el.tVal, clamps.temperature_max, 2);
  }
  if (typeof clamps.top_p_max === "number") {
    clampSlider(el.pRange, el.pVal, clamps.top_p_max, 2);
  }
  if (typeof clamps.top_k_max === "number") {
    clampSlider(el.kRange, el.kVal, clamps.top_k_max, 0);
  }
  if (typeof clamps.max_new_tokens_max === "number") {
    clampSlider(el.mRange, el.mVal, clamps.max_new_tokens_max, 0);
    syncLengthControl();
  }
  if (typeof clamps.min_repetition_penalty === "number") {
    clampSliderMin(el.rRange, el.rVal, clamps.min_repetition_penalty, 2);
  }

  /* Memoria sempre attiva (2026-10-09): il default per-modello non la spegne. */
  if (el.historyToggle && !el.historyToggle.checked) syncHistory(true);

  /* Hint testuale sotto la memoria conversazionale */
  if (el.historyModelHint) {
    var hint = tuning.history_ui_hint || "";
    if (hint) {
      el.historyModelHint.textContent = hint;
      el.historyModelHint.hidden = false;
    } else {
      el.historyModelHint.hidden = true;
      el.historyModelHint.textContent = "";
    }
  }

  /* Aggiorna i preset visualizzati nella UI se cambiano i valori */
  if (
    Array.isArray(modelConfig.presets) &&
    Array.isArray(CFG.model && CFG.model.presets)
  ) {
    CFG.model.presets = modelConfig.presets;
  }
}

function currentModelLabel() {
  var m = (state.availableModels || []).find(function (x) {
    return x.key === state.modelKey;
  });
  if (m && m.label) return m.label;
  if (state.modelKey === "emma-3") return "Emma-3";
  if (state.modelKey === "emma-5") return "Emma-5";
  if (state.modelKey === "emma-6") return "Emma-6";
  return "Emma-4";
}

function updateMaxLength() {
  var limit = getMaxInputLength();
  el.input.maxLength = limit;
}

function hideComposerFeedback() {
  if (el.composerFeedback) el.composerFeedback.hidden = true;
}

function showComposerFeedback(modelName, limit) {
  showComposerError(
    "Con " +
      modelName +
      " puoi scrivere fino a " +
      limit +
      " caratteri. Accorcia il testo per continuare.",
  );
}

function showComposerError(message) {
  if (!el.composerFeedback) return;
  el.composerFeedback.textContent = message;
  el.composerFeedback.hidden = false;
}

function hideChatGuardrailNotice() {
  if (!el.chatGuardrailNotice) return;
  el.chatGuardrailNotice.hidden = true;
}

function showChatGuardrailNotice(guardrailError) {
  if (
    !el.chatGuardrailNotice ||
    !el.chatGuardrailTitle ||
    !el.chatGuardrailMessage
  )
    return;

  const unavailable =
    guardrailError.code === "guardrail_unavailable" ||
    guardrailError.code === "guardrail_audit_unavailable";
  /* Iter. 86: da bloccato il corpo è la descrizione della categoria che ha motivato
       il blocco; da non disponibile resta il messaggio di servizio. La descrizione può
       mancare se il bundle espone una label senza metadata: si perde la spiegazione,
       mai il blocco. */
  const detail = unavailable
    ? guardrailError.message
    : guardrailError.categoryDescription;
  el.chatGuardrailNotice.dataset.state = unavailable
    ? "unavailable"
    : "blocked";
  if (detail)
    el.chatGuardrailNotice.setAttribute(
      "aria-describedby",
      "chatGuardrailMessage",
    );
  else el.chatGuardrailNotice.removeAttribute("aria-describedby");
  el.chatGuardrailTitle.textContent = unavailable
    ? "Controllo non disponibile"
    : "Emma Guardrails ha bloccato il tuo prompt";
  el.chatGuardrailMessage.textContent = detail;
  el.chatGuardrailMessage.hidden = !detail;
  if (el.chatGuardrailCategory) {
    const category = unavailable ? "" : guardrailError.category;
    el.chatGuardrailCategory.textContent = category;
    el.chatGuardrailCategory.hidden = !category;
  }
  resetChatGuardrailFeedback(unavailable ? "" : guardrailError.exchangeId);
  el.chatGuardrailNotice.hidden = false;
}

/* Iter. 91: un blocco salvato nello storico si vota come una risposta. Senza
   exchange_id (storico spento o scrittura fallita) i pollici restano nascosti. */
function resetChatGuardrailFeedback(exchangeId) {
  if (!el.chatGuardrailFeedback) return;
  el.chatGuardrailFeedback.dataset.exchangeId = exchangeId || "";
  el.chatGuardrailFeedback.hidden = !exchangeId;
  [
    [el.chatGuardrailFeedbackUp, "Blocco corretto"],
    [el.chatGuardrailFeedbackDown, "Blocco non corretto"],
  ].forEach(function (entry) {
    var button = entry[0];
    if (!button) return;
    button.disabled = false;
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("title", entry[1]);
  });
}

function sendGuardrailFeedback(rating) {
  var exchangeId = el.chatGuardrailFeedback
    ? el.chatGuardrailFeedback.dataset.exchangeId
    : "";
  if (!exchangeId) return;
  [
    [el.chatGuardrailFeedbackUp, "up"],
    [el.chatGuardrailFeedbackDown, "down"],
  ].forEach(function (entry) {
    var button = entry[0];
    if (!button) return;
    var selected = entry[1] === rating;
    button.disabled = true;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.setAttribute(
      "title",
      selected ? "Feedback inviato" : "Feedback già inviato",
    );
  });
  showFeedbackToast();
  postChatFeedback(exchangeId, rating);
}

function focusGuardrailComposer() {
  el.input.focus();
  const end = el.input.value.length;
  if (typeof el.input.setSelectionRange === "function") {
    el.input.setSelectionRange(end, end);
  }
}

/* ── mode / preset ───────────────────────────── */
function selectedMode() {
  return el.mode.querySelector(".is-active")?.dataset.mode || "raw";
}

/* ── Animazione slider adattivi ───────────────── */
var _adaptiveSliderTimer = null;
var _adaptiveSliderDirection = 1;
var _adaptiveSliderValues = [
  0.5, 35, 0.88, 512, 1.14,
]; /* temp, top-k, top-p, max_tok, rep_pen */

function startAdaptiveSliderAnimation() {
  stopAdaptiveSliderAnimation();
  var sliders = [el.tRange, el.kRange, el.pRange, null, el.rRange];
  var labels = [el.tVal, el.kVal, el.pVal, null, el.rVal];
  var mins = [0.2, 15, 0.75, 256, 1.1];
  var maxs = [0.8, 55, 0.94, 768, 1.18];
  var steps = [0.008, 1, 0.004, 8, 0.002];

  function tick() {
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
      if (!s) continue;
      _adaptiveSliderValues[i] += _adaptiveSliderDirection * steps[i];
      if (_adaptiveSliderValues[i] >= maxs[i]) {
        _adaptiveSliderValues[i] = maxs[i];
      }
      if (_adaptiveSliderValues[i] <= mins[i]) {
        _adaptiveSliderValues[i] = mins[i];
      }
      s.value = _adaptiveSliderValues[i];
      if (labels[i]) {
        labels[i].textContent =
          i === 0 || i === 2 || i === 4
            ? Number(_adaptiveSliderValues[i]).toFixed(2)
            : String(Math.round(_adaptiveSliderValues[i]));
      }
    }
    /* Inverte direzione ai bordi */
    var atMax = _adaptiveSliderValues[0] >= maxs[0];
    var atMin = _adaptiveSliderValues[0] <= mins[0];
    if (atMax) _adaptiveSliderDirection = -1;
    if (atMin) _adaptiveSliderDirection = 1;
    _adaptiveSliderTimer = setTimeout(tick, 90);
  }
  tick();
}

function stopAdaptiveSliderAnimation() {
  if (_adaptiveSliderTimer) {
    clearTimeout(_adaptiveSliderTimer);
    _adaptiveSliderTimer = null;
  }
  _adaptiveSliderDirection = 1;
  _adaptiveSliderValues = [0.5, 35, 0.88, 512, 1.14];
}

function selectedPreset() {
  return el.preset.querySelector(".is-active")?.dataset.preset || "balanced";
}
function syncLengthControl() {
  if (!el.lengthMode) return;
  const manual = el.lengthMode.value === "manual";
  el.mRange.disabled = !manual;
  el.mRange.classList.remove("slider--adaptive");
  el.mVal.textContent = manual ? el.mRange.value : "automatico";
}
function setMode(key) {
  [...el.mode.querySelectorAll("button")].forEach((b) =>
    b.classList.toggle("is-active", b.dataset.mode === key),
  );
}
function setPreset(key) {
  [...el.preset.querySelectorAll("button")].forEach((b) => {
    b.classList.toggle("is-active", b.dataset.preset === key);
  });
}
function applyPreset(key) {
  const p = (CFG.model?.presets || []).find((x) => x.key === key);
  if (!p) return;
  setPreset(key);

  var isAdaptive = key === "adaptive";
  var sliders = [el.tRange, el.pRange, el.rRange, el.kRange];
  var labels = [el.tVal, el.pVal, el.rVal, el.kVal];

  var adv = el.advancedPanel;
  if (adv) adv.style.display = "";
  if (isAdaptive) {
    sliders.forEach(function (s) {
      if (s) {
        s.disabled = true;
        s.classList.add("slider--adaptive");
      }
    });
    labels.forEach(function (l) {
      if (l) l.textContent = "auto";
    });
    startAdaptiveSliderAnimation();
  } else {
    /* Gli slider mostrano i valori del preset in sola lettura (2026-10-09):
         cambiano soltanto scegliendo Focus, Bilanciata o Creativa. */
    sliders.forEach(function (s) {
      if (s) {
        s.disabled = true;
        s.classList.remove("slider--adaptive");
      }
    });
    stopAdaptiveSliderAnimation();
  }
  /* Applica sempre i valori del preset come base di partenza */
  el.tRange.value = p.temperature;
  el.tVal.textContent = Number(p.temperature).toFixed(2);
  el.pRange.value = p.top_p;
  el.pVal.textContent = Number(p.top_p).toFixed(2);
  el.rRange.value = p.repetition_penalty;
  el.rVal.textContent = Number(p.repetition_penalty).toFixed(2);
  if (el.lengthMode?.value !== "manual") el.mRange.value = p.max_new_tokens;
  syncLengthControl();
  el.kRange.value = p.top_k;
  el.kVal.textContent = p.top_k;
}

/* ── history toggle ──────────────────────────── */
function syncHistory(on) {
  el.historyToggle.checked = on;
  el.historyState.textContent = on ? "ON" : "OFF";
}

/* ── RAG toggle ──────────────────────────────── */
function syncRag(on) {
  if (!el.ragToggle || !el.ragState) return;
  el.ragToggle.checked = on;
  el.ragState.textContent = on ? "ON" : "OFF";
}

/* Kill-switch RAG (fix 10): se il developer lo mette in standby dal pannello admin
   (CFG.rag.adminEnabled === false), è una decisione interna — non ha senso dire all'utente
   "non disponibile" come se fosse un guasto. La card sparisce del tutto dalle Preferenze,
   come se quel controllo non esistesse (feedback utente 2026-07-06: "se è disattivato
   perché dire che non è disponibile?"). `use_rag` resta comunque forzato a false lato client
   per coerenza con lo stato reale lato BE. */
function applyRagAvailability() {
  var adminEnabled = CFG.rag?.adminEnabled !== false;
  if (adminEnabled) return; // stato normale: nessuna modifica alla card
  syncRag(false);
  if (el.ragSettingsCard) el.ragSettingsCard.hidden = true;
}

/* Ricerca web (iter. 52): AUTOMATICA quando il RAG è attivo e la KB locale non copre la
   domanda. Non c'è più un controllo utente (toggle rimosso): l'on/off è il feature flag
   developer `be:web-search`. Il FE mostra solo le fonti web quando arrivano (renderWebSources). */

/* ── drawer ───────────────────────────────────── */
function openDrawer() {
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeInfo();
  updatePremiumPreferenceAccess();
  document.body.classList.add("is-settings-open");
  el.backdrop.hidden = false;
  el.settingsPanel.hidden = false;
}
function closeDrawer() {
  document.body.classList.remove("is-settings-open");
  el.backdrop.hidden = true;
  el.settingsPanel.hidden = true;
}
function toggleDrawer() {
  document.body.classList.contains("is-settings-open")
    ? closeDrawer()
    : openDrawer();
}

/* Preferenze di base (iter. 71): il contenuto resta leggibile a tutti, ma soltanto un
   abbonamento attivo abilita i controlli nella chat web. Il backend applica lo stesso
   entitlement e normalizza eventuali payload costruiti a mano. */
function canEditPremiumPreferences() {
  return true;
}

function resetPremiumPreferencesToDefaults() {
  state.historyUserOverride = false;
  clearPref("useHistory");
  clearPref("mode");
  clearPref("preset");
  clearPref("lengthMode");
  clearPref("maxTokens");
  if (el.lengthMode) el.lengthMode.value = "auto";
  syncHistory(true);
  setMode(CFG.defaults?.mode || "raw");
  updateModeDescription();
  applyPreset(CFG.defaults?.preset || "balanced");
  updatePresetDescription();
}

/* Nota sotto il composer: con un abbonamento attivo le chat web sono escluse dal training
   (stesso `has_active_subscription` del salvataggio), quindi la nota non vale. Resta nascosta
   per gli anonimi e finché la sessione non è risolta, evitando flash al boot. */
function updateTrainingNotice() {
    if (!el.trainingNotice) return;
    var premium = !!(state.isLoggedIn && state.userProfile && state.userProfile.isSupporter);
    el.trainingNotice.hidden = !state.sessionResolved || !state.isLoggedIn || premium;
}

function updatePremiumPreferenceAccess() {
  updateTrainingNotice();
  var group = el.premiumPreferences;
  if (!group) return;
  var allowed = canEditPremiumPreferences();
  group.classList.toggle("is-locked", !allowed);
  // `aria-disabled` on a container is inherited by every descendant in the
  // accessibility tree. Keeping it here made the upgrade button itself
  // effectively disabled, so real browsers could not open the explanation.
  group.removeAttribute("aria-disabled");
  group.removeAttribute("tabindex");
  group
    .querySelectorAll("button, input, select, textarea, a")
    .forEach(function (control) {
      if (control === el.premiumPreferencesLock) return;
      if (!allowed) {
        if (control.dataset.premiumTabindex === undefined) {
          control.dataset.premiumTabindex =
            control.getAttribute("tabindex") || "";
        }
        if (control.dataset.premiumAriaDisabled === undefined) {
          control.dataset.premiumAriaDisabled =
            control.getAttribute("aria-disabled") || "";
        }
        control.setAttribute("tabindex", "-1");
        control.setAttribute("aria-disabled", "true");
      } else {
        var previousTabindex = control.dataset.premiumTabindex;
        if (previousTabindex)
          control.setAttribute("tabindex", previousTabindex);
        else control.removeAttribute("tabindex");
        delete control.dataset.premiumTabindex;

        var previousAriaDisabled = control.dataset.premiumAriaDisabled;
        if (previousAriaDisabled)
          control.setAttribute("aria-disabled", previousAriaDisabled);
        else control.removeAttribute("aria-disabled");
        delete control.dataset.premiumAriaDisabled;
      }
    });
  if (state.sessionResolved && !allowed) resetPremiumPreferencesToDefaults();
}

var _premiumPreferencesReturnFocus = null;
function openPremiumPreferencesModal() { return; }
function closePremiumPreferencesModal() {
  if (!el.premiumPreferencesModal || !el.premiumPreferencesBackdrop) return;
  el.premiumPreferencesBackdrop.hidden = true;
  el.premiumPreferencesModal.hidden = true;
  el.premiumPreferencesModal.setAttribute("aria-hidden", "true");
  if (
    _premiumPreferencesReturnFocus &&
    typeof _premiumPreferencesReturnFocus.focus === "function"
  ) {
    _premiumPreferencesReturnFocus.focus();
  }
  _premiumPreferencesReturnFocus = null;
}
function interceptLockedPremiumPreference(event) {
  if (canEditPremiumPreferences()) return;
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ")
    return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function")
    event.stopImmediatePropagation();
  openPremiumPreferencesModal();
}

/* ── Profile drawer ──────────────────────────── */
/* Meta sotto il nome nel drawer profilo: combina ruolo developer e stato
   abbonamento. L'abbonamento NON si applica alle aziende (iter. 37: azienda =
   zero abbonamento ovunque) → per i business non si mostra Sostenitore/gratuito
   (mostrarlo implicherebbe falsamente che possano abbonarsi). */
function profileMetaText(p) {
  var parts = [];
  var isDev = !!(p && p.isDeveloper);
  var isBiz = !!(p && p.accountType === "business");
  if (isDev) parts.push("Developer");
  /* Stato abbonamento: privati sempre; aziende mai — MA i developer sono ESENTI
       (vedono lo stato sostenitore anche su account business — scelta utente 2026-06-17). */
  if (!isBiz || isDev) {
    parts.push(p && p.isSupporter ? "Sostenitore" : "Account gratuito");
  } else {
    parts.push("Account aziendale");
  }
  return parts.join(" · ");
}

/* Motivo canonico del badge di fianco al nome. Le aziende ordinarie lo
   ottengono dai crediti; l'eccezione developer segue invece l'entitlement
   sostenitore già applicato a meta e card Premium. */
function profileVerifiedReason(p) {
  if (!p) return null;
  if (p.isDeveloper && p.isSupporter) return "supporter";
  if (p.accountType === "business")
    return (p.creditBalance || 0) > 0 ? "credits" : null;
  return p.isSupporter ? "supporter" : null;
}
function applyProfileVerified(p) {
  var badge = document.getElementById("profileVerified");
  if (!badge) return;
  var reason = profileVerifiedReason(p);
  badge.hidden = reason === null;
  var title =
    reason === "credits"
      ? "Crediti disponibili"
      : reason === "supporter"
        ? "Sostenitore di Emma"
        : "";
  badge.title = title;
  badge.alt = title;
}

/* Tutte le superfici del drawer dipendono dallo stesso snapshot: aggiornarle
   insieme evita una spunta fresca con meta/card ancora stantii. */
function renderProfileSummary(p) {
  if (!p) return;
  if (el.profileName)
    el.profileName.textContent =
      (p.firstName + " " + p.lastName).trim() || p.email;
  if (el.profileEmail) el.profileEmail.textContent = p.email;
  if (el.profileInitials) {
    el.profileInitials.textContent =
      ((p.firstName[0] || "") + (p.lastName[0] || "")).toUpperCase() ||
      (p.email[0] || "?").toUpperCase();
  }
  if (el.profileMeta) el.profileMeta.textContent = profileMetaText(p);
  applyProfileVerified(p);
  var avatarEl = document.querySelector(".profile-hero__avatar");
  if (avatarEl) {
    avatarEl.classList.toggle("is-supporter", !!p.isSupporter);
    avatarEl.title = p.isSupporter ? "Sostenitore di Emma" : "";
  }
  updatePremiumCard();
}

function openProfileDrawer() {
  if (!el.profilePanel || !el.profileBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeUserRegisterModal();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  /* Popola subito lo snapshot noto, poi lo riconcilia senza bloccare
       l'apertura del drawer (stale-while-revalidate). */
  renderProfileSummary(state.userProfile);
  document.body.classList.add("is-profile-open");
  el.profileBackdrop.hidden = false;
  el.profilePanel.hidden = false;
  el.profilePanel.setAttribute("aria-hidden", "false");
  // iter. 31: "Avvia una nuova chat" compare solo se c'è una chat in corso da resettare
  if (el.profileNewChatBtn)
    el.profileNewChatBtn.hidden = state.messageCount <= 0;
  renderProfileChats();
  refreshSession({ force: true });
}

/* Card "Sostieni Emma" del drawer (iter. 25): se l'utente è già supporter la card ringrazia
   e il CTA diventa gestione (sempre → /dashboard/abbonamento). Copy non-supporter: dal mockup. */
function updatePremiumCard() {
  /* Two-way: i testi default (mockup) vengono salvati in dataset al primo passaggio e
       RIPRISTINATI per il non-supporter — altrimenti supporter→logout→login free nello
       stesso tab lascerebbe "Sei un sostenitore" a un account gratuito. */
  var isSup = !!(state.userProfile && state.userProfile.isSupporter);
  var card = document.querySelector(".profile-premium-card");
  if (!card) return;
  /* Azienda: niente UI abbonamento/sostenitore nel drawer (non può abbonarsi — ACL iter. 32,
       chiarimento brief 2026-06-16). Nasconde l'intera sezione "Sostieni il progetto".
       ECCEZIONE: i developer sono esenti → vedono sempre la card (invito + stato), anche su
       account business, per poter testare la UI sostenitore (scelta utente 2026-06-17). */
  var isBusiness = !!(
    state.userProfile && state.userProfile.accountType === "business"
  );
  var isDev = !!(state.userProfile && state.userProfile.isDeveloper);
  var hidePremium = isBusiness && !isDev;
  var premiumSection = card.closest(".drawer__section");
  if (premiumSection) premiumSection.hidden = hidePremium;
  if (hidePremium) return;
  var title = card.querySelector(".profile-premium-card__title");
  var text = card.querySelector(".profile-premium-card__text");
  var price = card.querySelector(".profile-premium-card__price");
  var cta = document.getElementById("profileUpgradeBtn");
  if (title && title.dataset.defaultText === undefined)
    title.dataset.defaultText = title.textContent;
  if (text && text.dataset.defaultText === undefined)
    text.dataset.defaultText = text.textContent;
  if (cta && cta.dataset.defaultText === undefined)
    cta.dataset.defaultText = cta.textContent;
  if (isSup) {
    if (title) title.textContent = "Sei un sostenitore";
    if (text)
      text.textContent =
        "Grazie per sostenere la ricerca italiana sull'intelligenza artificiale: per te nessun limite di messaggi in chat.";
    if (price) price.hidden = true;
    if (cta) cta.textContent = "Gestisci l'abbonamento";
  } else {
    if (title) title.textContent = title.dataset.defaultText;
    if (text) text.textContent = text.dataset.defaultText;
    if (price) price.hidden = false;
    if (cta) cta.textContent = cta.dataset.defaultText;
  }
}

/* ── "Le tue chat": storico reale dell'utente (GET /api/chat/history/mine, iter. 24) ── */
function relTime(iso) {
  var then = new Date(iso).getTime();
  if (!then || isNaN(then)) return "";
  var mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "adesso";
  if (mins < 60) return mins === 1 ? "1 minuto fa" : mins + " minuti fa";
  var hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 ora fa" : hours + " ore fa";
  var days = Math.round(hours / 24);
  if (days === 1) return "Ieri";
  if (days < 7) return days + " giorni fa";
  var weeks = Math.round(days / 7);
  if (weeks < 5)
    return weeks === 1 ? "1 settimana fa" : weeks + " settimane fa";
  var months = Math.round(days / 30);
  return months <= 1 ? "1 mese fa" : months + " mesi fa";
}

function profileChatPlaceholder(text) {
  var art = document.createElement("article");
  art.className = "profile-chat-item profile-chat-item--static";
  var t = document.createElement("span");
  t.className = "profile-chat-item__title";
  t.textContent = text;
  art.appendChild(t);
  return art;
}

async function renderProfileChats() {
  var list = $("profileChatList");
  if (!list || !window.EmmaAuth) return;
  list.replaceChildren(profileChatPlaceholder("Carico le tue chat…"));
  var r = await window.EmmaAuth.apiFetch("/api/chat/history/mine?limit=12");
  if (!r.ok) {
    list.replaceChildren(
      profileChatPlaceholder(
        "Impossibile caricare le chat. Riprova più tardi.",
      ),
    );
    return;
  }
  var items = (r.data && r.data.items) || [];
  if (!items.length) {
    list.replaceChildren(
      profileChatPlaceholder(
        "Ancora nessuna chat: scrivi a Emma e la ritroverai qui.",
      ),
    );
    return;
  }
  list.replaceChildren();
  items.forEach(function (it) {
    var art = document.createElement("article");
    art.className = "profile-chat-item";
    art.setAttribute("role", "button");
    art.setAttribute("tabindex", "0");
    art.setAttribute(
      "aria-label",
      "Riapri la chat: " + (it.title || "(senza titolo)"),
    );
    var t = document.createElement("span");
    t.className = "profile-chat-item__title";
    t.textContent = it.title || "(senza titolo)";
    var d = document.createElement("span");
    d.className = "profile-chat-item__date";
    d.textContent = relTime(it.created_at);
    art.appendChild(t);
    art.appendChild(d);
    art.addEventListener("click", function () {
      openConversation(it.id, art);
    });
    art.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openConversation(it.id, art);
      }
    });
    list.appendChild(art);
  });
}

/* Riapre una conversazione dal drawer (iter. 24): ricostruisce gli scambi in chat e
   imposta lo stesso conversation_id → i prossimi messaggi CONTINUANO quel thread. */
async function openConversation(key, itemEl) {
  if (!window.EmmaAuth) return;
  window.EmmaChatAds?.conversation(null);
  if (itemEl) itemEl.style.opacity = ".55";
  var r = await window.EmmaAuth.apiFetch("/api/chat/history/" + key);
  if (itemEl) itemEl.style.opacity = "";
  if (
    !r.ok ||
    !r.data ||
    !Array.isArray(r.data.items) ||
    !r.data.items.length
  ) {
    var dateEl = itemEl && itemEl.querySelector(".profile-chat-item__date");
    if (dateEl) dateEl.textContent = "non disponibile";
    return;
  }
  if (state.generating) abortGen();
  closeProfileDrawer();
  hideComposerFeedback();
  hideChatGuardrailNotice();
  closeLimitModal();

  /* Ricostruisci la chat: stessi scambi, history client per dare contesto al modello */
  state.conversationId = key;
  window.EmmaChatAds?.conversation(key);
  state.history = [];
  state.meta = null;
  state.messageCount = r.data.items.length;
  el.messages.innerHTML = "";
  el.messages.appendChild(el.emptyState);
  hideEmpty();
  r.data.items.forEach(function (ex) {
    addMsg("user", ex.message);
    var reply = addMsg("assistant", ex.response || "[nessun contenuto]");
    window.EmmaChatStream.setStatus(reply.art, ex.generation_metadata);
    if (ex.output_metadata) {
      reply.ct._emmaOutputMetadata = ex.output_metadata;
      finalizeMessageRender(reply, ex.response == null ? "" : ex.response);
    }
    if (reply.copyBtn && (ex.response || "").trim())
      reply.copyBtn.hidden = false;
    /* Il feedback già inviato resta leggibile nella cronologia, ma non è più
           cliccabile. Il disclaimer resta sempre accanto alla risposta. */
    if (reply.art && ex.id) reply.art.dataset.exchangeId = ex.id;
    setAssistantFeedbackVisibility(reply, Boolean(ex.id));
    if (ex.feedback) setAssistantFeedbackSubmitted(reply, ex.feedback);
    state.history.push({
      user: ex.message,
      assistant: ex.response == null ? "" : ex.response,
    });
  });
  updateMetrics();
  el.telemetry.hidden = true; // nessuna metrica per gli scambi storici
  el.messages.scrollTop = el.messages.scrollHeight;
  el.input.focus();
}

function closeProfileDrawer() {
  if (!el.profilePanel || !el.profileBackdrop) return;
  document.body.classList.remove("is-profile-open");
  el.profileBackdrop.hidden = true;
  el.profilePanel.hidden = true;
  el.profilePanel.setAttribute("aria-hidden", "true");
}

function toggleProfileDrawer() {
  if (el.profilePanel?.hidden) openProfileDrawer();
  else closeProfileDrawer();
}

window.handleProfileBtnClick = handleProfileBtnClick;
function handleProfileBtnClick(e) {
  e?.stopPropagation();
  if (state.isLoggedIn) {
    toggleProfileDrawer();
  } else {
    openLoginUserModal();
  }
}

/* Pannello API: un'azienda già autenticata va alla dashboard invece di
   registrarsi o accedere di nuovo. */
function updateApiCtaForUser() {
  var isBusiness = !!(
    state.isLoggedIn &&
    state.userProfile &&
    state.userProfile.accountType === "business"
  );
  if (el.registerOpen) el.registerOpen.hidden = isBusiness;
  if (el.apiLoginHint) el.apiLoginHint.hidden = isBusiness;
  if (el.apiDashboardLink) el.apiDashboardLink.hidden = !isBusiness;
}

function updateEmptyStateForUser() {
  var emptyP = el.emptyState?.querySelector("p");
  if (emptyP && state.userProfile.firstName) {
    emptyP.textContent = genderedGreeting(
      state.userProfile.firstName,
      state.userProfile.genderValue,
    );
  }
}

function resetEmptyState() {
  var emptyP = el.emptyState?.querySelector("p");
  if (emptyP) {
    emptyP.textContent = "Chiedimi qualcosa, vedo di aiutarti.";
  }
}

function setProfileIcon(isLogged) {
  var btn = document.getElementById("profileBtn");
  if (!btn) return;
  var img = btn.querySelector("img");
  if (!img) return;
  img.src = isLogged ? "/img/logged.png" : "/img/profilo_icon.png";
}

/* ── Sessione reale (iter. 24): EmmaAuth + /api/auth/me ── */
const SESSION_REFRESH_MIN_INTERVAL_MS = 5000;
var _sessionRefreshInFlight = null;
var _sessionLastRefreshedAt = 0;
var _sessionRevision = 0;

function genderLabel(value) {
  if (value === "male") return "Uomo";
  if (value === "female") return "Donna";
  if (value === "non-binary") return "Non binario";
  if (value === "prefer-not-to-say") return "Preferisco non specificare";
  return "";
}

/* Saluto di benvenuto accordato al genere grammaticale (iter. 33). Maschile/femminile per
   male/female; neutro ("Ciao") per non-binary, prefer-not-to-say, valore assente/inatteso →
   scelta rispettosa, niente binario forzato. */
function genderedGreeting(firstName, gender) {
  var name = (firstName || "").trim();
  var verb =
    gender === "male"
      ? "Bentornato"
      : gender === "female"
        ? "Bentornata"
        : "Ciao";
  return verb + " " + name + ", come posso aiutarti?";
}

function applySession(user) {
  if (!user) return;
  _sessionRevision += 1;
  state.isLoggedIn = true;
  state.userProfile = {
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    email: user.email || "",
    gender: genderLabel(user.gender),
    genderValue: user.gender || "",
    birthDate: user.birth_date || "",
    authProvider: user.auth_provider || "local",
    hasLocalPassword: !!user.has_local_password,
    isSupporter: !!user.is_supporter,
    isDeveloper: !!user.is_developer,
    accountType: user.account_type || "",
    creditBalance: Number(user.credit_balance) || 0,
  };
  state.sessionResolved = true;
  window.EmmaChatAds?.session(user);
  _sessionLastRefreshedAt = Date.now();
  setProfileIcon(true);
  updateEmptyStateForUser();
  updatePremiumPreferenceAccess();
  updateApiCtaForUser();
  if (el.profilePanel && !el.profilePanel.hidden)
    renderProfileSummary(state.userProfile);
}

function refreshSession(options) {
  options = options || {};
  if (!window.EmmaAuth) {
    state.sessionResolved = true;
    updatePremiumPreferenceAccess();
    return Promise.resolve(null);
  }
  if (
    !options.force &&
    _sessionLastRefreshedAt &&
    Date.now() - _sessionLastRefreshedAt < SESSION_REFRESH_MIN_INTERVAL_MS
  ) {
    return Promise.resolve(state.isLoggedIn ? state.userProfile : null);
  }
  if (_sessionRefreshInFlight) return _sessionRefreshInFlight;
  const revision = _sessionRevision;
  _sessionRefreshInFlight = (async function () {
    let r = null;
    try {
      r = await window.EmmaAuth.apiFetch("/api/auth/me");
    } catch (e) {
      r = null;
    }
    /* Login, logout o salvataggi locali avvenuti dopo l'avvio rendono questa
           risposta obsoleta: non deve sovrascrivere lo snapshot più recente. */
    if (revision !== _sessionRevision) {
      return state.isLoggedIn ? state.userProfile : null;
    }
    if (r && r.ok && r.data) {
      applySession(r.data);
      return state.userProfile;
    }
    if (r && r.status === 401) {
      resetLocalSession();
      return null;
    }
    /* Rete/5xx: conserva l'ultimo snapshot valido e sblocca comunque la UI. */
    window.EmmaChatAds?.uncertain();
    state.sessionResolved = true;
    updatePremiumPreferenceAccess();
    return null;
  })().finally(function () {
    _sessionRefreshInFlight = null;
  });
  return _sessionRefreshInFlight;
}

function initSession() {
  refreshSession({ force: true });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) refreshSession({ force: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshSession();
  });
}

/* Helper messaggi/errori condivisi con le pagine auth (stessi status del backend) */
function serverDetail(r) {
  return r && r.data && typeof r.data.detail === "string"
    ? r.data.detail
    : null;
}
function firstValidationMsg(r) {
  if (
    r &&
    r.data &&
    Array.isArray(r.data.detail) &&
    r.data.detail[0] &&
    r.data.detail[0].msg
  ) {
    return r.data.detail[0].msg.replace(/^Value error,\s*/i, "");
  }
  return null;
}
function isServerOrNetworkError(r) {
  return r.networkError || r.status === 0 || r.status >= 500;
}
function loginErrorMessage(r) {
  if (isServerOrNetworkError(r))
    return "Si è verificato un problema. Riprova tra poco.";
  if (r.status === 401) return "Email o password non corretti.";
  if (r.status === 403)
    return (
      serverDetail(r) ||
      "Accesso riservato agli utenti autorizzati del server locale."
    );
  if (r.status === 503)
    return serverDetail(r) || "Servizio in manutenzione. Riprova tra poco.";
  return serverDetail(r) || "Accesso non riuscito. Riprova.";
}
function registerErrorMessage(r) {
  if (isServerOrNetworkError(r))
    return "Si è verificato un problema. Riprova tra poco.";
  if (r.status === 409)
    return "Esiste già un account con questa email. Accedi invece.";
  if (r.status === 403)
    return (
      serverDetail(r) ||
      "Registrazione non disponibile in ambiente self-hosted."
    );
  if (r.status === 422)
    return firstValidationMsg(r) || "Controlla i campi inseriti e riprova.";
  if (r.status === 503)
    return serverDetail(r) || "Servizio in manutenzione. Riprova tra poco.";
  return serverDetail(r) || "Registrazione non riuscita. Riprova.";
}

/* Modalità Beta (iter. 105): chi non è beta tester confermato riceve al primo invio un 403 con
   detail {code, message} e nessun account. Il form mostra l'avviso, conserva i dati e passa la
   CTA a «Crea comunque account»; il secondo invio conferma e crea l'account in attesa. */
function betaConfirmationNotice(r) {
  var d = r && r.status === 403 && r.data ? r.data.detail : null;
  return d && d.code === "beta_confirmation_required"
    ? String(d.message || "")
    : null;
}
function betaConfirming(btn) {
  return !!btn && btn.dataset.betaConfirm === "1";
}
function setBetaConfirmStep(btn, on) {
  if (!btn) return;
  if (btn.dataset.ctaLabel === undefined)
    btn.dataset.ctaLabel = btn.dataset.idleLabel || btn.textContent;
  var label = on ? "Crea comunque account" : btn.dataset.ctaLabel;
  btn.dataset.betaConfirm = on ? "1" : "";
  btn.dataset.idleLabel = label; // setSubmitBusy ripristina questa etichetta
  if (!btn.classList.contains("is-loading")) btn.textContent = label;
}

function setModalFeedback(node, msg, kind, baseClass) {
  if (!node) return;
  node.textContent = msg;
  node.classList.remove(baseClass + "--error", baseClass + "--success");
  if (kind) node.classList.add(baseClass + "--" + kind);
  node.hidden = !msg;
}
function setSubmitBusy(btn, on, busyLabel) {
  if (!btn) return;
  if (on && btn.dataset.idleLabel === undefined)
    btn.dataset.idleLabel = btn.textContent;
  btn.disabled = on;
  btn.classList.toggle("is-loading", on);
  btn.textContent = on ? busyLabel : btn.dataset.idleLabel || btn.textContent;
}

/* Login reale dalla modale "Bentornato" (era mock nel mockup old-emma) */
async function doLogin() {
  if (!window.EmmaAuth) return;
  var email = el.loginEmail?.value.trim() || "";
  var password = el.loginPassword?.value || "";
  if (!email || !password) {
    setModalFeedback(
      el.loginFeedback,
      "Inserisci email e password.",
      "error",
      "login-form__feedback",
    );
    return;
  }
  var remember = !el.loginStayConnected || el.loginStayConnected.checked;
  var submitBtn = el.loginForm
    ? el.loginForm.querySelector(".login-form__submit")
    : null;
  setModalFeedback(el.loginFeedback, "", null, "login-form__feedback");
  setSubmitBusy(submitBtn, true, "Accesso…");
  var r = await window.EmmaAuth.login(email, password, { remember: remember });
  if (r.ok && r.data && r.data.access_token) {
    setSubmitBusy(submitBtn, false, "");
    closeLoginUserModal();
    closeCompanyLoginModal();
    var user = await window.EmmaAuth.me();
    applySession(user);
    return;
  }
  if (r.ok && r.data && r.data.otp_required) {
    // 2FA attivo (be:login-2fa): il codice si inserisce QUI, nello step OTP della modale —
    // niente redirect, il primo fattore appena verificato non va buttato (iter. 24).
    setSubmitBusy(submitBtn, false, "");
    enterModalOtp(email, r.data, async function () {
      var u = await window.EmmaAuth.me();
      applySession(u);
    });
    return;
  }
  setSubmitBusy(submitBtn, false, "");
  setModalFeedback(
    el.loginFeedback,
    loginErrorMessage(r),
    "error",
    "login-form__feedback",
  );
}

/* ── Step 2FA in-modale (iter. 24) ──
   Con be:login-2fa ON il login risponde { otp_required, pre_auth_token, expires_at, retry_after,
   dev_otp? }: la modale "Bentornato" passa allo step codice (verify-otp/resend-otp via EmmaAuth).
   `onSuccess` è la continuazione del flusso chiamante (resta in chat / vai in dashboard). */
var modalTwofa = {
  preAuth: "",
  email: "",
  onSuccess: null,
  countdownTimer: null,
  resendTimer: null,
};

function setOtpModalFeedback(msg, kind) {
  setModalFeedback(el.loginOtpFeedback, msg, kind, "login-form__feedback");
}

function showLoginOtpStep(showOtp) {
  if (el.loginForm) el.loginForm.hidden = showOtp;
  if (el.loginOtpForm) el.loginOtpForm.hidden = !showOtp;
}

/* Recupero password in-modale (iter. 40/43): step "Password dimenticata?" senza lasciare la chat. */
function showLoginForgotStep(show) {
  if (el.loginForm) el.loginForm.hidden = show;
  if (show && el.loginOtpForm) el.loginOtpForm.hidden = true;
  if (el.loginForgotForm) el.loginForgotForm.hidden = !show;
}

function setLoginForgotFeedback(msg, kind) {
  var n = el.loginForgotFeedback;
  if (!n) return;
  n.textContent = msg || "";
  n.className =
    "login-form__feedback" + (kind ? " login-form__feedback--" + kind : "");
  n.hidden = !msg;
}

function openLoginForgotStep() {
  setLoginForgotFeedback("", null);
  if (el.loginForgotDev) el.loginForgotDev.hidden = true;
  var src = el.loginEmail ? (el.loginEmail.value || "").trim() : "";
  if (src && el.loginForgotEmail) el.loginForgotEmail.value = src;
  showLoginForgotStep(true);
  window.setTimeout(function () {
    el.loginForgotEmail && el.loginForgotEmail.focus();
  }, 0);
}

function handleLoginForgotSubmit(e) {
  e.preventDefault();
  var email = el.loginForgotEmail
    ? (el.loginForgotEmail.value || "").trim()
    : "";
  if (!email) {
    setLoginForgotFeedback("Inserisci la tua email.", "error");
    return;
  }
  var btn = el.loginForgotForm.querySelector(".login-form__submit");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Invio…";
  }
  setLoginForgotFeedback("", null);
  fetch("/api/auth/password/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email }),
  })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(r);
    })
    .then(function (data) {
      setLoginForgotFeedback(
        (data && data.detail) ||
          "Se l'indirizzo è registrato, riceverai un'email a breve.",
        "success",
      );
      if (el.loginForgotDev && data && data.dev_reset_link) {
        el.loginForgotDev.innerHTML =
          'DEV — link di reset: <a href="' +
          data.dev_reset_link +
          '">' +
          data.dev_reset_link +
          "</a>";
        el.loginForgotDev.hidden = false;
      }
    })
    .catch(function () {
      setLoginForgotFeedback(
        "Si è verificato un problema. Riprova tra poco.",
        "error",
      );
    })
    .finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Invia il link di reset";
      }
    });
}

function startOtpCountdown(expiresAtIso) {
  if (modalTwofa.countdownTimer) {
    clearInterval(modalTwofa.countdownTimer);
    modalTwofa.countdownTimer = null;
  }
  var exp = expiresAtIso
    ? new Date(expiresAtIso)
    : new Date(Date.now() + 600000);
  function tick() {
    var rem = Math.max(0, Math.round((exp.getTime() - Date.now()) / 1000));
    if (!el.loginOtpCountdown) return;
    if (rem <= 0) {
      clearInterval(modalTwofa.countdownTimer);
      modalTwofa.countdownTimer = null;
      el.loginOtpCountdown.textContent =
        "Codice scaduto: richiedine uno nuovo.";
      return;
    }
    var m = Math.floor(rem / 60),
      s = String(rem % 60).padStart(2, "0");
    el.loginOtpCountdown.textContent = "Il codice scade tra " + m + ":" + s;
  }
  tick();
  modalTwofa.countdownTimer = setInterval(tick, 1000);
}

function startOtpResendCooldown(seconds) {
  if (modalTwofa.resendTimer) {
    clearInterval(modalTwofa.resendTimer);
    modalTwofa.resendTimer = null;
  }
  if (!el.loginOtpResend) return;
  var rem = Math.max(1, Number(seconds) || 60);
  el.loginOtpResend.disabled = true;
  function tick() {
    rem -= 1;
    if (rem <= 0) {
      clearInterval(modalTwofa.resendTimer);
      modalTwofa.resendTimer = null;
      el.loginOtpResend.disabled = false;
      el.loginOtpResend.textContent = "Invia un nuovo codice";
      return;
    }
    el.loginOtpResend.textContent = "Nuovo codice tra " + rem + "s";
  }
  el.loginOtpResend.textContent = "Nuovo codice tra " + rem + "s";
  modalTwofa.resendTimer = setInterval(tick, 1000);
}

function applyOtpIssueData(data) {
  startOtpCountdown(data && data.expires_at);
  startOtpResendCooldown(data && data.retry_after);
  if (el.loginOtpDev) {
    if (data && data.dev_otp) {
      el.loginOtpDev.textContent = "DEV — codice: " + data.dev_otp;
      el.loginOtpDev.hidden = false;
      if (el.loginOtpCode) el.loginOtpCode.value = data.dev_otp;
    } else {
      el.loginOtpDev.hidden = true;
      el.loginOtpDev.textContent = "";
    }
  }
}

function resetModalOtp() {
  if (modalTwofa.countdownTimer) clearInterval(modalTwofa.countdownTimer);
  if (modalTwofa.resendTimer) clearInterval(modalTwofa.resendTimer);
  modalTwofa = {
    preAuth: "",
    email: "",
    onSuccess: null,
    countdownTimer: null,
    resendTimer: null,
  };
  if (el.loginOtpCode) el.loginOtpCode.value = "";
  if (el.loginOtpDev) {
    el.loginOtpDev.hidden = true;
    el.loginOtpDev.textContent = "";
  }
  if (el.loginOtpResend) {
    el.loginOtpResend.disabled = true;
    el.loginOtpResend.textContent = "Invia un nuovo codice";
  }
  setOtpModalFeedback("", null);
  showLoginOtpStep(false);
}

function enterModalOtp(email, data, onSuccess) {
  openLoginUserModal(); // chiude le altre superfici e riparte pulita (reset incluso)
  modalTwofa.email = email;
  modalTwofa.preAuth = (data && data.pre_auth_token) || "";
  modalTwofa.onSuccess = onSuccess || null;
  if (el.loginOtpIntro)
    el.loginOtpIntro.textContent =
      "Ti abbiamo inviato un codice di accesso a " +
      email +
      ". Inseriscilo qui sotto per completare l'accesso.";
  showLoginOtpStep(true);
  applyOtpIssueData(data);
  window.setTimeout(function () {
    el.loginOtpCode?.focus();
  }, 0);
}

async function handleLoginOtpSubmit(e) {
  e.preventDefault();
  if (!window.EmmaAuth || !modalTwofa.preAuth) return;
  var code = (el.loginOtpCode?.value || "").trim();
  if (!/^[0-9]{6}$/.test(code)) {
    setOtpModalFeedback("Inserisci il codice a 6 cifre.", "error");
    return;
  }
  var submitBtn = el.loginOtpForm
    ? el.loginOtpForm.querySelector(".login-form__submit")
    : null;
  setOtpModalFeedback("", null);
  setSubmitBusy(submitBtn, true, "Verifica…");
  var r = await window.EmmaAuth.verify2fa(modalTwofa.preAuth, code);
  setSubmitBusy(submitBtn, false, "");
  if (r.ok && r.data && r.data.access_token) {
    var done = modalTwofa.onSuccess;
    resetModalOtp();
    closeLoginUserModal();
    if (done) await done();
    return;
  }
  if (r.status === 429) {
    setOtpModalFeedback("Troppi tentativi: richiedi un nuovo codice.", "error");
    return;
  }
  if (r.status === 401) {
    setOtpModalFeedback(
      "Codice errato o scaduto. Riprova o richiedine uno nuovo.",
      "error",
    );
    return;
  }
  setOtpModalFeedback(loginErrorMessage(r), "error");
}

async function handleLoginOtpResend() {
  if (!window.EmmaAuth || !modalTwofa.preAuth) return;
  setOtpModalFeedback("", null);
  var r = await window.EmmaAuth.resend2fa(modalTwofa.preAuth);
  if (r.ok && r.data) {
    applyOtpIssueData(r.data);
    setOtpModalFeedback(
      "Nuovo codice inviato. Controlla la tua email.",
      "success",
    );
    return;
  }
  if (r.status === 429) {
    var retry = (r.data && r.data.detail && r.data.detail.retry_after) || null;
    startOtpResendCooldown(retry || 60);
    setOtpModalFeedback(
      "Attendi qualche secondo prima di richiedere un nuovo codice.",
      "error",
    );
    return;
  }
  setOtpModalFeedback(loginErrorMessage(r), "error");
}

/* ── Profile Edit Modal ─────────────────────── */
function openProfileEditModal() {
  if (!el.profileEditModal || !el.profileEditBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeUserRegisterModal();
  closeProfileDrawer();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  /* Popola i campi dal profilo reale (/api/auth/me, iter. 24) */
  var p = state.userProfile;
  if (el.profileEditFirstName)
    el.profileEditFirstName.value = p.firstName || "";
  if (el.profileEditLastName) el.profileEditLastName.value = p.lastName || "";
  if (el.profileEditEmail) el.profileEditEmail.value = p.email || "";
  if (el.profileEditGender) el.profileEditGender.value = p.genderValue || "";
  if (el.profileEditBirthDate)
    el.profileEditBirthDate.value = p.birthDate || "";
  if (el.profileEditCurrentPassword) el.profileEditCurrentPassword.value = "";
  if (el.profileEditPassword) el.profileEditPassword.value = "";
  if (el.profileEditConfirmPassword) el.profileEditConfirmPassword.value = "";
  if (el.profileEditPasswordHint) el.profileEditPasswordHint.hidden = true;
  if (el.profileEditConfirmPasswordError)
    el.profileEditConfirmPasswordError.hidden = true;
  if (el.profileEditBirthDateError) el.profileEditBirthDateError.hidden = true;
  if (el.profileEditFeedback) el.profileEditFeedback.hidden = true;
  /* La disponibilità dipende dalla password Emma, non dall'origine Google. */
  [
    el.profileEditCurrentPassword,
    el.profileEditPassword,
    el.profileEditConfirmPassword,
  ].forEach(function (input) {
    var field = input && input.closest(".profile-edit-form__field");
    if (field) field.hidden = !p.hasLocalPassword;
  });
  document.body.classList.add("is-profile-edit-open");
  el.profileEditBackdrop.hidden = false;
  el.profileEditModal.hidden = false;
  el.profileEditModal.setAttribute("aria-hidden", "false");
  window.setTimeout(function () {
    el.profileEditFirstName?.focus();
  }, 0);
}

function closeProfileEditModal() {
  if (!el.profileEditModal || !el.profileEditBackdrop) return;
  document.body.classList.remove("is-profile-edit-open");
  el.profileEditBackdrop.hidden = true;
  el.profileEditModal.hidden = true;
  el.profileEditModal.setAttribute("aria-hidden", "true");
}

function validateProfileEditPasswordStrength() {
  if (!el.profileEditPassword) return true;
  var pw = el.profileEditPassword.value;
  var hint = el.profileEditPasswordHint;
  if (!pw) {
    if (hint) hint.hidden = true;
    return true;
  }
  var ok =
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
  if (hint) hint.hidden = ok;
  return ok;
}

function validateProfileEditPasswordMatch() {
  if (!el.profileEditPassword || !el.profileEditConfirmPassword) return true;
  var pw = el.profileEditPassword.value;
  var confirm = el.profileEditConfirmPassword.value;
  var error = el.profileEditConfirmPasswordError;
  if (!confirm) {
    if (error) error.hidden = true;
    return true;
  }
  var match = pw === confirm;
  if (error) error.hidden = match;
  return match;
}

function showProfileEditFeedback(msg, kind) {
  setModalFeedback(
    el.profileEditFeedback,
    msg,
    kind,
    "profile-edit-form__feedback",
  );
}

/* Salvataggio profilo reale (iter. 24): PATCH /api/auth/me (+ PUT password se compilata) */
async function handleProfileEditSubmit(e) {
  e.preventDefault();
  if (!window.EmmaAuth) return;
  var newPw = el.profileEditPassword?.value || "";
  var confirmPw = el.profileEditConfirmPassword?.value || "";
  var currentPw = el.profileEditCurrentPassword?.value || "";
  var birthDate = el.profileEditBirthDate?.value || "";
  if (
    birthDate &&
    !validateBirthDate(el.profileEditBirthDate, el.profileEditBirthDateError)
  ) {
    showProfileEditFeedback(
      "La data di nascita richiede almeno 18 anni.",
      "error",
    );
    el.profileEditBirthDate?.focus();
    return;
  }
  if (newPw) {
    if (!validateProfileEditPasswordStrength()) {
      showProfileEditFeedback(
        "La nuova password non rispetta i requisiti.",
        "error",
      );
      return;
    }
    if (newPw !== confirmPw) {
      validateProfileEditPasswordMatch();
      showProfileEditFeedback("Le password non coincidono.", "error");
      return;
    }
    if (!currentPw) {
      showProfileEditFeedback(
        "Inserisci la password attuale per cambiarla.",
        "error",
      );
      el.profileEditCurrentPassword?.focus();
      return;
    }
  }
  setSubmitBusy(el.profileEditSubmit, true, "Salvataggio…");
  // PATCH parziale (exclude_unset lato BE): i campi nome svuotati vengono OMESSI, non
  // azzerati — svuotare per sbaglio non deve cancellare il dato. Il gender invece viaggia
  // sempre: rimetterlo su "Seleziona" è una rimozione intenzionale ("" → None a BE).
  var body = { gender: el.profileEditGender?.value || "" };
  var fn = el.profileEditFirstName?.value.trim();
  var ln = el.profileEditLastName?.value.trim();
  if (fn) body.first_name = fn;
  if (ln) body.last_name = ln;
  // Gli account storici possono non avere ancora la data: il campo vuoto viene
  // omesso, così possono continuare a modificare il resto del profilo.
  if (birthDate) body.birth_date = birthDate;
  var r = await window.EmmaAuth.apiFetch("/api/auth/me", {
    method: "PATCH",
    body: body,
  });
  if (!r.ok) {
    setSubmitBusy(el.profileEditSubmit, false, "");
    showProfileEditFeedback(
      r.status === 422
        ? firstValidationMsg(r) || "Controlla i campi inseriti."
        : serverDetail(r) || "Salvataggio non riuscito. Riprova.",
      "error",
    );
    return;
  }
  if (newPw) {
    var pr = await window.EmmaAuth.apiFetch("/api/auth/me/password", {
      method: "PUT",
      body: { current_password: currentPw, new_password: newPw },
    });
    if (!pr.ok) {
      setSubmitBusy(el.profileEditSubmit, false, "");
      var msg =
        pr.status === 400
          ? "La password attuale non è corretta."
          : pr.status === 422
            ? firstValidationMsg(pr) ||
              "La nuova password non rispetta i requisiti."
            : serverDetail(pr) || "Cambio password non riuscito. Riprova.";
      showProfileEditFeedback("Profilo salvato, ma: " + msg, "error");
      return;
    }
  }
  setSubmitBusy(el.profileEditSubmit, false, "");
  /* Allinea stato locale + drawer + empty state dal profilo aggiornato */
  applySession(r.data);
  renderProfileSummary(state.userProfile);
  showProfileEditFeedback("Profilo aggiornato con successo.", "success");
  window.setTimeout(function () {
    showProfileEditFeedback("", null);
    closeProfileEditModal();
  }, 1600);
}

/* Cancellazione account reale (iter. 24): conferma → DELETE /api/auth/me → logout */
var _profileDeleteBusy = false;
/* fix 05: la conferma è una modale stilata (non più window.confirm del browser). */
function openDeleteAccountModal() {
  if (!el.deleteAccountModal || !el.deleteAccountBackdrop) return;
  if (el.deleteAccountError) el.deleteAccountError.hidden = true;
  document.body.classList.add("is-delete-account-open");
  el.deleteAccountBackdrop.hidden = false;
  el.deleteAccountModal.hidden = false;
  el.deleteAccountModal.setAttribute("aria-hidden", "false");
}
function closeDeleteAccountModal() {
  if (!el.deleteAccountModal || !el.deleteAccountBackdrop) return;
  document.body.classList.remove("is-delete-account-open");
  el.deleteAccountBackdrop.hidden = true;
  el.deleteAccountModal.hidden = true;
  el.deleteAccountModal.setAttribute("aria-hidden", "true");
}

function handleProfileDelete() {
  // Apre la modale di conferma stilata; la cancellazione vera è in performAccountDelete.
  if (_profileDeleteBusy) return;
  openDeleteAccountModal();
}

async function performAccountDelete() {
  if (!window.EmmaAuth || _profileDeleteBusy) return;
  _profileDeleteBusy = true; // guard: una seconda DELETE in volo darebbe 401 sporcando il feedback
  setSubmitBusy(el.deleteAccountConfirm, true, "Cancellazione…");
  var r = await window.EmmaAuth.apiFetch("/api/auth/me", { method: "DELETE" });
  if (!r.ok) {
    _profileDeleteBusy = false;
    setSubmitBusy(el.deleteAccountConfirm, false, "");
    if (el.deleteAccountError) {
      el.deleteAccountError.textContent =
        serverDetail(r) || "Cancellazione non riuscita. Riprova.";
      el.deleteAccountError.hidden = false;
    }
    return;
  }
  setSubmitBusy(el.deleteAccountConfirm, false, "");
  closeDeleteAccountModal();
  if (el.profileEditFeedback) {
    el.profileEditFeedback.textContent =
      "Account cancellato. Ci dispiace vederti andare.";
    el.profileEditFeedback.hidden = false;
    el.profileEditFeedback.style.borderColor = "rgba(192,57,43,.22)";
    el.profileEditFeedback.style.background = "rgba(192,57,43,.06)";
    el.profileEditFeedback.style.color = "#a3302a";
  }
  window.setTimeout(async function () {
    closeProfileEditModal();
    try {
      if (window.EmmaAuth.clearToken) window.EmmaAuth.clearToken();
    } catch (e2) {}
    resetLocalSession();
    /* Ripristina stili feedback per un'eventuale prossima apertura */
    if (el.profileEditFeedback) {
      el.profileEditFeedback.textContent = "Profilo aggiornato con successo.";
      el.profileEditFeedback.style.borderColor = "";
      el.profileEditFeedback.style.background = "";
      el.profileEditFeedback.style.color = "";
    }
    _profileDeleteBusy = false;
  }, 1800);
}

function resetLocalSession() {
  window.EmmaChatAds?.session(null);
  _sessionRevision += 1;
  state.isLoggedIn = true;
  setProfileIcon(false);
  state.userProfile = {
    firstName: "",
    lastName: "",
    email: "",
    gender: "",
    genderValue: "",
    birthDate: "",
    authProvider: "local",
    hasLocalPassword: false,
    isSupporter: true,
    isDeveloper: true,
    has_active_subscription: true,
    accountType: "",
    creditBalance: 0,
  };
  _sessionLastRefreshedAt = Date.now();
  state.sessionResolved = true;
  updatePremiumPreferenceAccess();
  updateApiCtaForUser();
  closeProfileDrawer();
  resetEmptyState();
}

async function doLogout() {
  window.EmmaChatAds?.session(null);
  /* Logout reale (iter. 24): revoca il refresh token e pulisce il client; poi reset UI. */
  try {
    if (window.EmmaAuth) await window.EmmaAuth.logout();
  } catch (e) {
    /* best-effort */
  }
  resetLocalSession();
}

function openTerms() {
  closePrivacy(false);
  closeManifesto();
  closeGuardrails();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  document.body.classList.add("is-terms-open");
  el.termsBackdrop.hidden = false;
  el.termsModal.hidden = false;
}
function closeTerms() {
  if (!el.termsBackdrop || !el.termsModal) return;
  document.body.classList.remove("is-terms-open");
  el.termsBackdrop.hidden = true;
  el.termsModal.hidden = true;
}

var _privacyReturnFocus = null;
function openPrivacy(returnFocus) {
  if (!el.privacyBackdrop || !el.privacyModal) return;
  _privacyReturnFocus = returnFocus || document.activeElement;
  closeTerms();
  closeManifesto();
  closeGuardrails();
  document.body.classList.add("is-privacy-open");
  el.privacyBackdrop.hidden = false;
  el.privacyModal.hidden = false;
  el.privacyModal.setAttribute("aria-hidden", "false");
  window.setTimeout(function () {
    el.privacyClose?.focus();
  }, 0);
}
function closePrivacy(restoreFocus) {
  if (!el.privacyBackdrop || !el.privacyModal || el.privacyModal.hidden) return;
  document.body.classList.remove("is-privacy-open");
  el.privacyBackdrop.hidden = true;
  el.privacyModal.hidden = true;
  el.privacyModal.setAttribute("aria-hidden", "true");
  if (
    restoreFocus !== false &&
    _privacyReturnFocus &&
    typeof _privacyReturnFocus.focus === "function"
  ) {
    _privacyReturnFocus.focus();
  }
  _privacyReturnFocus = null;
}
function trapPrivacyFocus(event) {
  if (event.key !== "Tab" || !el.privacyModal || el.privacyModal.hidden) return;
  var focusable = Array.from(
    el.privacyModal.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(function (node) {
    return !node.disabled && !node.hidden;
  });
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openManifesto() {
  closeTerms();
  closePrivacy(false);
  closeGuardrails();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  document.body.classList.add("is-manifesto-open");
  el.manifestoBackdrop.hidden = false;
  el.manifestoModal.hidden = false;
}
function closeManifesto() {
  if (!el.manifestoBackdrop || !el.manifestoModal) return;
  document.body.classList.remove("is-manifesto-open");
  el.manifestoBackdrop.hidden = true;
  el.manifestoModal.hidden = true;
}

function openGuardrails() {
  closeTerms();
  closePrivacy(false);
  closeManifesto();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDownloadMenu();
  document.body.classList.add("is-guardrails-open");
  el.guardrailsBackdrop.hidden = false;
  el.guardrailsModal.hidden = false;
}
function closeGuardrails() {
  if (!el.guardrailsBackdrop || !el.guardrailsModal) return;
  document.body.classList.remove("is-guardrails-open");
  el.guardrailsBackdrop.hidden = true;
  el.guardrailsModal.hidden = true;
}

function openEmma4Features() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeInfo();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  document.body.classList.add("is-features-open");
  el.emma4FeaturesBackdrop.hidden = false;
  el.emma4FeaturesModal.hidden = false;
  el.emma4FeaturesModal.setAttribute("aria-hidden", "false");
}
function closeEmma4Features() {
  document.body.classList.remove("is-features-open");
  if (el.emma4FeaturesBackdrop) el.emma4FeaturesBackdrop.hidden = true;
  if (el.emma4FeaturesModal) el.emma4FeaturesModal.hidden = true;
  if (el.emma4FeaturesModal)
    el.emma4FeaturesModal.setAttribute("aria-hidden", "true");
}
function toggleEmma4Features() {
  if (el.emma4FeaturesModal?.hidden) openEmma4Features();
  else closeEmma4Features();
}

/* ── Emma-3 features modal ─────────────────── */
function openEmma3Features() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeInfo();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeEmma4Features();
  document.body.classList.add("is-features-open");
  el.emma3FeaturesBackdrop.hidden = false;
  el.emma3FeaturesModal.hidden = false;
  el.emma3FeaturesModal.setAttribute("aria-hidden", "false");
}
function closeEmma3Features() {
  document.body.classList.remove("is-features-open");
  if (el.emma3FeaturesBackdrop) el.emma3FeaturesBackdrop.hidden = true;
  if (el.emma3FeaturesModal) el.emma3FeaturesModal.hidden = true;
  if (el.emma3FeaturesModal)
    el.emma3FeaturesModal.setAttribute("aria-hidden", "true");
}

/* ── Emma-5 features modal ─────────────────── */
function openEmma5Features() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeInfo();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeEmma3Features();
  closeEmma4Features();
  document.body.classList.add("is-features-open");
  if (!el.emma5FeaturesBackdrop || !el.emma5FeaturesModal) return;
  el.emma5FeaturesBackdrop.hidden = false;
  el.emma5FeaturesModal.hidden = false;
  el.emma5FeaturesModal.setAttribute("aria-hidden", "false");
}
function closeEmma5Features() {
  document.body.classList.remove("is-features-open");
  if (el.emma5FeaturesBackdrop) el.emma5FeaturesBackdrop.hidden = true;
  if (el.emma5FeaturesModal) el.emma5FeaturesModal.hidden = true;
  if (el.emma5FeaturesModal)
    el.emma5FeaturesModal.setAttribute("aria-hidden", "true");
}

/* ── Emma-6 features modal ─────────────────── */
function openEmma6Features() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeInfo();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeEmma3Features();
  closeEmma4Features();
  closeEmma5Features();
  document.body.classList.add("is-features-open");
  if (!el.emma6FeaturesBackdrop || !el.emma6FeaturesModal) return;
  el.emma6FeaturesBackdrop.hidden = false;
  el.emma6FeaturesModal.hidden = false;
  el.emma6FeaturesModal.setAttribute("aria-hidden", "false");
}
function closeEmma6Features() {
  document.body.classList.remove("is-features-open");
  if (el.emma6FeaturesBackdrop) el.emma6FeaturesBackdrop.hidden = true;
  if (el.emma6FeaturesModal) el.emma6FeaturesModal.hidden = true;
  if (el.emma6FeaturesModal)
    el.emma6FeaturesModal.setAttribute("aria-hidden", "true");
}

/* ── Emma Business features modal ──────────── */
function openEmmaBusinessFeatures() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeInfo();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeEmma3Features();
  closeEmma4Features();
  closeEmma5Features();
  closeEmma6Features();
  document.body.classList.add("is-features-open");
  if (!el.emmaBusinessFeaturesBackdrop || !el.emmaBusinessFeaturesModal) return;
  el.emmaBusinessFeaturesBackdrop.hidden = false;
  el.emmaBusinessFeaturesModal.hidden = false;
  el.emmaBusinessFeaturesModal.setAttribute("aria-hidden", "false");
}
function closeEmmaBusinessFeatures() {
  document.body.classList.remove("is-features-open");
  if (el.emmaBusinessFeaturesBackdrop)
    el.emmaBusinessFeaturesBackdrop.hidden = true;
  if (el.emmaBusinessFeaturesModal) el.emmaBusinessFeaturesModal.hidden = true;
  if (el.emmaBusinessFeaturesModal)
    el.emmaBusinessFeaturesModal.setAttribute("aria-hidden", "true");
}

function openInfo() {
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  refreshInfoDrawer();
  document.body.classList.add("is-info-open");
  el.infoBackdrop.hidden = false;
  el.infoPanel.hidden = false;
}

function refreshInfoDrawer() {
  /* Popola la scheda info dal public_config del modello attivo. Il config arriva dal
       server-render (CFG.model) e viene aggiornato a ogni switch (data.config): niente
       POST ridondante a /api/models/switch solo per leggere i metadati. */
  const cfg = state.modelConfig || {};
  const put = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.textContent = val || "—";
  };
  put("infoModelName", cfg.display_name || currentModelLabel() + " LLM");
  put("infoArchitecture", cfg.architecture_label || "—");
  put("infoParams", cfg.parameter_label || "—");
  put("infoHiddenSize", cfg.hidden_size ? String(cfg.hidden_size) : "—");
  put(
    "infoAttnHeads",
    cfg.num_attention_heads ? String(cfg.num_attention_heads) + " (GQA)" : "—",
  );
  put(
    "infoLayers",
    cfg.num_hidden_layers ? String(cfg.num_hidden_layers) : "—",
  );
  put("infoContext", cfg.context_length ? cfg.context_length + " token" : "—");
  put("infoVocab", cfg.vocab_size ? cfg.vocab_size + " token (BPE)" : "—");
  put("infoFFDim", cfg.intermediate_size ? String(cfg.intermediate_size) : "—");
  put("infoRoPE", cfg.rope_theta ? String(cfg.rope_theta) : "—");
  put("infoNorm", cfg.norm_type ? cfg.norm_type.toUpperCase() : "—");
  put("infoActivation", cfg.activation ? cfg.activation.toUpperCase() : "—");
  put("infoAlignment", cfg.alignment || "—");
  put("infoTokenizer", "SentencePiece BPE");
  put("infoONNX", cfg.onnx_opset ? "ONNX (opset " + cfg.onnx_opset + ")" : "—");
}
function closeInfo() {
  document.body.classList.remove("is-info-open");
  el.infoBackdrop.hidden = true;
  el.infoPanel.hidden = true;
}
function toggleInfo() {
  document.body.classList.contains("is-info-open") ? closeInfo() : openInfo();
}

/* Hint del bottone disabilitato (richiesta cliente): il submit grigio senza spiegazione
   è UX muta — qui il form dice SEMPRE cosa manca per attivarlo. priorità: password →
   conferma → termini. ok=true → hint nascosto. */
function setCtaHint(hintEl, passwordOk, confirmOk, termsOk, hasPassword) {
  if (!hintEl) return;
  var msg = null;
  if (!passwordOk) {
    // Campo password ancora vuoto/intatto → niente nag sui requisiti password (nome,
    // email ecc. sono pure vuoti): messaggio generico. Il dettaglio dei requisiti
    // compare solo quando l'utente inizia a digitare la password (hasPassword).
    msg = hasPassword
      ? "Per completare: la password deve avere almeno 8 caratteri, con maiuscola, minuscola e numero."
      : "Per completare: compila i campi obbligatori (*).";
  } else if (!confirmOk) {
    msg = "Per completare: le due password devono coincidere.";
  }
  // T&C: nessun hint dedicato — il pulsante è già disabilitato finché non si spunta la
  // casella, quindi l'hint sarebbe ridondante (fix 04, brief 2026-06-16, #1/#7).
  hintEl.textContent = msg || "";
  hintEl.hidden = !msg;
}

function syncRegisterSubmit() {
  if (!el.registerSubmit || !el.registerTermsConsent) return;
  var passwordOk = validatePasswordStrength();
  var confirmOk = validatePasswordMatch();
  var termsOk = el.registerTermsConsent.checked;
  el.registerSubmit.disabled = !termsOk || !passwordOk || !confirmOk;
  setCtaHint(
    document.getElementById("registerCtaHint"),
    passwordOk,
    confirmOk,
    termsOk,
    !!(el.registerPassword && el.registerPassword.value),
  );
}

function validatePasswordStrength() {
  if (!el.registerPassword) return false;
  var pw = el.registerPassword.value;
  var hint = document.getElementById("registerPasswordHint");
  if (!pw) {
    if (hint) hint.hidden = true;
    return false;
  }
  var ok =
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
  if (hint) hint.hidden = ok;
  return ok;
}

function validatePasswordMatch() {
  if (!el.registerPassword || !el.registerConfirmPassword) return false;
  var pw = el.registerPassword.value;
  var confirm = el.registerConfirmPassword.value;
  var error = document.getElementById("registerConfirmPasswordError");
  if (!confirm) {
    if (error) error.hidden = true;
    return false;
  }
  var match = pw === confirm;
  if (error) error.hidden = match;
  return match;
}

/* Data di nascita: avviso IMMEDIATO sotto il campo, in rosso, appena si sceglie una data
   che dà meno di 18 anni (iter. 57 — prima si scopriva solo al submit, con un 422 dal BE:
   l'utente perdeva tempo a compilare il resto del form). */
function calcAge(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var today = new Date();
  var age = today.getFullYear() - d.getFullYear();
  var monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate()))
    age--;
  return age;
}
function validateBirthDate(input, errorEl) {
  if (!input || !errorEl) return true;
  var age = calcAge(input.value);
  if (age === null) {
    errorEl.hidden = true;
    return true;
  } // vuoto: il required lo blocca al submit
  var ok = age >= 18;
  errorEl.hidden = ok;
  return ok;
}

function resetRegisterForm() {
  el.registerForm?.reset();
  var birthErr = $("registerBirthDateError");
  if (birthErr) birthErr.hidden = true;
  setBetaConfirmStep(el.registerSubmit, false);
  setModalFeedback(el.registerFeedback, "", null, "register-form__feedback");
  syncRegisterSubmit();
}

function openRegisterModal(e) {
  syncRegisterSubmit(); // hint del bottone visibile da subito
  e?.stopPropagation();
  if (!el.registerModal || !el.registerBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeUserRegisterModal();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  resetRegisterForm();
  document.body.classList.add("is-register-open");
  el.registerBackdrop.hidden = false;
  el.registerModal.hidden = false;
  el.registerModal.setAttribute("aria-hidden", "false");
  window.setTimeout(
    () => document.getElementById("registerCompanyName")?.focus(),
    0,
  );
}

function closeRegisterModal() {
  if (!el.registerModal || !el.registerBackdrop) return;
  document.body.classList.remove("is-register-open");
  el.registerBackdrop.hidden = true;
  el.registerModal.hidden = true;
  el.registerModal.setAttribute("aria-hidden", "true");
  resetRegisterForm();
}

/* ── User Registration Modal (persona fisica) ── */
function resetUserRegisterForm() {
  el.userRegisterForm?.reset();
  if (el.userRegisterBirthDateError)
    el.userRegisterBirthDateError.hidden = true;
  setBetaConfirmStep(el.userRegisterSubmit, false);
  setModalFeedback(
    el.userRegisterFeedback,
    "",
    null,
    "user-register-form__feedback",
  );
  syncUserRegisterSubmit();
}

function syncUserRegisterSubmit() {
  if (!el.userRegisterSubmit || !el.userRegisterTermsConsent) return;
  var passwordOk = validateUserPasswordStrength();
  var confirmOk = validateUserPasswordMatch();
  var termsOk = el.userRegisterTermsConsent.checked;
  el.userRegisterSubmit.disabled = !termsOk || !passwordOk || !confirmOk;
  setCtaHint(
    document.getElementById("userRegisterCtaHint"),
    passwordOk,
    confirmOk,
    termsOk,
    !!(el.userRegisterPassword && el.userRegisterPassword.value),
  );
}

function validateUserPasswordStrength() {
  if (!el.userRegisterPassword) return false;
  var pw = el.userRegisterPassword.value;
  var hint = el.userRegisterPasswordHint;
  if (!pw) {
    if (hint) hint.hidden = true;
    return false;
  }
  var ok =
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
  if (hint) hint.hidden = ok;
  return ok;
}

function validateUserPasswordMatch() {
  if (!el.userRegisterPassword || !el.userRegisterConfirmPassword) return false;
  var pw = el.userRegisterPassword.value;
  var confirm = el.userRegisterConfirmPassword.value;
  var error = el.userRegisterConfirmPasswordError;
  if (!confirm) {
    if (error) error.hidden = true;
    return false;
  }
  var match = pw === confirm;
  if (error) error.hidden = match;
  return match;
}

function openUserRegisterModal(e) {
  syncUserRegisterSubmit(); // hint del bottone visibile da subito
  e?.stopPropagation();
  if (!el.userRegisterModal || !el.userRegisterBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeUserRegisterModal();
  closeProfileDrawer();
  closeProfileEditModal();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  resetUserRegisterForm();
  document.body.classList.add("is-user-register-open");
  el.userRegisterBackdrop.hidden = false;
  el.userRegisterModal.hidden = false;
  el.userRegisterModal.setAttribute("aria-hidden", "false");
  window.setTimeout(function () {
    el.userRegisterFirstName?.focus();
  }, 0);
}

function closeUserRegisterModal() {
  if (!el.userRegisterModal || !el.userRegisterBackdrop) return;
  document.body.classList.remove("is-user-register-open");
  el.userRegisterBackdrop.hidden = true;
  el.userRegisterModal.hidden = true;
  el.userRegisterModal.setAttribute("aria-hidden", "true");
  resetUserRegisterForm();
}

/* Registrazione persona fisica reale (iter. 24): POST /api/auth/register account_type=private */
async function handleUserRegisterSubmit(e) {
  e.preventDefault();
  if (!window.EmmaAuth) return;
  if (!el.userRegisterTermsConsent?.checked) return;
  if (!validateUserPasswordStrength()) {
    setModalFeedback(
      el.userRegisterFeedback,
      "La password non rispetta i requisiti.",
      "error",
      "user-register-form__feedback",
    );
    return;
  }
  if (!validateUserPasswordMatch()) {
    setModalFeedback(
      el.userRegisterFeedback,
      "Le password non coincidono.",
      "error",
      "user-register-form__feedback",
    );
    return;
  }
  var required = [
    [el.userRegisterFirstName, "Inserisci il nome."],
    [el.userRegisterLastName, "Inserisci il cognome."],
    [el.userRegisterBirthDate, "Inserisci la data di nascita."],
    [el.userRegisterEmail, "Inserisci l'email."],
  ];
  for (var i = 0; i < required.length; i++) {
    if (!(required[i][0]?.value || "").trim()) {
      setModalFeedback(
        el.userRegisterFeedback,
        required[i][1],
        "error",
        "user-register-form__feedback",
      );
      required[i][0]?.focus();
      return;
    }
  }
  var email = el.userRegisterEmail.value.trim();
  var password = el.userRegisterPassword?.value || "";
  var payload = {
    account_type: "private",
    email: email,
    password: password,
    first_name: el.userRegisterFirstName.value.trim(),
    last_name: el.userRegisterLastName.value.trim(),
    birth_date: el.userRegisterBirthDate.value,
    gender: el.userRegisterGender?.value || null,
    accept_terms: true,
    marketing_consent: !!el.userRegisterMarketingConsent?.checked,
    product_consent: !!el.userRegisterProductConsent?.checked,
  };
  if (betaConfirming(el.userRegisterSubmit))
    payload.confirm_beta_waitlist = true;
  setModalFeedback(
    el.userRegisterFeedback,
    "",
    null,
    "user-register-form__feedback",
  );
  setSubmitBusy(el.userRegisterSubmit, true, "Creazione…");
  var r = await window.EmmaAuth.register(payload);
  if (r.status !== 201) {
    setSubmitBusy(el.userRegisterSubmit, false, "");
    syncUserRegisterSubmit();
    var notice = betaConfirmationNotice(r);
    if (notice !== null) {
      setBetaConfirmStep(el.userRegisterSubmit, true);
      setModalFeedback(
        el.userRegisterFeedback,
        notice,
        null,
        "user-register-form__feedback",
      );
      return;
    }
    setModalFeedback(
      el.userRegisterFeedback,
      registerErrorMessage(r),
      "error",
      "user-register-form__feedback",
    );
    return;
  }
  if (r.data && r.data.beta_access_pending) {
    // Account in attesa della modalità Beta: niente login automatico, il server lo respinge.
    setSubmitBusy(el.userRegisterSubmit, false, "");
    resetUserRegisterForm();
    setModalFeedback(
      el.userRegisterFeedback,
      "Account creato. Al termine dell’attuale periodo di test riceverai una comunicazione per informarti della possibilità di accedere al servizio ed effettuare il login.",
      "success",
      "user-register-form__feedback",
    );
    // Il form azzerato chiederebbe di compilare i campi appena inviati: l'hint
    // torna alla prossima sincronizzazione, quando si riprende a compilare.
    var userHint = document.getElementById("userRegisterCtaHint");
    if (userHint) userHint.hidden = true;
    return;
  }
  var lr = await window.EmmaAuth.login(email, password);
  setSubmitBusy(el.userRegisterSubmit, false, "");
  if (lr.ok && lr.data && lr.data.otp_required) {
    // 2FA: l'account è creato; il codice si inserisce nello step OTP della modale login (iter. 24)
    closeUserRegisterModal();
    enterModalOtp(email, lr.data, async function () {
      var u = await window.EmmaAuth.me();
      applySession(u);
    });
    return;
  }
  if (lr.ok && lr.data && lr.data.access_token) {
    closeUserRegisterModal();
    var user = await window.EmmaAuth.me();
    applySession(user);
    return;
  }
  setModalFeedback(
    el.userRegisterFeedback,
    "Account creato. Ora accedi con le tue credenziali.",
    "success",
    "user-register-form__feedback",
  );
}

/* Registrazione azienda reale (iter. 24): POST /api/auth/register account_type=business → dashboard */
async function handleRegisterSubmit(e) {
  e.preventDefault();
  if (!window.EmmaAuth) return;
  if (!el.registerTermsConsent?.checked) return;
  if (!validatePasswordStrength()) {
    setModalFeedback(
      el.registerFeedback,
      "La password non rispetta i requisiti.",
      "error",
      "register-form__feedback",
    );
    return;
  }
  if (!validatePasswordMatch()) {
    setModalFeedback(
      el.registerFeedback,
      "Le password non coincidono.",
      "error",
      "register-form__feedback",
    );
    return;
  }
  var contactRole = $("registerRole") ? $("registerRole").value : "";
  if (!contactRole) {
    setModalFeedback(
      el.registerFeedback,
      "Seleziona il tuo ruolo.",
      "error",
      "register-form__feedback",
    );
    $("registerRole")?.focus();
    return;
  }
  var required = [
    ["registerCompanyName", "Inserisci la ragione sociale."],
    ["registerLegalAddress", "Inserisci la sede legale."],
    ["registerVat", "Inserisci la P. IVA."],
    ["registerUniqueCode", "Inserisci il codice univoco o PEC."],
    ["registerFirstName", "Inserisci il nome."],
    ["registerLastName", "Inserisci il cognome."],
    ["registerBirthDate", "Inserisci la data di nascita."],
    ["registerEmail", "Inserisci l'email."],
    ["registerPhone", "Inserisci il numero di telefono."],
  ];
  for (var i = 0; i < required.length; i++) {
    var f = $(required[i][0]);
    if (!(f?.value || "").trim()) {
      setModalFeedback(
        el.registerFeedback,
        required[i][1],
        "error",
        "register-form__feedback",
      );
      f?.focus();
      return;
    }
  }
  var email = $("registerEmail").value.trim();
  var password = $("registerPassword") ? $("registerPassword").value : "";
  var payload = {
    account_type: "business",
    email: email,
    password: password,
    first_name: $("registerFirstName").value.trim(),
    last_name: $("registerLastName").value.trim(),
    birth_date: $("registerBirthDate").value,
    phone: $("registerPhone").value.trim(),
    contact_role: contactRole,
    company_name: $("registerCompanyName").value.trim(),
    vat: $("registerVat").value.trim(),
    legal_address: $("registerLegalAddress").value.trim(),
    billing_code: $("registerUniqueCode").value.trim(),
    accept_terms: true,
    marketing_consent: !!$("registerMarketingConsent")?.checked,
    product_consent: !!$("registerProductConsent")?.checked,
  };
  if (betaConfirming(el.registerSubmit)) payload.confirm_beta_waitlist = true;
  setModalFeedback(el.registerFeedback, "", null, "register-form__feedback");
  setSubmitBusy(el.registerSubmit, true, "Registrazione…");
  var r = await window.EmmaAuth.register(payload);
  if (r.status !== 201) {
    setSubmitBusy(el.registerSubmit, false, "");
    syncRegisterSubmit();
    var notice = betaConfirmationNotice(r);
    if (notice !== null) {
      setBetaConfirmStep(el.registerSubmit, true);
      setModalFeedback(
        el.registerFeedback,
        notice,
        null,
        "register-form__feedback",
      );
      return;
    }
    setModalFeedback(
      el.registerFeedback,
      registerErrorMessage(r),
      "error",
      "register-form__feedback",
    );
    return;
  }
  if (r.data && r.data.beta_access_pending) {
    // Account in attesa della modalità Beta: niente login automatico, il server lo respinge.
    setSubmitBusy(el.registerSubmit, false, "");
    resetRegisterForm();
    setModalFeedback(
      el.registerFeedback,
      "Account creato. Al termine dell’attuale periodo di test riceverai una comunicazione per informarti della possibilità di accedere al servizio ed effettuare il login.",
      "success",
      "register-form__feedback",
    );
    // Il form azzerato chiederebbe di compilare i campi appena inviati: l'hint
    // torna alla prossima sincronizzazione, quando si riprende a compilare.
    var companyHint = document.getElementById("registerCtaHint");
    if (companyHint) companyHint.hidden = true;
    return;
  }
  var lr = await window.EmmaAuth.login(email, password);
  if (lr.ok && lr.data && lr.data.access_token) {
    window.EmmaAuth.redirect("/dashboard");
    return;
  }
  if (lr.ok && lr.data && lr.data.otp_required) {
    // 2FA: azienda creata; codice nello step OTP della modale, poi dashboard (iter. 24)
    setSubmitBusy(el.registerSubmit, false, "");
    closeRegisterModal();
    enterModalOtp(email, lr.data, function () {
      window.EmmaAuth.redirect("/dashboard");
    });
    return;
  }
  setSubmitBusy(el.registerSubmit, false, "");
  setModalFeedback(
    el.registerFeedback,
    "Account creato. Ora accedi con le tue credenziali.",
    "success",
    "register-form__feedback",
  );
}

function openTermsFromRegister(e) {
  e?.preventDefault();
  e?.stopPropagation();
  openTerms();
}

function resetLoginFeedback() {
  if (!el.loginFeedback) return;
  el.loginFeedback.hidden = true;
}

function openLoginUserModal(e) {
  e?.stopPropagation();
  if (!el.loginUserModal || !el.loginUserBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeRegisterModal();
  closeUserRegisterModal();
  closeProfileDrawer();
  closeProfileEditModal();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  resetLoginFeedback();
  document.body.classList.add("is-login-open");
  el.loginUserBackdrop.hidden = false;
  el.loginUserModal.hidden = false;
  el.loginUserModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => el.loginEmail?.focus(), 0);
}

function closeLoginUserModal() {
  if (!el.loginUserModal || !el.loginUserBackdrop) return;
  document.body.classList.remove("is-login-open");
  el.loginUserBackdrop.hidden = true;
  el.loginUserModal.hidden = true;
  el.loginUserModal.setAttribute("aria-hidden", "true");
  resetLoginFeedback();
  resetModalOtp(); // chiusa la modale, lo step 2FA riparte da zero (timer inclusi)
  showLoginForgotStep(false); // e anche lo step "Password dimenticata?" torna al login
  setLoginForgotFeedback("", null);
  if (el.loginForgotDev) el.loginForgotDev.hidden = true;
  var f = el.loginUserModal.querySelector("form");
  if (f) f.reset(); // niente credenziali precompilate alla prossima apertura (cambio account)
}

function handleLoginSubmit(e) {
  e.preventDefault();
  doLogin();
}

/* ── Company Login ──────────────────────────── */
function openCompanyLoginModal(e) {
  e?.stopPropagation();
  if (!el.companyLoginModal || !el.companyLoginBackdrop) return;
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  closeLoginUserModal();
  closeRegisterModal();
  closeUserRegisterModal();
  closeProfileDrawer();
  closeProfileEditModal();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  document.body.classList.add("is-login-open");
  el.companyLoginBackdrop.hidden = false;
  el.companyLoginModal.hidden = false;
  el.companyLoginModal.setAttribute("aria-hidden", "false");
  window.setTimeout(function () {
    el.companyLoginEmail?.focus();
  }, 0);
}

function closeCompanyLoginModal() {
  if (!el.companyLoginModal || !el.companyLoginBackdrop) return;
  document.body.classList.remove("is-login-open");
  el.companyLoginBackdrop.hidden = true;
  el.companyLoginModal.hidden = true;
  el.companyLoginModal.setAttribute("aria-hidden", "true");
  var f = el.companyLoginModal.querySelector("form");
  if (f) f.reset(); // niente credenziali precompilate alla prossima apertura (cambio account)
}

/* Login aziendale reale (iter. 24): stesso /api/auth/login, poi dritto in dashboard */
async function handleCompanyLoginSubmit(e) {
  e.preventDefault();
  if (!window.EmmaAuth) return;
  var email = el.companyLoginEmail?.value.trim() || "";
  var password = el.companyLoginPassword?.value || "";
  if (!email || !password) {
    setModalFeedback(
      el.companyLoginFeedback,
      "Inserisci email e password.",
      "error",
      "login-form__feedback",
    );
    return;
  }
  var remember =
    !el.companyLoginStayConnected || el.companyLoginStayConnected.checked;
  var submitBtn = el.companyLoginForm
    ? el.companyLoginForm.querySelector(".login-form__submit")
    : null;
  setModalFeedback(el.companyLoginFeedback, "", null, "login-form__feedback");
  setSubmitBusy(submitBtn, true, "Accesso…");
  var r = await window.EmmaAuth.login(email, password, { remember: remember });
  if (r.ok && r.data && r.data.access_token) {
    window.EmmaAuth.redirect("/dashboard");
    return;
  }
  if (r.ok && r.data && r.data.otp_required) {
    // 2FA: codice nello step OTP della modale login, poi dritto in dashboard (iter. 24)
    setSubmitBusy(submitBtn, false, "");
    closeCompanyLoginModal();
    enterModalOtp(email, r.data, function () {
      window.EmmaAuth.redirect("/dashboard");
    });
    return;
  }
  setSubmitBusy(submitBtn, false, "");
  setModalFeedback(
    el.companyLoginFeedback,
    loginErrorMessage(r),
    "error",
    "login-form__feedback",
  );
}

function openApiMenu() {
  if (!el.apiPanel || !el.apiBackdrop || !el.apiBtn) return;
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeDrawer();
  closeInfo();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  document.body.classList.add("is-api-open");
  el.apiBackdrop.hidden = false;
  el.apiPanel.hidden = false;
  el.apiBtn.setAttribute("aria-expanded", "true");
}

function closeApiMenu() {
  if (!el.apiPanel || !el.apiBackdrop || !el.apiBtn) return;
  document.body.classList.remove("is-api-open");
  el.apiBackdrop.hidden = true;
  el.apiPanel.hidden = true;
  el.apiBtn.setAttribute("aria-expanded", "false");
}

function toggleApiMenu(e) {
  e.stopPropagation();
  if (el.apiPanel?.hidden) openApiMenu();
  else closeApiMenu();
}

function openDownloadMenu() {
  if (!el.downloadMenu || !el.downloadBackdrop || !el.downloadBtn) return;
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  document.body.classList.add("is-download-open");
  el.downloadBackdrop.hidden = false;
  el.downloadMenu.hidden = false;
  el.downloadMenu.setAttribute("aria-hidden", "false");
  el.downloadBtn.setAttribute("aria-expanded", "true");
}

function closeDownloadMenu() {
  if (!el.downloadMenu || !el.downloadBtn) return;
  document.body.classList.remove("is-download-open");
  if (el.downloadBackdrop) el.downloadBackdrop.hidden = true;
  el.downloadMenu.hidden = true;
  el.downloadMenu.setAttribute("aria-hidden", "true");
  el.downloadBtn.setAttribute("aria-expanded", "false");
}

function toggleDownloadMenu(e) {
  e.stopPropagation();
  if (el.downloadMenu?.hidden) openDownloadMenu();
  else closeDownloadMenu();
}

function openFineTuningMenu() {
  if (!el.fineTuningMenu || !el.fineTuningBackdrop || !el.fineTuningBtn) return;
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeDrawer();
  closeInfo();
  closeApiMenu();
  closeDownloadMenu();
  closeProductsMenu();
  document.body.classList.add("is-fine-tuning-open");
  el.fineTuningBackdrop.hidden = false;
  el.fineTuningMenu.hidden = false;
  el.fineTuningMenu.setAttribute("aria-hidden", "false");
  el.fineTuningBtn.setAttribute("aria-expanded", "true");
}

function closeFineTuningMenu() {
  if (!el.fineTuningMenu || !el.fineTuningBtn) return;
  document.body.classList.remove("is-fine-tuning-open");
  if (el.fineTuningBackdrop) el.fineTuningBackdrop.hidden = true;
  el.fineTuningMenu.hidden = true;
  el.fineTuningMenu.setAttribute("aria-hidden", "true");
  el.fineTuningBtn.setAttribute("aria-expanded", "false");
}

function toggleFineTuningMenu(e) {
  e.stopPropagation();
  if (el.fineTuningMenu?.hidden) openFineTuningMenu();
  else closeFineTuningMenu();
}

// --- Contributi al training (RF-12): invio reale al backend ----------------
var CONTRIBUTION_ENDPOINT = "/api/contributions";
var CONTRIBUTION_ERROR_MSG =
  "Invio non riuscito. Controlla la connessione e riprova.";

var MAINT_MSG =
  "Manutenzione in corso: il salvataggio è temporaneamente disattivato. Riprova tra poco.";
// Messaggio "parlante" su 503 (iter. 21/22): preferisce il `detail` reale del backend
// (es. "Manutenzione in corso…" oppure "Raccolta contributi temporaneamente sospesa.").
function maint503(r) {
  return r && r.status === 503 ? (r.data && r.data.detail) || MAINT_MSG : null;
}

// Il feedback HTML nasce col testo "grazie": lo salvo una volta, poi mostro success o errore.
// `overrideMsg` (opzionale) sostituisce il messaggio d'errore generico (es. il 503 di manutenzione).
function setContributionFeedback(feedbackEl, kind, overrideMsg) {
  if (!feedbackEl) return;
  if (feedbackEl.dataset.successText === undefined) {
    feedbackEl.dataset.successText = feedbackEl.textContent;
  }
  var isError = kind === "error";
  feedbackEl.textContent = isError
    ? overrideMsg || CONTRIBUTION_ERROR_MSG
    : feedbackEl.dataset.successText;
  feedbackEl.classList.toggle("contribution-form__feedback--error", isError);
  feedbackEl.hidden = false;
}

function setContributionBusy(submitEl, on) {
  if (!submitEl) return;
  if (on && submitEl.dataset.idleLabel === undefined) {
    submitEl.dataset.idleLabel = submitEl.textContent;
  }
  submitEl.classList.toggle("is-loading", on);
  submitEl.disabled = on;
  submitEl.textContent = on
    ? "Invio…"
    : submitEl.dataset.idleLabel || submitEl.textContent;
}

// EmmaAuth.apiFetch allega il token se loggato (contributo associato); anonimo altrimenti.
async function postContribution(body) {
  if (window.EmmaAuth && typeof window.EmmaAuth.apiFetch === "function") {
    return window.EmmaAuth.apiFetch(CONTRIBUTION_ENDPOINT, {
      method: "POST",
      body: body,
    });
  }
  try {
    var res = await fetch(CONTRIBUTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, networkError: false };
  } catch (e) {
    return { ok: false, status: 0, networkError: true };
  }
}

// GET di un item da servire a rotazione (iter. 15). Allega il token se loggato (escl. già fatte
// lato server); `exclude` porta gli id già visti in questa sessione (best-effort anonimo).
async function fetchTrainingItem(path, excludeIds) {
  var qs =
    excludeIds && excludeIds.length
      ? "?exclude=" + encodeURIComponent(excludeIds.join(","))
      : "";
  var url = path + qs;
  try {
    if (window.EmmaAuth && typeof window.EmmaAuth.apiFetch === "function") {
      var r = await window.EmmaAuth.apiFetch(url);
      return { ok: r.ok, data: r.data, networkError: !!r.networkError };
    }
    var res = await fetch(url, { headers: { Accept: "application/json" } });
    var data = await res.json().catch(function () {
      return null;
    });
    return { ok: res.ok, data: data, networkError: false };
  } catch (e) {
    return { ok: false, data: null, networkError: true };
  }
}

// --- "Rispondi": serve una domanda reale dal dataset (iter. 15) ---
function setAnswerSample(text) {
  if (el.answerSampleQuestion) el.answerSampleQuestion.textContent = text;
}
async function loadAnswerQuestion() {
  state.answerItem = null;
  setAnswerSample("Carico una domanda…");
  syncAnswerContributionSubmit();
  var r = await fetchTrainingItem(
    "/api/contributions/next-question",
    state.answerSeenIds,
  );
  if (!r.ok || !r.data) {
    setAnswerSample("Impossibile caricare una domanda. Riprova più tardi.");
    syncAnswerContributionSubmit();
    return;
  }
  if (!r.data.item) {
    setAnswerSample(
      "Nessuna domanda disponibile al momento. Torna più tardi: ne aggiungiamo di nuove.",
    );
    syncAnswerContributionSubmit();
    return;
  }
  state.answerItem = r.data.item;
  setAnswerSample(r.data.item.text);
  syncAnswerContributionSubmit();
}

// --- "Valuta": serve una coppia domanda+risposta reale dal dataset (iter. 15) ---
function setEvalSample(question, answer) {
  if (el.evaluationSampleQuestion)
    el.evaluationSampleQuestion.textContent = question;
  if (el.evaluationSampleAnswer) el.evaluationSampleAnswer.textContent = answer;
}
async function loadEvalPair() {
  state.evalItem = null;
  setEvalSample("Carico uno scambio…", "");
  syncEvaluationContributionSubmit();
  var r = await fetchTrainingItem(
    "/api/contributions/next-qa",
    state.evalSeenIds,
  );
  if (!r.ok || !r.data) {
    setEvalSample("Impossibile caricare uno scambio. Riprova più tardi.", "");
    syncEvaluationContributionSubmit();
    return;
  }
  if (!r.data.item) {
    setEvalSample(
      "Nessuno scambio disponibile al momento. Torna più tardi.",
      "",
    );
    syncEvaluationContributionSubmit();
    return;
  }
  state.evalItem = r.data.item;
  setEvalSample(r.data.item.question, r.data.item.answer);
  syncEvaluationContributionSubmit();
}

function resetPretrainingContributionFeedback() {
  if (!el.pretrainingContributionFeedback) return;
  el.pretrainingContributionFeedback.hidden = true;
}

function syncPretrainingContributionSubmit() {
  if (!el.pretrainingContributionSubmit || !el.pretrainingContributionConsent)
    return;
  el.pretrainingContributionSubmit.disabled =
    !el.pretrainingContributionConsent.checked;
}

function resetPretrainingContributionConsent() {
  if (el.pretrainingContributionConsent)
    el.pretrainingContributionConsent.checked = false;
  syncPretrainingContributionSubmit();
}

function clearPretrainingContributionCloseTimer() {
  if (!state.contributionCloseTimer) return;
  window.clearTimeout(state.contributionCloseTimer);
  state.contributionCloseTimer = null;
}

function openPretrainingContributionModal(e) {
  e?.stopPropagation();
  if (!el.pretrainingContributionModal || !el.pretrainingContributionBackdrop)
    return;
  clearPretrainingContributionCloseTimer();
  closeDrawer();
  closeInfo();
  closeQuestionContributionModal();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  resetPretrainingContributionFeedback();
  resetPretrainingContributionConsent();
  document.body.classList.add("is-contribution-open");
  el.pretrainingContributionBackdrop.hidden = false;
  el.pretrainingContributionModal.hidden = false;
  el.pretrainingContributionModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => el.pretrainingContributionTextarea?.focus(), 0);
}

function closePretrainingContributionModal() {
  if (!el.pretrainingContributionModal || !el.pretrainingContributionBackdrop)
    return;
  clearPretrainingContributionCloseTimer();
  document.body.classList.remove("is-contribution-open");
  el.pretrainingContributionBackdrop.hidden = true;
  el.pretrainingContributionModal.hidden = true;
  el.pretrainingContributionModal.setAttribute("aria-hidden", "true");
  resetPretrainingContributionFeedback();
  resetPretrainingContributionConsent();
}

async function handlePretrainingContributionSubmit(e) {
  e.preventDefault();
  var text = (el.pretrainingContributionTextarea?.value || "").trim();
  if (!text || !el.pretrainingContributionConsent?.checked) return;
  clearPretrainingContributionCloseTimer();
  setContributionBusy(el.pretrainingContributionSubmit, true);
  var r = await postContribution({
    type: "pretraining_text",
    content: text,
    consent: true,
  });
  setContributionBusy(el.pretrainingContributionSubmit, false);
  if (!r.ok) {
    setContributionFeedback(
      el.pretrainingContributionFeedback,
      "error",
      maint503(r),
    );
    return;
  }
  setContributionFeedback(el.pretrainingContributionFeedback, "success");
  el.pretrainingContributionTextarea.value = "";
  resetPretrainingContributionConsent();
  state.contributionCloseTimer = window.setTimeout(() => {
    closePretrainingContributionModal();
  }, 2500);
}

function resetQuestionContributionFeedback() {
  if (!el.questionContributionFeedback) return;
  el.questionContributionFeedback.hidden = true;
}

function syncQuestionContributionSubmit() {
  if (!el.questionContributionSubmit || !el.questionContributionConsent) return;
  el.questionContributionSubmit.disabled =
    !el.questionContributionConsent.checked;
}

function resetQuestionContributionConsent() {
  if (el.questionContributionConsent)
    el.questionContributionConsent.checked = false;
  syncQuestionContributionSubmit();
}

function clearQuestionContributionCloseTimer() {
  if (!state.questionCloseTimer) return;
  window.clearTimeout(state.questionCloseTimer);
  state.questionCloseTimer = null;
}

function openQuestionContributionModal(e) {
  e?.stopPropagation();
  if (!el.questionContributionModal || !el.questionContributionBackdrop) return;
  clearQuestionContributionCloseTimer();
  closeDrawer();
  closeInfo();
  closePretrainingContributionModal();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  resetQuestionContributionFeedback();
  resetQuestionContributionConsent();
  document.body.classList.add("is-contribution-open");
  el.questionContributionBackdrop.hidden = false;
  el.questionContributionModal.hidden = false;
  el.questionContributionModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => el.questionContributionTextarea?.focus(), 0);
}

function closeQuestionContributionModal() {
  if (!el.questionContributionModal || !el.questionContributionBackdrop) return;
  clearQuestionContributionCloseTimer();
  document.body.classList.remove("is-contribution-open");
  el.questionContributionBackdrop.hidden = true;
  el.questionContributionModal.hidden = true;
  el.questionContributionModal.setAttribute("aria-hidden", "true");
  resetQuestionContributionFeedback();
  resetQuestionContributionConsent();
}

async function handleQuestionContributionSubmit(e) {
  e.preventDefault();
  var text = (el.questionContributionTextarea?.value || "").trim();
  if (!text || !el.questionContributionConsent?.checked) return;
  clearQuestionContributionCloseTimer();
  setContributionBusy(el.questionContributionSubmit, true);
  var r = await postContribution({
    type: "ft_question",
    content: text,
    consent: true,
  });
  setContributionBusy(el.questionContributionSubmit, false);
  if (!r.ok) {
    setContributionFeedback(
      el.questionContributionFeedback,
      "error",
      maint503(r),
    );
    return;
  }
  setContributionFeedback(el.questionContributionFeedback, "success");
  el.questionContributionTextarea.value = "";
  resetQuestionContributionConsent();
  state.questionCloseTimer = window.setTimeout(() => {
    closeQuestionContributionModal();
  }, 2500);
}

function resetAnswerContributionFeedback() {
  if (!el.answerContributionFeedback) return;
  el.answerContributionFeedback.hidden = true;
}

function syncAnswerContributionSubmit() {
  if (!el.answerContributionSubmit || !el.answerContributionConsent) return;
  // Disabilitato anche senza un item caricato (rotazione iter. 15: loading/empty/error).
  el.answerContributionSubmit.disabled =
    !el.answerContributionConsent.checked || !state.answerItem;
}

function resetAnswerContributionConsent() {
  if (el.answerContributionConsent)
    el.answerContributionConsent.checked = false;
  syncAnswerContributionSubmit();
}

function clearAnswerContributionCloseTimer() {
  if (!state.answerCloseTimer) return;
  window.clearTimeout(state.answerCloseTimer);
  state.answerCloseTimer = null;
}

function openAnswerContributionModal(e) {
  e?.stopPropagation();
  if (!el.answerContributionModal || !el.answerContributionBackdrop) return;
  clearAnswerContributionCloseTimer();
  closeDrawer();
  closeInfo();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeEvaluationContributionModal();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  resetAnswerContributionFeedback();
  resetAnswerContributionConsent();
  document.body.classList.add("is-contribution-open");
  el.answerContributionBackdrop.hidden = false;
  el.answerContributionModal.hidden = false;
  el.answerContributionModal.setAttribute("aria-hidden", "false");
  loadAnswerQuestion();
  window.setTimeout(() => el.answerContributionTextarea?.focus(), 0);
}

function closeAnswerContributionModal() {
  if (!el.answerContributionModal || !el.answerContributionBackdrop) return;
  clearAnswerContributionCloseTimer();
  document.body.classList.remove("is-contribution-open");
  el.answerContributionBackdrop.hidden = true;
  el.answerContributionModal.hidden = true;
  el.answerContributionModal.setAttribute("aria-hidden", "true");
  resetAnswerContributionFeedback();
  resetAnswerContributionConsent();
}

async function handleAnswerContributionSubmit(e) {
  e.preventDefault();
  var text = (el.answerContributionTextarea?.value || "").trim();
  if (!text || !el.answerContributionConsent?.checked || !state.answerItem)
    return;
  clearAnswerContributionCloseTimer();
  setContributionBusy(el.answerContributionSubmit, true);
  // Riferimento alla domanda servita (id + testo) → il record risposta è tracciabile (iter. 15).
  var body = {
    type: "ft_answer",
    content: text,
    consent: true,
    payload: {
      question_id: state.answerItem.id,
      question: state.answerItem.text,
    },
  };
  var r = await postContribution(body);
  setContributionBusy(el.answerContributionSubmit, false);
  if (!r.ok) {
    setContributionFeedback(
      el.answerContributionFeedback,
      "error",
      maint503(r),
    );
    return;
  }
  if (state.answerSeenIds.indexOf(state.answerItem.id) === -1)
    state.answerSeenIds.push(state.answerItem.id);
  setContributionFeedback(el.answerContributionFeedback, "success");
  el.answerContributionTextarea.value = "";
  resetAnswerContributionConsent();
  state.answerCloseTimer = window.setTimeout(() => {
    closeAnswerContributionModal();
  }, 2500);
}

function resetEvaluationContributionFeedback() {
  if (!el.evaluationContributionFeedback) return;
  el.evaluationContributionFeedback.hidden = true;
}

function syncEvaluationContributionSubmit() {
  if (!el.evaluationContributionSubmit || !el.evaluationContributionConsent)
    return;
  el.evaluationContributionSubmit.disabled =
    !el.evaluationContributionConsent.checked ||
    !state.evaluationRating ||
    !state.evalItem;
}

function resetEvaluationContributionConsent() {
  if (el.evaluationContributionConsent)
    el.evaluationContributionConsent.checked = false;
  syncEvaluationContributionSubmit();
}

function selectEvaluationRating(button) {
  const rating = Number(button?.dataset?.rating || 0);
  if (!rating) return;
  state.evaluationRating = rating;
  el.evaluationRatingOptions.forEach((option) => {
    const isSelected = option === button;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
  resetEvaluationContributionFeedback();
  syncEvaluationContributionSubmit();
}

function resetEvaluationRating() {
  state.evaluationRating = null;
  el.evaluationRatingOptions.forEach((option) => {
    option.classList.remove("is-selected");
    option.setAttribute("aria-pressed", "false");
  });
  syncEvaluationContributionSubmit();
}

function clearEvaluationContributionCloseTimer() {
  if (!state.evaluationCloseTimer) return;
  window.clearTimeout(state.evaluationCloseTimer);
  state.evaluationCloseTimer = null;
}

function openEvaluationContributionModal(e) {
  e?.stopPropagation();
  if (!el.evaluationContributionModal || !el.evaluationContributionBackdrop)
    return;
  clearEvaluationContributionCloseTimer();
  closeDrawer();
  closeInfo();
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeApiMenu();
  closeDownloadMenu();
  closeFineTuningMenu();
  closeProductsMenu();
  closeTerms();
  closeManifesto();
  closeGuardrails();
  resetEvaluationContributionFeedback();
  resetEvaluationContributionConsent();
  document.body.classList.add("is-contribution-open");
  el.evaluationContributionBackdrop.hidden = false;
  el.evaluationContributionModal.hidden = false;
  el.evaluationContributionModal.setAttribute("aria-hidden", "false");
  resetEvaluationRating();
  loadEvalPair();
}

function closeEvaluationContributionModal() {
  if (!el.evaluationContributionModal || !el.evaluationContributionBackdrop)
    return;
  clearEvaluationContributionCloseTimer();
  document.body.classList.remove("is-contribution-open");
  el.evaluationContributionBackdrop.hidden = true;
  el.evaluationContributionModal.hidden = true;
  el.evaluationContributionModal.setAttribute("aria-hidden", "true");
  resetEvaluationContributionFeedback();
  resetEvaluationContributionConsent();
  resetEvaluationRating();
}

async function handleEvaluationContributionSubmit(e) {
  e.preventDefault();
  if (
    !state.evaluationRating ||
    !el.evaluationContributionConsent?.checked ||
    !state.evalItem
  )
    return;
  clearEvaluationContributionCloseTimer();
  setContributionBusy(el.evaluationContributionSubmit, true);
  // content = la risposta valutata (dal dataset); payload = voto + riferimento alla coppia (iter. 15).
  var payload = {
    rating: state.evaluationRating,
    qa_id: state.evalItem.id,
    question: state.evalItem.question,
  };
  var r = await postContribution({
    type: "rlhf_evaluation",
    content: state.evalItem.answer,
    payload: payload,
    consent: true,
  });
  setContributionBusy(el.evaluationContributionSubmit, false);
  if (!r.ok) {
    setContributionFeedback(
      el.evaluationContributionFeedback,
      "error",
      maint503(r),
    );
    return;
  }
  if (state.evalSeenIds.indexOf(state.evalItem.id) === -1)
    state.evalSeenIds.push(state.evalItem.id);
  setContributionFeedback(el.evaluationContributionFeedback, "success");
  resetEvaluationContributionConsent();
  resetEvaluationRating();
  state.evaluationCloseTimer = window.setTimeout(() => {
    closeEvaluationContributionModal();
  }, 2500);
}

function openProductsMenu() {
  if (!el.productsMenu || !el.productsBackdrop || !el.productsBtn) return;
  closePretrainingContributionModal();
  closeQuestionContributionModal();
  closeAnswerContributionModal();
  closeEvaluationContributionModal();
  closeLoginUserModal();
  closeCompanyLoginModal();
  closeRegisterModal();
  closeDrawer();
  closeInfo();
  closeFineTuningMenu();
  closeApiMenu();
  closeDownloadMenu();
  document.body.classList.add("is-products-open");
  el.productsBackdrop.hidden = false;
  el.productsMenu.hidden = false;
  el.productsMenu.setAttribute("aria-hidden", "false");
  el.productsBtn.setAttribute("aria-expanded", "true");
}

function closeProductsMenu() {
  if (!el.productsMenu || !el.productsBtn) return;
  document.body.classList.remove("is-products-open");
  if (el.productsBackdrop) el.productsBackdrop.hidden = true;
  el.productsMenu.hidden = true;
  el.productsMenu.setAttribute("aria-hidden", "true");
  el.productsBtn.setAttribute("aria-expanded", "false");
}

function toggleProductsMenu(e) {
  e.stopPropagation();
  if (el.productsMenu?.hidden) openProductsMenu();
  else closeProductsMenu();
}

function handleOutsideClick() {}

/* ── chat logic ──────────────────────────────── */
function openLimitModal() {
  return;
}

function closeLimitModal() {
  if (!el.limitModal || !el.limitBackdrop) return;
  document.body.classList.remove("is-limit-open");
  el.limitBackdrop.hidden = true;
  el.limitModal.hidden = true;
  el.limitModal.setAttribute("aria-hidden", "true");
}

function newConversationId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function")
    return window.crypto.randomUUID();
  /* Fallback RFC4122-ish per browser datati */
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function resetChat() {
  window.EmmaChatAds?.conversation(null);
  if (state.generating) abortGen();
  hideComposerFeedback();
  hideChatGuardrailNotice();
  closeLimitModal();
  state.messageCount = 0;
  state.conversationId = newConversationId(); // nuova chat = nuovo thread (iter. 24)
  window.EmmaChatAds?.conversation(state.conversationId);
  state.history = [];
  state.meta = null;
  el.messages.innerHTML = "";
  el.messages.appendChild(el.emptyState);
  el.emptyState.classList.remove("hidden");
  updateMetrics();
  el.telemetry.hidden = true;
  el.input.focus();
}

function setLoading(v) {
  state.generating = v;
  window.EmmaChatAds?.generating(v);
  document.body.classList.toggle("is-generating", v);
  el.send.disabled = v;
  el.stop.disabled = !v;
  el.input.disabled = v;
}

function hideEmpty() {
  el.emptyState.classList.add("hidden");
  el.telemetry.hidden = false;
}

/* Fonti web (iter. 52): stile "citazioni numerate" (scelta utente 2026-06-19).
   Marcatori ¹²³ cliccabili dopo la risposta + riga "Fonti:" col DOMINIO (non il titolo
   lungo) numerato e cliccabile. Idempotente: rieseguito, sostituisce il blocco precedente. */
function renderWebSources(art, sources) {
  if (!art || !Array.isArray(sources) || !sources.length) return;
  // Dedup per URL + estrai un dominio pulito (senza www).
  var items = [];
  var seen = {};
  sources.forEach(function (src) {
    var url = src && src.url ? String(src.url) : "";
    if (!url || seen[url]) return;
    seen[url] = true;
    var domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {}
    items.push({
      url: url,
      domain: domain,
      title: (src.title && String(src.title).trim()) || domain,
    });
  });
  if (!items.length) return;

  // 1) Marcatori di citazione inline dopo la risposta (¹ ² ³), cliccabili → aprono la fonte.
  var content = art.querySelector(".message__content");
  if (content) {
    var oldMarks = content.querySelector(".web-cites");
    if (oldMarks) oldMarks.remove();
    var marks = document.createElement("sup");
    marks.className = "web-cites";
    items.forEach(function (it, i) {
      var m = document.createElement("a");
      m.className = "web-cite";
      m.href = it.url;
      m.target = "_blank";
      m.rel = "noopener noreferrer";
      m.textContent = String(i + 1);
      m.title = it.domain + " — " + it.title;
      marks.appendChild(m);
    });
    content.appendChild(marks);
  }

  // 2) Riga "Fonti:" sotto la risposta — numero + dominio, cliccabile (titolo nel tooltip).
  var existing = art.querySelector(".web-sources");
  if (existing) existing.remove();
  var wrap = document.createElement("div");
  wrap.className = "web-sources";
  var label = document.createElement("span");
  label.className = "web-sources__label";
  label.textContent = "Fonti:";
  wrap.appendChild(label);
  items.forEach(function (it, i) {
    var a = document.createElement("a");
    a.className = "web-source-cite";
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = it.title;
    // Favicon del sito (servizio Google, sz=32). onerror → nasconde l'icona
    // così non resta il segnaposto rotto se il dominio non ne ha una.
    var fav = document.createElement("img");
    fav.className = "web-source-cite__favicon";
    fav.src =
      "https://www.google.com/s2/favicons?sz=32&domain=" +
      encodeURIComponent(it.domain);
    fav.alt = "";
    fav.width = 16;
    fav.height = 16;
    fav.loading = "lazy";
    fav.referrerPolicy = "no-referrer";
    fav.addEventListener("error", function () {
      this.style.display = "none";
    });
    a.appendChild(fav);
    var num = document.createElement("span");
    num.className = "web-source-cite__num";
    num.textContent = String(i + 1);
    a.appendChild(num);
    a.appendChild(document.createTextNode(it.domain));
    wrap.appendChild(a);
  });
  const footer = art.querySelector(".message__footer");
  art.insertBefore(wrap, footer || null);
}

function createLoadingNode() {
  const loader = document.createElement("aside");
  loader.className = "message__loading";
  loader.hidden = true;
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-atomic", "true");
  loader.innerHTML =
    '<span class="message__loading-shield" aria-hidden="true"><svg width="16" height="17" viewBox="0 0 22 24" fill="none"><path d="M11 1.75 19 5v5.85c0 5.02-3.2 9.55-8 11.4-4.8-1.85-8-6.38-8-11.4V5l8-3.25Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="11" cy="11" r="2.25" stroke="currentColor" stroke-width="1.8"/></svg></span><img src="/img/emma_loading.gif" alt="" class="message__loading-gif" aria-hidden="true" hidden /><span class="message__loading-label">Emma Guardrails sta verificando il prompt…</span>';
  loader.dataset.stage = "guardrail";
  return loader;
}

function setMessageLoadingStage(reply, stage) {
  const loader = reply && reply.loader;
  if (!loader) return;
  const shield = loader.querySelector(".message__loading-shield");
  const emma = loader.querySelector(".message__loading-gif");
  const label = loader.querySelector(".message__loading-label");
  const guardrail = stage === "guardrail";
  loader.dataset.stage = guardrail ? "guardrail" : stage;
  if (shield) shield.hidden = !guardrail;
  if (emma) emma.hidden = guardrail;
  if (!label) return;
  if (guardrail)
    label.textContent = "Emma Guardrails sta verificando il prompt…";
  else if (stage === "searching") label.textContent = "Sto consultando il web…";
  else label.textContent = "Emma sta elaborando…";
}

function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText)
    return navigator.clipboard.writeText(value);

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

function renderAssistantContent(target, text) {
    const raw = String(text == null ? "" : text);
    if (window.EmmaChatRenderer) {
        window.EmmaChatRenderer.renderFinal(target, raw, {
            codeIntent: Boolean(state.meta && state.meta.code_intent),
            outputMetadata: target._emmaOutputMetadata || null,
            copyText: copyTextToClipboard,
        });
        return;
    }

  /* Fail-safe: se l'asset del renderer non è disponibile, il contenuto resta
       leggibile come testo. Non manteniamo un secondo parser divergente. */
  target.replaceChildren(document.createTextNode(raw));
  target.dataset.raw = raw;
  target.classList.remove(
    "message__content--md",
    "message__content--with-code",
  );
  target.closest(".message")?.classList.remove("message--with-code");
}

/* Disclaimer sotto la risposta (iter. 58, per categoria dalla iter. 86) ────────
   Il testo dipende dalla categoria Guardrails del prompt, decisa dal pre-check e
   recapitata dallo stream sugli eventi `meta`/`done`. L'icona "i" accompagna solo
   il testo generico. Le conversazioni riaperte non trasportano la categoria e
   restano quindi sul generico. */
const GENERIC_AI_DISCLAIMER =
  "Contenuto generato da Emma6, contiene sicuramente errori";

function renderAssistantDisclaimer(node, text, withInfo) {
  if (!node) return;
  node.textContent = GENERIC_AI_DISCLAIMER;
}

function showAssistantDisclaimer(reply, text, withInfo) {
  if (!reply.disclaimer) return;
  renderAssistantDisclaimer(reply.disclaimer, text, withInfo);
  reply.disclaimer.hidden = false;
  syncAssistantFooterVisibility(reply);
}

function setAssistantFeedbackVisibility(reply, visible) {
  const hidden = !visible;
  if (reply.thumbsUpBtn) reply.thumbsUpBtn.hidden = hidden;
  if (reply.thumbsDownBtn) reply.thumbsDownBtn.hidden = hidden;
  syncAssistantFooterVisibility(reply);
}

function setAssistantFeedbackSubmitted(reply, rating) {
  setAssistantFeedbackVisibility(reply, true);
  [
    [reply.thumbsUpBtn, "up"],
    [reply.thumbsDownBtn, "down"],
  ].forEach(function (entry) {
    var button = entry[0];
    var value = entry[1];
    if (!button) return;
    var selected = value === rating;
    button.disabled = true;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.setAttribute(
      "title",
      selected ? "Feedback inviato" : "Feedback già inviato",
    );
  });
}

function syncAssistantFooterVisibility(reply) {
  if (!reply.footer) return;
  const controls = [
    reply.disclaimer,
    reply.thumbsUpBtn,
    reply.thumbsDownBtn,
    reply.copyBtn,
  ];
  reply.footer.hidden = controls.every((control) => !control || control.hidden);
}

function addMsg(role, text, meta) {
  hideEmpty();
  const art = document.createElement("article");
  art.className = `message message--${role}`;

  const hdr = document.createElement("header");
  hdr.className = "message__header";
  const rl = document.createElement("span");
  rl.className = "message__role";
  const mt = document.createElement("span");
  mt.className = "message__meta";

  if (role === "user") {
    mt.textContent = "Tu";
    hdr.appendChild(mt);
  } else {
    rl.textContent = currentModelLabel();
    mt.textContent = meta || "";
    hdr.appendChild(rl);
    hdr.appendChild(mt);
  }
  const ct = document.createElement("section");
  ct.className = "message__content";
  if (role === "assistant") renderAssistantContent(ct, text);
  else ct.textContent = text;

  art.appendChild(hdr);
  art.appendChild(ct);
  const loader = role === "assistant" ? createLoadingNode() : null;
  if (loader) loader.hidden = Boolean(text);

  if (loader) art.appendChild(loader);
  el.messages.appendChild(art);
  el.messages.scrollTop = el.messages.scrollHeight;

  /* Container azioni (feedback + copia) */
  const actions = document.createElement("div");
  actions.className = "message__actions";

  /* Pulsante pollice su */
  const thumbsUpBtn = document.createElement("button");
  thumbsUpBtn.className = "message__feedback-btn";
  thumbsUpBtn.type = "button";
  thumbsUpBtn.setAttribute("aria-label", "Feedback positivo");
  thumbsUpBtn.setAttribute("aria-pressed", "false");
  thumbsUpBtn.setAttribute("title", "Risposta utile");
  thumbsUpBtn.innerHTML = '<img src="/img/pollice_su.png" alt="Pollice su" />';
  thumbsUpBtn.hidden = true;

  /* Pulsante pollice giù */
  const thumbsDownBtn = document.createElement("button");
  thumbsDownBtn.className = "message__feedback-btn";
  thumbsDownBtn.type = "button";
  thumbsDownBtn.setAttribute("aria-label", "Feedback negativo");
  thumbsDownBtn.setAttribute("aria-pressed", "false");
  thumbsDownBtn.setAttribute("title", "Risposta non utile");
  thumbsDownBtn.innerHTML =
    '<img src="/img/pollice_giu.png" alt="Pollice giù" />';
  thumbsDownBtn.hidden = true;

  /* Pulsante copia: nascosto durante lo stream, visibile a fine risposta non vuota. */
  const copyBtn = document.createElement("button");
  copyBtn.className = "message__copy";
  copyBtn.type = "button";
  copyBtn.setAttribute("aria-label", "Copia risposta");
  copyBtn.setAttribute("title", "Copia la risposta");
  const copySvgDefault =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  const copySvgSuccess =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  copyBtn.innerHTML = copySvgDefault;
  copyBtn.hidden = true;
  copyBtn.addEventListener("click", async () => {
    const contentEl = copyBtn
      .closest(".message")
      ?.querySelector(".message__content");
    const raw = contentEl?.dataset?.raw;
    const text = typeof raw === "string" ? raw : contentEl?.textContent || "";
    try {
      await copyTextToClipboard(text);
      copyBtn.innerHTML = copySvgSuccess;
      showFeedbackToast("Copiato negli appunti");
      setTimeout(() => {
        copyBtn.innerHTML = copySvgDefault;
      }, 1800);
    } catch (_) {
      showFeedbackToast("Impossibile copiare", true);
    }
  });

  /* Disclaimer AI (iter. 58): nei nuovi stream nasce nascosto e compare solo a
       inferenza conclusa, indipendentemente dai feedback. Le risposte già concluse
       caricate dalla cronologia lo mostrano subito. */
  let disclaimer = null;
  let footer = null;
  if (role === "assistant") {
    footer = document.createElement("footer");
    footer.className = "message__footer";
    footer.hidden = true;
    disclaimer = document.createElement("p");
    disclaimer.className = "message__disclaimer";
    renderAssistantDisclaimer(disclaimer, "", false);
    disclaimer.hidden = true;
    footer.appendChild(disclaimer);
  }

  actions.appendChild(thumbsUpBtn);
  actions.appendChild(thumbsDownBtn);
  actions.appendChild(copyBtn);
  if (footer) {
    footer.appendChild(actions);
    art.appendChild(footer);
  } else {
    art.appendChild(actions);
  }

  const reply = {
    art,
    ct,
    mt,
    loader,
    copyBtn,
    thumbsUpBtn,
    thumbsDownBtn,
    disclaimer,
    footer,
    rawText: String(text || ""),
    renderFrame: null,
  };
  if (disclaimer && String(text || "").trim()) disclaimer.hidden = false;
  syncAssistantFooterVisibility(reply);
  thumbsUpBtn.addEventListener("click", () => sendChatFeedback(reply, "up"));
  thumbsDownBtn.addEventListener("click", () =>
    sendChatFeedback(reply, "down"),
  );
  return reply;
}

function updateMsg(t, text, meta, options) {
  const shouldFollowBottom = window.EmmaChatRenderer?.isNearScrollEnd
    ? window.EmmaChatRenderer.isNearScrollEnd(el.messages)
    : el.messages.scrollHeight -
        el.messages.clientHeight -
        el.messages.scrollTop <=
      72;
  const isAssistant = t.art?.classList.contains("message--assistant");
  const finalRender = Boolean(options && options.final);
  t.rawText = String(text == null ? "" : text);
  if (isAssistant && !finalRender && window.EmmaChatRenderer) {
    window.EmmaChatRenderer.renderStreaming(t.ct, t.rawText);
  } else if (isAssistant) renderAssistantContent(t.ct, t.rawText);
  else t.ct.textContent = text;
  if (meta) t.mt.textContent = meta;
  t.ct.classList.toggle("is-streaming", state.generating);
  if (t.loader) t.loader.hidden = !state.generating;
  if (shouldFollowBottom) el.messages.scrollTop = el.messages.scrollHeight;
}

function scheduleStreamingUpdate(reply, text) {
  reply.rawText = String(text == null ? "" : text);
  if (reply.renderFrame !== null) return;
  reply.renderFrame = window.requestAnimationFrame(function () {
    reply.renderFrame = null;
    updateMsg(reply, reply.rawText, null, { final: false });
  });
}

function finalizeMessageRender(reply, text) {
  if (reply.renderFrame !== null) {
    window.cancelAnimationFrame(reply.renderFrame);
    reply.renderFrame = null;
  }
  updateMsg(reply, text, null, { final: true });
}

function updateRagDebug(stats) {
  if (!el.ragDebug) return;
  const meta = state.meta || {};
  const shouldShow =
    RAG_DEBUG_ENABLED && Boolean(meta.type || stats.retrieval_confidence);
  el.ragDebug.hidden = !shouldShow;
  if (!shouldShow) return;

  const confidence =
    stats.retrieval_confidence || meta.retrieval_confidence || "absent";
  const used = meta.rag_used ? "usato" : "saltato";
  const titles = Array.isArray(meta.rag_chunk_titles)
    ? meta.rag_chunk_titles.join(", ")
    : "";
  const detail = titles || meta.retrieval_confidence_detail || "";
  txt(el.ragMetricState, `${used}/${confidence}`);
  txt(el.ragMetricDetail, detail ? `(${detail})` : "");
}

function updateMetrics(s) {
  s = s || {};
  txt(el.pTokens, s.prompt_tokens ?? state.meta?.prompt_tokens ?? "—");
  txt(el.oTokens, s.output_tokens ?? "—");
  if (el.prefillSpeed) txt(el.prefillSpeed, s.prefill_tok_s != null ? s.prefill_tok_s : "—");
  if (el.decodeSpeed) txt(el.decodeSpeed, s.decode_tok_s != null ? s.decode_tok_s : "—");
  txt(
    el.latency,
    s.generation_ms ? `${(Number(s.generation_ms) / 1000).toFixed(2)}` : "—",
  );
  txt(el.latencyUnit, s.generation_ms ? " secondi" : "");
  if (el.metricTemp) txt(el.metricTemp, s.temperature != null ? Number(s.temperature).toFixed(2) : "0.70");
  if (el.metricTopP) txt(el.metricTopP, s.top_p != null ? Number(s.top_p).toFixed(2) : "0.90");
  if (el.metricRepP) txt(el.metricRepP, s.rep_penalty != null ? Number(s.rep_penalty).toFixed(2) : "1.10");
  updateRagDebug(s);
}

async function readChatGuardrailError(response) {
  if (response.status !== 422 && response.status !== 503) return null;
  try {
    const body = await response.clone().json();
    const detail = body && body.detail;
    if (!detail || typeof detail !== "object") return null;
    if (
      detail.code !== "prompt_blocked" &&
      detail.code !== "guardrail_unavailable" &&
      detail.code !== "guardrail_audit_unavailable"
    )
      return null;
    const fallbackMessage =
      detail.code === "prompt_blocked"
        ? "Non posso elaborare questo messaggio perché non supera i controlli di sicurezza."
        : "Il controllo di sicurezza non è disponibile in questo momento. Riprova tra poco.";
    return {
      code: detail.code,
      message:
        typeof detail.message === "string" ? detail.message : fallbackMessage,
      category: typeof detail.category === "string" ? detail.category : "",
      categoryDescription:
        typeof detail.category_description === "string"
          ? detail.category_description
          : "",
      exchangeId:
        typeof detail.exchange_id === "string" ? detail.exchange_id : "",
    };
  } catch (_) {
    return null;
  }
}

async function readChatCapacityError(response) {
  if (response.status !== 503) return null;
  try {
    const body = await response.clone().json();
    const detail = body && body.detail;
    if (!detail || typeof detail !== "object") return null;
    if (detail.code !== "inference_capacity_reached") return null;
    return {
      code: detail.code,
      message:
        typeof detail.message === "string"
          ? detail.message
          : "Emma è al momento alla massima capacità. Riprova tra poco.",
    };
  } catch (_) {
    return null;
  }
}

function restoreBlockedChatAttempt(
  userMessage,
  reply,
  message,
  guardrailError,
) {
  userMessage?.art?.remove();
  reply?.art?.remove();
  if (!el.messages.querySelector(".message")) {
    el.emptyState.classList.remove("hidden");
    el.telemetry.hidden = true;
  }
  el.input.value = message;
  autoGrow();
  showChatGuardrailNotice(guardrailError);
  focusGuardrailComposer();
}

function restoreCapacityAttempt(userMessage, reply, message, capacityError) {
  userMessage?.art?.remove();
  reply?.art?.remove();
  if (!el.messages.querySelector(".message")) {
    el.emptyState.classList.remove("hidden");
    el.telemetry.hidden = true;
  }
  el.input.value = message;
  autoGrow();
  showComposerError(capacityError.message);
  el.input.focus();
}

/* ── submit & stream ─────────────────────────── */
async function onSubmit(e) {
  e.preventDefault();
  if (state.generating) return;
  window.EmmaChatAds?.conversation(state.conversationId);
  hideComposerFeedback();
  const msg = el.input.value;
  if (!msg.trim()) return;
  hideChatGuardrailNotice();

  // Self-hosted: no registration wall or limits
  // Gating removed

  var limit = getMaxInputLength();
  if (msg.length > limit) {
    showComposerFeedback(currentModelLabel(), limit);
    el.input.focus();
    return;
  }

  const activePreset = selectedPreset();
  const outputFormat = window.EmmaJsonOutput?.requestsJsonOnly(msg)
    ? "json"
    : "text";
  const selectedModel = state.availableModels.find(
    (model) => model.key === state.modelKey,
  );
  if (
    outputFormat === "json" &&
    !(selectedModel?.output_formats || []).includes("json")
  ) {
    showComposerError(
      "Il JSON vincolato richiede Emma-6. Scegli Emma-6 oppure modifica la richiesta per una risposta normale.",
    );
    return;
  }
  const payload = {
    message: msg,
    output_format: outputFormat,
    // Keep raw history intact; a blank/incomplete JSON answer is not a valid
    // ChatTurn. Omit only that empty context entry, never rewrite its source.
    history: el.historyToggle.checked
      ? state.history
          .filter((turn) => turn.assistant.trim())
          .slice(-historyTurnCap())
      : [],
    use_history: el.historyToggle.checked,
    use_rag: el.ragToggle ? el.ragToggle.checked : true,
    mode: selectedMode(),
    preset: (Boolean(window.__isThinking) || Boolean(state.isThinking)) ? "thinking" : activePreset,
    model_key: state.modelKey,
    conversation_id: state.conversationId, // thread (iter. 24): aggancia lo scambio alla chat corrente
  };
  /* Gli slider sono indicatori in sola lettura: il server applica i valori del
       preset per il modello scelto, quindi non li inviamo (2026-10-09). */
  if (el.lengthMode?.value === "manual")
    payload.max_new_tokens = Number(el.mRange.value);

  const userMessage = addMsg("user", msg);
  const reply = addMsg("assistant", "");
  reply.ct.classList.add("is-streaming");
  const promptCheckDisplay = new Promise((resolve) => {
    window.setTimeout(resolve, PROMPT_CHECK_VISIBLE_MS);
  });

  el.input.value = "";
  autoGrow();
  state.abort = new AbortController();
  setLoading(true);

  let final = "";
  let pendingStopSuffix = "";
  try {
    // La chat richiede autenticazione: allego il token così il preflight server-side
    // può autorizzare e classificare il prompt prima di caricare il modello.
    const headers = { "Content-Type": "application/json" };
    let token =
      window.EmmaAuth && window.EmmaAuth.getToken
        ? window.EmmaAuth.getToken()
        : null;
    if (token) headers["Authorization"] = "Bearer " + token;
    let res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      signal: state.abort.signal,
    });

    // Guard server-side (iter. 56): la chat web senza autenticazione riceve 401. Se un
    // token ERA presente, non è detto sia un anonimo vero: il BE può aver rifiutato un
    // access token scaduto silenziosamente (iter. 14). Un solo refresh silenzioso + un
    // solo retry, MAI un loop: se riesce, l'utente già registrato resta trasparente al
    // nuovo guard e non vede mai il popup di registrazione.
    if (
      res.status === 401 &&
      token &&
      window.EmmaAuth &&
      typeof window.EmmaAuth.refresh === "function"
    ) {
      const refreshed = await window.EmmaAuth.refresh();
      if (refreshed) {
        token = window.EmmaAuth.getToken();
        if (token) headers["Authorization"] = "Bearer " + token;
        res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
          signal: state.abort.signal,
        });
      }
    }
    if (res.status === 401) {
      setLoading(false);
      reply.ct.classList.remove("is-streaming");
      updateMsg(
        reply,
        "Impossibile avviare la chat: errore di connessione col backend.",
      );
      return;
    }
    await promptCheckDisplay;
    const capacityError = await readChatCapacityError(res);
    if (capacityError) {
      setLoading(false);
      restoreCapacityAttempt(userMessage, reply, msg, capacityError);
      return;
    }
    const guardrailError = await readChatGuardrailError(res);
    if (guardrailError) {
      setLoading(false);
      restoreBlockedChatAttempt(userMessage, reply, msg, guardrailError);
      return;
    }
    if (!res.ok || !res.body) {
      let detail;
      try {
        detail = (await res.json()).detail;
      } catch (_) {
        /* generic fallback */
      }
      throw Object.assign(
        new Error(
          typeof detail === "string"
            ? detail
            : res.status === 422
              ? "La richiesta non è valida. Controlla il testo e le impostazioni."
              : "Backend non raggiungibile.",
        ),
        { userFacing: true },
      );
    }

    /* `fetch` riceve gli header soltanto dopo che la dependency Guardrails ha
           autorizzato il prompt. La verifica resta visibile per i 2 secondi UX
           concordati; da questo punto l'attesa appartiene al runtime generativo. */
    setMessageLoadingStage(reply, "inference");

    await window.EmmaChatStream.consume(res, (ev) => {
      /* Ricerca web (iter. 52): il server emette `searching` PRIMA di consultare il
                   web → il loader lo annuncia durante l'attesa ("stato in corso parlante"). */
      if (ev.type === "searching") {
        setMessageLoadingStage(reply, "searching");
        return;
      }
      /* Ai primi token ripristina l'etichetta standard del loader. */
      if ((ev.type === "delta" || ev.type === "update") && reply.loader) {
        setMessageLoadingStage(reply, "inference");
      }

      if (ev.type === "meta") {
        state.meta = ev;
        updateMetrics(ev);
      }
      if (ev.type === "update") {
        final = typeof ev.content === "string" ? ev.content : final;
        // Not preview text: keep ambiguous stop prefixes only for cancellation.
        pendingStopSuffix =
          typeof ev.pending_suffix === "string" ? ev.pending_suffix : "";
        scheduleStreamingUpdate(reply, final);
      }
      if (ev.type === "delta") {
        final += ev.content;
        scheduleStreamingUpdate(reply, final);
      }
      if (ev.type === "done") {
        pendingStopSuffix = "";
        final = typeof ev.response === "string" ? ev.response : final;
        reply.ct._emmaOutputMetadata = ev.output_metadata || null;
        window.EmmaChatStream.setStatus(reply.art, ev.generation_metadata);
        state.history.push({ user: msg, assistant: final });
        setLoading(false);
        reply.ct.classList.remove("is-streaming");
        /* Aggiorna il ruolo con il nome del modello corrente */
        const roleEl = reply.art?.querySelector(".message__role");
        if (roleEl) roleEl.textContent = currentModelLabel();
        finalizeMessageRender(
          reply,
          outputFormat === "json" ? final : final || "[nessun contenuto]",
        );
        updateMetrics(ev.stats || {});
        /* Id dello scambio salvato (iter. 24): abilita il voto coi pollici.
                       Assente se il flag be:chat-history è OFF → niente da votare. */
        if (ev.exchange_id && reply.art)
          reply.art.dataset.exchangeId = ev.exchange_id;
        /* Fonti web (iter. 52): se la ricerca web ha prodotto contesto, le citiamo
                       sotto la risposta come chip cliccabili. Nessuna fonte → nessun chip. */
        if (
          ev.web_used &&
          Array.isArray(ev.web_sources) &&
          ev.web_sources.length
        ) {
          renderWebSources(reply.art, ev.web_sources);
        }
        /* La copia dipende dal testo disponibile, non dai token. Il feedback dipende
                       soltanto dallo scambio salvato; il disclaimer compare su ogni
                       risposta, ma soltanto a inferenza conclusa. */
        if (reply.copyBtn) reply.copyBtn.hidden = !final.trim();
        /* Disclaimer per categoria (iter. 86): scelto dal pre-check Guardrails
                       e applicato prima che il footer diventi visibile. */
        showAssistantDisclaimer(
          reply,
          ev.guardrail_disclaimer,
          ev.guardrail_disclaimer_info === true,
        );
        const feedbackVisible = Boolean(ev.exchange_id);
        setAssistantFeedbackVisibility(reply, feedbackVisible);
        window.EmmaChatAds?.terminal({
          conversation: payload.conversation_id,
          anchor: reply.art,
          text: final,
          reason: ev.generation_metadata?.stop_reason,
        });
        /* Contatore messaggi: al limite per chat (7 anonimi / 20 loggati gratuiti)
                       mostra il modal — registrati (anonimo) o nuova chat (loggato). Oltre,
                       il submit resta bloccato (iter. 24). */
        state.messageCount += 1;
      }
    });
  } catch (err) {
    const ab = err.name === "AbortError";
    /* setLoading PRIMA di updateMsg: con state.generating ancora true il loader
           verrebbe rimostrato (t.loader.hidden = !state.generating) e resterebbe appeso. */
    setLoading(false);
    reply.ct.classList.remove("is-streaming");
    if (outputFormat === "json") {
      reply.ct._emmaOutputMetadata = {
        format: "json",
        complete: false,
        syntax: "not_checked",
        stop_reason: ab ? "cancelled" : "error",
        warnings: [],
      };
    }
    finalizeMessageRender(reply, final + pendingStopSuffix);
    window.EmmaChatStream.setStatus(reply.art, {
      stop_reason: ab
        ? "cancelled"
        : err.name === "PrematureEOFError"
          ? "disconnected"
          : "error",
    });
    /* Solo i testi scritti per l'utente; rete, browser o bug restano nella console. */
    if (!ab) {
      if (!err?.userFacing) console.error("Chat interrotta:", err);
      showComposerError(
        err?.userFacing
          ? err.message
          : "Si è verificato un errore. Riprova tra poco.",
      );
    }
  } finally {
    state.abort = null;
    setLoading(false);
    el.input.disabled = false;
    el.input.focus();
  }
}
function abortGen() {
  state.abort?.abort();
}

/* ── Neural network canvas ───────────────────── */

/* ── Cookie / Termini banner ─────────────────── */

/* ── Toast notifica store ───────────────────── */
var _storeToastTimer = null;
var _feedbackToastTimer = null;

function showFeedbackToast(message, isError) {
  const toast = document.getElementById("feedbackToast");
  if (!toast) return;
  // iter. 31: toast riusabile — default "Grazie per il feedback" (pollici),
  // messaggio custom per il copia; variante rossa per l'errore clipboard.
  const textEl = toast.querySelector(".feedback-toast__text");
  if (textEl) textEl.textContent = message || "Grazie per il feedback";
  toast.classList.toggle("feedback-toast--error", !!isError);
  if (_feedbackToastTimer) {
    clearTimeout(_feedbackToastTimer);
    _feedbackToastTimer = null;
  }
  toast.hidden = false;
  _feedbackToastTimer = setTimeout(function () {
    toast.hidden = true;
    _feedbackToastTimer = null;
  }, 3000);
}

/* ── Feedback sulla risposta (iter. 24): il pollice viene SALVATO sullo scambio ──
   L'id arriva dall'evento `done` dello stream (o dal dettaglio conversazione per le chat
   riaperte). Ownership lato BE: vota solo chi ha generato lo scambio (utente o emma_sid).
   Best-effort: il toast appare comunque, l'eventuale errore non disturba la chat. */
function sendChatFeedback(reply, rating) {
  setAssistantFeedbackSubmitted(reply, rating);
  showFeedbackToast();
  var art = reply && reply.art;
  var exchangeId = art && art.dataset ? art.dataset.exchangeId : null;
  if (!exchangeId) return; // flag be:chat-history OFF: nessuna riga da votare
  postChatFeedback(exchangeId, rating);
}

function postChatFeedback(exchangeId, rating) {
  var body = { exchange_id: exchangeId, rating: rating };
  if (window.EmmaAuth && typeof window.EmmaAuth.apiFetch === "function") {
    window.EmmaAuth.apiFetch("/api/chat/feedback", {
      method: "POST",
      body: body,
    }).catch(function () {});
  } else {
    fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).catch(function () {});
  }
}

function showStoreToast() {
  if (!el.storeToast) return;
  if (_storeToastTimer) {
    clearTimeout(_storeToastTimer);
    _storeToastTimer = null;
  }
  el.storeToast.hidden = false;
  _storeToastTimer = setTimeout(function () {
    el.storeToast.hidden = true;
    _storeToastTimer = null;
  }, 3000);
}

/* Scelta del banner cookie/termini: "accepted" = tutti i cookie (lo stesso valore del vecchio
   «Accetto e proseguo»), "necessary" = solo i necessari. null finché non si sceglie. */
function cookieChoice() {
  try {
    var value =
      localStorage.getItem("emma_consent") ||
      sessionStorage.getItem("emma_consent");
    return value === "accepted" || value === "necessary" ? value : null;
  } catch (e) {
    return null;
  }
}

function initConsentBanner() {
  if (!el.consentBanner || !el.consentAccept) return;
  var choice = cookieChoice();
  if (choice) {
    try {
      localStorage.setItem("emma_consent", choice);
    } catch (e) {}
    el.consentBanner.hidden = true;
    return;
  }
  el.consentBanner.hidden = false;
  el.consentAccept.addEventListener("click", function () {
    recordCookieChoice("accepted", "cookie_terms");
  });
  el.consentNecessary?.addEventListener("click", function () {
    recordCookieChoice("necessary", "cookie_terms_necessary");
  });
}

function recordCookieChoice(value, kind) {
  try {
    localStorage.setItem("emma_consent", value);
  } catch (e) {}
  el.consentBanner.hidden = true;
  /* Registro consensi a DB (iter. 24, GDPR art. 7): best-effort, non blocca la UX.
       Loggato → associato all'utente (token via apiFetch); anonimo → cookie emma_sid.
       Il tipo dice quale scelta è stata fatta. */
  var body = { kind: kind };
  if (window.EmmaAuth && typeof window.EmmaAuth.apiFetch === "function") {
    window.EmmaAuth.apiFetch("/api/consents", {
      method: "POST",
      body: body,
    }).catch(function () {});
  } else {
    fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).catch(function () {});
  }
}

function initNeuralCanvas() {
  const cv = el.canvas;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  let w,
    h,
    nodes = [],
    RAF;

  function resize() {
    w = cv.width = window.innerWidth;
    h = cv.height = window.innerHeight;
    seed();
  }
  function seed() {
    const count = Math.max(18, Math.floor((w * h) / 28000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: 2 + Math.random() * 2.5,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    const maxDist = 160;

    // links
    ctx.strokeStyle = "rgba(11,146,133,.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x,
          dy = nodes[i].y - nodes[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < maxDist) {
          ctx.globalAlpha = 1 - d / maxDist;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    // nodes
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(11,146,133,.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(11,146,133,.32)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    RAF = requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}

/* ── Pricing pubblico del pannello API (iter. 24) ──
   Gli importi in euro arrivano dal listino reale del back office (GET /api/pricing):
   niente più numeri hardcoded nel template. Fallback: restano i placeholder "€—". */
function formatEur(value) {
  var n = Number(value);
  if (!isFinite(n)) return "—";
  return (
    "€" +
    n.toLocaleString("it-IT", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 4,
    })
  );
}

function initApiPricing() {
  var inEl = $("apiPriceInput"),
    outEl = $("apiPriceOutput");
  if (!inEl && !outEl) return;
  fetch("/api/pricing")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (p) {
      if (!p) return;
      if (inEl) inEl.textContent = formatEur(p.eur_per_1m_input);
      if (outEl) outEl.textContent = formatEur(p.eur_per_1m_output);
    })
    .catch(function () {
      /* placeholder "€—" se il BE non risponde */
    });
}

/* ── Google OAuth nella modale login (iter. 18/24) ──
   Il pulsante compare solo se il provider è configurato e attivo dal back office. */
function initGoogleLoginButton() {
  var buttons = [el.loginGoogleBtn, el.userRegisterGoogleBtn].filter(Boolean);
  if (!buttons.length) return;
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      window.location.assign("/api/auth/google/login");
    });
  });
  fetch("/api/auth/google/status")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (s) {
      if (s && s.enabled) {
        buttons.forEach(function (btn) {
          btn.hidden = false;
        });
        if (el.userRegisterGoogleHint) el.userRegisterGoogleHint.hidden = false;
        if (el.loginGoogleHint) el.loginGoogleHint.hidden = false;
        if (el.loginGoogleDivider) el.loginGoogleDivider.hidden = false;
      }
    })
    .catch(function () {});
}

/* ── boot ────────────────────────────────────── */
function createChatAds() {
  let runtime = null;
  function disableAds() {
    const previous = runtime;
    runtime = null;
    try {
      previous?.dispose();
    } catch (_) {
      /* cleanup best effort */
    }
    try {
      if (window.adsbygoogle) window.adsbygoogle.pauseAdRequests = 1;
    } catch (_) {}
    el.messages.querySelectorAll(".chat-ad").forEach((node) => node.remove());
    ["adsPreviewBtn", "adsPreferencesBtn"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.hidden = true;
        button.setAttribute("aria-pressed", "false");
      }
    });
  }
  try {
    runtime = window.EmmaAdsRuntime?.create({
      panel: el.messages,
      apiFetch: (...args) => window.EmmaAuth.apiFetch(...args),
      /* Con «Accetto solo i Cookie necessari», o prima di una scelta, il tag pubblicitario
         non viene caricato. «Tutti» non vale come consenso Google: decide la CMP. */
      cookiesAllowed: () => cookieChoice() === "accepted",
    });
  } catch (_) {
    disableAds();
  }
  if (!runtime) return null;
  const boundary = {};
  [
    "session",
    "uncertain",
    "conversation",
    "generating",
    "terminal",
    "dispose",
  ].forEach((method) => {
    boundary[method] = (...args) => {
      try {
        const result = runtime?.[method](...args);
        if (result?.then) return Promise.resolve(result).catch(disableAds);
        return result;
      } catch (_) {
        disableAds();
      }
    };
  });
  return Object.freeze(boundary);
}
window.EmmaChatAds = createChatAds();
state.conversationId = newConversationId(); // thread della prima chat (iter. 24)
window.EmmaChatAds?.conversation(state.conversationId);
init();
initModelSelector();
initSession();
initGoogleLoginButton();
initApiPricing();
/* Applica il tuning del modello attivo (clamps slider, default history, hint) */
if (window.APP_CONFIG && window.APP_CONFIG.model) {
  applyModelTuning(window.APP_CONFIG.model);
}

/* ── model selector ─────────────────────────── */
/* Handler centralizzato per cambio modello dal dropdown */
function switchToModel(newKey) {
  if (newKey === state.modelKey) return;

  /* Mostra rotellina di caricamento */
  if (el.modelPill) el.modelPill.classList.add("is-switching");

  /* Ferma un'eventuale generazione in corso; il reset di history/contatori avviene
       SOLO nel ramo success (resetChat) — azzerarli qui, prima della fetch, perdeva il
       contesto e azzerava il limite messaggi anche quando lo switch falliva. */
  if (state.generating) abortGen();

  /* Switch modello via API */
  fetch("/api/models/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_key: newKey }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (el.modelPill) el.modelPill.classList.remove("is-switching");
      if (data.error || data.detail) {
        console.error("Model switch error:", data.error || data.detail);
        updateModelDropdown(); /* ripristina selezione visiva */
        return;
      }
      state.modelKey = newKey;
      state.modelConfig = data.config || null;
      /* Reset override utente: nuovo modello = nuovi default sensati (anche la
           preferenza memoria salvata decade: vale il default del nuovo modello) */
      state.historyUserOverride = false;
      clearPref("useHistory");
      updateMaxLength();
      hideComposerFeedback();
      updateBarBadge(data.config);
      updateModelDropdown();
      applyModelTuning(data.config);
      /* Riallinea gli slider ai preset TUNED del nuovo modello (senza, restavano
           coi valori del modello precedente finché non si ricliccava un preset) */
      applyPreset(selectedPreset());
      updatePresetDescription();
      updatePremiumPreferenceAccess();
      refreshInfoDrawer();
      resetChat();
    })
    .catch((err) => {
      if (el.modelPill) el.modelPill.classList.remove("is-switching");
      console.error("Model switch failed:", err);
      updateModelDropdown();
    });
}

function updateModelDropdown() {
  const dropdown = el.modelDropdown;
  if (!dropdown) return;
  const items = dropdown.querySelectorAll(".bar__model-dropdown-item");
  items.forEach((item) => {
    const key = item.dataset.modelKey;
    item.classList.toggle("is-active", key === state.modelKey);
    item.setAttribute(
      "aria-selected",
      key === state.modelKey ? "true" : "false",
    );
  });
  /* Aggiorna anche la pill label */
  const pillLabel = el.modelPillLabel;
  if (pillLabel) {
    pillLabel.textContent = currentModelLabel();
  }
}

function toggleModelDropdown() {
  const dropdown = el.modelDropdown;
  const pill = el.modelPill;
  if (!dropdown || !pill) return;

  const isOpen = !dropdown.hidden;
  if (isOpen) {
    dropdown.hidden = true;
    pill.classList.remove("is-open");
    pill.setAttribute("aria-expanded", "false");
  } else {
    /* Chiudi altri menu aperti */
    closeDrawer();
    closeInfo();
    closeApiMenu();
    closeDownloadMenu();
    closeFineTuningMenu();
    closeProductsMenu();
    updateModelDropdown();
    dropdown.hidden = false;
    pill.classList.add("is-open");
    pill.setAttribute("aria-expanded", "true");
  }
}

function closeModelDropdown() {
  const dropdown = el.modelDropdown;
  const pill = el.modelPill;
  if (dropdown) dropdown.hidden = true;
  if (pill) {
    pill.classList.remove("is-open");
    pill.setAttribute("aria-expanded", "false");
  }
}

function initModelSelector() {
  updateBarBadge(CFG.model);

  /* Riconcilia con la lista autoritativa del BE: runnable AND abilitati dal back office,
       più il default EFFETTIVO (se il default dichiarato non ha i pesi, la pill si allinea). */
  fetch("/api/models")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.models)) return;
      state.availableModels = data.models;
      var keys = data.models.map(function (m) {
        return m.key;
      });
      if (keys.indexOf(state.modelKey) === -1) {
        state.modelKey = data.effective || keys[0] || state.modelKey;
      }
      updateBarBadge(state.modelConfig);
      updateModelDropdown();
    })
    .catch(function () {
      /* offline: la pill resta sul server-render */
    });

  /* Chiudi il dropdown al click fuori */
  document.addEventListener("click", (e) => {
    const pill = el.modelPill;
    const dropdown = el.modelDropdown;
    if (!pill || !dropdown) return;
    if (!pill.contains(e.target) && !dropdown.contains(e.target)) {
      closeModelDropdown();
    }
  });

  /* Chiudi il dropdown con Escape */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.modelDropdown && !el.modelDropdown.hidden) {
      closeModelDropdown();
    }
  });
}

function updateBarBadge(modelInfo) {
  const badge = document.getElementById("barBadge");
  if (!badge) return;

  const paramLabel = modelInfo?.parameter_label || "";
  const currentLabel = currentModelLabel();

  /* Ricostruisci il badge preservando la struttura del dropdown custom */
  badge.innerHTML =
    "" +
    '<span class="bar__badge-prefix">Stai chattando con</span>' +
    '<span class="bar__model-pill" id="modelPill" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Modello attuale: ' +
    currentLabel +
    '">' +
    '<span class="bar__model-pill-label" id="modelPillLabel">' +
    currentLabel +
    "</span>" +
    '<span class="bar__model-pill-chevron" aria-hidden="true">' +
    '<svg class="bar__model-pill-chevron-icon" width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg>' +
    '<svg class="bar__model-pill-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none">' +
    '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32 100" />' +
    "</svg>" +
    "</span>" +
    "</span>" +
    '<ul class="bar__model-dropdown" id="modelDropdown" role="listbox" aria-label="Seleziona il modello Emma" hidden></ul>';

  /* Riaggancia i riferimenti DOM */
  el.modelPill = document.getElementById("modelPill");
  el.modelPillLabel = document.getElementById("modelPillLabel");
  el.modelDropdown = document.getElementById("modelDropdown");

  /* Popola il dropdown dalla lista autoritativa (GET /api/models: runnable AND enabled,
       rispettosa del flag fs:multi-model). Con ≤1 voce il dropdown di fatto non offre scelte. */
  const dropdown = el.modelDropdown;
  if (dropdown) {
    const fallbackModels = state.availableModels || [];

    dropdown.innerHTML = "";
    fallbackModels.forEach((m) => {
      const li = document.createElement("li");
      li.className = "bar__model-dropdown-item";
      li.dataset.modelKey = m.key;
      li.setAttribute("role", "option");
      li.setAttribute(
        "aria-selected",
        m.key === state.modelKey ? "true" : "false",
      );
      li.classList.toggle("is-active", m.key === state.modelKey);

      const name = document.createElement("span");
      name.className = "bar__model-dropdown-name";
      name.textContent = m.label;

      const heading = document.createElement("span");
      heading.className = "bar__model-dropdown-heading";
      heading.appendChild(name);
      const label =
        m.key === "emma-5"
          ? "Generatore di meme"
          : m.key === "emma-6"
            ? "Beta"
            : null;
      if (label) {
        const tag = document.createElement("span");
        tag.className = "bar__model-dropdown-tag";
        tag.textContent = label;
        heading.appendChild(tag);
      }

      const desc = document.createElement("span");
      desc.className = "bar__model-dropdown-desc";

      li.appendChild(heading);
      li.appendChild(desc);
      li.addEventListener("click", () => {
        switchToModel(m.key);
        closeModelDropdown();
      });
      dropdown.appendChild(li);
    });

    /* Aggiorna le descrizioni con i parametri */
    updateDropdownDescriptions();
  }

  /* Event listeners */
  if (el.modelPill) {
    el.modelPill.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModelDropdown();
    });
    el.modelPill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleModelDropdown();
      }
    });
  }

  const newInfoBtn = document.getElementById("infoToggleBtn");
  if (newInfoBtn) {
    newInfoBtn.addEventListener("click", toggleInfo);
  }
}

function updateDropdownDescriptions() {
  /* Descrizioni del dropdown dai DATI REALI del catalogo (iter. 49/69): parametri
       GQA-aware espressi in miliardi, layer e rapporto GQA da config.json. */
  fetch("/api/models/info")
    .then((r) => r.json())
    .then((data) => {
      const dropdown = el.modelDropdown;
      if (!dropdown || !data || !data.models) return;
      const byKey = {};
      data.models.forEach((m) => {
        byKey[m.key] = m;
      });
      const items = dropdown.querySelectorAll(".bar__model-dropdown-item");
      items.forEach((item) => {
        const key = item.dataset.modelKey;
        const descEl = item.querySelector(".bar__model-dropdown-desc");
        const info = byKey[key];
        if (!descEl || !info || !info.specs) return;
        const s = info.specs;
        const params = s.parameter_label || "";
        descEl.textContent =
          params +
          " parametri · " +
          s.num_hidden_layers +
          " layer · GQA " +
          s.gqa_ratio;
      });
    })
    .catch(() => {});
}

/* ── caratteristiche model-card ──────────────── */
function getModelNameFromCard(btn) {
  var card = btn.closest(".model-card");
  if (!card) return null;
  var nameEl = card.querySelector(".model-card__name");
  return nameEl ? (nameEl.textContent || "").trim() : null;
}

function openFeaturesForModel(modelName) {
  if (!modelName) return;
  if (modelName === "Emma-3") {
    openEmma3Features();
  } else if (modelName === "Emma-5") {
    openEmma5Features();
  } else if (modelName === "Emma-6") {
    openEmma6Features();
  } else if (modelName === "Emma Business") {
    openEmmaBusinessFeatures();
  } else {
    // Emma-4 o fallback
    openEmma4Features();
  }
}

// Solo i pulsanti aprono una modale: le card con pagina dedicata usano un link.
document.querySelectorAll("button.model-action").forEach(function (btn) {
  if ((btn.textContent || "").trim() === "Caratteristiche") {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var modelName = getModelNameFromCard(btn);
      openFeaturesForModel(modelName);
    });
  }
});

/* Thinking Toggle in Footer Hardware bar */
window.setThinkingState = function (active) {
  const isAct = Boolean(active);
  window.__isThinking = isAct;
  if (typeof state !== "undefined") {
    state.isThinking = isAct;
  }
  const btn = document.getElementById("thinkingFooterToggle");
  const stateText = document.getElementById("thinkingHwState");
  if (btn) {
    btn.classList.toggle("is-active", isAct);
    btn.setAttribute("aria-pressed", isAct ? "true" : "false");
  }
  if (stateText) {
    stateText.textContent = isAct ? "ON" : "OFF";
  }
};

window.toggleThinkingMode = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();
  window.setThinkingState(!window.__isThinking);
  return false;
};

// Event delegation on document to guarantee clicks are always captured
document.addEventListener("click", function (e) {
  const btn = e.target.closest("#thinkingFooterToggle");
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    window.toggleThinkingMode(e);
  }
});

// Default spento all'avvio
window.setThinkingState(false);
