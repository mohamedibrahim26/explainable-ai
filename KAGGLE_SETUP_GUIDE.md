# Orion-XAI — Kaggle Training Setup Guide

Complete step-by-step instructions for fine-tuning Orion-XAI on Kaggle's free T4 GPU.

---

## Prerequisites

- A Kaggle account (free at kaggle.com)
- Phone number verified on Kaggle (required to unlock GPU)
- The two files from this folder:
  - `xai_cybersec_1000.jsonl` — training dataset (1000 examples)
  - `orion_xai_kaggle_train.ipynb` — training notebook

---

## Part 1 — Enable GPU on Your Kaggle Account

1. Go to **kaggle.com** → sign in
2. Click your profile icon (top-right) → **Settings**
3. Scroll to **Phone Verification** → verify your phone number
4. Once verified, you get **30 hours of free GPU per week** (T4)

---

## Part 2 — Upload the Dataset to Kaggle

1. Go to **kaggle.com/datasets**
2. Click **+ New Dataset** (top-right)
3. Name it: `orion-xai-dataset`
4. Click **Upload Files** → select `xai_cybersec_1000.jsonl`
5. Set visibility to **Private**
6. Click **Create** — wait for upload to finish (~30 seconds)

---

## Part 3 — Create the Training Notebook

1. Go to **kaggle.com/code**
2. Click **+ New Notebook**
3. In the new notebook, click **File** → **Import Notebook**
4. Upload `orion_xai_kaggle_train.ipynb`
5. The notebook will open with all cells pre-filled

---

## Part 4 — Attach the Dataset to the Notebook

1. In the notebook editor, look at the right sidebar
2. Click **+ Add Data** (under the "Input" section)
3. Search for `orion-xai-dataset` (the one you uploaded in Part 2)
4. Click **Add** — the dataset will be available at `/kaggle/input/orion-xai-dataset/`

---

## Part 5 — Enable the T4 GPU

1. In the notebook editor, look at the right sidebar
2. Find **Session options** → **Accelerator**
3. Select **GPU T4 x2** from the dropdown
4. Click **Save** to apply

> ⚠️ If you don't see the GPU option, your phone number may not be verified yet (see Part 1).

---

## Part 6 — Run the Notebook

1. Click **Run All** (the double-play button ▶▶ at the top)  
   OR press **Shift+Enter** to run cells one by one

2. **Expected run times per cell:**
   | Cell | Description | Time |
   |------|-------------|------|
   | Step 1 | Install packages | 3–5 min |
   | Step 2 | Load base model | 2–3 min |
   | Step 3 | Attach LoRA | < 1 min |
   | Step 4 | Load dataset | < 1 min |
   | Step 5 | Configure trainer | < 1 min |
   | Step 6 | **Train (3 epochs)** | **40–60 min** |
   | Step 7 | Test model | 1–2 min |
   | Step 8 | Save adapter | < 1 min |

3. Watch the training loss in Step 6 — it should decrease from ~2.0 to ~0.8 over 3 epochs. If it's not decreasing, something is wrong.

---

## Part 7 — Download the Adapter

1. When training finishes, go to the **Output** tab in the right sidebar
2. Find the folder `orion-xai-adapter/`
3. Click the **Download** button next to it
4. Save it to your computer — this is a small folder (~50 MB total)

> The adapter folder contains: `adapter_config.json`, `adapter_model.safetensors`, `tokenizer.json`, and a few other tokenizer files.

---

## Part 8 — Merge the Adapter Locally (Windows)

After downloading, run this on your Windows machine:

### 8a. Install requirements (first time only)
```bash
pip install transformers peft torch accelerate
```

### 8b. Create merge script
Save this as `merge_adapter.py` in the same folder as your adapter:

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE_MODEL  = "unsloth/Llama-3.2-3B-Instruct"   # downloads from HuggingFace
ADAPTER_DIR = "./orion-xai-adapter"              # path to downloaded adapter
MERGED_DIR  = "./orion-xai-merged"               # output path

print("Loading base model...")
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16,
    device_map="cpu",
)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

print("Loading adapter...")
model = PeftModel.from_pretrained(model, ADAPTER_DIR)

print("Merging...")
model = model.merge_and_unload()

print(f"Saving merged model to {MERGED_DIR}...")
model.save_pretrained(MERGED_DIR)
tokenizer.save_pretrained(MERGED_DIR)
print("Done!")
```

### 8c. Run the merge
```bash
python merge_adapter.py
```
This takes ~5 minutes and uses ~8 GB RAM. The merged model is saved to `orion-xai-merged/`.

---

## Part 9 — Convert to GGUF

```bash
# Clone llama.cpp (first time only)
git clone https://github.com/ggerganov/llama.cpp
pip install -r llama.cpp/requirements.txt

# Convert to F16 GGUF
python llama.cpp/convert_hf_to_gguf.py orion-xai-merged --outtype f16 --outfile C:\Users\AMEEN\orion-xai-f16.gguf
```

This replaces the existing `orion-xai-f16.gguf` with the newly fine-tuned version.

---

## Part 10 — Reload into Ollama

```bash
# Remove old model
ollama rm orion-xai

# Re-create with the new GGUF
ollama create orion-xai -f "C:\Users\AMEEN\OneDrive\Desktop\Ethical Hacking\AIChatClone\Modelfile"

# Test
ollama run orion-xai "Explain SHAP values for network intrusion detection"
```

The model should now give noticeably better, more domain-specific answers about XAI and cybersecurity.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No GPU found` | Check Accelerator is set to T4 in Session options |
| `CUDA out of memory` | Reduce `per_device_train_batch_size` from 2 to 1 in Step 5 |
| `Dataset not found` | Verify the dataset was added via **+ Add Data** (Part 4) |
| `unsloth not found` | Re-run Step 1 (install cell), then restart the kernel |
| Training loss not decreasing | Check the dataset loaded correctly (Step 4 prints sample count and example) |
| Merge fails with OOM | Run merge on a machine with 16+ GB RAM, or use Google Colab |

---

## Expected Quality Improvement

After fine-tuning, Orion-XAI should:

- Answer SHAP, LIME, Grad-CAM, and Integrated Gradients questions with specific, accurate detail
- Provide security-specific examples (IDS, malware, network anomaly detection)
- Reference MITRE ATT&CK techniques and specific detection features correctly
- Discuss GDPR Article 22, EU AI Act, and NIST AI RMF requirements accurately
- Stop cleanly at the end of each answer (no hallucinated follow-up Q&A)

---

*Dataset: 1000 examples | Base model: Llama-3.2-3B-Instruct | LoRA rank: 16 | Epochs: 3*
