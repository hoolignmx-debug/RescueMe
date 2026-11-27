"""Mock family notifications (SMS/WhatsApp are simulated for the prototype).

Demo rule: any phone number starting with +000 fails, so you can show failure handling.
"""
from sqlalchemy.orm import Session

from config import settings
from models import Incident, NotificationLog, utcnow
from services.audit_service import log_event


def build_message(incident: Incident) -> str:
    name = incident.user.name if incident.user else "A person"
    if incident.location_available:
        where = f"location {incident.latitude:.5f}, {incident.longitude:.5f}"
    else:
        where = "a location being confirmed"
    msg = (f"EMERGENCY ALERT: {name} has been involved in an accident near {where}. "
           f"Emergency response has been initiated. Incident: {incident.incident_id}.")
    if incident.hospital:
        msg += f" Being taken to {incident.hospital.name}."
    return msg


def _send(channel: str, recipient: str, message: str) -> tuple[str, str | None]:
    """Mock gateway. Replace this function with a real SMS/WhatsApp provider later."""
    if recipient.replace(" ", "").startswith("+000"):
        return "FAILED", "Mock gateway: number unreachable"
    print(f"[{channel}] to {recipient}: {message}")
    return "SENT", None


def notify_family(db: Session, incident: Incident, actor: str = "system") -> list[NotificationLog]:
    """Sends one alert to each emergency contact of the identified patient. Runs only once per incident."""
    if not incident.user or incident.user.consent_status != "GRANTED":
        return []
    already = db.query(NotificationLog).filter(NotificationLog.incident_id == incident.incident_id).count()
    if already:
        return []

    message = build_message(incident)
    logs = []
    for contact in incident.user.contacts:
        status, error = _send(settings.NOTIFICATION_CHANNEL, contact.phone, message)
        entry = NotificationLog(incident_id=incident.incident_id, contact_id=contact.contact_id,
                                channel=settings.NOTIFICATION_CHANNEL, recipient=contact.phone,
                                message=message, status=status, error=error)
        db.add(entry)
        logs.append(entry)
    log_event(db, "FAMILY_NOTIFIED", actor, None, incident.incident_id,
              {"sent": sum(l.status == "SENT" for l in logs), "failed": sum(l.status == "FAILED" for l in logs)})
    return logs


def retry_failed(db: Session, incident: Incident, actor: str) -> list[NotificationLog]:
    failed = db.query(NotificationLog).filter(NotificationLog.incident_id == incident.incident_id,
                                              NotificationLog.status == "FAILED").all()
    for entry in failed:
        entry.status, entry.error = _send(entry.channel, entry.recipient, entry.message)
        entry.attempts += 1
        entry.timestamp = utcnow()
    log_event(db, "NOTIFICATION_RETRY", actor, None, incident.incident_id, {"retried": len(failed)})
    return failed


def serialize(entry: NotificationLog) -> dict:
    return {
        "id": entry.id, "incident_id": entry.incident_id, "contact_id": entry.contact_id,
        "channel": entry.channel, "recipient": entry.recipient, "message": entry.message,
        "status": entry.status, "error": entry.error, "attempts": entry.attempts, "timestamp": entry.timestamp,
    }
