// ============================================================================
//  DEMO DATA - 100% SYNTHETIC. No real people, no real medical records.
//  Names, phone numbers, places and coordinates are invented for the college
//  prototype. Never replace these with real patient information.
// ============================================================================

import { config } from '../../../config.js';

export const DEMO_USERS = [
  { staff_id: 'DOC-001', email: 'doctor@demo.test', password: 'Demo-Doctor-1', name: 'Dr. Meera Iyer (demo)', role: 'ER_DOCTOR' },
  { staff_id: 'PARA-001', email: 'paramedic@demo.test', password: 'Demo-Paramedic-1', name: 'Arjun Singh (demo)', role: 'PARAMEDIC' },
  { staff_id: 'ADM-001', email: 'admin@demo.test', password: 'Demo-Admin-1', name: 'Kavita Joshi (demo)', role: 'ADMIN' },
];

export const BLOOD_INVENTORY = { 'A+': 12, 'A-': 3, 'B+': 9, 'B-': 2, 'AB+': 2, 'AB-': 0, 'O+': 15, 'O-': 4 };

const min = (n) => n * 60000;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const evt = (incident, type, at, extra = {}) => ({
  event_id: `EVT-${incident}-${++seq}`,
  type,
  timestamp: iso(at),
  ...extra,
});

function incident(now, def) {
  const t0 = now - min(def.startedMinAgo);
  const events = def.events.map(([type, offsetMin, extra]) => evt(def.incident_id, type, t0 + min(offsetMin), extra));
  return {
    incident_id: def.incident_id,
    is_demo: true,
    status: def.status,
    severity: def.severity,
    created_at: iso(t0),
    updated_at: events[events.length - 1].timestamp,
    accident_time: iso(t0 - min(2)),
    location: def.location,
    patient: def.patient,
    medical_profile: def.medical_profile,
    emergency_contacts: def.contacts || [],
    ambulance: def.ambulance,
    bloodbank: def.bloodbank,
    timeline: events,
  };
}

const H = config.hospital;
const STAFF = { staff_id: 'DOC-001', staff_name: 'Dr. Meera Iyer (demo)', staff_role: 'ER_DOCTOR' };
const PARA = { staff_id: 'PARA-001', staff_name: 'Arjun Singh (demo)', staff_role: 'PARAMEDIC' };

