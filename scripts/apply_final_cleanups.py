import re

INDEX_PATH = '/home/funboy/emma-lab/frontend/index.html'

with open(INDEX_PATH, 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Close <style id="dark-theme-styles"> properly!
# Currently line 446 ends with background: rgba(251, 191, 36, 0.15);\n    }\n       <link rel="icon"
# We need to make sure </style> is placed right after that rule and before <link rel="icon"
css_close_pattern = re.compile(
    r'(body\.dark-theme\s+#themeToggleBtn:hover\s*\{\s*background:\s*rgba\(251,\s*191,\s*36,\s*0\.15\);\s*\})\s*(?=<link rel="icon")',
    re.DOTALL
)

if css_close_pattern.search(html):
    html = css_close_pattern.sub(r'\1\n    </style>\n    ', html)
    print("Fixed missing </style> tag!")
else:
    print("Pattern for missing </style> not found, checking if </style> already exists...")
    if '</style>' not in html:
        print("WARNING: </style> still missing!")

# 2. Add early theme script right before </head>
early_script = '''    <script>
    (function() {
        try {
            var t = localStorage.getItem('emma_theme_v4');
            if (t === 'dark') {
                document.documentElement.classList.add('dark-theme');
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark-theme');
                document.documentElement.setAttribute('data-theme', 'light');
            }
        } catch (e) {}
    })();
    </script>
</head>'''

html = re.sub(r'</head>', early_script, html, count=1)

# 3. Clean up premiumPreferencesModal (remove corporate paywall / subscription links)
prem_modal_pattern = re.compile(
    r'<div id="premiumPreferencesBackdrop".*?</section>\s*(?=<section id="emma6FeaturesModal")',
    re.DOTALL
)
prem_modal_replacement = '''<div id="premiumPreferencesBackdrop" class="modal-backdrop" hidden></div>
    <section id="premiumPreferencesModal" class="modal modal--premium-preferences" aria-hidden="true" hidden>
        <button id="premiumPreferencesCloseBtn" class="drawer__close" type="button" aria-label="Chiudi">×</button>
        <button id="premiumPreferencesDismissBtn" class="drawer__close" type="button" aria-label="Annulla">×</button>
        <a id="premiumPreferencesCta" href="#" style="display:none;" aria-hidden="true"></a>
    </section>
    '''
html, n_prem = prem_modal_pattern.subn(prem_modal_replacement, html)
print(f"Cleaned premiumPreferencesModal: {n_prem}")

# 4. Remove registration_age_notice.js script tag
html = re.sub(r'<script src="/static/js/registration_age_notice\.js[^"]*"[^>]*></script>\s*', '', html)

# 5. Update footer content
footer_pattern = re.compile(
    r'<footer class="footer">.*?</footer>',
    re.DOTALL
)
clean_footer = '''<footer class="footer">
            <div class="footer__hw-specs">
                <span class="hw-badge"><span class="hw-dot"></span>Emma 6 Self Hosted</span>
                <span class="hw-sep">—</span>
                <span class="hw-item"><strong>HW:</strong> RTX 3090 24GB</span>
                <span class="hw-sep">·</span>
                <span class="hw-item">128GB RAM</span>
                <span class="hw-sep">·</span>
                <span class="hw-item">i5-13500</span>
                <span class="hw-sep">·</span>
                <span class="hw-item">ONNX CUDA</span>
            </div>
        </footer>'''
html, n_foot = footer_pattern.subn(clean_footer, html)
print(f"Updated footer: {n_foot}")

# 6. Update dark-theme-logic script to use emma_theme_v4 and LIGHT BY DEFAULT
theme_logic_pattern = re.compile(
    r'<script id="dark-theme-logic">.*?</script>',
    re.DOTALL
)
clean_theme_logic = '''<script id="dark-theme-logic">
    (function() {
        function applyTheme(theme) {
            var isDark = theme === 'dark';
            if (isDark) {
                document.body.classList.add('dark-theme');
                document.documentElement.classList.add('dark-theme');
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.body.classList.remove('dark-theme');
                document.documentElement.classList.remove('dark-theme');
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
            // STRICTLY LIGHT BY DEFAULT: if no saved preference or not 'dark', default to 'light'
            var saved = localStorage.getItem('emma_theme_v4');
            if (saved !== 'dark') {
                saved = 'light';
                try { localStorage.setItem('emma_theme_v4', 'light'); } catch (e) {}
            }
            applyTheme(saved);

            var btn = document.getElementById('themeToggleBtn');
            if (btn) {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    var isCurrentlyDark = document.body.classList.contains('dark-theme');
                    var next = isCurrentlyDark ? 'light' : 'dark';
                    applyTheme(next);
                    try { localStorage.setItem('emma_theme_v4', next); } catch (e) {}
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

html, n_logic = theme_logic_pattern.subn(clean_theme_logic, html)
print(f"Updated theme logic: {n_logic}")

# 7. Check for any remaining Egomnia or P.IVA
for word in ['Egomnia', '11790971003', 'Fienaroli']:
    matches = len(re.findall(re.escape(word), html, re.IGNORECASE))
    print(f"Remaining occurrences of '{word}': {matches}")

with open(INDEX_PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print("Saved updated index.html successfully!")
