"""Authorized face-matching service.

Compares a scan embedding against the reference embeddings of consenting (synthetic) users.
A similarity score is never treated as proof by itself:
  - clear, high score            -> VERIFIED      -> IDENTITY_VERIFIED
  - high but a close runner-up   -> AMBIGUOUS     -> MATCH_REVIEW (a human must confirm)
  - medium score                 -> NEEDS_REVIEW  -> MATCH_REVIEW
  - low score                    -> NO_MATCH      -> MATCH_REVIEW (fallback: treat as unidentified)
"""
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sqlalchemy.orm import Session

from config import settings
from constants import MATCH_AMBIGUOUS, MATCH_NEEDS_REVIEW, MATCH_NONE, MATCH_VERIFIED
from models import User

_executor = ThreadPoolExecutor(max_workers=2)


class ScanQualityError(Exception):
    """The scan cannot be used. The app should ask for another capture."""


class MatchingUnavailable(Exception):
    """Matching took too long or failed. The incident stays in SCAN_RECEIVED and can be retried."""


@dataclass
class MatchOutcome:
    result: str
    user_id: Optional[str]
    score: float
    candidates: list = field(default_factory=list)   # [{"user_id": ..., "score": ...}]


def validate_embedding(values) -> np.ndarray:
    if not isinstance(values, (list, tuple)) or len(values) != settings.EMBEDDING_DIM:
        got = len(values) if isinstance(values, (list, tuple)) else type(values).__name__
        raise ScanQualityError(f"Embedding must have {settings.EMBEDDING_DIM} numbers (got {got}).")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        raise ScanQualityError("Embedding contains invalid numbers.")
    vec = np.asarray(values, dtype=float)
    norm = np.linalg.norm(vec)
    if norm < 1e-9:
        raise ScanQualityError("Embedding is empty (all zeros). Capture again.")
    return vec / norm


def _rank(probe: np.ndarray, gallery: list[tuple[str, list]]) -> list[tuple[str, float]]:
    scores = []
    for user_id, ref in gallery:
        ref_vec = np.asarray(ref, dtype=float)
        n = np.linalg.norm(ref_vec)
        if n < 1e-9 or ref_vec.shape != probe.shape:
            continue
        scores.append((user_id, float(np.dot(probe, ref_vec / n))))
    return sorted(scores, key=lambda s: s[1], reverse=True)


def decide(ranked: list[tuple[str, float]]) -> MatchOutcome:
    """The matching policy. Kept separate so it is easy to explain and test."""
    if not ranked:
        return MatchOutcome(MATCH_NONE, None, 0.0, [])

    best_id, best = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else -1.0
    candidates = [{"user_id": u, "score": round(s, 4)} for u, s in ranked[:3]
                  if s >= settings.MATCH_REVIEW_THRESHOLD]

    if best >= settings.MATCH_VERIFIED_THRESHOLD:
        if best - second >= settings.MATCH_AMBIGUITY_MARGIN:
            return MatchOutcome(MATCH_VERIFIED, best_id, best, candidates)
        return MatchOutcome(MATCH_AMBIGUOUS, None, best, candidates)
    if best >= settings.MATCH_REVIEW_THRESHOLD:
        return MatchOutcome(MATCH_NEEDS_REVIEW, None, best, candidates)
    return MatchOutcome(MATCH_NONE, None, best, [])


def match_embedding(db: Session, embedding) -> MatchOutcome:
    probe = validate_embedding(embedding)
    # Only people who have consented and have reference data are searched.
    gallery = [(u.user_id, u.face_embedding) for u in
               db.query(User).filter(User.consent_status == "GRANTED", User.face_embedding.isnot(None))]
    future = _executor.submit(_rank, probe, gallery)
    try:
        ranked = future.result(timeout=settings.MATCH_TIMEOUT_SECONDS)
    except FutureTimeout:
        raise MatchingUnavailable("Matching service timed out.")
    except Exception as exc:  # noqa: BLE001
        raise MatchingUnavailable(f"Matching failed: {exc}")
    return decide(ranked)
