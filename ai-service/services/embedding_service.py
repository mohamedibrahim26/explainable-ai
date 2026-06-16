"""
Embedding service — converts text to vectors.

Two modes (set EMBEDDING_PROVIDER in .env):
  "local"  — sentence-transformers, runs 100% offline, no API key needed
  "openai" — text-embedding-3-small, higher quality, costs money
"""

import logging
from typing import List, Optional
import numpy as np

from config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded models
_local_model = None
_local_model_name = "all-MiniLM-L6-v2"   # 80MB, fast, good quality


def _get_local_model():
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading local embedding model: {_local_model_name}")
        _local_model = SentenceTransformer(_local_model_name)
        logger.info("Local embedding model loaded.")
    return _local_model


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """
    Embed a list of texts and return vectors.
    Uses whichever backend is configured (local or OpenAI).
    """
    if not texts:
        return []

    provider = settings.embedding_provider.lower()

    if provider == "openai" and settings.openai_api_key:
        return await _embed_openai(texts)
    else:
        return _embed_local(texts)


def _embed_local(texts: List[str]) -> List[List[float]]:
    """Sentence-transformers — fully offline, no API key."""
    model = _get_local_model()
    vectors = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return vectors.tolist()


async def _embed_openai(texts: List[str]) -> List[List[float]]:
    """OpenAI text-embedding-3-small."""
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    # Batch in chunks of 100 (OpenAI limit)
    all_vectors = []
    for i in range(0, len(texts), 100):
        batch = texts[i:i + 100]
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=batch,
        )
        all_vectors.extend([e.embedding for e in response.data])

    return all_vectors


async def embed_single(text: str) -> List[float]:
    """Convenience: embed one string."""
    results = await embed_texts([text])
    return results[0] if results else []


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    va = np.array(a)
    vb = np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)
