/* ============================================================================
   api.js  -  Member 3 : EMS Response Module
   (EMS response, ambulance dispatch, family notification, live tracking,
    hospital assignment)

   ALL communication with data goes through THIS file.
   The other scripts (dashboard.js, incident.js, ...) only call the functions
   listed in section 4 and never use fetch() themselves.

   FILE LAYOUT
     1. CONFIGURATION            <-- the only lines you edit to switch APIs
     2. SHARED CONSTANTS         (status flows, timeline steps)
     3. MOCK API  (demo data)    <-- used when USE_MOCK_API = true
        REAL API  (fetch)        <-- used when USE_MOCK_API = false
     4. PUBLIC API FUNCTIONS     (what the pages call)
     5. SHARED UI HELPERS        (badges, toasts, navigation, error messages)

   NEW (automation upgrade): this file also holds
     - the AI service calls (aiRecommendAmbulance / aiRecommendHospital /
       aiIncidentSummary / getAiHealth) -> they talk to the Node AI service,
       never directly to an LLM, so no secret key is ever in the browser
     - reassignAmbulance() for operator overrides
     - the automation state store (activity log, AUTO MODE per incident)
   The decision LOGIC lives in rules.js (safety rules) and automation.js
   (orchestration). Pages still only call functions from this file.

   All data is FICTIONAL. Tracking and notifications are SIMULATED.
   ============================================================================ */


/* ============================================================================
   1. CONFIGURATION
   ----------------------------------------------------------------------------
   To connect to Member 2's backend:
     - set USE_MOCK_API to false
     - make sure API_BASE_URL points to Member 2's server
   Nothing else needs to change.
   ============================================================================ */
const USE_MOCK_API = true;                          // true = demo data, false = real backend
const API_BASE_URL = "http://localhost:8000/api";   // Member 2's backend (used only when USE_MOCK_API = false)

/* ---- Automation switches ---------------------------------------------------------
   AI_ENABLED = true,  AUTO_DISPATCH_ENABLED = true   -> AI MODE   (AI service first, safe fallback if it is down)
   AI_ENABLED = false, AUTO_DISPATCH_ENABLED = true   -> DEMO MODE (automatic dispatch with local rules only, no AI)
   AUTO_DISPATCH_ENABLED = false                      -> MANUAL MODE (operator clicks everything, like before)
*/
const AI_ENABLED = true;
const AUTO_DISPATCH_ENABLED = true;

// The AI service is a small Node server (see ai-service/). It holds the optional LLM key. NEVER put a key in this file.
const AI_SERVICE_URL = "http://localhost:8787";
const AI_REQUEST_TIMEOUT_MS = 6000;

const AUTOMATION_CONFIG = {
  autoDispatchSeverities: ["HIGH"],   // which severities are dispatched automatically (others wait for the operator)
  requireIdentityVerified: true,      // wait for Member 2's verification before automating
  tickMs: 3000,                       // how often the dashboard checks for new verified incidents
  stepDelayMs: 700,                   // pause between automatic steps so the demo is readable (set 0 for instant)
  autoArrivalGeofence: true,          // mark ARRIVED / HOSPITAL_ARRIVED when the (simulated) GPS reaches the destination
  notifyChannel: "SMS"                // channel used for the automatic family notification (simulated)
};


/* ============================================================================
   2. SHARED CONSTANTS
   ============================================================================ */

// Ambulance status flow (exact order, no skipping allowed)
const AMBULANCE_STATUS_FLOW = [
  "AVAILABLE",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "PATIENT_PICKED_UP",
  "TO_HOSPITAL",
  "HOSPITAL_ARRIVED"
];

// The incident has the same flow, plus two steps at the start.
// (Identity verification comes from Member 2 and happens before dispatch.)
const INCIDENT_STATUS_FLOW = ["EMERGENCY_CREATED", "IDENTITY_VERIFIED"]
  .concat(AMBULANCE_STATUS_FLOW.slice(1));

// Steps shown in the emergency timeline on incident.html
const TIMELINE_STEPS = [
  { status: "EMERGENCY_CREATED",  label: "Emergency Created" },
  { status: "IDENTITY_VERIFIED",  label: "Identity Verified" },
  { status: "ASSIGNED",           label: "Ambulance Assigned" },
  { status: "EN_ROUTE",           label: "En Route" },
  { status: "ARRIVED",            label: "Arrived" },
  { status: "PATIENT_PICKED_UP",  label: "Patient Picked Up" },
  { status: "TO_HOSPITAL",        label: "To Hospital" },
  { status: "HOSPITAL_ARRIVED",   label: "Hospital Arrived" }
];

// Which button to show for each current status
const STATUS_ACTIONS = {
  ASSIGNED:          { next: "EN_ROUTE",          label: "START JOURNEY" },
  EN_ROUTE:          { next: "ARRIVED",           label: "MARK ARRIVED" },
  ARRIVED:           { next: "PATIENT_PICKED_UP", label: "PATIENT PICKED UP" },
  PATIENT_PICKED_UP: { next: "TO_HOSPITAL",       label: "START TO HOSPITAL" },
  TO_HOSPITAL:       { next: "HOSPITAL_ARRIVED",  label: "MARK HOSPITAL ARRIVED" }
};

// Our own error type, so every page can show a friendly message
class ApiError extends Error {
  constructor(message, code, httpStatus) {
    super(message);
    this.name = "ApiError";
    this.code = code || "API_ERROR";
    this.httpStatus = httpStatus || 400;
  }
}

// Small geography helpers (used by the mock API)
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = function (d) { return d * Math.PI / 180; };
  const R = 6371; // earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function estimateEtaMinutes(distanceKm, speedKmph) {
  if (distanceKm === null || distanceKm === undefined || isNaN(distanceKm)) return null;
  if (distanceKm <= 0.03) return 0;                       // basically there
  return Math.max(1, Math.round(distanceKm / speedKmph * 60));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function requireParam(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new ApiError("Missing required information: " + label + ".", "MISSING_DATA", 400);
  }
}


/* ============================================================================
   3A. MOCK API  (DEMO DATA)           -- used only when USE_MOCK_API = true
   ----------------------------------------------------------------------------
   Pretends to be Member 2's backend. The "database" is saved in the browser's
   localStorage, so a change made on one page (e.g. assigning an ambulance)
   is visible on every other page. Use "Reset demo data" on the dashboard to
   start again.
   ============================================================================ */
const MOCK_DB_KEY = "member3_mock_db_v2";     // v2: ambulance/hospital capability fields (old v1 data is ignored)
const MOCK_LATENCY_MS = 250;           // fake network delay so loading states are visible
const RESPONSE_SPEED_KMPH = 25;        // ambulance speed to the scene (used for ETA)
const TRANSPORT_SPEED_KMPH = 37;       // ambulance speed to hospital (used for ETA)
const DEMO_SPEED_MULTIPLIER = 10;      // simulation runs 10x faster than real time

let mockMemoryDB = null;               // fallback if localStorage is blocked

function mockDelay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms === undefined ? MOCK_LATENCY_MS : ms); });
}

