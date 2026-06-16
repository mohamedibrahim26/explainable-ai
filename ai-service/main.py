"""
Orion AI — Python FastAPI Service
===================================
Provider-agnostic AI microservice for the Orion AI platform.

Endpoints
---------
GET  /health                    — liveness check
GET  /providers                 — list all providers + availability
POST /chat                      — streaming chat (SSE)
POST /chat/complete             — non-streaming chat
POST /ingest                    — upload document → RAG pipeline
POST /rag/query                 — retrieve relevant chunks
POST /roadmap                   — generate career roadmap
POST /safety/check              — content safety check
DELETE /collection/{name}       — delete a RAG collection
"""

import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from config import settings
from models.schemas import (
    ChatRequest, ChatResponse,
    IngestResponse, RAGQueryRequest, RAGQueryResponse,
    RoadmapRequest, RoadmapResponse,
    SafetyCheckRequest, SafetyCheckResponse,
    ProvidersResponse,
)
from services.llm_service import stream_chat, complete_chat, get_all_provider_statuses
from services.rag_service import ingest_document, retrieve_context, build_rag_system_prompt
from services.roadmap_service import generate_roadmap
from services.safety_service import check_safety

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Orion AI service starting up…")
    logger.info(f"Default provider: {settings.default_provider}")
    logger.info(f"Fallback chain:   {settings.fallback_chain}")
    logger.info(f"Embedding mode:   {settings.embedding_provider}")
    yield
    logger.info("Orion AI service shutting down.")


app = FastAPI(
    title="Orion AI Service",
    description="Provider-agnostic AI microservice — chat, RAG, roadmaps, safety.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth helper ───────────────────────────────────────────────────────────────

def verify_service_key(x_service_key: str = Header(default="")):
    """
    Optional service-to-service auth.
    Skip validation if no secret is configured (dev mode).
    """
    if settings.ai_service_secret == "change-me-in-production":
        return  # dev mode — no auth
    if x_service_key != settings.ai_service_secret:
        raise HTTPException(status_code=401, detail="Invalid service key.")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "orion-ai", "version": "1.0.0"}


# ── Providers ─────────────────────────────────────────────────────────────────

@app.get("/providers", response_model=ProvidersResponse)
async def list_providers():
    """Show which LLM providers are configured and available."""
    return ProvidersResponse(
        providers=get_all_provider_statuses(),
        default_provider=settings.default_provider,
        fallback_chain=settings.fallback_providers,
    )


# ── Chat (streaming SSE) ──────────────────────────────────────────────────────

@app.post("/chat")
async def chat_stream(req: ChatRequest, _=Depends(verify_service_key)):
    """
    Stream chat response as Server-Sent Events.
    The client reads `data: <token>` lines and concatenates them.
    A final `data: [DONE]` signals end of stream.
    """
    system_prompt = req.system_prompt or ""

    # RAG augmentation
    if req.use_rag and req.collection_name:
        last_user_msg = next(
            (m.content for m in reversed(req.messages) if m.role == "user"), ""
        )
        if last_user_msg:
            chunks = await retrieve_context(last_user_msg, req.collection_name)
            system_prompt = build_rag_system_prompt(system_prompt, chunks)

    async def event_generator():
        try:
            async for token in stream_chat(
                messages=req.messages,
                provider=req.provider,
                model=req.model,
                system_prompt=system_prompt,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                # Escape newlines in SSE data field
                escaped = token.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: [ERROR] {str(e)}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/chat/complete", response_model=ChatResponse)
async def chat_complete(req: ChatRequest, _=Depends(verify_service_key)):
    """Non-streaming version of /chat — returns full response at once."""
    system_prompt = req.system_prompt or ""

    if req.use_rag and req.collection_name:
        last_user = next(
            (m.content for m in reversed(req.messages) if m.role == "user"), ""
        )
        if last_user:
            chunks = await retrieve_context(last_user, req.collection_name)
            system_prompt = build_rag_system_prompt(system_prompt, chunks)

    content, provider_used, model_used = await complete_chat(
        messages=req.messages,
        provider=req.provider,
        model=req.model,
        system_prompt=system_prompt,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )

    # Strip internal metadata marker
    content = content.split("[ORION_META]")[0].strip()

    return ChatResponse(
        content=content,
        provider=provider_used,
        model=model_used,
    )


# ── Document ingest ───────────────────────────────────────────────────────────

@app.post("/ingest", response_model=IngestResponse)
async def ingest(
    file: UploadFile = File(...),
    collection_name: str = Form(...),
    _=Depends(verify_service_key),
):
    """
    Upload a PDF, DOCX, TXT, or MD file.
    Extracts text, chunks it, embeds it, and stores in ChromaDB.
    """
    content = await file.read()

    if len(content) > 50 * 1024 * 1024:  # 50 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 50 MB).")

    try:
        chunks_stored, preview = await ingest_document(
            filename=file.filename,
            content=content,
            collection_name=collection_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return IngestResponse(
        success=True,
        collection_name=collection_name,
        chunks_added=chunks_stored,
        message=f"Successfully ingested '{file.filename}' — {chunks_stored} chunks stored.",
    )


# ── RAG query ─────────────────────────────────────────────────────────────────

@app.post("/rag/query", response_model=RAGQueryResponse)
async def rag_query(req: RAGQueryRequest, _=Depends(verify_service_key)):
    """Retrieve the most relevant document chunks for a query."""
    chunks = await retrieve_context(req.query, req.collection_name, top_k=req.top_k)
    return RAGQueryResponse(chunks=chunks, query=req.query)


# ── Delete collection ─────────────────────────────────────────────────────────

@app.delete("/collection/{name}")
async def delete_collection(name: str, _=Depends(verify_service_key)):
    from vector_store.chroma_client import delete_collection as _del
    success = _del(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Collection '{name}' not found.")
    return {"deleted": name}


# ── Career Roadmap ────────────────────────────────────────────────────────────

@app.post("/roadmap", response_model=RoadmapResponse)
async def create_roadmap(req: RoadmapRequest, _=Depends(verify_service_key)):
    """Generate a structured career roadmap using AI."""
    try:
        roadmap = await generate_roadmap(
            goal=req.goal,
            current_skills=req.current_skills,
            experience_level=req.experience_level,
            timeframe_months=req.timeframe_months,
            provider=req.provider,
            learning_style=req.learning_style,
        )
        return roadmap
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Safety check ──────────────────────────────────────────────────────────────

@app.post("/safety/check", response_model=SafetyCheckResponse)
async def safety_check(req: SafetyCheckRequest, _=Depends(verify_service_key)):
    """Check if text is safe. Fast local check + optional LLM deep-check."""
    is_safe, flags, reason = await check_safety(req.text, use_llm=False)
    return SafetyCheckResponse(
        is_safe=is_safe,
        flagged_categories=flags,
        reason=reason if not is_safe else None,
    )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.ai_service_port,
        reload=True,
        log_level="info",
    )
