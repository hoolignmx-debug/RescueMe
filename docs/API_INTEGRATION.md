# API Integration Guide (for Member 2 – central backend)

The hospital dashboard talks **only** to the central backend, never to Member 1's or Member 3's code.
Every record is keyed by the shared `incident_id` (e.g. `INC-2026-0001`).

All data below is illustrative / synthetic. Nothing here should ever contain real patient data in this prototype.

## How the frontend is wired

```
pages  ->  services/incidentService.js, hospitalService.js, authService.js
                       |
                services/backend.js   (VITE_USE_MOCK)
                  |                    |
     backends/realBackend.js     backends/mock/mockBackend.js
     (Member 2's REST API)       (clearly labelled DEMO data)
```

* `VITE_USE_MOCK=false` + `VITE_API_BASE_URL=http://localhost:8000` switches to the real backend. That is the only change needed.
* There is **no silent fallback**: if the real backend is down the UI shows "Backend unavailable".
* `src/services/normalize.js` is the single place that maps backend JSON to the UI shape. If your field names differ, change them there (and `realBackend.js` for URLs). Pages do not need to change.
* Every request sends `Authorization: Bearer <token>`; a `401` signs the user out; errors are mapped in `src/services/api.js`.

## Endpoint status

| # | Endpoint | In the agreed list? | If missing |
|---|----------|--------------------|------------|
| 1 | `GET /api/incidents` | yes | dashboard/queue show an error |
| 2 | `GET /api/incidents/{id}/profile` | yes | profile page shows an error |
| 3 | `GET /api/incidents/{id}/tracking` | yes | tracking page shows an error |
| 4 | `PATCH /api/incidents/{id}/status` | yes | status update fails visibly |
| 5 | `POST /api/incidents/{id}/medical-notes` | yes | handoff save fails visibly |
| 6 | `POST /api/auth/login` | **needs confirming** | login shows "not supported yet" |
| 7 | `POST /api/auth/logout` | **needs confirming** (optional) | token only dropped locally |
| 8 | `GET /api/incidents/{id}/medical-notes` | **needs confirming** | history list shows "not supported yet" |
| 9 | `GET /api/incidents/{id}/timeline` | **needs confirming** | timeline shows "not supported yet" |
| 10 | `GET /api/incidents/{id}/blood-bank` | **needs confirming** | blood bank shows "not supported yet" |
| 11 | `GET /api/audit` | **needs confirming** | audit page shows "not supported yet" |

Endpoints 6–11 are marked `optionalEndpoint` in `realBackend.js`: a 404/405/501 is reported as *"The backend does not provide this feature yet"* — never faked.

## Authentication

`POST /api/auth/login` body `{ "identifier": "DOC-001", "password": "..." }`

```json
{
  "access_token": "<opaque or JWT>",
  "token_type": "bearer",
  "expires_in": 1800,
  "user": { "staff_id": "DOC-001", "name": "Dr. Example", "email": "doctor@example.test", "role": "ER_DOCTOR" }
}
```

* `role` ∈ `ER_DOCTOR | PARAMEDIC | ADMIN`.
* Wrong credentials → `401`. Expired/revoked token on any call → `401`.
* Please keep tokens short-lived and support revocation on `POST /api/auth/logout`.
* Preferred: an `httpOnly; SameSite` cookie instead of a bearer token held in `sessionStorage` (the dashboard would then only need `credentials: 'include'` in `api.js`).
* CORS: allow the dashboard origin (dev: `http://localhost:5174`) and the `Authorization` header.

## Authorization the backend must enforce (UI checks are not security)

| Action | ER_DOCTOR | PARAMEDIC | ADMIN |
|--------|:--:|:--:|:--:|
| list incidents | full summary | full summary | operational only (no patient name/age/medical) |
| profile | FULL (incl. contact phones, donor preference) | LIMITED (those fields `null`) | **403** |
| tracking | ✔ | ✔ | ✔ |
| paramedic handoff note | ✘ | ✔ | ✘ |
| doctor assessment / acceptance / treatment note | ✔ | ✘ | ✘ |
| status | all hospital transitions | `EN_ROUTE→ARRIVED`, `ARRIVED→IN_ER` | ✘ |
| timeline | ✔ | ✔ | ✔ |
| blood bank | ✔ | ✘ | ✘ |
| audit | ✘ | ✘ | ✔ |

Staff ID, role and timestamps on notes/status/audit must come from the **token**, never from the request body.

## 1. `GET /api/incidents` → array (or `{items:[...]}`)

```json
[{
  "incident_id": "INC-2026-0001",
  "status": "EN_ROUTE",
  "severity": "HIGH",
  "created_at": "2026-11-26T09:30:00Z",
  "updated_at": "2026-11-26T09:35:00Z",
  "access": { "level": "CLINICAL" },
  "location": { "address": "Demo road (demo)", "latitude": 28.431, "longitude": 77.312 },
  "patient": { "patient_id": "USER-102", "name": "Demo Patient", "age": 28, "identity_status": "VERIFIED" },
  "medical_summary": { "blood_group": "O+", "blood_group_verified": false, "allergies": ["Penicillin"], "conditions": ["Asthma"] },
  "ambulance": { "ambulance_id": "AMB-001", "status": "EN_ROUTE", "eta_minutes": 8 }
}]
```

