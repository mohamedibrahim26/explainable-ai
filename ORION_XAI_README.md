# Orion-XAI — Setup & Usage Guide

Fine-tuned Llama 3.2 3B specialized in Explainable AI (XAI) and Cybersecurity.

---

## Pipeline Status

| Step | Status | Notes |
|------|--------|-------|
| Dataset (1000-example XAI/cybersec) | ✅ Complete | `xai_cybersec_1000.jsonl` |
| QLoRA fine-tuning on Kaggle T4 | ✅ Complete | 20 min, loss 5.0 → 1.2 |
| Merge LoRA adapter into base model | ✅ Complete | `merge_adapter.py` |
| GGUF conversion (F16) | ✅ Complete | llama.cpp `convert_hf_to_gguf.py` |
| Q4_K_M quantization | ✅ Complete | 6.1 GB → 1.9 GB (3× smaller) |
| Ollama serving with Alpaca template | ✅ Complete | `Modelfile` |
| Chatbot UI end-to-end | ✅ Complete | AIChatClone frontend |

---

## Quick Start (model already trained)

If you have `orion-xai-q4km.gguf` and the `Modelfile`:

```bash
# Register the model with Ollama
ollama create orion-xai -f Modelfile

# Chat in terminal
ollama run orion-xai

# REST API
curl http://localhost:11434/api/generate -d '{
  "model": "orion-xai",
  "prompt": "Explain SHAP values in intrusion detection",
  "stream": false
}'
```

Then open AIChatClone in your browser and set the Ollama model to `orion-xai` in the Settings panel.

---

## Full Retraining Pipeline

### Step 1 — Dataset

The training dataset is `xai_cybersec_1000.jsonl` — 1000 Alpaca-format examples.
Alpaca format (one JSON object per line):

```json
{"instruction": "Explain SHAP values", "input": "", "output": "SHAP (SHapley Additive exPlanations)..."}
```

A second dataset `xai_cybersec_additions.jsonl` is being built (~500+ more examples covering
LLM reasoning for security, XAI for LLMs, incident response, and ML model reliability).
When complete, both files will be combined into a ~3000-example final dataset for a second
training run.

---

### Step 2 — Fine-tune on Kaggle

Upload `orion_xai_kaggle_train.ipynb` and `xai_cybersec_1000.jsonl` to a Kaggle notebook.
Enable GPU: **T4 x2** (free tier, ~20 GPU hours/week).

The notebook will:
1. Install Unsloth + TRL
2. Load Llama 3.2 3B in 4-bit (QLoRA)
3. Apply LoRA adapters (rank=16, alpha=32)
4. Train for 3 epochs (~20 minutes on T4)
5. Save the adapter to `/kaggle/working/orion-xai-adapter/`
6. Download the adapter as a zip

Expected final training loss: **~1.2** (starting from ~5.0).

---

### Step 3 — Merge adapter into base model

```bash
pip install torch transformers peft accelerate

python merge_adapter.py
```

`merge_adapter.py` loads `unsloth/Llama-3.2-3B-Instruct`, applies the downloaded adapter,
merges the weights, and saves the full model to `C:\Users\AMEEN\orion-xai-merged\`.

---

### Step 4 — Convert to GGUF (F16)

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
pip install -r requirements.txt

python convert_hf_to_gguf.py C:\Users\AMEEN\orion-xai-merged \
    --outtype f16 \
    --outfile C:\Users\AMEEN\orion-xai-f16.gguf
```

This produces a ~6.1 GB F16 GGUF file.

---

### Step 5 — Quantize to Q4_K_M

```bash
# Build llama.cpp (Windows: use prebuilt binaries from llama.cpp releases)
llama-quantize.exe C:\Users\AMEEN\orion-xai-f16.gguf ^
                   C:\Users\AMEEN\orion-xai-q4km.gguf ^
                   Q4_K_M
```

Q4_K_M reduces the model from **6.1 GB → 1.9 GB** with negligible quality loss.
Response speed is noticeably faster than F16.

---

### Step 6 — Deploy with Ollama