export function buildSeed(now = Date.now()) {
  const incidents = [
    // 1 - verified, O+ (blood group NOT yet verified), penicillin allergy, asthma, ambulance en route
    incident(now, {
      incident_id: 'INC-2026-0001',
      status: 'EN_ROUTE',
      severity: 'HIGH',
      startedMinAgo: 14,
      location: { address: 'NH-19 service road near Sector 15 (demo location)', latitude: 28.431, longitude: 77.312 },
      patient: { patient_id: 'USER-101', name: 'Rohan Mehta', age: 28, gender: 'Male', identity_status: 'VERIFIED' },
      medical_profile: {
        blood_group: 'O+', blood_group_verified: false, allergies: ['Penicillin'], conditions: ['Asthma'],
        implants: [], medications: ['Salbutamol inhaler (as needed)'], donor_preference: 'UNKNOWN',
      },
      contacts: [{ name: 'Sunita Mehta', relationship: 'Mother', phone: '+91 00000 00101' }],
      ambulance: {
        ambulance_id: 'AMB-001', status: 'EN_ROUTE', eta_at: iso(now + min(8)),
        location: { latitude: 28.4215, longitude: 77.3152, updated_at: iso(now - min(1)), source: 'DEMO_SIMULATED' },
      },
      bloodbank: { availability: 'CHECKING', preparation: 'NOT_STARTED' },
      events: [
        ['INCIDENT_RECEIVED', 0], ['IDENTITY_VERIFIED', 1], ['EMS_NOTIFIED', 2], ['AMBULANCE_ASSIGNED', 3],
        ['STATUS_CHANGED', 5, { from_status: 'AMBULANCE_ASSIGNED', to_status: 'EN_ROUTE' }],
      ],
    }),
    // 2 - verified, B+, no known allergies, diabetes, arrived
    incident(now, {
      incident_id: 'INC-2026-0002',
      status: 'ARRIVED',
      severity: 'MEDIUM',
      startedMinAgo: 38,
      location: { address: 'Sector 21 market crossing (demo location)', latitude: 28.418, longitude: 77.301 },
      patient: { patient_id: 'USER-102', name: 'Anita Rao', age: 54, gender: 'Female', identity_status: 'VERIFIED' },
      medical_profile: {
        blood_group: 'B+', blood_group_verified: true, allergies: [], conditions: ['Type 2 diabetes'],
        implants: [], medications: ['Metformin'], donor_preference: 'YES',
      },
      contacts: [{ name: 'Vikram Rao', relationship: 'Spouse', phone: '+91 00000 00102' }],
      ambulance: { ambulance_id: 'AMB-002', status: 'ARRIVED', eta_at: null, location: { latitude: H.latitude, longitude: H.longitude, updated_at: iso(now - min(4)), source: 'DEMO_SIMULATED' } },
      bloodbank: { availability: 'AVAILABLE', preparation: 'NOT_STARTED' },
      events: [
        ['INCIDENT_RECEIVED', 0], ['IDENTITY_VERIFIED', 1], ['EMS_NOTIFIED', 2], ['AMBULANCE_ASSIGNED', 4],
        ['STATUS_CHANGED', 6, { from_status: 'AMBULANCE_ASSIGNED', to_status: 'EN_ROUTE' }],
        ['STATUS_CHANGED', 34, { from_status: 'EN_ROUTE', to_status: 'ARRIVED', ...PARA }],
      ],
    }),
    // 3 - identity pending, blood group unknown, no confirmed profile, ambulance assigned (no GPS, no ETA yet)
    incident(now, {
      incident_id: 'INC-2026-0003',
      status: 'AMBULANCE_ASSIGNED',
      severity: 'CRITICAL',
      startedMinAgo: 6,
      location: { address: 'Mathura Road flyover (demo location)', latitude: 28.395, longitude: 77.33 },
      patient: { patient_id: null, name: null, age: null, gender: null, identity_status: 'PENDING_REVIEW' },
      medical_profile: null,
      contacts: [],
      ambulance: { ambulance_id: 'AMB-003', status: 'ASSIGNED', eta_at: null, location: null },
      bloodbank: { availability: 'UNKNOWN', preparation: 'NOT_STARTED' },
      events: [
        ['INCIDENT_RECEIVED', 0], ['IDENTITY_PENDING', 1], ['EMS_NOTIFIED', 2], ['AMBULANCE_ASSIGNED', 4],
      ],
    }),
    // 4 - verified, AB+, pacemaker, in ER
    incident(now, {
      incident_id: 'INC-2026-0004',
      status: 'IN_ER',
      severity: 'CRITICAL',
      startedMinAgo: 55,
      location: { address: 'Badkhal road junction (demo location)', latitude: 28.44, longitude: 77.3 },
      patient: { patient_id: 'USER-104', name: 'Imran Qureshi', age: 67, gender: 'Male', identity_status: 'VERIFIED' },
      medical_profile: {
        blood_group: 'AB+', blood_group_verified: true, allergies: [], conditions: ['Hypertension'],
        implants: ['Cardiac pacemaker'], medications: [], donor_preference: 'UNKNOWN',
      },
      contacts: [{ name: 'Zara Qureshi', relationship: 'Daughter', phone: '+91 00000 00104' }],
      ambulance: { ambulance_id: 'AMB-004', status: 'ARRIVED', eta_at: null, location: { latitude: H.latitude, longitude: H.longitude, updated_at: iso(now - min(12)), source: 'DEMO_SIMULATED' } },
      bloodbank: { availability: 'LOW', preparation: 'IN_PROGRESS' },
      events: [
        ['INCIDENT_RECEIVED', 0], ['IDENTITY_VERIFIED', 1], ['EMS_NOTIFIED', 2], ['AMBULANCE_ASSIGNED', 3],
        ['STATUS_CHANGED', 5, { from_status: 'AMBULANCE_ASSIGNED', to_status: 'EN_ROUTE' }],
        ['STATUS_CHANGED', 42, { from_status: 'EN_ROUTE', to_status: 'ARRIVED', ...PARA }],
        ['STATUS_CHANGED', 45, { from_status: 'ARRIVED', to_status: 'IN_ER', ...PARA }],
      ],
    }),
    // 5 - verified, A+, no known allergies, under treatment (handoff already recorded)
    incident(now, {
      incident_id: 'INC-2026-0005',
      status: 'UNDER_TREATMENT',
      severity: 'HIGH',
      startedMinAgo: 96,
      location: { address: 'Sector 37 bypass (demo location)', latitude: 28.38, longitude: 77.34 },
      patient: { patient_id: 'USER-105', name: 'Priya Nair', age: 41, gender: 'Female', identity_status: 'VERIFIED' },
      medical_profile: {
        blood_group: 'A+', blood_group_verified: true, allergies: [], conditions: [],
        implants: [], medications: [], donor_preference: 'UNKNOWN',
      },
      contacts: [{ name: 'Rahul Nair', relationship: 'Brother', phone: '+91 00000 00105' }],
      ambulance: { ambulance_id: 'AMB-005', status: 'ARRIVED', eta_at: null, location: { latitude: H.latitude, longitude: H.longitude, updated_at: iso(now - min(60)), source: 'DEMO_SIMULATED' } },
      bloodbank: { availability: 'AVAILABLE', preparation: 'NOT_STARTED' },
      events: [
        ['INCIDENT_RECEIVED', 0], ['IDENTITY_VERIFIED', 1], ['EMS_NOTIFIED', 2], ['AMBULANCE_ASSIGNED', 3],
        ['STATUS_CHANGED', 5, { from_status: 'AMBULANCE_ASSIGNED', to_status: 'EN_ROUTE' }],
        ['STATUS_CHANGED', 20, { from_status: 'EN_ROUTE', to_status: 'ARRIVED', ...PARA }],
        ['STATUS_CHANGED', 22, { from_status: 'ARRIVED', to_status: 'IN_ER', ...PARA }],
        ['HANDOFF_SUBMITTED', 27, PARA],
        ['HANDOFF_ACCEPTED', 30, STAFF],
        ['STATUS_CHANGED', 36, { from_status: 'IN_ER', to_status: 'UNDER_TREATMENT', ...STAFF }],
      ],
    }),
  ];

  const t5 = now - min(96);
  const notes = [
    {
      note_id: 'NOTE-DEMO-1', incident_id: 'INC-2026-0005', kind: 'PARAMEDIC_HANDOFF', ...PARA,
      recorded_at: iso(t5 + min(27)), client_request_id: 'seed-1',
      fields: {
        arrival_time: iso(t5 + min(20)), initial_condition: 'Conscious, complaining of chest wall pain after collision (demo record).',
        consciousness: 'ALERT', breathing: 'NORMAL', visible_injuries: 'Bruising across left chest (demo).',
        initial_observations: 'Vitals recorded on scene; no external bleeding (demo).', treatment_provided: 'Oxygen via mask (demo).',
        medication_administered: 'None known', additional_notes: '',
      },
    },
    {
      note_id: 'NOTE-DEMO-2', incident_id: 'INC-2026-0005', kind: 'HANDOFF_ACCEPTANCE', ...STAFF,
      recorded_at: iso(t5 + min(30)), client_request_id: 'seed-2',
      fields: { doctor_id: 'DOC-001', doctor_name: 'Dr. Meera Iyer (demo)', accepted_at: iso(t5 + min(30)), initial_assessment: 'Handoff received; imaging requested (demo).' },
    },
  ];

  const audit = [
    { audit_id: 'AUD-DEMO-1', timestamp: iso(t5 + min(30)), incident_id: 'INC-2026-0005', ...STAFF, action: 'HANDOFF_ACCEPTED', from_status: null, to_status: null, details: 'Seeded demo event' },
    { audit_id: 'AUD-DEMO-2', timestamp: iso(t5 + min(36)), incident_id: 'INC-2026-0005', ...STAFF, action: 'STATUS_CHANGED', from_status: 'IN_ER', to_status: 'UNDER_TREATMENT', details: 'Seeded demo event' },
  ];

  return { version: 1, seededAt: iso(now), incidents, notes, audit };
}
