"""Pydantic request/response schemas for all API endpoints."""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal


# ── Shared ────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


# ── Chat ─────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: List[Message]
    provider: Optional[str] = None          # override default provider
    model: Optional[str] = None             # override default model for provider
    system_prompt: Optional[str] = None     # agent/persona system prompt
    temperature: float = Field(0.7, ge=0, le=2)
    max_tokens: int = Field(2048, ge=1, le=8192)
    stream: bool = True
    use_rag: bool = False                   # whether to augment with RAG context
    collection_name: Optional[str] = None  # which RAG collection to query


class ChatResponse(BaseModel):
    content: str
    provider: str
    model: str
    tokens_used: Optional[int] = None


# ── RAG / Document ingestion ─────────────────────────────────────────────────

class IngestResponse(BaseModel):
    success: bool
    collection_name: str
    chunks_added: int
    message: str


class RAGQueryRequest(BaseModel):
    query: str
    collection_name: str
    top_k: int = Field(5, ge=1, le=20)


class RAGQueryResponse(BaseModel):
    chunks: List[Dict[str, Any]]
    query: str


# ── Career Roadmap ────────────────────────────────────────────────────────────

class RoadmapRequest(BaseModel):
    goal: str                               # e.g. "Become a ML Engineer"
    current_skills: List[str] = []
    experience_level: Literal["beginner", "intermediate", "advanced"] = "beginner"
    timeframe_months: int = Field(12, ge=1, le=60)
    provider: Optional[str] = None
    learning_style: Optional[str] = None   # "visual", "reading", "projects"


class RoadmapMilestone(BaseModel):
    month: int
    title: str
    description: str
    skills: List[str]
    resources: List[str]
    project_idea: str


class RoadmapResponse(BaseModel):
    goal: str
    total_months: int
    milestones: List[RoadmapMilestone]
    final_outcome: str
    provider_used: str


# ── Safety ────────────────────────────────────────────────────────────────────

class SafetyCheckRequest(BaseModel):
    text: str


class SafetyCheckResponse(BaseModel):
    is_safe: bool
    flagged_categories: List[str]
    reason: Optional[str] = None


# ── Provider info ─────────────────────────────────────────────────────────────

class ProviderStatus(BaseModel):
    provider: str
    available: bool
    models: List[str]
    reason: Optional[str] = None


class ProvidersResponse(BaseModel):
    providers: List[ProviderStatus]
    default_provider: str
    fallback_chain: List[str]
