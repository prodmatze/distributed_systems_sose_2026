from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 60 * 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
