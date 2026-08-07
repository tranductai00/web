#!/usr/bin/env python3
"""Patch bang-ti-le-hoan/index.html to replace legacy workspace/anonymous login with Google Auth.
Preserves all calculation, Excel parsing, filters, notes, charts, export and UI code.
"""
from pathlib import Path
import re, shutil, sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'bang-ti-le-hoan/index.html')
if not path.exists():
    raise SystemExit(f'Không tìm thấy: {path}')
text = path.read_text(encoding='utf-8')
backup = path.with_suffix(path.suffix + '.bak-v48')
if not backup.exists():
    shutil.copy2(path, backup)

# Remove the old Firebase module that always signs in anonymously.
blocks = list(re.finditer(r'<script\s+type=["\']module["\'][^>]*>.*?</script>', text, flags=re.S|re.I))
removed = 0
for m in reversed(blocks):
    block = m.group(0)
    if 'signInAnonymously' in block and 'window.firebaseCloud' in block:
        text = text[:m.start()] + '<!-- V48: legacy anonymous Firebase module removed -->' + text[m.end():]
        removed += 1

# Remove old workspace-name login script; Google account replaces it.
text, n2 = re.subn(
    r'<script\s+id=["\']v44-workspace-login-autosync-js["\'][^>]*>.*?</script>',
    '<!-- V48: legacy workspace login removed -->', text, count=1, flags=re.S|re.I
)

css_tag = '<link rel="stylesheet" href="./google-account-sync.css?v=48">'
js_tag = '<script type="module" src="./google-account-sync.js?v=48"></script>'
if 'google-account-sync.css' not in text:
    text = text.replace('</head>', css_tag+'\n</head>', 1)
if 'google-account-sync.js' not in text:
    text = text.replace('</body>', js_tag+'\n</body>', 1)

path.write_text(text, encoding='utf-8')
print(f'OK: {path}')
print(f'Backup: {backup}')
print(f'Anonymous Firebase blocks removed: {removed}')
print(f'Workspace login blocks removed: {n2}')
if removed != 1:
    print('CẢNH BÁO: không tìm đúng 1 Firebase anonymous block. Kiểm tra index.html trước khi deploy.')
