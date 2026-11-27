"""All database tables. Section 3.2 of the workflow PDF, plus staff logins, notification logs and incident tokens."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


def utcnow() -> datetime:
    """Current UTC time (stored without timezone; every timestamp in this API is UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    """A registered person (synthetic demo data only) who could be identified at an accident."""
    __tablename__ = "users"

    user_id = Column(String, primary_key=True)                 # USR-001
    name = Column(String, nullable=False)
    dob = Column(String)                                       # YYYY-MM-DD
    gender = Column(String)
    face_embedding = Column(JSON)                              # reference data: list of floats
    consent_status = Column(String, default="GRANTED")         # GRANTED / REVOKED
    created_at = Column(DateTime, default=utcnow)

    medical_profile = relationship("MedicalProfile", uselist=False, back_populates="user")
    contacts = relationship("EmergencyContact", back_populates="user", order_by="EmergencyContact.priority")


class MedicalProfile(Base):
    __tablename__ = "medical_profiles"

    user_id = Column(String, ForeignKey("users.user_id"), primary_key=True)
    blood_group = Column(String)
    allergies = Column(JSON, default=list)
    conditions = Column(JSON, default=list)
    medications = Column(JSON, default=list)
    implants = Column(JSON, default=list)
    donor_preference = Column(String)

    user = relationship("User", back_populates="medical_profile")


class EmergencyContact(Base):
    __tablename__ = "emergency_contacts"

    contact_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False)
    name = Column(String, nullable=False)
    relation = Column("relationship", String)
    phone = Column(String, nullable=False)
    priority = Column(Integer, default=1)                      # 1 = call first

    user = relationship("User", back_populates="contacts")


class Hospital(Base):
    __tablename__ = "hospitals"

    hospital_id = Column(String, primary_key=True)             # HOSP-001
    name = Column(String, nullable=False)
    address = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    er_status = Column(String, default="OPEN")
    blood_stock = Column(JSON, default=dict)                   # {"O+": 12, ...} demo data


class Ambulance(Base):
    __tablename__ = "ambulances"

    ambulance_id = Column(String, primary_key=True)            # AMB-001
    vehicle_no = Column(String)
    status = Column(String, default="AVAILABLE")
    latitude = Column(Float)
    longitude = Column(Float)
    hospital_id = Column(String, ForeignKey("hospitals.hospital_id"))   # home base
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Incident(Base):
    __tablename__ = "incidents"

    incident_id = Column(String, primary_key=True)             # INC-2026-0001
    user_id = Column(String, ForeignKey("users.user_id"), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_available = Column(Boolean, default=False)
    reported_at = Column(DateTime, default=utcnow)             # time on the device
    created_at = Column(DateTime, default=utcnow)              # time on the server
    severity = Column(String, default="UNKNOWN")
    status = Column(String, default="SCAN_PENDING", index=True)

    # matching
    match_result = Column(String, nullable=True)
    match_score = Column(Float, nullable=True)
    match_candidates = Column(JSON, default=list)              # [{"user_id":..., "score":...}]
    scan_attempts = Column(Integer, default=0)
    last_scan_at = Column(DateTime, nullable=True)

    ambulance_id = Column(String, ForeignKey("ambulances.ambulance_id"), nullable=True)
    hospital_id = Column(String, ForeignKey("hospitals.hospital_id"), nullable=True, index=True)

    client_request_id = Column(String, unique=True, nullable=True)   # duplicate protection
    created_by = Column(String)
    notes = Column(Text)
    closed_at = Column(DateTime, nullable=True)

    user = relationship("User")
    ambulance = relationship("Ambulance")
    hospital = relationship("Hospital")


class MedicalUpdate(Base):
    """Timeline: every status change and every medical/handoff note."""
    __tablename__ = "medical_updates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(String, ForeignKey("incidents.incident_id"), index=True)
    staff_id = Column(String)
    entry_type = Column(String, default="NOTE")                # STATUS_CHANGE / HANDOFF / TREATMENT / NOTE
    status = Column(String)                                    # incident status at that moment
    notes = Column(Text)
    timestamp = Column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(String, nullable=True, index=True)
    actor = Column(String)
    role = Column(String)
    action = Column(String)
    details = Column(JSON, default=dict)
    timestamp = Column(DateTime, default=utcnow)


class Staff(Base):
    """People who log in: field responders, EMS, hospital staff, admins."""
    __tablename__ = "staff"

    staff_id = Column(String, primary_key=True)                # STF-001
    username = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    role = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    hospital_id = Column(String, ForeignKey("hospitals.hospital_id"), nullable=True)
    active = Column(Boolean, default=True)


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(String, ForeignKey("incidents.incident_id"), index=True)
    contact_id = Column(Integer, ForeignKey("emergency_contacts.contact_id"))
    channel = Column(String)
    recipient = Column(String)
    message = Column(Text)
    status = Column(String)                                    # SENT / FAILED
    error = Column(String, nullable=True)
    attempts = Column(Integer, default=1)
    timestamp = Column(DateTime, default=utcnow)


class IncidentAccessToken(Base):
    """Short-lived emergency tokens, tied to one incident + one staff member + role. Revocable."""
    __tablename__ = "incident_access_tokens"

    jti = Column(String, primary_key=True)
    incident_id = Column(String, ForeignKey("incidents.incident_id"), index=True)
    staff_id = Column(String, ForeignKey("staff.staff_id"))
    role = Column(String)
    issued_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime)
    revoked = Column(Boolean, default=False)
