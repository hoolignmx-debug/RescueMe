"""Image mode (optional): turns a base64 face photo into an embedding on the server.

Only used if Member 1 sends a photo instead of an embedding. Requires:  pip install deepface tf-keras
The photo is processed in memory and never saved.
"""
import base64

from config import settings
from services.matching_service import ScanQualityError


class EmbedderUnavailable(Exception):
    pass


def image_to_embedding(image_b64: str) -> list[float]:
    try:
        import cv2
        import numpy as np
        from deepface import DeepFace
    except ImportError:
        raise EmbedderUnavailable(
            "Image scans need DeepFace on the server (pip install deepface tf-keras). "
            f"Alternatively send scan_data as a list of {settings.EMBEDDING_DIM} numbers."
        )

    if "," in image_b64 and image_b64.strip().startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]          # strip "data:image/jpeg;base64,"
    try:
        raw = base64.b64decode(image_b64, validate=False)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        img = None
    if img is None:
        raise ScanQualityError("Image could not be decoded. Send a JPEG/PNG as base64.")

    try:
        reps = DeepFace.represent(img_path=img, model_name=settings.FACE_MODEL,
                                  detector_backend="opencv", enforce_detection=True)
    except ValueError:
        raise ScanQualityError("No face detected in the image. Capture again.")

    if not reps:
        raise ScanQualityError("No face detected in the image. Capture again.")
    # If several faces, use the largest one
    best = max(reps, key=lambda r: r.get("facial_area", {}).get("w", 0) * r.get("facial_area", {}).get("h", 0))
    return [float(x) for x in best["embedding"]]
