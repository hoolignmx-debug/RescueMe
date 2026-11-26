/* ============================================================================
   automation.js  -  AUTOMATED EMS RESPONSE ORCHESTRATOR  (Member 3)

   Runs the workflow for every VERIFIED incident without operator clicks:

     Verified incident -> AI/ranking recommendation -> deterministic safety rules
        -> backend validation -> ASSIGN -> EN_ROUTE (tracking starts)
        -> authorized family notification (simulated) -> hospital recommendation
        -> safety rules -> backend -> hospital assigned -> AI EMS summary

   SAFETY ARCHITECTURE (every automatic action follows it):
        AI recommendation  ->  Rules.validate*()  ->  api.js (backend validates again)  ->  action
     * An AI answer is only DATA. It is validated, then re-checked against fresh data.
     * If the AI service fails, the SAME workflow continues with Rules.fallback*().
     * The operator can pause automation per incident (MANUAL OVERRIDE) at any time.

   This file has NO DOM code. It talks to data only through api.js and to the
   safety rules in rules.js. dashboard.js listens for the "automation:update"
   event to redraw. It runs while the dashboard is open (frontend-only demo);
   with a real backend this orchestration would live server-side (see README).
   ============================================================================ */
(function (root) {
  "use strict";

  const running = new Set();           // incidents currently being processed in THIS tab
  let ticking = false;
  let health = { status: "UNKNOWN", llm_configured: false, checkedAt: 0 };
  const summaryInFlight = new Set();

  const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  // ---- Small helpers ----------------------------------------------------------------
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function pause() { return AUTOMATION_CONFIG.stepDelayMs > 0 ? sleep(AUTOMATION_CONFIG.stepDelayMs) : Promise.resolve(); }

  function emitUpdate(incidentId) {
    try {
      if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent("automation:update", { detail: { incident_id: incidentId } }));
      }
    } catch (e) { /* UI listener problems must never stop the workflow */ }
  }

  function log(incidentId, text, level) {
    appendAutomationLog(incidentId, text, level || "info", "SYSTEM");
    emitUpdate(incidentId);
  }

  function operatorLog(incidentId, text, level) {
    appendAutomationLog(incidentId, text, level || "warn", "OPERATOR");
    emitUpdate(incidentId);
  }

  function markStep(incidentId, key) {
    updateAutomationState(incidentId, function (s) { if (!s.steps[key]) s.steps[key] = new Date().toISOString(); });
    emitUpdate(incidentId);
  }

  // "Blocked" = automation is waiting for something it cannot fix itself. Logged once per reason (no spam).
  function setBlocked(incidentId, reason, level) {
    const before = getAutomationState(incidentId).blocked;
    if (before && before.reason === reason) return;
    updateAutomationState(incidentId, function (s) { s.blocked = { reason: reason, at: new Date().toISOString() }; });
    log(incidentId, reason, level || "error");
  }

  function clearBlocked(incidentId) {
    if (getAutomationState(incidentId).blocked) updateAutomationState(incidentId, function (s) { s.blocked = null; });
  }

  // Is automation still allowed to act on this incident RIGHT NOW? (re-checked before every action)
  function stillAuto(incidentId) {
    if (!AUTO_DISPATCH_ENABLED) return false;
    if (getGlobalAutomation().paused) return false;
    return getAutomationState(incidentId).auto_mode === "ON";
  }

  function halted(incidentId, where) {
    const s = getAutomationState(incidentId);
    if (!s.steps.halt_logged_for || s.steps.halt_logged_for !== where) {
      updateAutomationState(incidentId, function (st) { st.steps.halt_logged_for = where; });
      log(incidentId, "Automation halted " + where + " (manual override or global pause).", "warn");
    }
  }

  function cleanError(err) {
    const msg = typeof describeError === "function" ? describeError(err) : String(err && err.message);
    return msg.replace(/^Unexpected problem: /, "");
  }

  // ---- AI health ----------------------------------------------------------------------------
  async function checkHealth(force) {
    if (!force && Date.now() - health.checkedAt < 8000) return health;
    if (!AI_ENABLED) { health = { status: "DISABLED", llm_configured: false, checkedAt: Date.now() }; return health; }
    try {
      const h = await getAiHealth();
      health = { status: h && h.status === "ONLINE" ? "ONLINE" : "DEGRADED", llm_configured: !!(h && h.llm_configured), checkedAt: Date.now() };
    } catch (err) {
      health = { status: "OFFLINE", llm_configured: false, checkedAt: Date.now() };
    }
    return health;
  }

  // ---- Decisions: AI first, deterministic fallback second ---------------------------------------------
  // Never throws for AI problems. Returns { ok:true, rec } or { ok:false, code, message }.
  async function decideAmbulance(incidentId, incident, ambulances) {
    let rec = null;

    if (AI_ENABLED) {
      try {
        const raw = await aiRecommendAmbulance(incident, ambulances);
        const verdict = Rules.validateAiAmbulanceResponse(raw);
        if (!verdict.ok) throw new ApiError("Malformed AI response: " + verdict.errors.join(" "), "AI_MALFORMED", 502);
        rec = verdict.value;
      } catch (err) {
        if (err.code === "NO_ELIGIBLE_AMBULANCE") {
          return { ok: false, code: "NO_AMBULANCE_AVAILABLE", message: "No ambulance is available right now." };
        }
        log(incidentId, (err.code === "AI_MALFORMED" ? "AI response was malformed" : "AI unavailable") +
          " — using safe fallback dispatch logic", "warn");
      }
    } else {
      log(incidentId, "AI is disabled (AI_ENABLED = false) — using local rules", "info");
    }

    if (!rec) {
      const fb = Rules.fallbackRecommendAmbulance(incident, ambulances);
      if (!fb.ok) return fb;
      rec = fb.value;
      if (!AI_ENABLED) rec.mode = "RULES";
    }
    return { ok: true, rec: rec };
  }

  async function decideHospital(incidentId, incident, hospitals) {
    let rec = null;

    if (AI_ENABLED) {
      try {
        const raw = await aiRecommendHospital(incident, hospitals);
        const verdict = Rules.validateAiHospitalResponse(raw);
        if (!verdict.ok) throw new ApiError("Malformed AI response: " + verdict.errors.join(" "), "AI_MALFORMED", 502);
        rec = verdict.value;
      } catch (err) {
        if (err.code === "NO_ELIGIBLE_HOSPITAL") {
          return { ok: false, code: "NO_HOSPITAL_AVAILABLE", message: "No hospital is accepting emergency patients right now." };
        }
        log(incidentId, (err.code === "AI_MALFORMED" ? "AI response was malformed" : "AI unavailable") +
          " — using safe fallback hospital logic", "warn");
      }
    }

    if (!rec) {
      const fb = Rules.fallbackRecommendHospital(incident, hospitals, incident.ambulance_id);
      if (!fb.ok) return fb;
      rec = fb.value;
      if (!AI_ENABLED) rec.mode = "RULES";
    }
    return { ok: true, rec: rec };
  }

  function modeTag(mode) { return "[" + Rules.modeInfo(mode).short + "]"; }

  // The backend said no. Re-evaluate on the next tick, but never loop forever: after 3 rejections hand over to the operator.
  function giveUpAfterRepeatedRejections(incidentId, counter, label) {
    const state = updateAutomationState(incidentId, function (s) { s[counter] = (s[counter] || 0) + 1; });
    if (state[counter] >= 3) {
      updateAutomationState(incidentId, function (s) { s.auto_mode = "OVERRIDE"; s.decision_mode = "MANUAL"; });
      log(incidentId, label + " was rejected 3 times — automation stopped and MANUAL OVERRIDE engaged. Operator action needed.", "error");
      return "HALT";
    }
    setBlocked(incidentId, label + " was rejected by the backend. Automation will re-evaluate; the operator can intervene.", "warn");
    return "BLOCKED";
  }

  // ---- STEP: ambulance ------------------------------------------------------------------------------------
  // Returns "OK" (ambulance now assigned), "BLOCKED" (waiting; will retry on a later tick) or "HALT".
  async function stepAmbulance(incidentId) {
    if (!stillAuto(incidentId)) { halted(incidentId, "before ambulance analysis"); return "HALT"; }

    let incident = await getIncident(incidentId);
    if (incident.ambulance_id) return "OK";                      // someone (or an earlier run) already assigned one

    const ambulances = await getAmbulances(incidentId);

    if (ambulances.filter(Rules.isAmbulanceEligible).length === 0) {
      setBlocked(incidentId, "No ambulance available. Automation will retry; the operator can intervene.", "error");
      return "BLOCKED";
    }
    log(incidentId, AI_ENABLED ? "AI ambulance analysis started" : "Ambulance analysis started (local rules)", "info");

    const decision = await decideAmbulance(incidentId, incident, ambulances);
    if (!decision.ok) {
      setBlocked(incidentId, decision.message + (decision.code === "MISSING_COORDINATES" ? " Operator action needed." : " Automation will retry."), "error");
      return "BLOCKED";
    }
    let rec = decision.rec;

    updateAutomationState(incidentId, function (s) { s.ambulance_recommendation = rec; s.decision_mode = rec.mode; });
    markStep(incidentId, "ai_analysis");
    log(incidentId, rec.recommended_ambulance + " recommended " + modeTag(rec.mode) +
      (typeof rec.ambulance_score === "number" ? " (score " + rec.ambulance_score + ")" : "") +
      (typeof rec.estimated_eta_minutes === "number" ? ", ETA " + rec.estimated_eta_minutes + " min" : "") + ": " + rec.reason, "ok");
    if (rec.notice) log(incidentId, "Note: " + rec.notice, "info");
    markStep(incidentId, "ambulance_selected");
    await pause();

    if (!stillAuto(incidentId)) { halted(incidentId, "before safety validation"); return "HALT"; }

    // Safety validation against FRESH data (the world may have changed during the AI call).
    let freshIncident = await getIncident(incidentId);
    let freshAmbulances = await getAmbulances(incidentId);
    let check = Rules.validateAmbulanceChoice(freshIncident, rec.recommended_ambulance, freshAmbulances);

    if (!check.ok) {
      log(incidentId, "Safety validation FAILED for " + rec.recommended_ambulance + ": " + check.reasons.join(" "), "error");
      const fb = Rules.fallbackRecommendAmbulance(freshIncident, freshAmbulances);
      if (!fb.ok) { setBlocked(incidentId, fb.message + " Automation will retry.", "error"); return "BLOCKED"; }
      rec = fb.value;
      updateAutomationState(incidentId, function (s) { s.ambulance_recommendation = rec; s.decision_mode = rec.mode; });
      check = Rules.validateAmbulanceChoice(freshIncident, rec.recommended_ambulance, freshAmbulances);
      if (!check.ok) { setBlocked(incidentId, "Safety validation failed again (" + check.reasons.join(" ") + "). Operator action needed.", "error"); return "BLOCKED"; }
      log(incidentId, "Safe fallback selected " + rec.recommended_ambulance + " instead " + modeTag(rec.mode), "warn");
    }
    log(incidentId, "Safety validation passed" + (check.warnings.length ? " (" + check.warnings.join(" ") + ")" : ""), "ok");
    await pause();

    if (!stillAuto(incidentId)) { halted(incidentId, "before dispatch"); return "HALT"; }

    // Backend validation happens inside dispatchAmbulance (availability, conflicts, valid status change).
    try {
      await dispatchAmbulance(incidentId, rec.recommended_ambulance);
    } catch (err) {
      if (err.code === "INCIDENT_ALREADY_HAS_AMBULANCE") { log(incidentId, "Another operator assigned an ambulance first — continuing from there.", "warn"); return "OK"; }
      log(incidentId, "Backend rejected the assignment: " + cleanError(err), "error");
      return giveUpAfterRepeatedRejections(incidentId, "dispatch_attempts", "Dispatch");
    }
    clearBlocked(incidentId);
    markStep(incidentId, "ambulance_assigned");
    log(incidentId, rec.recommended_ambulance + " automatically assigned (status ASSIGNED)", "ok");
    await pause();
    return "OK";
  }

  // ---- STEP: EN_ROUTE + tracking ---------------------------------------------------------------------------------
  async function stepEnRoute(incidentId) {
    let incident = await getIncident(incidentId);
    if (incident.status !== "ASSIGNED") return "OK";             // already moving (or further)
    if (!stillAuto(incidentId)) { halted(incidentId, "before EN_ROUTE"); return "HALT"; }

    try {
      await updateIncidentStatus(incidentId, "EN_ROUTE");        // backend enforces the valid status order
    } catch (err) {
      setBlocked(incidentId, "Could not set EN_ROUTE: " + cleanError(err), "error");
      return "BLOCKED";
    }
    markStep(incidentId, "en_route");
    log(incidentId, "Status changed to EN_ROUTE", "ok");

    try {
      const t = await getTracking(incidentId);
      markStep(incidentId, "tracking_started");
      log(incidentId, "Live tracking started (DEMO / SIMULATED GPS)" +
        (typeof t.distance_remaining_km === "number" ? ": " + t.distance_remaining_km.toFixed(1) + " km, ETA " + t.eta_minutes + " min (distance ÷ assumed speed, no live traffic)" : ""), "info");
    } catch (err) {
      log(incidentId, "Tracking data not available yet: " + cleanError(err), "warn");
    }
    await pause();
    return "OK";
  }

  // ---- STEP: family notification (SIMULATED) ----------------------------------------------------------------------
  // options.operator = true when the operator pressed RETRY. Only contacts without a success are (re)notified.
  async function runNotification(incidentId, options) {
    options = options || {};
    const incident = await getIncident(incidentId);

    let contacts;
    try {
      contacts = (await getEmergencyContacts(incidentId)).filter(function (c) { return c.authorized !== false; });
    } catch (err) {
      updateAutomationState(incidentId, function (s) { s.notification = "FAILED"; });
      markStep(incidentId, "notified");
      log(incidentId, "Family notification failed: could not load authorized contacts (" + cleanError(err) + ")", "error");
      return "FAILED";
    }

    if (contacts.length === 0) {
      updateAutomationState(incidentId, function (s) { s.notification = "SKIPPED"; });
      markStep(incidentId, "notified");
      log(incidentId, "No authorized contacts for this incident — family notification skipped", "warn");
      return "SKIPPED";
    }

    const already = {};
    (incident.notifications || []).forEach(function (n) { if (n.status === "SIMULATED") already[n.contact_id] = true; });
    const todo = contacts.filter(function (c) { return !already[c.contact_id]; });
    if (todo.length === 0) {
      updateAutomationState(incidentId, function (s) { s.notification = "SENT_SIMULATED"; });
      markStep(incidentId, "notified");
      return "SENT_SIMULATED";
    }

    const message = Rules.buildFamilyMessage(incident, incident.ambulance_id);   // no medical data, by design
    const channel = AUTOMATION_CONFIG.notifyChannel;
    log(incidentId, (options.operator ? "Retrying family notification" : "Family notification initiated") +
      " (" + todo.length + " authorized contact" + (todo.length === 1 ? "" : "s") + ", " + channel + " SIMULATED)", "info");

    const simulateFailure = USE_MOCK_API && getGlobalAutomation().simulate_notify_failure === true && !options.operator;
    let ok = 0, failed = 0;
    for (let i = 0; i < todo.length; i++) {
      try {
        await sendNotification(incidentId, {
          contact_id: todo[i].contact_id, channel: channel, message: message,
          triggered_by: options.operator ? "OPERATOR" : "AUTO",
          simulate_failure: simulateFailure ? true : undefined
        });
        ok++;
        log(incidentId, channel + " (simulated) recorded for " + todo[i].name, "ok");
      } catch (err) {
        failed++;
        log(incidentId, "Notification to " + todo[i].name + " FAILED: " + cleanError(err), "error");
      }
    }

    const total = Object.keys(already).length + ok;
    const result = failed === 0 ? "SENT_SIMULATED" : (total > 0 ? "PARTIAL" : "FAILED");
    updateAutomationState(incidentId, function (s) { s.notification = result; });
    markStep(incidentId, "notified");
    if (failed > 0) log(incidentId, "Notification " + result + ": the operator can press RETRY NOTIFICATION.", "warn");
    return result;
  }

  // ---- STEP: hospital ----------------------------------------------------------------------------------------------------
  async function stepHospital(incidentId) {
    let incident = await getIncident(incidentId);
    if (incident.hospital_id) return "OK";
    if (!incident.ambulance_id) return "BLOCKED";
    if (!stillAuto(incidentId)) { halted(incidentId, "before hospital selection"); return "HALT"; }

    log(incidentId, AI_ENABLED ? "AI hospital analysis started" : "Hospital analysis started (local rules)", "info");
    let hospitals;
    try {
      hospitals = await getHospitals(incidentId);
    } catch (err) {
      setBlocked(incidentId, "Hospital data unavailable: " + cleanError(err) + ". Automation will retry.", "error");
      return "BLOCKED";
    }
    if (!Array.isArray(hospitals) || hospitals.length === 0) {
      setBlocked(incidentId, "Missing hospital data. Operator can select a hospital manually.", "error");
      return "BLOCKED";
    }

    const decision = await decideHospital(incidentId, incident, hospitals);
    if (!decision.ok) {
      setBlocked(incidentId, decision.message + " Automation will retry; the operator can intervene.", "error");
      return "BLOCKED";
    }
    let rec = decision.rec;
    updateAutomationState(incidentId, function (s) { s.hospital_recommendation = rec; });
    log(incidentId, rec.recommended_hospital + " (" + rec.hospital_name + ") recommended " + modeTag(rec.mode) +
      (typeof rec.hospital_score === "number" ? " (score " + rec.hospital_score + ")" : "") +
      (typeof rec.estimated_eta_minutes === "number" ? ", ETA " + rec.estimated_eta_minutes + " min" : "") + ": " + rec.hospital_reason, "ok");
    if (rec.notice) log(incidentId, "Note: " + rec.notice, "info");
    await pause();

    if (!stillAuto(incidentId)) { halted(incidentId, "before hospital assignment"); return "HALT"; }

    incident = await getIncident(incidentId);
    let fresh = await getHospitals(incidentId);
    let check = Rules.validateHospitalChoice(incident, rec.recommended_hospital, fresh);
    if (!check.ok) {
      log(incidentId, "Safety validation FAILED for " + rec.recommended_hospital + ": " + check.reasons.join(" "), "error");
      const fb = Rules.fallbackRecommendHospital(incident, fresh, incident.ambulance_id);
      if (!fb.ok) { setBlocked(incidentId, fb.message + " Automation will retry.", "error"); return "BLOCKED"; }
      rec = fb.value;
      updateAutomationState(incidentId, function (s) { s.hospital_recommendation = rec; });
      check = Rules.validateHospitalChoice(incident, rec.recommended_hospital, fresh);
      if (!check.ok) { setBlocked(incidentId, "Hospital safety validation failed again (" + check.reasons.join(" ") + "). Operator action needed.", "error"); return "BLOCKED"; }
      log(incidentId, "Safe fallback selected " + rec.recommended_hospital + " instead " + modeTag(rec.mode), "warn");
    }
    log(incidentId, "Hospital safety validation passed" + (check.warnings.length ? " (" + check.warnings.join(" ") + ")" : ""), "ok");

    try {
      await assignHospital(incidentId, {
        hospital_id: rec.recommended_hospital,
        ambulance_id: incident.ambulance_id,
        eta_minutes: typeof rec.estimated_eta_minutes === "number" ? rec.estimated_eta_minutes : null
      });
    } catch (err) {
      log(incidentId, "Backend rejected the hospital assignment: " + cleanError(err), "error");
      return giveUpAfterRepeatedRejections(incidentId, "hospital_attempts", "Hospital assignment");
    }
    clearBlocked(incidentId);
    markStep(incidentId, "hospital_selected");
    log(incidentId, rec.hospital_name + " automatically assigned; incoming patient information sent to the hospital (simulated, same incident ID for Member 4)", "ok");
    return "OK";
  }

  // ---- AI EMS summary ------------------------------------------------------------------------------------------------------
  async function refreshSummary(incidentId) {
    if (summaryInFlight.has(incidentId)) return;
    summaryInFlight.add(incidentId);
    try {
      const incident = await getIncident(incidentId);
      const state = getAutomationState(incidentId);

      let etaMinutes = null;
      let hospitalName = null;
      if (incident.ambulance_id) {
        try { const t = await getTracking(incidentId); etaMinutes = typeof t.eta_minutes === "number" ? t.eta_minutes : null; } catch (e) { /* optional */ }
      }
      if (incident.hospital_id) {
        try {
          const hs = await getHospitals();
          const h = hs.find(function (x) { return x.hospital_id === incident.hospital_id; });
          hospitalName = h ? h.name : incident.hospital_id;
        } catch (e) { hospitalName = incident.hospital_id; }
      }

      const ctx = { incident: incident, ambulanceId: incident.ambulance_id, etaMinutes: etaMinutes, hospitalName: hospitalName,
                    notification: state.notification, autoMode: state.auto_mode, decisionMode: state.decision_mode };

      let text = null;
      let source = "TEMPLATE";
      await checkHealth(false);
      if (AI_ENABLED && health.status === "ONLINE" && health.llm_configured) {
        try {
          const raw = await aiIncidentSummary({
            incident_id: incident.incident_id, severity: incident.severity, location: incident.location || "",
            identity_verified: incident.identity_verified === true, status: incident.status,
            ambulance_id: incident.ambulance_id || null, eta_minutes: etaMinutes, hospital_name: hospitalName,
            notification: state.notification, auto_mode: state.auto_mode, decision_mode: state.decision_mode || "SCORING_ENGINE"
          });
          const verdict = Rules.validateAiSummaryResponse(raw);
          if (verdict.ok) { text = verdict.value.summary; source = "LLM"; }
        } catch (err) { /* fall through to the template */ }
      }
      if (text === null) text = Rules.buildTemplateSummary(ctx);

      updateAutomationState(incidentId, function (s) { s.summary = { text: text, source: source, at: new Date().toISOString(), status: incident.status }; });
      emitUpdate(incidentId);
    } catch (err) {
      console.warn("[automation] summary refresh failed:", err);
    } finally {
      summaryInFlight.delete(incidentId);
    }
  }

  // ---- The pipeline for ONE incident ---------------------------------------------------------------------------------------------
  async function runPipeline(incidentId) {
    let incident = await getIncident(incidentId);                // INCIDENT_NOT_FOUND etc. are handled by the caller
    let state = getAutomationState(incidentId);

    if (!state.steps.received) {
      log(incidentId, "Incident received (severity " + incident.severity + ", type " + (incident.incident_type || "GENERAL") + ", needs: " + Rules.needsLabel(incident) + ")", "info");
      markStep(incidentId, "received");
      await pause();
    }

    if (!Rules.hasCoords(incident)) {
      setBlocked(incidentId, "Incident has no valid coordinates, so automatic dispatch is not possible. Operator action needed.", "error");
      return;
    }

    if (!state.steps.verified) {
      log(incidentId, "Incident verified by Member 2 (a face match is probable, not absolute proof)", "ok");
      markStep(incidentId, "verified");
      await pause();
    }

    // 1. Ambulance
    const amb = await stepAmbulance(incidentId);
    if (amb !== "OK") return;

    // 2. EN_ROUTE (tracking starts)
    const route = await stepEnRoute(incidentId);
    if (route !== "OK") return;

    // 3. Family notification (once automatically; failures are retried by the operator)
    if (!getAutomationState(incidentId).steps.notified && stillAuto(incidentId)) {
      await runNotification(incidentId, {});
      await pause();
    }

    // 4. Hospital
    const hosp = await stepHospital(incidentId);

    // 5. Summary
    await refreshSummary(incidentId);
    if (hosp === "OK") clearBlocked(incidentId);
  }

  async function processIncident(incidentId) {
    if (!AUTO_DISPATCH_ENABLED) return;
    if (!Rules.isValidId(incidentId)) { console.warn("[automation] invalid incident ID ignored"); return; }
    if (running.has(incidentId)) return;
    if (!tryAcquireAutomationLock(incidentId, 60000)) return;    // another tab is already working on it
    running.add(incidentId);
    try {
      await runPipeline(incidentId);
    } catch (err) {
      if (err && err.code === "INCIDENT_NOT_FOUND") {
        console.warn("[automation] incident not found:", incidentId);
      } else {
        setBlocked(incidentId, "Automation error: " + cleanError(err) + ". Automation will retry; the operator can intervene.", "error");
      }
    } finally {
      running.delete(incidentId);
      releaseAutomationLock(incidentId);
      emitUpdate(incidentId);
    }
  }

  // ---- Progress after dispatch (geofence arrival, automatic TO_HOSPITAL) ------------------------------------------------------------------------
  async function monitorIncident(incident) {
    const id = incident.incident_id;
    if (!incident.ambulance_id || incident.status === "HOSPITAL_ARRIVED") return;
    if (!stillAuto(id) || running.has(id)) return;

    const state = getAutomationState(id);

    // Keep the AI EMS summary in step with the incident status.
    if (!state.summary || state.summary.status !== incident.status) { refreshSummary(id); }

    if (!AUTOMATION_CONFIG.autoArrivalGeofence) return;

    let tracking = null;
    if (incident.status === "EN_ROUTE" || incident.status === "TO_HOSPITAL") {
      try { tracking = await getTracking(id); } catch (err) { return; }
    }

    try {
      if (incident.status === "EN_ROUTE" && tracking && tracking.destination === "INCIDENT" && tracking.eta_minutes === 0) {
        await updateIncidentStatus(id, "ARRIVED");
        markStep(id, "arrived");
        log(id, "Ambulance reached the scene (simulated GPS geofence) — status ARRIVED. Waiting for the crew to confirm PATIENT PICKED UP.", "ok");
      } else if (incident.status === "PATIENT_PICKED_UP" && incident.hospital_id) {
        await updateIncidentStatus(id, "TO_HOSPITAL");
        markStep(id, "picked_up");
        log(id, "Patient on board and hospital already assigned — status TO_HOSPITAL", "ok");
      } else if (incident.status === "TO_HOSPITAL" && tracking && tracking.destination === "HOSPITAL" && tracking.eta_minutes === 0) {
        await updateIncidentStatus(id, "HOSPITAL_ARRIVED");
        markStep(id, "hospital_arrived");
        log(id, "Ambulance reached the hospital (simulated GPS geofence) — status HOSPITAL_ARRIVED. Incident complete.", "ok");
      }
    } catch (err) {
      log(id, "Automatic status change failed: " + cleanError(err), "error");
    }
  }

  // ---- What still needs doing for this incident? -------------------------------------------------------------------------------------------------------
  function needsPipeline(incident, state) {
    if (!incident.ambulance_id) return true;
    if (incident.status === "ASSIGNED") return true;
    if (!state.steps.notified) return true;
    if (!incident.hospital_id) return true;
    return false;
  }

  function isEligibleForAuto(incident, state) {
    if (incident.status === "HOSPITAL_ARRIVED") return { ok: false, reason: null };
    const verified = incident.identity_verified === true || INCIDENT_STATUS_FLOW.indexOf(incident.status) >= INCIDENT_STATUS_FLOW.indexOf("IDENTITY_VERIFIED");
    if (AUTOMATION_CONFIG.requireIdentityVerified && !verified) {
      return { ok: false, reason: "Waiting for Member 2 to verify the incident." };
    }
    if (AUTOMATION_CONFIG.autoDispatchSeverities.indexOf(incident.severity) === -1 && !state.forced) {
      return { ok: false, reason: "Severity " + incident.severity + " is below the auto-dispatch threshold. Waiting for the operator (or press RUN AUTO-DISPATCH)." };
    }
    return { ok: true, reason: null };
  }

  // ---- The heartbeat (called by the dashboard) ---------------------------------------------------------------------------------------------------------
  async function tick() {
    if (!AUTO_DISPATCH_ENABLED || ticking) return;
    ticking = true;
    try {
      await checkHealth(false);
      if (getGlobalAutomation().paused) return;

      const incidents = (await getIncidents()).slice().sort(function (a, b) {
        const sa = SEVERITY_ORDER[a.severity] === undefined ? 3 : SEVERITY_ORDER[a.severity];
        const sb = SEVERITY_ORDER[b.severity] === undefined ? 3 : SEVERITY_ORDER[b.severity];
        return sa - sb || new Date(a.emergency_time) - new Date(b.emergency_time);
      });

      for (let i = 0; i < incidents.length; i++) {
        const incident = incidents[i];
        if (!Rules.isValidId(incident.incident_id)) continue;
        const state = getAutomationState(incident.incident_id);
        if (state.auto_mode !== "ON") continue;

        const eligibility = isEligibleForAuto(incident, state);
        if (!eligibility.ok) {
          if (eligibility.reason && (!state.blocked || state.blocked.reason !== eligibility.reason)) {
            updateAutomationState(incident.incident_id, function (s) { s.blocked = { reason: eligibility.reason, at: new Date().toISOString() }; });
            emitUpdate(incident.incident_id);
          }
          continue;
        }
        let current = incident;
        if (needsPipeline(incident, state)) {
          await processIncident(incident.incident_id);
          current = await getIncident(incident.incident_id);       // the pipeline may have changed it
        }
        if (current.ambulance_id) await monitorIncident(current);
      }
    } catch (err) {
      console.warn("[automation] tick failed:", err);
    } finally {
      ticking = false;
    }
  }

  // ===========================================================================================
  // OPERATOR CONTROLS (MANUAL OVERRIDE). Every one of them is written to the activity log.
  // ===========================================================================================
  function takeManualControl(incidentId) {
    updateAutomationState(incidentId, function (s) { s.auto_mode = "OVERRIDE"; s.decision_mode = s.decision_mode || "MANUAL"; });
    operatorLog(incidentId, "MANUAL OVERRIDE: operator took control — automation paused for this incident.", "warn");
  }

  function resumeAuto(incidentId) {
    updateAutomationState(incidentId, function (s) { s.auto_mode = "ON"; s.blocked = null; s.steps.halt_logged_for = null; });
    operatorLog(incidentId, "AUTO MODE resumed by the operator.", "info");
  }

  // The operator wants automation to handle an incident that is below the auto-dispatch threshold.
  function runAutoDispatchNow(incidentId) {
    updateAutomationState(incidentId, function (s) { s.forced = true; s.auto_mode = "ON"; s.blocked = null; });
    operatorLog(incidentId, "Operator requested AUTO-DISPATCH for this incident.", "info");
  }

  function ensureOverride(incidentId) {
    if (getAutomationState(incidentId).auto_mode !== "OVERRIDE") takeManualControl(incidentId);
  }

  function failValidation(check) {
    throw new ApiError("Safety validation failed: " + check.reasons.join(" "), "SAFETY_VALIDATION_FAILED", 409);
  }

  // Choose a different (or first) ambulance. Validated by the same hard rules; capability mismatch is allowed with a warning
  // because the human dispatcher has the final say.
  async function operatorAssignAmbulance(incidentId, ambulanceId) {
    if (!Rules.isValidId(incidentId) || !Rules.isValidId(ambulanceId)) throw new ApiError("Invalid incident or ambulance ID.", "INVALID_ID", 400);
    ensureOverride(incidentId);
    const incident = await getIncident(incidentId);
    const fresh = await getAmbulances(incidentId);
    // On a swap, the unit currently assigned to this incident is about to be RELEASED, so for the capability
    // check it counts as available (otherwise swapping an advanced unit for a basic one would look harmless).
    const asUnassigned = Object.assign({}, incident, { ambulance_id: null });
    const freshForCheck = fresh.map(function (a) {
      return incident.ambulance_id && a.ambulance_id === incident.ambulance_id ? Object.assign({}, a, { status: "AVAILABLE", incident_id: null }) : a;
    });
    const check = Rules.validateAmbulanceChoice(asUnassigned, ambulanceId, freshForCheck, { operator: true });
    if (!check.ok) failValidation(check);

    let result;
    if (incident.ambulance_id) {
      result = await reassignAmbulance(incidentId, { ambulance_id: ambulanceId, reason: "Operator override" });
      operatorLog(incidentId, "Operator changed the ambulance: " + result.previous_ambulance_id + " released, " + ambulanceId + " assigned.", "warn");
    } else {
      result = await dispatchAmbulance(incidentId, ambulanceId);
      operatorLog(incidentId, "Operator manually assigned " + ambulanceId + ".", "warn");
    }
    check.warnings.forEach(function (w) { operatorLog(incidentId, "Warning: " + w, "warn"); });
    updateAutomationState(incidentId, function (s) { s.decision_mode = "MANUAL"; });
    refreshSummary(incidentId);
    return result;
  }

  async function operatorAssignHospital(incidentId, hospitalId) {
    if (!Rules.isValidId(incidentId) || !Rules.isValidId(hospitalId)) throw new ApiError("Invalid incident or hospital ID.", "INVALID_ID", 400);
    ensureOverride(incidentId);
    const incident = await getIncident(incidentId);
    const hospitals = await getHospitals(incidentId);
    const check = Rules.validateHospitalChoice(incident, hospitalId, hospitals, { operator: true });
    if (!check.ok) failValidation(check);

    const hospital = hospitals.find(function (h) { return h.hospital_id === hospitalId; });
    const result = await assignHospital(incidentId, {
      hospital_id: hospitalId, ambulance_id: incident.ambulance_id,
      eta_minutes: typeof hospital.eta_minutes === "number" ? hospital.eta_minutes : null
    });
    operatorLog(incidentId, "Operator " + (incident.hospital_id ? "changed the hospital to " : "assigned hospital ") + hospital.name + ".", "warn");
    check.warnings.forEach(function (w) { operatorLog(incidentId, "Warning: " + w, "warn"); });
    markStep(incidentId, "hospital_selected");
    refreshSummary(incidentId);
    return result;
  }

  async function operatorAdvanceStatus(incidentId, nextStatus) {
    ensureOverride(incidentId);
    const result = await updateIncidentStatus(incidentId, nextStatus);    // the backend rejects invalid transitions
    operatorLog(incidentId, "Operator changed status to " + nextStatus + ".", "warn");
    refreshSummary(incidentId);
    return result;
  }

  async function operatorRetryNotification(incidentId) {
    operatorLog(incidentId, "Operator pressed RETRY NOTIFICATION.", "info");
    const result = await runNotification(incidentId, { operator: true });
    refreshSummary(incidentId);
    emitUpdate(incidentId);
    return result;
  }

  root.Automation = {
    tick: tick,
    processIncident: processIncident,
    monitorIncident: monitorIncident,
    checkHealth: checkHealth,
    refreshSummary: refreshSummary,
    isEligibleForAuto: isEligibleForAuto,
    takeManualControl: takeManualControl,
    resumeAuto: resumeAuto,
    runAutoDispatchNow: runAutoDispatchNow,
    operatorAssignAmbulance: operatorAssignAmbulance,
    operatorAssignHospital: operatorAssignHospital,
    operatorAdvanceStatus: operatorAdvanceStatus,
    operatorRetryNotification: operatorRetryNotification,
    getHealth: function () { return health; }
  };
})(typeof window !== "undefined" ? window : globalThis);