// ---- Demo data (ALL FICTIONAL) ---------------------------------------------
function mockBuildSeed() {
  const now = Date.now();
  const minutesAgo = function (m) { return new Date(now - m * 60000).toISOString(); };

  return {
    incidents: [
      {
        incident_id: "INC-2026-0001",
        patient_name: "Demo Patient",
        location: "Near City Mall",
        latitude: 28.6139,
        longitude: 77.2090,
        severity: "HIGH",
        incident_type: "TRAUMA",       // used by the AI/ranking engine (trauma -> needs a trauma hospital)
        status: "IDENTITY_VERIFIED",
        identity_verified: true,
        identity_confidence: 0.94,
        blood_group: "O+",
        allergy: "Penicillin",
        emergency_time: minutesAgo(6),
        ambulance_id: null,
        hospital_id: null,
        eta_minutes: null,
        hospital_assigned_at: null,
        status_history: [
          { status: "EMERGENCY_CREATED", at: minutesAgo(6) },
          { status: "IDENTITY_VERIFIED", at: minutesAgo(5) }
        ]
      },
      {
        incident_id: "INC-2026-0002",
        patient_name: "Unidentified Person",
        location: "Central Bus Stand, Gate 2",
        latitude: 28.6448,
        longitude: 77.2167,
        severity: "MEDIUM",
        incident_type: "GENERAL",
        status: "EMERGENCY_CREATED",
        identity_verified: false,
        identity_confidence: null,
        blood_group: null,          // unknown on purpose: tests "missing data" display
        allergy: null,
        emergency_time: minutesAgo(3),
        ambulance_id: null,
        hospital_id: null,
        eta_minutes: null,
        hospital_assigned_at: null,
        status_history: [
          { status: "EMERGENCY_CREATED", at: minutesAgo(3) }
        ]
      },
      {
        incident_id: "INC-2026-0003",
        patient_name: "Demo Patient Two",
        location: "Lakeview Apartments, Block C",
        latitude: 28.5930,
        longitude: 77.2285,
        severity: "LOW",
        incident_type: "GENERAL",
        status: "IDENTITY_VERIFIED",
        identity_verified: true,
        identity_confidence: 0.88,
        blood_group: "B+",
        allergy: "None known",
        emergency_time: minutesAgo(12),
        ambulance_id: null,
        hospital_id: null,
        eta_minutes: null,
        hospital_assigned_at: null,
        status_history: [
          { status: "EMERGENCY_CREATED", at: minutesAgo(12) },
          { status: "IDENTITY_VERIFIED", at: minutesAgo(11) }
        ]
      }
    ],

    // Positions are chosen so that, for INC-2026-0001:
    //   AMB-001 is 2.1 km away (ETA 5 min), ADVANCED  -> the right unit for a HIGH incident
    //   AMB-002 is 1.5 km away (ETA 4 min), BASIC     -> closer, but NOT the right unit
    // This proves the system does not simply pick the nearest ambulance.
    ambulances: [
      {
        ambulance_id: "AMB-001",
        vehicle_number: "UP-XX-1234",
        status: "AVAILABLE",
        incident_id: null,
        capability: "ADVANCED",
        equipment: ["DEFIBRILLATOR", "VENTILATOR", "OXYGEN", "SPINAL_BOARD"],
        missions_today: 2,
        latitude: 28.6005,
        longitude: 77.1938,
        position_updated_at: now
      },
      {
        ambulance_id: "AMB-002",
        vehicle_number: "UP-XX-5678",
        status: "AVAILABLE",
        incident_id: null,
        capability: "BASIC",
        equipment: ["OXYGEN"],
        missions_today: 1,
        latitude: 28.6039,
        longitude: 77.2190,
        position_updated_at: now
      }
    ],

    // For INC-2026-0001 (a TRAUMA case):
    //   HOSP-001 is ~5.2 km away and HAS trauma capability  -> the right destination
    //   HOSP-002 is ~2.5 km away but has NO trauma capability -> closer, but NOT the right destination
    //   HOSP-003 is diverting patients (unavailable)
    hospitals: [
      {
        hospital_id: "HOSP-001",
        name: "City Emergency Hospital",
        emergency_department: "AVAILABLE",
        latitude: 28.6440,
        longitude: 77.2498,
        beds_available: 6,
        capabilities: ["TRAUMA", "CARDIAC", "SURGERY"],
        specialties: ["Trauma", "Cardiology", "General Surgery"]
      },
      {
        hospital_id: "HOSP-002",
        name: "Central Hospital",
        emergency_department: "AVAILABLE",
        latitude: 28.6320,
        longitude: 77.2250,
        beds_available: 3,
        capabilities: ["GENERAL", "ORTHO"],
        specialties: ["General Medicine", "Orthopaedics"]
      },
      {
        hospital_id: "HOSP-003",
        name: "Riverside Medical Centre",
        emergency_department: "UNAVAILABLE",   // diverting patients: tests "hospital unavailable"
        latitude: 28.5998,
        longitude: 77.2998,
        beds_available: 0,
        capabilities: ["GENERAL"],
        specialties: ["General Medicine"]
      }
    ],

    // Fictional contacts. Phone numbers are masked placeholders, not real numbers.
    contacts: {
      "INC-2026-0001": [
        { contact_id: "CON-001", name: "Demo Mother", relationship: "Mother", phone_masked: "XXXXXX0001", authorized: true },
        { contact_id: "CON-002", name: "Demo Brother", relationship: "Brother", phone_masked: "XXXXXX0002", authorized: true },
        { contact_id: "CON-003", name: "Demo Neighbour", relationship: "Neighbour", phone_masked: "XXXXXX0003", authorized: false }
      ],
      "INC-2026-0002": [],   // identity not verified yet, so no contacts are known
      "INC-2026-0003": [
        { contact_id: "CON-004", name: "Demo Father", relationship: "Father", phone_masked: "XXXXXX0004", authorized: true }
      ]
    },

    notifications: []
  };
}

// ---- Mock "database" storage ------------------------------------------------
function mockLoadDB() {
  let raw = null;
  try {
    raw = localStorage.getItem(MOCK_DB_KEY);
  } catch (e) {
    raw = mockMemoryDB;                 // localStorage blocked: use in-memory copy
  }
  if (raw) {
    try { return JSON.parse(raw); }
    catch (e) { console.warn("Mock data was corrupted, so it was reset."); }
  }
  const db = mockBuildSeed();
  mockSaveDB(db);
  return db;
}

function mockSaveDB(db) {
  const raw = JSON.stringify(db);
  mockMemoryDB = raw;
  try {
    localStorage.setItem(MOCK_DB_KEY, raw);
  } catch (e) {
    console.warn("Could not save mock data to localStorage; data will not be shared between pages.", e);
  }
}

function mockFindIncident(db, incidentId) {
  requireParam(incidentId, "incident ID");
  const incident = db.incidents.find(function (i) { return i.incident_id === incidentId; });
  if (!incident) {
    throw new ApiError("Incident \"" + incidentId + "\" was not found. Check the incident ID and try again.", "INCIDENT_NOT_FOUND", 404);
  }
  return incident;
}

function mockFindAmbulance(db, ambulanceId) {
  return db.ambulances.find(function (a) { return a.ambulance_id === ambulanceId; }) || null;
}

function mockFindHospital(db, hospitalId) {
  return db.hospitals.find(function (h) { return h.hospital_id === hospitalId; }) || null;
}

