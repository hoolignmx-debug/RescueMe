// End-to-end workflow tests at the service layer (UI -> services -> DEMO backend).
// Run with:  npm test   (Node 20+, no extra packages needed)

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { mockBackend, demoControls, setMockLatency } from '../src/services/backends/mock/mockBackend.js';
import { setToken } from '../src/services/session.js';
import * as auth from '../src/services/authService.js';
import * as incidents from '../src/services/incidentService.js';
import * as hospital from '../src/services/hospitalService.js';
import { normalizeIncident } from '../src/services/normalize.js';

setMockLatency(0);

const DOCTOR = ['DOC-001', 'Demo-Doctor-1'];
const PARAMEDIC = ['PARA-001', 'Demo-Paramedic-1'];
const ADMIN = ['ADM-001', 'Demo-Admin-1'];

async function signIn([id, pw]) {
  const s = await auth.login(id, pw);
  setToken(s.token);
  return s;
}
const rejects = (promise, kind) =>
  assert.rejects(promise, (e) => {
    assert.equal(e.kind, kind, `expected ${kind}, got ${e.kind}: ${e.message}`);
    return true;
  });

const paramedicFields = () => ({
  arrival_time: new Date().toISOString(),
  initial_condition: 'Conscious, anxious (demo)',
  consciousness: 'ALERT',
  breathing: 'NORMAL',
  visible_injuries: 'Abrasions on left arm (demo)',
  initial_observations: 'Stable on arrival (demo)',
  treatment_provided: 'Dressing applied',
  medication_administered: 'None known',
  additional_notes: '',
});

beforeEach(() => {
  demoControls.reset();
  setToken(null);
});

test('full ER workflow: login -> profile -> tracking -> arrival -> handoff -> treatment -> close -> audit', async () => {
  // 1-3. staff logs in, an incoming patient is visible
  const doctor = await signIn(DOCTOR);
  assert.equal(doctor.user.role, 'ER_DOCTOR');
  const list = await incidents.listIncidents();
  const inc = list.find((i) => i.id === 'INC-2026-0001');
  assert.ok(inc, 'incoming patient appears');
  assert.equal(inc.status, 'EN_ROUTE');

  // 4-5. profile + medical information
  const profile = await incidents.getProfile(inc.id);
  assert.equal(profile.patient.name, 'Rohan Mehta');
  assert.deepEqual(profile.medical.allergies, ['Penicillin']);
  assert.deepEqual(profile.medical.conditions, ['Asthma']);
  assert.equal(profile.medical.bloodGroup, 'O+');
  assert.equal(profile.medical.bloodGroupVerified, false, 'blood group must not be shown as verified');
  assert.equal(profile.contacts[0].phone !== null, true, 'doctor may see contact phone');

  // 6. ambulance ETA
  const tracking = await incidents.getTracking(inc.id);
  assert.equal(typeof tracking.etaMinutes, 'number');
  assert.equal(tracking.ambulance.location.source, 'DEMO_SIMULATED');

  // 7-9. paramedic records arrival and moves patient into ER
  await signIn(PARAMEDIC);
  let cur = await incidents.getIncident(inc.id);
  cur = await incidents.updateStatus(cur, 'ARRIVED', 'Arrived at bay 2');
  assert.equal(cur.status, 'ARRIVED');
  cur = await incidents.updateStatus(cur, 'IN_ER');
  assert.equal(cur.status, 'IN_ER');

  // 10. paramedic submits handoff
  const note = await incidents.addMedicalNote(inc.id, 'PARAMEDIC_HANDOFF', paramedicFields(), 'req-1');
  assert.equal(note.staff_id, 'PARA-001', 'staff id comes from the token');
  assert.ok(note.recorded_at);

  // 11-12. doctor accepts handoff and adds notes
  await signIn(DOCTOR);
  await incidents.addMedicalNote(inc.id, 'DOCTOR_ASSESSMENT', {
    doctor_id: 'DOC-001', doctor_name: 'Dr. Meera Iyer (demo)', accepted_at: new Date().toISOString(),
    initial_assessment: 'Airway clear (demo)', treatment_notes: 'Plan discussed (demo)',
  }, 'req-2');
  await incidents.addMedicalNote(inc.id, 'HANDOFF_ACCEPTANCE', {
    doctor_id: 'DOC-001', doctor_name: 'Dr. Meera Iyer (demo)', accepted_at: new Date().toISOString(), initial_assessment: 'Airway clear (demo)',
  }, 'req-3');
  await incidents.addMedicalNote(inc.id, 'TREATMENT_NOTE', { text: 'Observation continuing (demo)' }, 'req-4');
  const notes = await incidents.listMedicalNotes(inc.id);
  assert.equal(notes.length, 4);

  // 13-15. UNDER_TREATMENT -> STABLE -> CLOSED
  cur = await incidents.getIncident(inc.id);
  cur = await incidents.updateStatus(cur, 'UNDER_TREATMENT');
  cur = await incidents.updateStatus(cur, 'STABLE', 'Vitals stable');
  cur = await incidents.updateStatus(cur, 'CLOSED');
  assert.equal(cur.status, 'CLOSED');

  // timeline carries real backend timestamps, in order
  const timeline = await incidents.getTimeline(inc.id);
  const types = timeline.map((e) => e.toStatus || e.type);
  for (const expected of ['ARRIVED', 'IN_ER', 'HANDOFF_SUBMITTED', 'HANDOFF_ACCEPTED', 'UNDER_TREATMENT', 'STABLE', 'CLOSED']) {
    assert.ok(types.includes(expected), `timeline contains ${expected}`);
  }
  const times = timeline.map((e) => new Date(e.timestamp).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));

  // 16. audit history shows the relevant actions (admin only)
  await signIn(ADMIN);
  const audit = await hospital.listAudit({ incident_id: inc.id });
  const actions = new Set(audit.map((a) => a.action));
  for (const a of ['PROFILE_VIEWED', 'TRACKING_VIEWED', 'STATUS_CHANGED', 'HANDOFF_SUBMITTED', 'HANDOFF_ACCEPTED', 'NOTE_ADDED', 'RECORD_CLOSED']) {
    assert.ok(actions.has(a), `audit contains ${a}`);
  }
  const closed = audit.find((a) => a.action === 'STATUS_CHANGED' && a.toStatus === 'CLOSED');
  assert.equal(closed.fromStatus, 'STABLE');
  assert.equal(closed.staffId, 'DOC-001');
});

