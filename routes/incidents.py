"""Incident core: create, list, scan + matching, human review, status changes, medical notes, timeline."""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from config import settings
from constants import (ADMIN, CLOSED, EMS, FIELD, HOSPITAL, IDENTITY_STAGE, IDENTITY_VERIFIED, MATCH_REJECTED,
                       MATCH_REVIEW, MATCH_VERIFIED, ROLES, SCAN_PENDING, SCAN_RECEIVED, SET_BY_ENDPOINT,
                       STATUS_ROLES, STATUSES)
from database import get_db
from models import Incident, MedicalUpdate, User, utcnow
from schemas import IncidentCreate, MedicalNoteCreate, ReviewDecision, ScanSubmit, StatusUpdate
from security import Principal, api_error, require_roles
from services.audit_service import log_event
from services.face_embedder import EmbedderUnavailable, image_to_embedding
from services.geo import haversine_km
from services.incident_service import change_status, load_incident, new_incident_id, summary, to_naive_utc
from services.matching_service import (MatchingUnavailable, ScanQualityError, match_embedding,
                                       validate_embedding)
from services.notification_service import notify_family

router = APIRouter(prefix="/api/incidents", tags=["Incidents"])


# ---------------------------------------------------------------- create / list / get
@router.post("", status_code=201, summary="Start a new incident (Member 1: SOS button)")
def create_incident(body: IncidentCreate, response: Response,
                    principal: Principal = Depends(require_roles(FIELD, EMS, ADMIN)),
                    db: Session = Depends(get_db)):
    has_gps = body.latitude is not None and body.longitude is not None

    # Duplicate protection 1: same client_request_id -> return the existing incident
    if body.client_request_id:
        existing = db.query(Incident).filter(Incident.client_request_id == body.client_request_id).first()
        if existing:
            response.status_code = 200
            return {**summary(existing), "duplicate": True}

    # Duplicate protection 2 (only when no client_request_id): same responder, same spot, short window
    elif has_gps:
        since = utcnow() - timedelta(seconds=settings.DUPLICATE_WINDOW_SECONDS)
        recent = db.query(Incident).filter(Incident.created_by == principal.username,
                                           Incident.created_at >= since,
                                           Incident.location_available.is_(True)).all()
        for inc in recent:
            d = haversine_km(inc.latitude, inc.longitude, body.latitude, body.longitude)
            if d is not None and d * 1000 <= settings.DUPLICATE_DISTANCE_METERS:
                response.status_code = 200
                return {**summary(inc), "duplicate": True}

    incident = Incident(
        incident_id=new_incident_id(db),
        latitude=body.latitude if has_gps else None,
        longitude=body.longitude if has_gps else None,
        location_available=has_gps,
        reported_at=to_naive_utc(body.reported_at) or utcnow(),
        severity=body.severity,
        status=SCAN_PENDING,
        client_request_id=body.client_request_id,
        created_by=principal.username,
        notes=body.notes,
    )
    db.add(incident)
    db.add(MedicalUpdate(incident_id=incident.incident_id, staff_id=principal.staff_id,
                         entry_type="STATUS_CHANGE", status=SCAN_PENDING, notes="Incident created"))
    log_event(db, "INCIDENT_CREATED", principal.actor, principal.role, incident.incident_id,
              {"location_available": has_gps, "severity": body.severity})
    db.commit()
    out = {**summary(incident), "duplicate": False}
    if not has_gps:
        out["warning"] = "LOCATION_UNAVAILABLE: incident created without GPS. Send location with the scan if possible."
    return out


