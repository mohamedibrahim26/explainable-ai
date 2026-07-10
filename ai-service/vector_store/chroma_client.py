"""
ChromaDB vector store client.

Collections are namespaced per user/conversation so documents
stay isolated between users.
"""

import logging
from typing import List, Dict, Any, Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

from config import settings

logger = logging.getLogger(__name__)

# Singleton client
_client: Optional[chromadb.PersistentClient] = None


def get_client() -> chromadb.PersistentClient:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        logger.info(f"ChromaDB initialised at {settings.chroma_persist_dir}")
    return _client


def get_or_create_collection(name: str) -> chromadb.Collection:
    client = get_client()
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def add_chunks(
    collection_name: str,
    chunks: List[str],
    embeddings: List[List[float]],
    metadatas: Optional[List[Dict[str, Any]]] = None,
    ids: Optional[List[str]] = None,
) -> int:
    """Store text chunks + their embeddings. Returns number stored."""
    if not chunks:
        return 0

    col = get_or_create_collection(collection_name)

    if ids is None:
        # Generate stable IDs based on content hash
        import hashlib
        ids = [hashlib.md5(c.encode()).hexdigest() + f"_{i}" for i, c in enumerate(chunks)]

    if metadatas is None:
        metadatas = [{"chunk_index": i} for i in range(len(chunks))]

    col.upsert(
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids,
    )
    return len(chunks)


def query_collection(
    collection_name: str,
    query_embedding: List[float],
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Return the top_k most relevant chunks for a query embedding."""
    try:
        col = get_or_create_collection(collection_name)
        count = col.count()
        if count == 0:
            return []

        results = col.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, count),
            include=["documents", "metadatas", "distances"],
        )

        chunks = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            chunks.append({
                "text": doc,
                "metadata": meta,
                "score": round(1 - dist, 4),  # convert distance → similarity
            })
        return chunks

    except Exception as e:
        logger.error(f"ChromaDB query error: {e}")
        return []


def delete_collection(collection_name: str) -> bool:
    try:
        client = get_client()
        client.delete_collection(collection_name)
        return True
    except Exception as e:
        logger.error(f"Could not delete collection {collection_name}: {e}")
        return False


def list_collections() -> List[str]:
    client = get_client()
    return [c.name for c in client.list_collections()]
