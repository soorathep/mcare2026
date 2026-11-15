# MCARE 2026 Live Program

Live program web app for MCARE 2026 (14–18 Dec 2026, Millennium Hilton Bangkok).
Served by GitHub Pages at https://soorathep.github.io/mcare2026/

## Files
- `index.html` the built site (the only file GitHub Pages needs)
- `data/program.json` rooms, sessions, talks, posters (edit this)
- `src/template.html` page layout and code
- `src/qrcode.js` QR generator (MIT, Kazuhiko Arase)
- `data/tasks.json` organizing tasks (team tracker)
- `src/tasks_template.html` tracker page layout
- `data/survey.json`, `src/survey_template.html`, `src/results_template.html` feedback survey
- `data/judging.json`, `src/judge_template.html`, `src/poster_results_template.html` poster judging
- `worker/` Cloudflare Worker and database schema (survey and poster judging)
- `tools/make_judges.py` assigns judges, creates codes and judge cards (output in `private/`)
- `tools/build.py` builds `index.html`, `tasks.html`, `survey.html` and `results.html`

## Commands
    python3 tools/build.py --serve    # build and preview at http://localhost:8000
    python3 tools/build.py            # build only

After building, commit and push. The site updates in about a minute.

## Team task tracker
`https://soorathep.github.io/mcare2026/tasks.html` (not indexed by search engines; anyone with the link can open it)

## Feedback survey
- Survey: `https://soorathep.github.io/mcare2026/survey.html`
- Results (admin token): `https://soorathep.github.io/mcare2026/results.html`
- Questions: `data/survey.json`. Backend: `worker/worker.js` on Cloudflare Workers with a D1 database (`worker/schema.sql`).
- The live app shows a feedback card from `showInAppFrom` (18 Dec).

## Poster judging
- Judges: `https://soorathep.github.io/mcare2026/judge.html` (log in with the code or QR on the judge card)
- Results (admin token): `https://soorathep.github.io/mcare2026/poster-results.html`, ranking per poster session
- Criteria: `data/judging.json` (can change any time; no Worker or database change needed)
- Judges: put `name,session` rows in `private/judges.csv`, run `python3 tools/make_judges.py`, paste `private/judges_seed.sql` into the D1 Console, print `private/judge_cards.html`
- `private/` is in `.gitignore`: judge codes never go to GitHub

## URLs for QR codes
- Main: `https://soorathep.github.io/mcare2026/`
- Room: `?room=ab`, `c`, `yangtze`, `amazon`, `seine`, `ganges`, `mekong`, `nile`
- Room TV display: `?room=yangtze&display=1`
- Poster board: `?poster=2-014&src=qr`
- Simulated time (testing): `?now=2026-12-17T14:32`

Before 14 Dec the site runs in demo mode automatically (`meta.demo` in program.json).
