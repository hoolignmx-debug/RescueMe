// DEMO BACKEND - stands in for Member 2's central backend while it is unavailable.
// Same interface as realBackend.js. Enforces the same rules the real backend must:
// token auth + expiry + revocation, role permissions, status-transition rules,
// idempotent / duplicate-aware note saving, and server-side audit logging.
//
// Data is synthetic (see demoData.js) and lives in localStorage under erdash.mock.*

import { ApiError } from '../../api.js';
import { getToken } from '../../session.js';
import { can, roleLabel } from '../../../utils/permissions.js';
import { allowedTransitions, isValidTransition, HAS_ARRIVED, statusLabel } from '../../../utils/statuses.js';
import { storage } from './storage.js';
import { buildSeed, DEMO_USERS, BLOOD_INVENTORY } from './demoData.js';
import { config } from '../../../config.js';

const DATA_KEY = 'erdash.mock.data';
const SESSION_KEY = 'erdash.mock.sessions';
const OUTAGE_KEY = 'erdash.mock.outage';
const TOKEN_TTL_MS = 30 * 60 * 1000;

let latencyMs = 180;
export const setMockLatency = (ms) => {
  latencyMs = ms;
};
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// ---------- store ----------
let state = null;
function db() {
  if (!state) state = storage.get(DATA_KEY) || buildSeed();
  if (!storage.get(DATA_KEY)) storage.set(DATA_KEY, state);
  return state;
}
const save = () => storage.set(DATA_KEY, state);
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

const sessions = () => storage.get(SESSION_KEY) || {};
const saveSessions = (s) => storage.set(SESSION_KEY, s);

// ---------- demo controls (used by the DemoBanner and by tests) ----------
export const demoControls = {
  reset() {
    state = buildSeed();
    save();
    storage.remove(OUTAGE_KEY);
  },
  isOutage: () => storage.get(OUTAGE_KEY) === true,
  setOutage(on) {
    storage.set(OUTAGE_KEY, !!on);
  },
  expireCurrentSession() {
    const token = getToken();
    const s = sessions();
    if (token && s[token]) {
      s[token].expiresAt = Date.now() - 1000;
      saveSessions(s);
    }
  },
  _db: () => db(),
};

// ---------- guards ----------
async function gate() {
  await sleep(latencyMs);
  if (demoControls.isOutage()) {
    throw new ApiError('NETWORK', 'Cannot reach the hospital backend. Check your connection or whether the server is running.');
  }
}

function currentUser() {
  const token = getToken();
  const sess = token ? sessions()[token] : null;
  if (!sess || sess.revoked || sess.expiresAt <= Date.now()) {
    throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', { status: 401 });
  }
  const user = DEMO_USERS.find((u) => u.staff_id === sess.staff_id);
  if (!user) throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', { status: 401 });
  return user;
}

function authorize(permission, incidentId = null) {
  const user = currentUser();
  if (permission && !can(user.role, permission)) {
    log(user, 'ACCESS_DENIED', { incident_id: incidentId, details: `Attempted ${permission} as ${user.role}` });
    throw new ApiError('FORBIDDEN', `Your role (${roleLabel(user.role)}) is not authorized for this action.`, { status: 403 });
  }
  return user;
}

const DEDUPE_ACTIONS = new Set(['PROFILE_VIEWED', 'TRACKING_VIEWED', 'BLOODBANK_VIEWED', 'NOTES_VIEWED']);

function log(user, action, extra = {}) {
  const d = db();
  const incident_id = extra.incident_id ?? null;
  if (DEDUPE_ACTIONS.has(action)) {
    const recent = d.audit.find(
      (a) => a.staff_id === user.staff_id && a.action === action && a.incident_id === incident_id && Date.now() - new Date(a.timestamp).getTime() < 5000,
    );
    if (recent) return; // collapse rapid re-renders / refreshes into one access entry
  }
  d.audit.unshift({
    audit_id: uid('AUD'),
    timestamp: nowIso(),
    incident_id,
    staff_id: user.staff_id,
    staff_name: user.name,
    staff_role: user.role,
    action,
    from_status: extra.from_status ?? null,
    to_status: extra.to_status ?? null,
    details: extra.details ?? '',
  });
  save();
}

