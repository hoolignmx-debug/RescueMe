from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models
from config import settings
from constants import ROLES, STATUSES, TRANSITIONS
from database import Base, engine
from routes import auth, demo, dispatch, hospital, incidents, profiles
from seed import seed_if_empty



@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.AUTO_SEED and seed_if_empty():
        print("Empty database: demo data seeded (logins: field1/field123, ems1/ems123, "
              "doctor1/doctor123, admin/admin123).")
    yield


app = FastAPI(
    title="MediRescue AI Backend",
    description=(
        "central Api for the Emergency SOS system"
    ),
    version="1.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(incidents.router)
app.include_router(profiles.router)
app.include_router(dispatch.router)
app.include_router(hospital.router)
app.include_router(demo.router)

@app.get("/")
def home():
    return{"message":"application is running"}

@app.get("/health", tags=["Meta"])
def health():
    return {"status": "ok", "service": "medirescue-backend"}


@app.get("/api/meta", tags=["Meta"], summary="Shared contract: roles, statuses, allowed transitions")
def meta():
    return {"roles": ROLES, "statuses": STATUSES, "transitions": TRANSITIONS,
            "embedding_dim": settings.EMBEDDING_DIM}
