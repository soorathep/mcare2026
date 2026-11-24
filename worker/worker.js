// MCARE 2026: feedback survey and poster judging. Cloudflare Worker + D1
// Bindings: DB (D1 database), ADMIN_TOKEN (secret)
// Survey:   POST /submit          store one response (public)
//           GET  /results         all responses (Authorization: Bearer <ADMIN_TOKEN>)
// Judging:  GET  /judge           judge name, assigned boards, own scores (X-Judge-Code)
//           POST /score           save or update one score (X-Judge-Code)
//           GET  /poster-results  judges and all scores (Authorization: Bearer <ADMIN_TOKEN>)
// Staff:    POST /staff           student staff sign-up; same email updates the record (public)
//           GET  /staff-list      all staff records (Authorization: Bearer <ADMIN_TOKEN or STAFF_TOKEN>)
// Gifts:    /submit returns a gift code (not linked to the answers, so the survey stays anonymous)
//           POST /claim           mark a gift code as collected (X-Desk-Token: <DESK_TOKEN>)
//           GET  /claim-stats     codes issued and collected (X-Desk-Token)
// Criteria live in data/judging.json; the Worker accepts any criterion id, so criteria can change without editing this file.

const ALLOWED_ORIGINS = [
  "https://soorathep.github.io",
  "http://localhost:8000",
];

// BEGIN QUESTIONS (generated from data/survey.json by tools/build.py; do not edit by hand)
const QUESTIONS = {"inst": {"type": "choice", "options": ["University", "Research institute", "Industry", "Other"], "required": true}, "position": {"type": "choice", "options": ["Principal investigator (professor, PI)", "Full-time researcher (postdoc, research staff)", "Student", "Other"], "required": true}, "region": {"type": "choice", "options": ["Thailand", "South Korea", "Asia (other)", "Europe", "Americas", "Africa", "Oceania"], "required": true}, "times": {"type": "choice", "options": ["Once", "Twice", "Three times or more"], "required": true}, "roles": {"type": "multi", "options": ["Organizing committee", "Symposium organizer", "Oral presenter", "Poster presenter", "Other participant"]}, "fields": {"type": "multi", "options": ["Materials science", "Nanotechnology", "Energy", "Electrochemistry", "Chemical engineering", "Process engineering", "Environmental engineering", "Biotechnology", "Chemistry", "Physics", "Catalysis", "Other"], "max": 2}, "overall": {"type": "rating", "required": true, "na": false}, "location": {"type": "rating"}, "venue": {"type": "rating"}, "nextloc": {"type": "choice", "options": ["Jeju, South Korea", "Busan, South Korea", "Seoul, South Korea", "Bangkok, Thailand", "Shanghai, China", "Hawaii, USA", "Seattle, USA", "Paris, France", "London, UK", "Other"]}, "duration": {"type": "choice", "options": ["Too short (6 days or more)", "Appropriate", "Too long (3 to 4 days)"]}, "fee": {"type": "choice", "options": ["Very reasonable", "Reasonable", "Neutral", "Expensive", "Very expensive"]}, "month": {"type": "choice", "options": ["January to February", "March to April", "May to June", "July to August", "September to October", "November to December"]}, "sessions": {"type": "rating"}, "plenary": {"type": "rating"}, "posters": {"type": "rating"}, "diversity": {"type": "rating"}, "topics": {"type": "text"}, "registration": {"type": "rating"}, "onsite": {"type": "rating"}, "timekeeping": {"type": "rating"}, "information": {"type": "rating"}, "rooms": {"type": "rating"}, "meals": {"type": "rating"}, "banquet": {"type": "rating"}, "best": {"type": "text"}, "worst": {"type": "text"}, "journals": {"type": "rating"}, "jfactor": {"type": "choice", "options": ["Diversity of fields", "Journal metrics (impact factor, JCR)", "History and reputation in the field", "High chance of publication for participants", "Short review process", "Other"]}, "jsuggest": {"type": "text"}, "factors": {"type": "multi", "options": ["Topics", "Location", "Registration fee", "Networking opportunities", "Quality of special issues", "Speakers", "Conference size", "Other"], "max": 2}, "strengths": {"type": "multi", "options": ["Topics", "Location", "Registration fee", "Networking opportunities", "Quality of special issues", "Speakers", "Conference size", "Other"], "max": 2}, "weaknesses": {"type": "multi", "options": ["Topics", "Location", "Registration fee", "Networking opportunities", "Quality of special issues", "Speakers", "Conference size", "Other"], "max": 2}, "nextmcare": {"type": "rating", "required": true, "na": false}, "improve": {"type": "text"}};
const ORGANIZER = {"org_last": {"type": "short"}, "org_first": {"type": "short"}, "org_affil": {"type": "short"}, "org_position": {"type": "short"}, "org_email": {"type": "short"}, "org_topic": {"type": "text"}};
// END QUESTIONS
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

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O/1/I
function giftCode() {
  const b = new Uint8Array(6); crypto.getRandomValues(b);
  return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Judge-Code, X-Desk-Token",
    "Vary": "Origin",
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

function validateOrganizer(o) {
  if (o === undefined) return null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return "Bad organizer";
  const c = {};
  for (const k of Object.keys(o)) {
    if (!(k in ORGANIZER) || typeof o[k] !== "string") return `Bad organizer field: ${k}`;
    const v = o[k].trim().slice(0, ORGANIZER[k].type === "text" ? 1000 : 200);
    if (v) c[k] = v;
  }
  if (!c.org_last || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.org_email || "")) return "Organizer: last name and a valid email are needed";
  return c;
}

