/* Headless end-to-end test of the automated EMS workflow.
   Loads the REAL api.js + rules.js + automation.js into a Node VM (fake localStorage) and runs them
   against the REAL ai-service. Run with:   node tests/pipeline.test.js          */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { createServer } = require("../ai-service/server");

const JS = path.join(__dirname, "..", "frontend", "js");
const read = function (f) { return fs.readFileSync(path.join(JS, f), "utf8"); };
const J = function (x) { return JSON.parse(JSON.stringify(x)); };
const INC = "INC-2026-0001";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS  " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n        ") : e)); }
}

// Build a fresh "browser" with its own localStorage and the project scripts loaded.
function loadWorld(opts) {
  opts = opts || {};
  const store = {};
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, fetch, AbortController, URL,
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } }
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  let api = read("api.js")
    .replace("const MOCK_LATENCY_MS = 250;", "const MOCK_LATENCY_MS = 0;")
    .replace("const AI_ENABLED = true;", "const AI_ENABLED = " + (opts.ai !== false) + ";")
    .replace("const AUTO_DISPATCH_ENABLED = true;", "const AUTO_DISPATCH_ENABLED = " + (opts.auto !== false) + ";")
    .replace("http://localhost:8787", "http://127.0.0.1:" + (opts.port || 8787))
    .replace("const AI_REQUEST_TIMEOUT_MS = 6000;", "const AI_REQUEST_TIMEOUT_MS = 1500;");
  vm.runInContext(api, ctx, { filename: "api.js" });
  vm.runInContext(read("rules.js"), ctx, { filename: "rules.js" });
  vm.runInContext(read("automation.js"), ctx, { filename: "automation.js" });
  vm.runInContext("AUTOMATION_CONFIG.stepDelayMs = 0;", ctx);
  ctx.run = function (code) { return vm.runInContext(code, ctx); };
  ctx.state = function (id) { return J(ctx.run("getAutomationState('" + (id || INC) + "')")); };
  ctx.incident = async function (id) { return J(await ctx.run("getIncident('" + (id || INC) + "')")); };
  ctx.logText = function (id) { return ctx.state(id).log.map(function (l) { return l.text; }); };
  ctx.tick = function () { return ctx.run("Automation.tick()"); };
  return ctx;
}

function startRealService(port) {
  return new Promise(function (resolve) {
    const s = createServer({ SERVE_FRONTEND: "0" });
    s.listen(port, "127.0.0.1", function () { resolve(s); });
  });
}
function startFakeAi(port, handler) {
  return new Promise(function (resolve) {
    const s = http.createServer(function (req, res) {
      let b = ""; req.on("data", function (c) { b += c; });
      req.on("end", function () {
        res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Content-Type", "application/json");
        if (req.url.indexOf("/health") !== -1) return res.end(JSON.stringify({ status: "ONLINE", llm_configured: false }));
        handler(req.url, b ? JSON.parse(b) : null, res);
      });
    });
    s.listen(port, "127.0.0.1", function () { resolve(s); });
  });
}
function indexOfLog(lines, needle) { return lines.findIndex(function (l) { return l.indexOf(needle) !== -1; }); }

