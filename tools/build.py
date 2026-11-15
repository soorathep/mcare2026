#!/usr/bin/env python3
"""Build index.html from src/template.html + data/program.json + src/qrcode.js.

  python3 tools/build.py           build index.html
  python3 tools/build.py --serve   build, then preview at http://localhost:8000
"""
import json, os, sys, http.server, socketserver, webbrowser, functools

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
p = lambda *a: os.path.join(ROOT, *a)

def build():
    data = json.load(open(p("data", "program.json"), encoding="utf-8"))   # fails loudly on bad JSON
    for k in ("meta", "rooms", "sessions", "talks", "posterSessions", "posters"):
        if k not in data: sys.exit(f"program.json is missing '{k}'")
    rooms = {r["id"] for r in data["rooms"]}
    sess = {s["id"] for s in data["sessions"]}
    bad = [s["id"] for s in data["sessions"] if s["room"] not in rooms] + \
          [t["id"] for t in data["talks"] if t["session"] not in sess]
    if bad: sys.exit("Unknown room/session references: " + ", ".join(bad[:10]))
    if os.path.exists(p("data", "survey.json")):
        data["meta"]["surveyFrom"] = json.load(open(p("data", "survey.json"), encoding="utf-8")).get("showInAppFrom")
    tpl = open(p("src", "template.html"), encoding="utf-8").read()
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = tpl.replace("/*DATA*/", js).replace("/*QR*/", open(p("src", "qrcode.js"), encoding="utf-8").read())
    open(p("index.html"), "w", encoding="utf-8").write(out)
    build_tasks()
    build_survey()
    print(f"Built index.html ({len(out)//1024} KB): {len(data['sessions'])} sessions, "
          f"{len(data['talks'])} talks, {len(data['posters'])} posters")

def build_tasks():
    path = p("data", "tasks.json")
    if not os.path.exists(path): return
    tasks = json.load(open(path, encoding="utf-8"))
    ids = [t["id"] for t in tasks["tasks"]]
    if len(ids) != len(set(ids)): sys.exit("tasks.json has duplicate task ids")
    for t in tasks["tasks"]:
        if t["status"] not in ("todo", "doing", "done", "blocked"): sys.exit(f"Task {t['id']}: bad status {t['status']}")
        if t["category"] not in tasks["categories"]: sys.exit(f"Task {t['id']}: unknown category {t['category']}")
    tpl = open(p("src", "tasks_template.html"), encoding="utf-8").read()
    js = json.dumps(tasks, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    open(p("tasks.html"), "w", encoding="utf-8").write(tpl.replace("/*TASKS*/", js))
    n = {k: sum(t["status"] == k for t in tasks["tasks"]) for k in ("todo", "doing", "done", "blocked")}
    print(f"Built tasks.html: {len(ids)} tasks ({n['todo']} to do, {n['doing']} in progress, {n['done']} done, {n['blocked']} blocked)")

def build_survey():
    path = p("data", "survey.json")
    if not os.path.exists(path): return
    sv = json.load(open(path, encoding="utf-8"))
    ids = [q["id"] for sec in sv["sections"] for q in sec["questions"]]
    if len(ids) != len(set(ids)): sys.exit("survey.json has duplicate question ids")
    js = json.dumps(sv, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    for src, out in (("survey_template.html", "survey.html"), ("results_template.html", "results.html")):
        tpl = open(p("src", src), encoding="utf-8").read()
        open(p(out), "w", encoding="utf-8").write(tpl.replace("/*SURVEY*/", js))
    print(f"Built survey.html and results.html: {len(ids)} questions, endpoint {'set' if sv.get('endpoint') else 'NOT SET (preview only)'}")

def serve(port=8000):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), handler) as httpd:
        url = f"http://localhost:{port}/"
        print(f"Preview: {url}   (Ctrl+C to stop)")
        webbrowser.open(url)
        try: httpd.serve_forever()
        except KeyboardInterrupt: print("\nStopped.")

if __name__ == "__main__":
    build()
    if "--serve" in sys.argv: serve()