function validate(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "Invalid body";
  for (const k of Object.keys(a)) if (!(k in QUESTIONS) && k !== "organizer") return `Unknown field: ${k}`;
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
    } else if (q.type === "multi") {
      if (!Array.isArray(v) || !v.length || v.some(x => !q.options.includes(x)) || new Set(v).size !== v.length || (q.max && v.length > q.max)) return `Bad value: ${k}`;
      clean[k] = v;
    } else if (q.type === "text" || q.type === "short") {
      if (typeof v !== "string") return `Bad value: ${k}`;
      const t = v.trim().slice(0, q.type === "short" ? 200 : MAX_TEXT);
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
      const org = validateOrganizer(body.organizer);
      if (typeof org === "string") return json({ ok: false, error: org }, 400, origin);
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO responses (created_at, answers) VALUES (?, ?)").bind(now, JSON.stringify(clean)).run();
      if (org) await env.DB.prepare("INSERT INTO organizers (created_at, data) VALUES (?, ?)").bind(now.slice(0, 10), JSON.stringify(org)).run();
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const c = giftCode();
        try { await env.DB.prepare("INSERT INTO claims (code, created_at) VALUES (?, ?)").bind(c, now).run(); code = c; } catch (e) { /* rare collision: try again */ }
      }
      return json({ ok: true, code }, 200, origin);
    }

    if (url.pathname === "/results" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const { results } = await env.DB.prepare("SELECT id, created_at, answers FROM responses ORDER BY id").all();
      const g = await env.DB.prepare("SELECT COUNT(*) AS issued, COUNT(claimed_at) AS claimed FROM claims").first();
      const o = await env.DB.prepare("SELECT created_at, data FROM organizers ORDER BY id").all();
      return json({ ok: true, gifts: { issued: g.issued, claimed: g.claimed }, organizers: o.results.map(r => ({ date: r.created_at, ...JSON.parse(r.data) })), responses: results.map(r => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.answers) })) }, 200, origin);
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

    // ---------- survey gifts ----------
    if (url.pathname === "/claim" || url.pathname === "/claim-stats") {
      const desk = request.headers.get("X-Desk-Token") || "";
      if (!env.DESK_TOKEN || desk !== env.DESK_TOKEN) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const stats = async () => {
        const r = await env.DB.prepare("SELECT COUNT(*) AS issued, COUNT(claimed_at) AS claimed FROM claims").first();
        return { issued: r.issued, claimed: r.claimed };
      };
      if (url.pathname === "/claim-stats" && request.method === "GET") return json({ ok: true, ...(await stats()) }, 200, origin);
      if (url.pathname === "/claim" && request.method === "POST") {
        let b;
        try { b = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
        const code = String((b && b.code) || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return json({ ok: false, error: "Invalid code" }, 400, origin);
        const row = await env.DB.prepare("SELECT code, claimed_at FROM claims WHERE code = ?").bind(code).first();
        if (!row) return json({ ok: false, error: "Unknown code", ...(await stats()) }, 404, origin);
        if (row.claimed_at) return json({ ok: false, already: true, claimed_at: row.claimed_at, ...(await stats()) }, 409, origin);
        const now = new Date().toISOString();
        await env.DB.prepare("UPDATE claims SET claimed_at = ? WHERE code = ? AND claimed_at IS NULL").bind(now, code).run();
        return json({ ok: true, claimed_at: now, ...(await stats()) }, 200, origin);
      }
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
      // ADMIN_TOKEN, or STAFF_TOKEN for team members who should see only the staff list
      const auth = request.headers.get("Authorization") || "";
      const okAdmin = env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;
      const okStaff = env.STAFF_TOKEN && auth === `Bearer ${env.STAFF_TOKEN}`;
      if (!okAdmin && !okStaff) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      const { results } = await env.DB.prepare("SELECT email, created_at, updated_at, data FROM staff ORDER BY created_at").all();
      return json({ ok: true, staff: results.map(r => ({ ...JSON.parse(r.data), created_at: r.created_at, updated_at: r.updated_at })) }, 200, origin);
    }

    return json({ ok: false, error: "Not found" }, 404, origin);
  },
};
