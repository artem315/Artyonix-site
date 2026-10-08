#!/usr/bin/env python3
"""Copy first-party web app into a bundled Android WebView for a fixed ArtyMods host."""
import pathlib
import sys
import json
from urllib.parse import urlparse
root = pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    sys.exit('Использование: python scripts/configure_android.py https://твоя-платформа.example')
url = sys.argv[1].rstrip('/')
p = urlparse(url)
if p.scheme != 'https' or not p.hostname or p.username or p.password or p.path not in ('', '/') or p.query or p.fragment:
    sys.exit('Нужен полный HTTPS-домен сервера, например https://mods.example.com')
web = root/'server/public'
site = (web/'index.html').read_text(encoding='utf-8')
css = (web/'style.css').read_text(encoding='utf-8')
js = (web/'app.js').read_text(encoding='utf-8')
site = site.replace('<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css">', '<style>'+css+'</style>')
site = site.replace('<script src="/app.js"></script>', '<script>window.ARTYMODS_ANDROID=true; window.ARTYMODS_API_URL='+json.dumps(url)+';</script><script>'+js+'</script>')
# The web page's APK links are hidden in Android, so no on-device APK installer UI.
out = root/'android/app/src/main/assets/index.html'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(site, encoding='utf-8')
print('Сайт API:',url)
print('Android UI:',out)
