import re

with open('/home/funboy/emma-lab/frontend/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Replace Privacy, Manifesto, Guardrails modals with clean stubs
pmg_pattern = re.compile(
    r'<div id="privacyBackdrop" class="modal-backdrop".*?(?=<!-- info drawer -->)',
    re.DOTALL
)

pmg_replacement = '''<div id="privacyBackdrop" class="modal-backdrop" hidden></div>
    <section id="privacyModal" class="modal modal--privacy" role="dialog" aria-modal="true" aria-labelledby="privacyTitle" aria-hidden="true" hidden>
        <header class="modal__head"><span id="privacyTitle" class="modal__title">Privacy</span><button id="privacyCloseBtn" class="drawer__close" type="button" aria-label="Chiudi">×</button></header>
        <section class="modal__body privacy-copy"><p>Installazione self-hosted locale su server bare-metal con GPU RTX 3090. Nessun dato viene inviato a terzi.</p></section>
    </section>

    <div id="manifestoBackdrop" class="modal-backdrop" hidden></div>
    <section id="manifestoModal" class="modal" aria-hidden="true" hidden>
        <header class="modal__head"><h2 class="modal__title">Manifesto</h2><button id="manifestoCloseBtn" class="drawer__close" type="button" aria-label="Chiudi">×</button></header>
        <section class="modal__body manifesto-copy"><p>Emma 6 Self-Hosted: inferenza locale su GPU dedicata NVIDIA RTX 3090 24GB e 128GB RAM.</p></section>
    </section>

    <div id="guardrailsBackdrop" class="modal-backdrop" hidden></div>
    <section id="guardrailsModal" class="modal modal--guardrails" aria-hidden="true" hidden>
        <header class="modal__head"><h2 class="modal__title">Guardrails</h2><button id="guardrailsCloseBtn" class="drawer__close" type="button" aria-label="Chiudi">×</button></header>
        <section class="modal__body guardrails-copy"><p>Sistema di moderazione attivo in locale.</p></section>
    </section>

    '''

html, n1 = pmg_pattern.subn(pmg_replacement, html)
print(f"Substituted privacy/manifesto/guardrails: {n1}")

# 2. Replace Profile & Auth/Registration modals (from profileBackdrop to before settings drawer)
profile_reg_pattern = re.compile(
    r'<div id="profileBackdrop" class="drawer-backdrop".*?(?=<!-- settings drawer -->)',
    re.DOTALL
)

profile_reg_replacement = '''<div id="profileBackdrop" class="drawer-backdrop" hidden></div>
    <aside id="profilePanel" class="drawer drawer--profile" aria-hidden="true" hidden>
        <header class="drawer__head">
            <h2 class="drawer__title">Profilo Locale</h2>
            <button id="profileCloseBtn" class="drawer__close" type="button">&times;</button>
        </header>
        <section class="drawer__section">
            <p style="padding: 12px; color: var(--text-2);">Account locale self-hosted attivo.</p>
        </section>
    </aside>

    <div id="profileEditBackdrop" class="modal-backdrop" hidden></div>
    <section id="profileEditModal" class="modal modal--profile-edit" aria-hidden="true" hidden><button id="profileEditCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="deleteAccountBackdrop" class="modal-backdrop" hidden></div>
    <section id="deleteAccountModal" class="modal modal--confirm" aria-hidden="true" hidden><button id="deleteAccountCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="loginUserBackdrop" class="modal-backdrop" hidden></div>
    <section id="loginUserModal" class="modal modal--login" aria-hidden="true" hidden><button id="loginUserCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="registerBackdrop" class="modal-backdrop" hidden></div>
    <section id="registerModal" class="modal modal--register" aria-hidden="true" hidden><button id="registerCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="companyLoginBackdrop" class="modal-backdrop" hidden></div>
    <section id="companyLoginModal" class="modal modal--login modal--company-login" aria-hidden="true" hidden><button id="companyLoginCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="userRegisterBackdrop" class="modal-backdrop" hidden></div>
    <section id="userRegisterModal" class="modal modal--user-register" aria-hidden="true" hidden><button id="userRegisterCloseBtn" class="drawer__close" type="button">&times;</button></section>
    <div id="pretrainingContributionBackdrop" class="modal-backdrop" hidden></div>
    <section id="pretrainingContributionModal" class="modal modal--contribution" aria-hidden="true" hidden><button id="pretrainingContributionClose" class="drawer__close" type="button">&times;</button></section>
    <div id="questionContributionBackdrop" class="modal-backdrop" hidden></div>
    <section id="questionContributionModal" class="modal modal--contribution" aria-hidden="true" hidden><button id="questionContributionClose" class="drawer__close" type="button">&times;</button></section>
    <div id="answerContributionBackdrop" class="modal-backdrop" hidden></div>
    <section id="answerContributionModal" class="modal modal--contribution" aria-hidden="true" hidden><button id="answerContributionClose" class="drawer__close" type="button">&times;</button></section>
    <div id="evaluationContributionBackdrop" class="modal-backdrop" hidden></div>
    <section id="evaluationContributionModal" class="modal modal--contribution" aria-hidden="true" hidden><button id="evaluationContributionClose" class="drawer__close" type="button">&times;</button></section>
    <div id="limitBackdrop" class="modal-backdrop" hidden></div>
    <section id="limitModal" class="modal modal--limit" aria-hidden="true" hidden><button id="limitClose" class="drawer__close" type="button">&times;</button></section>
    <div id="downloadBackdrop" class="drawer-backdrop" hidden></div>
    <aside id="downloadPanel" class="drawer drawer--download" aria-hidden="true" hidden><button id="downloadCloseBtn" class="drawer__close" type="button">&times;</button></aside>
    <div id="productsBackdrop" class="drawer-backdrop" hidden></div>
    <aside id="productsPanel" class="drawer drawer--products" aria-hidden="true" hidden><button id="productsCloseBtn" class="drawer__close" type="button">&times;</button></aside>
    <div id="fineTuningBackdrop" class="drawer-backdrop" hidden></div>
    <aside id="fineTuningPanel" class="drawer drawer--fine-tuning" aria-hidden="true" hidden><button id="fineTuningCloseBtn" class="drawer__close" type="button">&times;</button></aside>

    '''

html, n2 = profile_reg_pattern.subn(profile_reg_replacement, html)
print(f"Substituted profile/reg/modals: {n2}")

# 3. Replace any remaining premium preferences paywall modal
prem_pattern = re.compile(
    r'<div id="premiumPreferencesBackdrop".*?</section>\s*(?=<section id="emma6FeaturesModal")',
    re.DOTALL
)
prem_replacement = '''<div id="premiumPreferencesBackdrop" class="modal-backdrop" hidden></div>
    <section id="premiumPreferencesModal" class="modal modal--premium-preferences" aria-hidden="true" hidden><button id="premiumPreferencesCloseBtn" class="drawer__close" type="button">×</button></section>
'''
html, n3 = prem_pattern.subn(prem_replacement, html)
print(f"Substituted premiumPreferencesModal: {n3}")

# 4. In remaining features modals, replace Egomnia mentions
html = re.sub(r'Egomnia \(proprietario\)', 'Dataset Proprietario', html)
html = re.sub(r'\(c\) Riservato, Egomnia S\.p\.A\.', 'Riservato', html)
html = re.sub(r'© Riservato, Egomnia S\.p\.A\.', 'Riservato', html)
html = re.sub(r'Egomnia S\.p\.A\.', 'Emma 6 Project', html)
html = re.sub(r'Egomnia', 'Emma', html)
html = re.sub(r'https?://[a-zA-Z0-9.-]*egomnia\.com[^\s"\'<>]*', '#', html)

# 5. Fix theme logic script: Default strictly to LIGHT
theme_script_pattern = re.compile(
    r'<script id="dark-theme-logic">.*?</script>',
    re.DOTALL
)

theme_script_replacement = '''<script id="dark-theme-logic">
    (function() {
        function applyTheme(theme) {
            var isDark = theme === 'dark';
            if (isDark) {
                document.body.classList.add('dark-theme');
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.body.classList.remove('dark-theme');
                document.documentElement.setAttribute('data-theme', 'light');
            }
            var sun = document.getElementById('themeIconSun');
            var moon = document.getElementById('themeIconMoon');
            if (sun && moon) {
                sun.style.display = isDark ? 'inline-block' : 'none';
                moon.style.display = isDark ? 'none' : 'inline-block';
            }
        }
        function initTheme() {
            // STRICTLY LIGHT BY DEFAULT
            var saved = localStorage.getItem('emma_theme_v3');
            if (saved !== 'dark') {
                saved = 'light';
            }
            applyTheme(saved);
            var btn = document.getElementById('themeToggleBtn');
            if (btn) {
                btn.addEventListener('click', function() {
                    var current = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
                    var next = current === 'dark' ? 'light' : 'dark';
                    applyTheme(next);
                    localStorage.setItem('emma_theme_v3', next);
                });
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initTheme);
        } else {
            initTheme();
        }
    })();
    </script>'''

html, n4 = theme_script_pattern.subn(theme_script_replacement, html)
print(f"Substituted theme logic script: {n4}")

with open('/home/funboy/emma-lab/frontend/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Saved cleaned frontend/index.html successfully!")