* `status` ∈ `IDENTITY_VERIFIED, EMS_NOTIFIED, AMBULANCE_ASSIGNED, EN_ROUTE, ARRIVED, IN_ER, UNDER_TREATMENT, STABLE, OTHER_OUTCOME, CLOSED`.
* `severity` ∈ `CRITICAL, HIGH, MEDIUM, LOW`.
* `identity_status` ∈ `VERIFIED, PENDING_REVIEW, UNVERIFIED, REJECTED`. **The UI shows name, age and medical data only when `VERIFIED`**, whatever else is sent.
* For `ADMIN` send `"access": {"level": "MONITOR_ONLY"}` and omit/`null` the patient name, age and `medical_summary`.
* `null` means unknown; `[]` means "recorded as none". Do not send placeholder strings.
* Please include the same `incident_id` that Members 1 and 3 use. The hospital module never creates incidents.

## 2. `GET /api/incidents/{id}/profile`

```json
{
  "incident_id": "INC-2026-0001",
  "access": { "level": "FULL", "restricted_fields": [] },
  "patient": { "user_id": "USER-102", "name": "Demo Patient", "age": 28, "gender": "Male", "identity_status": "VERIFIED", "photo_url": null },
  "medical_profile": {
    "blood_group": "O+", "blood_group_verified": false,
    "allergies": ["Penicillin"], "conditions": ["Asthma"], "implants": [], "medications": [],
    "donor_preference": "UNKNOWN"
  },
  "incident": { "accident_time": "2026-11-26T09:28:00Z", "address": "…", "latitude": 28.431, "longitude": 77.312, "status": "EN_ROUTE", "severity": "HIGH" },
  "ambulance": { "ambulance_id": "AMB-001", "status": "EN_ROUTE", "eta_minutes": 8 },
  "emergency_contacts": [{ "name": "Demo Contact", "relationship": "Sibling", "phone": "+91-00000-00000" }]
}
```

* `medical_profile: null` = no confirmed profile. `access.level` is `FULL | LIMITED`; fields withheld for the role are `null` and listed in `restricted_fields`.
* `photo_url` is fetched with the bearer token (an `<img>` tag cannot send it), so it must be an authenticated path. Never a public URL.
* Each call should write a `PROFILE_VIEWED` audit entry.

## 3. `GET /api/incidents/{id}/tracking`

```json
{
  "incident_id": "INC-2026-0001",
  "incident_status": "EN_ROUTE",
  "ambulance": {
    "ambulance_id": "AMB-001", "status": "EN_ROUTE",
    "location": { "latitude": 28.42, "longitude": 77.32, "updated_at": "2026-11-26T09:36:00Z", "source": "GPS" }
  },
  "hospital": { "name": "Demo General Hospital", "latitude": 28.4089, "longitude": 77.3178 },
  "incident_location": { "address": "…", "latitude": 28.431, "longitude": 77.312 },
  "eta_minutes": 8
}
```

* `location.source`: `GPS` for real fixes. Anything else (e.g. `DEMO_SIMULATED`) is labelled **simulated** on the map.
* `ambulance: null`, `location: null` and `eta_minutes: null` are handled and shown as "not available". Member 3 must confirm these field names.

## 4. `PATCH /api/incidents/{id}/status`

Request `{ "status": "IN_ER", "notes": "optional" }` → updated incident summary (same shape as one list item).

Allowed transitions (enforce server-side, per role above):
`EN_ROUTE→ARRIVED → IN_ER → UNDER_TREATMENT → STABLE | OTHER_OUTCOME → CLOSED`.
`OTHER_OUTCOME` requires `notes`.

Errors: `409` with `{"detail":{"code":"INVALID_TRANSITION","message":"…"}}`, `403` role not allowed, `404` unknown incident.
Please record previous status, new status, staff ID, timestamp and notes in the timeline + audit log.

## 5. `POST /api/incidents/{id}/medical-notes`

```json
{
  "kind": "PARAMEDIC_HANDOFF",
  "client_request_id": "uuid-generated-per-submission",
  "fields": { "arrival_time": "2026-11-26T09:43:00Z", "initial_condition": "…", "consciousness": "ALERT", "breathing": "NORMAL",
              "visible_injuries": "…", "initial_observations": "…", "treatment_provided": "…", "medication_administered": "…", "additional_notes": "…" }
}
```

`kind` values and their `fields`:

| kind | who | fields |
|------|-----|--------|
| `PARAMEDIC_HANDOFF` | PARAMEDIC | as above (`consciousness`: ALERT/VOICE/PAIN/UNRESPONSIVE/UNKNOWN; `breathing`: NORMAL/LABOURED/ASSISTED/ABSENT/UNKNOWN) |
| `DOCTOR_ASSESSMENT` | ER_DOCTOR | `doctor_id, doctor_name, accepted_at, initial_assessment, treatment_notes` |
| `HANDOFF_ACCEPTANCE` | ER_DOCTOR | same as above; requires an earlier `PARAMEDIC_HANDOFF`; once per incident |
| `TREATMENT_NOTE` | ER_DOCTOR | `{ "text": "…" }` |