@router.get("", summary="List incidents (EMS queue, hospital queue, etc.)")
def list_incidents(status: Optional[str] = None, hospital_id: Optional[str] = None,
                   include_closed: bool = False, limit: int = 100,
                   principal: Principal = Depends(require_roles(*ROLES)), db: Session = Depends(get_db)):
    """Examples: `?status=IDENTITY_VERIFIED` (Member 3), `?hospital_id=HOSP-001` (Member 4).
    Several statuses: `?status=IDENTITY_VERIFIED,MATCH_REVIEW`."""
    q = db.query(Incident)
    if status:
        wanted = [s.strip().upper() for s in status.split(",")]
        bad = [s for s in wanted if s not in STATUSES]
        if bad:
            raise api_error(422, "INVALID_STATUS", f"Unknown status: {', '.join(bad)}", valid=STATUSES)
        q = q.filter(Incident.status.in_(wanted))
    elif not include_closed:
        q = q.filter(Incident.status != CLOSED)

    if principal.role == FIELD:
        q = q.filter(Incident.created_by == principal.username)
    elif principal.role == HOSPITAL and principal.hospital_id:
        q = q.filter(Incident.hospital_id == principal.hospital_id)
    elif hospital_id:
        q = q.filter(Incident.hospital_id == hospital_id)

    rows = q.order_by(Incident.created_at.desc()).limit(min(limit, 500)).all()
    return [summary(i) for i in rows]


@router.get("/{incident_id}", summary="One incident (no medical data)")
def get_incident(incident_id: str,
                 principal: Principal = Depends(require_roles(*ROLES, allow_incident_token=True)),
                 db: Session = Depends(get_db)):
    return summary(load_incident(db, incident_id, principal))


# ---------------------------------------------------------------- scan + matching
@router.post("/{incident_id}/scan", summary="Submit face scan + GPS (Member 1)")
def submit_scan(incident_id: str, body: ScanSubmit,
                principal: Principal = Depends(require_roles(FIELD, EMS, ADMIN)),
                db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    if incident.status == CLOSED:
        raise api_error(409, "INCIDENT_CLOSED", "This incident is closed.")
    if incident.user_id:
        raise api_error(409, "ALREADY_IDENTIFIED", "Identity is already confirmed for this incident.")

    # Location can arrive with the scan (useful if GPS was slow at SOS time)
    if body.latitude is not None and body.longitude is not None:
        incident.latitude, incident.longitude, incident.location_available = body.latitude, body.longitude, True

    incident.scan_attempts = (incident.scan_attempts or 0) + 1
    incident.last_scan_at = to_naive_utc(body.timestamp) or utcnow()

    def rescan(message: str):
        log_event(db, "SCAN_REJECTED", principal.actor, principal.role, incident_id,
                  {"reason": message, "attempt": incident.scan_attempts})
        db.commit()
        raise api_error(422, "RESCAN_REQUIRED", message, incident_id=incident_id,
                        status=incident.status, scan_attempts=incident.scan_attempts)

    # 1. Quality gate
    if not body.face_detected:
        rescan("No face detected. Please capture again.")
    if body.quality_score is not None and body.quality_score < settings.MIN_SCAN_QUALITY:
        rescan(f"Image quality too low ({body.quality_score:.2f}). Please capture again.")

    # 2. Get an embedding (embedding mode or image mode)
    try:
        embedding = image_to_embedding(body.scan_data) if isinstance(body.scan_data, str) else body.scan_data
        validate_embedding(embedding)          # bad scans are rejected before any status change
        in_identity_stage = incident.status in IDENTITY_STAGE
        if incident.status == SCAN_PENDING:
            change_status(db, incident, SCAN_RECEIVED, principal, "Scan received")
        outcome = match_embedding(db, embedding)
    except ScanQualityError as exc:
        rescan(str(exc))
    except EmbedderUnavailable as exc:
        db.rollback()
        raise api_error(501, "IMAGE_MODE_UNAVAILABLE", str(exc))
    except MatchingUnavailable as exc:
        db.commit()   # keep SCAN_RECEIVED; the app can retry
        raise api_error(503, "MATCHING_UNAVAILABLE", f"{exc} Please retry.", incident_id=incident_id,
                        status=incident.status)

    incident.match_result = outcome.result
    incident.match_score = round(outcome.score, 4)
    incident.match_candidates = outcome.candidates

    if outcome.result == MATCH_VERIFIED:
        incident.user = db.get(User, outcome.user_id)
        if in_identity_stage:
            change_status(db, incident, IDENTITY_VERIFIED, principal, "Automatic match verified")
        else:
            # Ambulance already on the way; identity attached without changing the response status
            notify_family(db, incident, principal.actor)
    elif in_identity_stage and incident.status != MATCH_REVIEW:
        change_status(db, incident, MATCH_REVIEW, principal, f"Needs human review ({outcome.result})")

    log_event(db, "SCAN_MATCHED", principal.actor, principal.role, incident_id,
              {"result": outcome.result, "score": incident.match_score,
               "candidates": len(outcome.candidates), "attempt": incident.scan_attempts})
    db.commit()

    messages = {
        "VERIFIED": "Identity verified. Emergency profile is available to authorized responders.",
        "AMBIGUOUS": "Several similar records found. A responder must verify identity manually.",
        "NEEDS_REVIEW": "Possible match found but not certain. A responder must verify identity.",
        "NO_MATCH": "No matching record. Treat as unidentified patient; care continues normally.",
    }
    # Note: no name or medical data is returned to the field app.
    return {
        "incident_id": incident_id,
        "status": incident.status,
        "match_result": outcome.result,
        "identity_confirmed": outcome.result == MATCH_VERIFIED,
        "candidates_count": len(outcome.candidates),
        "message": messages[outcome.result],
    }


@router.get("/{incident_id}/candidates", summary="Possible matches for human review")
def get_candidates(incident_id: str, principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN)),
                   db: Session = Depends(get_db)):
    """Shows limited identity info (name, age, gender) so a responder can compare with the patient
    (e.g. against an ID card). Medical data is NOT shown until identity is confirmed."""
    incident = load_incident(db, incident_id, principal)
    out = []
    for c in incident.match_candidates or []:
        user = db.get(User, c["user_id"])
        if user:
            out.append({"user_id": user.user_id, "name": user.name, "gender": user.gender,
                        "age": _age(user.dob), "score": c["score"]})
    log_event(db, "CANDIDATES_VIEWED", principal.actor, principal.role, incident_id, {"count": len(out)})
    db.commit()
    return {"incident_id": incident_id, "match_result": incident.match_result, "candidates": out}


