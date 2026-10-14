import re

APP_JS = '/home/funboy/emma-lab/frontend/static/js/app.js'
INDEX_HTML = '/home/funboy/emma-lab/frontend/index.html'

# --- 1. FIX APP.JS ---
with open(APP_JS, 'r', encoding='utf-8') as f:
    js = f.read()

# Make currentMessageLimit return Infinity unconditionally
js = re.sub(
    r'function currentMessageLimit\(\)\s*\{.*?return state\.isLoggedIn \? MESSAGE_LIMIT_FREE : MESSAGE_LIMIT_ANON;\s*\}',
    'function currentMessageLimit() {\n  return Infinity;\n}',
    js,
    flags=re.DOTALL
)

# Set initial isLoggedIn to true and isSupporter to true
js = re.sub(
    r'conversationId:\s*null,\s*isLoggedIn:\s*false,',
    'conversationId: null,\n  isLoggedIn: true,',
    js
)

js = re.sub(
    r'authProvider:\s*"local",\s*hasLocalPassword:\s*false,\s*\},',
    'authProvider: "local",\n    hasLocalPassword: false,\n    isSupporter: true,\n    isDeveloper: true,\n    has_active_subscription: true,\n    accountType: "personal",\n    creditBalance: 999999,\n  },',
    js
)

# Defang openLimitModal
js = re.sub(
    r'function openLimitModal\(\)\s*\{.*?el\.limitModal\.setAttribute\("aria-hidden", "false"\);\s*\}',
    'function openLimitModal() {\n  return;\n}',
    js,
    flags=re.DOTALL
)

# Defang registration & login openers
js = re.sub(
    r'function openRegisterModal\([^)]*\)\s*\{.*?el\.registerModal\.setAttribute\("aria-hidden", "false"\);\s*\}',
    'function openRegisterModal() { return; }',
    js,
    flags=re.DOTALL
)

js = re.sub(
    r'function openUserRegisterModal\([^)]*\)\s*\{.*?el\.userRegisterModal\.setAttribute\("aria-hidden", "false"\);\s*\}',
    'function openUserRegisterModal() { return; }',
    js,
    flags=re.DOTALL
)

js = re.sub(
    r'function openLoginUserModal\([^)]*\)\s*\{.*?el\.loginUserModal\.setAttribute\("aria-hidden", "false"\);\s*\}',
    'function openLoginUserModal() { return; }',
    js,
    flags=re.DOTALL
)

js = re.sub(
    r'function openCompanyLoginModal\([^)]*\)\s*\{.*?el\.companyLoginModal\.setAttribute\("aria-hidden", "false"\);\s*\}',
    'function openCompanyLoginModal() { return; }',
    js,
    flags=re.DOTALL
)

# Defang openPremiumPreferencesModal
js = re.sub(
    r'function openPremiumPreferencesModal\(\)\s*\{.*?el\.premiumPreferencesClose\?\.focus\(\);\s*\}, 0\);\s*\}',
    'function openPremiumPreferencesModal() { return; }',
    js,
    flags=re.DOTALL
)

# In onSubmit: REMOVE the blocking limit check
js = re.sub(
    r'// Registrazione obbligatoria.*?if \(!state\.isLoggedIn \|\| state\.messageCount >= currentMessageLimit\(\)\) \{\s*openLimitModal\(\);\s*return;\s*\}',
    '// Self-hosted: no registration wall or limits\n  // Gating removed',
    js,
    flags=re.DOTALL
)

# In onSubmit: remove limit check at stream end
js = re.sub(
    r'state\.messageCount \+= 1;\s*if \(state\.messageCount >= currentMessageLimit\(\)\) \{\s*openLimitModal\(\);\s*\}',
    'state.messageCount += 1;',
    js
)

# In resetLocalSession: preserve isLoggedIn = true
js = re.sub(
    r'state\.isLoggedIn = false;',
    'state.isLoggedIn = true;',
    js
)
js = re.sub(
    r'isSupporter: false,\s*isDeveloper: false,',
    'isSupporter: true,\n    isDeveloper: true,\n    has_active_subscription: true,',
    js
)

with open(APP_JS, 'w', encoding='utf-8') as f:
    f.write(js)
print("Updated app.js successfully!")

# --- 2. FIX INDEX.HTML ---
with open(INDEX_HTML, 'r', encoding='utf-8') as f:
    html = f.read()

# Add CSS rule to completely hide all modals that shouldn't appear
modal_blocker_css = '''
    /* FORCE HIDE ALL REMOVED/UNUSED MODALS AND BACKDROPS */
    .modal--limit, #limitModal, #limitBackdrop,
    .modal--login, #loginUserModal, #loginUserBackdrop,
    .modal--register, #registerModal, #registerBackdrop,
    .modal--user-register, #userRegisterModal, #userRegisterBackdrop,
    .modal--company-login, #companyLoginModal, #companyLoginBackdrop,
    .modal--premium-preferences, #premiumPreferencesModal, #premiumPreferencesBackdrop,
    .modal--confirm, #deleteAccountModal, #deleteAccountBackdrop,
    .modal--profile-edit, #profileEditModal, #profileEditBackdrop,
    .modal--contribution,
    #pretrainingContributionModal, #pretrainingContributionBackdrop,
    #questionContributionModal, #questionContributionBackdrop,
    #answerContributionModal, #answerContributionBackdrop,
    #evaluationContributionModal, #evaluationContributionBackdrop {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }
'''

if 'FORCE HIDE ALL REMOVED/UNUSED MODALS' not in html:
    html = html.replace('</style>', modal_blocker_css + '\n    </style>', 1)
    print("Added modal blocker CSS to index.html!")

# Update cache buster across all script and css tags: v=selfhosted_v7
html = re.sub(r'(\.js|\.css)\?v=[a-zA-Z0-9_-]+', r'\1?v=selfhosted_v7', html)
print("Updated cache busters to ?v=selfhosted_v7!")

with open(INDEX_HTML, 'w', encoding='utf-8') as f:
    html = html
    f.write(html)
print("Updated index.html successfully!")
