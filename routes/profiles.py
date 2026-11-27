"""Emergency-profile retrieval with role-based filtering, plus admin tools for demo users."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from constants import ADMIN, EMS, HOSPITAL
from database import get_db
from models import User
from routes.incidents import _age
from schemas import EnrollFace
from security import Principal, api_error, require_roles
from services.audit_service import log_event
from services.face_embedder import EmbedderUnavailable, image_to_embedding
from services.incident_service import load_incident
from services.matching_service import ScanQualityError, validate_embedding

router = APIRouter(tags=["Profiles"])


def build_profile(user: User, role: str) -> dict:
    """Minimum necessary information per role.

    EMS (paramedics): what they need on the road: blood group, allergies, conditions, meds, implants, contacts.
    Hospital / admin: everything above + date of birth, donor preference, contact priorities.
    Field responders never reach this function (blocked by role check).
    """
    mp = user.medical_profile
    profile = {
        "user_id": user.user_id,
        "name": user.name,
        "age": _age(user.dob),
        "gender": user.gender,
        "blood_group": mp.blood_group if mp else None,
        "allergies": (mp.allergies if mp else []) or [],
        "conditions": (mp.conditions if mp else []) or [],
        "medications": (mp.medications if mp else []) or [],
        "implants": (mp.implants if mp else []) or [],
        "emergency_contacts": [{"name": c.name, "relationship": c.relation, "phone": c.phone}
                               for c in user.contacts],
    }
    if role in (HOSPITAL, ADMIN):
        profile["dob"] = user.dob
        profile["donor_preference"] = mp.donor_preference if mp else None
        profile["emergency_contacts"] = [{"contact_id": c.contact_id, "name": c.name, "relationship": c.relation,
                                          "phone": c.phone, "priority": c.priority} for c in user.contacts]
    return profile


@router.get("/api/incidents/{incident_id}/profile", summary="Emergency profile (filtered by role)")
def get_profile(incident_id: str,
                principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN, allow_incident_token=True)),
                db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    if not incident.user:
        log_event(db, "PROFILE_VIEWED", principal.actor, principal.role, incident_id, {"identified": False})
        db.commit()
        return {"incident_id": incident_id, "identified": False, "match_result": incident.match_result,
                "access_level": principal.role, "profile": None,
                "message": "Patient not identified. No medical history available; treat as unknown patient."}

    profile = build_profile(incident.user, principal.role)
    log_event(db, "PROFILE_VIEWED", principal.actor, principal.role, incident_id,
              {"user_id": incident.user.user_id, "fields": sorted(profile.keys())})
    db.commit()
    return {"incident_id": incident_id, "identified": True, "match_result": incident.match_result,
            "access_level": principal.role, "profile": profile}


@router.get("/api/users", summary="List demo users (admin)")
def list_users(principal: Principal = Depends(require_roles(ADMIN)), db: Session = Depends(get_db)):
    return [{"user_id": u.user_id, "name": u.name, "gender": u.gender, "age": _age(u.dob),
             "consent_status": u.consent_status, "face_enrolled": u.face_embedding is not None}
            for u in db.query(User).order_by(User.user_id)]


@router.post("/api/admin/users/{user_id}/enroll-face", summary="Set a demo user's reference face (admin)")
def enroll_face(user_id: str, body: EnrollFace, principal: Principal = Depends(require_roles(ADMIN)),
                db: Session = Depends(get_db)):
    """Use this in image mode: enrol a teammate's photo (with their consent) as a demo user's reference,
    then scanning that teammate will match."""
    user = db.get(User, user_id)
    if not user:
        raise api_error(404, "USER_NOT_FOUND", "No such user.")
    try:
        emb = image_to_embedding(body.scan_data) if isinstance(body.scan_data, str) else body.scan_data
        vec = validate_embedding(emb)
    except ScanQualityError as exc:
        raise api_error(422, "BAD_REFERENCE", str(exc))
    except EmbedderUnavailable as exc:
        raise api_error(501, "IMAGE_MODE_UNAVAILABLE", str(exc))
    user.face_embedding = [round(float(x), 6) for x in vec]
    log_event(db, "FACE_ENROLLED", principal.actor, principal.role, None, {"user_id": user_id})
    db.commit()
    return {"user_id": user_id, "face_enrolled": True}
