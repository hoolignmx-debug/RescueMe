"""Distance and ETA helpers."""
import math
from typing import Optional

from config import settings


def haversine_km(lat1, lon1, lat2, lon2) -> Optional[float]:
    if None in (lat1, lon1, lat2, lon2):
        return None
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def eta_minutes(distance_km: Optional[float]) -> Optional[int]:
    if distance_km is None:
        return None
    road_km = distance_km * settings.ROAD_FACTOR
    return max(1, round(road_km / settings.AMBULANCE_SPEED_KMPH * 60)) if road_km > 0.05 else 0


def step_towards(lat, lon, target_lat, target_lon, fraction: float = 0.35, snap_km: float = 0.15):
    """Move a point part of the way to a target (used to simulate ambulance movement)."""
    dist = haversine_km(lat, lon, target_lat, target_lon)
    if dist is None or dist <= snap_km:
        return target_lat, target_lon
    return lat + (target_lat - lat) * fraction, lon + (target_lon - lon) * fraction
