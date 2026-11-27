"""Synthetic demo data. Every person, phone number and medical record here is FAKE.

Run:  python seed.py          (adds data only if the database is empty)
      python seed.py --reset  (deletes everything and re-seeds)
"""
import sys

import numpy as np

from config import settings
from database import Base, SessionLocal, engine
from models import Ambulance, EmergencyContact, Hospital, MedicalProfile, Staff, User
from security import hash_password


def _embedding(seed: int, base=None, noise=0.0) -> list[float]:
    rng = np.random.default_rng(seed)
    vec = rng.normal(size=settings.EMBEDDING_DIM) if base is None else np.asarray(base) + rng.normal(
        scale=noise, size=settings.EMBEDDING_DIM)
    vec /= np.linalg.norm(vec)
    return [round(float(x), 6) for x in vec]


DEMO_LOGINS = [
    # username, password, role, full name, hospital
    ("field1", "field123", "field_responder", "Field Responder (Member 1 app)", None),
    ("ems1", "ems123", "ems", "EMS Dispatcher (Member 3)", None),
    ("doctor1", "doctor123", "hospital", "Dr. Demo, City Trauma Centre (Member 4)", "HOSP-001"),
    ("nurse2", "nurse123", "hospital", "Nurse Demo, Metro Care ER", "HOSP-002"),
    ("admin", "admin123", "admin", "System Admin", None),
]


def seed(db) -> None:
    # ---------- Hospitals (Greater Noida area, fake names) ----------
    hospitals = [
        Hospital(hospital_id="HOSP-001", name="City Trauma Centre", address="Knowledge Park II, Greater Noida",
                 latitude=28.4710, longitude=77.4920, er_status="OPEN",
                 blood_stock={"O+": 14, "O-": 5, "A+": 9, "A-": 2, "B+": 11, "B-": 1, "AB+": 4, "AB-": 1}),
        Hospital(hospital_id="HOSP-002", name="Metro Care ER", address="Alpha 1, Greater Noida",
                 latitude=28.4760, longitude=77.5100, er_status="BUSY",
                 blood_stock={"O+": 6, "O-": 2, "A+": 5, "A-": 0, "B+": 4, "B-": 0, "AB+": 2, "AB-": 0}),
        Hospital(hospital_id="HOSP-003", name="Riverside General Hospital", address="Pari Chowk, Greater Noida",
                 latitude=28.4630, longitude=77.5130, er_status="DIVERTING",
                 blood_stock={"O+": 8, "O-": 3, "A+": 6, "A-": 1, "B+": 7, "B-": 1, "AB+": 2, "AB-": 0}),
    ]
    ambulances = [
        Ambulance(ambulance_id="AMB-001", vehicle_no="UP16-AB-1001", status="AVAILABLE",
                  latitude=28.4650, longitude=77.4850, hospital_id="HOSP-001"),
        Ambulance(ambulance_id="AMB-002", vehicle_no="UP16-AB-1002", status="AVAILABLE",
                  latitude=28.4800, longitude=77.5050, hospital_id="HOSP-002"),
        Ambulance(ambulance_id="AMB-003", vehicle_no="UP16-AB-1003", status="AVAILABLE",
                  latitude=28.4600, longitude=77.5150, hospital_id="HOSP-003"),
        Ambulance(ambulance_id="AMB-004", vehicle_no="UP16-AB-1004", status="OUT_OF_SERVICE",
                  latitude=28.4710, longitude=77.4920, hospital_id="HOSP-001"),
    ]
    db.add_all(hospitals + ambulances)
    db.flush()

    # ---------- Demo people ----------
    riya = _embedding(103)
    people = [
        # (id, name, dob, gender, embedding, consent, blood, allergies, conditions, meds, implants, donor, contacts)
        ("USR-001", "Aarav Mehta", "1995-04-12", "Male", _embedding(101), "GRANTED",
         "O+", ["Penicillin"], ["Type 1 Diabetes"], ["Insulin"], [], "Yes",
         [("Meera Mehta", "Mother", "+91 90000 00101", 1), ("Rohan Mehta", "Brother", "+91 90000 00102", 2)]),
        ("USR-002", "Sneha Kapoor", "1988-09-30", "Female", _embedding(102), "GRANTED",
         "B-", ["Latex"], ["Asthma"], ["Salbutamol inhaler"], [], "No",
         [("Vikram Kapoor", "Husband", "+91 90000 00201", 1)]),
        ("USR-003", "Riya Sharma", "2001-01-15", "Female", riya, "GRANTED",
         "A+", [], [], [], [], "Undecided",
         [("Anil Sharma", "Father", "+91 90000 00301", 1)]),
        ("USR-004", "Diya Sharma", "2001-01-15", "Female", _embedding(104, base=riya, noise=0.02), "GRANTED",
         "AB+", ["Peanuts"], ["Epilepsy"], ["Levetiracetam"], [], "Yes",
         [("Anil Sharma", "Father", "+91 90000 00301", 1)]),
        ("USR-005", "Rajesh Verma", "1962-06-03", "Male", _embedding(105), "GRANTED",
         "O-", ["Aspirin"], ["Hypertension", "Coronary artery disease"], ["Amlodipine"],
         ["Cardiac pacemaker"], "Yes",
         [("Sunita Verma", "Wife", "+91 90000 00501", 1),
          ("Old Office Number", "Colleague", "+000 0000 0000", 2)]),      # +000 = simulated delivery failure
        ("USR-006", "Kabir Singh", "1999-11-21", "Male", _embedding(106), "REVOKED",
         "A-", [], [], [], [], "No",
         [("Harpreet Singh", "Sister", "+91 90000 00601", 1)]),           # consent revoked = never matched
    ]
    for (uid, name, dob, gender, emb, consent, blood, allergies, conditions, meds, implants, donor,
         contacts) in people:
        db.add(User(user_id=uid, name=name, dob=dob, gender=gender, face_embedding=emb, consent_status=consent))
        db.add(MedicalProfile(user_id=uid, blood_group=blood, allergies=allergies, conditions=conditions,
                              medications=meds, implants=implants, donor_preference=donor))
        for cname, rel, phone, prio in contacts:
            db.add(EmergencyContact(user_id=uid, name=cname, relation=rel, phone=phone, priority=prio))

    # ---------- Staff logins ----------
    for i, (username, password, role, full_name, hosp) in enumerate(DEMO_LOGINS, start=1):
        db.add(Staff(staff_id=f"STF-{i:03d}", username=username, full_name=full_name, role=role,
                     password_hash=hash_password(password), hospital_id=hosp))
    db.commit()


def seed_if_empty() -> bool:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Staff).count() == 0:
            seed(db)
            return True
        return False
    finally:
        db.close()


if __name__ == "__main__":
    if "--reset" in sys.argv:
        Base.metadata.drop_all(bind=engine)
        print("Database wiped.")
    print("Seeded demo data." if seed_if_empty() else "Database already has data (use --reset to start over).")
    print("\nDemo logins:")
    for username, password, role, _, hosp in DEMO_LOGINS:
        print(f"  {username:<8} / {password:<10} role={role}{'  hospital=' + hosp if hosp else ''}")
