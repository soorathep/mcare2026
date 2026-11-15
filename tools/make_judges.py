#!/usr/bin/env python3
"""Assign judges to posters, create judge codes, and print judge cards.

Input : private/judges.csv  with columns  name,session   (one row per judge per poster session)
        A sample file is created on first run if none exists.
Output: private/judges_seed.sql   paste into the D1 Console to load judges (replaces existing judges)
        private/judge_cards.html  printable cards with each judge's code, QR login and board list

Everything in private/ stays on this computer (.gitignore). Judge codes are never pushed to GitHub.

  python3 tools/make_judges.py            assign with judgesPerPoster from data/judging.json
  python3 tools/make_judges.py --keep     keep existing codes for judges already in private/codes.json
"""
import csv, json, os, secrets, sys, html

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
p = lambda *a: os.path.join(ROOT, *a)
PRIV = p("private")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I
SITE = "https://soorathep.github.io/mcare2026/"

def sample_csv(path, sessions):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["name", "session"])
        for s in sessions:
            for i in range(1, 7):
                w.writerow([f"Sample Judge S{s}-{i}", s])
    print(f"Created sample {os.path.relpath(path, ROOT)}. Replace it with the real judge list and run again.")

def assign(boards, judges, k):
    """Give each board k different judges; each judge gets one contiguous stretch of boards (less walking)."""
    n, m = len(boards), len(judges)
    if m < k: sys.exit(f"Need at least {k} judges for a session, got {m}")
    seq = []
    for c in range(k):
        off = (c * n) // k
        seq += boards[off:] + boards[:off]
    out = {j: [] for j in judges}
    for i, b in enumerate(seq):
        j = judges[min(m - 1, i * m // len(seq))]
        if b in out[j]:   # rare overlap at a stretch boundary: hand it to the next judge without it
            j = next(x for x in judges[judges.index(j) + 1:] + judges if b not in out[x])
        out[j].append(b)
    return out

def main():
    os.makedirs(PRIV, exist_ok=True)
    program = json.load(open(p("data", "program.json"), encoding="utf-8"))
    k = json.load(open(p("data", "judging.json"), encoding="utf-8")).get("judgesPerPoster", 2)
    sessions = [s["id"] for s in program["posterSessions"]]
    path = os.path.join(PRIV, "judges.csv")
    if not os.path.exists(path): sample_csv(path, sessions)
    rows = [r for r in csv.DictReader(open(path, encoding="utf-8-sig")) if r.get("name", "").strip()]

    codes_path = os.path.join(PRIV, "codes.json")
    old = json.load(open(codes_path)) if "--keep" in sys.argv and os.path.exists(codes_path) else {}
    used = set(old.values())
    def new_code():
        while True:
            c = "".join(secrets.choice(ALPHABET) for _ in range(8))
            if c not in used: used.add(c); return c

    judges = {}   # name -> {code, boards}
    for s in sessions:
        names = [r["name"].strip() for r in rows if str(r["session"]).strip() == str(s)]
        if not names: continue
        boards = sorted([x["board"] for x in program["posters"] if x["session"] == s], key=lambda b: int(b.split("-")[1]))
        for name, bl in assign(boards, names, k).items():
            j = judges.setdefault(name, {"code": old.get(name) or new_code(), "boards": []})
            j["boards"] += bl
    json.dump({n: j["code"] for n, j in judges.items()}, open(codes_path, "w"), indent=1)

    q = lambda v: "'" + v.replace("'", "''") + "'"
    sql = ["DELETE FROM judges;"] + [f"INSERT INTO judges (code, name, boards) VALUES ({q(j['code'])}, {q(n)}, {q(json.dumps(j['boards']))});" for n, j in judges.items()]
    open(os.path.join(PRIV, "judges_seed.sql"), "w", encoding="utf-8").write(" ".join(sql) + "\n")   # one line: the D1 Console takes a single line

    qr = open(p("src", "qrcode.js"), encoding="utf-8").read()
    cards = "".join(f"""<div class="card"><div class="h">MCARE 2026 · Poster judge</div><div class="n">{html.escape(n)}</div>
<div class="row"><div class="qr" data-u="{SITE}judge.html#code={j['code']}"></div><div><div class="l">Judge code</div><div class="c">{j['code']}</div>
<div class="l">Scan to start, or open {SITE.replace('https://','')}judge.html</div></div></div>
<div class="l">Your posters ({len(j['boards'])})</div><div class="b">{', '.join('<span class="nw">' + b + '</span>' for b in j['boards'])}</div></div>""" for n, j in judges.items())
    open(os.path.join(PRIV, "judge_cards.html"), "w", encoding="utf-8").write(f"""<!doctype html><html><head><meta charset="utf-8"><title>Judge cards</title>
<style>body{{font-family:Helvetica,Arial,sans-serif;margin:0;padding:10mm;color:#1C242B}}.card{{border:1px solid #B9C1C6;border-radius:4mm;padding:6mm;margin-bottom:6mm;page-break-inside:avoid}}
.h{{font-size:9pt;color:#0F6E6B;font-weight:bold;text-transform:uppercase;letter-spacing:.05em}}.n{{font-size:16pt;font-weight:bold;margin:2mm 0 4mm}}
.row{{display:flex;gap:6mm;align-items:center;margin-bottom:4mm}}.qr{{width:32mm;height:32mm}}.qr svg{{width:100%;height:100%}}
.l{{font-size:8pt;color:#66727C;margin-top:2mm}}.c{{font-size:22pt;font-weight:bold;letter-spacing:.12em;font-family:Menlo,monospace}}.b{{font-size:10pt;line-height:1.5}}.nw{{white-space:nowrap}}</style></head>
<body>{cards}<script>{qr}</script><script>document.querySelectorAll('.qr').forEach(function(e){{var q=qrcode(0,'M');q.addData(e.dataset.u);q.make();e.innerHTML=q.createSvgTag({{cellSize:4,margin:0,scalable:true}});}});</script></body></html>""")

    per = {}
    for j in judges.values():
        for b in j["boards"]: per[b] = per.get(b, 0) + 1
    total = sum(1 for x in program["posters"] if x["session"] in sessions and any(str(r["session"]).strip() == str(x["session"]) for r in rows))
    print(f"{len(judges)} judges, {len(per)} of {total} posters assigned, {k} judges each "
          f"(min {min(per.values())}, max {max(per.values())}); boards per judge {min(len(j['boards']) for j in judges.values())} to {max(len(j['boards']) for j in judges.values())}")
    print("Next: paste private/judges_seed.sql into the D1 Console; print private/judge_cards.html")

if __name__ == "__main__":
    main()