function findIncident(id) {
  const rec = db().incidents.find((i) => i.incident_id === id);
  if (!rec) throw new ApiError('NOT_FOUND', 'The requested incident was not found.', { status: 404 });
  return rec;
}

function etaMinutes(rec) {
  const at = rec.ambulance?.eta_at;
  if (!at || HAS_ARRIVED.includes(rec.status)) return null;
  return Math.max(0, Math.ceil((new Date(at).getTime() - Date.now()) / 60000));
}

function addEvent(rec, type, extra = {}) {
  const e = { event_id: uid('EVT'), type, timestamp: nowIso(), ...extra };
  rec.timeline.push(e);
  rec.updated_at = e.timestamp;
}

// ---------- shaping (role-based minimisation happens HERE, as the real backend must do) ----------
function listItem(rec, role) {
  const restricted = role === 'ADMIN'; // administrators monitor operations, not clinical content
  return {
    incident_id: rec.incident_id,
    is_demo: true,
    status: rec.status,
    severity: rec.severity,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    access: { level: restricted ? 'MONITOR_ONLY' : 'CLINICAL' },
    location: { ...rec.location },
    patient: restricted
      ? { patient_id: null, name: null, age: null, identity_status: rec.patient.identity_status }
      : { patient_id: rec.patient.patient_id, name: rec.patient.name, age: rec.patient.age, identity_status: rec.patient.identity_status },
    medical_summary:
      restricted || !rec.medical_profile
        ? null
        : {
            blood_group: rec.medical_profile.blood_group,
            blood_group_verified: rec.medical_profile.blood_group_verified,
            allergies: rec.medical_profile.allergies,
            conditions: rec.medical_profile.conditions,
          },
    ambulance: rec.ambulance ? { ambulance_id: rec.ambulance.ambulance_id, status: rec.ambulance.status, eta_minutes: etaMinutes(rec) } : null,
  };
}

