# Orion-XAI on Hugging Face Spaces (free CPU: 2 vCPU, 16 GB RAM).
# Built from the repo root layout that .github/workflows/deploy-hf-space.yml pushes to the Space.
FROM python:3.11-slim

# Where the quantised fine-tuned model lives on the Hugging Face Hub
ARG GGUF_REPO=SnowyIbrahim/orion-xai-gguf
ARG GGUF_FILE=orion-xai-q4_k_m.gguf

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates openssl zstd gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://ollama.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/home/user/.cache/huggingface \
    OLLAMA_MODELS=/home/user/.ollama/models
WORKDIR /home/user/app

# ── Python AI service ────────────────────────────────────────────────────────
# CPU-only PyTorch first, so sentence-transformers doesn't pull the 2+ GB CUDA build
COPY --chown=user ai-service/requirements.txt ai-service/requirements.txt
RUN pip install --user torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --user -r ai-service/requirements.txt \
    && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
COPY --chown=user ai-service ai-service

# ── Node backend + frontend ──────────────────────────────────────────────────
COPY --chown=user backend/package.json backend/package-lock.json backend/
COPY --chown=user backend/prisma backend/prisma
RUN cd backend && npm ci
COPY --chown=user backend backend

# ── Fine-tuned model: download the GGUF and register it with Ollama ──────────
COPY --chown=user Modelfile start.sh ./
RUN mkdir -p /home/user/models \
    && curl -fL -o /home/user/models/orion-xai.gguf \
       "https://huggingface.co/${GGUF_REPO}/resolve/main/${GGUF_FILE}" \
    && (ollama serve > /tmp/ollama-build.log 2>&1 &) \
    && for i in $(seq 1 30); do curl -sf http://127.0.0.1:11434/api/tags > /dev/null && break; sleep 1; done \
    && ollama create orion-xai -f Modelfile \
    && rm /home/user/models/orion-xai.gguf

EXPOSE 7860
CMD ["./start.sh"]
