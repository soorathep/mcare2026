#!/usr/bin/env python3
"""Import the organizers' "Program Database" workbook into data/program.json.

  python3 tools/import_database.py path/to/MCARE2026_Program_Database_YYMMDD.xlsx

Sheets used: Oral (one row per talk), Poster (one row per poster), Symposia.
Rebuilds sessions, talks, posters and poster sessions. Keeps rooms, events, settings and
sessions marked "manual": true (e.g. Opening Ceremony, ERC Closed Session).
If a "Chair" column appears in the Oral sheet later, it is picked up automatically.
"""
import json, os, re, sys, datetime
import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "program.json")
ROOM_IDS = {"Ballroom A+B": "ab", "Ballroom C": "c", "Yangtze": "yangtze", "Amazon": "amazon",
            "Seine": "seine", "Ganges": "ganges", "Mekong": "mekong", "Nile": "nile"}
SESSION_GAP = 20   # minutes; a longer gap in one room starts a new session

def mins(t): h, m = t.split(":"); return int(h) * 60 + int(m)
def iso(d): return datetime.datetime.strptime(d.strip(), "%a, %d %b %Y").date().isoformat()
def room_id(r): return ROOM_IDS.get(re.sub(r"\s*\(L\d+\)", "", r or "").strip())
def clean(v): return " ".join(str(v).split()) if v is not None else ""
def rng(v): a, b = re.split(r"\s*[–-]\s*", clean(v)); return [a, b]

def rows(ws):
    it = ws.iter_rows(values_only=True)
    hdr = [clean(h) for h in next(it)]
    for r in it:
        if any(c not in (None, "") for c in r): yield dict(zip(hdr, r))

def main(path):
    prog = json.load(open(OUT, encoding="utf-8"))
    wb = openpyxl.load_workbook(path, data_only=True)
    readme = " ".join(clean(r[0]) for r in wb["README"].iter_rows(values_only=True) if r[0]) if "README" in wb.sheetnames else ""
    as_of = (re.search(r"as of ([^,)]+)", readme) or [None, None])[1]
    sym = {}
    for r in rows(wb["Symposia"]):
        m = re.match(r"Symposium (\d+)", clean(r.get("Symposium")))
        if m: sym[m.group(1)] = clean(r.get("Title"))
    problems = []

    # ---------- talks and sessions ----------
    raw = []
    for r in rows(wb["Oral"]):
        room = room_id(r.get("Room"))
        if not room: problems.append(f"Oral {r.get('No.')}: unknown room {r.get('Room')!r}"); continue
        s = clean(r.get("Symposium")); n = re.match(r"Symposium (\d+)", s)
        raw.append(dict(day=iso(r["Date"]), room=room, start=clean(r["Start"]), end=clean(r["End"]),
                        sym=int(n.group(1)) if n else None, type=clean(r.get("Presentation Type")) or "Oral",
                        title=clean(r.get("Title")), speaker=clean(r.get("Presenter")), affil=clean(r.get("Affiliation")),
                        country=clean(r.get("Country")), authors=clean(r.get("Authors")),
                        authorAffils=clean(r.get("Author Affiliations")), abstractNo=clean(r.get("Abstract No.")),
                        chair=clean(r.get("Chair") or r.get("Chairs") or r.get("Session Chair"))))
    raw.sort(key=lambda t: (t["day"], t["room"], mins(t["start"])))
    sessions, talks, cur = [], [], None
    for t in raw:
        if not (cur and cur["day"] == t["day"] and cur["room"] == t["room"] and cur["symposium"] == t["sym"]
                and mins(t["start"]) - mins(cur["end"]) <= SESSION_GAP):
            k = sum(1 for s in sessions if s["day"] == t["day"] and s["room"] == t["room"]) + 1
            cur = {"id": f"{t['day'][-2:]}-{t['room']}-{k}", "day": t["day"], "room": t["room"],
                   "label": "Plenary" if t["sym"] is None else f"S{t['sym']}", "symposium": t["sym"],
                   "title": "Plenary Lecture" if t["sym"] is None else sym.get(str(t["sym"]), f"Symposium {t['sym']}"),
                   "start": t["start"], "end": t["end"], "chairs": []}
            sessions.append(cur)
        cur["end"] = max(cur["end"], t["end"], key=mins)
        if t["chair"]:
            for c in re.split(r"\s*[;/]\s*", t["chair"]):
                if c and c not in cur["chairs"]: cur["chairs"].append(c)
        talks.append({"id": f"t{len(talks) + 1}", "session": cur["id"], "start": t["start"], "end": t["end"],
                      "type": t["type"], "title": t["title"], "speaker": t["speaker"], "affil": t["affil"],
                      "country": t["country"], "authors": t["authors"], "authorAffils": t["authorAffils"],
                      "abstractNo": t["abstractNo"], "coauthors": [], "abstract": ""})
    # plenaries are in the combined Grand Ballroom A+B+C: show them in Ballroom C as well
    for s in [s for s in sessions if s["symposium"] is None and s["room"] == "ab"]:
        sessions.append(dict(s, id=s["id"] + "-c", room="c", title="Plenary Lecture (Grand Ballroom A+B+C)"))
    keep = [s for s in prog["sessions"] if s.get("manual")]

    # ---------- posters ----------
    posters, ps = [], {}
    for r in rows(wb["Poster"]):
        no = clean(r.get("Poster No."))
        m = re.match(r"P(\d+)-(\d+)$", no)
        if not m: problems.append(f"Poster with unreadable number {no!r}"); continue
        rd = int(m.group(1)); s = re.match(r"Symposium (\d+)", clean(r.get("Symposium")))
        sid = int(s.group(1)) if s else None
        p = ps.setdefault(rd, {"id": rd, "day": iso(r["Date"]), "display": rng(r["Presentation"]), "core": rng(r["Core Time"]),
                               "setup": rng(r["Set-up"]), "removal": rng(r["Removal"]), "symposia": [], "count": 0})
        p["count"] += 1
        if sid and sid not in p["symposia"]: p["symposia"].append(sid)
        posters.append({"board": no, "session": rd, "symposium": sid, "title": clean(r.get("Title")),
                        "presenter": clean(r.get("Presenter")), "affil": clean(r.get("Affiliation")), "country": clean(r.get("Country")),
                        "authors": clean(r.get("Authors")), "authorAffils": clean(r.get("Author Affiliations")),
                        "abstractNo": clean(r.get("Abstract No.")), "coauthors": [], "abstract": ""})
    for p in ps.values(): p["symposia"].sort()
    posters.sort(key=lambda x: (x["session"], int(x["board"].split("-")[1])))

    prog.update(sessions=sessions + keep, talks=talks, posters=posters,
                posterSessions=[ps[k] for k in sorted(ps)], symposia={k: sym[k] for k in sorted(sym, key=int)})
    prog["meta"]["programAsOf"] = as_of
    prog["meta"]["boardPrefix"] = "P"
    json.dump(prog, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    chairs = sum(1 for s in sessions if s["chairs"])
    print(f"Imported {len(talks)} talks in {len(sessions)} sessions (+{len(keep)} kept), {len(posters)} posters in {len(ps)} rounds "
          f"({', '.join(f'round {k}: {ps[k]['count']}' for k in sorted(ps))}). Program as of {as_of}. Sessions with chairs: {chairs}.")
    for p in problems: print("PROBLEM:", p)

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
