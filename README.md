# Member 3: EMS Response Module

**Project:** Emergency Face Identification & Medical SOS System (college prototype)
**Module:** EMS response, ambulance dispatch, family notification, live tracking, hospital assignment
**Upgrade:** now an **AI-assisted AUTOMATED EMS response system** (automatic ambulance + hospital selection, automatic
dispatch, automatic family notification, automatic tracking start) with safety rules, a fallback when AI is down,
and full manual override. The original manual pages still work. See sections 14 to 20.

> **DEMO / SIMULATED.** All patients, phone numbers, ambulances and hospitals are fictional.
> Ambulance tracking and family notifications are simulated. Nothing is sent to a real phone.
> A face match is AI-assisted and is **not absolute proof** of identity.

---

## 1. Project purpose

When someone triggers an emergency (Member 1) and is identified (Member 2), an EMS operator needs one place to
see the emergency, send an ambulance, tell the family, follow the ambulance and choose the hospital.
This module is that EMS operator console. It runs entirely in the browser with demo data, and it is built so it can
later talk to Member 2's real backend by changing one setting.

## 2. Member 3 responsibilities

| Area | What this module does |
|---|---|
| EMS response | Dashboard of active emergencies with severity, blood group, allergy and status |
| Ambulance dispatch | Assign an ambulance to an incident; enforce the ambulance status flow |
| Family notification | List authorized contacts and **simulate** SMS / WhatsApp / voice call |
| Live tracking | Leaflet map with simulated ambulance movement and ETA |
| Hospital assignment | Choose a hospital and store it against the incident for Member 4 |

## 3. Folder structure

```
member3/
├── README.md
├── ai-service/                  NEW  small Node server: the AI/ranking engine (no npm packages needed)
│   ├── server.js                     endpoints, CORS allow-list, rate limit, optional static hosting of ../frontend
│   ├── lib/scoring.js                deterministic weighted scoring (the explainable "ranking engine")
│   ├── lib/llm.js                    OPTIONAL external LLM call. Reads AI_API_KEY from the environment only
│   ├── lib/validate.js               input sanitising + validation of LLM answers
│   ├── test/run-tests.js             25 tests (uses a fake LLM server, never calls a real one)
│   ├── .env.example                  copy to .env and fill in (never commit .env)
│   └── package.json
├── tests/
│   └── pipeline.test.js         NEW  25 headless end-to-end tests of the automated workflow
└── frontend/
    ├── index.html               EMS dashboard + AUTOMATION panel
    ├── incident.html            Incident details + timeline + AI EMS summary
    ├── ambulance.html           Ambulance list + manual assign (nearest SUITABLE) + status buttons
    ├── tracking.html            Leaflet map, simulated ambulance movement
    ├── notification.html        Family notification (simulated), shows AUTO vs OPERATOR
    ├── hospital.html            Hospital assignment + handoff for Member 4
    ├── css/
    │   └── style.css            All styling (section 15 is new: automation)
    └── js/
        ├── api.js               ALL data access + AI service calls + automation state. Mock/real switch lives here
        ├── rules.js             NEW  deterministic safety/business rules + AI-response validators + fallback ranking
        ├── automation.js        NEW  the orchestrator: AI -> rules -> backend -> action, overrides, activity log
        ├── dashboard.js
        ├── incident.js
        ├── ambulance.js
        ├── tracking.js
        ├── notification.js
        └── hospital.js
```

## 4. How to install / run

There is **no `npm install`** and no build step. The AI service uses only Node's built-in modules.

Requirements:
- **Node.js 18 or newer** (only for the optional AI service; check with `node --version`)
- A modern browser (Chrome, Edge or Firefox)
- Internet access, **only** for the map library and tiles on the tracking page (Leaflet and OpenStreetMap)

**Fastest way (one command):**

```bash
cd member3/ai-service
node server.js
```

Then open **http://localhost:8787/** . The service also serves the frontend, so the AI engine is automatically
reachable (no CORS setup). The dashboard shows `AI EMS ENGINE: ONLINE`.

**Frontend only (no Node):** open `frontend/index.html` with VS Code Live Server (section 5). The whole demo still works:
the AI service is simply reported as OFFLINE and the **safe fallback** logic runs (this is also the test for section 18).

**Optional: turn on the external LLM layer**

```bash
cd member3/ai-service
cp .env.example .env        # then edit .env and set AI_API_KEY=...   (Windows: copy .env.example .env)
node server.js
```

The log line `LLM layer : ENABLED` confirms it. Without a key the service runs in **scoring-engine mode** (no LLM).
The key is read only by this Node process. It is never in `frontend/`, never sent to the browser and never logged.

## 5. How to use VS Code Live Server

1. Unzip the project. In VS Code use **File > Open Folder** and open the `member3` folder.
2. Install the extension: Extensions icon > search **Live Server** > Install.
3. In the Explorer, expand `frontend`, right-click `index.html` and choose **Open with Live Server**.
4. The browser opens at `http://127.0.0.1:5500/frontend/index.html` (the port can differ).
5. To use the AI service with Live Server, also run `node server.js` in `ai-service/`. Its CORS allow-list accepts any
   `http://localhost:*` / `http://127.0.0.1:*` page automatically.

## 6. How to open index.html

`frontend/index.html` is the EMS dashboard. Every page has the same top navigation:
**EMS Dashboard, Incidents, Ambulances, Tracking, Notifications, Hospitals.**
Once you pick an incident, the navigation links carry the incident ID (`?id=INC-2026-0001`) to the next page,
so every page works on the **same incident_id**.