@router.post("/{incident_id}/review", summary="Human confirms or rejects the identity match")
def review_match(incident_id: str, body: ReviewDecision,
                 principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN)),
                 db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    if incident.user_id:
        raise api_error(409, "ALREADY_IDENTIFIED", "Identity is already confirmed.")

    if body.decision == "REJECT":
        incident.match_result = MATCH_REJECTED
        incident.match_candidates = []
        log_event(db, "MATCH_REJECTED", principal.actor, principal.role, incident_id, {"notes": body.notes})
        db.commit()
        return {**summary(incident), "message": "Marked as unidentified patient."}

    if not body.user_id:
        raise api_error(422, "USER_ID_REQUIRED", "user_id is required to CONFIRM.")
    candidate_ids = {c["user_id"] for c in incident.match_candidates or []}
    if body.user_id not in candidate_ids and principal.role != ADMIN:
        raise api_error(422, "NOT_A_CANDIDATE", "Only one of the listed candidates can be confirmed "
                                                "(admins may override).")
    user = db.get(User, body.user_id)
    if not user:
        raise api_error(404, "USER_NOT_FOUND", "No such user.")

    incident.user = user
    incident.match_result = MATCH_VERIFIED
    if incident.status == MATCH_REVIEW:
        change_status(db, incident, IDENTITY_VERIFIED, principal, f"Manually verified: {body.notes}")
    else:
        notify_family(db, incident, principal.actor)   # already dispatched -> tell family now
    log_event(db, "MATCH_CONFIRMED", principal.actor, principal.role, incident_id,
              {"user_id": body.user_id, "notes": body.notes})
    db.commit()
    return {**summary(incident), "message": "Identity confirmed."}


