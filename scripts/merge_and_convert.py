"""
Orion-XAI: Merge LoRA adapter + convert to GGUF for Ollama

Steps:
  1. Merge LoRA adapter with base Llama-3.2-3B-Instruct
  2. Save merged model to disk
  3. Clone llama.cpp and convert to GGUF (Q4_K_M quantization)
  4. Print Ollama Modelfile instructions

Run from the folder containing orion-xai-lora/
"""

import os
import sys
import subprocess

HF_TOKEN = os.environ.get("HF_TOKEN", "")  # set via: set HF_TOKEN=hf_...
BASE_MODEL = "meta-llama/Llama-3.2-3B-Instruct"
ADAPTER_PATH = "./orion-xai-lora/orion-xai-lora"   # adjust if needed
MERGED_PATH  = "./orion-xai-merged"
GGUF_PATH    = "./orion-xai.gguf"

os.environ["HF_TOKEN"] = HF_TOKEN
os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN

# ── Step 0: install dependencies ────────────────────────────────────────────
print("Installing dependencies...")
subprocess.run([
    sys.executable, "-m", "pip", "install", "-q",
    "transformers==4.45.0", "peft==0.11.1",
    "torch", "accelerate", "sentencepiece", "protobuf"
], check=True)

# ── Step 1: merge ───────────────────────────────────────────────────────────
print("\n[1/3] Loading base model + merging LoRA adapter...")

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

tokenizer = AutoTokenizer.from_pretrained(
    BASE_MODEL, token=HF_TOKEN, trust_remote_code=True)

base = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16,
    device_map="cpu",           # CPU merge — safe on any machine
    token=HF_TOKEN,
    trust_remote_code=True,
)

print("Applying LoRA adapter...")
model = PeftModel.from_pretrained(base, ADAPTER_PATH)
model = model.merge_and_unload()   # fuse weights into base

print(f"Saving merged model to {MERGED_PATH} ...")
os.makedirs(MERGED_PATH, exist_ok=True)
model.save_pretrained(MERGED_PATH, safe_serialization=True)
tokenizer.save_pretrained(MERGED_PATH)
print("Merge complete!")

del model, base
import gc; gc.collect()

# ── Step 2: clone llama.cpp ─────────────────────────────────────────────────
print("\n[2/3] Setting up llama.cpp for GGUF conversion...")

if not os.path.exists("./llama.cpp"):
    subprocess.run(
        ["git", "clone", "--depth=1", "https://github.com/ggerganov/llama.cpp"],
        check=True
    )

subprocess.run([
    sys.executable, "-m", "pip", "install", "-q", "-r",
    "./llama.cpp/requirements.txt"
], check=True)

# ── Step 3: convert to GGUF ─────────────────────────────────────────────────
print(f"\n[3/3] Converting to GGUF (Q4_K_M) → {GGUF_PATH}")

convert_script = "./llama.cpp/convert_hf_to_gguf.py"
if not os.path.exists(convert_script):
    convert_script = "./llama.cpp/convert-hf-to-gguf.py"   # older naming

subprocess.run([
    sys.executable, convert_script,
    MERGED_PATH,
    "--outfile", "./orion-xai-f16.gguf",
    "--outtype", "f16",
], check=True)

# Quantize to Q4_K_M (smaller, faster in Ollama)
subprocess.run([
    "./llama.cpp/build/bin/llama-quantize",   # needs cmake build; see note below
    "./orion-xai-f16.gguf",
    GGUF_PATH,
    "Q4_K_M",
], check=False)   # may fail if llama.cpp not compiled — skip to next step

print(f"\nGGUF ready: {GGUF_PATH}")

# ── Step 4: print Ollama instructions ───────────────────────────────────────
print("""
============================================================
  NEXT: Load into Ollama
============================================================

1. Create a file called  Modelfile  with this content:
─────────────────────────────────────────────────────
FROM ./orion-xai.gguf

SYSTEM \"\"\"You are Orion-XAI, an expert AI assistant specializing in
Explainable AI (XAI), cybersecurity, and machine learning. You provide
detailed, accurate explanations of AI models, security operations center
(SOC) analysis, SHAP/LIME feature attribution, and incident response.\"\"\"

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
─────────────────────────────────────────────────────

2. Run:
   ollama create orion-xai -f Modelfile

3. Test:
   ollama run orion-xai "Explain SHAP values for a random forest IDS model"

============================================================
""")
