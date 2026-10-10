import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE_MODEL  = "unsloth/Llama-3.2-3B-Instruct"
ADAPTER_DIR = r"C:\Users\AMEEN\orion-xai-adapter"
MERGED_DIR  = r"C:\Users\AMEEN\orion-xai-merged"

print("Loading base model (downloads ~6 GB first time)...")
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16,
    device_map="cpu",
)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

print("Loading adapter...")
model = PeftModel.from_pretrained(model, ADAPTER_DIR)

print("Merging weights...")
model = model.merge_and_unload()

print(f"Saving merged model to {MERGED_DIR} ...")
model.save_pretrained(MERGED_DIR)
tokenizer.save_pretrained(MERGED_DIR)
print("Done! Now convert to GGUF.")