test('unauthorized access: no token, wrong role, admin gets no clinical data', async () => {
  await rejects(incidents.listIncidents(), 'UNAUTHENTICATED');

  await signIn(PARAMEDIC);
  await rejects(hospital.listAudit(), 'FORBIDDEN');
  await rejects(hospital.getBloodBank('INC-2026-0001'), 'FORBIDDEN');
  const p = await incidents.getProfile('INC-2026-0001');
  assert.equal(p.access.level, 'LIMITED');
  assert.equal(p.contacts[0].phone, null, 'paramedic must not receive contact phone');
  assert.equal(p.medical.donorPreference, null);

  await signIn(ADMIN);
  await rejects(incidents.getProfile('INC-2026-0001'), 'FORBIDDEN');
  const list = await incidents.listIncidents();
  assert.ok(list.every((i) => i.restricted && i.allergies === null && i.patientName === null));
  const current = list.find((i) => i.status === 'EN_ROUTE');
  await rejects(incidents.updateStatus({ ...current, status: 'EN_ROUTE' }, 'ARRIVED'), 'FORBIDDEN');

  // denied attempts are audited
  const audit = await hospital.listAudit({ action: 'ACCESS_DENIED' });
  assert.ok(audit.length >= 3);
});

test('expired and revoked tokens are rejected', async () => {
  await signIn(DOCTOR);
  await incidents.listIncidents();
  demoControls.expireCurrentSession();
  await rejects(incidents.listIncidents(), 'UNAUTHENTICATED');

  const s = await signIn(DOCTOR);
  await incidents.listIncidents();
  await auth.logout(); // revokes
  setToken(s.token);
  await rejects(incidents.listIncidents(), 'UNAUTHENTICATED');
});

test('invalid login is rejected and malformed responses are never treated as success', async () => {
  await assert.rejects(auth.login('DOC-001', 'wrong'), (e) => e.kind === 'INVALID_CREDENTIALS');
  await assert.rejects(auth.login('nobody', 'x'), (e) => e.kind === 'INVALID_CREDENTIALS');
});

test('invalid status transitions are blocked client-side and server-side', async () => {
  await signIn(DOCTOR);
  const arrived = await incidents.getIncident('INC-2026-0002'); // ARRIVED
  await rejects(incidents.updateStatus(arrived, 'CLOSED'), 'INVALID_TRANSITION');
  await rejects(incidents.updateStatus(arrived, 'STABLE'), 'INVALID_TRANSITION');
  // bypass the client guard: the backend must refuse too
  await rejects(mockBackend.updateStatus('INC-2026-0002', { status: 'CLOSED' }), 'INVALID_TRANSITION');
  // OTHER_OUTCOME needs notes
  const treating = await incidents.getIncident('INC-2026-0005');
  await rejects(incidents.updateStatus(treating, 'OTHER_OUTCOME', ''), 'VALIDATION');
  // paramedics cannot move a patient into treatment or close records
  await signIn(PARAMEDIC);
  const inEr = await incidents.getIncident('INC-2026-0004');
  await rejects(incidents.updateStatus(inEr, 'UNDER_TREATMENT'), 'FORBIDDEN');
});

