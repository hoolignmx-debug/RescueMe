"""Login tokens, emergency incident tokens, and role-based access checks."""
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import IncidentAccessToken, Staff, utcnow
from services.audit_service import log_event

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def api_error(code: int, error: str, message: str, **extra) -> HTTPException:
    """Every error the API returns looks like: {"detail": {"error": "...", "message": "..."}}"""
    return HTTPException(status_code=code, detail={"error": error, "message": message, **extra})


# ---------- Passwords ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# ---------- Tokens ----------
def create_staff_token(staff: Staff) -> str:
    payload = {
        "sub": staff.staff_id,
        "role": staff.role,
        "type": "staff",
        "exp": utcnow() + timedelta(minutes=settings.STAFF_TOKEN_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_incident_token(db: Session, staff: Staff, incident_id: str, minutes: int) -> tuple[str, IncidentAccessToken]:
    jti = uuid.uuid4().hex
    expires = utcnow() + timedelta(minutes=minutes)
    record = IncidentAccessToken(jti=jti, incident_id=incident_id, staff_id=staff.staff_id,
                                 role=staff.role, expires_at=expires)
    db.add(record)
    payload = {"sub": staff.staff_id, "role": staff.role, "type": "incident",
               "incident_id": incident_id, "jti": jti, "exp": expires}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM), record


# ---------- Who is calling? ----------
@dataclass
class Principal:
    staff_id: str
    username: str
    role: str
    hospital_id: Optional[str]
    token_type: str                     # "staff" or "incident"
    incident_id: Optional[str] = None   # only for incident tokens
    jti: Optional[str] = None

    @property
    def actor(self) -> str:
        return self.username if self.token_type == "staff" else f"{self.username} (incident token)"


def get_principal(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Principal:
    if not token:
        raise api_error(401, "NOT_AUTHENTICATED", "Log in first and send 'Authorization: Bearer <token>'.")
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise api_error(401, "TOKEN_EXPIRED", "Your token has expired. Log in again or request a new incident token.")
    except jwt.InvalidTokenError:
        raise api_error(401, "INVALID_TOKEN", "Token is not valid.")

    staff = db.get(Staff, payload.get("sub"))
    if not staff or not staff.active:
        raise api_error(401, "INVALID_TOKEN", "Account not found or disabled.")

    if payload.get("type") == "incident":
        record = db.get(IncidentAccessToken, payload.get("jti"))
        if not record or record.revoked:
            raise api_error(401, "TOKEN_REVOKED", "This incident access token has been revoked.")
        if record.expires_at < utcnow():
            raise api_error(401, "TOKEN_EXPIRED", "This incident access token has expired.")
        return Principal(staff.staff_id, staff.username, record.role, staff.hospital_id,
                         "incident", record.incident_id, record.jti)

    return Principal(staff.staff_id, staff.username, staff.role, staff.hospital_id, "staff")


def require_roles(*roles: str, allow_incident_token: bool = False):
    """Use as: principal = Depends(require_roles("ems", "admin"))

    Incident tokens only work on routes that allow them AND only for their own incident_id.
    Every denial is audit-logged.
    """
    def dependency(request: Request, principal: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)) -> Principal:
        path_incident = request.path_params.get("incident_id")
        reason = None
        if principal.token_type == "incident":
            if not allow_incident_token:
                reason = "Incident tokens cannot be used on this endpoint."
            elif principal.incident_id != path_incident:
                reason = "This token is for a different incident."
        if reason is None and principal.role not in roles:
            reason = f"Role '{principal.role}' cannot access this. Allowed: {', '.join(roles)}."
        if reason:
            log_event(db, "ACCESS_DENIED", principal.actor, principal.role, path_incident,
                      {"path": request.url.path, "method": request.method, "reason": reason})
            db.commit()
            raise api_error(status.HTTP_403_FORBIDDEN, "FORBIDDEN", reason)
        return principal

    return dependency
