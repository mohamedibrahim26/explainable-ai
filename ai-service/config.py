"""Central configuration — reads from .env / environment variables."""
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # ── LLM providers ─────────────────────────────────────────────────────────
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    gemini_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    # ── Routing ───────────────────────────────────────────────────────────────
    default_provider: str = "groq"
    fallback_chain: str = "groq,openai,anthropic,gemini,ollama"

    # ── Embeddings ────────────────────────────────────────────────────────────
    embedding_provider: str = "local"   # "local" | "openai"

    # ── Vector DB ─────────────────────────────────────────────────────────────
    chroma_persist_dir: str = "./chroma_db"

    # ── Service ───────────────────────────────────────────────────────────────
    ai_service_port: int = 8000
    ai_service_secret: str = "change-me-in-production"
    cors_origins: str = "http://localhost:3001,http://127.0.0.1:5500,http://localhost:5500"

    @property
    def fallback_providers(self) -> List[str]:
        return [p.strip() for p in self.fallback_chain.split(",") if p.strip()]

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
