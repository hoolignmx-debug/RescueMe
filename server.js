/* ============================================================================
   server.js  -  Member 3 AI EMS service  (Node 18+, NO npm dependencies)

   Endpoints (all JSON):
     GET  /api/ai/health
     POST /api/ai/ambulance-recommendation
     POST /api/ai/hospital-recommendation
     POST /api/ai/incident-summary

   Architecture:   Frontend -> THIS service -> (optional) external LLM
   The LLM key (AI_API_KEY) lives only in this process's environment.

   Decision flow for ambulance / hospital:
     1. scoring.js ranks ONLY eligible candidates (deterministic).
     2. If an LLM key is set, the LLM may choose among those candidates.
     3. The choice is validated (known ID + safety rule). If anything is wrong,
        the scoring engine's own top pick is returned instead.
   The response says exactly which path produced it ("mode").
   ============================================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const scoring = require("./lib/scoring");
const validate = require("./lib/validate");
const llm = require("./lib/llm");

// ---- Tiny .env loader (so no dotenv dependency is needed) ----------------------
function loadEnvFile(file) {
  try {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  } catch (e) { /* no .env file: fine */ }
}

// ---- Decision logic ------------------------------------------------------------------
async function recommendAmbulance(body, cfg) {
  const req = validate.ambulanceRequest(body);
  const ranked = scoring.rankAmbulances(req.incident, req.ambulances);
  if (ranked.ranking.length === 0) {
    const e = new validate.ValidationError("No eligible ambulance: " + (ranked.excluded.map(function (x) { return x.id + " (" + x.reason + ")"; }).join("; ") || "none supplied") + ".", "NO_ELIGIBLE_AMBULANCE");
    e.httpStatus = 422;
    throw e;
  }

  let pick = ranked.ranking[0];
  let reason = pick.reason;
  let mode = "SCORING_ENGINE";
  let notice = null;

  if (llm.isConfigured(cfg)) {
    try {
      const prompt = llm.ambulancePrompt(ranked.needs, ranked.ranking);
      const answer = validate.llmChoice(await llm.callLLM(cfg, prompt), ranked.ranking.map(function (r) { return r.ambulance_id; }));
      const verdict = scoring.isAmbulanceChoiceAcceptable(ranked.needs, ranked.ranking, answer.choice);
      if (verdict.ok) {
        pick = ranked.ranking.find(function (r) { return r.ambulance_id === answer.choice; });
        reason = answer.reason;
        mode = "LLM";
      } else {
        notice = "LLM suggestion rejected by safety rule (" + verdict.reason + ") - scoring engine result used.";
      }
    } catch (err) {
      notice = "LLM unavailable or invalid (" + (err.code || "error") + ") - scoring engine result used.";
    }
  } else {
    notice = "No LLM key configured - scoring engine only.";
  }

  return {
    recommended_ambulance: pick.ambulance_id,
    ambulance_score: pick.score,          // always the engine's score, never a number invented by the LLM
    estimated_eta_minutes: pick.eta_minutes,
    distance_km: pick.distance_km,
    reason: reason,
    needs: ranked.needs,
    ranking: ranked.ranking,
    excluded: ranked.excluded,
    mode: mode,
    llm_used: mode === "LLM",
    notice: notice,
    generated_at: new Date().toISOString()
  };
}

async function recommendHospital(body, cfg) {
  const req = validate.hospitalRequest(body);
  const ranked = scoring.rankHospitals(req.incident, req.hospitals);
  if (ranked.ranking.length === 0) {
    const e = new validate.ValidationError("No eligible hospital: " + (ranked.excluded.map(function (x) { return x.id + " (" + x.reason + ")"; }).join("; ") || "none supplied") + ".", "NO_ELIGIBLE_HOSPITAL");
    e.httpStatus = 422;
    throw e;
  }

  let pick = ranked.ranking[0];
  let reason = pick.reason;
  let mode = "SCORING_ENGINE";
  let notice = null;

  if (llm.isConfigured(cfg)) {
    try {
      const prompt = llm.hospitalPrompt(ranked.needs, ranked.ranking);
      const answer = validate.llmChoice(await llm.callLLM(cfg, prompt), ranked.ranking.map(function (r) { return r.hospital_id; }));
      const verdict = scoring.isHospitalChoiceAcceptable(ranked.needs, ranked.ranking, answer.choice);
      if (verdict.ok) {
        pick = ranked.ranking.find(function (r) { return r.hospital_id === answer.choice; });
        reason = answer.reason;
        mode = "LLM";
      } else {
        notice = "LLM suggestion rejected by safety rule (" + verdict.reason + ") - scoring engine result used.";
      }
    } catch (err) {
      notice = "LLM unavailable or invalid (" + (err.code || "error") + ") - scoring engine result used.";
    }
  } else {
    notice = "No LLM key configured - scoring engine only.";
  }

  return {
    recommended_hospital: pick.hospital_id,
    hospital_name: pick.name,
    hospital_score: pick.score,
    estimated_eta_minutes: pick.eta_minutes,
    distance_km: pick.distance_km,
    hospital_reason: reason,
    needs: ranked.needs,
    ranking: ranked.ranking,
    excluded: ranked.excluded,
    mode: mode,
    llm_used: mode === "LLM",
    notice: notice,
    generated_at: new Date().toISOString()
  };
}