Response `201`:
```json
{ "note_id": "NOTE-…", "incident_id": "INC-2026-0001", "kind": "PARAMEDIC_HANDOFF", "fields": {}, "staff_id": "PARA-001", "staff_name": "…", "staff_role": "PARAMEDIC", "recorded_at": "2026-11-26T09:50:00Z" }
```

Rules the UI relies on:
* **Idempotent**: a repeated `client_request_id` returns the original note (retry after a timeout never duplicates).
* **Duplicates**: identical content from the same staff member/kind → `409 {"detail":{"code":"DUPLICATE_NOTE"}}`.
* Status must be `ARRIVED` or later and not `CLOSED`, otherwise `409`.
* Notes are append-only (no edit/delete); corrections are new notes.

## 6–11. Endpoints to confirm

* `GET /api/incidents/{id}/medical-notes` → array of the note objects above (newest first is fine; the UI sorts).
* `GET /api/incidents/{id}/timeline` →
  ```json
  [{ "event_id": "EVT-1", "type": "STATUS_CHANGED", "timestamp": "2026-11-26T09:43:00Z",
     "from_status": "EN_ROUTE", "to_status": "ARRIVED", "staff_id": "PARA-001", "staff_name": "…", "staff_role": "PARAMEDIC", "notes": "" }]
  ```
  `type` ∈ `INCIDENT_RECEIVED, IDENTITY_VERIFIED, IDENTITY_PENDING, EMS_NOTIFIED, AMBULANCE_ASSIGNED, STATUS_CHANGED, HANDOFF_SUBMITTED, DOCTOR_ASSESSMENT_SAVED, HANDOFF_ACCEPTED, NOTE_ADDED` (unknown types are still displayed generically). Times must be real stored timestamps.
* `GET /api/incidents/{id}/blood-bank` →
  ```json
  { "incident_id": "…", "source": "…", "patient_blood_group": "O+", "blood_group_verified": false,
    "availability": "CHECKING", "preparation": "NOT_STARTED",
    "inventory": [{ "group": "O+", "units": 15 }], "updated_at": "…" }
  ```
  `availability` ∈ `AVAILABLE, LOW, UNAVAILABLE, CHECKING, UNKNOWN`; `preparation` ∈ `NOT_STARTED, IN_PROGRESS, READY, UNKNOWN`. Informational only — it must never allocate or issue units.
* `GET /api/audit?incident_id=&action=&limit=` (ADMIN only) →
  ```json
  [{ "audit_id": "AUD-1", "timestamp": "…", "incident_id": "INC-2026-0001", "staff_id": "DOC-001", "staff_name": "…", "staff_role": "ER_DOCTOR",
     "action": "STATUS_CHANGED", "from_status": "IN_ER", "to_status": "UNDER_TREATMENT", "details": "" }]
  ```
  `action` examples: `LOGIN, LOGOUT, PROFILE_VIEWED, TRACKING_VIEWED, BLOODBANK_VIEWED, NOTES_VIEWED, HANDOFF_SUBMITTED, HANDOFF_ACCEPTED, NOTE_ADDED, STATUS_CHANGED, RECORD_CLOSED, ACCESS_DENIED`. Audit entries must be written by the backend, not the browser.

## Error body format

FastAPI defaults are understood: `{"detail": "text"}`, `{"detail": {"code": "…", "message": "…"}}` and `{"detail": [{"loc": [...], "msg": "…"}]}`.

| HTTP | UI behaviour |
|------|--------------|
| 401 | signs the user out ("session expired") |
| 403 | "Access not authorized" |
| 404/405/501 on endpoints 6–11 | "Not supported by the backend yet" |
| 409 `INVALID_TRANSITION` / `DUPLICATE_NOTE` | specific message |
| network / timeout | "Backend unavailable" / "Request timed out" (data already on screen is kept and flagged as stale) |

## Real-time updates

The agreed contract has no push channel, so the dashboard **polls** every `VITE_POLL_INTERVAL_MS` (default 15 s), pauses while the tab is hidden, and has a manual Refresh button. If you add SSE or WebSocket, only `src/hooks/useIncidents.js` needs to change.

## Open questions for Member 2 / Member 3

1. Do endpoints 6–11 exist, and under which paths/fields?
2. Final field names for `ambulance` / `tracking` (Member 3): `location.source`, `eta_minutes`, hospital coordinates.
3. Is a cookie-based session possible instead of a bearer token?
4. Is `identity_status` the exact field name for the verification state?

## Quick contract check

With the backend running:
```bash
echo "VITE_USE_MOCK=false" > .env.local && npm run dev
```
Sign in, then watch the browser network tab: any shape mismatch shows up as "Not available" fields or an explicit error, never fabricated data.
