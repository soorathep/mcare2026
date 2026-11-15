// MCARE 2026 feedback survey: Cloudflare Worker + D1
// Bindings: DB (D1 database), ADMIN_TOKEN (secret)
// Routes:  POST /submit          store one response (public)
//          GET  /results         all responses as JSON (needs Authorization: Bearer <ADMIN_TOKEN>)

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

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

    return json({ ok: false, error: "Not found" }, 404, origin);
  },
};