// ---- Simulated ambulance movement -------------------------------------------
// Moves every moving ambulance towards its destination, based on how much real
// time passed since the last update. EN_ROUTE -> goes to the incident,
// TO_HOSPITAL -> goes to the assigned hospital. Runs whenever data is read.
function mockSimulateMovement(db) {
  const now = Date.now();
  db.ambulances.forEach(function (amb) {
    const last = amb.position_updated_at || now;
    amb.position_updated_at = now;
    if (!amb.incident_id) return;

    const incident = db.incidents.find(function (i) { return i.incident_id === amb.incident_id; });
    if (!incident) return;

    let target = null;
    let speed = 0;
    if (amb.status === "EN_ROUTE") {
      target = { latitude: incident.latitude, longitude: incident.longitude };
      speed = RESPONSE_SPEED_KMPH;
    } else if (amb.status === "TO_HOSPITAL") {
      const hospital = mockFindHospital(db, incident.hospital_id);
      if (hospital) {
        target = { latitude: hospital.latitude, longitude: hospital.longitude };
        speed = TRANSPORT_SPEED_KMPH;
      }
    }
    if (!target) return;

    const hoursPassed = (now - last) / 3600000;
    const stepKm = speed * DEMO_SPEED_MULTIPLIER * hoursPassed;
    const remainingKm = haversineKm(amb.latitude, amb.longitude, target.latitude, target.longitude);

    if (stepKm >= remainingKm) {
      amb.latitude = target.latitude;          // reached the destination
      amb.longitude = target.longitude;
    } else {
      const fraction = stepKm / remainingKm;   // move a fraction of the remaining way
      amb.latitude = amb.latitude + (target.latitude - amb.latitude) * fraction;
      amb.longitude = amb.longitude + (target.longitude - amb.longitude) * fraction;
    }
  });
}

// ---- Status transition engine (shared by dispatch / status / hospital) -------
function mockApplyTransition(db, incident, newStatus, options) {
  options = options || {};
  const currentIndex = INCIDENT_STATUS_FLOW.indexOf(incident.status);
  const newIndex = INCIDENT_STATUS_FLOW.indexOf(newStatus);

  if (newIndex === -1) {
    throw new ApiError("\"" + newStatus + "\" is not a valid status.", "INVALID_STATUS", 400);
  }

  // Dispatch is allowed even if identity is not verified yet (never delay an ambulance).
  const skipIdentity = options.viaDispatch === true &&
                       incident.status === "EMERGENCY_CREATED" &&
                       newStatus === "ASSIGNED";

  if (newIndex !== currentIndex + 1 && !skipIdentity) {
    const allowed = INCIDENT_STATUS_FLOW[currentIndex + 1];
    const message = allowed
      ? "Invalid status change: " + incident.status + " → " + newStatus + ". The only allowed next status is " + allowed + "."
      : "Invalid status change: " + incident.status + " is the final status.";
    throw new ApiError(message, "INVALID_STATUS_TRANSITION", 409);
  }

  const assignedIndex = INCIDENT_STATUS_FLOW.indexOf("ASSIGNED");
  if (newIndex >= assignedIndex && !incident.ambulance_id) {
    throw new ApiError("Assign an ambulance before moving this incident forward.", "NO_AMBULANCE_ASSIGNED", 409);
  }
  if (newStatus === "TO_HOSPITAL" && !incident.hospital_id) {
    throw new ApiError("Select a destination hospital before the ambulance heads to the hospital.", "HOSPITAL_REQUIRED", 409);
  }

  mockSimulateMovement(db);                         // bring positions up to date first

  const nowIso = new Date().toISOString();
  incident.status = newStatus;
  incident.status_history = incident.status_history || [];
  incident.status_history.push({ status: newStatus, at: nowIso });
  if (newStatus === "IDENTITY_VERIFIED") incident.identity_verified = true;

  const ambulance = incident.ambulance_id ? mockFindAmbulance(db, incident.ambulance_id) : null;
  if (ambulance && AMBULANCE_STATUS_FLOW.indexOf(newStatus) !== -1) {
    ambulance.status = newStatus;
    ambulance.position_updated_at = Date.now();
    if (newStatus === "ARRIVED" || newStatus === "PATIENT_PICKED_UP") {
      ambulance.latitude = incident.latitude;       // ambulance is at the scene
      ambulance.longitude = incident.longitude;
    }
    if (newStatus === "HOSPITAL_ARRIVED") {
      const hospital = mockFindHospital(db, incident.hospital_id);
      if (hospital) {
        ambulance.latitude = hospital.latitude;
        ambulance.longitude = hospital.longitude;
      }
    }
  }
}

// ---- Mock endpoint implementations -------------------------------------------
async function mockGetIncidents() {
  await mockDelay();
  const db = mockLoadDB();
  return db.incidents.slice().sort(function (a, b) {
    return new Date(b.emergency_time) - new Date(a.emergency_time);
  });
}

async function mockGetIncident(incidentId) {
  await mockDelay();
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);
  const copy = JSON.parse(JSON.stringify(incident));
  copy.notifications = db.notifications.filter(function (n) { return n.incident_id === incidentId; });
  return copy;
}

async function mockGetAmbulances(incidentId) {
  await mockDelay();
  const db = mockLoadDB();
  const reference = incidentId ? mockFindIncident(db, incidentId) : null;
  mockSimulateMovement(db);
  mockSaveDB(db);

  return db.ambulances.map(function (amb) {
    const copy = Object.assign({}, amb);
    const ownIncident = amb.incident_id
      ? db.incidents.find(function (i) { return i.incident_id === amb.incident_id; })
      : null;
    const target = amb.status === "AVAILABLE" ? reference : ownIncident;
    if (target) {
      const km = haversineKm(amb.latitude, amb.longitude, target.latitude, target.longitude);
      copy.distance_km = round2(km);
      copy.eta_minutes = estimateEtaMinutes(km, RESPONSE_SPEED_KMPH);
    } else {
      copy.distance_km = null;
      copy.eta_minutes = null;
    }
    return copy;
  });
}

async function mockDispatchAmbulance(incidentId, ambulanceId) {
  await mockDelay();
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);

  if (incident.status === "HOSPITAL_ARRIVED") {
    throw new ApiError("This incident is already completed.", "INCIDENT_CLOSED", 409);
  }
  if (incident.ambulance_id) {
    throw new ApiError("Incident " + incident.incident_id + " already has ambulance " + incident.ambulance_id + " assigned.", "INCIDENT_ALREADY_HAS_AMBULANCE", 409);
  }

  const ambulance = mockFindAmbulance(db, ambulanceId);
  if (!ambulance) {
    throw new ApiError("Ambulance \"" + ambulanceId + "\" was not found.", "AMBULANCE_NOT_FOUND", 404);
  }
  if (ambulance.status !== "AVAILABLE") {
    const anyFree = db.ambulances.some(function (a) { return a.status === "AVAILABLE"; });
    if (anyFree) {
      throw new ApiError(ambulance.ambulance_id + " is already assigned (status " + ambulance.status + "). Please choose another ambulance.", "AMBULANCE_ALREADY_ASSIGNED", 409);
    }
    throw new ApiError("No ambulance is available right now. All units are currently assigned.", "NO_AMBULANCE_AVAILABLE", 409);
  }

  // Link both sides, then move the status to ASSIGNED
  ambulance.incident_id = incident.incident_id;
  incident.ambulance_id = ambulance.ambulance_id;
  mockApplyTransition(db, incident, "ASSIGNED", { viaDispatch: true });
  mockSaveDB(db);

  return {
    incident_id: incident.incident_id,
    ambulance_id: ambulance.ambulance_id,
    vehicle_number: ambulance.vehicle_number,
    status: incident.status,
    ambulance_status: ambulance.status,
    message: ambulance.ambulance_id + " has been assigned to " + incident.incident_id + "."
  };
}