```bash
# orion-xai-q4km.gguf must be at the path specified in the Modelfile FROM line
ollama create orion-xai -f Modelfile

# Test
ollama run orion-xai "What is LIME and how is it used in cybersecurity?"
```

---

## Dataset

`xai_cybersec_1000.jsonl` — 1000 Alpaca-format examples covering:

| Category | Count |
|----------|-------|
| XAI fundamentals (SHAP, LIME, Grad-CAM, Integrated Gradients) | ~120 |
| XAI in cybersecurity (IDS, malware, phishing, threat hunting) | ~180 |
| SOC operations & alert triage | ~200 |
| LLM reasoning for security | ~150 |
| Incident response & forensics | ~100 |
| Adversarial ML & model robustness | ~80 |
| Compliance & AI governance (EU AI Act, GDPR) | ~70 |
| Model training (LoRA, QLoRA, fine-tuning) | ~60 |
| Uncertainty, hallucination & calibration | ~40 |

---

## Key Hyperparameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Base model | Llama 3.2 3B Instruct | `unsloth/Llama-3.2-3B-Instruct` |
| LoRA rank (r) | 16 | Increase to 32 for more capacity |
| LoRA alpha | 32 | Scaling = alpha/r = 2 |
| Epochs | 3 | |
| Batch size | 2 | Effective = 2 × 4 grad_accum = 8 |
| Learning rate | 2e-4 | Standard for LoRA |
| Max seq length | 2048 | |
| Quantization | Q4_K_M | Best quality/size tradeoff |
| Final model size | 1.9 GB | Down from 6.1 GB F16 |

---

## Files

| File | Purpose |
|------|---------|
| `xai_cybersec_1000.jsonl` | Training dataset (1000 examples) |
| `xai_cybersec_additions.jsonl` | Expansion dataset (in progress) |
| `orion_xai_kaggle_train.ipynb` | Kaggle training notebook |
| `train_orion_xai.py` | Local training script (alternative to Kaggle) |
| `merge_adapter.py` | Merges LoRA adapter into base model |
| `Modelfile` | Ollama model configuration (Alpaca template) |
| `KAGGLE_SETUP_GUIDE.md` | Step-by-step Kaggle training guide |

Pipeline artifacts (stored locally outside this repo):

| Artifact | Location | Size |
|----------|----------|------|
| `orion-xai-adapter/` | `C:\Users\AMEEN\` | ~60 MB |
| `orion-xai-merged/` | `C:\Users\AMEEN\` | ~6 GB |
| `orion-xai-f16.gguf` | `C:\Users\AMEEN\` | 6.1 GB |
| `orion-xai-q4km.gguf` | `C:\Users\AMEEN\` | 1.9 GB |

---

## Known Limitations

Small fine-tuned models (3B parameters) can hallucinate specific factual details — author
names, paper citations, version numbers — even when the general explanation is correct.

**Example:** The model may misattribute the authorship of SHAP. SHAP was created by
**Scott Lundberg and Su-In Lee**, not the names the model may produce.

The UI includes a disclaimer: *"Orion can make mistakes. Verify important information."*
The XAI panel also shows a **hallucination risk score (1–5)** alongside each response.

For high-stakes use (research, audit), cross-check specific factual claims against
primary sources.

---

## Troubleshooting

**OOM during training:**
- Reduce `BATCH_SIZE` to 1
- Reduce `MAX_SEQ_LEN` to 1024
- Set `PACKING = False`

**`bitsandbytes` CUDA error:**
- Ensure CUDA toolkit matches PyTorch version
- On Kaggle: re-run the pip install cell

**Ollama: model not found:**
- Verify the `FROM` path in `Modelfile` matches the actual location of `orion-xai-q4km.gguf`
- Re-run `ollama create orion-xai -f Modelfile` after any path change

**Responses end abruptly:**
- Increase `num_predict` in `Modelfile` (currently 600)
- Verify stop tokens are not triggering mid-response

---

*Orion-XAI — PhD Research Project — AI-REASON: AI-assisted Reliable and Explainable Analysis for Security Operations*
