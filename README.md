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
- `data/staff.json`, `src/staff_template.html`, `src/staff_admin_template.html` student staff sign-up
- `worker/` Cloudflare Worker and database schema (survey, poster judging, staff sign-up)
- `tools/make_judges.py` assigns judges, creates codes and judge cards (output in `private/`)
- `tools/import_database.py` imports the organizers' Program Database workbook (writes `data/program.json` and `data/abstracts.json`)
- `data/abstracts.json` abstracts and keywords, loaded only when a talk or poster page opens
- `tools/build.py` builds all pages
- `tools/make_sample.py` regenerates the sample data

## Commands
    python3 tools/build.py --serve    # build and preview at http://localhost:8000
    python3 tools/build.py            # build only

After building, commit and push. The site updates in about a minute.

## Team task tracker
`https://soorathep.github.io/mcare2026/tasks.html` (not indexed by search engines; anyone with the link can open it)

## Feedback survey
- Survey: `https://soorathep.github.io/mcare2026/survey.html`
- Results (admin token): `https://soorathep.github.io/mcare2026/results.html`
- Questions: `data/survey.json` (based on the MCARE 2024 survey so results can be compared). After editing it, run the build: it also updates the question list inside `worker/worker.js`, which must then be pasted into Cloudflare.
- Optional symposium organizer contact details are stored in a separate table (`organizers`), not with the answers.
- Questions file: Backend: `worker/worker.js` on Cloudflare Workers with a D1 database (`worker/schema.sql`).
- The live app shows a feedback card from `showInAppFrom` (16 Dec).
- Gift: after submitting, each respondent gets a 6-character code and QR (not linked to the answers). Desk staff scan it with a phone camera; it opens `https://soorathep.github.io/mcare2026/claim.html`, which needs the `DESK_TOKEN` Cloudflare secret and blocks a second claim.

## Poster judging
- Judges: `https://soorathep.github.io/mcare2026/judge.html` (log in with the code or QR on the judge card)
- Results (admin token): `https://soorathep.github.io/mcare2026/poster-results.html`, ranking per poster session
- Criteria: `data/judging.json` (can change any time; no Worker or database change needed)
- Judges: put `name,session` rows in `private/judges.csv`, run `python3 tools/make_judges.py`, paste `private/judges_seed.sql` into the D1 Console, print `private/judge_cards.html`
- `private/` is in `.gitignore`: judge codes never go to GitHub

## Student staff
- Sign-up form (Thai): `https://soorathep.github.io/mcare2026/staff.html`. Signing up again with the same email updates the record
- Organizer view (admin token): `https://soorathep.github.io/mcare2026/staff-admin.html`, availability heatmap for meetings, contact list, shirt sizes, CSV
- Options (levels, shirt sizes, time slots, roles): `data/staff.json`

## Poster area
- `meta.panelsTotal` (60 double-sided panels) and `meta.panelsPerRow` (10) in program.json set the floor map

## URLs for QR codes
- Main: `https://soorathep.github.io/mcare2026/`
- Room: `?room=ab`, `c`, `yangtze`, `amazon`, `seine`, `ganges`, `mekong`, `nile`
- Room TV display: `?room=yangtze&display=1`
- Poster board: `?poster=P2-014&src=qr`
- Simulated time (testing): `?now=2026-12-17T14:32`

Before 14 Dec the site runs in demo mode automatically (`meta.demo` in program.json).