# ---------------------------------------------------------------- status
@router.patch("/{incident_id}/status", summary="Move the incident to its next status")
def update_status(incident_id: str, body: StatusUpdate,
                  principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN, allow_incident_token=True)),
                  db: Session = Depends(get_db)):
    """EMS: EN_ROUTE, ARRIVED. Hospital: ARRIVED, IN_ER, UNDER_TREATMENT, STABLE / OTHER_OUTCOME, CLOSED.
    Admin may CLOSE from any status (e.g. false alarm) with notes."""
    incident = load_incident(db, incident_id, principal)
    target = body.status.strip().upper()
    if target not in STATUSES:
        raise api_error(422, "INVALID_STATUS", f"Unknown status {target}.", valid=STATUSES)
    if target in SET_BY_ENDPOINT:
        raise api_error(422, "USE_DEDICATED_ENDPOINT", f"{target} is set by {SET_BY_ENDPOINT[target]}.")

    force = False
    if principal.role == ADMIN and target == CLOSED and incident.status != CLOSED:
        if not body.notes:
            raise api_error(422, "NOTES_REQUIRED", "Give a reason when force-closing an incident.")
        force = True
    elif principal.role not in STATUS_ROLES.get(target, set()):
        raise api_error(403, "FORBIDDEN", f"Role '{principal.role}' cannot set {target}.")

    change_status(db, incident, target, principal, body.notes, force=force)
    db.commit()
    return summary(incident)


# ---------------------------------------------------------------- notes + timeline
@router.post("/{incident_id}/medical-notes", status_code=201, summary="Add a medical / handoff note")
def add_medical_note(incident_id: str, body: MedicalNoteCreate,
                     principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN, allow_incident_token=True)),
                     db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    if incident.status == CLOSED:
        raise api_error(409, "INCIDENT_CLOSED", "Cannot add notes to a closed incident.")
    note = MedicalUpdate(incident_id=incident_id, staff_id=principal.staff_id, entry_type=body.note_type,
                         status=incident.status, notes=body.notes)
    db.add(note)
    log_event(db, "MEDICAL_NOTE_ADDED", principal.actor, principal.role, incident_id, {"type": body.note_type})
    db.commit()
    return _entry(note)


@router.get("/{incident_id}/medical-notes", summary="Medical / handoff notes")
def list_medical_notes(incident_id: str,
                       principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN, allow_incident_token=True)),
                       db: Session = Depends(get_db)):
    load_incident(db, incident_id, principal)
    rows = (db.query(MedicalUpdate).filter(MedicalUpdate.incident_id == incident_id,
                                           MedicalUpdate.entry_type != "STATUS_CHANGE")
            .order_by(MedicalUpdate.timestamp, MedicalUpdate.id).all())
    log_event(db, "MEDICAL_NOTES_VIEWED", principal.actor, principal.role, incident_id)
    db.commit()
    return [_entry(r) for r in rows]


@router.get("/{incident_id}/timeline", summary="Full status + notes timeline")
def timeline(incident_id: str,
             principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN, allow_incident_token=True)),
             db: Session = Depends(get_db)):
    load_incident(db, incident_id, principal)
    rows = (db.query(MedicalUpdate).filter(MedicalUpdate.incident_id == incident_id)
            .order_by(MedicalUpdate.timestamp, MedicalUpdate.id).all())
    return [_entry(r) for r in rows]


# ---------------------------------------------------------------- helpers
def _entry(row: MedicalUpdate) -> dict:
    return {"id": row.id, "incident_id": row.incident_id, "staff_id": row.staff_id, "type": row.entry_type,
            "status": row.status, "notes": row.notes, "timestamp": row.timestamp}


def _age(dob: Optional[str]) -> Optional[int]:
    if not dob:
        return None
    try:
        y, m, d = (int(x) for x in dob.split("-"))
    except ValueError:
        return None
    today = utcnow().date()
    return today.year - y - ((today.month, today.day) < (m, d))
