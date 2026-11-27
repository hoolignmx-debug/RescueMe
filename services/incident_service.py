"""Incident state management: IDs, status changes with validation, scope checks, and shared response shapes."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from constants import (ADMIN, AMB_ARRIVED, AMB_AVAILABLE, AMB_EN_ROUTE, ARRIVED, CLOSED, EN_ROUTE, FIELD,
                       HOSPITAL, IN_ER, TRANSITIONS)
from models import Incident, MedicalUpdate, utcnow
from security import Principal, api_error
from services.audit_service import log_event
from services.geo import eta_minutes, haversine_km


def to_naive_utc(value: datetime | None) -> datetime | None:
    """Device timestamps may include a timezone; store everything as plain UTC."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def new_incident_id(db: Session) -> str:
    year = utcnow().year
    prefix = f"INC-{year}-"
    last = (db.query(Incident.incident_id).filter(Incident.incident_id.like(f"{prefix}%"))
            .order_by(Incident.incident_id.desc()).first())
    number = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{number:04d}"


def change_status(db: Session, incident: Incident, new_status: str, actor: Principal | str,
                  notes: str | None = None, force: bool = False) -> None:
    """The only place a status changes. Validates the move, syncs the ambulance, writes timeline + audit."""
    old = incident.status
    if not force and new_status not in TRANSITIONS.get(old, []):
        raise api_error(409, "INVALID_TRANSITION",
                        f"Cannot move from {old} to {new_status}.",
                        current_status=old, allowed_next=TRANSITIONS.get(old, []))

    incident.status = new_status
    amb = incident.ambulance
    if amb:
        if new_status == EN_ROUTE:
            amb.status = AMB_EN_ROUTE
        elif new_status == ARRIVED:
            amb.status = AMB_ARRIVED
            if incident.location_available:
                amb.latitude, amb.longitude = incident.latitude, incident.longitude
        elif new_status in (IN_ER, CLOSED) and amb.status != AMB_AVAILABLE:
            amb.status = AMB_AVAILABLE                      # free for the next call
            if incident.hospital:
                amb.latitude, amb.longitude = incident.hospital.latitude, incident.hospital.longitude
    if new_status == CLOSED:
        incident.closed_at = utcnow()

    actor_name = actor.actor if isinstance(actor, Principal) else actor
    role = actor.role if isinstance(actor, Principal) else None
    staff_id = actor.staff_id if isinstance(actor, Principal) else actor
    db.add(MedicalUpdate(incident_id=incident.incident_id, staff_id=staff_id, entry_type="STATUS_CHANGE",
                         status=new_status, notes=notes or f"{old} -> {new_status}"))
    log_event(db, "STATUS_CHANGED", actor_name, role, incident.incident_id,
              {"from": old, "to": new_status, "forced": force, "notes": notes})


def load_incident(db: Session, incident_id: str, principal: Principal) -> Incident:
    """Loads an incident and checks the caller may see it.

    - field responders: only incidents they created
    - hospital staff: only incidents assigned to their hospital
    - incident tokens: already scoped to this incident by require_roles
    """
    incident = db.get(Incident, incident_id)
    if not incident:
        raise api_error(404, "INCIDENT_NOT_FOUND", f"No incident {incident_id}.")
    if principal.token_type == "incident" or principal.role == ADMIN:
        return incident
    denied = None
    if principal.role == FIELD and incident.created_by != principal.username:
        denied = "Field responders can only access incidents they created."
    if principal.role == HOSPITAL and principal.hospital_id and incident.hospital_id != principal.hospital_id:
        denied = "This incident is not assigned to your hospital."
    if denied:
        log_event(db, "ACCESS_DENIED", principal.actor, principal.role, incident_id, {"reason": denied})
        db.commit()
        raise api_error(403, "FORBIDDEN", denied)
    return incident


def summary(incident: Incident) -> dict:
    """Incident data with NO medical details. Safe for lists and dashboards."""
    eta = None
    if incident.ambulance and incident.status in ("AMBULANCE_ASSIGNED", "EN_ROUTE"):
        eta = eta_minutes(haversine_km(incident.ambulance.latitude, incident.ambulance.longitude,
                                       incident.latitude, incident.longitude))
    elif incident.ambulance and incident.hospital and incident.status == "ARRIVED":
        eta = eta_minutes(haversine_km(incident.ambulance.latitude, incident.ambulance.longitude,
                                       incident.hospital.latitude, incident.hospital.longitude))
    return {
        "incident_id": incident.incident_id,
        "status": incident.status,
        "severity": incident.severity,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
        "location_available": incident.location_available,
        "reported_at": incident.reported_at,
        "created_at": incident.created_at,
        "identified": incident.user_id is not None,
        "match_result": incident.match_result,
        "scan_attempts": incident.scan_attempts,
        "ambulance_id": incident.ambulance_id,
        "hospital_id": incident.hospital_id,
        "hospital_name": incident.hospital.name if incident.hospital else None,
        "eta_minutes": eta,
        "closed_at": incident.closed_at,
    }
