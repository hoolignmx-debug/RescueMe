"""Dispatch, ambulances, live tracking and family notifications (APIs for Member 3)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from constants import (ADMIN, AMB_AVAILABLE, AMB_ASSIGNED, AMBULANCE_ASSIGNED, ARRIVED, DISPATCHABLE, EMS,
                       EMS_NOTIFIED, ER_BUSY, ER_DIVERTING, ER_OPEN, FIELD, HOSPITAL, ROLES)
from database import get_db
from models import Ambulance, Hospital, NotificationLog
from schemas import DispatchRequest, LocationUpdate
from security import Principal, api_error, require_roles
from services import notification_service
from services.audit_service import log_event
from services.geo import eta_minutes, haversine_km, step_towards
from services.incident_service import change_status, load_incident, summary

router = APIRouter(tags=["Dispatch & Tracking"])


def _ambulance(a: Ambulance) -> dict:
    return {"ambulance_id": a.ambulance_id, "vehicle_no": a.vehicle_no, "status": a.status,
            "latitude": a.latitude, "longitude": a.longitude, "hospital_id": a.hospital_id,
            "updated_at": a.updated_at}


def _nearest(items, lat, lon):
    if lat is None or lon is None:
        return items[0] if items else None
    return min(items, key=lambda x: haversine_km(lat, lon, x.latitude, x.longitude) or 0, default=None)


@router.post("/api/incidents/{incident_id}/dispatch", summary="Assign ambulance + destination hospital")
def dispatch(incident_id: str, body: DispatchRequest | None = None,
             principal: Principal = Depends(require_roles(EMS, ADMIN)), db: Session = Depends(get_db)):
    """Works even if the patient is not identified yet: care is never blocked by identity.
    Leave out ambulance_id / hospital_id to auto-pick the nearest available."""
    body = body or DispatchRequest()
    incident = load_incident(db, incident_id, principal)
    if incident.ambulance_id:
        raise api_error(409, "ALREADY_DISPATCHED", f"Ambulance {incident.ambulance_id} is already assigned.")
    if incident.status not in DISPATCHABLE:
        raise api_error(409, "INVALID_TRANSITION", f"Cannot dispatch from status {incident.status}.")

    # Ambulance
    if body.ambulance_id:
        amb = db.get(Ambulance, body.ambulance_id)
        if not amb:
            raise api_error(404, "AMBULANCE_NOT_FOUND", f"No ambulance {body.ambulance_id}.")
        if amb.status != AMB_AVAILABLE:
            raise api_error(409, "AMBULANCE_UNAVAILABLE", f"{amb.ambulance_id} is {amb.status}.")
    else:
        amb = _nearest(db.query(Ambulance).filter(Ambulance.status == AMB_AVAILABLE).all(),
                       incident.latitude, incident.longitude)
        if not amb:
            raise api_error(409, "NO_AMBULANCE_AVAILABLE", "No ambulance is available right now.")

    # Hospital
    if body.hospital_id:
        hosp = db.get(Hospital, body.hospital_id)
        if not hosp:
            raise api_error(404, "HOSPITAL_NOT_FOUND", f"No hospital {body.hospital_id}.")
        if hosp.er_status == ER_DIVERTING:
            raise api_error(409, "HOSPITAL_DIVERTING", f"{hosp.name} is not accepting ambulances.")
    else:
        hosp = (_nearest(db.query(Hospital).filter(Hospital.er_status == ER_OPEN).all(),
                         incident.latitude, incident.longitude)
                or _nearest(db.query(Hospital).filter(Hospital.er_status == ER_BUSY).all(),
                            incident.latitude, incident.longitude))
        if not hosp:
            raise api_error(409, "NO_HOSPITAL_AVAILABLE", "No ER is accepting patients.")

    if incident.status != EMS_NOTIFIED:
        change_status(db, incident, EMS_NOTIFIED, principal, "EMS notified")
    incident.ambulance = amb
    incident.hospital = hosp
    amb.status = AMB_ASSIGNED
    change_status(db, incident, AMBULANCE_ASSIGNED, principal,
                  body.notes or f"{amb.ambulance_id} assigned, destination {hosp.name}")
    log_event(db, "AMBULANCE_DISPATCHED", principal.actor, principal.role, incident_id,
              {"ambulance_id": amb.ambulance_id, "hospital_id": hosp.hospital_id})

    notifications = notification_service.notify_family(db, incident, principal.actor)
    db.commit()

    return {
        **summary(incident),
        "ambulance": _ambulance(amb),
        "hospital": {"hospital_id": hosp.hospital_id, "name": hosp.name, "er_status": hosp.er_status},
        "family_notifications": {
            "sent": sum(n.status == "SENT" for n in notifications),
            "failed": sum(n.status == "FAILED" for n in notifications),
            "skipped_reason": None if incident.user_id else "Patient not identified yet",
        },
    }


@router.get("/api/incidents/{incident_id}/tracking", summary="Live tracking: incident, ambulance, hospital, ETA")
def tracking(incident_id: str,
             principal: Principal = Depends(require_roles(*ROLES, allow_incident_token=True)),
             db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    amb, hosp = incident.ambulance, incident.hospital
    dist = None
    target = None
    if amb and incident.status in ("AMBULANCE_ASSIGNED", "EN_ROUTE"):
        dist = haversine_km(amb.latitude, amb.longitude, incident.latitude, incident.longitude)
        target = "INCIDENT"
    elif amb and hosp and incident.status == ARRIVED:
        dist = haversine_km(amb.latitude, amb.longitude, hosp.latitude, hosp.longitude)
        target = "HOSPITAL"
    return {
        "incident_id": incident_id,
        "status": incident.status,
        "incident_location": {"latitude": incident.latitude, "longitude": incident.longitude,
                              "available": incident.location_available},
        "ambulance": _ambulance(amb) if amb else None,
        "hospital": ({"hospital_id": hosp.hospital_id, "name": hosp.name, "latitude": hosp.latitude,
                      "longitude": hosp.longitude, "er_status": hosp.er_status} if hosp else None),
        "heading_to": target,
        "distance_km": round(dist, 2) if dist is not None else None,
        "eta_minutes": eta_minutes(dist),
    }


@router.post("/api/incidents/{incident_id}/tracking/simulate", summary="Demo: move the ambulance one step")
def simulate_step(incident_id: str, principal: Principal = Depends(require_roles(EMS, ADMIN)),
                  db: Session = Depends(get_db)):
    """Each call moves the ambulance ~35% closer to its target (incident, or hospital after ARRIVED)."""
    incident = load_incident(db, incident_id, principal)
    amb, hosp = incident.ambulance, incident.hospital
    if not amb:
        raise api_error(409, "NOT_DISPATCHED", "No ambulance assigned yet.")
    if incident.status == ARRIVED and hosp:
        amb.latitude, amb.longitude = step_towards(amb.latitude, amb.longitude, hosp.latitude, hosp.longitude)
    elif incident.location_available and incident.status in ("AMBULANCE_ASSIGNED", "EN_ROUTE"):
        amb.latitude, amb.longitude = step_towards(amb.latitude, amb.longitude,
                                                   incident.latitude, incident.longitude)
    db.commit()
    return tracking(incident_id, principal, db)


@router.get("/api/ambulances", summary="All ambulances")
def list_ambulances(principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN)),
                    db: Session = Depends(get_db)):
    return [_ambulance(a) for a in db.query(Ambulance).order_by(Ambulance.ambulance_id)]


@router.put("/api/ambulances/{ambulance_id}/location", summary="Update an ambulance's GPS position")
def update_ambulance_location(ambulance_id: str, body: LocationUpdate,
                              principal: Principal = Depends(require_roles(EMS, ADMIN)),
                              db: Session = Depends(get_db)):
    amb = db.get(Ambulance, ambulance_id)
    if not amb:
        raise api_error(404, "AMBULANCE_NOT_FOUND", f"No ambulance {ambulance_id}.")
    amb.latitude, amb.longitude = body.latitude, body.longitude
    db.commit()
    return _ambulance(amb)


@router.get("/api/incidents/{incident_id}/notifications", summary="Family notification log")
def list_notifications(incident_id: str, principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN)),
                       db: Session = Depends(get_db)):
    load_incident(db, incident_id, principal)
    rows = db.query(NotificationLog).filter(NotificationLog.incident_id == incident_id).order_by(NotificationLog.id)
    return [notification_service.serialize(r) for r in rows]


@router.post("/api/incidents/{incident_id}/notifications/retry", summary="Retry failed family notifications")
def retry_notifications(incident_id: str, principal: Principal = Depends(require_roles(EMS, ADMIN)),
                        db: Session = Depends(get_db)):
    incident = load_incident(db, incident_id, principal)
    retried = notification_service.retry_failed(db, incident, principal.actor)
    db.commit()
    return [notification_service.serialize(r) for r in retried]