// Operator override: swap the assigned ambulance BEFORE it reaches the scene.
// (Not in Member 2's original contract: proposed endpoint POST /api/incidents/{id}/reassign)
async function mockReassignAmbulance(incidentId, data) {
  await mockDelay();
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);
  requireParam(data && data.ambulance_id, "ambulance ID");

  if (!incident.ambulance_id) {
    throw new ApiError("This incident has no ambulance yet. Use dispatch instead.", "NO_AMBULANCE_ASSIGNED", 409);
  }
  if (incident.status !== "ASSIGNED" && incident.status !== "EN_ROUTE") {
    throw new ApiError("The ambulance can only be changed before it reaches the scene (status ASSIGNED or EN_ROUTE). Current status: " + incident.status + ".", "REASSIGN_NOT_ALLOWED", 409);
  }
  if (data.ambulance_id === incident.ambulance_id) {
    throw new ApiError(data.ambulance_id + " is already assigned to this incident.", "SAME_AMBULANCE", 409);
  }
  const next = mockFindAmbulance(db, data.ambulance_id);
  if (!next) throw new ApiError("Ambulance \"" + data.ambulance_id + "\" was not found.", "AMBULANCE_NOT_FOUND", 404);
  if (next.status !== "AVAILABLE") {
    throw new ApiError(next.ambulance_id + " is already assigned (status " + next.status + "). Please choose another ambulance.", "AMBULANCE_ALREADY_ASSIGNED", 409);
  }

  mockSimulateMovement(db);
  const previousId = incident.ambulance_id;
  const previous = mockFindAmbulance(db, previousId);
  if (previous) {                               // release the old unit where it currently is
    previous.status = "AVAILABLE";
    previous.incident_id = null;
    previous.position_updated_at = Date.now();
  }
  next.incident_id = incident.incident_id;
  next.status = incident.status;                // keeps ASSIGNED or EN_ROUTE (the incident status does not go backwards)
  next.position_updated_at = Date.now();
  incident.ambulance_id = next.ambulance_id;
  incident.status_history = incident.status_history || [];
  incident.status_history.push({ status: incident.status, at: new Date().toISOString(), note: "Ambulance changed " + previousId + " -> " + next.ambulance_id });
  mockSaveDB(db);

  return {
    incident_id: incident.incident_id,
    ambulance_id: next.ambulance_id,
    previous_ambulance_id: previousId,
    status: incident.status,
    message: previousId + " released. " + next.ambulance_id + " is now assigned to " + incident.incident_id + "."
  };
}

async function mockGetEmergencyContacts(incidentId) {
  await mockDelay();
  const db = mockLoadDB();
  mockFindIncident(db, incidentId);                       // validates the ID
  const list = db.contacts[incidentId] || [];
  return list.filter(function (c) { return c.authorized === true; });   // authorized contacts only
}

async function mockSendNotification(incidentId, data) {
  await mockDelay();
  const db = mockLoadDB();
  mockFindIncident(db, incidentId);

  if (!data) throw new ApiError("Missing notification details.", "MISSING_DATA", 400);
  const channels = ["SMS", "WHATSAPP", "VOICE_CALL"];
  if (channels.indexOf(data.channel) === -1) {
    throw new ApiError("Unknown notification channel \"" + data.channel + "\".", "INVALID_CHANNEL", 400);
  }
  if (!data.message || String(data.message).trim() === "") {
    throw new ApiError("The notification message is empty.", "MISSING_DATA", 400);
  }

  const contacts = db.contacts[incidentId] || [];
  const contact = contacts.find(function (c) { return c.contact_id === data.contact_id && c.authorized === true; });
  if (!contact) {
    throw new ApiError("Notification failed: that contact was not found or is not authorized.", "NOTIFICATION_FAILED", 404);
  }

  const failed = data.simulate_failure === true;           // demo switch to test error handling
  const record = {
    notification_id: "NTF-" + String(db.notifications.length + 1).padStart(4, "0"),
    incident_id: incidentId,
    contact_id: contact.contact_id,
    recipient_name: contact.name,
    recipient_relationship: contact.relationship,
    recipient_phone_masked: contact.phone_masked,
    channel: data.channel,
    message: data.message,
    status: failed ? "FAILED" : "SIMULATED",
    is_simulated: true,
    triggered_by: data.triggered_by === "AUTO" ? "AUTO" : "OPERATOR",
    sent_at: new Date().toISOString()
  };
  db.notifications.push(record);
  mockSaveDB(db);

  if (failed) {
    throw new ApiError("Notification to " + contact.name + " failed (simulated gateway error).", "NOTIFICATION_FAILED", 502);
  }
  return record;
}

async function mockGetTracking(incidentId) {
  await mockDelay(150);
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);
  mockSimulateMovement(db);
  mockSaveDB(db);

  const ambulance = incident.ambulance_id ? mockFindAmbulance(db, incident.ambulance_id) : null;
  const hospital = incident.hospital_id ? mockFindHospital(db, incident.hospital_id) : null;

  let destination = null;
  let remainingKm = null;
  let eta = null;

  if (ambulance) {
    const s = ambulance.status;
    if (s === "ASSIGNED" || s === "EN_ROUTE") {
      destination = "INCIDENT";
      remainingKm = haversineKm(ambulance.latitude, ambulance.longitude, incident.latitude, incident.longitude);
      eta = estimateEtaMinutes(remainingKm, RESPONSE_SPEED_KMPH);
    } else if (s === "ARRIVED" || s === "PATIENT_PICKED_UP" || s === "TO_HOSPITAL") {
      if (hospital) {
        destination = "HOSPITAL";
        remainingKm = haversineKm(ambulance.latitude, ambulance.longitude, hospital.latitude, hospital.longitude);
        eta = estimateEtaMinutes(remainingKm, TRANSPORT_SPEED_KMPH);
      }
    } else if (s === "HOSPITAL_ARRIVED") {
      destination = "HOSPITAL";
      remainingKm = 0;
      eta = 0;
    }
  }

  return {
    incident_id: incident.incident_id,
    status: incident.status,
    ambulance_id: ambulance ? ambulance.ambulance_id : null,
    vehicle_number: ambulance ? ambulance.vehicle_number : null,
    ambulance_status: ambulance ? ambulance.status : null,
    emergency_location: {
      latitude: incident.latitude,
      longitude: incident.longitude,
      label: incident.location
    },
    ambulance_location: ambulance ? {
      latitude: ambulance.latitude,
      longitude: ambulance.longitude,
      updated_at: new Date(ambulance.position_updated_at).toISOString()
    } : null,
    hospital_location: hospital ? {
      hospital_id: hospital.hospital_id,
      name: hospital.name,
      latitude: hospital.latitude,
      longitude: hospital.longitude
    } : null,
    destination: destination,
    distance_remaining_km: remainingKm === null ? null : round2(remainingKm),
    eta_minutes: eta,
    is_simulated: true,
    demo_speed_multiplier: DEMO_SPEED_MULTIPLIER
  };
}

