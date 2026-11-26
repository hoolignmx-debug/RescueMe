// Defensive normalisers: turn whatever the backend sends into a predictable UI shape.
// Rules:
//  * missing values stay null (the UI shows "Not available") - nothing is invented
//  * medical details and the patient name are only treated as confirmed when
//    identity_status === 'VERIFIED' (an unverified identity is never assumed confirmed)

import { HAS_ARRIVED } from '../utils/statuses.js';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const upper = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
// null = unknown / not supplied, [] = supplied and empty
const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim() !== '').map(String) : null);
const asArray = (v) => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.results) ? v.results : []);

export const isVerified = (identityStatus) => upper(identityStatus) === 'VERIFIED';

export function normalizeIncident(raw = {}) {
  const identityStatus = upper(raw.patient?.identity_status) || 'UNKNOWN';
  const verified = isVerified(identityStatus);
  const restricted = upper(raw.access?.level) === 'MONITOR_ONLY';
  const status = upper(raw.status) || 'UNKNOWN';
  const summary = raw.medical_summary || null;
  const eta = HAS_ARRIVED.includes(status) ? null : num(raw.ambulance?.eta_minutes);

  return {
    id: str(raw.incident_id) || 'UNKNOWN-ID',
    isDemo: !!raw.is_demo,
    status,
    severity: upper(raw.severity) || 'UNKNOWN',
    restricted,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || raw.created_at || null,
    identityStatus,
    identityVerified: verified,
    patientId: str(raw.patient?.patient_id),
    patientName: verified ? str(raw.patient?.name) : null,
    age: verified ? num(raw.patient?.age) : null,
    // medical details are only trusted for a verified identity
    medicalConfirmed: verified && !!summary,
    bloodGroup: verified ? upper(summary?.blood_group) : null,
    bloodGroupVerified: verified && summary?.blood_group_verified === true,
    allergies: verified ? list(summary?.allergies) : null,
    conditions: verified ? list(summary?.conditions) : null,
    ambulanceId: str(raw.ambulance?.ambulance_id),
    ambulanceStatus: upper(raw.ambulance?.status),
    etaMinutes: eta,
    locationText: str(raw.location?.address),
    latitude: num(raw.location?.latitude),
    longitude: num(raw.location?.longitude),
  };
}

export const normalizeIncidentList = (raw) => asArray(raw).map(normalizeIncident);

export function normalizeProfile(raw = {}) {
  const identityStatus = upper(raw.patient?.identity_status) || 'UNKNOWN';
  const verified = isVerified(identityStatus);
  const mp = raw.medical_profile || null;
  const restrictedFields = Array.isArray(raw.access?.restricted_fields) ? raw.access.restricted_fields : [];
  return {
    incidentId: str(raw.incident_id),
    isDemo: !!raw.is_demo,
    access: { level: upper(raw.access?.level) || 'UNKNOWN', restrictedFields },
    patient: {
      userId: str(raw.patient?.user_id),
      name: verified ? str(raw.patient?.name) : null,
      age: verified ? num(raw.patient?.age) : null,
      gender: verified ? str(raw.patient?.gender) : null,
      identityStatus,
      verified,
      photoUrl: verified ? str(raw.patient?.photo_url) : null,
    },
    medical: {
      confirmed: verified && !!mp,
      bloodGroup: verified ? upper(mp?.blood_group) : null,
      bloodGroupVerified: verified && mp?.blood_group_verified === true,
      allergies: verified ? list(mp?.allergies) : null,
      conditions: verified ? list(mp?.conditions) : null,
      implants: verified ? list(mp?.implants) : null,
      medications: verified ? list(mp?.medications) : null,
      donorPreference: verified ? upper(mp?.donor_preference) : null,
    },
    incident: {
      accidentTime: raw.incident?.accident_time || null,
      address: str(raw.incident?.address),
      latitude: num(raw.incident?.latitude),
      longitude: num(raw.incident?.longitude),
      status: upper(raw.incident?.status) || 'UNKNOWN',
      severity: upper(raw.incident?.severity) || 'UNKNOWN',
    },
    ambulance: raw.ambulance
      ? { id: str(raw.ambulance.ambulance_id), status: upper(raw.ambulance.status), etaMinutes: num(raw.ambulance.eta_minutes) }
      : null,
    contacts: Array.isArray(raw.emergency_contacts)
      ? raw.emergency_contacts.map((c) => ({ name: str(c?.name), relationship: str(c?.relationship), phone: str(c?.phone) }))
      : [],
  };
}