(async function main() {
  const PORT = 18787;

  // =====================================================================================
  console.log("\nAI MODE (service online, scoring-engine)");
  let svc = await startRealService(PORT);
  let w = loadWorld({ port: PORT });

  await test("a verified HIGH incident is fully handled by ONE tick, with no clicks", async function () {
    await w.tick();
    const inc = await w.incident();
    assert.strictEqual(inc.ambulance_id, "AMB-001", "advanced unit must be chosen over the closer basic unit");
    assert.strictEqual(inc.status, "EN_ROUTE");
    assert.strictEqual(inc.hospital_id, "HOSP-001", "trauma hospital must be chosen over the closer non-trauma one");
  });
  await test("the activity log shows the demo sequence in the right order", async function () {
    const L = w.logText();
    const order = ["Incident received", "AI ambulance analysis started", "AMB-001 recommended", "Safety validation passed",
      "AMB-001 automatically assigned", "Status changed to EN_ROUTE", "Family notification initiated", "AI hospital analysis started", "HOSP-001"];
    let last = -1;
    order.forEach(function (n) { const i = indexOfLog(L, n); assert.ok(i > last, "'" + n + "' missing or out of order (idx " + i + " after " + last + ")"); last = i; });
  });
  await test("decision mode is honest: ENGINE MODE (SCORING_ENGINE), not AI/LLM", function () {
    const s = w.state();
    assert.strictEqual(s.decision_mode, "SCORING_ENGINE");
    assert.strictEqual(s.ambulance_recommendation.mode, "SCORING_ENGINE");
    assert.strictEqual(typeof s.ambulance_recommendation.ambulance_score, "number");
    assert.strictEqual(typeof s.hospital_recommendation.hospital_score, "number");
  });
  await test("the closer BASIC ambulance AMB-002 was NOT touched", async function () {
    const ambs = J(await w.run("getAmbulances()"));
    assert.strictEqual(ambs.find(function (a) { return a.ambulance_id === "AMB-002"; }).status, "AVAILABLE");
    assert.strictEqual(ambs.find(function (a) { return a.ambulance_id === "AMB-001"; }).incident_id, INC);
  });
  await test("only AUTHORIZED contacts were notified, via the simulated channel, message has no medical data", async function () {
    const inc = await w.incident();
    assert.strictEqual(inc.notifications.length, 2);
    inc.notifications.forEach(function (n) {
      assert.strictEqual(n.is_simulated, true); assert.strictEqual(n.triggered_by, "AUTO");
      assert.ok(n.recipient_name !== "Demo Neighbour");
      assert.ok(n.message.indexOf(INC) !== -1, "same incident ID in message");
      assert.ok(!/O\+|Penicillin|blood|allerg|biometric/i.test(n.message), "no medical data in message: " + n.message);
    });
    assert.strictEqual(w.state().notification, "SENT_SIMULATED");
  });
  await test("other incidents are not auto-dispatched (INC-0002 unverified, INC-0003 LOW)", async function () {
    const i2 = await w.incident("INC-2026-0002"), i3 = await w.incident("INC-2026-0003");
    assert.strictEqual(i2.ambulance_id, null); assert.strictEqual(i3.ambulance_id, null);
    assert.ok(/Member 2/.test(w.state("INC-2026-0002").blocked.reason));
    assert.ok(/threshold/.test(w.state("INC-2026-0003").blocked.reason));
  });
  await test("a second tick does not repeat anything (idempotent: still 1 assignment, 2 notifications)", async function () {
    const before = w.logText().length;
    await w.tick(); await w.tick();
    assert.strictEqual((await w.incident()).notifications.length, 2);
    assert.strictEqual(w.logText().filter(function (t) { return /automatically assigned \(status/.test(t); }).length, 1);
    assert.ok(w.logText().length <= before + 2, "unexpected extra log lines");
  });
  await test("simulated GPS geofence: ARRIVED -> (operator) PICKED_UP -> automatic TO_HOSPITAL -> HOSPITAL_ARRIVED", async function () {
    // teleport the simulated ambulance onto the scene
    w.run("(function(){const db=mockLoadDB();const a=db.ambulances.find(x=>x.ambulance_id==='AMB-001');const i=db.incidents[0];a.latitude=i.latitude;a.longitude=i.longitude;a.position_updated_at=Date.now();mockSaveDB(db);})()");
    await w.tick(); assert.strictEqual((await w.incident()).status, "ARRIVED");
    await w.run("updateIncidentStatus('" + INC + "','PATIENT_PICKED_UP')");       // crew confirms (a human fact)
    await w.tick(); assert.strictEqual((await w.incident()).status, "TO_HOSPITAL");
    w.run("(function(){const db=mockLoadDB();const a=db.ambulances.find(x=>x.ambulance_id==='AMB-001');const h=db.hospitals.find(x=>x.hospital_id==='HOSP-001');a.latitude=h.latitude;a.longitude=h.longitude;a.position_updated_at=Date.now();mockSaveDB(db);})()");
    await w.tick(); assert.strictEqual((await w.incident()).status, "HOSPITAL_ARRIVED");
  });
  svc.close();

  // =====================================================================================
  console.log("\nFALLBACK MODE (AI service not running)");
  w = loadWorld({ port: 19999 });          // nothing listens here
  await test("workflow still completes; log says AI unavailable and fallback used", async function () {
    await w.tick();
    const inc = await w.incident();
    assert.strictEqual(inc.ambulance_id, "AMB-001"); assert.strictEqual(inc.hospital_id, "HOSP-001"); assert.strictEqual(inc.status, "EN_ROUTE");
    const L = w.logText();
    assert.ok(indexOfLog(L, "AI unavailable — using safe fallback dispatch logic") !== -1);
    assert.strictEqual(w.state().decision_mode, "FALLBACK");
    assert.strictEqual(w.state().ambulance_recommendation.ambulance_score, null, "fallback must not invent a score");
  });

  // =====================================================================================
  console.log("\nRULES MODE (AI_ENABLED = false) and MANUAL MODE (AUTO_DISPATCH_ENABLED = false)");
  w = loadWorld({ ai: false });
  await test("AI off: automatic dispatch still works with local rules, labelled RULES", async function () {
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, "AMB-001");
    assert.strictEqual(w.state().decision_mode, "RULES");
  });
  w = loadWorld({ auto: false });
  await test("manual mode: tick does nothing at all", async function () {
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, null);
    assert.strictEqual(w.state().log.length, 0);
  });

  // =====================================================================================
  console.log("\nAI SAFETY: bad AI output must never cause an action");
  const goodHospital = function (id) { return { recommended_hospital: id, hospital_name: "x", hospital_score: 80, estimated_eta_minutes: 8, hospital_reason: "ok reason", mode: "SCORING_ENGINE" }; };
  let fake = await startFakeAi(PORT, function (url, body, res) {
    if (url.indexOf("ambulance") !== -1) return res.end(JSON.stringify({ recommended_ambulance: "AMB-002", ambulance_score: 99, estimated_eta_minutes: 4, reason: "closest", mode: "LLM" }));   // valid shape, UNSAFE choice
    res.end(JSON.stringify(goodHospital("HOSP-002")));                                                                                                                                   // non-trauma hospital for a trauma case
  });
  w = loadWorld({ port: PORT });
  await test("AI picks the closer BASIC ambulance + non-trauma hospital -> safety validation FAILS and safe choices are used", async function () {
    await w.tick();
    const inc = await w.incident();
    assert.strictEqual(inc.ambulance_id, "AMB-001", "unsafe AI pick must be overridden");
    assert.strictEqual(inc.hospital_id, "HOSP-001");
    const L = w.logText();
    assert.ok(indexOfLog(L, "Safety validation FAILED for AMB-002") !== -1);
    assert.ok(indexOfLog(L, "Safety validation FAILED for HOSP-002") !== -1);
  });
  fake.close();

  fake = await startFakeAi(PORT, function (url, body, res) {
    if (url.indexOf("ambulance") !== -1) return res.end(JSON.stringify({ recommended_ambulance: "AMB-001; DROP TABLE", ambulance_score: "high", reason: 5, mode: "??" }));
    res.end("{this is not json");
  });
  w = loadWorld({ port: PORT });
  await test("malformed AI JSON (bad ID, non-numeric score, broken JSON) -> rejected, fallback used, no crash", async function () {
    await w.tick();
    const inc = await w.incident();
    assert.strictEqual(inc.ambulance_id, "AMB-001"); assert.strictEqual(inc.hospital_id, "HOSP-001");
    assert.ok(indexOfLog(w.logText(), "AI response was malformed") !== -1);
    assert.strictEqual(w.state().decision_mode, "FALLBACK");
  });
  fake.close();

  // =====================================================================================
  console.log("\nERROR HANDLING");
  w = loadWorld({ ai: false });
  await test("no ambulance available: blocked ONCE (no log spam), then resumes automatically when one frees up", async function () {
    w.run("(function(){const db=mockLoadDB();db.ambulances.forEach(a=>{a.status='ASSIGNED';a.incident_id='INC-2026-0003';});mockSaveDB(db);})()");
    await w.tick(); await w.tick(); await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, null);
    assert.strictEqual(w.logText().filter(function (t) { return /No ambulance available/.test(t); }).length, 1);
    w.run("(function(){const db=mockLoadDB();const a=db.ambulances[0];a.status='AVAILABLE';a.incident_id=null;mockSaveDB(db);})()");
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, "AMB-001");
  });
  w = loadWorld({ ai: false });
  await test("missing incident coordinates: automation refuses to guess and asks for the operator", async function () {
    w.run("(function(){const db=mockLoadDB();db.incidents[0].latitude=null;mockSaveDB(db);})()");
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, null);
    assert.ok(/no valid coordinates/.test(w.state().blocked.reason));
  });
  w = loadWorld({ ai: false });
  await test("backend keeps rejecting dispatch: stops after 3 attempts and engages MANUAL OVERRIDE", async function () {
    w.run("dispatchAmbulance = async function(){ throw new ApiError('AMB-001 is already assigned (simulated conflict).','AMBULANCE_ALREADY_ASSIGNED',409); };");
    await w.tick(); await w.tick(); await w.tick(); await w.tick();
    assert.strictEqual(w.state().auto_mode, "OVERRIDE");
    assert.ok(indexOfLog(w.logText(), "rejected 3 times") !== -1);
  });
  w = loadWorld({ ai: false });
  await test("no hospital data: ambulance + notification still proceed, hospital step is blocked with a clear message", async function () {
    w.run("getHospitals = async function(){ return []; };");
    await w.tick();
    const inc = await w.incident();
    assert.strictEqual(inc.status, "EN_ROUTE"); assert.strictEqual(inc.hospital_id, null);
    assert.ok(/Missing hospital data/.test(w.state().blocked.reason));
  });
  w = loadWorld({ ai: false });
  await test("notification failure is shown, does not stop dispatch, and RETRY fixes it", async function () {
    w.run("setGlobalAutomationFlag('simulate_notify_failure', true);");
    await w.tick();
    assert.strictEqual((await w.incident()).hospital_id, "HOSP-001", "pipeline continued despite notification failure");
    assert.strictEqual(w.state().notification, "FAILED");
    assert.ok(indexOfLog(w.logText(), "FAILED") !== -1);
    await w.run("Automation.operatorRetryNotification('" + INC + "')");
    assert.strictEqual(w.state().notification, "SENT_SIMULATED");
    assert.strictEqual((await w.incident()).notifications.filter(function (n) { return n.status === "SIMULATED"; }).length, 2);
  });
  w = loadWorld({ ai: false });
  await test("unknown / malicious incident ID is ignored (no crash)", async function () {
    await w.run("Automation.processIncident('INC-9999-0000')");
    await w.run("Automation.processIncident('x; alert(1)')");
    assert.strictEqual(w.state("INC-9999-0000").log.filter(function (l) { return l.level === "error"; }).length, 0);
  });

  // =====================================================================================
  console.log("\nMANUAL OVERRIDE");
  w = loadWorld({ ai: false });
  await test("override BEFORE automation acts: nothing is dispatched", async function () {
    w.run("Automation.takeManualControl('" + INC + "')");
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, null);
    assert.ok(w.logText().some(function (t) { return /MANUAL OVERRIDE/.test(t); }));
  });
  await test("global pause stops everything; resume lets automation continue", async function () {
    w.run("Automation.resumeAuto('" + INC + "'); setGlobalAutomationPaused(true);");
    await w.tick(); assert.strictEqual((await w.incident()).ambulance_id, null);
    w.run("setGlobalAutomationPaused(false);");
    await w.tick(); assert.strictEqual((await w.incident()).ambulance_id, "AMB-001");
  });
  await test("operator changes ambulance after auto-assignment: old unit released, log shows OPERATOR actions, automation stays paused", async function () {
    const res = J(await w.run("Automation.operatorAssignAmbulance('" + INC + "','AMB-002')"));
    assert.strictEqual(res.previous_ambulance_id, "AMB-001");
    const ambs = J(await w.run("getAmbulances()"));
    assert.strictEqual(ambs.find(function (a) { return a.ambulance_id === "AMB-001"; }).status, "AVAILABLE");
    assert.strictEqual(ambs.find(function (a) { return a.ambulance_id === "AMB-002"; }).incident_id, INC);
    const s = w.state();
    assert.strictEqual(s.auto_mode, "OVERRIDE"); assert.strictEqual(s.decision_mode, "MANUAL");
    assert.ok(s.log.some(function (l) { return l.actor === "OPERATOR" && /changed the ambulance/.test(l.text); }));
    assert.ok(s.log.some(function (l) { return /not an advanced unit/.test(l.text); }), "capability mismatch must be logged as a warning");
    await w.tick();
    assert.strictEqual((await w.incident()).ambulance_id, "AMB-002", "automation must not undo the operator's choice");
  });
  await test("operator changes hospital; invalid status jump is rejected by the state machine", async function () {
    await w.run("Automation.operatorAssignHospital('" + INC + "','HOSP-002')");
    assert.strictEqual((await w.incident()).hospital_id, "HOSP-002");
    let code = null;
    try { await w.run("Automation.operatorAdvanceStatus('" + INC + "','HOSPITAL_ARRIVED')"); } catch (e) { code = e.code; }
    assert.strictEqual(code, "INVALID_STATUS_TRANSITION");
    code = null;
    try { await w.run("Automation.operatorAssignHospital('" + INC + "','HOSP-003')"); } catch (e) { code = e.code; }
    assert.strictEqual(code, "SAFETY_VALIDATION_FAILED", "unavailable hospital must be refused even for the operator");
  });
  await test("reassign is refused once the ambulance has reached the scene", async function () {
    await w.run("updateIncidentStatus('" + INC + "','ARRIVED')");
    let code = null;
    try { await w.run("reassignAmbulance('" + INC + "',{ambulance_id:'AMB-001'})"); } catch (e) { code = e.code; }
    assert.strictEqual(code, "REASSIGN_NOT_ALLOWED");
  });

  // =====================================================================================
  console.log("\nPRIVACY: what leaves the browser for the AI service");
  let captured = null;
  fake = await startFakeAi(PORT, function (url, body, res) { if (url.indexOf("ambulance") !== -1) captured = body; res.statusCode = 503; res.end(JSON.stringify({ code: "X", message: "down" })); });
  w = loadWorld({ port: PORT });
  await test("request to the AI service contains no blood group, allergy, patient name or confidence", async function () {
    await w.tick();
    assert.ok(captured, "request was captured");
    const raw = JSON.stringify(captured);
    assert.ok(!/O\+|Penicillin|Demo Patient|identity_confidence|blood|allerg/i.test(raw), "leak: " + raw.slice(0, 300));
    assert.ok(raw.indexOf(INC) !== -1);
  });
  fake.close();

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
})();
