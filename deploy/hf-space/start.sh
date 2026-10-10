#!/usr/bin/env bash
# Starts all three parts of Orion-XAI inside one Hugging Face Space container:
#   Ollama (fine-tuned model)  -> 127.0.0.1:11434
#   Python AI service          -> 127.0.0.1:8000
#   Node backend + frontend    -> 0.0.0.0:7860  (the public port)
set -euo pipefail

DATA_DIR="${DATA_DIR:-/home/user/data}"
mkdir -p "$DATA_DIR/chroma"

# Secrets: use Space secrets if set, otherwise generate fresh ones for this run.
# (Free Spaces have no persistent disk, so users and chats reset on restart anyway.)
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 32)}"
export AI_SERVICE_SECRET="${AI_SERVICE_SECRET:-$(openssl rand -hex 32)}"

# ── 1. Ollama ────────────────────────────────────────────────────────────────
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_KEEP_ALIVE=24h
ollama serve > /tmp/ollama.log 2>&1 &
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:11434/api/tags > /dev/null && break
  sleep 1
done
# Load the model into memory now so the first visitor doesn't wait for it.
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"orion-xai","prompt":"hi","stream":false,"options":{"num_predict":1}}' > /dev/null || true
echo "Ollama ready"

# ── 2. Python AI service ─────────────────────────────────────────────────────
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export FALLBACK_CHAIN="${FALLBACK_CHAIN:-ollama,groq}"   # Groq is used only if GROQ_API_KEY is set
export CHROMA_PERSIST_DIR="$DATA_DIR/chroma"
export EMBEDDING_PROVIDER=local
(cd /home/user/app/ai-service && uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning) &
for i in $(seq 1 120); do
  curl -sf http://127.0.0.1:8000/health > /dev/null && break
  sleep 1
done
echo "AI service ready"

# ── 3. Node backend (serves the frontend too) ────────────────────────────────
export DATABASE_URL="file:$DATA_DIR/orion.db"
export AI_SERVICE_URL=http://127.0.0.1:8000
export PORT=7860
cd /home/user/app/backend
npx prisma migrate deploy
exec node src/server.js