async function mockUpdateIncidentStatus(incidentId, status) {
  await mockDelay();
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);
  requireParam(status, "status");

  mockApplyTransition(db, incident, String(status).trim().toUpperCase());
  mockSaveDB(db);

  const ambulance = incident.ambulance_id ? mockFindAmbulance(db, incident.ambulance_id) : null;
  return {
    incident_id: incident.incident_id,
    status: incident.status,
    ambulance_id: incident.ambulance_id,
    ambulance_status: ambulance ? ambulance.status : null
  };
}

async function mockAssignHospital(incidentId, hospitalData) {
  await mockDelay();
  const db = mockLoadDB();
  const incident = mockFindIncident(db, incidentId);

  if (!hospitalData || !hospitalData.hospital_id) {
    throw new ApiError("Missing hospital information.", "MISSING_DATA", 400);
  }
  if (!hospitalData.ambulance_id) {
    throw new ApiError("An ambulance must be assigned before a hospital can be selected.", "MISSING_DATA", 400);
  }
  if (incident.status === "HOSPITAL_ARRIVED") {
    throw new ApiError("This incident is already completed.", "INCIDENT_CLOSED", 409);
  }

  const hospital = mockFindHospital(db, hospitalData.hospital_id);
  if (!hospital) {
    throw new ApiError("Hospital \"" + hospitalData.hospital_id + "\" was not found.", "HOSPITAL_NOT_FOUND", 404);
  }
  if (hospital.emergency_department !== "AVAILABLE") {
    throw new ApiError(hospital.name + " is not accepting emergency patients right now. Please choose another hospital.", "HOSPITAL_UNAVAILABLE", 409);
  }
  if (incident.ambulance_id !== hospitalData.ambulance_id) {
    throw new ApiError("Ambulance " + hospitalData.ambulance_id + " is not assigned to " + incident.incident_id + ".", "AMBULANCE_MISMATCH", 409);
  }

  // Store the hospital against the incident (Member 4 reads this using the same incident_id)
  incident.hospital_id = hospital.hospital_id;
  incident.eta_minutes = hospitalData.eta_minutes === undefined ? null : hospitalData.eta_minutes;
  incident.hospital_assigned_at = new Date().toISOString();

  // If the patient is already on board, the ambulance can now head to the hospital.
  if (incident.status === "PATIENT_PICKED_UP") {
    mockApplyTransition(db, incident, "TO_HOSPITAL");
  }
  mockSaveDB(db);

  return {
    incident_id: incident.incident_id,
    hospital_id: hospital.hospital_id,
    hospital_name: hospital.name,
    ambulance_id: incident.ambulance_id,
    eta_minutes: incident.eta_minutes,
    status: incident.status,
    message: hospital.name + " has been notified of the incoming emergency (simulated)."
  };
}

async function mockGetHospitals(incidentId) {
  await mockDelay();
  const db = mockLoadDB();
  const reference = incidentId ? mockFindIncident(db, incidentId) : null;
  return db.hospitals.map(function (h) {
    const copy = Object.assign({}, h);
    if (reference) {
      const km = haversineKm(reference.latitude, reference.longitude, h.latitude, h.longitude);
      copy.distance_km = round2(km);
      copy.eta_minutes = estimateEtaMinutes(km, TRANSPORT_SPEED_KMPH);
    } else {
      copy.distance_km = null;
      copy.eta_minutes = null;
    }
    return copy;
  });
}

function mockResetDemoData() {
  mockMemoryDB = null;
  try { localStorage.removeItem(MOCK_DB_KEY); } catch (e) { /* ignore */ }
}


/* ============================================================================
   3B. REAL API  (fetch calls to Member 2's backend)
                                       -- used only when USE_MOCK_API = false
   ----------------------------------------------------------------------------
   Every function below calls one endpoint from the API contract in README.md.
   Responses are passed through small "adapt" functions: if Member 2 uses
   slightly different field names, change them HERE and the pages keep working.
   ============================================================================ */

// One place for ALL fetch() code in the project.
async function apiRequest(method, path, body) {
  const url = API_BASE_URL + path;
  let response;
  try {
    response = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      // If Member 2 adds login, add:  "Authorization": "Bearer " + token  to the headers above.
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (networkError) {
    throw new ApiError(
      "Cannot reach the backend at " + API_BASE_URL + ". Check that Member 2's server is running and allows requests from this page (CORS).",
      "NETWORK_ERROR", 0
    );
  }

  let payload = null;
  const rawText = await response.text();
  if (rawText) {
    try { payload = JSON.parse(rawText); } catch (parseError) { payload = null; }
  }

  if (!response.ok) {
    let message = payload && (payload.detail || payload.message || payload.error);
    if (message && typeof message !== "string") message = JSON.stringify(message);
    throw new ApiError(
      message || "The server returned an error (HTTP " + response.status + ").",
      (payload && payload.code) || ("HTTP_" + response.status),
      response.status
    );
  }

  // Accept both  {...}  and  {"data": {...}}  from the backend.
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.data !== undefined) {
    return payload.data;
  }
  return payload;
}

function realUnwrapList(result, key) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result[key])) return result[key];
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

// Make sure optional fields exist so the pages never crash on missing data.
function realAdaptIncident(raw) {
  const incident = Object.assign({}, raw || {});
  if (!Array.isArray(incident.status_history)) incident.status_history = [];
  if (!Array.isArray(incident.notifications)) incident.notifications = [];
  return incident;
}

async function realGetIncidents() {
  const result = await apiRequest("GET", "/incidents");
  return realUnwrapList(result, "incidents").map(realAdaptIncident);
}

async function realGetIncident(incidentId) {
  const result = await apiRequest("GET", "/incidents/" + encodeURIComponent(incidentId));
  return realAdaptIncident(result);
}

async function realGetAmbulances(incidentId) {
  const query = incidentId ? "?incident_id=" + encodeURIComponent(incidentId) : "";
  const result = await apiRequest("GET", "/ambulances" + query);
  return realUnwrapList(result, "ambulances");
}

async function realDispatchAmbulance(incidentId, ambulanceId) {
  return apiRequest("POST", "/incidents/" + encodeURIComponent(incidentId) + "/dispatch", { ambulance_id: ambulanceId });
}

// Proposed additional endpoint (not in the original contract). Member 2 must implement it for overrides in LIVE mode.
async function realReassignAmbulance(incidentId, data) {
  return apiRequest("POST", "/incidents/" + encodeURIComponent(incidentId) + "/reassign", data);
}

async function realGetEmergencyContacts(incidentId) {
  const result = await apiRequest("GET", "/incidents/" + encodeURIComponent(incidentId) + "/contacts");
  return realUnwrapList(result, "contacts");
}

async function realSendNotification(incidentId, notificationData) {
  return apiRequest("POST", "/incidents/" + encodeURIComponent(incidentId) + "/notify", notificationData);
}

async function realGetTracking(incidentId) {
  return apiRequest("GET", "/incidents/" + encodeURIComponent(incidentId) + "/tracking");
}

async function realUpdateIncidentStatus(incidentId, status) {
  return apiRequest("PATCH", "/incidents/" + encodeURIComponent(incidentId) + "/status", { status: status });
}

async function realAssignHospital(incidentId, hospitalData) {
  return apiRequest("POST", "/incidents/" + encodeURIComponent(incidentId) + "/hospital", hospitalData);
}

