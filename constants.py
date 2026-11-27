"""Shared values every member must agree on: roles, statuses and allowed status changes."""

# ---------- Roles ----------
FIELD = "field_responder"   # Member 1 app
EMS = "ems"                 # Member 3 dashboard
HOSPITAL = "hospital"       # Member 4 dashboard
ADMIN = "admin"
ROLES = (FIELD, EMS, HOSPITAL, ADMIN)

# ---------- Incident statuses (section 8 of the workflow PDF) ----------
SCAN_PENDING = "SCAN_PENDING"
SCAN_RECEIVED = "SCAN_RECEIVED"
MATCH_REVIEW = "MATCH_REVIEW"
IDENTITY_VERIFIED = "IDENTITY_VERIFIED"
EMS_NOTIFIED = "EMS_NOTIFIED"
AMBULANCE_ASSIGNED = "AMBULANCE_ASSIGNED"
EN_ROUTE = "EN_ROUTE"
ARRIVED = "ARRIVED"
IN_ER = "IN_ER"
UNDER_TREATMENT = "UNDER_TREATMENT"
STABLE = "STABLE"
OTHER_OUTCOME = "OTHER_OUTCOME"
CLOSED = "CLOSED"

STATUSES = [
    SCAN_PENDING, SCAN_RECEIVED, MATCH_REVIEW, IDENTITY_VERIFIED, EMS_NOTIFIED,
    AMBULANCE_ASSIGNED, EN_ROUTE, ARRIVED, IN_ER, UNDER_TREATMENT, STABLE, OTHER_OUTCOME, CLOSED,
]

# Statuses where the identity step is still running (a scan can change the status)
IDENTITY_STAGE = {SCAN_PENDING, SCAN_RECEIVED, MATCH_REVIEW}

# Statuses from which an ambulance can be dispatched.
# Care is never blocked by identity: an unidentified patient still gets an ambulance.
DISPATCHABLE = {SCAN_PENDING, SCAN_RECEIVED, MATCH_REVIEW, IDENTITY_VERIFIED, EMS_NOTIFIED}

# Allowed next statuses. Anything not listed here is rejected.
TRANSITIONS = {
    SCAN_PENDING: [SCAN_RECEIVED, EMS_NOTIFIED],
    SCAN_RECEIVED: [IDENTITY_VERIFIED, MATCH_REVIEW, EMS_NOTIFIED],
    MATCH_REVIEW: [IDENTITY_VERIFIED, EMS_NOTIFIED],
    IDENTITY_VERIFIED: [EMS_NOTIFIED],
    EMS_NOTIFIED: [AMBULANCE_ASSIGNED],
    AMBULANCE_ASSIGNED: [EN_ROUTE],
    EN_ROUTE: [ARRIVED],
    ARRIVED: [IN_ER],
    IN_ER: [UNDER_TREATMENT],
    UNDER_TREATMENT: [STABLE, OTHER_OUTCOME],
    STABLE: [CLOSED],
    OTHER_OUTCOME: [CLOSED],
    CLOSED: [],
}

# Which roles may set each status through PATCH /status
STATUS_ROLES = {
    EMS_NOTIFIED: {EMS, ADMIN},
    EN_ROUTE: {EMS, ADMIN},
    ARRIVED: {EMS, HOSPITAL, ADMIN},
    IN_ER: {HOSPITAL, ADMIN},
    UNDER_TREATMENT: {HOSPITAL, ADMIN},
    STABLE: {HOSPITAL, ADMIN},
    OTHER_OUTCOME: {HOSPITAL, ADMIN},
    CLOSED: {HOSPITAL, ADMIN},
}

# Statuses that are set by a specific endpoint, never by PATCH /status
SET_BY_ENDPOINT = {
    SCAN_PENDING: "POST /api/incidents",
    SCAN_RECEIVED: "POST /api/incidents/{id}/scan",
    MATCH_REVIEW: "POST /api/incidents/{id}/scan",
    IDENTITY_VERIFIED: "POST /api/incidents/{id}/scan or /review",
    AMBULANCE_ASSIGNED: "POST /api/incidents/{id}/dispatch",
}

# ---------- Match results ----------
MATCH_VERIFIED = "VERIFIED"
MATCH_NEEDS_REVIEW = "NEEDS_REVIEW"   # medium similarity
MATCH_AMBIGUOUS = "AMBIGUOUS"         # two candidates too close to call
MATCH_NONE = "NO_MATCH"
MATCH_REJECTED = "REJECTED_BY_REVIEWER"

# ---------- Ambulance statuses ----------
AMB_AVAILABLE = "AVAILABLE"
AMB_ASSIGNED = "ASSIGNED"
AMB_EN_ROUTE = "EN_ROUTE"
AMB_ARRIVED = "ARRIVED"
AMB_OUT_OF_SERVICE = "OUT_OF_SERVICE"

# ---------- Hospital ER statuses ----------
ER_OPEN = "OPEN"
ER_BUSY = "BUSY"
ER_DIVERTING = "DIVERTING"   # not accepting ambulances
ER_STATUSES = (ER_OPEN, ER_BUSY, ER_DIVERTING)

SEVERITIES = ("UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL")
