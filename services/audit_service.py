"""Audit logging: every sensitive read or write gets a row in audit_logs."""
from typing import Optional

from sqlalchemy.orm import Session

from models import AuditLog


def log_event(db: Session, action: str, actor: str = "system", role: Optional[str] = None,
              incident_id: Optional[str] = None, details: Optional[dict] = None) -> AuditLog:
    """Adds an audit row. The caller commits it together with the rest of the request's changes."""
    entry = AuditLog(action=action, actor=actor, role=role, incident_id=incident_id, details=details or {})
    db.add(entry)
    return entry


def serialize(entry: AuditLog) -> dict:
    return {
        "id": entry.id,
        "incident_id": entry.incident_id,
        "actor": entry.actor,
        "role": entry.role,
        "action": entry.action,
        "details": entry.details,
        "timestamp": entry.timestamp,
    }