Use Live Server rather than double-clicking the HTML file. It works more reliably and keeps the demo data shared between pages.

## 7. How the mock API works

Open `frontend/js/api.js`. The top of the file is the only configuration:

```js
const USE_MOCK_API = true;
const API_BASE_URL = "http://localhost:8000/api";
const AI_ENABLED = true;               // false = automation uses local rules only (RULES MODE)
const AUTO_DISPATCH_ENABLED = true;    // false = MANUAL MODE, exactly like the original module
```

- `api.js` has clearly marked sections: **3A MOCK API** and **3B REAL API**.
- The pages only call the public functions in section 4:
  `getIncidents()`, `getIncident(id)`, `getAmbulances()`, `dispatchAmbulance(id, ambId)`,
  `getEmergencyContacts(id)`, `sendNotification(id, data)`, `getTracking(id)`,
  `updateIncidentStatus(id, status)`, `assignHospital(id, data)`, `getHospitals()`, plus the new `reassignAmbulance(id, data)`,
  the AI calls (`aiRecommendAmbulance`, `aiRecommendHospital`, `aiIncidentSummary`, `getAiHealth`) and the automation state helpers.
- `fetch()` appears in two places, both in `api.js`: `apiRequest()` (Member 2's backend) and `aiRequest()` (the AI service).
- With `USE_MOCK_API = true` the "database" is kept in the browser's `localStorage`, so a change on one page
  (for example assigning an ambulance) shows on all the others. Click **Reset demo data** on the dashboard to start again.
- The mock enforces the same rules the real backend should: valid status transitions, one ambulance per incident,
  available hospitals only, authorized contacts only.
- Ambulance movement is simulated at **10x real time**, so a 5 minute trip takes about 30 seconds in the demo.

Demo data:

| Incident | Patient | Location | Severity | Status | Notes |
|---|---|---|---|---|---|
| INC-2026-0001 | Demo Patient | Near City Mall | HIGH (type TRAUMA) | IDENTITY_VERIFIED | O+, Penicillin, 2 authorized contacts. **This one is auto-dispatched.** |
| INC-2026-0002 | Unidentified Person | Central Bus Stand, Gate 2 | MEDIUM | EMERGENCY_CREATED | identity not verified, so automation waits for Member 2. Blood group and allergy unknown, no contacts |
| INC-2026-0003 | Demo Patient Two | Lakeview Apartments, Block C | LOW | IDENTITY_VERIFIED | B+, no known allergy. Below the auto-dispatch threshold, so it waits for the operator (or **RUN AUTO-DISPATCH NOW**) |

Ambulances (distances from INC-2026-0001):
- **AMB-001** (UP-XX-1234): 2.1 km, 5 min, **ADVANCED** (defibrillator, ventilator, oxygen, spinal board)
- **AMB-002** (UP-XX-5678): 1.5 km, 4 min, **BASIC** (oxygen). It is *closer*, but it is not the right unit for a HIGH trauma case.

Hospitals (distances from INC-2026-0001):
- **HOSP-001** City Emergency Hospital: 5.2 km, 8 min, **has trauma**, 6 beds
- **HOSP-002** Central Hospital: 2.5 km, 4 min, **no trauma capability**, 3 beds. It is *closer*, but not the right destination for trauma.
- **HOSP-003** Riverside Medical Centre: emergency department UNAVAILABLE (tests the error message)

The mock data is stored under the key `member3_mock_db_v2` (v2 added the capability fields; old v1 data is ignored).

## 8. How to switch to Member 2's API

1. Start Member 2's backend so that it answers at `http://localhost:8000/api`.
2. Open `frontend/js/api.js` and change the top two lines:
   ```js
   const USE_MOCK_API = false;
   const API_BASE_URL = "http://localhost:8000/api";   // change if Member 2 uses another host or port
   ```
3. Reload the page. The pill in the top bar changes from **MOCK API** to **LIVE API**.

Nothing in `dashboard.js`, `incident.js`, `ambulance.js`, `tracking.js`, `notification.js` or `hospital.js` needs to change.

If Member 2's field names differ slightly from the contract in section 9, fix them in the "REAL API" section of
`api.js` (for example inside `realAdaptIncident()`), not in the pages.

Member 2's server must allow requests from the Live Server address (CORS), for example `http://127.0.0.1:5500`.

**Automation with the real backend.** The automation reads and writes ONLY through the endpoints in section 9, so it works in LIVE mode too.
Two things to know:
- **Operator "swap ambulance"** uses one additional endpoint that is not in the original contract:
  `POST /api/incidents/{incident_id}/reassign` with `{ "ambulance_id": "AMB-002", "reason": "Operator override" }`,
  returning `{ incident_id, ambulance_id, previous_ambulance_id, status, message }`. Until Member 2 builds it, swap shows a clear error in LIVE mode.
  It must only be allowed while the status is `ASSIGNED` or `EN_ROUTE`, and must release the old ambulance.
- **Optional fields** that make the ranking better if Member 2 provides them: incident `incident_type` (`TRAUMA`, `CARDIAC`, `GENERAL`),
  ambulance `capability` (`ADVANCED`/`BASIC`), `equipment[]`, `missions_today`, hospital `capabilities[]` (`TRAUMA`, `CARDIAC`, ...) and `beds_available`.
  Without them the system still works (it treats the incident as general and the ambulance capability as unknown).
- In this prototype the orchestration runs in the browser while the dashboard is open. In production it should run on the server
  (same `automation.js` logic, triggered when an incident becomes verified) so dispatch never depends on an open browser tab.


## 9. Required APIs from Member 2 (API contract)

Base URL: `http://localhost:8000/api`. All bodies and responses are JSON.
Responses may be returned directly or wrapped as `{ "data": ... }`. Both work.
Errors should use a non-2xx status and a body like `{ "detail": "Human readable message" }`. The message is shown to the operator.

Every endpoint is keyed by the same `incident_id`, for example `INC-2026-0001`.

### 9.1 GET /api/incidents

List of incidents for the dashboard.

```json
[
  {
    "incident_id": "INC-2026-0001",
    "patient_name": "Demo Patient",
    "location": "Near City Mall",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "severity": "HIGH",
    "status": "IDENTITY_VERIFIED",
    "identity_verified": true,
    "identity_confidence": 0.94,
    "blood_group": "O+",
    "allergy": "Penicillin",
    "emergency_time": "2026-11-26T09:30:00Z",
    "ambulance_id": null,
    "hospital_id": null,
    "eta_minutes": null
  }
]
```

`severity` is `HIGH`, `MEDIUM` or `LOW`. `blood_group` and `allergy` may be `null` when unknown.

### 9.2 GET /api/incidents/{incident_id}

One incident, same fields as above plus optional history lists.

```json
{
  "incident_id": "INC-2026-0001",
  "patient_name": "Demo Patient",
  "location": "Near City Mall",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "severity": "HIGH",
  "status": "ASSIGNED",
  "identity_verified": true,
  "identity_confidence": 0.94,
  "blood_group": "O+",
  "allergy": "Penicillin",
  "emergency_time": "2026-11-26T09:30:00Z",
  "ambulance_id": "AMB-001",
  "hospital_id": null,
  "eta_minutes": null,
  "status_history": [
    { "status": "EMERGENCY_CREATED", "at": "2026-11-26T09:30:00Z" },
    { "status": "IDENTITY_VERIFIED", "at": "2026-11-26T09:31:00Z" },
    { "status": "ASSIGNED", "at": "2026-11-26T09:36:00Z" }
  ],
  "notifications": []
}
```

Unknown ID: `404` with `{ "detail": "Incident not found" }`.

### 9.3 GET /api/ambulances

Optional query `?incident_id=INC-2026-0001` adds distance and ETA from that incident.

```json
[
  {
    "ambulance_id": "AMB-001",
    "vehicle_number": "UP-XX-1234",
    "status": "AVAILABLE",
    "incident_id": null,
    "latitude": 28.6005,
    "longitude": 77.1938,
    "distance_km": 2.1,
    "eta_minutes": 5
  }
]
```

`status` is one of `AVAILABLE, ASSIGNED, EN_ROUTE, ARRIVED, PATIENT_PICKED_UP, TO_HOSPITAL, HOSPITAL_ARRIVED`.

### 9.4 POST /api/incidents/{incident_id}/dispatch

Request:
```json
{ "ambulance_id": "AMB-001" }
```
Response `200`:
```json
{
  "incident_id": "INC-2026-0001",
  "ambulance_id": "AMB-001",
  "vehicle_number": "UP-XX-1234",
  "status": "ASSIGNED",
  "ambulance_status": "ASSIGNED",
  "message": "AMB-001 has been assigned to INC-2026-0001."
}
```
Errors (`409`): ambulance not available, incident already has an ambulance, no ambulance available. `404`: unknown incident or ambulance.

### 9.5 GET /api/incidents/{incident_id}/contacts

Authorized emergency contacts only. Phone numbers should be **masked**.

```json
[
  {
    "contact_id": "CON-001",
    "name": "Demo Mother",
    "relationship": "Mother",
    "phone_masked": "XXXXXX0001",
    "authorized": true
  }
]
```
Return `[]` when none exist.

### 9.6 POST /api/incidents/{incident_id}/notify

Request (this prototype records the notification as simulated; it does not send it):
```json
{
  "contact_id": "CON-001",
  "channel": "SMS",
  "message": "EMERGENCY ALERT: An emergency incident has been registered near City Mall. Emergency services have been notified. Ambulance AMB-001 has been dispatched. Incident: INC-2026-0001."
}
```
`channel` is `SMS`, `WHATSAPP` or `VOICE_CALL`.

Response `200`:
```json
{
  "notification_id": "NTF-0001",
  "incident_id": "INC-2026-0001",
  "contact_id": "CON-001",
  "recipient_name": "Demo Mother",
  "recipient_relationship": "Mother",
  "channel": "SMS",
  "message": "EMERGENCY ALERT: ...",
  "status": "SIMULATED",
  "is_simulated": true,
  "sent_at": "2026-11-26T09:37:00Z"
}
```
Errors: `404` contact not found or not authorized, `400` empty message, `502` gateway failure.

### 9.7 GET /api/incidents/{incident_id}/tracking

```json
{
  "incident_id": "INC-2026-0001",
  "status": "EN_ROUTE",
  "ambulance_id": "AMB-001",
  "vehicle_number": "UP-XX-1234",
  "ambulance_status": "EN_ROUTE",
  "emergency_location": { "latitude": 28.6139, "longitude": 77.2090, "label": "Near City Mall" },
  "ambulance_location": { "latitude": 28.6050, "longitude": 77.1990, "updated_at": "2026-11-26T09:38:00Z" },
  "hospital_location": { "hospital_id": "HOSP-001", "name": "City Emergency Hospital", "latitude": 28.6440, "longitude": 77.2498 },
  "destination": "INCIDENT",
  "distance_remaining_km": 1.2,
  "eta_minutes": 3,
  "is_simulated": true
}
```
`destination` is `INCIDENT` before pickup and `HOSPITAL` after. `ambulance_location` and `hospital_location` are `null` until known.
Keep `is_simulated: true` while the data is not real GPS.

### 9.8 PATCH /api/incidents/{incident_id}/status

Request:
```json
{ "status": "EN_ROUTE" }
```
Response `200`:
```json
{
  "incident_id": "INC-2026-0001",
  "status": "EN_ROUTE",
  "ambulance_id": "AMB-001",
  "ambulance_status": "EN_ROUTE"
}
```
Only the next status in this order is allowed. Anything else returns `409` with a clear message:

```
EMERGENCY_CREATED > IDENTITY_VERIFIED > ASSIGNED > EN_ROUTE > ARRIVED > PATIENT_PICKED_UP > TO_HOSPITAL > HOSPITAL_ARRIVED
```
(`AVAILABLE` is only an ambulance status, the state before `ASSIGNED`.)
Member 2 sets `EMERGENCY_CREATED` and `IDENTITY_VERIFIED`. Member 3 sets everything from `ASSIGNED` onwards.
Dispatching straight from `EMERGENCY_CREATED` is allowed, because an ambulance should never wait for identity verification.

### 9.9 POST /api/incidents/{incident_id}/hospital

Request:
```json
{
  "hospital_id": "HOSP-001",
  "ambulance_id": "AMB-001",
  "eta_minutes": 8
}
```
Response `200`:
```json
{
  "incident_id": "INC-2026-0001",
  "hospital_id": "HOSP-001",
  "hospital_name": "City Emergency Hospital",
  "ambulance_id": "AMB-001",
  "eta_minutes": 8,
  "status": "TO_HOSPITAL",
  "message": "City Emergency Hospital has been notified of the incoming emergency (simulated)."
}
```
Errors: `409` hospital emergency department unavailable, `409` ambulance does not belong to this incident, `404` unknown hospital.

### 9.10 GET /api/hospitals (one extra endpoint, not in the original list)

The hospital page needs a list of hospitals, so Member 2 also needs to provide this. Optional `?incident_id=...` adds distance and ETA.

```json
[
  {
    "hospital_id": "HOSP-001",
    "name": "City Emergency Hospital",
    "emergency_department": "AVAILABLE",
    "latitude": 28.6440,
    "longitude": 77.2498,
    "beds_available": 6,
    "specialties": ["Trauma", "Cardiology"],
    "distance_km": 5.2,
    "eta_minutes": 8
  }
]
```
`emergency_department` is `AVAILABLE` or `UNAVAILABLE`.

## 10. How Member 4 connects

Member 4 (hospital ER dashboard) does not need anything from Member 3's pages. They read the same incident from the backend.

1. When the operator presses **SELECT HOSPITAL**, Member 3 calls `POST /api/incidents/{incident_id}/hospital`
   with `hospital_id`, `ambulance_id` and `eta_minutes`.
2. The backend stores `hospital_id`, `ambulance_id` and `eta_minutes` on the incident.
3. Member 4 calls `GET /api/incidents/{incident_id}` and receives the incoming emergency, including patient name, severity,
   blood group, allergy, status, ambulance and ETA.
4. Member 4 can find "all incidents heading to my hospital" by filtering `GET /api/incidents` on `hospital_id`
   (or Member 2 can add `GET /api/hospitals/{hospital_id}/incoming`).
5. Member 4 shows the live status from the same `status` field. When it becomes `HOSPITAL_ARRIVED`, the medical handoff begins.

The **same `incident_id`** is used by the emergency, identity verification, ambulance, notification, tracking, hospital, status and medical handoff.

In mock mode only: the demo data lives in the browser's `localStorage` under the key `member3_mock_db_v2`.
A Member 4 page served from the same Live Server address can read it by loading `member3/frontend/js/api.js` and calling `getIncident(id)`.

## 11. Demo workflow

The normal demo needs **no clicks** (full procedure and expected log in section 19). The old click-by-click flow is still available:
set `AUTO_DISPATCH_ENABLED = false` in `api.js` (MANUAL MODE) or use the **MANUAL OVERRIDE** button on the dashboard.

| Step | Who | What happens |
|---|---|---|
| 1 | Member 1 | Emergency created (represented by the demo data). |
| 2 | Member 2 | Identity verified. INC-2026-0001 is already `IDENTITY_VERIFIED`. |
| 3 | Member 3 (automatic) | Dashboard receives it, AI/ranking engine analyses it, AMB-001 is recommended, safety rules pass, AMB-001 is assigned, status becomes `EN_ROUTE`, tracking starts. |
| 4 | Member 3 (automatic) | Authorized family contacts are notified (simulated), the best hospital (HOSP-001) is recommended, validated and assigned. |
| 5 | Operator | Watches the automation timeline and activity log. Can press **MANUAL OVERRIDE** at any moment. |
| 6 | Simulated GPS | The ambulance reaches the scene: status becomes `ARRIVED` automatically (geofence). |
| 7 | Operator / crew | Click **PATIENT PICKED UP**. This is a human fact, so it is never automated. |
| 8 | Member 3 (automatic) | Because a hospital is already assigned, status becomes `TO_HOSPITAL`; on reaching the hospital, `HOSPITAL_ARRIVED`. |
| 9 | Member 4 | Reads the same incident (`INC-2026-0001`) with hospital, ambulance and ETA. |

## 12. Testing checklist

**Navigation and loading**
- [ ] All six pages open from the top navigation and no page is blank.
- [ ] Opening `incident.html?id=INC-2026-0001` shows that incident.
- [ ] The tab shows MOCK API and the yellow DEMO banner on every page.

**Dashboard**
- [ ] Shows 3 emergencies, the active count, available ambulances (2) and high priority (1).
- [ ] Filter buttons (Active, High priority, Awaiting dispatch, Completed, All) change the cards.
- [ ] Each card has VIEW INCIDENT, DISPATCH AMBULANCE, TRACKING, HOSPITAL, NOTIFICATION.
- [ ] INC-2026-0002 shows "Unknown" for blood group and allergy (missing data handled).

**Ambulances and status flow**
- [ ] Assigning AMB-001 changes it from AVAILABLE to ASSIGNED and shows a success message.
- [ ] The incident page and dashboard show AMB-001.
- [ ] Only one button is shown at a time: START JOURNEY, MARK ARRIVED, PATIENT PICKED UP, START TO HOSPITAL, MARK HOSPITAL ARRIVED.
- [ ] START TO HOSPITAL is disabled until a hospital is selected.
- [ ] Trying to dispatch a second ambulance to the same incident shows an error.
- [ ] With both ambulances assigned, dispatching a third incident shows "No ambulance is available".

**Notifications**
- [ ] Only authorized contacts appear (INC-2026-0001 has 2, INC-2026-0002 has none with a clear message).
- [ ] The three simulate buttons show "SMS SIMULATED", "WhatsApp NOTIFICATION SIMULATED", "VOICE CALL SIMULATED".
- [ ] The log shows time, recipient, message and status.
- [ ] Tick "Test failure handling" and a failure message appears instead of a crash.

**Tracking**
- [ ] The map shows the emergency, ambulance and hospital markers and a route line.
- [ ] The ambulance marker moves every few seconds and the ETA goes down.
- [ ] The label "DEMO / SIMULATED TRACKING" is visible.

**Hospitals**
- [ ] City Emergency Hospital and Central Hospital are selectable. Riverside Medical Centre is disabled with a reason.
- [ ] After selecting, the handoff card shows the incident ID, ambulance and ETA.

**Automation (section 19 has the full procedure)**
- [ ] Opening the dashboard shows `AUTO-DISPATCH ACTIVE` and the log fills in by itself.
- [ ] AMB-001 (advanced, 2.1 km) is chosen, not the closer basic AMB-002. HOSP-001 (trauma) is chosen, not the closer HOSP-002.
- [ ] INC-2026-0002 (unverified) and INC-2026-0003 (LOW) are NOT dispatched automatically.
- [ ] Stop the AI service: the workflow still completes and shows `FALLBACK MODE`.
- [ ] MANUAL OVERRIDE pauses automation, swap ambulance / change hospital are logged as OPERATOR actions.

**Errors**
- [ ] `incident.html?id=INC-9999` shows a friendly "Incident not found" message and a link back.
- [ ] `incident.html` with no ID asks you to choose an incident.

**Responsive**
- [ ] Narrow the browser to phone width: the menu collapses into a button and cards stack.

## 13. Common errors and solutions

| Problem | Cause and fix |
|---|---|
| Page shows no styling | You opened the wrong folder. Open `member3`, then run Live Server on `frontend/index.html`. |
| "Go Live" does nothing | Install the Live Server extension, then right-click `index.html` > Open with Live Server. |
| Map is grey or "Map could not be loaded" | The Leaflet library or map tiles could not be downloaded. Check your internet connection and refresh. |
| Old or odd demo data | Click **Reset demo data** on the dashboard (or clear site data in the browser). |
| Changes do not appear on another page | Make sure both pages are opened from the same Live Server address. `127.0.0.1` and `localhost` keep separate data. |
| "Cannot reach the backend" in live mode | Member 2's server is not running, `API_BASE_URL` is wrong, or CORS is not enabled for the Live Server address. |
| "Incident ... was not found" | The ID in the URL does not exist. Pick one from the incident drop-down. |
| "Invalid status change" | You tried to skip a step. Use the button shown, because only the next step is allowed. |
| Hospital button disabled | Assign an ambulance first, or that hospital's emergency department is unavailable. |
| Console error `api is not defined` | `api.js` must load before the page script. Do not change the order of the `<script>` tags. |

## 14. AI-assisted automation: what it does

```
Emergency detected -> Member 2 verifies -> Member 3 receives the verified incident
   -> AI / ranking engine recommends an ambulance
   -> deterministic safety rules validate it against FRESH data
   -> backend validates it again (availability, conflicts, status order)
   -> ambulance ASSIGNED -> EN_ROUTE (simulated tracking starts, ETA shown)
   -> authorized family notification (simulated) is recorded
   -> AI / ranking engine recommends a hospital -> safety rules -> backend -> hospital assigned
   -> AI EMS summary is generated and kept up to date
```

What is automatic: ambulance selection and assignment, `ASSIGNED -> EN_ROUTE`, tracking start, family notification,
hospital selection and assignment, `EN_ROUTE -> ARRIVED` and `TO_HOSPITAL -> HOSPITAL_ARRIVED` (simulated-GPS geofence),
`PATIENT_PICKED_UP -> TO_HOSPITAL` (when a hospital is already assigned), the summary and the activity log.

What is deliberately **not** automatic: `PATIENT_PICKED_UP` (a human confirms the patient is on board), incidents
that are unverified or below the severity threshold (`AUTOMATION_CONFIG` in `api.js`), and anything while the operator has taken over.

### The three decision modes (shown honestly in the UI)

| Badge | Meaning |
|---|---|
| **AI MODE** | An external LLM chose between candidates that the scoring engine had already declared eligible, and the safety rules accepted its choice. |
| **ENGINE MODE** | The AI service's weighted scoring engine decided (no LLM key set, or the LLM answer was rejected). This is the default demo mode. |
| **FALLBACK MODE** | The AI service was unreachable or returned invalid data. Local rules chose the *nearest suitable available* unit. |
| **RULES MODE** | `AI_ENABLED = false`. Local rules only. |
| **MANUAL** | The operator chose. |

Nothing is faked: scores shown are always computed by the scoring engine (never invented by an LLM), and in FALLBACK/RULES
mode no score is shown at all.

### Switches in `frontend/js/api.js`

| `AI_ENABLED` | `AUTO_DISPATCH_ENABLED` | Result |
|---|---|---|
| `true` | `true` | **AI mode.** AI service first, safe fallback if it fails. |
| `false` | `true` | **Demo / rules mode.** Automatic dispatch with local rules, no AI calls. |
| any | `false` | **Manual mode.** Original behaviour, operator clicks everything. |

`AUTOMATION_CONFIG` (same file) controls which severities are auto-dispatched (`["HIGH"]`), whether Member 2's verification is required,
the heartbeat (`tickMs`), the pause between steps for a readable demo (`stepDelayMs`, set `0` for instant), the geofence and the notification channel.

## 15. Safety architecture

```
AI recommendation  ->  Deterministic safety/business rules (rules.js)  ->  Backend validation (api.js / Member 2)  ->  Action
```

1. **The AI never acts.** It returns data. `rules.js` validates its JSON (IDs, score range, ETA range, known mode) and
   re-checks the chosen unit against freshly fetched data before any action. No AI text is ever executed or inserted as HTML.
2. **Ambulance rules** (`validateAmbulanceChoice`): incident exists, has coordinates and no ambulance yet, is not completed; ambulance exists, is
   `AVAILABLE`, not linked to another incident, has a position; a basic unit is rejected for a HIGH incident while an advanced unit is free.
3. **Hospital rules** (`validateHospitalChoice`): ambulance already assigned, hospital exists, emergency department `AVAILABLE`, beds above zero, has a
   position; a hospital without the required capability (trauma) is rejected while a capable one is open.
4. **If validation fails** the system logs `Safety validation FAILED ...` and switches to the deterministic fallback pick, then validates that too.
   If that also fails it stops and asks the operator.
5. **Backend validation**: the mock API (and Member 2's real one) still enforces one ambulance per incident, valid status order,
   available hospitals, authorized contacts only. Repeated backend rejections (3) engage MANUAL OVERRIDE instead of looping.
6. **Status transitions** use the ordered state machine; `AVAILABLE -> HOSPITAL_ARRIVED` and any skip are rejected.
7. **Privacy**: the AI service receives only IDs, coordinates, severity, incident type, capability, equipment and location label.
   **Never** blood group, allergies, patient name, identity confidence or biometric data (verified by a test). Family messages contain no medical data.
8. **Keys**: `AI_API_KEY` lives only in the AI service environment. No key exists anywhere in `frontend/`.
9. **Prompt-injection hardening**: the LLM only sees sanitised structured JSON, is told every field is data, must answer with a tiny JSON object,
   and its choice must be a known eligible ID that passes the safety rules.
10. **AI service hardening**: input validation and size limit (64 KB), CORS allow-list (localhost only by default), rate limit, binds to `127.0.0.1`, static file serving blocks path traversal, errors never echo request bodies or keys.

## 16. The AI service (`ai-service/`)

| Endpoint | Purpose |
|---|---|
| `GET /api/ai/health` | `{ status: "ONLINE", llm_configured: true/false }` (never exposes the key or model) |
| `POST /api/ai/ambulance-recommendation` | body `{ incident, ambulances[] }` -> best ambulance |
| `POST /api/ai/hospital-recommendation` | body `{ incident, hospitals[] }` -> best hospital |
| `POST /api/ai/incident-summary` | body `{ facts }` -> LLM-written summary (503 `LLM_NOT_CONFIGURED` without a key; the UI then uses a template summary and labels it) |

Example ambulance response:

```json
{
  "recommended_ambulance": "AMB-001",
  "ambulance_score": 86,
  "estimated_eta_minutes": 5,
  "distance_km": 2.1,
  "reason": "Advanced life-support unit; 2.1 km / 5 min away; meets the advanced-care requirement; has the required equipment.",
  "ranking": [ { "ambulance_id": "AMB-001", "score": 86, "...": "..." }, { "ambulance_id": "AMB-002", "score": 58, "...": "..." } ],
  "mode": "SCORING_ENGINE",
  "llm_used": false,
  "notice": "No LLM key configured - scoring engine only."
}
```

### The ranking model (explainable, no black box)

This is a **weighted multi-criteria score, not a trained machine-learning model**. A trained model would need real dispatch data that a
college prototype does not have; a transparent formula can be checked by hand and defended.

**Ambulance score** (0 to 100) = 0.45 × ETA + 0.30 × capability + 0.15 × equipment + 0.10 × workload
- ETA score = `100 - 5 × eta_minutes` (min 0); ETA = distance ÷ 25 km/h (haversine distance, no live traffic)
- capability: HIGH incident needs ADVANCED (advanced 100, basic 20); otherwise basic 100, advanced 90 (keeps advanced units free)
- equipment: share of required items present (trauma needs a spinal board, cardiac a defibrillator, HIGH needs oxygen)
- workload = `100 - 15 × missions_today`

Worked example for INC-2026-0001: AMB-001 = 0.45×75 + 0.30×100 + 0.15×100 + 0.10×70 = **86**; AMB-002 = 0.45×80 + 0.30×20 + 0.15×50 + 0.10×85 = **58** (closer, but loses).

**Hospital score** = 0.35 × ETA + 0.45 × capability + 0.20 × beds; ETA = distance ÷ 37 km/h, ETA score = `100 - 4 × eta`, capability is 100/0 against the
required capability (trauma for TRAUMA incidents), beds = `10 × min(beds, 10)`. Hospitals with the emergency department unavailable or no beds are excluded.
Example: HOSP-001 = **81** (trauma), HOSP-002 = **35** (closer, no trauma).

### Where the LLM fits (optional)
With a key set, the LLM receives the already-scored eligible candidates and chooses one and writes the explanation (and writes the incident summary).
It cannot add candidates, change scores, or bypass the safety rules. If it times out, answers badly, invents an ID, or picks something unsafe,
the service returns the scoring engine's pick and says so in `notice`. The default model is `claude-sonnet-5-5` and is configurable (`AI_MODEL`, `AI_API_URL`).
The LLM path is covered by tests using a fake LLM server; it has not been exercised against a live provider in this build, so try it once with your key before the demo.

## 17. Manual override and the activity log

On the dashboard, for the incident being monitored:
- **MANUAL OVERRIDE**: automation stops acting on that incident immediately, even mid-pipeline (it re-checks before every action). **RESUME AUTO MODE** hands it back.
- **PAUSE ALL AUTOMATION** (banner): global pause for every incident.
- **SWAP AMBULANCE / ASSIGN AMBULANCE**: the old unit is released (only before it reaches the scene). The human has the final say: choosing a basic unit
  for a HIGH incident is allowed but logged as a warning. An ambulance that is unavailable is refused.
- **CHANGE HOSPITAL / ASSIGN HOSPITAL**: an unavailable hospital is refused even for the operator.
- **RETRY NOTIFICATION**: re-sends only to contacts that did not already succeed.
- **Change status**: only the next valid status is offered; the backend rejects anything else.
- **RUN AUTO-DISPATCH NOW**: lets automation handle an incident below the severity threshold.
- Manual assignments made on the Ambulances or Hospitals pages are also logged and pause automation for that incident.

Every automatic step and every operator action is written to the **Automation activity log** (`OPERATOR` actions are tagged).
Failures are shown, not hidden: no ambulance, backend rejection, AI unavailable, malformed AI answer, notification failure,
missing coordinates, missing hospital data, invalid status change. Waiting conditions are logged once, not every few seconds.

## 18. Fallback when AI fails

```
AI unavailable / malformed / unsafe  ->  "AI unavailable - using safe fallback dispatch logic"  ->  nearest SUITABLE available unit
```
Suitable = an advanced unit for a HIGH incident if one exists, otherwise the nearest available unit (with a logged warning so the response is never delayed).
The same applies to hospitals (nearest open emergency department with the required capability). The fallback shows no score because it computes none.
The dashboard chip shows `AI EMS ENGINE: OFFLINE` and recommendations carry the `FALLBACK MODE` badge.

## 19. How to test the automated workflow

**Automated tests (no browser, no network):**
```bash
cd member3
node ai-service/test/run-tests.js     # 25 tests: scoring, validation, LLM failure modes, CORS, key never leaks
node tests/pipeline.test.js           # 25 tests: full workflow, fallback, overrides, errors, privacy
```

**Manual demo (about 2 minutes):**
1. `cd member3/ai-service && node server.js`, open `http://localhost:8787/`. Click **Reset demo data** if you used it before.
2. Do nothing. Watch the banner `AUTO-DISPATCH ACTIVE` and the activity log. Within about 15 seconds you see:
   `Incident received` -> `AI ambulance analysis started` -> `AMB-001 recommended [ENGINE MODE]` -> `Safety validation passed` ->
   `AMB-001 automatically assigned` -> `Status changed to EN_ROUTE` -> `Live tracking started (DEMO / SIMULATED GPS)` ->
   `Family notification initiated` -> `AI hospital analysis started` -> `HOSP-001 ... recommended` -> `City Emergency Hospital automatically assigned`.
3. Check the timeline (7 ticks), the AI recommendation card (scores, reasons), the AI EMS summary, and the fleet table (AMB-001 EN_ROUTE, AMB-002 AVAILABLE).
4. Open **Tracking** (needs internet for the map): the ambulance moves and the ETA falls. Open **Notifications**: two `SIMULATED · AUTO` entries, the unauthorized neighbour is absent.
5. **Override:** on the dashboard press **MANUAL OVERRIDE**, choose AMB-002, press **SWAP AMBULANCE**. See the OPERATOR lines and the warning in the log. Press **RESUME AUTO MODE**.
6. **Failure handling:** tick *DEMO: make the next automatic notification fail*, **Reset demo data**: the timeline shows `FAILED`, then press **RETRY NOTIFICATION**.
7. **AI failure:** stop the AI service (Ctrl+C), reload (Live Server) or reset: the log says `AI unavailable - using safe fallback dispatch logic`, chip `OFFLINE`, badges `FALLBACK MODE`, and dispatch still completes.
8. **Status:** when the ambulance reaches the scene the status becomes `ARRIVED` by itself. Click **PATIENT PICKED UP** (or the dashboard status button), and it continues to `TO_HOSPITAL` and `HOSPITAL_ARRIVED` by itself.
9. Try an invalid jump with the dashboard status control: only the next valid status is offered, and the backend rejects anything else.

## 20. Limitations of the automation (be honest in the viva)

- Orchestration runs in the browser while the dashboard is open (frontend-only demo). Production needs it server-side.
- The scoring engine is a hand-tuned formula, not a trained model. Its weights are assumptions that would be tuned on real dispatch outcomes.
- ETA is distance ÷ assumed speed on straight lines. There is no traffic or road routing, and no "AI ETA".
- GPS, SMS, WhatsApp and calls are simulated. Nothing leaves the browser except requests to the local AI service.
- The automation log and AUTO MODE flags are stored in the operator's browser (not shared between operators).
- The live LLM call could not be tested against a real provider in this build; the LLM path is tested with a fake server.
- No login, no audit trail and no HTTPS in the prototype. A real deployment needs all three.

## Security notes

- Only fictional demo data is used. Phone numbers are masked placeholders, not real numbers.
- Notifications never include blood group, allergy or other medical details.
- Only contacts marked `authorized` are shown or notified.
- Tracking is an internal EMS page. There is no public tracking link.
- Simulated tracking and notifications are labelled DEMO / SIMULATED on screen.
- Identity is described as an AI-assisted match that medical staff must confirm.
- AI keys are server-side only (`ai-service/.env`), and the AI service receives no medical or biometric data.
- AI output is validated and can never trigger an action by itself (section 15).
- A real deployment would also need sign-in for operators, HTTPS and audit logs. This prototype has none of these.

## Viva questions and answers

**1. What is your module responsible for?**
Everything after an emergency has been identified: the EMS dashboard, ambulance dispatch and status flow, family notification, live tracking and hospital assignment.

**2. Why did you use a mock API?**
Member 2's backend was not ready. The mock lets me build and demonstrate the whole workflow now, and it follows the agreed API contract, so the real backend can replace it later.

**3. How do you switch from mock data to the real backend?**
In `api.js` set `USE_MOCK_API = false` and set `API_BASE_URL`. All `fetch()` calls are in `api.js`, so the page scripts do not change.

**4. Why is there a single `incident_id`?**
It links every step: emergency, identity, ambulance, notification, tracking, hospital, status and handoff. Member 4 uses the same ID to retrieve the incoming patient. If each page created its own ID, the records could not be joined.

**5. How do you prevent invalid status changes?**
The status flow is an ordered list. A change is accepted only when it is exactly the next item, so AVAILABLE cannot jump to HOSPITAL_ARRIVED. The UI only shows the one valid next button, and the mock API also rejects invalid requests, as the real backend should.

**6. Is the live tracking real GPS?**
No. It is simulated. The ambulance marker is moved towards its destination on a timer, and this is labelled "DEMO / SIMULATED TRACKING". Real tracking would need the ambulance's device to send GPS positions to Member 2's backend.

**7. Do you really send SMS, WhatsApp or calls?**
No. The buttons only record a simulated notification. A real system would need an SMS or WhatsApp provider, consent, and rate limiting.

**8. How is patient privacy handled?**
Only fictional data is used. Contacts must be authorized and their numbers are masked. Messages contain no medical details. Tracking is not on a public URL. A real system would add operator login, HTTPS and audit logging.

**9. Does a face match prove who the patient is?**
No. It is a probable match from an AI model and can be wrong. The UI says so, and the hospital must confirm identity before relying on it. Dispatch is not delayed while identity is unverified.

**10. How does hospital assignment connect to Member 4?**
`POST /api/incidents/{incident_id}/hospital` stores `hospital_id`, `ambulance_id` and `eta_minutes` on the incident. Member 4 reads that incident with `GET /api/incidents/{incident_id}`.

**11. What happens when something fails?**
Errors are turned into plain messages: unknown incident, no ambulance available, ambulance already assigned, invalid status change, unavailable hospital, failed notification, failed request and missing data. The page shows a message and a way back instead of going blank.

**12. How is the ETA calculated in the demo?**
The distance between the two points is computed with the haversine formula and divided by an assumed speed (25 km/h to the scene, 37 km/h to the hospital).

**13. What are the limitations?**
Demo data only, straight-line routes instead of roads, simulated GPS and notifications, no login, and data stored in the browser instead of a database.

**14. What would you improve next?**
Real GPS updates over WebSockets, road routing, a real notification provider, operator authentication, and automatic ambulance and hospital suggestions based on traffic and bed availability.

**15. Where exactly is AI used, and is it safe?**
In ambulance ranking, hospital ranking and the incident summary. The scoring engine computes the scores; an optional LLM may choose among already-eligible candidates and write the explanation. Its output is validated JSON that is re-checked by deterministic rules against fresh data and then by the backend, so an AI answer alone can never dispatch anything.

**16. What if the AI service is down or returns rubbish?**
The workflow does not stop. The log says "AI unavailable - using safe fallback dispatch logic" and the nearest suitable available unit is used, labelled FALLBACK MODE. Malformed or unsafe AI output is rejected the same way.

**17. Why not simply send the nearest ambulance?**
A basic unit that is 0.6 km closer is the wrong unit for a HIGH trauma case. The engine weighs response time, advanced-care capability, equipment and workload, and the safety rules forbid a basic unit while an advanced one is free. Same idea for a trauma hospital versus a closer hospital without trauma care.

**18. Is the AI model really a machine-learning model?**
No, and the UI does not claim it is. It is a transparent weighted scoring formula (ENGINE MODE), optionally combined with an LLM (AI MODE). With real dispatch history we could train a model, keeping the same safety layer and fallback.

**19. How does the human stay in control?**
Per-incident MANUAL OVERRIDE and a global pause, swap ambulance, change hospital, retry notification, change status, and everything is in the activity log. Automation re-checks before every action, so an override takes effect mid-workflow.

**20. How do you protect the API key?**
It is read only from the AI service's environment. The browser talks to the AI service, never to the LLM, so no key is ever in frontend code.
