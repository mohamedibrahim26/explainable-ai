# Explainable AI — Orion-XAI

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Python](https://img.shields.io/badge/Python-3.10+-blue) ![Ollama](https://img.shields.io/badge/Ollama-local-orange) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue) ![HuggingFace](https://img.shields.io/badge/HuggingFace-SnowyIbrahim%2Forion--xai--adapter-yellow) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

This project is a full-stack AI chat application built around a custom fine-tuned language model focused on Explainable AI (XAI) and cybersecurity. The model, **orion-xai**, is based on Llama 3.2 3B Instruct and was fine-tuned using QLoRA (4-bit NF4) on a dataset of **4,870 instruction examples** across 9 specialised datasets covering SHAP, LIME, Anchors, SOC workflows, MITRE ATT&CK, incident response, trustworthy AI, and LLM reasoning chains.

This work is part of the **AI-REASON** project (AI-assisted Reliable and Explainable Analysis for Security OperatioNs) at Jönköping University. The goal is an AI that doesn't just give answers but explains *why* a model made a certain prediction — which is essential in real SOC environments.

The trained LoRA adapter is publicly available on HuggingFace:
**[SnowyIbrahim/orion-xai-adapter](https://huggingface.co/SnowyIbrahim/orion-xai-adapter)**

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

## Training datasets (4,870 examples across 9 files)

| File | Description | Examples |
|---|---|---|
| `xai_cybersec_1000.jsonl` | Core XAI + cybersecurity (SHAP/LIME/Anchors for IDS, EDR, UEBA) | ~1,000 |
| `soc_workflows_dataset.jsonl` | SOC alert triage workflows and escalation decisions | ~300 |
| `incident_response_dataset.jsonl` | PICERL incident response phases with XAI explanations | ~200 |
| `llm_reasoning_security_dataset.jsonl` | LLM reasoning chains for security decisions | ~200 |
| `mitre_threat_intel_combined.jsonl` | MITRE ATT&CK techniques + threat intelligence | ~200 |
| `trustworthy_ai_dataset.jsonl` | Trustworthy/reliable AI, EU AI Act, GDPR, AI governance | ~150 |
| `ml_security_code_dataset.jsonl` | Python ML/security code examples with XAI | ~300 |
| `xai_llm_reasoning_chains_dataset.jsonl` | XAI evidence + LLM reasoning chains (SHAP waterfall, LIME, Anchors, Counterfactuals) | 100 |
| `xai_cybersec_additions.jsonl` | Additional XAI cybersecurity examples | ~420 |

All datasets are in Alpaca-style JSONL format:
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

The adapter (~97 MB) is available at:
**[huggingface.co/SnowyIbrahim/orion-xai-adapter](https://huggingface.co/SnowyIbrahim/orion-xai-adapter)**

To download locally:
```bash
pip install huggingface_hub
huggingface-cli download SnowyIbrahim/orion-xai-adapter --local-dir ./orion-xai-adapter
```

After downloading, merge and convert to GGUF for Ollama:
```bash
python merge_and_convert.py
ollama create orion-xai -f Modelfile
ollama run orion-xai "Explain SHAP values for IDS detection"
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express, Prisma, PostgreSQL |
| AI Service | Python, FastAPI, ChromaDB, sentence-transformers |
| Model | Llama 3.2 3B fine-tuned with QLoRA, served via Ollama |
| Fine-tuning | Unsloth + TRL SFTTrainer on Kaggle T4 GPU |
| Adapter hosting | HuggingFace Hub |
| Auth | JWT (access token 15min + refresh token 30 days) |

---

## Project structure

```
explainable-ai/
├── index.html                          # Main chat interface
├── landing.html                        # Landing page
├── script.js                           # Frontend logic
├── styles.css
├── Modelfile                           # Ollama model config
│
├── orion_xai_kaggle_train.ipynb        # Training notebook (Kaggle T4 GPU) ← main
├── orion_xai_training.ipynb            # Training notebook (local)
├── train_orion_xai.py                  # LoRA training script
├── merge_adapter.py                    # Merge LoRA adapter into base model
├── merge_and_convert.py                # Merge + convert to GGUF for Ollama
│
├── xai_cybersec_1000.jsonl             # Dataset 1: core XAI + cybersecurity
├── soc_workflows_dataset.jsonl         # Dataset 2: SOC workflows
├── incident_response_dataset.jsonl     # Dataset 3: incident response
├── llm_reasoning_security_dataset.jsonl # Dataset 4: LLM reasoning
├── mitre_threat_intel_combined.jsonl   # Dataset 5: MITRE ATT&CK
├── trustworthy_ai_dataset.jsonl        # Dataset 6: trustworthy AI
├── ml_security_code_dataset.jsonl      # Dataset 7: ML/security code
├── xai_llm_reasoning_chains_dataset.jsonl # Dataset 8: XAI+LLM chains
├── xai_cybersec_additions.jsonl        # Dataset 9: additional examples
│
├── backend/                            # Node.js Express API
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/             # auth, messages, conversations, admin, ai, workspaces, projects
│   │   ├── middleware/
│   │   └── lib/
│   ├── prisma/
│   └── .env.example
│
└── ai-service/                         # Python FastAPI service
    ├── main.py
    ├── config.py
    ├── requirements.txt
    ├── services/               # llm, rag, embedding, safety
    └── .env.example
```

---

## How to run

### 1. Get the model

Download the adapter from HuggingFace and merge it:
```bash
huggingface-cli download SnowyIbrahim/orion-xai-adapter --local-dir ./orion-xai-adapter
python merge_and_convert.py
ollama create orion-xai -f Modelfile
```

### 2. Backend (Node.js)

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET

npm install
npm run db:migrate
npm start
```

Backend runs at `http://localhost:3001`.

### 3. AI Service (Python FastAPI)

```bash
cd ai-service
cp .env.example .env
# Add at least one provider key (Groq, OpenAI, etc.)

start.bat   # Windows — creates venv, installs deps, starts FastAPI
```

Service runs at `http://localhost:8000`.

### 4. Frontend

Open `index.html` with VS Code Live Server on port 5500.

---

## Environment variables

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

- The `.gguf` model file is not included (too large for GitHub). Download the adapter from HuggingFace and convert locally using `merge_and_convert.py`.
- The Kaggle training notebook (`orion_xai_kaggle_train.ipynb`) includes all fixes for Unsloth + TRL 0.24.0 compatibility.
- ChromaDB vector store is auto-created when the AI service starts for the first time.
- All `.env` files and `.gguf` files are in `.gitignore`.
