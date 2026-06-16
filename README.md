# Explainable AI - Orion-XAI

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Python](https://img.shields.io/badge/Python-3.10+-blue) ![Ollama](https://img.shields.io/badge/Ollama-local-orange) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

This project is a full-stack AI chat application built around a custom fine-tuned language model focused on Explainable AI (XAI) and cybersecurity. The model, called **orion-xai**, is based on Llama 3.2 3B Instruct and was fine-tuned using LoRA on a dataset of around 2,918 instruction examples covering SHAP, LIME, Anchors, SOC workflows, and intrusion detection.

The idea came from research into AI-assisted decision support for security operations (aligned with the AI-REASON research direction). The goal is to have an AI that doesn't just give answers but explains *why* a model made a certain prediction, which is actually important in real SOC environments.

---

## What it does

- Answers XAI and cybersecurity questions using a locally running fine-tuned model
- Supports SHAP, LIME, and Anchors explanations with context-aware responses
- Uses RAG (Retrieval-Augmented Generation) to ground answers in relevant documents
- Has a full authentication system with conversation history saved per user
- Supports multiple AI providers (Groq, OpenAI, Anthropic, Gemini, Ollama) with automatic fallback
- Includes an admin dashboard to manage users and conversations
- Organises chats into workspaces and projects

---

## Research context

This project is built in the context of XAI for security operations. The fine-tuned model specifically covers three core explainability methods used in cybersecurity ML systems:

- **SHAP** (Shapley Additive Explanations) - game-theory-based feature attribution
- **LIME** (Local Interpretable Model-agnostic Explanations) - local linear surrogate
- **Anchors** - rule-based if-then explanations introduced by Ribeiro et al. (2018)

The dataset used to fine-tune the model was built from scratch, based on primary XAI literature including Ribeiro et al. (2016, 2018), Lundberg & Lee (2017), and Molnar (2022).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express, Prisma, PostgreSQL |
| AI Service | Python, FastAPI, ChromaDB, sentence-transformers |
| Model | Llama 3.2 3B fine-tuned with LoRA (PEFT), served via Ollama |
| Auth | JWT (access token 15min + refresh token 30 days) |

---

## Project structure

```
explainable-ai/
├── index.html                  # Main chat interface
├── admin.html                  # Admin dashboard
├── landing.html                # Landing page
├── script.js                   # Frontend logic
├── styles.css
├── Modelfile                   # Ollama model config (few-shot + parameters)
├── orion_xai_final_dataset.jsonl   # Fine-tuning dataset (2,918 examples)
├── train_orion_xai.py          # LoRA training script
├── orion_xai_training.ipynb    # Training notebook (local)
├── orion_xai_kaggle_train.ipynb    # Training notebook (Kaggle GPU)
├── merge_adapter.py            # Merge LoRA adapter into base model
├── merge_and_convert.py        # Merge + convert to GGUF for Ollama
│
├── backend/                    # Node.js Express API
│   ├── src/
│   │   ├── server.js
│   │   ├── app.js
│   │   ├── routes/             # auth, messages, conversations, admin, ai, workspaces, projects
│   │   ├── middleware/         # JWT verification
│   │   └── lib/
│   ├── prisma/
│   │   └── schema.prisma
│   └── .env.example
│
└── ai-service/                 # Python FastAPI service
    ├── main.py
    ├── config.py
    ├── requirements.txt
    ├── start.bat
    ├── services/               # llm, rag, embedding, safety, roadmap
    ├── models/
    ├── prompts/
    └── .env.example
```

---

## How to run

You need three things running at the same time: the backend, the frontend, and the AI service. Plus the Ollama model loaded separately.

### 1. Load the model (Ollama)

Make sure [Ollama](https://ollama.ai) is installed. Then from the project root:

```bash
ollama create orion-xai -f Modelfile
```

To test it:

```bash
ollama run orion-xai "What is SHAP?"
```

### 2. Backend (Node.js)

```bash
cd backend
cp .env.example .env
# Fill in your DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET in .env

npm install
npm run db:migrate
npm start
```

Backend runs at `http://localhost:3001`. You can test with:

```bash
curl http://localhost:3001/health
```

### 3. AI Service (Python FastAPI)

```bash
cd ai-service
cp .env.example .env
# Add your provider keys (Groq, OpenAI, etc.)

start.bat   # Windows - creates venv, installs deps, starts FastAPI
```

Service runs at `http://localhost:8000`.

### 4. Frontend

Open `index.html` using VS Code Live Server on port 5500. Or just open it directly in a browser.

Then click **"Sign in to sync chats"** to create an account and start chatting.

---

## Environment variables

Both `.env.example` files are included in the repo. Copy and fill them in.

**backend/.env:**
```
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/orionai"
JWT_SECRET="long-random-string"
JWT_REFRESH_SECRET="another-long-random-string"
PORT=3001
FRONTEND_URL=http://127.0.0.1:5500
ADMIN_EMAILS=you@example.com
```

**ai-service/.env:**
```
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_PROVIDER=groq
EMBEDDING_PROVIDER=local
AI_SERVICE_PORT=8000
```

You don't need all provider keys. Just fill in at least one.

---

## The fine-tuned model

The `orion-xai` model was trained using LoRA (r=16, alpha=32) on top of `meta-llama/Llama-3.2-3B-Instruct`. Training was done on Kaggle (T4 GPU) using the Unsloth library for faster fine-tuning.

The training dataset (`orion_xai_final_dataset.jsonl`) has 2,918 examples in Alpaca-style JSONL format:

```json
{
  "instruction": "What is SHAP and how does it work?",
  "input": "",
  "output": "SHAP stands for SHapley Additive exPlanations..."
}
```

Topics covered: SHAP, LIME, Anchors, TreeSHAP, IDS/IPS, SOC triage, incident response, MITRE ATT&CK, anomaly detection, and more.

The dataset was synthetically generated based on primary XAI literature:
- Ribeiro et al. (2016) - "Why Should I Trust You?" (LIME)
- Lundberg & Lee (2017) - "A Unified Approach to Interpreting Model Predictions" (SHAP)
- Ribeiro et al. (2018) - "Anchors: High-Precision Model-Agnostic Explanations"
- Molnar (2022) - Interpretable Machine Learning

---

## Admin dashboard

To enable admin access, add your email to `ADMIN_EMAILS` in `backend/.env`. After signing in with that email, the **Admin Dashboard** link appears in the sidebar. Or go directly to `admin.html`.

---

## Useful backend commands

```bash
npm run dev          # Start with auto-reload (nodemon)
npm start            # Start without auto-reload
npm run db:migrate   # Apply new migrations
npm run db:studio    # Open Prisma Studio (visual DB browser)
npm run db:reset     # Wipes all data and re-migrates (careful)
```

---

## Notes

- The `.gguf` model file and LoRA adapter weights are not included in the repo (too large for GitHub). You need to train and convert it yourself using the provided notebooks.
- The `orion_xai_training.ipynb` notebook handles local training. `orion_xai_kaggle_train.ipynb` is for Kaggle with GPU.
- After training, use `merge_and_convert.py` to merge the LoRA adapter and convert to GGUF format for Ollama.
- ChromaDB vector store is auto-created when the AI service starts for the first time.

