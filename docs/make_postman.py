"""Generates docs/MediRescue.postman_collection.json. Run:  python docs/make_postman.py"""
import json
import os


def req(name, method, path, token=None, body=None, tests=None, query=None, desc=""):
    url = {"raw": "{{baseUrl}}" + path + (("?" + "&".join(f"{k}={v}" for k, v in query.items())) if query else ""),
           "host": ["{{baseUrl}}"], "path": [p for p in path.strip("/").split("/")]}
    if query:
        url["query"] = [{"key": k, "value": v} for k, v in query.items()]
    item = {"name": name, "request": {"method": method, "header": [], "url": url, "description": desc}}
    if token:
        item["request"]["auth"] = {"type": "bearer", "bearer": [{"key": "token", "value": "{{" + token + "}}",
                                                                 "type": "string"}]}
    if body is not None:
        item["request"]["header"].append({"key": "Content-Type", "value": "application/json"})
        item["request"]["body"] = {"mode": "raw", "raw": body if isinstance(body, str) else json.dumps(body, indent=2)}
    if tests:
        item["event"] = [{"listen": "test", "script": {"type": "text/javascript", "exec": tests}}]
    return item


def login(name, user, pw, var):
    return req(name, "POST", "/api/auth/login", body={"username": user, "password": pw},
               tests=["pm.test('logged in', () => pm.response.to.have.status(200));",
                      f"pm.collectionVariables.set('{var}', pm.response.json().access_token);"])


INC = "/api/incidents/{{incidentId}}"
GPS = {"latitude": 28.4744, "longitude": 77.49}

