/* ============================================================================
   validate.js  -  Input sanitising for every request the service accepts.
   Nothing from the browser is trusted: IDs, numbers and text are checked
   before they reach the scoring engine or (as plain JSON data) the LLM.
   ============================================================================ */
"use strict";

class ValidationError extends Error {
  constructor(message, code) { super(message); this.name = "ValidationError"; this.code = code || "INVALID_REQUEST"; this.httpStatus = 400; }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"];
const TYPES = ["TRAUMA", "CARDIAC", "GENERAL", "MEDICAL"];
const AMB_STATUSES = ["AVAILABLE", "ASSIGNED", "EN_ROUTE", "ARRIVED", "PATIENT_PICKED_UP", "TO_HOSPITAL", "HOSPITAL_ARRIVED"];
const CAPABILITIES = ["ADVANCED", "BASIC"];
const HOSP_CAPS = ["TRAUMA", "CARDIAC", "SURGERY", "GENERAL", "ORTHO"];
const MAX_ITEMS = 50;

function id(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new ValidationError("Invalid " + label + ".", "INVALID_ID");
  return value;
}

function num(value, label, lo, hi) {
  if (typeof value !== "number" || !isFinite(value) || value < lo || value > hi) {
    throw new ValidationError("Invalid " + label + " (expected a number between " + lo + " and " + hi + ").", "INVALID_NUMBER");
  }
  return value;
}

// Plain text only: strips control characters and angle brackets, caps the length.
function text(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u001f\u007f<>`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 80);
}

function oneOf(value, allowed, fallback) {
  return allowed.indexOf(value) !== -1 ? value : fallback;
}

function tokenList(list, allowed, max) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max || 12).filter(function (x) { return typeof x === "string" && /^[A-Z_]{1,24}$/.test(x) && (!allowed || allowed.indexOf(x) !== -1); });
}

function incident(raw) {
  if (!raw || typeof raw !== "object") throw new ValidationError("Missing incident.", "MISSING_DATA");
  return {
    incident_id: id(raw.incident_id, "incident_id"),
    severity: oneOf(raw.severity, SEVERITIES, null) || (function () { throw new ValidationError("Invalid severity.", "INVALID_SEVERITY"); })(),
    incident_type: oneOf(raw.incident_type, TYPES, "GENERAL"),
    latitude: num(raw.latitude, "incident latitude", -90, 90),
    longitude: num(raw.longitude, "incident longitude", -180, 180),
    location: text(raw.location, 80)
  };
}

function list(raw, label) {
  if (!Array.isArray(raw)) throw new ValidationError("Missing " + label + " list.", "MISSING_DATA");
  if (raw.length > MAX_ITEMS) throw new ValidationError("Too many " + label + " (max " + MAX_ITEMS + ").", "TOO_MANY_ITEMS");
  return raw;
}

function ambulanceRequest(body) {
  if (!body || typeof body !== "object") throw new ValidationError("Request body must be a JSON object.", "MISSING_DATA");
  const inc = incident(body.incident);
  const ambulances = list(body.ambulances, "ambulances").map(function (a) {
    if (!a || typeof a !== "object") throw new ValidationError("Malformed ambulance entry.", "INVALID_REQUEST");
    const out = {
      ambulance_id: id(a.ambulance_id, "ambulance_id"),
      status: oneOf(a.status, AMB_STATUSES, "UNKNOWN"),
      incident_id: a.incident_id ? id(a.incident_id, "ambulance incident_id") : null,
      capability: oneOf(a.capability, CAPABILITIES, "UNKNOWN"),
      equipment: tokenList(a.equipment, null, 12),
      missions_today: typeof a.missions_today === "number" && isFinite(a.missions_today) ? Math.max(0, Math.min(50, Math.floor(a.missions_today))) : 0
    };
    // Coordinates are optional here: a missing position excludes the unit instead of failing the request.
    if (typeof a.latitude === "number" && typeof a.longitude === "number" &&
        Math.abs(a.latitude) <= 90 && Math.abs(a.longitude) <= 180) {
      out.latitude = a.latitude; out.longitude = a.longitude;
    }
    return out;
  });
  return { incident: inc, ambulances: ambulances };
}

function hospitalRequest(body) {
  if (!body || typeof body !== "object") throw new ValidationError("Request body must be a JSON object.", "MISSING_DATA");
  const inc = incident(body.incident);
  const hospitals = list(body.hospitals, "hospitals").map(function (h) {
    if (!h || typeof h !== "object") throw new ValidationError("Malformed hospital entry.", "INVALID_REQUEST");
    const out = {
      hospital_id: id(h.hospital_id, "hospital_id"),
      name: text(h.name, 60),
      emergency_department: text(h.emergency_department, 20).toUpperCase() || "UNKNOWN",
      capabilities: tokenList(h.capabilities, HOSP_CAPS, 8)
    };
    if (typeof h.beds_available === "number" && isFinite(h.beds_available)) out.beds_available = Math.max(0, Math.min(1000, Math.floor(h.beds_available)));
    if (typeof h.latitude === "number" && typeof h.longitude === "number" &&
        Math.abs(h.latitude) <= 90 && Math.abs(h.longitude) <= 180) {
      out.latitude = h.latitude; out.longitude = h.longitude;
    }
    return out;
  });
  return { incident: inc, hospitals: hospitals };
}

// The summary only ever receives a small set of NON-medical facts.
function summaryRequest(body) {
  if (!body || typeof body !== "object" || !body.facts || typeof body.facts !== "object") {
    throw new ValidationError("Missing summary facts.", "MISSING_DATA");
  }
  const f = body.facts;
  return {
    facts: {
      incident_id: id(f.incident_id, "incident_id"),
      severity: oneOf(f.severity, SEVERITIES, "UNKNOWN"),
      location: text(f.location, 80),
      identity_verified: f.identity_verified === true,
      status: text(f.status, 24).toUpperCase().replace(/[^A-Z_]/g, ""),
      ambulance_id: f.ambulance_id ? id(f.ambulance_id, "ambulance_id") : null,
      eta_minutes: typeof f.eta_minutes === "number" && isFinite(f.eta_minutes) ? Math.max(0, Math.min(999, Math.round(f.eta_minutes))) : null,
      hospital_name: text(f.hospital_name, 60) || null,
      notification: oneOf(f.notification, ["NOT_STARTED", "SENT_SIMULATED", "PARTIAL", "FAILED", "SKIPPED"], "NOT_STARTED"),
      auto_mode: oneOf(f.auto_mode, ["ON", "OVERRIDE", "OFF"], "ON"),
      decision_mode: oneOf(f.decision_mode, ["LLM", "SCORING_ENGINE", "FALLBACK", "RULES", "MANUAL"], "SCORING_ENGINE")
    }
  };
}

// The LLM must answer with {"choice": "<id>", "reason": "<short text>"}.
function llmChoice(parsed, eligibleIds) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ValidationError("LLM answer is not a JSON object.", "AI_MALFORMED");
  if (typeof parsed.choice !== "string" || eligibleIds.indexOf(parsed.choice) === -1) {
    throw new ValidationError("LLM chose an ID that is not an eligible candidate.", "AI_MALFORMED");
  }
  const reason = text(parsed.reason, 240);
  if (reason.length < 5) throw new ValidationError("LLM gave no usable reason.", "AI_MALFORMED");
  return { choice: parsed.choice, reason: reason };
}

function llmSummary(parsed) {
  if (!parsed || typeof parsed !== "object" || typeof parsed.summary !== "string") throw new ValidationError("LLM summary is malformed.", "AI_MALFORMED");
  const s = text(parsed.summary, 700);
  if (s.length < 20) throw new ValidationError("LLM summary is too short.", "AI_MALFORMED");
  return s;
}

module.exports = { ValidationError, ambulanceRequest, hospitalRequest, summaryRequest, llmChoice, llmSummary, text };
