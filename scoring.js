/* ============================================================================
   scoring.js  -  Deterministic ranking engine (NO LLM, NO network)

   This is the transparent, explainable part of the "AI EMS Decision Engine".
   It is a weighted multi-criteria score, not a trained machine-learning model.
   Every number it produces can be recomputed by hand (see README).

   The optional LLM layer (llm.js) can only CHOOSE between candidates that this
   file has already declared eligible, and only after safety rules accept them.
   ============================================================================ */
"use strict";

const RESPONSE_SPEED_KMPH = 25;    // ambulance -> scene   (same assumption as the frontend)
const TRANSPORT_SPEED_KMPH = 37;   // scene -> hospital    (same assumption as the frontend)

// Ambulance score weights (sum = 1)
const AMB_WEIGHTS = { eta: 0.45, capability: 0.30, equipment: 0.15, workload: 0.10 };
// Hospital score weights (sum = 1)
const HOSP_WEIGHTS = { eta: 0.35, capability: 0.45, beds: 0.20 };

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = function (d) { return d * Math.PI / 180; };
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ETA = distance / assumed speed. No live traffic data exists in this prototype.
function etaMinutes(distanceKm, speedKmph) {
  if (distanceKm <= 0.03) return 0;
  return Math.max(1, Math.round(distanceKm / speedKmph * 60));
}

// What does this incident need? (severity + incident type -> requirements)
function deriveNeeds(incident) {
  const type = incident.incident_type || "GENERAL";
  const equipment = [];
  if (type === "TRAUMA") equipment.push("SPINAL_BOARD");
  if (type === "CARDIAC") equipment.push("DEFIBRILLATOR");
  if (incident.severity === "HIGH") equipment.push("OXYGEN");
  return {
    incident_type: type,
    ambulance_level: incident.severity === "HIGH" ? "ADVANCED" : "BASIC",
    hospital_capability: type === "TRAUMA" ? "TRAUMA" : (type === "CARDIAC" ? "CARDIAC" : null),
    equipment: equipment
  };
}

function hasCoords(o) {
  return o && typeof o.latitude === "number" && typeof o.longitude === "number" &&
         isFinite(o.latitude) && isFinite(o.longitude);
}

// ---- Ambulances ---------------------------------------------------------------
function rankAmbulances(incident, ambulances) {
  const needs = deriveNeeds(incident);
  const excluded = [];
  const ranking = [];

  ambulances.forEach(function (a) {
    if (a.status !== "AVAILABLE") { excluded.push({ id: a.ambulance_id, reason: "Status is " + a.status + ", not AVAILABLE" }); return; }
    if (a.incident_id) { excluded.push({ id: a.ambulance_id, reason: "Already linked to " + a.incident_id }); return; }
    if (!hasCoords(a)) { excluded.push({ id: a.ambulance_id, reason: "Missing coordinates" }); return; }

    const km = haversineKm(a.latitude, a.longitude, incident.latitude, incident.longitude);
    const eta = etaMinutes(km, RESPONSE_SPEED_KMPH);
    const meetsCapability = needs.ambulance_level === "ADVANCED" ? a.capability === "ADVANCED" : true;

    const etaScore = clamp(100 - 5 * eta, 0, 100);
    let capScore;
    if (needs.ambulance_level === "ADVANCED") capScore = a.capability === "ADVANCED" ? 100 : 20;
    else capScore = a.capability === "BASIC" ? 100 : 90;     // keep advanced units free for critical cases
    const have = a.equipment || [];
    const equipScore = needs.equipment.length === 0 ? 100
      : 100 * needs.equipment.filter(function (e) { return have.indexOf(e) !== -1; }).length / needs.equipment.length;
    const workScore = clamp(100 - 15 * (a.missions_today || 0), 0, 100);

    const score = AMB_WEIGHTS.eta * etaScore + AMB_WEIGHTS.capability * capScore +
                  AMB_WEIGHTS.equipment * equipScore + AMB_WEIGHTS.workload * workScore;

    const parts = [];
    parts.push((a.capability === "ADVANCED" ? "Advanced" : "Basic") + " life-support unit");
    parts.push(round1(km) + " km / " + eta + " min away");
    if (needs.ambulance_level === "ADVANCED") parts.push(meetsCapability ? "meets the advanced-care requirement" : "does NOT meet the advanced-care requirement");
    if (needs.equipment.length) parts.push(equipScore === 100 ? "has the required equipment" : "missing some required equipment");

    ranking.push({
      ambulance_id: a.ambulance_id,
      score: Math.round(score),
      distance_km: round2(km),
      eta_minutes: eta,
      capability: a.capability || "UNKNOWN",
      meets_capability: meetsCapability,
      components: { eta: Math.round(etaScore), capability: Math.round(capScore), equipment: Math.round(equipScore), workload: Math.round(workScore) },
      reason: parts.join("; ") + "."
    });
  });

  ranking.sort(function (a, b) { return b.score - a.score || a.distance_km - b.distance_km; });
  return { needs: needs, ranking: ranking, excluded: excluded };
}

