"""End-to-end test: the demo script from section 7 + the testing checklist from section 9.

Run from the backend folder:   pytest -v
"""
import os
import sys
import tempfile
import uuid
from datetime import timedelta

DB_FILE = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE}"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from config import settings  # noqa: E402
from main import app  # noqa: E402
from models import utcnow  # noqa: E402

GPS = {"latitude": 28.4744, "longitude": 77.4900}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def tokens(client):
    return {
        "field": login(client, "field1", "field123"),
        "ems": login(client, "ems1", "ems123"),
        "doctor": login(client, "doctor1", "doctor123"),
        "nurse2": login(client, "nurse2", "nurse123"),
        "admin": login(client, "admin", "admin123"),
    }


def new_incident(client, tokens, **extra):
    body = {"client_request_id": str(uuid.uuid4()), **GPS, "severity": "HIGH", **extra}
    r = client.post("/api/incidents", json=body, headers=tokens["field"])
    assert r.status_code == 201, r.text
    return r.json()["incident_id"]


def scan_for(client, tokens, user_id=None, noise=0.03):
    params = {"noise": noise, **({"user_id": user_id} if user_id else {})}
    return client.get("/api/demo/test-scan", params=params, headers=tokens["field"]).json()["scan_data"]


# ------------------------------------------------------------------ section 7: full demo
def test_full_demo_flow(client, tokens):
    # 1-2. SOS -> incident created
    inc = new_incident(client, tokens)
    assert inc.startswith("INC-")

    # 3-5. scan + GPS -> verified
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens, "USR-001"), **GPS},
                    headers=tokens["field"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "IDENTITY_VERIFIED"
    assert "name" not in r.json()                          # field app never gets PII

    # 6. profile by role
    assert client.get(f"/api/incidents/{inc}/profile", headers=tokens["field"]).status_code == 403
    ems_profile = client.get(f"/api/incidents/{inc}/profile", headers=tokens["ems"]).json()["profile"]
    assert ems_profile["name"] == "Aarav Mehta" and ems_profile["blood_group"] == "O+"
    assert "donor_preference" not in ems_profile           # EMS sees less than hospital

    # 7. EMS queue
    queue = client.get("/api/incidents", params={"status": "IDENTITY_VERIFIED"}, headers=tokens["ems"]).json()
    assert any(i["incident_id"] == inc for i in queue)

    # 8-9. dispatch AMB-001 to HOSP-001 + family notified
    r = client.post(f"/api/incidents/{inc}/dispatch", json={"ambulance_id": "AMB-001", "hospital_id": "HOSP-001"},
                    headers=tokens["ems"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "AMBULANCE_ASSIGNED"
    assert r.json()["family_notifications"]["sent"] == 2

    # 10. tracking
    client.patch(f"/api/incidents/{inc}/status", json={"status": "EN_ROUTE"}, headers=tokens["ems"])
    t1 = client.get(f"/api/incidents/{inc}/tracking", headers=tokens["ems"]).json()
    t2 = client.post(f"/api/incidents/{inc}/tracking/simulate", headers=tokens["ems"]).json()
    assert t1["eta_minutes"] is not None and t2["distance_km"] <= t1["distance_km"]

    # 11-12. hospital sees incoming patient + full profile
    incoming = client.get("/api/hospitals/HOSP-001/incoming", headers=tokens["doctor"]).json()
    assert any(i["incident_id"] == inc for i in incoming)
    hosp_profile = client.get(f"/api/incidents/{inc}/profile", headers=tokens["doctor"]).json()["profile"]
    assert hosp_profile["donor_preference"] == "Yes"
    # staff of ANOTHER hospital is blocked
    assert client.get(f"/api/incidents/{inc}/profile", headers=tokens["nurse2"]).status_code == 403

    # blood bank for this patient (O+)
    bb = client.get("/api/hospitals/HOSP-001/blood-bank", params={"incident_id": inc},
                    headers=tokens["doctor"]).json()
    assert bb["patient_blood_group"] == "O+" and bb["preparation_status"] == "READY"

    # 13. ARRIVED -> IN_ER -> UNDER_TREATMENT
    for s in ["ARRIVED", "IN_ER", "UNDER_TREATMENT"]:
        r = client.patch(f"/api/incidents/{inc}/status", json={"status": s}, headers=tokens["doctor"])
        assert r.status_code == 200, r.text

    # 14. handoff note
    r = client.post(f"/api/incidents/{inc}/medical-notes",
                    json={"note_type": "HANDOFF", "notes": "Demo handoff note"}, headers=tokens["doctor"])
    assert r.status_code == 201

    # 15. STABLE -> CLOSED
    for s in ["STABLE", "CLOSED"]:
        assert client.patch(f"/api/incidents/{inc}/status", json={"status": s},
                            headers=tokens["doctor"]).status_code == 200

    timeline = client.get(f"/api/incidents/{inc}/timeline", headers=tokens["admin"]).json()
    statuses = [e["status"] for e in timeline if e["type"] == "STATUS_CHANGE"]
    assert statuses == ["SCAN_PENDING", "SCAN_RECEIVED", "IDENTITY_VERIFIED", "EMS_NOTIFIED", "AMBULANCE_ASSIGNED",
                        "EN_ROUTE", "ARRIVED", "IN_ER", "UNDER_TREATMENT", "STABLE", "CLOSED"]

    # ambulance freed again
    amb = [a for a in client.get("/api/ambulances", headers=tokens["ems"]).json() if a["ambulance_id"] == "AMB-001"]
    assert amb[0]["status"] == "AVAILABLE"

    # every sensitive access audit logged
    actions = {a["action"] for a in client.get(f"/api/incidents/{inc}/audit", headers=tokens["admin"]).json()}
    assert {"INCIDENT_CREATED", "SCAN_MATCHED", "PROFILE_VIEWED", "AMBULANCE_DISPATCHED", "FAMILY_NOTIFIED",
            "MEDICAL_NOTE_ADDED", "STATUS_CHANGED", "ACCESS_DENIED"} <= actions


# ------------------------------------------------------------------ section 9: checklist
def test_no_gps_still_creates_incident(client, tokens):
    r = client.post("/api/incidents", json={"client_request_id": str(uuid.uuid4())}, headers=tokens["field"])
    assert r.status_code == 201
    assert r.json()["location_available"] is False and "warning" in r.json()


def test_poor_scan_asks_for_recapture(client, tokens):
    inc = new_incident(client, tokens)
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": [0.1] * 128, "face_detected": False},
                    headers=tokens["field"])
    assert r.status_code == 422 and r.json()["detail"]["error"] == "RESCAN_REQUIRED"
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": [0.1] * 10}, headers=tokens["field"])
    assert r.status_code == 422 and r.json()["detail"]["error"] == "RESCAN_REQUIRED"
    assert client.get(f"/api/incidents/{inc}", headers=tokens["field"]).json()["status"] == "SCAN_PENDING"


def test_no_match_goes_to_review_and_can_still_dispatch(client, tokens):
    inc = new_incident(client, tokens)
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens)},
                    headers=tokens["field"]).json()
    assert r["match_result"] == "NO_MATCH" and r["status"] == "MATCH_REVIEW"
    # care is not blocked by identity
    d = client.post(f"/api/incidents/{inc}/dispatch", json={}, headers=tokens["ems"])
    assert d.status_code == 200 and d.json()["family_notifications"]["skipped_reason"]
    p = client.get(f"/api/incidents/{inc}/profile", headers=tokens["ems"]).json()
    assert p["identified"] is False


