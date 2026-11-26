/* Run with:  node test/run-tests.js      (no dependencies, uses a local fake LLM server) */
"use strict";
const assert = require("assert");
const http = require("http");
const scoring = require("../lib/scoring");
const { createServer } = require("../server");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS  " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + (e && e.message)); }
}

// ---- Same synthetic data as the frontend demo seed ---------------------------------------
const INCIDENT = { incident_id: "INC-2026-0001", severity: "HIGH", incident_type: "TRAUMA", latitude: 28.6139, longitude: 77.2090, location: "Near City Mall" };
const AMBS = [
  { ambulance_id: "AMB-001", status: "AVAILABLE", incident_id: null, latitude: 28.6005, longitude: 77.1938, capability: "ADVANCED", equipment: ["DEFIBRILLATOR", "VENTILATOR", "OXYGEN", "SPINAL_BOARD"], missions_today: 2 },
  { ambulance_id: "AMB-002", status: "AVAILABLE", incident_id: null, latitude: 28.6039, longitude: 77.2190, capability: "BASIC", equipment: ["OXYGEN"], missions_today: 1 }
];
const HOSPS = [
  { hospital_id: "HOSP-001", name: "City Emergency Hospital", emergency_department: "AVAILABLE", latitude: 28.6440, longitude: 77.2498, beds_available: 6, capabilities: ["TRAUMA", "CARDIAC", "SURGERY"] },
  { hospital_id: "HOSP-002", name: "Central Hospital", emergency_department: "AVAILABLE", latitude: 28.6320, longitude: 77.2250, beds_available: 3, capabilities: ["GENERAL", "ORTHO"] },
  { hospital_id: "HOSP-003", name: "Riverside Medical Centre", emergency_department: "UNAVAILABLE", latitude: 28.5998, longitude: 77.2998, beds_available: 0, capabilities: ["GENERAL"] }
];

// ---- Fake LLM server (stands in for the external API) -----------------------------------------
let fakeBehaviour = "good-first";
function startFakeLlm() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      let body = ""; req.on("data", function (c) { body += c; });
      req.on("end", function () {
        const data = JSON.parse(body);
        const user = JSON.parse(data.messages[0].content);
        const ids = (user.candidates || []).map(function (c) { return c.ambulance_id || c.hospital_id; });
        const reply = function (text) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text: text }] })); };
        if (fakeBehaviour === "http500") { res.writeHead(500); return res.end("boom"); }
        if (fakeBehaviour === "garbage") return reply("Sure! I would send the closest one.");
        if (fakeBehaviour === "unknown-id") return reply(JSON.stringify({ choice: "AMB-999", reason: "Looks best to me." }));
        if (fakeBehaviour === "fenced") return reply("```json\n" + JSON.stringify({ choice: ids[0], reason: "Fenced but valid answer." }) + "\n```");
        if (fakeBehaviour === "unsafe-last") return reply(JSON.stringify({ choice: ids[ids.length - 1], reason: "Closest one is fine." }));
        if (fakeBehaviour === "summary") return reply(JSON.stringify({ summary: "High-priority emergency near City Mall. AMB-001 is en route; tracking is simulated." }));
        if (fakeBehaviour === "timeout") return;                         // never answers
        reply(JSON.stringify({ choice: ids[0], reason: "LLM picked the top-ranked candidate." }));
      });
    });
    srv.listen(0, "127.0.0.1", function () { resolve(srv); });
  });
}

function startService(env) {
  return new Promise(function (resolve) {
    const s = createServer(env);
    s.listen(0, "127.0.0.1", function () { resolve({ server: s, base: "http://127.0.0.1:" + s.address().port }); });
  });
}
async function post(base, p, body, headers) {
  const r = await fetch(base + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(function () { return null; }) };
}