collection = {
    "info": {"name": "MediRescue AI Backend", "description": "Run folders top to bottom. Folder 2 is the full demo.",
             "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
    "variable": [{"key": k, "value": v} for k, v in {
        "baseUrl": "http://127.0.0.1:8000", "fieldToken": "", "emsToken": "", "doctorToken": "", "adminToken": "",
        "incidentId": "", "scanData": "[]", "incidentToken": "", "jti": ""}.items()],
    "item": [
        {"name": "0. Health & meta", "item": [
            req("Health", "GET", "/health"),
            req("Meta (statuses, transitions)", "GET", "/api/meta"),
        ]},
        {"name": "1. Log in (run first)", "item": [
            login("Login field1 (Member 1)", "field1", "field123", "fieldToken"),
            login("Login ems1 (Member 3)", "ems1", "ems123", "emsToken"),
            login("Login doctor1 (Member 4)", "doctor1", "doctor123", "doctorToken"),
            login("Login admin", "admin", "admin123", "adminToken"),
        ]},
        {"name": "2. Full demo flow", "item": [
            req("M1 Create incident (SOS)", "POST", "/api/incidents", "fieldToken",
                body='{\n  "client_request_id": "{{$guid}}",\n  "latitude": 28.4744,\n  "longitude": 77.49,\n'
                     '  "severity": "HIGH"\n}',
                tests=["pm.test('201', () => pm.response.to.have.status(201));",
                       "pm.collectionVariables.set('incidentId', pm.response.json().incident_id);"]),
            req("M1 Get demo scan for USR-001", "GET", "/api/demo/test-scan", "fieldToken",
                query={"user_id": "USR-001"},
                tests=["pm.collectionVariables.set('scanData', JSON.stringify(pm.response.json().scan_data));"]),
            req("M1 Submit scan", "POST", INC + "/scan", "fieldToken",
                body='{\n  "scan_data": {{scanData}},\n  "face_detected": true,\n  "quality_score": 0.9,\n'
                     '  "latitude": 28.4744,\n  "longitude": 77.49\n}',
                tests=["pm.test('verified', () => pm.expect(pm.response.json().status).to.eql('IDENTITY_VERIFIED'));"]),
            req("M3 Queue of verified incidents", "GET", "/api/incidents", "emsToken",
                query={"status": "IDENTITY_VERIFIED,MATCH_REVIEW"}),
            req("M3 Emergency profile (EMS view)", "GET", INC + "/profile", "emsToken"),
            req("M3 Dispatch AMB-001 to HOSP-001", "POST", INC + "/dispatch", "emsToken",
                body={"ambulance_id": "AMB-001", "hospital_id": "HOSP-001"}),
            req("M3 Notifications log", "GET", INC + "/notifications", "emsToken"),
            req("M3 Status EN_ROUTE", "PATCH", INC + "/status", "emsToken", body={"status": "EN_ROUTE"}),
            req("M3 Tracking", "GET", INC + "/tracking", "emsToken"),
            req("M3 Simulate ambulance step", "POST", INC + "/tracking/simulate", "emsToken"),
            req("M4 Incoming queue HOSP-001", "GET", "/api/hospitals/HOSP-001/incoming", "doctorToken"),
            req("M4 Emergency profile (hospital view)", "GET", INC + "/profile", "doctorToken"),
            req("M4 Blood bank for patient", "GET", "/api/hospitals/HOSP-001/blood-bank", "doctorToken",
                query={"incident_id": "{{incidentId}}"}),
            req("M4 Status ARRIVED", "PATCH", INC + "/status", "doctorToken", body={"status": "ARRIVED"}),
            req("M4 Status IN_ER", "PATCH", INC + "/status", "doctorToken", body={"status": "IN_ER"}),
            req("M4 Status UNDER_TREATMENT", "PATCH", INC + "/status", "doctorToken",
                body={"status": "UNDER_TREATMENT"}),
            req("M4 Handoff note", "POST", INC + "/medical-notes", "doctorToken",
                body={"note_type": "HANDOFF", "notes": "Demo handoff: GCS 14, BP 110/70, IV line in place."}),
            req("M4 Status STABLE", "PATCH", INC + "/status", "doctorToken", body={"status": "STABLE"}),
            req("M4 Status CLOSED", "PATCH", INC + "/status", "doctorToken", body={"status": "CLOSED"}),
            req("M4 Timeline", "GET", INC + "/timeline", "doctorToken"),
            req("M4 Audit history", "GET", INC + "/audit", "doctorToken"),
        ]},
        {"name": "3. Failure cases", "item": [
            req("New incident WITHOUT GPS", "POST", "/api/incidents", "fieldToken",
                body='{\n  "client_request_id": "{{$guid}}"\n}',
                tests=["pm.collectionVariables.set('incidentId', pm.response.json().incident_id);"]),
            req("Poor scan -> RESCAN_REQUIRED (422)", "POST", INC + "/scan", "fieldToken",
                body={"scan_data": [0.1] * 128, "face_detected": False}),
            req("Get AMBIGUOUS scan (twins)", "GET", "/api/demo/test-scan", "fieldToken",
                query={"user_id": "USR-003"},
                tests=["pm.collectionVariables.set('scanData', JSON.stringify(pm.response.json().scan_data));"]),
            req("Submit ambiguous scan -> MATCH_REVIEW", "POST", INC + "/scan", "fieldToken",
                body='{\n  "scan_data": {{scanData}}\n}'),
            req("Field app tries profile -> 403", "GET", INC + "/profile", "fieldToken"),
            req("EMS views candidates", "GET", INC + "/candidates", "emsToken"),
            req("EMS confirms identity", "POST", INC + "/review", "emsToken",
                body={"decision": "CONFIRM", "user_id": "USR-003", "notes": "Checked college ID card"}),
            req("Invalid jump to IN_ER -> 409", "PATCH", INC + "/status", "adminToken", body={"status": "IN_ER"}),
            req("No token -> 401", "GET", INC + "/profile"),
            req("Duplicate request (send twice)", "POST", "/api/incidents", "fieldToken",
                body={"client_request_id": "same-tap-twice", **GPS}),
        ]},
        {"name": "4. Incident access tokens", "item": [
            req("Dispatch current incident to HOSP-001", "POST", INC + "/dispatch", "emsToken",
                body={"hospital_id": "HOSP-001"}),
            req("Issue 5-minute token (doctor)", "POST", INC + "/access-token", "doctorToken",
                body={"expires_minutes": 5},
                tests=["pm.collectionVariables.set('incidentToken', pm.response.json().access_token);",
                       "pm.collectionVariables.set('jti', pm.response.json().jti);"]),
            req("Use token on profile -> 200", "GET", INC + "/profile", "incidentToken"),
            req("Use token on incident list -> 403", "GET", "/api/incidents", "incidentToken"),
            req("Revoke token", "DELETE", "/api/access-tokens/{{jti}}", "doctorToken"),
            req("Use revoked token -> 401", "GET", INC + "/profile", "incidentToken"),
        ]},
        {"name": "5. Reference data & admin", "item": [
            req("Hospitals", "GET", "/api/hospitals", "emsToken"),
            req("Ambulances", "GET", "/api/ambulances", "emsToken"),
            req("Demo users", "GET", "/api/users", "adminToken"),
            req("All audit logs", "GET", "/api/audit-logs", "adminToken"),
            req("Set ER status BUSY", "PATCH", "/api/hospitals/HOSP-001/er-status", "doctorToken",
                body={"er_status": "BUSY"}),
        ]},
    ],
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "MediRescue.postman_collection.json")
with open(out, "w") as f:
    json.dump(collection, f, indent=2)
print("Wrote", out)
