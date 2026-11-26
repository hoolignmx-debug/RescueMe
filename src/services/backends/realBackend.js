// REAL backend adapter -> Member 2's central backend over REST/JSON.
//
// Agreed endpoints (from the team brief):
//   GET   /api/incidents
//   GET   /api/incidents/{id}/profile
//   GET   /api/incidents/{id}/tracking
//   PATCH /api/incidents/{id}/status
//   POST  /api/incidents/{id}/medical-notes
//
// NOT yet confirmed with Member 2 (marked optionalEndpoint -> a 404/405 surfaces as
// "NOT_IMPLEMENTED" in the UI instead of being faked). Exact contracts: docs/API_INTEGRATION.md
//   POST /api/auth/login            POST /api/auth/logout
//   GET  /api/incidents/{id}/medical-notes
//   GET  /api/incidents/{id}/timeline
//   GET  /api/incidents/{id}/blood-bank
//   GET  /api/audit

import { request, requestBlobUrl } from '../api.js';

const enc = encodeURIComponent;

export const realBackend = {
  mode: 'LIVE',

  login: (identifier, password) =>
    request('/api/auth/login', { method: 'POST', body: { identifier, password }, auth: false, login: true, optionalEndpoint: true }),
  logout: () => request('/api/auth/logout', { method: 'POST', optionalEndpoint: true }),

  listIncidents: () => request('/api/incidents'),
  getProfile: (id) => request(`/api/incidents/${enc(id)}/profile`),
  getTracking: (id) => request(`/api/incidents/${enc(id)}/tracking`),
  updateStatus: (id, payload) => request(`/api/incidents/${enc(id)}/status`, { method: 'PATCH', body: payload }),
  addMedicalNote: (id, payload) => request(`/api/incidents/${enc(id)}/medical-notes`, { method: 'POST', body: payload }),

  listMedicalNotes: (id) => request(`/api/incidents/${enc(id)}/medical-notes`, { optionalEndpoint: true }),
  getTimeline: (id) => request(`/api/incidents/${enc(id)}/timeline`, { optionalEndpoint: true }),
  getBloodBank: (id) => request(`/api/incidents/${enc(id)}/blood-bank`, { optionalEndpoint: true }),
  listAudit: (params) => request('/api/audit', { query: params, optionalEndpoint: true }),

  getPhotoUrl: (path) => requestBlobUrl(path),
};
