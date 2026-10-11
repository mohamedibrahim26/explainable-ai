# Explainable AI — Orion-XAI

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Python](https://img.shields.io/badge/Python-3.10+-blue) ![Ollama](https://img.shields.io/badge/Ollama-local-orange) ![SQLite](https://img.shields.io/badge/SQLite-3-blue) ![HuggingFace](https://img.shields.io/badge/HuggingFace-SnowyIbrahim%2Forion--xai--adapter-yellow) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

This project is a full-stack AI chat application built around a custom fine-tuned language model focused on Explainable AI (XAI) and cybersecurity. The model, **orion-xai**, is based on Llama 3.2 3B Instruct and was fine-tuned using QLoRA (4-bit NF4) on **4,169 unique synthetic instruction examples** covering SHAP, LIME, Anchors, SOC workflows, MITRE ATT&CK, incident response, trustworthy AI, and LLM reasoning chains.

This work is part of the **AI-REASON** project (AI-assisted Reliable and Explainable Analysis for Security OperatioNs) at Jönköping University. The goal is an AI that doesn't just give answers but explains *why* a model made a certain prediction — which is essential in real SOC environments.

The trained LoRA adapter is publicly available on HuggingFace:
**[SnowyIbrahim/orion-xai-adapter](https://huggingface.co/SnowyIbrahim/orion-xai-adapter)**

### 🚀 Live Demo

**[huggingface.co/spaces/SnowyIbrahim/orion-xai](https://huggingface.co/spaces/SnowyIbrahim/orion-xai)**

Chat with the **fine-tuned model itself** on a free Hugging Face GPU, and switch to the base Llama 3.2 3B to compare answers. The demo covers the model only; the full app (RAG, auth, admin dashboard) runs locally. Each visitor gets a small free GPU quota per day. Details: [`docs/DEPLOY_HF_SPACE.md`](docs/DEPLOY_HF_SPACE.md).

---

## What it does

- Answers XAI and cybersecurity questions using a locally running fine-tuned model
- Supports SHAP, LIME, Anchors, and Counterfactual explanations with context-aware responses
- Uses RAG (Retrieval-Augmented Generation) to ground answers in relevant documents
- Has a full authentication system with conversation history saved per user
- Supports multiple AI providers (Groq, OpenAI, Anthropic, Gemini, Ollama) with automatic fallback
- Includes an admin dashboard to manage users and conversations
- Organises chats into workspaces and projects

---

## Research context

This project is built in the context of the **AI-REASON** research project at Jönköping University, focusing on XAI for security operations. The fine-tuned model covers explainability methods, security decision reasoning, and trustworthy AI principles used in real SOC environments.

Core XAI methods covered:
- **SHAP** (Shapley Additive Explanations) — game-theory-based feature attribution
- **LIME** (Local Interpretable Model-agnostic Explanations) — local linear surrogate
- **Anchors** — rule-based if-then explanations (Ribeiro et al., 2018)
- **Counterfactuals** — "what would need to change?" explanations

---

## Training data (4,169 unique examples)

| File | Rows | Description |
| --- | ---: | --- |
| `orion_xai_final_dataset.jsonl` | 3,601 | Core XAI + cybersecurity set (SHAP/LIME/Anchors for IDS, EDR, UEBA), already including the SOC, incident-response and LLM-reasoning sets |
| `ml_security_code_dataset.jsonl` | 300 | Python ML/security code examples with XAI |
| `trustworthy_ai_dataset.jsonl` | 150 | Trustworthy AI, EU AI Act, GDPR, AI governance |
| `xai_llm_reasoning_chains_dataset.jsonl` | 100 | XAI evidence → LLM reasoning chain → security decision |
| `mitre_threat_intel_combined.jsonl` | 18 | MITRE ATT&CK techniques + threat intelligence |

The data is **synthetic** (generated for this project, not real SOC logs). The original training run loaded all files including some that are already inside the final set, so it saw 4,870 rows with ~700 duplicates. Full breakdown in [`data/README.md`](data/README.md).

All files are Alpaca-style JSONL:

```json
{
  "instruction": "Explain the SHAP waterfall plot output for this network intrusion prediction.",
  "input": "",
  "output": "## XAI Evidence\n...\n## LLM Reasoning Chain\n...\n## Security Decision\n..."
}
```

---

## Model training

**Base model:** `unsloth/Llama-3.2-3B-Instruct`
**Method:** QLoRA (4-bit NF4) via Unsloth
**Hardware:** Kaggle T4 GPU (16 GB VRAM)
**LoRA config:** r=16, alpha=32, dropout=0.05, target modules: q/k/v/o/gate/up/down projections
**Training:** 3 epochs, batch size 2, gradient accumulation 8, learning rate 2e-4 (cosine), AdamW 8-bit

**Evaluation:** an evaluation against the base Llama 3.2 3B model is set up in [`eval/`](eval/README.md) (40 held-out multiple-choice questions, 25 open-ended prompts, blind LLM judge). Results will be added here once it has been run. Training loss fell from about 5.0 to 1.2.

The adapter (~97 MB) is available at:
**[huggingface.co/SnowyIbrahim/orion-xai-adapter](https://huggingface.co/SnowyIbrahim/orion-xai-adapter)**

To download locally:
```bash
pip install huggingface_hub
huggingface-cli download SnowyIbrahim/orion-xai-adapter --local-dir ./orion-xai-adapter
```

After downloading, merge and convert to GGUF for Ollama:
```bash
python scripts/merge_and_convert.py
ollama create orion-xai -f Modelfile
ollama run orion-xai "Explain SHAP values for IDS detection"
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express, Prisma, SQLite |
| AI Service | Python, FastAPI, ChromaDB, sentence-transformers |
| Model | Llama 3.2 3B fine-tuned with QLoRA, served via Ollama |
| Fine-tuning | Unsloth + TRL SFTTrainer on Kaggle T4 GPU |
| Adapter hosting | HuggingFace Hub |
| Auth | JWT (access token 15min + refresh token 30 days) |

---

## Project structure

```
explainable-ai/
├── README.md
├── Modelfile                     # Ollama model config
│
├── backend/                      # Node.js Express API (also serves the frontend)
│   ├── public/                   # Frontend: index, landing, career, admin pages + script.js, styles.css
│   ├── src/
│   │   ├── server.js / app.js
│   │   ├── routes/               # auth, messages, conversations, admin, ai, workspaces, projects
│   │   ├── middleware/
│   │   └── lib/
│   ├── prisma/
│   └── .env.example
│
├── ai-service/                   # Python FastAPI service
│   ├── main.py
│   ├── services/                 # llm, rag, embedding, safety
│   └── requirements.txt
│
├── data/                         # Training datasets (JSONL) + data/README.md
├── notebooks/                    # Kaggle T4 training notebook (main) + local notebook
├── scripts/                      # train, merge adapter, convert to GGUF, dataset generator
└── docs/                         # Kaggle setup guide, screenshots
```

---

## How to run

### 1. Get the model

Download the adapter from HuggingFace and merge it:
```bash
huggingface-cli download SnowyIbrahim/orion-xai-adapter --local-dir ./orion-xai-adapter
python scripts/merge_and_convert.py
ollama create orion-xai -f Modelfile
```

### 2. Backend (Node.js)

```bash
cd backend
cp .env.example .env
# Fill in JWT_SECRET, JWT_REFRESH_SECRET (DATABASE_URL is already set to SQLite)

npm install
npm run db:migrate
npm start
```

Backend runs at `http://localhost:3001` and also serves the frontend directly.

### 3. AI Service (Python FastAPI)

```bash
cd ai-service
cp .env.example .env
# Add at least one provider key (Groq, OpenAI, etc.)

start.bat   # Windows — creates venv, installs deps, starts FastAPI
```

Service runs at `http://localhost:8000`.

### 4. Frontend

Open **<http://localhost:3001>**. The backend serves everything in `backend/public/`, which is the only copy of the frontend. Edit files there.

---

## Environment variables

**backend/.env:**
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="long-random-string"
JWT_REFRESH_SECRET="another-long-random-string"
PORT=3001
FRONTEND_URL=http://localhost:3001
ADMIN_EMAILS=you@example.com
```


**ai-service/.env:**
```
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_PROVIDER=groq
AI_SERVICE_PORT=8000
```

---

## References

- Ribeiro et al. (2016) — "Why Should I Trust You?" (LIME)
- Lundberg & Lee (2017) — "A Unified Approach to Interpreting Model Predictions" (SHAP)
- Ribeiro et al. (2018) — "Anchors: High-Precision Model-Agnostic Explanations"
- Molnar (2022) — Interpretable Machine Learning
- MITRE ATT&CK Framework — https://attack.mitre.org

---

## Notes

- The `.gguf` model file is not included (too large for GitHub). Download the adapter from HuggingFace and convert locally using `scripts/merge_and_convert.py`.
- The Kaggle training notebook (`notebooks/orion_xai_kaggle_train.ipynb`) includes all fixes for Unsloth + TRL 0.24.0 compatibility.
- ChromaDB vector store is auto-created when the AI service starts for the first time.
- All `.env` files and `.gguf` files are in `.gitignore`.
- Locally, the fine-tuned model runs through Ollama (see *How to run*). The hosted demo runs it with transformers + PEFT on ZeroGPU.
