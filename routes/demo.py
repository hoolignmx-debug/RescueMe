"""Demo helpers so Member 1 can test matching without a real face model. Disabled when DEMO_MODE=false."""
import random
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from config import settings
from constants import ROLES
from database import get_db
from models import User
from security import Principal, api_error, require_roles

router = APIRouter(prefix="/api/demo", tags=["Demo helpers"])


@router.get("/test-scan", summary="Get a fake scan embedding for a demo user (or a stranger)")
def test_scan(user_id: Optional[str] = None, noise: float = 0.03,
              principal: Principal = Depends(require_roles(*ROLES)), db: Session = Depends(get_db)):
    """- `?user_id=USR-001` -> a scan that should VERIFY as Aarav
    - `?user_id=USR-003` -> AMBIGUOUS (Riya has a look-alike twin, Diya)
    - `?user_id=USR-001&noise=0.09` -> NEEDS_REVIEW (blurry scan)
    - no user_id -> NO_MATCH (stranger)

    Copy `scan_data` into POST /api/incidents/{id}/scan."""
    if not settings.DEMO_MODE:
        raise api_error(404, "DEMO_DISABLED", "Demo helpers are turned off.")
    rng = np.random.default_rng(random.randint(0, 10**9))
    if user_id:
        user = db.get(User, user_id)
        if not user or not user.face_embedding:
            raise api_error(404, "USER_NOT_FOUND", "No such user with a face reference.")
        base = np.asarray(user.face_embedding, dtype=float)
    else:
        base = rng.normal(size=settings.EMBEDDING_DIM)
        base /= np.linalg.norm(base)
    vec = base + rng.normal(scale=max(noise, 0.0), size=base.shape)
    vec /= np.linalg.norm(vec)
    return {"based_on": user_id or "stranger", "noise": noise, "scan_data": [round(float(x), 6) for x in vec]}
