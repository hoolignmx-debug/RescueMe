import { getBackend } from './backend.js';
import { emitDataChanged } from './bus.js';
import { isValidTransition } from '../utils/statuses.js';
import { ApiError } from './api.js';
import {
  normalizeIncident,
  normalizeIncidentList,
  normalizeProfile,
  normalizeTracking,
  normalizeTimeline,
  normalizeNotes,
} from './normalize.js';

export async function listIncidents() {
  const b = await getBackend();
  return normalizeIncidentList(await b.listIncidents());
}

// There is no GET /api/incidents/{id} in the agreed contract, so a single incident
// summary is taken from the list (no clinical profile fetch, no extra audit entry).
export async function getIncident(id) {
  const items = await listIncidents();
  const found = items.find((i) => i.id === id);
  if (!found) throw new ApiError('NOT_FOUND', 'The requested incident was not found.', { status: 404 });
  return found;
}

export async function getProfile(id) {
  const b = await getBackend();
  return normalizeProfile(await b.getProfile(id));
}

export async function getTracking(id) {
  const b = await getBackend();
  return normalizeTracking(await b.getTracking(id));
}

export async function getPatientPhoto(photoUrl) {
  if (!photoUrl) return null;
  const b = await getBackend();
  return b.getPhotoUrl(photoUrl);
}

export async function updateStatus(incident, newStatus, notes = '') {
  // Client-side guard (UX). The backend enforces the same rules and is the source of truth.
  if (!isValidTransition(incident.status, newStatus)) {
    throw new ApiError('INVALID_TRANSITION', `Invalid status change: ${incident.status} → ${newStatus} is not part of the workflow.`);
  }
  const b = await getBackend();
  const updated = normalizeIncident(await b.updateStatus(incident.id, { status: newStatus, notes: notes.trim() || undefined }));
  emitDataChanged('incidents');
  return updated;
}

export async function addMedicalNote(incidentId, kind, fields, clientRequestId) {
  const b = await getBackend();
  const note = await b.addMedicalNote(incidentId, { kind, fields, client_request_id: clientRequestId });
  emitDataChanged('incidents');
  return note;
}

export async function listMedicalNotes(incidentId) {
  const b = await getBackend();
  return normalizeNotes(await b.listMedicalNotes(incidentId));
}

export async function getTimeline(incidentId) {
  const b = await getBackend();
  return normalizeTimeline(await b.getTimeline(incidentId));
}
