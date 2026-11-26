/* ============================================================================
   rules.js  -  Deterministic SAFETY / BUSINESS RULES  (Member 3)

   This file is the "Deterministic Safety/Business Rules" box in:

        AI recommendation  ->  RULES (this file)  ->  backend validation  ->  action

   Everything here is a PURE function: no DOM, no network, no storage.
   It does three jobs:
     1. Validate what an AI/ranking service returns (shape, IDs, ranges).
     2. Validate any ambulance / hospital choice against fresh data
        (availability, conflicts, capability) BEFORE an action is attempted.
     3. Provide the safe FALLBACK ranking used when the AI service is down:
        "nearest suitable available unit".

   An AI answer can never trigger an action by itself: automation.js only acts
   on a choice that passes the validators below, and the backend (mock API now,
   Member 2's API later) validates it again.
   ============================================================================ */
(function (root) {
  "use strict";

  // Same assumptions as api.js (kept here so this file works on its own and in Node tests).
  const RESPONSE_SPEED_KMPH = 25;
  const TRANSPORT_SPEED_KMPH = 37;

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
  const AI_MODES = ["LLM", "SCORING_ENGINE"];

  // ---- Small helpers -------------------------------------------------------------
  function isValidId(value) { return typeof value === "string" && ID_RE.test(value); }

  function hasCoords(o) {
    return !!o && typeof o.latitude === "number" && typeof o.longitude === "number" &&
           isFinite(o.latitude) && isFinite(o.longitude) &&
           Math.abs(o.latitude) <= 90 && Math.abs(o.longitude) <= 180;
  }

  function geoKm(lat1, lon1, lat2, lon2) {
    const toRad = function (d) { return d * Math.PI / 180; };
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function etaFor(km, speed) {
    if (km <= 0.03) return 0;
    return Math.max(1, Math.round(km / speed * 60));
  }

  // Plain text only (the UI also escapes it): drop control characters, angle brackets, cap length.
  function cleanText(value, max) {
    if (value === undefined || value === null) return "";
    return String(value).replace(/[\u0000-\u001f\u007f<>`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 300);
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  // ---- What does this incident need? --------------------------------------------------
  function getNeeds(incident) {
    const type = (incident && incident.incident_type) || "GENERAL";
    return {
      incident_type: type,
      ambulance_level: incident && incident.severity === "HIGH" ? "ADVANCED" : "BASIC",
      hospital_capability: type === "TRAUMA" ? "TRAUMA" : (type === "CARDIAC" ? "CARDIAC" : null)
    };
  }

  function needsLabel(incident) {
    const n = getNeeds(incident);
    const parts = [n.ambulance_level === "ADVANCED" ? "advanced ambulance" : "any ambulance"];
    if (n.hospital_capability) parts.push(n.hospital_capability.toLowerCase() + " hospital");
    return parts.join(" + ");
  }

  // ---- Eligibility ------------------------------------------------------------------------
  function isAmbulanceEligible(a) {
    return !!a && isValidId(a.ambulance_id) && a.status === "AVAILABLE" && !a.incident_id && hasCoords(a);
  }

  function isHospitalEligible(h) {
    return !!h && isValidId(h.hospital_id) && h.emergency_department === "AVAILABLE" && hasCoords(h) &&
           !(typeof h.beds_available === "number" && h.beds_available <= 0);
  }

  function ambulanceMeetsNeed(needs, a) {
    return needs.ambulance_level === "ADVANCED" ? a.capability === "ADVANCED" : true;
  }

  function hospitalMeetsNeed(needs, h) {
    return needs.hospital_capability === null || (Array.isArray(h.capabilities) && h.capabilities.indexOf(needs.hospital_capability) !== -1);
  }

  function distanceToIncident(incident, unit) {
    if (typeof unit.distance_km === "number" && isFinite(unit.distance_km)) return unit.distance_km;
    return geoKm(unit.latitude, unit.longitude, incident.latitude, incident.longitude);
  }

  // ---- FALLBACK ranking ("AI unavailable" path) -------------------------------------------------
  // Nearest SUITABLE available ambulance. Suitable = meets the capability need, if any such unit exists.
  function fallbackRecommendAmbulance(incident, ambulances) {
    if (!incident || !hasCoords(incident)) {
      return { ok: false, code: "MISSING_COORDINATES", message: "The incident has no valid coordinates, so distances cannot be calculated." };
    }
    const needs = getNeeds(incident);
    const eligible = (ambulances || []).filter(isAmbulanceEligible);
    if (eligible.length === 0) {
      return { ok: false, code: "NO_AMBULANCE_AVAILABLE", message: "No ambulance is available right now." };
    }
    const suitable = eligible.filter(function (a) { return ambulanceMeetsNeed(needs, a); });
    const pool = suitable.length > 0 ? suitable : eligible;

    const ranked = pool.map(function (a) {
      const km = distanceToIncident(incident, a);
      return { unit: a, km: km };
    }).sort(function (x, y) { return x.km - y.km || String(x.unit.ambulance_id).localeCompare(String(y.unit.ambulance_id)); });

    const best = ranked[0];
    const warnings = [];
    if (suitable.length === 0 && needs.ambulance_level === "ADVANCED") {
      warnings.push("No advanced unit is available; nearest basic unit selected so the response is not delayed.");
    }
    return {
      ok: true,
      value: {
        recommended_ambulance: best.unit.ambulance_id,
        ambulance_score: null,                                   // the fallback does not compute a score (honest: no fake number)
        estimated_eta_minutes: typeof best.unit.eta_minutes === "number" ? best.unit.eta_minutes : etaFor(best.km, RESPONSE_SPEED_KMPH),
        distance_km: Math.round(best.km * 100) / 100,
        reason: "Nearest " + (suitable.length > 0 ? "suitable " : "") + "available ambulance (" + round1(best.km) + " km). Local safe rules; no AI used.",
        mode: "FALLBACK",
        notice: warnings.join(" ") || null
      }
    };
  }

  function fallbackRecommendHospital(incident, hospitals, ambulanceId) {
    if (!incident || !hasCoords(incident)) {
      return { ok: false, code: "MISSING_COORDINATES", message: "The incident has no valid coordinates, so distances cannot be calculated." };
    }
    if (!Array.isArray(hospitals) || hospitals.length === 0) {
      return { ok: false, code: "MISSING_HOSPITAL_DATA", message: "No hospital data is available." };
    }
    const needs = getNeeds(incident);
    const eligible = hospitals.filter(isHospitalEligible);
    if (eligible.length === 0) {
      return { ok: false, code: "NO_HOSPITAL_AVAILABLE", message: "No hospital is accepting emergency patients right now." };
    }
    const suitable = eligible.filter(function (h) { return hospitalMeetsNeed(needs, h); });
    const pool = suitable.length > 0 ? suitable : eligible;
    const ranked = pool.map(function (h) { return { unit: h, km: distanceToIncident(incident, h) }; })
      .sort(function (x, y) { return x.km - y.km || String(x.unit.hospital_id).localeCompare(String(y.unit.hospital_id)); });
    const best = ranked[0];
    const warnings = [];
    if (suitable.length === 0 && needs.hospital_capability) {
      warnings.push("No hospital with " + needs.hospital_capability.toLowerCase() + " capability is available; nearest open emergency department selected.");
    }
    return {
      ok: true,
      value: {
        recommended_hospital: best.unit.hospital_id,
        hospital_name: best.unit.name || best.unit.hospital_id,
        hospital_score: null,
        estimated_eta_minutes: typeof best.unit.eta_minutes === "number" ? best.unit.eta_minutes : etaFor(best.km, TRANSPORT_SPEED_KMPH),
        distance_km: Math.round(best.km * 100) / 100,
        hospital_reason: "Nearest " + (suitable.length > 0 ? "suitable " : "") + "hospital with an open emergency department (" + round1(best.km) + " km). Local safe rules; no AI used.",
        mode: "FALLBACK",
        notice: warnings.join(" ") || null
      }
    };
  }

  // ---- Validate the JSON that comes back from the AI service -------------------------------------
  // Returns { ok, errors[], value }. value is a cleaned copy; the raw object is never used directly.
  function validateAiAmbulanceResponse(raw) {
    const errors = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["Response is not a JSON object."] };
    if (!isValidId(raw.recommended_ambulance)) errors.push("recommended_ambulance is missing or not a valid ID.");
    if (typeof raw.ambulance_score !== "number" || !isFinite(raw.ambulance_score) || raw.ambulance_score < 0 || raw.ambulance_score > 100) errors.push("ambulance_score must be a number from 0 to 100.");
    if (raw.estimated_eta_minutes !== null && raw.estimated_eta_minutes !== undefined &&
        (typeof raw.estimated_eta_minutes !== "number" || !isFinite(raw.estimated_eta_minutes) || raw.estimated_eta_minutes < 0 || raw.estimated_eta_minutes > 600)) errors.push("estimated_eta_minutes is out of range.");
    if (typeof raw.reason !== "string" || cleanText(raw.reason).length < 3) errors.push("reason is missing.");
    if (AI_MODES.indexOf(raw.mode) === -1) errors.push("mode is not recognised.");
    if (errors.length) return { ok: false, errors: errors };
    return {
      ok: true, errors: [],
      value: {
        recommended_ambulance: raw.recommended_ambulance,
        ambulance_score: Math.round(raw.ambulance_score),
        estimated_eta_minutes: typeof raw.estimated_eta_minutes === "number" ? Math.round(raw.estimated_eta_minutes) : null,
        distance_km: typeof raw.distance_km === "number" && isFinite(raw.distance_km) ? raw.distance_km : null,
        reason: cleanText(raw.reason, 300),
        mode: raw.mode,
        notice: raw.notice ? cleanText(raw.notice, 300) : null
      }
    };
  }

  function validateAiHospitalResponse(raw) {
    const errors = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["Response is not a JSON object."] };
    if (!isValidId(raw.recommended_hospital)) errors.push("recommended_hospital is missing or not a valid ID.");
    if (typeof raw.hospital_score !== "number" || !isFinite(raw.hospital_score) || raw.hospital_score < 0 || raw.hospital_score > 100) errors.push("hospital_score must be a number from 0 to 100.");
    if (raw.estimated_eta_minutes !== null && raw.estimated_eta_minutes !== undefined &&
        (typeof raw.estimated_eta_minutes !== "number" || !isFinite(raw.estimated_eta_minutes) || raw.estimated_eta_minutes < 0 || raw.estimated_eta_minutes > 600)) errors.push("estimated_eta_minutes is out of range.");
    if (typeof raw.hospital_reason !== "string" || cleanText(raw.hospital_reason).length < 3) errors.push("hospital_reason is missing.");
    if (AI_MODES.indexOf(raw.mode) === -1) errors.push("mode is not recognised.");
    if (errors.length) return { ok: false, errors: errors };
    return {
      ok: true, errors: [],
      value: {
        recommended_hospital: raw.recommended_hospital,
        hospital_name: cleanText(raw.hospital_name, 80) || raw.recommended_hospital,
        hospital_score: Math.round(raw.hospital_score),
        estimated_eta_minutes: typeof raw.estimated_eta_minutes === "number" ? Math.round(raw.estimated_eta_minutes) : null,
        distance_km: typeof raw.distance_km === "number" && isFinite(raw.distance_km) ? raw.distance_km : null,
        hospital_reason: cleanText(raw.hospital_reason, 300),
        mode: raw.mode,
        notice: raw.notice ? cleanText(raw.notice, 300) : null
      }
    };
  }

  function validateAiSummaryResponse(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.summary !== "string") return { ok: false, errors: ["Summary is missing."] };
    const text = cleanText(raw.summary, 700);
    if (text.length < 20) return { ok: false, errors: ["Summary is too short."] };
    return { ok: true, errors: [], value: { summary: text } };
  }

  // ---- Validate a CHOICE against fresh data (runs before every automatic action) ---------------------
  // freshAmbulances = ambulances re-read from the API a moment ago (avoids acting on stale data).
  // options.operator = true: a HUMAN dispatcher chose. Hard rules (exists, available, no conflict) still apply,
  // but a capability mismatch becomes a warning instead of a rejection (the operator has the final say).
  function validateAmbulanceChoice(incident, ambulanceId, freshAmbulances, options) {
    options = options || {};
    const reasons = [];
    const warnings = [];
    if (!incident) return { ok: false, reasons: ["Incident does not exist."], warnings: warnings };
    if (!isValidId(incident.incident_id)) reasons.push("Incident ID is invalid.");
    if (!hasCoords(incident)) reasons.push("Incident coordinates are missing.");
    if (incident.status === "HOSPITAL_ARRIVED") reasons.push("Incident is already completed.");
    if (incident.ambulance_id) reasons.push("Incident already has ambulance " + incident.ambulance_id + ".");
    if (!isValidId(ambulanceId)) reasons.push("Ambulance ID is invalid.");

    const unit = (freshAmbulances || []).find(function (a) { return a.ambulance_id === ambulanceId; });
    if (isValidId(ambulanceId) && !unit) reasons.push("Ambulance " + ambulanceId + " does not exist.");
    if (unit) {
      if (unit.status !== "AVAILABLE") reasons.push(ambulanceId + " is not available (status " + unit.status + ").");
      if (unit.incident_id) reasons.push(ambulanceId + " is already assigned to " + unit.incident_id + ".");
      if (!hasCoords(unit)) reasons.push(ambulanceId + " has no valid position.");
      const needs = getNeeds(incident);
      if (!ambulanceMeetsNeed(needs, unit)) {
        const advancedFree = (freshAmbulances || []).some(function (a) { return isAmbulanceEligible(a) && a.capability === "ADVANCED"; });
        if (advancedFree && options.operator) warnings.push(ambulanceId + " is not an advanced unit although an advanced unit is available (operator decision).");
        else if (advancedFree) reasons.push(ambulanceId + " is not an advanced unit, but this incident needs one and an advanced unit is available.");
        else warnings.push("No advanced unit is available; a basic unit is being used so the response is not delayed.");
      }
    }
    return { ok: reasons.length === 0, reasons: reasons, warnings: warnings };
  }

  function validateHospitalChoice(incident, hospitalId, hospitals, options) {
    options = options || {};
    const reasons = [];
    const warnings = [];
    if (!incident) return { ok: false, reasons: ["Incident does not exist."], warnings: warnings };
    if (incident.status === "HOSPITAL_ARRIVED") reasons.push("Incident is already completed.");
    if (!incident.ambulance_id) reasons.push("An ambulance must be assigned before a hospital.");
    if (!isValidId(hospitalId)) reasons.push("Hospital ID is invalid.");

    const hospital = (hospitals || []).find(function (h) { return h.hospital_id === hospitalId; });
    if (isValidId(hospitalId) && !hospital) reasons.push("Hospital " + hospitalId + " does not exist.");
    if (hospital) {
      if (hospital.emergency_department !== "AVAILABLE") reasons.push(hospital.name + " emergency department is not available.");
      if (typeof hospital.beds_available === "number" && hospital.beds_available <= 0) reasons.push(hospital.name + " has no beds.");
      if (!hasCoords(hospital)) reasons.push(hospital.name + " has no valid position.");
      const needs = getNeeds(incident);
      if (!hospitalMeetsNeed(needs, hospital)) {
        const capableOpen = (hospitals || []).some(function (h) { return isHospitalEligible(h) && hospitalMeetsNeed(needs, h); });
        if (capableOpen && options.operator) warnings.push(hospital.name + " lacks " + needs.hospital_capability.toLowerCase() + " capability although a capable hospital is available (operator decision).");
        else if (capableOpen) reasons.push(hospital.name + " lacks " + needs.hospital_capability.toLowerCase() + " capability, but a capable hospital is available.");
        else warnings.push("No hospital with " + needs.hospital_capability.toLowerCase() + " capability is open; using the best available.");
      }
    }
    return { ok: reasons.length === 0, reasons: reasons, warnings: warnings };
  }

  // ---- Family notification text ---------------------------------------------------------------------
  // Deliberately contains NO medical data: no blood group, allergies, conditions or biometric information.
  function buildFamilyMessage(incident, ambulanceId) {
    if (!incident) return "";
    const where = cleanText(incident.location, 80).replace(/^near\s+/i, "") || "a location being confirmed";
    const who = (incident.identity_verified && incident.patient_name) ? cleanText(incident.patient_name, 60) : "a person";
    const amb = ambulanceId ? "Ambulance has been dispatched." : "An ambulance will be dispatched shortly.";
    return "EMERGENCY ALERT: An emergency response has been initiated for " + who + " near " + where + ". " +
           amb + " Incident ID: " + incident.incident_id + ".";
  }

  // ---- Honest labels for how a decision was made ------------------------------------------------------
  const MODE_LABELS = {
    LLM:            { short: "AI MODE",       long: "AI MODE: an LLM chose among validated candidates", css: "ai" },
    SCORING_ENGINE: { short: "ENGINE MODE",   long: "ENGINE MODE: server-side weighted scoring (no LLM)", css: "engine" },
    FALLBACK:       { short: "FALLBACK MODE", long: "FALLBACK MODE: AI unavailable, local safe rules used", css: "fallback" },
    RULES:          { short: "RULES MODE",    long: "RULES MODE: AI disabled, local rules used", css: "fallback" },
    MANUAL:         { short: "MANUAL",        long: "MANUAL: chosen by the operator", css: "manual" }
  };
  function modeInfo(mode) { return MODE_LABELS[mode] || { short: "UNKNOWN", long: "Unknown decision mode", css: "manual" }; }

  // ---- Template summary (used when no LLM summary is available) ------------------------------------------
  // ctx: { incident, ambulanceId, etaMinutes, hospitalName, notification, autoMode, decisionMode }
  function buildTemplateSummary(ctx) {
    const inc = ctx.incident;
    if (!inc) return "";
    const lines = [];
    const sev = inc.severity ? inc.severity.charAt(0) + inc.severity.slice(1).toLowerCase() : "Unknown-severity";
    lines.push(sev + "-priority emergency" + (inc.location ? " near " + cleanText(inc.location, 80).replace(/^near\s+/i, "") : "") + ".");
    lines.push(inc.identity_verified ? "Identity verification completed (AI-assisted match, not absolute proof)." : "Identity not verified yet.");
    if (ctx.ambulanceId) {
      lines.push(ctx.ambulanceId + (ctx.autoMode === "ON" && ctx.decisionMode !== "MANUAL" ? " automatically" : "") + " assigned. Current status: " + String(inc.status).replace(/_/g, " ") + ".");
      if (typeof ctx.etaMinutes === "number") {
        lines.push(ctx.etaMinutes === 0 ? "Ambulance has reached its current destination (simulated GPS)." : "Estimated arrival: " + ctx.etaMinutes + " minutes (distance / assumed speed, simulated GPS).");
      }
    } else {
      lines.push("No ambulance assigned yet.");
    }
    if (ctx.hospitalName) lines.push("Recommended destination: " + ctx.hospitalName + ".");
    if (ctx.notification === "SENT_SIMULATED") lines.push("Family notification initiated (simulated).");
    else if (ctx.notification === "PARTIAL") lines.push("Family notification partly failed; operator may retry.");
    else if (ctx.notification === "FAILED") lines.push("Family notification failed; operator should retry.");
    else if (ctx.notification === "SKIPPED") lines.push("No authorized contacts to notify.");
    if (ctx.autoMode === "OVERRIDE") lines.push("Automation is paused: operator has manual control.");
    return lines.join(" ");
  }

  const api = {
    RESPONSE_SPEED_KMPH, TRANSPORT_SPEED_KMPH,
    isValidId, hasCoords, cleanText,
    getNeeds, needsLabel,
    isAmbulanceEligible, isHospitalEligible,
    fallbackRecommendAmbulance, fallbackRecommendHospital,
    validateAiAmbulanceResponse, validateAiHospitalResponse, validateAiSummaryResponse,
    validateAmbulanceChoice, validateHospitalChoice,
    buildFamilyMessage, buildTemplateSummary,
    modeInfo
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Rules = api;
})(typeof window !== "undefined" ? window : globalThis);
