from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings live here. Values in .env (or real environment variables) override these defaults."""

    # Database
    DATABASE_URL: str = "sqlite:///./medirescue.db"

    # Auth
    JWT_SECRET: str = "change-me-to-a-long-random-string"
    JWT_ALGORITHM: str = "HS256"
    STAFF_TOKEN_MINUTES: int = 480          # normal login session (8 hours)
    INCIDENT_TOKEN_MINUTES: int = 30        # short-lived emergency access token

    # Face matching
    EMBEDDING_DIM: int = 128                # Facenet = 128, Facenet512 = 512
    MATCH_VERIFIED_THRESHOLD: float = 0.80  # similarity >= this (and clear winner) -> IDENTITY_VERIFIED
    MATCH_REVIEW_THRESHOLD: float = 0.60    # between review and verified -> MATCH_REVIEW
    MATCH_AMBIGUITY_MARGIN: float = 0.05    # top-2 closer than this -> ambiguous, never auto-confirm
    MATCH_TIMEOUT_SECONDS: float = 5.0
    MIN_SCAN_QUALITY: float = 0.5           # quality_score below this -> ask for re-capture
    FACE_MODEL: str = "Facenet"             # only used in image mode (DeepFace)

    # Incidents
    DUPLICATE_WINDOW_SECONDS: int = 60      # same responder + same spot within this window = duplicate
    DUPLICATE_DISTANCE_METERS: float = 50

    # Dispatch / tracking
    AMBULANCE_SPEED_KMPH: float = 40
    ROAD_FACTOR: float = 1.3                # straight-line distance * this ~= road distance

    # Notifications (mock)
    NOTIFICATION_CHANNEL: str = "MOCK_SMS"

    # Demo helpers (/api/demo/*) and auto-seeding. Turn off for anything real.
    DEMO_MODE: bool = True
    AUTO_SEED: bool = True

    # Comma-separated list of frontend URLs allowed to call the API. "*" = everyone (dev only).
    CORS_ORIGINS: str = "*"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
