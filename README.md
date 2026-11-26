# Hospital ER Dashboard & Medical Handoff Module (Member 4)

Part of **Emergency SOS Face Identification & Medical Handoff System** (college prototype).
This module covers steps 4–8 of the flow: receive the incoming patient → view the authorized emergency summary → prepare the ER → record the medical handoff → update treatment status.

> **Prototype only.** All patients, staff, ambulances and blood-bank stock are **synthetic DEMO DATA**. Never connect it to real medical or dispatch systems without authorization.

## Stack

React 19 · Vite · Tailwind CSS 4 · React Router · Lucide icons. Plain JavaScript, no extra runtime dependencies.
It is a **frontend module only**: it talks to Member 2's central backend over REST/JSON and creates no backend of its own.
(No stack was found in the repository when this was built, so the brief's default stack was used. If the team picked something else, the `services/` layer is the only part that touches HTTP.)

## Run it

Requires Node 20+.

```bash
cd hospital-dashboard
npm install
cp .env.example .env        # optional; defaults already run in demo mode
npm run dev                 # http://localhost:5174
npm test                    # service-layer + workflow tests, no install needed
npm run build               # production bundle in dist/
```

### Demo mode vs. real backend

| `.env` | Behaviour |
|--------|-----------|
| `VITE_USE_MOCK=true` (default) | Built-in simulated backend, 5 synthetic patients stored in `localStorage`. A magenta **DEMO DATA** banner is always shown. |
| `VITE_USE_MOCK=false` | Calls `VITE_API_BASE_URL` (default `http://localhost:8000`). **No silent fallback** to demo data: if the server is down you see an error. |

Other settings: `VITE_REQUEST_TIMEOUT_MS`, `VITE_POLL_INTERVAL_MS`, `VITE_HOSPITAL_NAME`. Everything `VITE_*` is public in the browser bundle, so never put secrets there.

### Demo accounts (synthetic, demo mode only)

| Role | Staff ID | Password |
|------|----------|----------|
| ER Doctor | `DOC-001` | `Demo-Doctor-1` |
| Paramedic | `PARA-001` | `Demo-Paramedic-1` |
| Hospital Administrator | `ADM-001` | `Demo-Admin-1` |

They exist only in the demo backend (`src/services/backends/mock/demoData.js`) and are shown on the login page only when demo mode is on.

**Demo tools** (banner → "Demo tools"): reset demo data, simulate a backend outage, expire the current token.

## Pages

| # | Route | Page | Roles |
|---|-------|------|-------|
| 1 | `/login` | Staff login | all |
| 2 | `/` | Dashboard: summary cards, trauma alerts, recently received, ambulance arrivals, activity, status overview | all |
| 3 | `/incidents` | Incoming trauma queue: search by ID/name, filter by status, sort by ETA or priority, refresh | all |
| 4 | `/patients/:id` | Patient emergency profile (identity, medical, incident, contacts) | doctor (full), paramedic (limited) |
| 5 | `/tracking/:id` | Ambulance tracking & ETA, map, labelled simulation mode | all |
| 6 | `/handoff/:id` | Medical handoff: paramedic form, doctor assessment, Accept Patient, treatment notes, record history | doctor, paramedic |
| 7 | `/status/:id` | Status management with permitted-transition buttons and change history | doctor, paramedic (admin: view) |
| 8 | `/timeline/:id` | Visual incident timeline from backend timestamps | all |
| 9 | `/blood-bank/:id` | Blood bank preparation indicator (informational) | doctor |
| 10 | `/audit` | Audit & history, access history, filters | **admin only** |

Pages 4–9 without an `:id` show an incident picker. Every incident is keyed by the shared `incident_id`; the module never creates incidents.

### Dashboard card definitions

* **Total Incoming** – status `IDENTITY_VERIFIED`, `EMS_NOTIFIED`, `AMBULANCE_ASSIGNED` or `EN_ROUTE`
* **Arrived** – `ARRIVED` · **In ER** – `IN_ER` · **Under Treatment** – `UNDER_TREATMENT`
* **Critical** – severity `CRITICAL`/`HIGH` and not yet `STABLE`/`OTHER_OUTCOME`/`CLOSED`

### Status workflow

`EN_ROUTE → ARRIVED → IN_ER → UNDER_TREATMENT → STABLE | OTHER_OUTCOME → CLOSED`
Earlier stages belong to the EMS module (Member 3). Invalid transitions are blocked in the UI and again by the backend. Each change records incident ID, previous/new status, staff ID, timestamp and notes. `OTHER_OUTCOME` requires a note.

## Safety & security design

* **Role-based access** (`src/utils/permissions.js`): menu items, routes and buttons follow the role. These are UX only; **the backend must enforce the same rules** (see `docs/API_INTEGRATION.md`).
* **Unverified identity is never treated as confirmed**: name, age and medical details are shown only when `identity_status === 'VERIFIED'`; otherwise "Unconfirmed".
* **Missing data is shown as missing** ("Not available", "Restricted for your role"), never invented. `null` = unknown, `[]` = recorded as none.
* **Blood group** is always marked *Unverified* unless the backend says otherwise. The blood bank page is an informational aid and states that typing, compatibility testing and hospital protocols must be followed. Nothing is auto-selected or issued.
* **No treatment recommendations** anywhere: the handoff form only records information.
* **Handoffs**: required-field validation, a confirmation dialog before saving, a per-attempt idempotency key (a retry never duplicates a note), duplicate detection, append-only history. Staff ID and timestamps are set by the backend from the token; doctor ID/name are read-only from the session.
* **Sessions**: short-lived token held in memory + `sessionStorage`, auto sign-out at expiry and on any `401`, best-effort server-side revocation on logout. A cookie-based `httpOnly` session is recommended for production (see integration doc).
* **Audit**: profile access, handoffs, notes, status changes, closures and denied attempts are logged (by the backend; by the demo backend in demo mode).
* **Maps / GPS**: positions without `source: "GPS"` are labelled **SIMULATED**. The optional movement simulation runs only in your browser and is never stored or sent.
* **Real-time**: controlled polling (default 15 s, paused while the tab is hidden, plus manual Refresh). Swap in SSE/WebSocket in `src/hooks/useIncidents.js` if Member 2 adds one.

### Error handling coverage

Backend unavailable · invalid login · expired token · unauthorized profile access · missing patient data · no ambulance tracking · no ETA · failed handoff submission · invalid status transition · duplicate medical notes · network timeout · missing blood group. A failed background refresh keeps the last data on screen with a "showing last data" banner.

## Project structure

```
src/
  App.jsx, main.jsx              router + providers, permission-guarded routes
  components/                    Sidebar, Navbar, StatCard, PatientTable, StatusBadge, Timeline,
                                 ConfirmDialog, DataStates, Field, TrackingMap, DemoBanner, …
  pages/                         the 10 pages above
  services/
    api.js                       HTTP client (base URL, bearer token, timeout, error mapping)
    backend.js                   real vs. demo switch (VITE_USE_MOCK)
    backends/realBackend.js      Member 2's REST endpoints
    backends/mock/               clearly labelled synthetic backend + seed data
    incidentService.js, hospitalService.js, authService.js, normalize.js
  context/                       AuthContext, ToastContext
  hooks/                         useAsyncData (polling, stale-data handling), useIncidents
  utils/                         statuses, permissions, validators, format
tests/                           node:test suites
docs/API_INTEGRATION.md          exact endpoints/JSON needed from Member 2 (and Member 3 fields)
```

## Demo data (5 synthetic patients)

| Incident | Scenario |
|----------|----------|
| `INC-2026-0001` | Verified · O+ (unverified) · Penicillin allergy · Asthma · ambulance **en route** |
| `INC-2026-0002` | Verified · B+ · no known allergies · Diabetes · **arrived** |
| `INC-2026-0003` | Identity **pending review** · blood group unknown · no confirmed profile · ambulance assigned |
| `INC-2026-0004` | Verified · AB+ · **pacemaker** · **in ER** |
| `INC-2026-0005` | Verified · A+ · no known allergies · **under treatment** |

## Testing

### Automated (`npm test`, 16 tests)

Run against the demo backend through the real service layer:
full workflow (login → dashboard data → profile → tracking → arrive → IN_ER → paramedic handoff → doctor acceptance → notes → UNDER_TREATMENT → STABLE → CLOSED → audit), unauthorized access and admin data minimisation, expired/revoked tokens, invalid login and malformed responses, invalid transitions (client and server), note ordering/duplicates/idempotent retries, missing and unverified data, backend outage, seed scenarios, permissions and validators.

### Manual walkthrough (≈5 min)

1. Open the app, sign in as **ER Doctor** → Dashboard shows 5 patients and the cards.
2. **VIEW PATIENT** on `INC-2026-0001` → blood group shows *Unverified*; open **Ambulance Tracking** and try *Start simulated movement* (labelled SIMULATED).
3. Sign out, sign in as **Paramedic** → `INC-2026-0001` → *Status*: **Mark as Arrived**, then **Mark as In ER** (confirm dialogs).
4. *Medical Handoff*: submit empty (validation errors) → fill in → **Save Handoff** → confirm. Check the record appears under *Previous handoff records*.
5. Sign in as **Doctor** → *Handoff*: **Accept Patient**, add a treatment note (try the same text twice → duplicate error).
6. *Status*: **Under treatment** → **Stable** → **Closed**. Check the *Timeline*.
7. Sign in as **Admin** → *Audit & History* shows every action; clinical pages are not available to this role.
8. Demo tools: **Simulate backend outage** (error panels, stale-data banner), **Expire my session token** (automatic sign-out), **Reset demo data**.
9. Open `INC-2026-0003` → identity "Pending review", name/medical shown as *Unconfirmed*, blood bank says no blood group on record.

## Verification status — please read

This build was produced in an environment **without network access to the npm registry**, so `npm install`, `vite dev` and `vite build` were **not run** there. What was verified instead:

* the 16 `node:test` tests pass;
* every page and `App.jsx` compile with esbuild and render without errors (server-side render with stubbed router/icon packages), including data-driven renders of the handoff, status, timeline, blood-bank and audit pages for all five incidents and all three roles (37/37 checks).

Not yet verified: real-browser visuals/responsiveness, the map in a live browser (`TrackingMap.jsx` is a dependency-free SVG **schematic** showing relative positions, with no street tiles; swap in Leaflet or Google Maps later, the props stay the same), and any call to Member 2's real backend. Please run `npm install && npm run dev` once and click through the manual walkthrough. Screenshots are not included for the same reason.

## Assumptions and missing integrations

* Endpoints 6–11 in `docs/API_INTEGRATION.md` (login, logout, list notes, timeline, blood bank, audit) are **not** in the agreed list; they are written as a proposed contract and report "not supported by the backend yet" if absent.
* Field names are adapted in one place (`src/services/normalize.js`) once Member 2's real schema is known.
* Tracking field names (`location.source`, `eta_minutes`, hospital coordinates) need confirmation from Member 3.
* "Manage hospital staff accounts" (administrator role in the brief) is **not implemented**: it needs account-management endpoints that do not exist in the agreed contract.
* Organ-donor preference is shown only to roles the backend releases it to (doctor, in demo mode).