async function realGetHospitals(incidentId) {
  const query = incidentId ? "?incident_id=" + encodeURIComponent(incidentId) : "";
  const result = await apiRequest("GET", "/hospitals" + query);
  return realUnwrapList(result, "hospitals");
}


/* ============================================================================
   4. PUBLIC API FUNCTIONS
   ----------------------------------------------------------------------------
   These are the ONLY functions the pages call. Each one picks MOCK or REAL
   depending on USE_MOCK_API above. Their names and return shapes never change.
   ============================================================================ */

// GET /api/incidents
async function getIncidents() {
  return USE_MOCK_API ? mockGetIncidents() : realGetIncidents();
}

// GET /api/incidents/{incident_id}
async function getIncident(incidentId) {
  requireParam(incidentId, "incident ID");
  return USE_MOCK_API ? mockGetIncident(incidentId) : realGetIncident(incidentId);
}

// GET /api/ambulances   (optional incidentId => distance and ETA from that incident)
async function getAmbulances(incidentId) {
  return USE_MOCK_API ? mockGetAmbulances(incidentId) : realGetAmbulances(incidentId);
}

// POST /api/incidents/{incident_id}/dispatch      body: { ambulance_id }
async function dispatchAmbulance(incidentId, ambulanceId) {
  requireParam(incidentId, "incident ID");
  requireParam(ambulanceId, "ambulance ID");
  return USE_MOCK_API ? mockDispatchAmbulance(incidentId, ambulanceId) : realDispatchAmbulance(incidentId, ambulanceId);
}

// POST /api/incidents/{incident_id}/reassign      body: { ambulance_id, reason }   (operator override; additional endpoint)
async function reassignAmbulance(incidentId, data) {
  requireParam(incidentId, "incident ID");
  requireParam(data && data.ambulance_id, "ambulance ID");
  return USE_MOCK_API ? mockReassignAmbulance(incidentId, data) : realReassignAmbulance(incidentId, data);
}

// GET /api/incidents/{incident_id}/contacts       (authorized contacts only)
async function getEmergencyContacts(incidentId) {
  requireParam(incidentId, "incident ID");
  return USE_MOCK_API ? mockGetEmergencyContacts(incidentId) : realGetEmergencyContacts(incidentId);
}

// POST /api/incidents/{incident_id}/notify        body: { contact_id, channel, message }
async function sendNotification(incidentId, notificationData) {
  requireParam(incidentId, "incident ID");
  return USE_MOCK_API ? mockSendNotification(incidentId, notificationData) : realSendNotification(incidentId, notificationData);
}

// GET /api/incidents/{incident_id}/tracking
async function getTracking(incidentId) {
  requireParam(incidentId, "incident ID");
  return USE_MOCK_API ? mockGetTracking(incidentId) : realGetTracking(incidentId);
}

// PATCH /api/incidents/{incident_id}/status       body: { status }
async function updateIncidentStatus(incidentId, status) {
  requireParam(incidentId, "incident ID");
  requireParam(status, "status");
  return USE_MOCK_API ? mockUpdateIncidentStatus(incidentId, status) : realUpdateIncidentStatus(incidentId, status);
}

// POST /api/incidents/{incident_id}/hospital      body: { hospital_id, ambulance_id, eta_minutes }
async function assignHospital(incidentId, hospitalData) {
  requireParam(incidentId, "incident ID");
  return USE_MOCK_API ? mockAssignHospital(incidentId, hospitalData) : realAssignHospital(incidentId, hospitalData);
}

// GET /api/hospitals   (optional incidentId => distance and ETA from that incident)
async function getHospitals(incidentId) {
  return USE_MOCK_API ? mockGetHospitals(incidentId) : realGetHospitals(incidentId);
}

// Mock mode only: restore the original demo data.
async function resetDemoData() {
  if (!USE_MOCK_API) {
    throw new ApiError("Reset is only available in mock (demo) mode.", "NOT_SUPPORTED", 400);
  }
  mockResetDemoData();
  resetAutomationState();
}


/* ============================================================================
   4B. AI SERVICE CALLS
   ----------------------------------------------------------------------------
   Frontend -> AI service (Node, ai-service/) -> optional LLM.
   The browser never talks to an LLM and never holds a key.

   Privacy: the request builders below send ONLY what ranking needs (IDs,
   coordinates, severity, capability). Blood group, allergies, patient name,
   identity confidence and any biometric data are never sent to the AI service.

   These functions return the service's JSON UNVALIDATED. automation.js passes
   it through Rules.validateAi*Response() before anything is done with it.
   ============================================================================ */
