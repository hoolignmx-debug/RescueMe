"""Hospital / ER endpoints (APIs for Member 4)."""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from constants import ADMIN, CLOSED, EMS, HOSPITAL, ROLES
from database import get_db
from models import Hospital, Incident
from routes.incidents import _age
from schemas import ERStatusUpdate
from security import Principal, api_error, require_roles
from services.audit_service import log_event
from services.incident_service import load_incident, summary

router = APIRouter(prefix="/api/hospitals", tags=["Hospital / ER"])

# Which donor blood groups each patient blood group can receive (red cells)
COMPATIBLE = {
    "O-": ["O-"],
    "O+": ["O+", "O-"],
    "A-": ["A-", "O-"],
    "A+": ["A+", "A-", "O+", "O-"],
    "B-": ["B-", "O-"],
    "B+": ["B+", "B-", "O+", "O-"],
    "AB-": ["AB-", "A-", "B-", "O-"],
    "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
}


def _hospital(h: Hospital) -> dict:
    return {"hospital_id": h.hospital_id, "name": h.name, "address": h.address, "latitude": h.latitude,
            "longitude": h.longitude, "er_status": h.er_status}


def _check_own_hospital(principal: Principal, hospital_id: str):
    if principal.role == HOSPITAL and principal.hospital_id and principal.hospital_id != hospital_id:
        raise api_error(403, "FORBIDDEN", "You can only view your own hospital.")


def _get(db: Session, hospital_id: str) -> Hospital:
    h = db.get(Hospital, hospital_id)
    if not h:
        raise api_error(404, "HOSPITAL_NOT_FOUND", f"No hospital {hospital_id}.")
    return h


@router.get("", summary="All hospitals and ER status")
def list_hospitals(principal: Principal = Depends(require_roles(*ROLES)), db: Session = Depends(get_db)):
    return [_hospital(h) for h in db.query(Hospital).order_by(Hospital.hospital_id)]


@router.get("/{hospital_id}/incoming", summary="Incoming / current trauma queue for one hospital")
def incoming_queue(hospital_id: str, principal: Principal = Depends(require_roles(HOSPITAL, ADMIN)),
                   db: Session = Depends(get_db)):
    """Minimal info for the queue (no names, no medical details). Open the profile to see more (audited)."""
    _get(db, hospital_id)
    _check_own_hospital(principal, hospital_id)
    rows = (db.query(Incident).filter(Incident.hospital_id == hospital_id, Incident.status != CLOSED)
            .order_by(Incident.created_at).all())
    out = []
    for inc in rows:
        u = inc.user
        out.append({**summary(inc),
                    "patient_age": _age(u.dob) if u else None,
                    "patient_gender": u.gender if u else None,
                    "blood_group": u.medical_profile.blood_group if u and u.medical_profile else None})
    return out


@router.get("/{hospital_id}/blood-bank", summary="Demo blood-bank stock (+ compatible units for an incident)")
def blood_bank(hospital_id: str, incident_id: Optional[str] = None,
               principal: Principal = Depends(require_roles(HOSPITAL, ADMIN)), db: Session = Depends(get_db)):
    h = _get(db, hospital_id)
    _check_own_hospital(principal, hospital_id)
    stock = h.blood_stock or {}
    result = {"hospital_id": hospital_id, "stock": stock, "demo_data": True}
    if incident_id:
        inc = load_incident(db, incident_id, principal)
        group = inc.user.medical_profile.blood_group if inc.user and inc.user.medical_profile else None
        if group in COMPATIBLE:
            compatible = {g: stock.get(g, 0) for g in COMPATIBLE[group]}
            total = sum(compatible.values())
            result["patient_blood_group"] = group
            result["compatible_units"] = compatible
            result["total_compatible_units"] = total
            result["preparation_status"] = "READY" if total >= 4 else ("LOW" if total > 0 else "UNAVAILABLE")
        else:
            # Unknown patient: emergency standard is O-negative
            result["patient_blood_group"] = None
            result["compatible_units"] = {"O-": stock.get("O-", 0)}
            result["total_compatible_units"] = stock.get("O-", 0)
            result["preparation_status"] = "UNKNOWN_GROUP_USE_O_NEG"
    return result


@router.patch("/{hospital_id}/er-status", summary="Set ER status: OPEN / BUSY / DIVERTING")
def set_er_status(hospital_id: str, body: ERStatusUpdate,
                  principal: Principal = Depends(require_roles(HOSPITAL, ADMIN)), db: Session = Depends(get_db)):
    h = _get(db, hospital_id)
    _check_own_hospital(principal, hospital_id)
    old = h.er_status
    h.er_status = body.er_status
    log_event(db, "ER_STATUS_CHANGED", principal.actor, principal.role, None,
              {"hospital_id": hospital_id, "from": old, "to": body.er_status})
    db.commit()
    return _hospital(h)
