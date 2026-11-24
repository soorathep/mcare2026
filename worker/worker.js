// MCARE 2026: feedback survey and poster judging. Cloudflare Worker + D1
// Bindings: DB (D1 database), ADMIN_TOKEN (secret)
// Survey:   POST /submit          store one response (public)
//           GET  /results         all responses (Authorization: Bearer <ADMIN_TOKEN>)
// Judging:  GET  /judge           judge name, assigned boards, own scores (X-Judge-Code)
//           POST /score           save or update one score (X-Judge-Code)
//           GET  /poster-results  judges and all scores (Authorization: Bearer <ADMIN_TOKEN>)
// Staff:    POST /staff           student staff sign-up; same email updates the record (public)
//           GET  /staff-list      all staff records (Authorization: Bearer <ADMIN_TOKEN>)
// Criteria live in data/judging.json; the Worker accepts any criterion id, so criteria can change without editing this file.

const ALLOWED_ORIGINS = [
  "https://soorathep.github.io",
  "http://localhost:8000",
];

// Must match data/survey.json
const QUESTIONS = {
  role: { type: "choice", options: ["Student", "Academic", "Industry", "Government", "Other"], required: true },
  first: { type: "choice", options: ["Yes", "No"], required: true },
  plenary: { type: "rating" }, symposia: { type: "rating" }, posters: { type: "rating" },
  registration: { type: "rating" }, timekeeping: { type: "rating" }, information: { type: "rating" },
  rooms: { type: "rating" }, meals: { type: "rating" }, banquet: { type: "rating" },
  overall: { type: "rating", required: true, na: false },
  nps: { type: "nps", required: true },
  best: { type: "text" }, improve: { type: "text" },
};
const MAX_TEXT = 2000;

// Student staff form (data/staff.json). Slot and role ids are checked by pattern, so the lists can change without editing this file.
const STAFF_TEXT = { name: 1, nick: 0, sid: 0, level: 1, dept: 0, phone: 1, line: 1, email: 1, shirt: 1, lang: 0, diet: 0, note: 0 };
const STAFF_LIST = { meet: 1, event: 1, roles: 0 };
function validateStaff(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "Invalid body";
  if (a.consent !== true) return "Consent required";
  const c = {};
  for (const [k, req] of Object.entries(STAFF_TEXT)) {
    const v = typeof a[k] === "string" ? a[k].trim().slice(0, k === "note" ? 1000 : 200) : "";
    if (!v) { if (req) return `Missing: ${k}`; continue; }
    c[k] = v;
  }
  c.email = c.email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return "Bad email";
  for (const [k, req] of Object.entries(STAFF_LIST)) {
    const v = a[k] === undefined ? [] : a[k];
    if (!Array.isArray(v) || v.length > 60 || !v.every(x => typeof x === "string" && /^[a-z0-9_]{1,16}$/.test(x))) return `Bad value: ${k}`;
    if (req && !v.length) return `Missing: ${k}`;
    c[k] = [...new Set(v)];
  }
  return c;
}

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Judge-Code",
    "Vary": "Origin",
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

