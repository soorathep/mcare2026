#!/usr/bin/env python3
"""Import the organizers' "Program at a Glance" workbook into data/program.json.

  python3 tools/import_glance.py path/to/MCARE2026_Program_at_a_Glance_YYMMDD.xlsx

Reads one sheet per day (title row, "Official Events" row, header row with room names,
then one cell per talk: "HH:MM–HH:MM  S2 · INV\\nSpeaker NAME\\nAffiliation").
Rebuilds rooms' sessions and talks (sessions marked "manual": true are kept); keeps posters, poster sessions and other settings
already in program.json. Talk titles, chairs and abstracts are not in the workbook and
stay empty until a fuller export arrives. Prints anything it could not read.
"""
import json, os, re, sys, datetime
import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "program.json")
ROOM_IDS = {"Ballroom A+B": "ab", "Ballroom C": "c", "Yangtze": "yangtze", "Amazon": "amazon",
            "Seine": "seine", "Ganges": "ganges", "Mekong": "mekong", "Nile": "nile"}
TYPES = {"PL": "Plenary", "KN": "Keynote", "INV": "Invited", "O": "Oral"}
CELL = re.compile(r"(\d\d:\d\d)\s*[–-]\s*(\d\d:\d\d)\s+(Plenary|S\d+)\s*·\s*(\w+)\s*\n(.*?)\n(.*)", re.S)
SPECIAL = re.compile(r"(.+?)\n(\d\d:\d\d)\s*[–-]\s*(\d\d:\d\d)\s*$", re.S)
SESSION_GAP = 20   # minutes; a longer gap in one room starts a new session

def mins(t): h, m = t.split(":"); return int(h) * 60 + int(m)

def main(path):
    prog = json.load(open(OUT, encoding="utf-8"))
    wb = openpyxl.load_workbook(path, data_only=True)
    sym_names = {}
    if "Symposium Colours" in wb.sheetnames:
        for k, v in wb["Symposium Colours"].iter_rows(values_only=True):
            m = re.match(r"Symposium (\d+)", str(k or ""))
            if m and v: sym_names[m.group(1)] = v.strip()
    as_of = None
    talks_raw, specials, notes, problems = [], [], {}, []
    for ws in wb.worksheets:
        m = re.search(r"(\d{1,2}) Dec (\d{4})", ws.title)
        if not m: continue
        day = f"{m.group(2)}-12-{int(m.group(1)):02d}"
        t1 = str(ws.cell(1, 1).value or "")
        a = re.search(r"as of ([^)]+)\)", t1)
        if a: as_of = a.group(1).strip()
        notes[day] = str(ws.cell(2, 1).value or "").replace("Official Events:", "").strip()
        hdr = {c.column: re.sub(r"\s*\(L\d+\)", "", str(c.value or "")).strip() for c in ws[4]}
        for row in ws.iter_rows(min_row=5):
            for c in row[1:]:
                v = c.value
                if not v: continue
                room = ROOM_IDS.get(hdr.get(c.column))
                if not room: problems.append(f"{day} unknown room column {hdr.get(c.column)!r}"); continue
                mm = CELL.match(v.strip())
                if mm:
                    s, e, sym, typ, spk, aff = mm.groups()
                    talks_raw.append(dict(day=day, room=room, start=s, end=e,
                                          sym=None if sym == "Plenary" else int(sym[1:]),
                                          type=TYPES.get(typ, typ), speaker=" ".join(spk.split()), affil=" ".join(aff.split())))
                    continue
                ms = SPECIAL.match(v.strip())
                if ms:
                    specials.append(dict(day=day, room=room, title=" ".join(ms.group(1).split()), start=ms.group(2), end=ms.group(3)))
                    continue
                problems.append(f"{day} {room}: could not read {v!r}")

    # group talks into sessions: same day, room, symposium, and no long gap
    talks_raw.sort(key=lambda t: (t["day"], t["room"], mins(t["start"])))
    sessions, talks, cur = [], [], None
    for t in talks_raw:
        if not (cur and cur["day"] == t["day"] and cur["room"] == t["room"] and cur["symposium"] == t["sym"]
                and mins(t["start"]) - mins(cur["end"]) <= SESSION_GAP):
            n = sum(1 for s in sessions if s["day"] == t["day"] and s["room"] == t["room"]) + 1
            cur = {"id": f"{t['day'][-2:]}-{t['room']}-{n}", "day": t["day"], "room": t["room"],
                   "label": "Plenary" if t["sym"] is None else f"S{t['sym']}", "symposium": t["sym"],
                   "title": "Plenary Lecture" if t["sym"] is None else sym_names.get(str(t["sym"]), f"Symposium {t['sym']}"),
                   "start": t["start"], "end": t["end"], "chairs": []}
            sessions.append(cur)
        cur["end"] = max(cur["end"], t["end"], key=mins)
        talks.append({"id": f"t{len(talks) + 1}", "session": cur["id"], "start": t["start"], "end": t["end"],
                      "type": t["type"], "title": "", "speaker": t["speaker"], "affil": t["affil"],
                      "coauthors": [], "abstract": ""})
    # plenaries are held in the combined Grand Ballroom A+B+C: show them in Ballroom C as well
    for s in [s for s in sessions if s["symposium"] is None and s["room"] == "ab"]:
        sessions.append(dict(s, id=s["id"] + "-c", room="c", title="Plenary Lecture (Grand Ballroom A+B+C)"))
    for sp in specials:
        sessions.append({"id": f"{sp['day'][-2:]}-{sp['room']}-x{len(sessions)}", "day": sp["day"], "room": sp["room"],
                         "label": "", "symposium": None, "title": sp["title"], "start": sp["start"], "end": sp["end"], "chairs": []})

    keep = [s for s in prog["sessions"] if s.get("manual")]   # hand-added sessions (e.g. Opening Ceremony) survive re-imports
    prog["sessions"], prog["talks"] = sessions + keep, talks
    if sym_names: prog["symposia"] = {k: sym_names[k] for k in sorted(sym_names, key=int)}
    prog["meta"]["officialEvents"] = notes
    prog["meta"]["programAsOf"] = as_of
    trunc = sum(1 for t in talks if "…" in t["affil"])
    json.dump(prog, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"Imported {len(talks)} talks in {len(sessions)} sessions over {len(notes)} days (program as of {as_of}).")
    print(f"Symposia: {len(sym_names)}. Special sessions: {', '.join(s['title'] for s in specials) or 'none'}.")
    print(f"Affiliations cut short in the source (with …): {trunc}. Titles, chairs and abstracts: not in this file.")
    for p in problems: print("PROBLEM:", p)

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
