// Incident status model shared by every page.
// Pre-arrival statuses (up to EN_ROUTE) are owned by the EMS module (Member 3).
// The hospital module may only move EN_ROUTE -> ARRIVED and onward.

export const STATUSES = [
  'IDENTITY_VERIFIED',
  'EMS_NOTIFIED',
  'AMBULANCE_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_ER',
  'UNDER_TREATMENT',
  'STABLE',
  'OTHER_OUTCOME',
  'CLOSED',
];

export const PRE_ARRIVAL = ['IDENTITY_VERIFIED', 'EMS_NOTIFIED', 'AMBULANCE_ASSIGNED', 'EN_ROUTE'];
export const HAS_ARRIVED = ['ARRIVED', 'IN_ER', 'UNDER_TREATMENT', 'STABLE', 'OTHER_OUTCOME', 'CLOSED'];

export const STATUS_META = {
  IDENTITY_VERIFIED: { label: 'Identity verified', tone: 'slate' },
  EMS_NOTIFIED: { label: 'EMS notified', tone: 'sky' },
  AMBULANCE_ASSIGNED: { label: 'Ambulance assigned', tone: 'indigo' },
  EN_ROUTE: { label: 'En route', tone: 'amber' },
  ARRIVED: { label: 'Arrived', tone: 'teal' },
  IN_ER: { label: 'In ER', tone: 'blue' },
  UNDER_TREATMENT: { label: 'Under treatment', tone: 'violet' },
  STABLE: { label: 'Stable', tone: 'green' },
  OTHER_OUTCOME: { label: 'Other outcome', tone: 'orange' },
  CLOSED: { label: 'Closed', tone: 'gray' },
  UNKNOWN: { label: 'Unknown', tone: 'gray' },
};

export const statusLabel = (status) => (STATUS_META[status] || STATUS_META.UNKNOWN).label;

// Hospital-side workflow:
// ARRIVED -> IN_ER -> UNDER_TREATMENT -> STABLE | OTHER_OUTCOME -> CLOSED
export const TRANSITIONS = {
  EN_ROUTE: ['ARRIVED'],
  ARRIVED: ['IN_ER'],
  IN_ER: ['UNDER_TREATMENT'],
  UNDER_TREATMENT: ['STABLE', 'OTHER_OUTCOME'],
  STABLE: ['CLOSED'],
  OTHER_OUTCOME: ['CLOSED'],
};

// Which transitions each role may perform (the backend must enforce the same rules).
export const ROLE_TRANSITIONS = {
  ER_DOCTOR: TRANSITIONS,
  PARAMEDIC: { EN_ROUTE: ['ARRIVED'], ARRIVED: ['IN_ER'] },
  ADMIN: {},
};

export const isValidTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export const allowedTransitions = (from, role) => ROLE_TRANSITIONS[role]?.[from] || [];

export const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
export const severityRank = (s) => SEVERITY_RANK[s] ?? SEVERITY_RANK.UNKNOWN;

// Dashboard card definitions (documented in the README).
export const isIncoming = (i) => PRE_ARRIVAL.includes(i.status);
export const isActive = (i) => i.status !== 'CLOSED';
export const isCritical = (i) =>
  ['CRITICAL', 'HIGH'].includes(i.severity) && !['STABLE', 'OTHER_OUTCOME', 'CLOSED'].includes(i.status);