function validate(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "Invalid body";
  for (const k of Object.keys(a)) if (!(k in QUESTIONS)) return `Unknown field: ${k}`;
  const clean = {};
  for (const [k, q] of Object.entries(QUESTIONS)) {
    const v = a[k];
    if (v === undefined || v === null || v === "") {
      if (q.required) return `Missing: ${k}`;
      continue;
    }
    if (q.type === "choice") {
      if (!q.options.includes(v)) return `Bad value: ${k}`;
      clean[k] = v;
    } else if (q.type === "rating") {
      if (v === "na" && q.na !== false) { clean[k] = "na"; continue; }
      if (!Number.isInteger(v) || v < 1 || v > 5) return `Bad value: ${k}`;
      clean[k] = v;
    } else if (q.type === "nps") {
      if (!Number.isInteger(v) || v < 0 || v > 10) return `Bad value: ${k}`;
      clean[k] = v;
    } else if (q.type === "text") {
      if (typeof v !== "string") return `Bad value: ${k}`;
      const t = v.trim().slice(0, MAX_TEXT);
      if (t) clean[k] = t;
    }
  }
  return clean;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    if (url.pathname === "/submit" && request.method === "POST") {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > 20000) return json({ ok: false, error: "Too large" }, 413, origin);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
      const clean = validate(body);
      if (typeof clean === "string") return json({ ok: false, error: clean }, 400, origin);
      await env.DB.prepare("INSERT INTO responses (created_at, answers) VALUES (?, ?)")
        .bind(new Date().toISOString(), JSON.stringify(clean)).run();
      return json({ ok: true }, 200, origin);
    }

    if (url.pathname === "/results" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const { results } = await env.DB.prepare("SELECT id, created_at, answers FROM responses ORDER BY id").all();
      return json({ ok: true, responses: results.map(r => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.answers) })) }, 200, origin);
    }

    // ---------- poster judging ----------
    if (url.pathname === "/judge" || url.pathname === "/score") {
      const code = (request.headers.get("X-Judge-Code") || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6,12}$/.test(code)) return json({ ok: false, error: "Invalid judge code" }, 401, origin);
      const judge = await env.DB.prepare("SELECT code, name, boards FROM judges WHERE code = ?").bind(code).first();
      if (!judge) return json({ ok: false, error: "Invalid judge code" }, 401, origin);
      const boards = JSON.parse(judge.boards);

      if (url.pathname === "/judge" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT board, scores, total, comment, updated_at FROM scores WHERE judge_code = ?").bind(code).all();
        return json({ ok: true, name: judge.name, boards, scores: results.map(r => ({ ...r, scores: JSON.parse(r.scores) })) }, 200, origin);
      }
      if (url.pathname === "/score" && request.method === "POST") {
        if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
        let b;
        try { b = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
        if (!b || typeof b.board !== "string" || !boards.includes(b.board)) return json({ ok: false, error: "This poster is not assigned to you" }, 403, origin);
        const sc = b.scores;
        if (!sc || typeof sc !== "object" || Array.isArray(sc)) return json({ ok: false, error: "Missing scores" }, 400, origin);
        const keys = Object.keys(sc);
        if (!keys.length || keys.length > 12) return json({ ok: false, error: "Bad criteria" }, 400, origin);
        let total = 0;
        for (const k of keys) {
          if (!/^[a-z_]{1,24}$/.test(k) || !Number.isInteger(sc[k]) || sc[k] < 0 || sc[k] > 100) return json({ ok: false, error: `Bad score: ${k}` }, 400, origin);
          total += sc[k];
        }
        const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 1000) : "";
        await env.DB.prepare("INSERT INTO scores (judge_code, board, scores, total, comment, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(judge_code, board) DO UPDATE SET scores = excluded.scores, total = excluded.total, comment = excluded.comment, updated_at = excluded.updated_at")
          .bind(code, b.board, JSON.stringify(sc), total, comment, new Date().toISOString()).run();
        return json({ ok: true, total }, 200, origin);
      }
    }

    if (url.pathname === "/poster-results" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const j = await env.DB.prepare("SELECT code, name, boards FROM judges ORDER BY name").all();
      const s = await env.DB.prepare("SELECT judge_code, board, scores, total, comment, updated_at FROM scores").all();
      return json({ ok: true,
        judges: j.results.map(r => ({ code: r.code, name: r.name, boards: JSON.parse(r.boards) })),
        scores: s.results.map(r => ({ ...r, scores: JSON.parse(r.scores) })) }, 200, origin);
    }

    // ---------- student staff ----------
    if (url.pathname === "/staff" && request.method === "POST") {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
      if (Number(request.headers.get("Content-Length") || 0) > 20000) return json({ ok: false, error: "Too large" }, 413, origin);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
      const c = validateStaff(body);
      if (typeof c === "string") return json({ ok: false, error: c }, 400, origin);
      const now = new Date().toISOString();
      const old = await env.DB.prepare("SELECT email FROM staff WHERE email = ?").bind(c.email).first();
      await env.DB.prepare("INSERT INTO staff (email, created_at, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data")
        .bind(c.email, now, now, JSON.stringify(c)).run();
      return json({ ok: true, updated: !!old }, 200, origin);
    }
    if (url.pathname === "/staff-list" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const { results } = await env.DB.prepare("SELECT email, created_at, updated_at, data FROM staff ORDER BY created_at").all();
      return json({ ok: true, staff: results.map(r => ({ ...JSON.parse(r.data), created_at: r.created_at, updated_at: r.updated_at })) }, 200, origin);
    }

    return json({ ok: false, error: "Not found" }, 404, origin);
  },
};