async function summarise(body, cfg) {
  const req = validate.summaryRequest(body);
  if (!llm.isConfigured(cfg)) {
    const e = new validate.ValidationError("No LLM key configured, so this service cannot write an AI summary. The frontend uses a template summary instead.", "LLM_NOT_CONFIGURED");
    e.httpStatus = 503;
    throw e;
  }
  const prompt = llm.summaryPrompt(req.facts);
  let text;
  try {
    text = validate.llmSummary(await llm.callLLM(cfg, prompt));
  } catch (err) {
    const e = new validate.ValidationError("LLM summary failed (" + (err.code || "error") + ").", err.code === "AI_MALFORMED" ? "AI_MALFORMED" : "LLM_UNAVAILABLE");
    e.httpStatus = 502;
    throw e;
  }
  return { summary: text, mode: "LLM", generated_at: new Date().toISOString() };
}

// ---- HTTP plumbing -----------------------------------------------------------------------
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_PER_MIN = 240;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
               ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function createServer(env) {
  env = env || process.env;
  const cfg = llm.getConfig(env);
  const extraOrigins = (env.ALLOWED_ORIGINS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const serveFrontend = String(env.SERVE_FRONTEND === undefined ? "1" : env.SERVE_FRONTEND) === "1";
  const frontendRoot = path.resolve(__dirname, "..", "frontend");
  const hits = new Map();

  function originAllowed(origin) {
    if (!origin) return true;                                           // same-origin / curl
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return extraOrigins.indexOf(origin) !== -1;
  }

  function rateLimited(ip) {
    const minute = Math.floor(Date.now() / 60000);
    const rec = hits.get(ip);
    if (!rec || rec.minute !== minute) { hits.set(ip, { minute: minute, count: 1 }); return false; }
    rec.count++;
    return rec.count > RATE_LIMIT_PER_MIN;
  }

  function send(res, status, payload, headers) {
    const data = JSON.stringify(payload);
    res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, headers || {}));
    res.end(data);
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      let size = 0; const chunks = [];
      req.on("data", function (c) {
        size += c.length;
        if (size > MAX_BODY_BYTES) { reject(Object.assign(new validate.ValidationError("Request body too large.", "BODY_TOO_LARGE"), { httpStatus: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", function () {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new validate.ValidationError("Request body is not valid JSON.", "INVALID_JSON")); }
      });
      req.on("error", reject);
    });
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.resolve(frontendRoot, "." + rel);
    if (file !== frontendRoot && file.indexOf(frontendRoot + path.sep) !== 0) { res.writeHead(403); return res.end("Forbidden"); }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
      res.end(buf);
    });
  }

  const server = http.createServer(async function (req, res) {
    const origin = req.headers.origin;
    const cors = {};
    if (origin && originAllowed(origin)) {
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
      cors["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      cors["Access-Control-Allow-Headers"] = "Content-Type";
    }

    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch (e) { return send(res, 400, { code: "BAD_URL", message: "Bad URL." }); }

    if (!pathname.startsWith("/api/")) {
      if (serveFrontend && req.method === "GET") return serveStatic(req, res, pathname);
      return send(res, 404, { code: "NOT_FOUND", message: "Not found." }, cors);
    }

    if (origin && !originAllowed(origin)) return send(res, 403, { code: "ORIGIN_NOT_ALLOWED", message: "This origin is not allowed." });
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (rateLimited(req.socket.remoteAddress || "unknown")) return send(res, 429, { code: "RATE_LIMITED", message: "Too many requests." }, cors);

    try {
      if (req.method === "GET" && pathname === "/api/ai/health") {
        return send(res, 200, {
          status: "ONLINE",
          engine: "weighted-scoring",
          llm_configured: llm.isConfigured(cfg),      // true/false only: the key and model are never exposed
          time: new Date().toISOString()
        }, cors);
      }
      if (req.method === "POST" && pathname === "/api/ai/ambulance-recommendation") return send(res, 200, await recommendAmbulance(await readBody(req), cfg), cors);
      if (req.method === "POST" && pathname === "/api/ai/hospital-recommendation") return send(res, 200, await recommendHospital(await readBody(req), cfg), cors);
      if (req.method === "POST" && pathname === "/api/ai/incident-summary") return send(res, 200, await summarise(await readBody(req), cfg), cors);
      return send(res, 404, { code: "NOT_FOUND", message: "Unknown endpoint." }, cors);
    } catch (err) {
      if (err instanceof validate.ValidationError) return send(res, err.httpStatus || 400, { code: err.code, message: err.message }, cors);
      console.error("[ai-service] unexpected error:", err && err.message);   // never log request bodies or keys
      return send(res, 500, { code: "INTERNAL_ERROR", message: "The AI service had an internal error." }, cors);
    }
  });

  server.cfg = cfg;
  return server;
}

module.exports = { createServer, recommendAmbulance, recommendHospital, summarise };

if (require.main === module) {
  loadEnvFile(path.join(__dirname, ".env"));
  const port = parseInt(process.env.PORT || "8787", 10);
  const server = createServer(process.env);
  server.listen(port, "127.0.0.1", function () {
    console.log("AI EMS service listening on http://localhost:" + port);
    console.log("  LLM layer : " + (llm.isConfigured(server.cfg) ? "ENABLED (model " + server.cfg.model + ")" : "disabled (scoring-engine mode; set AI_API_KEY to enable)"));
    if (String(process.env.SERVE_FRONTEND === undefined ? "1" : process.env.SERVE_FRONTEND) === "1") console.log("  Frontend  : http://localhost:" + port + "/");
  });
}