// Safety rule applied to ANY choice (engine or LLM):
// if the incident needs an advanced unit and one is available, a basic unit is not acceptable.
function isAmbulanceChoiceAcceptable(needs, ranking, id) {
  const chosen = ranking.find(function (r) { return r.ambulance_id === id; });
  if (!chosen) return { ok: false, reason: "Ambulance " + id + " is not in the eligible list." };
  if (needs.ambulance_level === "ADVANCED" && !chosen.meets_capability &&
      ranking.some(function (r) { return r.meets_capability; })) {
    return { ok: false, reason: id + " is not an advanced unit but an advanced unit is available." };
  }
  return { ok: true };
}

// ---- Hospitals ---------------------------------------------------------------
function rankHospitals(incident, hospitals) {
  const needs = deriveNeeds(incident);
  const excluded = [];
  const ranking = [];

  hospitals.forEach(function (h) {
    if (h.emergency_department !== "AVAILABLE") { excluded.push({ id: h.hospital_id, reason: "Emergency department is " + (h.emergency_department || "UNKNOWN") }); return; }
    if (typeof h.beds_available === "number" && h.beds_available <= 0) { excluded.push({ id: h.hospital_id, reason: "No beds available" }); return; }
    if (!hasCoords(h)) { excluded.push({ id: h.hospital_id, reason: "Missing coordinates" }); return; }

    const km = haversineKm(incident.latitude, incident.longitude, h.latitude, h.longitude);
    const eta = etaMinutes(km, TRANSPORT_SPEED_KMPH);
    const caps = h.capabilities || [];
    const meets = needs.hospital_capability === null ? true : caps.indexOf(needs.hospital_capability) !== -1;

    const etaScore = clamp(100 - 4 * eta, 0, 100);
    const capScore = meets ? 100 : 0;
    const bedScore = typeof h.beds_available === "number" ? clamp(h.beds_available, 0, 10) * 10 : 50;
    const score = HOSP_WEIGHTS.eta * etaScore + HOSP_WEIGHTS.capability * capScore + HOSP_WEIGHTS.beds * bedScore;

    const parts = [];
    parts.push("Emergency department available");
    parts.push(round1(km) + " km / " + eta + " min from the scene");
    if (needs.hospital_capability) parts.push(meets ? needs.hospital_capability.toLowerCase() + " capability present" : "NO " + needs.hospital_capability.toLowerCase() + " capability");
    if (typeof h.beds_available === "number") parts.push(h.beds_available + " beds");

    ranking.push({
      hospital_id: h.hospital_id,
      name: h.name || h.hospital_id,
      score: Math.round(score),
      distance_km: round2(km),
      eta_minutes: eta,
      meets_capability: meets,
      components: { eta: Math.round(etaScore), capability: Math.round(capScore), beds: Math.round(bedScore) },
      reason: parts.join("; ") + "."
    });
  });

  ranking.sort(function (a, b) { return b.score - a.score || a.distance_km - b.distance_km; });
  return { needs: needs, ranking: ranking, excluded: excluded };
}

function isHospitalChoiceAcceptable(needs, ranking, id) {
  const chosen = ranking.find(function (r) { return r.hospital_id === id; });
  if (!chosen) return { ok: false, reason: "Hospital " + id + " is not in the eligible list." };
  if (needs.hospital_capability && !chosen.meets_capability && ranking.some(function (r) { return r.meets_capability; })) {
    return { ok: false, reason: id + " lacks " + needs.hospital_capability + " capability but a capable hospital is available." };
  }
  return { ok: true };
}

module.exports = {
  RESPONSE_SPEED_KMPH, TRANSPORT_SPEED_KMPH, AMB_WEIGHTS, HOSP_WEIGHTS,
  haversineKm, etaMinutes, deriveNeeds,
  rankAmbulances, rankHospitals,
  isAmbulanceChoiceAcceptable, isHospitalChoiceAcceptable
};