(async function main() {
  console.log("\nScoring engine");
  await test("distances match the demo seed (AMB-001 ~2.1 km, AMB-002 ~1.5 km)", function () {
    const d1 = scoring.haversineKm(AMBS[0].latitude, AMBS[0].longitude, INCIDENT.latitude, INCIDENT.longitude);
    const d2 = scoring.haversineKm(AMBS[1].latitude, AMBS[1].longitude, INCIDENT.latitude, INCIDENT.longitude);
    assert.ok(Math.abs(d1 - 2.1) < 0.15, "AMB-001 distance " + d1);
    assert.ok(Math.abs(d2 - 1.5) < 0.15, "AMB-002 distance " + d2);
  });
  await test("HIGH incident prefers ADVANCED AMB-001 even though AMB-002 is closer", function () {
    const r = scoring.rankAmbulances(INCIDENT, AMBS);
    assert.strictEqual(r.ranking[0].ambulance_id, "AMB-001");
    assert.ok(r.ranking[1].distance_km < r.ranking[0].distance_km, "AMB-002 should be closer");
  });
  await test("LOW incident does not waste the advanced unit when a basic unit is closer", function () {
    const r = scoring.rankAmbulances(Object.assign({}, INCIDENT, { severity: "LOW", incident_type: "GENERAL" }), AMBS);
    assert.strictEqual(r.ranking[0].ambulance_id, "AMB-002");
  });
  await test("assigned / missing-coordinate ambulances are excluded", function () {
    const list = [Object.assign({}, AMBS[0], { status: "ASSIGNED" }), Object.assign({}, AMBS[1], { latitude: undefined })];
    const r = scoring.rankAmbulances(INCIDENT, list);
    assert.strictEqual(r.ranking.length, 0);
    assert.strictEqual(r.excluded.length, 2);
  });
  await test("only a basic unit left for HIGH: still ranked (emergency must not stall)", function () {
    const r = scoring.rankAmbulances(INCIDENT, [AMBS[1]]);
    assert.strictEqual(r.ranking.length, 1);
    assert.strictEqual(scoring.isAmbulanceChoiceAcceptable(r.needs, r.ranking, "AMB-002").ok, true);
  });
  await test("trauma incident prefers trauma hospital HOSP-001 over closer HOSP-002", function () {
    const r = scoring.rankHospitals(INCIDENT, HOSPS);
    assert.strictEqual(r.ranking[0].hospital_id, "HOSP-001");
    assert.ok(r.ranking[1].distance_km < r.ranking[0].distance_km);
    assert.ok(!r.ranking.some(function (x) { return x.hospital_id === "HOSP-003"; }), "unavailable hospital must be excluded");
  });
  await test("safety rule rejects a non-trauma hospital while a trauma hospital exists", function () {
    const r = scoring.rankHospitals(INCIDENT, HOSPS);
    assert.strictEqual(scoring.isHospitalChoiceAcceptable(r.needs, r.ranking, "HOSP-002").ok, false);
  });

  console.log("\nHTTP service, scoring-engine mode (no LLM key)");
  let svc = await startService({ SERVE_FRONTEND: "0" });
  await test("health reports ONLINE and llm_configured=false, and exposes no key", async function () {
    const r = await (await fetch(svc.base + "/api/ai/health")).json();
    assert.strictEqual(r.status, "ONLINE"); assert.strictEqual(r.llm_configured, false);
    assert.ok(!JSON.stringify(r).toLowerCase().includes("key\":\"") );
  });
  await test("ambulance recommendation -> AMB-001, mode SCORING_ENGINE, expected JSON shape", async function () {
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", { incident: INCIDENT, ambulances: AMBS });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.recommended_ambulance, "AMB-001");
    assert.strictEqual(r.json.mode, "SCORING_ENGINE"); assert.strictEqual(r.json.llm_used, false);
    assert.strictEqual(typeof r.json.ambulance_score, "number"); assert.strictEqual(typeof r.json.estimated_eta_minutes, "number");
    assert.ok(r.json.reason.length > 5);
  });
  await test("hospital recommendation -> HOSP-001 for trauma", async function () {
    const r = await post(svc.base, "/api/ai/hospital-recommendation", { incident: INCIDENT, hospitals: HOSPS });
    assert.strictEqual(r.json.recommended_hospital, "HOSP-001");
    assert.strictEqual(typeof r.json.hospital_score, "number");
  });
  await test("no eligible ambulance -> 422 NO_ELIGIBLE_AMBULANCE", async function () {
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", { incident: INCIDENT, ambulances: [Object.assign({}, AMBS[0], { status: "EN_ROUTE" })] });
    assert.strictEqual(r.status, 422); assert.strictEqual(r.json.code, "NO_ELIGIBLE_AMBULANCE");
  });
  await test("invalid IDs / coordinates / JSON are rejected with 400", async function () {
    let r = await post(svc.base, "/api/ai/ambulance-recommendation", { incident: Object.assign({}, INCIDENT, { incident_id: "INC; DROP TABLE" }), ambulances: AMBS });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, "INVALID_ID");
    r = await post(svc.base, "/api/ai/ambulance-recommendation", { incident: Object.assign({}, INCIDENT, { latitude: null }), ambulances: AMBS });
    assert.strictEqual(r.status, 400);
    r = await post(svc.base, "/api/ai/ambulance-recommendation", "{not json");
    assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, "INVALID_JSON");
  });
  await test("summary endpoint refuses (503) when no LLM key is set", async function () {
    const r = await post(svc.base, "/api/ai/incident-summary", { facts: { incident_id: "INC-2026-0001", severity: "HIGH" } });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.code, "LLM_NOT_CONFIGURED");
  });
  await test("disallowed browser origin gets 403", async function () {
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", { incident: INCIDENT, ambulances: AMBS }, { Origin: "https://evil.example" });
    assert.strictEqual(r.status, 403);
  });
  await test("oversized body is rejected", async function () {
    let status = 0;
    try { status = (await post(svc.base, "/api/ai/ambulance-recommendation", JSON.stringify({ pad: "x".repeat(70000) }))).status; } catch (e) { status = 413; }
    assert.strictEqual(status, 413);
  });
  svc.server.close();

  console.log("\nHTTP service, LLM layer (fake LLM server)");
  const fake = await startFakeLlm();
  const llmEnv = { SERVE_FRONTEND: "0", AI_API_KEY: "test-key-not-real", AI_API_URL: "http://127.0.0.1:" + fake.address().port + "/v1/messages", AI_TIMEOUT_MS: "1500" };
  svc = await startService(llmEnv);
  const ambReq = { incident: INCIDENT, ambulances: AMBS };

  await test("valid LLM answer -> mode LLM, engine score kept", async function () {
    fakeBehaviour = "good-first";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.json.mode, "LLM"); assert.strictEqual(r.json.llm_used, true);
    assert.strictEqual(r.json.recommended_ambulance, "AMB-001");
    assert.strictEqual(r.json.ambulance_score, r.json.ranking[0].score);
  });
  await test("LLM answer wrapped in code fences is still parsed", async function () {
    fakeBehaviour = "fenced";
    assert.strictEqual((await post(svc.base, "/api/ai/ambulance-recommendation", ambReq)).json.mode, "LLM");
  });
  await test("malformed LLM text -> falls back to scoring engine", async function () {
    fakeBehaviour = "garbage";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.mode, "SCORING_ENGINE"); assert.ok(/AI_MALFORMED/.test(r.json.notice));
  });
  await test("LLM invents an unknown ambulance ID -> rejected", async function () {
    fakeBehaviour = "unknown-id";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.json.mode, "SCORING_ENGINE"); assert.strictEqual(r.json.recommended_ambulance, "AMB-001");
  });
  await test("LLM picks the unsafe (basic) ambulance for a HIGH incident -> rejected by safety rule", async function () {
    fakeBehaviour = "unsafe-last";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.json.mode, "SCORING_ENGINE"); assert.strictEqual(r.json.recommended_ambulance, "AMB-001");
    assert.ok(/safety rule/.test(r.json.notice));
  });
  await test("LLM HTTP 500 -> falls back, request still succeeds", async function () {
    fakeBehaviour = "http500";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.mode, "SCORING_ENGINE");
  });
  await test("LLM timeout -> falls back", async function () {
    fakeBehaviour = "timeout";
    const r = await post(svc.base, "/api/ai/ambulance-recommendation", ambReq);
    assert.strictEqual(r.json.mode, "SCORING_ENGINE"); assert.ok(/LLM_UNREACHABLE/.test(r.json.notice));
  });
  await test("hospital: LLM choosing the non-trauma hospital for trauma is rejected", async function () {
    fakeBehaviour = "unsafe-last";
    const r = await post(svc.base, "/api/ai/hospital-recommendation", { incident: INCIDENT, hospitals: HOSPS });
    assert.strictEqual(r.json.recommended_hospital, "HOSP-001"); assert.strictEqual(r.json.mode, "SCORING_ENGINE");
  });
  await test("summary via LLM works and the error path returns 502", async function () {
    fakeBehaviour = "summary";
    let r = await post(svc.base, "/api/ai/incident-summary", { facts: { incident_id: "INC-2026-0001", severity: "HIGH", status: "EN_ROUTE", ambulance_id: "AMB-001" } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.mode, "LLM");
    fakeBehaviour = "garbage";
    r = await post(svc.base, "/api/ai/incident-summary", { facts: { incident_id: "INC-2026-0001", severity: "HIGH" } });
    assert.strictEqual(r.status, 502);
  });
  await test("the API key never appears in any response", async function () {
    fakeBehaviour = "good-first";
    const r = await fetch(svc.base + "/api/ai/health"); const t = await r.text();
    assert.ok(!t.includes("test-key-not-real"));
    const a = await (await fetch(svc.base + "/api/ai/ambulance-recommendation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ambReq) })).text();
    assert.ok(!a.includes("test-key-not-real"));
  });
  svc.server.close(); fake.close();

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
})();
