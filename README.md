# MediRescue AI: Central Backend (Member 2)

FastAPI + SQLAlchemy + SQLite. This is the hub that Members 1, 3 and 4 all call.
**All patient data is synthetic. Notifications are mocked.**

## 1. Run it

```bash
python -m venv venv
venv\Scripts\activate            # Windows   (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
uvicorn main:app --reload
```

- API docs: http://127.0.0.1:8000/docs → click **Authorize**, log in as `ems1` / `ems123`
- The database is created and filled with demo data automatically on first start.
- Start fresh any time: `python seed.py --reset`

Let teammates on the same Wi-Fi connect: `uvicorn main:app --host 0.0.0.0 --port 8000`,
then they use `http://<your-laptop-IP>:8000`. For a public URL: `ngrok http 8000`.

## 2. Test it

```bash
pytest -v
```
Runs the full demo script (SOS → hospital handoff → closed) plus every item on the testing checklist
(no GPS, poor scan, no match, ambiguous match, unauthorized user, expired/revoked token, duplicate request,
notification failure, invalid status jump, audit logging).

**Postman:** import `docs/MediRescue.postman_collection.json`, run folder **1. Log in**, then **2. Full demo flow**.

## 3. Demo logins

| user | password | role |
|---|---|---|
| field1 | field123 | field_responder (Member 1) |
| ems1 | ems123 | ems (Member 3) |
| doctor1 | doctor123 | hospital, HOSP-001 (Member 4) |
| nurse2 | nurse123 | hospital, HOSP-002 |
| admin | admin123 | admin |

## 4. Project layout

```
backend/
├── main.py                  app, CORS, routers, auto-seed
├── config.py / .env         all settings (thresholds, token lifetimes, CORS…)
├── constants.py             roles, statuses, allowed transitions (the shared contract)
├── database.py              DB connection
├── models/                  8 tables from the spec + staff, notification_logs, incident_access_tokens
├── schemas.py               request validation
├── security.py              login tokens, incident tokens, role checks
├── seed.py                  synthetic demo data
├── routes/
│   ├── auth.py              login, incident tokens, audit logs
│   ├── incidents.py         create, list, scan, review, status, notes, timeline
│   ├── profiles.py          role-filtered emergency profile
│   ├── dispatch.py          dispatch, tracking, ambulances, family notifications
│   ├── hospital.py          ER queue, blood bank, ER status
│   └── demo.py              fake scans for testing without a face model
├── services/
│   ├── matching_service.py  face matching policy
│   ├── face_embedder.py     optional image → embedding (DeepFace)
│   ├── notification_service.py  mock SMS + failure handling
│   ├── incident_service.py  status changes, scoping
│   ├── audit_service.py
│   └── geo.py               distance / ETA
├── docs/API.md              ← give this to your teammates
└── tests/test_end_to_end.py
```

## 5. How matching works (for the viva)

1. The scan becomes a 128-number **embedding** (on the phone, or on the server in image mode).
2. It is compared (cosine similarity) only against users who **gave consent**.
3. Policy, never just "highest score wins":
   - score ≥ 0.80 **and** clearly ahead of the runner-up (≥ 0.05) → `IDENTITY_VERIFIED`
   - score ≥ 0.80 but runner-up too close → `AMBIGUOUS` → `MATCH_REVIEW`
   - 0.60–0.80 → `NEEDS_REVIEW` → `MATCH_REVIEW`
   - < 0.60 → `NO_MATCH` → `MATCH_REVIEW` (treated as unidentified)
4. In review, a human compares candidates (name/age/gender only, no medical data) and confirms or rejects.
5. Dispatch never waits for identity.

Thresholds are in `.env`.

## 6. Image mode (only if Member 1 sends photos)

```bash
pip install deepface tf-keras
```
Then `scan_data` can be a base64 JPEG. Demo users have random reference embeddings, so to match a real face,
enrol a teammate's photo (with their consent) as a demo user: `POST /api/admin/users/USR-001/enroll-face`
as admin with `{"scan_data": "<base64 photo>"}`. Photos are never stored.

## 7. Before hosting

- Set a long random `JWT_SECRET` in `.env`
- Set `CORS_ORIGINS` to your teammates' frontend URLs
- Set `DEMO_MODE=false` if demo helpers should be hidden
