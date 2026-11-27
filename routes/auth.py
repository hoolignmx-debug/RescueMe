"""Login, emergency incident tokens, and audit-log viewing."""
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from config import settings
from constants import ADMIN, EMS, HOSPITAL, ROLES
from database import get_db
from models import AuditLog, IncidentAccessToken, Staff
from schemas import AccessTokenRequest
from security import (Principal, api_error, create_incident_token, create_staff_token, get_principal,
                      require_roles, verify_password)
from services import audit_service
from services.audit_service import log_event
from services.incident_service import load_incident

router = APIRouter(tags=["Auth & Audit"])


@router.post("/api/auth/login", summary="Log in (JSON or form) and get a bearer token")
async def login(request: Request, db: Session = Depends(get_db)):
    """Send `{"username": "...", "password": "..."}` as JSON (frontends) or as a form (Swagger's Authorize button)."""
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.json()
    else:
        body = dict(await request.form())
    username, password = str(body.get("username", "")), str(body.get("password", ""))

    staff = db.query(Staff).filter(Staff.username == username).first()
    if not staff or not staff.active or not verify_password(password, staff.password_hash):
        log_event(db, "LOGIN_FAILED", username or "unknown", None, None, {})
        db.commit()
        raise api_error(401, "INVALID_CREDENTIALS", "Wrong username or password.")

    log_event(db, "LOGIN_SUCCESS", staff.username, staff.role)
    db.commit()
    return {
        "access_token": create_staff_token(staff),
        "token_type": "bearer",
        "expires_in_minutes": settings.STAFF_TOKEN_MINUTES,
        "user": {"staff_id": staff.staff_id, "username": staff.username, "full_name": staff.full_name,
                 "role": staff.role, "hospital_id": staff.hospital_id},
    }


@router.get("/api/auth/me", summary="Who am I?")
def me(principal: Principal = Depends(get_principal)):
    return principal.__dict__


@router.post("/api/incidents/{incident_id}/access-token",
             summary="Issue a short-lived emergency token for ONE incident")
def issue_incident_token(incident_id: str, body: Optional[AccessTokenRequest] = None,
                         principal: Principal = Depends(require_roles(EMS, HOSPITAL, ADMIN)),
                         db: Session = Depends(get_db)):
    """For paramedics / ER staff. The token works only for this incident, carries the caller's role,
    expires quickly, and can be revoked. It cannot be used anywhere else (it is not a universal password)."""
    load_incident(db, incident_id, principal)
    minutes = (body.expires_minutes if body and body.expires_minutes else settings.INCIDENT_TOKEN_MINUTES)
    staff = db.get(Staff, principal.staff_id)
    token, record = create_incident_token(db, staff, incident_id, minutes)
    log_event(db, "INCIDENT_TOKEN_ISSUED", principal.actor, principal.role, incident_id,
              {"jti": record.jti, "expires_at": record.expires_at.isoformat()})
    db.commit()
    return {"access_token": token, "token_type": "bearer", "jti": record.jti, "incident_id": incident_id,
            "role": record.role, "expires_at": record.expires_at}


@router.delete("/api/access-tokens/{jti}", summary="Revoke an incident token")
def revoke_incident_token(jti: str, principal: Principal = Depends(require_roles(*ROLES)),
                          db: Session = Depends(get_db)):
    record = db.get(IncidentAccessToken, jti)
    if not record:
        raise api_error(404, "TOKEN_NOT_FOUND", "No such token.")
    if principal.role != ADMIN and record.staff_id != principal.staff_id:
        raise api_error(403, "FORBIDDEN", "Only the token's owner or an admin can revoke it.")
    record.revoked = True
    log_event(db, "INCIDENT_TOKEN_REVOKED", principal.actor, principal.role, record.incident_id, {"jti": jti})
    db.commit()
    return {"jti": jti, "revoked": True}


@router.get("/api/incidents/{incident_id}/audit", summary="Audit history of one incident")
def incident_audit(incident_id: str, principal: Principal = Depends(require_roles(HOSPITAL, ADMIN)),
                   db: Session = Depends(get_db)):
    load_incident(db, incident_id, principal)
    rows = (db.query(AuditLog).filter(AuditLog.incident_id == incident_id)
            .order_by(AuditLog.timestamp, AuditLog.id).all())
    log_event(db, "AUDIT_VIEWED", principal.actor, principal.role, incident_id)
    db.commit()
    return [audit_service.serialize(r) for r in rows]


@router.get("/api/audit-logs", summary="All audit logs (admin)")
def all_audit_logs(action: Optional[str] = None, actor: Optional[str] = None, limit: int = 200,
                   principal: Principal = Depends(require_roles(ADMIN)), db: Session = Depends(get_db)):
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action == action)
    if actor:
        q = q.filter(AuditLog.actor == actor)
    rows = q.order_by(AuditLog.id.desc()).limit(min(limit, 1000)).all()
    return [audit_service.serialize(r) for r in rows]
