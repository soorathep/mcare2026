# MCARE 2026 Live Program

Live program web app for MCARE 2026 (14–18 Dec 2026, Millennium Hilton Bangkok).
Served by GitHub Pages at https://soorathep.github.io/mcare2026/

## Files
- `index.html` the built site (the only file GitHub Pages needs)
- `data/program.json` rooms, sessions, talks, posters (edit this)
- `src/template.html` page layout and code
- `src/qrcode.js` QR generator (MIT, Kazuhiko Arase)
- `tools/build.py` builds `index.html`

## Commands
    python3 tools/build.py --serve    # build and preview at http://localhost:8000
    python3 tools/build.py            # build only

After building, commit and push. The site updates in about a minute.

## URLs for QR codes
- Main: `https://soorathep.github.io/mcare2026/`
- Room: `?room=ab`, `c`, `yangtze`, `amazon`, `seine`, `ganges`, `mekong`, `nile`
- Room TV display: `?room=yangtze&display=1`
- Poster board: `?poster=2-014&src=qr`
- Simulated time (testing): `?now=2026-12-17T14:32`

Before 14 Dec the site runs in demo mode automatically (`meta.demo` in program.json).