def test_ambiguous_match_needs_human_review(client, tokens):
    inc = new_incident(client, tokens)
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens, "USR-003")},
                    headers=tokens["field"]).json()
    assert r["match_result"] == "AMBIGUOUS" and r["identity_confirmed"] is False
    cands = client.get(f"/api/incidents/{inc}/candidates", headers=tokens["ems"]).json()["candidates"]
    assert {c["user_id"] for c in cands} >= {"USR-003", "USR-004"}
    r = client.post(f"/api/incidents/{inc}/review",
                    json={"decision": "CONFIRM", "user_id": "USR-003", "notes": "Checked college ID card"},
                    headers=tokens["ems"])
    assert r.status_code == 200 and r.json()["status"] == "IDENTITY_VERIFIED"


def test_consent_revoked_user_never_matches(client, tokens):
    inc = new_incident(client, tokens)
    r = client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens, "USR-006")},
                    headers=tokens["field"]).json()
    assert r["match_result"] == "NO_MATCH"


def test_unauthorized_and_bad_tokens(client, tokens):
    inc = new_incident(client, tokens)
    assert client.get(f"/api/incidents/{inc}/profile").status_code == 401
    assert client.get(f"/api/incidents/{inc}/profile",
                      headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.post(f"/api/incidents/{inc}/dispatch", json={}, headers=tokens["doctor"]).status_code == 403


def test_incident_token_scope_expiry_and_revocation(client, tokens):
    inc = new_incident(client, tokens)
    client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens, "USR-002")},
                headers=tokens["field"])
    client.post(f"/api/incidents/{inc}/dispatch", json={"hospital_id": "HOSP-001"}, headers=tokens["ems"])
    other = new_incident(client, tokens)

    issued = client.post(f"/api/incidents/{inc}/access-token", json={"expires_minutes": 5},
                         headers=tokens["doctor"]).json()
    tok = {"Authorization": f"Bearer {issued['access_token']}"}
    assert client.get(f"/api/incidents/{inc}/profile", headers=tok).status_code == 200
    assert client.get(f"/api/incidents/{other}/profile", headers=tok).status_code == 403   # other incident
    assert client.get("/api/incidents", headers=tok).status_code == 403                      # not universal

    # expired token
    expired = jwt.encode({"sub": "STF-003", "role": "hospital", "type": "incident", "incident_id": inc,
                          "jti": issued["jti"], "exp": utcnow() - timedelta(minutes=1)},
                         settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    r = client.get(f"/api/incidents/{inc}/profile", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["detail"]["error"] == "TOKEN_EXPIRED"

    # revoked token
    client.delete(f"/api/access-tokens/{issued['jti']}", headers=tokens["doctor"])
    r = client.get(f"/api/incidents/{inc}/profile", headers=tok)
    assert r.status_code == 401 and r.json()["detail"]["error"] == "TOKEN_REVOKED"


def test_duplicate_requests(client, tokens):
    body = {"client_request_id": "same-tap-twice", **GPS}
    a = client.post("/api/incidents", json=body, headers=tokens["field"])
    b = client.post("/api/incidents", json=body, headers=tokens["field"])
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["incident_id"] == b.json()["incident_id"] and b.json()["duplicate"] is True


def test_notification_failure_recorded(client, tokens):
    inc = new_incident(client, tokens)
    client.post(f"/api/incidents/{inc}/scan", json={"scan_data": scan_for(client, tokens, "USR-005")},
                headers=tokens["field"])
    d = client.post(f"/api/incidents/{inc}/dispatch", json={}, headers=tokens["ems"]).json()
    assert d["family_notifications"] == {"sent": 1, "failed": 1, "skipped_reason": None}
    logs = client.get(f"/api/incidents/{inc}/notifications", headers=tokens["ems"]).json()
    assert any(l["status"] == "FAILED" and l["error"] for l in logs)


def test_invalid_status_jump_rejected(client, tokens):
    inc = new_incident(client, tokens)
    r = client.patch(f"/api/incidents/{inc}/status", json={"status": "IN_ER"}, headers=tokens["admin"])
    assert r.status_code == 409 and r.json()["detail"]["error"] == "INVALID_TRANSITION"
    r = client.patch(f"/api/incidents/{inc}/status", json={"status": "IDENTITY_VERIFIED"}, headers=tokens["admin"])
    assert r.status_code == 422