export function normalizeTracking(raw = {}) {
  const loc = raw.ambulance?.location;
  const hasLoc = loc && num(loc.latitude) !== null && num(loc.longitude) !== null;
  return {
    incidentId: str(raw.incident_id),
    isDemo: !!raw.is_demo,
    incidentStatus: upper(raw.incident_status),
    ambulance: raw.ambulance
      ? {
          id: str(raw.ambulance.ambulance_id),
          status: upper(raw.ambulance.status),
          location: hasLoc
            ? { latitude: num(loc.latitude), longitude: num(loc.longitude), updatedAt: loc.updated_at || null, source: upper(loc.source) || 'UNKNOWN' }
            : null,
        }
      : null,
    hospital:
      raw.hospital && num(raw.hospital.latitude) !== null
        ? { name: str(raw.hospital.name) || 'Destination hospital', latitude: num(raw.hospital.latitude), longitude: num(raw.hospital.longitude) }
        : raw.hospital
          ? { name: str(raw.hospital.name) || 'Destination hospital', latitude: null, longitude: null }
          : null,
    incidentLocation: raw.incident_location
      ? { address: str(raw.incident_location.address), latitude: num(raw.incident_location.latitude), longitude: num(raw.incident_location.longitude) }
      : null,
    etaMinutes: num(raw.eta_minutes),
  };
}

export const normalizeTimeline = (raw) =>
  asArray(raw)
    .map((e) => ({
      id: e.event_id || `${e.type}-${e.timestamp}`,
      type: upper(e.type) || 'EVENT',
      timestamp: e.timestamp || null,
      fromStatus: upper(e.from_status),
      toStatus: upper(e.to_status),
      staffId: str(e.staff_id),
      staffName: str(e.staff_name),
      staffRole: str(e.staff_role),
      notes: str(e.notes),
    }))
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

export const normalizeNotes = (raw) =>
  asArray(raw).map((n) => ({
    id: n.note_id,
    incidentId: n.incident_id,
    kind: upper(n.kind),
    fields: n.fields && typeof n.fields === 'object' ? n.fields : {},
    staffId: str(n.staff_id),
    staffName: str(n.staff_name),
    staffRole: str(n.staff_role),
    recordedAt: n.recorded_at || null,
  }));

export const normalizeBloodBank = (raw = {}) => ({
  incidentId: str(raw.incident_id),
  isDemo: !!raw.is_demo,
  source: str(raw.source),
  bloodGroup: upper(raw.patient_blood_group),
  verified: raw.blood_group_verified === true,
  availability: upper(raw.availability) || 'UNKNOWN',
  preparation: upper(raw.preparation) || 'UNKNOWN',
  inventory: Array.isArray(raw.inventory) ? raw.inventory.map((i) => ({ group: upper(i.group), units: num(i.units) })) : [],
  updatedAt: raw.updated_at || null,
});

export const normalizeAudit = (raw) =>
  asArray(raw).map((a) => ({
    id: a.audit_id || `${a.timestamp}-${a.action}`,
    timestamp: a.timestamp || null,
    incidentId: str(a.incident_id),
    staffId: str(a.staff_id),
    staffName: str(a.staff_name),
    staffRole: str(a.staff_role),
    action: upper(a.action) || 'UNKNOWN',
    fromStatus: upper(a.from_status),
    toStatus: upper(a.to_status),
    details: str(a.details),
  }));