async function aiRequest(method, path, body) {
  if (!AI_ENABLED) throw new ApiError("AI is switched off (AI_ENABLED = false).", "AI_DISABLED", 0);

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, AI_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(AI_SERVICE_URL + path, {
      method: method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (networkError) {
    throw new ApiError("AI service unreachable at " + AI_SERVICE_URL + " (is `node server.js` running in ai-service/?).", "AI_UNAVAILABLE", 0);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try { payload = await response.json(); } catch (e) { payload = null; }

  if (!response.ok) {
    const code = payload && payload.code;
    const message = (payload && payload.message) || ("AI service returned HTTP " + response.status + ".");
    // 4xx with a business code (e.g. NO_ELIGIBLE_AMBULANCE) is a real answer, not an outage.
    const outage = response.status >= 500 || response.status === 429 || response.status === 403;
    throw new ApiError(message, outage ? "AI_UNAVAILABLE" : (code || "AI_REJECTED"), response.status);
  }
  if (payload === null || typeof payload !== "object") {
    throw new ApiError("AI service returned something that is not JSON.", "AI_MALFORMED", 502);
  }
  return payload;
}

function aiIncidentPayload(incident) {
  return {
    incident_id: incident.incident_id,
    severity: incident.severity,
    incident_type: incident.incident_type || "GENERAL",
    latitude: incident.latitude,
    longitude: incident.longitude,
    location: incident.location || ""
  };
}

// GET /api/ai/health  ->  { status, llm_configured }
async function getAiHealth() {
  if (!AI_ENABLED) return { status: "DISABLED", llm_configured: false };
  return aiRequest("GET", "/api/ai/health");
}

// POST /api/ai/ambulance-recommendation
async function aiRecommendAmbulance(incident, ambulances) {
  return aiRequest("POST", "/api/ai/ambulance-recommendation", {
    incident: aiIncidentPayload(incident),
    ambulances: ambulances.map(function (a) {
      return {
        ambulance_id: a.ambulance_id, status: a.status, incident_id: a.incident_id || null,
        latitude: a.latitude, longitude: a.longitude,
        capability: a.capability, equipment: a.equipment || [], missions_today: a.missions_today || 0
      };
    })
  });
}

// POST /api/ai/hospital-recommendation
async function aiRecommendHospital(incident, hospitals) {
  return aiRequest("POST", "/api/ai/hospital-recommendation", {
    incident: aiIncidentPayload(incident),
    hospitals: hospitals.map(function (h) {
      return {
        hospital_id: h.hospital_id, name: h.name, emergency_department: h.emergency_department,
        latitude: h.latitude, longitude: h.longitude, beds_available: h.beds_available,
        capabilities: h.capabilities || []
      };
    })
  });
}

// POST /api/ai/incident-summary   (facts = small non-medical object built in automation.js)
async function aiIncidentSummary(facts) {
  return aiRequest("POST", "/api/ai/incident-summary", { facts: facts });
}


/* ============================================================================
   4C. AUTOMATION STATE  (activity log, AUTO MODE, last recommendations)
   ----------------------------------------------------------------------------
   This is Member 3's OWN bookkeeping, kept in this browser (localStorage) in
   both mock and live mode. It is NOT Member 2's data: incidents, ambulances
   and hospitals always go through the API above. Nothing medical is stored here.

   Per incident:
     auto_mode : "ON"        automation may act
                 "OVERRIDE"  operator took control, automation will not act
     log       : [{ at, level, actor, text }]   level = info | ok | warn | error
     steps     : which automation steps have completed (drives the timeline)
   ============================================================================ */
const AUTOMATION_KEY = "member3_automation_v1";
const AUTOMATION_LOG_LIMIT = 200;
let automationMemory = null;

function automationLoadAll() {
  let raw = null;
  try { raw = localStorage.getItem(AUTOMATION_KEY); } catch (e) { raw = automationMemory; }
  if (raw) {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object") return parsed; }
    catch (e) { console.warn("Automation state was corrupted, so it was reset."); }
  }
  return { _global: { paused: false }, incidents: {} };
}

function automationSaveAll(all) {
  const raw = JSON.stringify(all);
  automationMemory = raw;
  try { localStorage.setItem(AUTOMATION_KEY, raw); } catch (e) { /* in-memory copy only */ }
}

function newAutomationState() {
  return {
    auto_mode: "ON",
    steps: {},
    log: [],
    ambulance_recommendation: null,
    hospital_recommendation: null,
    decision_mode: null,            // LLM | SCORING_ENGINE | FALLBACK | RULES | MANUAL
    notification: "NOT_STARTED",    // NOT_STARTED | SENT_SIMULATED | PARTIAL | FAILED | SKIPPED
    summary: null,                  // { text, source: "LLM" | "TEMPLATE", at }
    blocked: null,                  // { reason, at } when automation is waiting for something
    lock_until: 0,
    updated_at: null
  };
}

function getAutomationState(incidentId) {
  const all = automationLoadAll();
  return Object.assign(newAutomationState(), (all.incidents || {})[incidentId] || {});
}

function updateAutomationState(incidentId, mutator) {
  const all = automationLoadAll();
  all.incidents = all.incidents || {};
  const state = Object.assign(newAutomationState(), all.incidents[incidentId] || {});
  mutator(state);
  state.updated_at = new Date().toISOString();
  if (state.log.length > AUTOMATION_LOG_LIMIT) state.log = state.log.slice(-AUTOMATION_LOG_LIMIT);
  all.incidents[incidentId] = state;
  automationSaveAll(all);
  return state;
}

// level: info | ok | warn | error      actor: SYSTEM | OPERATOR
function appendAutomationLog(incidentId, text, level, actor) {
  return updateAutomationState(incidentId, function (state) {
    state.log.push({ at: new Date().toISOString(), level: level || "info", actor: actor || "SYSTEM", text: String(text) });
  });
}

function getGlobalAutomation() {
  const all = automationLoadAll();
  return Object.assign({ paused: false }, all._global || {});
}

function setGlobalAutomationFlag(key, value) {
  const all = automationLoadAll();
  all._global = Object.assign({ paused: false }, all._global || {});
  all._global[key] = value;
  automationSaveAll(all);
}

function setGlobalAutomationPaused(paused) {
  setGlobalAutomationFlag("paused", !!paused);
}

// Called by the other pages whenever the OPERATOR acts manually on an incident that automation also manages.
// The operator's action is logged and automation for that incident stops acting until "Resume AUTO" is pressed.
function recordOperatorAction(incidentId, text) {
  return updateAutomationState(incidentId, function (state) {
    state.log.push({ at: new Date().toISOString(), level: "warn", actor: "OPERATOR", text: String(text) });
    if (state.auto_mode !== "OVERRIDE") {
      state.auto_mode = "OVERRIDE";
      state.log.push({ at: new Date().toISOString(), level: "warn", actor: "OPERATOR", text: "MANUAL OVERRIDE: automation paused for this incident." });
    }
    state.decision_mode = "MANUAL";
  });
}

// Simple cross-tab lock so two open dashboards do not both run the pipeline.
// (The backend also rejects double assignment, so this is a courtesy, not the safety net.)
function tryAcquireAutomationLock(incidentId, ms) {
  let acquired = false;
  updateAutomationState(incidentId, function (state) {
    if (!state.lock_until || state.lock_until < Date.now()) {
      state.lock_until = Date.now() + (ms || 30000);
      acquired = true;
    }
  });
  return acquired;
}

function releaseAutomationLock(incidentId) {
  updateAutomationState(incidentId, function (state) { state.lock_until = 0; });
}

// Clears every incident's log / AUTO MODE / recommendations. The operator's GLOBAL switches (pause, demo failure
// switch) are kept, so the checkboxes and buttons on the dashboard still match what is stored.
function resetAutomationState() {
  const keep = automationLoadAll()._global || { paused: false };
  automationMemory = null;
  try { localStorage.removeItem(AUTOMATION_KEY); } catch (e) { /* ignore */ }
  automationSaveAll({ _global: keep, incidents: {} });
}

// Which mode is the whole system in?  (shown honestly in the UI)
function getOperatingMode() {
  if (!AUTO_DISPATCH_ENABLED) return "MANUAL";
  return AI_ENABLED ? "AI" : "DEMO";
}


/* ============================================================================
   5. SHARED UI HELPERS
   ----------------------------------------------------------------------------
   Small helpers used by every page (badges, toasts, navigation...).
   They contain no data access, so they are NOT touched when you switch APIs.
   ============================================================================ */

// ---- Text helpers ------------------------------------------------------------
function escapeHtml(value) {
  const text = (value === null || value === undefined) ? "" : String(value);
  return text.replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
  });
}

// Shows "Not available" when data is missing, instead of a blank or "null".
function valueOrNA(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback === undefined ? "Not available" : fallback;
  }
  return value;
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const minutes = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  return hours + " h " + (minutes % 60) + " min ago";
}

function formatCoordinates(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return "Not available";
  return lat.toFixed(4) + ", " + lng.toFixed(4);
}

// ---- Badges ------------------------------------------------------------------
function statusLabel(status) {
  return String(status === null || status === undefined || status === "" ? "UNKNOWN" : status).replace(/_/g, " ");
}

function statusBadge(status) {
  const safe = String(status || "UNKNOWN").replace(/[^A-Z_]/gi, "");
  return "<span class=\"badge status-" + safe + "\">" + escapeHtml(statusLabel(status)) + "</span>";
}

function severityBadge(severity) {
  const safe = String(severity || "UNKNOWN").replace(/[^A-Z]/gi, "").toUpperCase();
  return "<span class=\"badge sev-" + safe + "\"><span class=\"dot\"></span>" + escapeHtml(valueOrNA(severity, "UNKNOWN")) + "</span>";
}

// The next button for the current status, or null when there is none.
function getNextStatusAction(status) {
  return STATUS_ACTIONS[status] || null;
}