test('medical notes: required order, duplicate protection, idempotent retries', async () => {
  await signIn(PARAMEDIC);
  // patient has not arrived yet
  await rejects(incidents.addMedicalNote('INC-2026-0001', 'PARAMEDIC_HANDOFF', paramedicFields(), 'a1'), 'CONFLICT');

  const fields = paramedicFields();
  const first = await incidents.addMedicalNote('INC-2026-0002', 'PARAMEDIC_HANDOFF', fields, 'k1');
  // a network-retry with the same request id returns the SAME note, no duplicate
  const retry = await incidents.addMedicalNote('INC-2026-0002', 'PARAMEDIC_HANDOFF', fields, 'k1');
  assert.equal(retry.note_id, first.note_id);
  // the same content under a new request id is rejected as a duplicate
  await rejects(incidents.addMedicalNote('INC-2026-0002', 'PARAMEDIC_HANDOFF', fields, 'k2'), 'DUPLICATE');

  // doctor cannot accept before a handoff exists
  await signIn(DOCTOR);
  const acc = { doctor_id: 'DOC-001', doctor_name: 'x', accepted_at: new Date().toISOString(), initial_assessment: 'y' };
  await rejects(incidents.addMedicalNote('INC-2026-0004', 'HANDOFF_ACCEPTANCE', acc, 'b1'), 'CONFLICT');
  await incidents.addMedicalNote('INC-2026-0002', 'HANDOFF_ACCEPTANCE', acc, 'b2');
  await rejects(incidents.addMedicalNote('INC-2026-0002', 'HANDOFF_ACCEPTANCE', { ...acc, initial_assessment: 'z' }, 'b3'), 'DUPLICATE');

  // roles: a paramedic cannot accept; a doctor cannot submit the paramedic section
  await signIn(PARAMEDIC);
  await rejects(incidents.addMedicalNote('INC-2026-0005', 'HANDOFF_ACCEPTANCE', acc, 'c1'), 'FORBIDDEN');
  await signIn(DOCTOR);
  await rejects(incidents.addMedicalNote('INC-2026-0005', 'PARAMEDIC_HANDOFF', paramedicFields(), 'c2'), 'FORBIDDEN');
});

test('missing / unverified data is shown as unavailable, never invented', async () => {
  await signIn(DOCTOR);
  const list = await incidents.listIncidents();
  const p3 = list.find((i) => i.id === 'INC-2026-0003');
  assert.equal(p3.identityVerified, false);
  assert.equal(p3.patientName, null);
  assert.equal(p3.bloodGroup, null);
  assert.equal(p3.allergies, null, 'unknown allergies must be null, not an empty "none"');
  assert.equal(p3.etaMinutes, null);
  assert.equal(p3.medicalConfirmed, false);

  const tracking = await incidents.getTracking('INC-2026-0003');
  assert.equal(tracking.ambulance.location, null, 'no ambulance location available');
  assert.equal(tracking.etaMinutes, null, 'no ETA available');

  const bb = await hospital.getBloodBank('INC-2026-0003');
  assert.equal(bb.bloodGroup, null);
  assert.equal(bb.verified, false);

  // a verified patient with "no known allergies" is an empty list, distinct from unknown
  const p2 = list.find((i) => i.id === 'INC-2026-0002');
  assert.deepEqual(p2.allergies, []);

  // an unverified identity is never assumed confirmed, even if the backend sends a name
  const leaked = normalizeIncident({
    incident_id: 'X', status: 'EN_ROUTE', patient: { name: 'Should Not Show', age: 40, identity_status: 'PENDING_REVIEW' },
    medical_summary: { blood_group: 'O+', blood_group_verified: true, allergies: ['Latex'], conditions: [] },
  });
  assert.equal(leaked.patientName, null);
  assert.equal(leaked.bloodGroup, null);
  assert.equal(leaked.allergies, null);

  // garbage in -> safe defaults out
  const empty = normalizeIncident({});
  assert.equal(empty.status, 'UNKNOWN');
  assert.equal(empty.etaMinutes, null);
});

test('backend outage surfaces as a NETWORK error (no fabricated success)', async () => {
  await signIn(DOCTOR);
  demoControls.setOutage(true);
  await rejects(incidents.listIncidents(), 'NETWORK');
  await rejects(incidents.addMedicalNote('INC-2026-0002', 'TREATMENT_NOTE', { text: 'x' }, 'o1'), 'NETWORK');
  demoControls.setOutage(false);
  const list = await incidents.listIncidents();
  assert.equal(list.length, 5);
});

test('demo seed contains the five required scenarios', async () => {
  await signIn(DOCTOR);
  const byId = Object.fromEntries((await incidents.listIncidents()).map((i) => [i.id, i]));
  assert.equal(Object.keys(byId).length, 5);
  assert.ok(Object.values(byId).every((i) => i.isDemo));
  assert.equal(byId['INC-2026-0001'].status, 'EN_ROUTE');
  assert.equal(byId['INC-2026-0001'].bloodGroup, 'O+');
  assert.equal(byId['INC-2026-0002'].status, 'ARRIVED');
  assert.deepEqual(byId['INC-2026-0002'].conditions, ['Type 2 diabetes']);
  assert.equal(byId['INC-2026-0003'].status, 'AMBULANCE_ASSIGNED');
  assert.equal(byId['INC-2026-0004'].status, 'IN_ER');
  assert.equal(byId['INC-2026-0004'].bloodGroup, 'AB+');
  const p4 = await incidents.getProfile('INC-2026-0004');
  assert.deepEqual(p4.medical.implants, ['Cardiac pacemaker']);
  assert.equal(byId['INC-2026-0005'].status, 'UNDER_TREATMENT');
  assert.equal(byId['INC-2026-0005'].bloodGroup, 'A+');
});
