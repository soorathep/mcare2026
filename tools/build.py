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
    tpl = open(p("src", "template.html"), encoding="utf-8").read()
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = tpl.replace("/*DATA*/", js).replace("/*QR*/", open(p("src", "qrcode.js"), encoding="utf-8").read())
    open(p("index.html"), "w", encoding="utf-8").write(out)
    print(f"Built index.html ({len(out)//1024} KB): {len(data['sessions'])} sessions, "
          f"{len(data['talks'])} talks, {len(data['posters'])} posters")

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
