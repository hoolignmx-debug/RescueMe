// Role-based access control. The UI uses this to hide/disable things;
// the backend MUST enforce the same rules (UI checks are not security).

export const ROLES = {
  ER_DOCTOR: 'ER_DOCTOR',
  PARAMEDIC: 'PARAMEDIC',
  ADMIN: 'ADMIN',
};

export const ROLE_LABEL = {
  ER_DOCTOR: 'ER Doctor',
  PARAMEDIC: 'Paramedic',
  ADMIN: 'Hospital Administrator',
};

const PERMISSIONS = {
  ER_DOCTOR: [
    'incidents.view',
    'profile.view',
    'profile.contacts',
    'tracking.view',
    'handoff.view',
    'handoff.submit_doctor',
    'handoff.accept',
    'notes.add',
    'status.update',
    'timeline.view',
    'bloodbank.view',
  ],
  PARAMEDIC: [
    'incidents.view',
    'profile.view',
    'tracking.view',
    'handoff.view',
    'handoff.submit_paramedic',
    'status.update',
    'timeline.view',
  ],
  // Administrators monitor operations and audit records; no clinical content.
  ADMIN: ['incidents.view', 'tracking.view', 'timeline.view', 'audit.view'],
};

export const can = (role, permission) => !!PERMISSIONS[role]?.includes(permission);
export const roleLabel = (role) => ROLE_LABEL[role] || role || 'Unknown role';
