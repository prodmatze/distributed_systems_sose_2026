"""Observer-local settings. Env-prefixed OBS_ so they can never collide with
the core services' env. The observer deliberately has its own settings class
instead of importing shared.settings: it must be bootable with zero knowledge
of JWT secrets or the app's ORM. Every field has a default; empty database_url
silently disables the pg_stats producer instead of crashing."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    redis_url: str = "redis://redis:6379/0"
    # Plain postgresql:// DSN (raw asyncpg, no SQLAlchemy driver suffix).
    database_url: str = ""
    docker_host: str = "http://socket-proxy:2375"

    stream: str = "obs:events"
    stream_maxlen: int = 2000
    replay_count: int = 300

    compose_project: str = "chorus"
    gateway_container: str = "chorus-gateway-1"
    cors_origin: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_prefix="OBS_", case_sensitive=False, extra="ignore")


settings = Settings()