// ---- Toasts, alerts, errors --------------------------------------------------
function showToast(message, type, duration) {
  type = type || "info";
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const icons = { success: "✓", danger: "!", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.setAttribute("role", type === "danger" ? "alert" : "status");
  toast.innerHTML =
    "<span class=\"toast-icon\" aria-hidden=\"true\">" + (icons[type] || "i") + "</span>" +
    "<span class=\"toast-text\">" + escapeHtml(message) + "</span>" +
    "<button type=\"button\" class=\"toast-close\" aria-label=\"Dismiss\">×</button>";
  container.appendChild(toast);

  const remove = function () { if (toast.parentNode) toast.parentNode.removeChild(toast); };
  toast.querySelector(".toast-close").addEventListener("click", remove);
  setTimeout(remove, duration || 4500);
}

// Fills the <div id="page-alert"> at the top of the page. extraHtml must be trusted HTML.
function showAlert(message, type, extraHtml) {
  type = type || "danger";
  const box = document.getElementById("page-alert");
  if (!box) { showToast(message, type); return; }
  const icons = { success: "✓", danger: "!", warning: "!", info: "i" };
  box.innerHTML =
    "<div class=\"alert alert-" + type + "\" role=\"" + (type === "danger" ? "alert" : "status") + "\">" +
      "<span class=\"alert-icon\" aria-hidden=\"true\">" + (icons[type] || "i") + "</span>" +
      "<div class=\"alert-body\">" + escapeHtml(message) +
        (extraHtml ? "<div class=\"alert-extra\">" + extraHtml + "</div>" : "") +
      "</div>" +
    "</div>";
}

function clearAlert() {
  const box = document.getElementById("page-alert");
  if (box) box.innerHTML = "";
}

function describeError(err) {
  if (err instanceof ApiError) return err.message;
  if (err && err.message) return "Unexpected problem: " + err.message;
  return "Something went wrong. Please try again.";
}

// options.toast = true  => also show a toast (use for button actions)
// options.extraHtml     => trusted HTML (e.g. a "Back to dashboard" link)
function handleError(err, options) {
  options = options || {};
  const message = describeError(err);
  console.error("[Member 3]", err);
  showAlert(message, "danger", options.extraHtml);
  if (options.toast) showToast(message, "danger");
  return message;
}

function emptyStateHtml(title, text, actionsHtml) {
  return "<div class=\"empty-state\">" +
           "<div class=\"empty-icon\" aria-hidden=\"true\">!</div>" +
           "<h3>" + escapeHtml(title) + "</h3>" +
           (text ? "<p>" + escapeHtml(text) + "</p>" : "") +
           (actionsHtml ? "<div class=\"empty-actions\">" + actionsHtml + "</div>" : "") +
         "</div>";
}

// Shows a spinner on a button and disables it while a request is running.
function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
}

// Runs a status change from any page's button. Returns true on success.
async function advanceStatus(incidentId, nextStatus, button) {
  setBusy(button, true);
  try {
    await updateIncidentStatus(incidentId, nextStatus);
    // Recorded in the automation activity log. A normal crew action (e.g. PATIENT PICKED UP) does not pause automation.
    appendAutomationLog(incidentId, "Operator changed status to " + nextStatus + ".", "info", "OPERATOR");
    showToast("Status updated to " + statusLabel(nextStatus) + ".", "success");
    return true;
  } catch (err) {
    handleError(err, { toast: true });
    return false;
  } finally {
    setBusy(button, false);
  }
}

// ---- Current incident + navigation -------------------------------------------
// The incident ID travels in the URL (?id=INC-2026-0001) so that every page
// uses the SAME incident_id. It is also remembered for this browser tab only.
const CURRENT_INCIDENT_KEY = "member3_current_incident";

function getIncidentIdFromUrl() {
  const id = new URLSearchParams(window.location.search).get("id");
  return id ? id.trim() : null;
}

function getCurrentIncidentId() {
  const fromUrl = getIncidentIdFromUrl();
  if (fromUrl) return fromUrl;
  try { return sessionStorage.getItem(CURRENT_INCIDENT_KEY); } catch (e) { return null; }
}

function rememberIncident(incidentId) {
  try { sessionStorage.setItem(CURRENT_INCIDENT_KEY, incidentId); } catch (e) { /* ignore */ }
}

// Adds ?id=<current incident> to the navigation links that need an incident.
function wireNavLinks() {
  const id = getCurrentIncidentId();
  const links = document.querySelectorAll("[data-incident-link]");
  links.forEach(function (link) {
    const base = link.getAttribute("href").split("?")[0];
    link.setAttribute("href", id ? base + "?id=" + encodeURIComponent(id) : base);
  });
}

function incidentOptionLabel(incident) {
  return incident.incident_id + " — " + valueOrNA(incident.location, "Unknown location") + " (" + valueOrNA(incident.severity, "?") + ")";
}

// Fills the incident drop-down used on the incident-based pages.
// Calls onSelect(incidentId) whenever the operator picks another incident.
async function setupIncidentSelector(onSelect) {
  const select = document.getElementById("incident-select");
  if (!select) return { incidents: [], selectedId: getCurrentIncidentId() };

  let incidents = [];
  try {
    incidents = await getIncidents();
  } catch (err) {
    handleError(err, { extraHtml: "<a href=\"index.html\">Back to dashboard</a>" });
  }

  const selectedId = getCurrentIncidentId();
  let html = "<option value=\"\">— Select an incident —</option>";
  incidents.forEach(function (incident) {
    html += "<option value=\"" + escapeHtml(incident.incident_id) + "\"" +
            (incident.incident_id === selectedId ? " selected" : "") + ">" +
            escapeHtml(incidentOptionLabel(incident)) + "</option>";
  });
  select.innerHTML = html;

  select.addEventListener("change", function () {
    const id = select.value;
    if (id) {
      rememberIncident(id);
      window.history.replaceState(null, "", "?id=" + encodeURIComponent(id));
    } else {
      window.history.replaceState(null, "", window.location.pathname);
    }
    wireNavLinks();
    onSelect(id || null);
  });

  return { incidents: incidents, selectedId: selectedId };
}

// ---- Page start-up -----------------------------------------------------------
// Call once at the top of every page script.
function initPage() {
  // Mode indicator in the navigation bar
  const pill = document.getElementById("mode-pill");
  if (pill) {
    const opMode = getOperatingMode();
    pill.textContent = (USE_MOCK_API ? "MOCK API" : "LIVE API") + " · " + (opMode === "AI" ? "AI AUTO" : opMode === "DEMO" ? "RULES AUTO" : "MANUAL");
    pill.className = "mode-pill " + (USE_MOCK_API ? "mode-mock" : "mode-live");
  }

  // Safety banner (security requirement: label demo / simulated features)
  const banner = document.getElementById("demo-banner");
  if (banner) {
    banner.innerHTML = USE_MOCK_API
      ? "<strong>DEMO MODE</strong> &middot; All data is fictional and stored only in this browser. " +
        "Ambulance tracking (<strong>DEMO / SIMULATED GPS</strong>) and family notifications are <strong>SIMULATED</strong>. " +
        "A face match is AI-assisted and is <strong>not absolute proof</strong> of identity."
      : "<strong>LIVE API</strong> &middot; Connected to " + escapeHtml(API_BASE_URL) + ". " +
        "Notifications remain <strong>SIMULATED</strong> in this prototype. " +
        "A face match is AI-assisted and is <strong>not absolute proof</strong> of identity.";
  }

  // Mobile menu button
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  wireNavLinks();

  // Never leave the page silently broken if some promise fails unexpectedly
  window.addEventListener("unhandledrejection", function (event) {
    event.preventDefault();
    handleError(event.reason, { toast: true });
  });
}