// ---------- the backend interface ----------
export const mockBackend = {
  mode: 'DEMO',

  async login(identifier, password) {
    await gate();
    const id = String(identifier || '').trim().toLowerCase();
    const user = DEMO_USERS.find((u) => u.staff_id.toLowerCase() === id || u.email.toLowerCase() === id);
    if (!user || user.password !== password) {
      throw new ApiError('INVALID_CREDENTIALS', 'Invalid Staff ID/email or password.', { status: 401 });
    }
    const token = `demo.${user.staff_id}.${uid('t')}`;
    const s = sessions();
    s[token] = { staff_id: user.staff_id, expiresAt: Date.now() + TOKEN_TTL_MS, revoked: false };
    saveSessions(s);
    log(user, 'LOGIN', { details: 'Signed in (demo)' });
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: TOKEN_TTL_MS / 1000,
      user: { staff_id: user.staff_id, name: user.name, email: user.email, role: user.role },
    };
  },

  async logout() {
    await gate();
    const token = getToken();
    const s = sessions();
    if (token && s[token]) {
      const user = DEMO_USERS.find((u) => u.staff_id === s[token].staff_id);
      s[token].revoked = true; // token revocation
      saveSessions(s);
      if (user) log(user, 'LOGOUT', { details: 'Signed out (demo)' });
    }
    return { ok: true };
  },

  async listIncidents() {
    await gate();
    const user = authorize('incidents.view');
    return db().incidents.map((r) => listItem(r, user.role));
  },

  async getProfile(id) {
    await gate();
    const user = authorize('profile.view', id);
    const rec = findIncident(id);
    const limited = user.role !== 'ER_DOCTOR';
    const restricted = limited ? ['emergency_contacts.phone', 'medical_profile.donor_preference'] : [];
    log(user, 'PROFILE_VIEWED', { incident_id: id, details: `Emergency profile released at ${limited ? 'LIMITED' : 'FULL'} level` });
    return {
      incident_id: rec.incident_id,
      is_demo: true,
      access: { level: limited ? 'LIMITED' : 'FULL', restricted_fields: restricted },
      patient: { user_id: rec.patient.patient_id, name: rec.patient.name, age: rec.patient.age, gender: rec.patient.gender, identity_status: rec.patient.identity_status, photo_url: null },
      medical_profile: rec.medical_profile ? { ...clone(rec.medical_profile), donor_preference: limited ? null : rec.medical_profile.donor_preference } : null,
      incident: { accident_time: rec.accident_time, address: rec.location.address, latitude: rec.location.latitude, longitude: rec.location.longitude, status: rec.status, severity: rec.severity },
      ambulance: rec.ambulance ? { ambulance_id: rec.ambulance.ambulance_id, status: rec.ambulance.status, eta_minutes: etaMinutes(rec) } : null,
      emergency_contacts: rec.emergency_contacts.map((c) => ({ ...c, phone: limited ? null : c.phone })),
    };
  },

  async getTracking(id) {
    await gate();
    const user = authorize('tracking.view', id);
    const rec = findIncident(id);
    log(user, 'TRACKING_VIEWED', { incident_id: id });
    const amb = rec.ambulance;
    return {
      incident_id: id,
      is_demo: true,
      ambulance: amb ? { ambulance_id: amb.ambulance_id, status: amb.status, location: amb.location ? { latitude: amb.location.latitude, longitude: amb.location.longitude, updated_at: amb.location.updated_at, source: amb.location.source } : null } : null,
      hospital: { name: config.hospital.name, latitude: config.hospital.latitude, longitude: config.hospital.longitude },
      incident_location: { address: rec.location.address, latitude: rec.location.latitude, longitude: rec.location.longitude },
      eta_minutes: etaMinutes(rec),
      incident_status: rec.status,
    };
  },

  async updateStatus(id, { status, notes } = {}) {
    await gate();
    const user = authorize('status.update', id);
    const rec = findIncident(id);
    const from = rec.status;
    if (!isValidTransition(from, status)) {
      throw new ApiError('INVALID_TRANSITION', `Invalid status change: ${statusLabel(from)} → ${statusLabel(status)} is not part of the workflow.`, { status: 409, code: 'INVALID_TRANSITION' });
    }
    if (!allowedTransitions(from, user.role).includes(status)) {
      log(user, 'ACCESS_DENIED', { incident_id: id, details: `Role ${user.role} attempted ${from} -> ${status}` });
      throw new ApiError('FORBIDDEN', `Your role (${roleLabel(user.role)}) may not change status from ${statusLabel(from)} to ${statusLabel(status)}.`, { status: 403 });
    }
    if (status === 'OTHER_OUTCOME' && !String(notes || '').trim()) {
      throw new ApiError('VALIDATION', 'Notes are required when recording an other outcome.', { status: 422 });
    }
    rec.status = status;
    if (rec.ambulance && status === 'ARRIVED') {
      rec.ambulance.status = 'ARRIVED';
      rec.ambulance.eta_at = null;
    }
    addEvent(rec, 'STATUS_CHANGED', { from_status: from, to_status: status, notes: notes || '', staff_id: user.staff_id, staff_name: user.name, staff_role: user.role });
    log(user, 'STATUS_CHANGED', { incident_id: id, from_status: from, to_status: status, details: notes || '' });
    if (status === 'CLOSED') log(user, 'RECORD_CLOSED', { incident_id: id, from_status: from, to_status: status, details: 'Patient record closed' });
    save();
    return listItem(rec, user.role);
  },

  async addMedicalNote(id, payload = {}) {
    await gate();
    const kind = payload.kind;
    const perm = { PARAMEDIC_HANDOFF: 'handoff.submit_paramedic', DOCTOR_ASSESSMENT: 'handoff.submit_doctor', HANDOFF_ACCEPTANCE: 'handoff.accept', TREATMENT_NOTE: 'notes.add' }[kind];
    if (!perm) throw new ApiError('VALIDATION', 'Unknown note type.', { status: 422 });
    const user = authorize(perm, id);
    const rec = findIncident(id);
    const d = db();

    // Idempotency: a retried request (same key) returns the original note instead of duplicating it.
    const existing = d.notes.find((n) => n.client_request_id && n.client_request_id === payload.client_request_id);
    if (existing) return clone(existing);

    if (!HAS_ARRIVED.includes(rec.status)) {
      throw new ApiError('CONFLICT', 'The patient has not arrived yet. Handoff notes can be recorded once the status is Arrived.', { status: 409, code: 'NOT_ARRIVED' });
    }
    if (rec.status === 'CLOSED') {
      throw new ApiError('CONFLICT', 'This incident is closed. Notes can no longer be added.', { status: 409, code: 'CLOSED' });
    }
    if (kind === 'HANDOFF_ACCEPTANCE') {
      if (!d.notes.some((n) => n.incident_id === id && n.kind === 'PARAMEDIC_HANDOFF')) {
        throw new ApiError('CONFLICT', 'A paramedic handoff must be recorded before the patient can be accepted.', { status: 409, code: 'HANDOFF_REQUIRED' });
      }
      if (d.notes.some((n) => n.incident_id === id && n.kind === 'HANDOFF_ACCEPTANCE')) {
        throw new ApiError('DUPLICATE', 'This handoff has already been accepted.', { status: 409, code: 'DUPLICATE_NOTE' });
      }
    }
    const fingerprint = JSON.stringify(payload.fields || {}, Object.keys(payload.fields || {}).sort());
    const dup = d.notes.find((n) => n.incident_id === id && n.kind === kind && n.staff_id === user.staff_id && JSON.stringify(n.fields, Object.keys(n.fields).sort()) === fingerprint);
    if (dup) throw new ApiError('DUPLICATE', 'An identical note was already saved for this incident.', { status: 409, code: 'DUPLICATE_NOTE' });

    // staff identity & timestamp always come from the authenticated token, never from the client
    const note = {
      note_id: uid('NOTE'), incident_id: id, kind, fields: clone(payload.fields || {}),
      staff_id: user.staff_id, staff_name: user.name, staff_role: user.role,
      recorded_at: nowIso(), client_request_id: payload.client_request_id || null,
    };
    d.notes.push(note);
    const evType = { PARAMEDIC_HANDOFF: 'HANDOFF_SUBMITTED', DOCTOR_ASSESSMENT: 'DOCTOR_ASSESSMENT_SAVED', HANDOFF_ACCEPTANCE: 'HANDOFF_ACCEPTED', TREATMENT_NOTE: 'NOTE_ADDED' }[kind];
    addEvent(rec, evType, { staff_id: user.staff_id, staff_name: user.name, staff_role: user.role });
    log(user, { PARAMEDIC_HANDOFF: 'HANDOFF_SUBMITTED', DOCTOR_ASSESSMENT: 'HANDOFF_SUBMITTED', HANDOFF_ACCEPTANCE: 'HANDOFF_ACCEPTED', TREATMENT_NOTE: 'NOTE_ADDED' }[kind], { incident_id: id, details: kind });
    save();
    return clone(note);
  },

  async listMedicalNotes(id) {
    await gate();
    const user = authorize('handoff.view', id);
    findIncident(id);
    log(user, 'NOTES_VIEWED', { incident_id: id });
    return clone(db().notes.filter((n) => n.incident_id === id).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)));
  },

  async getTimeline(id) {
    await gate();
    authorize('timeline.view', id);
    const rec = findIncident(id);
    return clone([...rec.timeline].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
  },

  async getBloodBank(id) {
    await gate();
    const user = authorize('bloodbank.view', id);
    const rec = findIncident(id);
    log(user, 'BLOODBANK_VIEWED', { incident_id: id });
    const mp = rec.medical_profile;
    return {
      incident_id: id,
      is_demo: true,
      source: 'DEMO_SYNTHETIC_BLOOD_BANK',
      patient_blood_group: mp?.blood_group ?? null,
      blood_group_verified: !!mp?.blood_group_verified,
      availability: rec.bloodbank.availability,
      preparation: rec.bloodbank.preparation,
      inventory: Object.entries(BLOOD_INVENTORY).map(([group, units]) => ({ group, units })),
      updated_at: nowIso(),
    };
  },

  async listAudit(params = {}) {
    await gate();
    authorize('audit.view');
    let rows = db().audit;
    if (params.incident_id) rows = rows.filter((a) => a.incident_id === params.incident_id);
    if (params.action) rows = rows.filter((a) => a.action === params.action);
    return clone(rows.slice(0, Number(params.limit) || 500));
  },

  async getPhotoUrl() {
    return null; // demo data deliberately contains no images
  },
};
