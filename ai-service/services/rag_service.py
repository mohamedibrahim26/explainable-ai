"""
RAG (Retrieval-Augmented Generation) pipeline.

Flow:
  1. Ingest:  upload file → extract text → chunk → embed → store in ChromaDB
  2. Retrieve: user query → embed → vector search → top-k chunks
  3. Augment:  inject chunks into system prompt before LLM call
"""

import io
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from services.embedding_service import embed_texts, embed_single
from vector_store.chroma_client import add_chunks, query_collection

logger = logging.getLogger(__name__)

# ── Chunking constants ────────────────────────────────────────────────────────
CHUNK_SIZE    = 512    # characters per chunk
CHUNK_OVERLAP = 64     # overlap between consecutive chunks


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_text_from_pdf(content: bytes) -> str:
    """Extract plain text from PDF bytes."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages)
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        raise ValueError(f"Could not read PDF: {e}")


def extract_text_from_docx(content: bytes) -> str:
    """Extract plain text from DOCX bytes."""
    try:
        from docx import Document
        doc = Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    except Exception as e:
        logger.error(f"DOCX extraction error: {e}")
        raise ValueError(f"Could not read DOCX: {e}")


def extract_text_from_txt(content: bytes) -> str:
    """Decode plain text files, auto-detecting encoding."""
    import chardet
    detected = chardet.detect(content)
    encoding = detected.get("encoding") or "utf-8"
    return content.decode(encoding, errors="replace")


def extract_text(filename: str, content: bytes) -> str:
    """Route to the correct extractor based on file extension."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return extract_text_from_pdf(content)
    if ext in (".docx", ".doc"):
        return extract_text_from_docx(content)
    if ext in (".txt", ".md", ".csv"):
        return extract_text_from_txt(content)
    raise ValueError(f"Unsupported file type: {ext}. Supported: PDF, DOCX, TXT, MD, CSV")


# ── Chunking ─────────────────────────────────────────────────────────────────

def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> List[str]:
    """
    Split text into overlapping chunks on sentence boundaries where possible.
    Falls back to character-level splitting.
    """
    # Normalise whitespace
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if len(text) <= chunk_size:
        return [text] if text else []

    # Try sentence-aware splitting
    sentences = re.split(r"(?<=[.!?])\s+", text)

    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= chunk_size:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            # If sentence alone exceeds chunk_size, hard-split it
            while len(sentence) > chunk_size:
                chunks.append(sentence[:chunk_size])
                sentence = sentence[chunk_size - overlap:]
            current = sentence

    if current:
        chunks.append(current)

    # Apply overlap between consecutive chunks
    if overlap > 0 and len(chunks) > 1:
        overlapped = [chunks[0]]
        for i in range(1, len(chunks)):
            tail = chunks[i - 1][-overlap:]
            overlapped.append((tail + " " + chunks[i]).strip())
        return overlapped

    return chunks


# ── Ingest pipeline ───────────────────────────────────────────────────────────

async def ingest_document(
    filename: str,
    content: bytes,
    collection_name: str,
    metadata_extra: Optional[Dict[str, Any]] = None,
) -> Tuple[int, str]:
    """
    Full ingest pipeline:
      extract → chunk → embed → store

    Returns (chunks_stored, extracted_text_preview).
    """
    # 1. Extract
    text = extract_text(filename, content)
    if not text.strip():
        raise ValueError("Document appears to be empty or unreadable.")

    # 2. Chunk
    chunks = chunk_text(text)
    logger.info(f"Document '{filename}' → {len(chunks)} chunks")

    # 3. Embed
    embeddings = await embed_texts(chunks)

    # 4. Build metadata
    base_meta = {"filename": filename, "source": "upload"}
    if metadata_extra:
        base_meta.update(metadata_extra)

    metadatas = [{**base_meta, "chunk_index": i} for i in range(len(chunks))]

    # 5. Store
    stored = add_chunks(
        collection_name=collection_name,
        chunks=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )

    preview = text[:300].replace("\n", " ")
    return stored, preview


# ── Retrieval ─────────────────────────────────────────────────────────────────

async def retrieve_context(
    query: str,
    collection_name: str,
    top_k: int = 5,
    min_score: float = 0.3,
) -> List[Dict[str, Any]]:
    """
    Retrieve the most relevant chunks for a query.
    Filters out low-relevance results (score < min_score).
    """
    query_embedding = await embed_single(query)
    results = query_collection(collection_name, query_embedding, top_k=top_k)
    filtered = [r for r in results if r["score"] >= min_score]
    return filtered


def build_rag_system_prompt(
    base_system_prompt: str,
    chunks: List[Dict[str, Any]],
) -> str:
    """
    Inject retrieved chunks into the system prompt.
    The LLM is instructed to ground its answer in the provided context.
    """
    if not chunks:
        return base_system_prompt

    context_block = "\n\n---\n\n".join(
        f"[Source: {c['metadata'].get('filename', 'document')}]\n{c['text']}"
        for c in chunks
    )

    return f"""{base_system_prompt}

## Retrieved Document Context

The following excerpts were retrieved from the user's uploaded documents.
Use them to answer the user's question accurately.
If the answer is not in the context, say so clearly — do not hallucinate.

{context_block}

---
Answer based on the context above when relevant."""
