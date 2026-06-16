#!/usr/bin/env python3
"""
train_orion_xai.py
QLoRA fine-tuning of Llama 3.2 3B on the XAI/Cybersecurity dataset.
Usage:
    pip install torch transformers peft trl bitsandbytes accelerate datasets
    python train_orion_xai.py
"""

import os
import json
import torch
from datasets import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training
from trl import SFTTrainer

# ─────────────────────────────────────────────────────────
# CONFIG  — adjust paths / hyperparams here
# ─────────────────────────────────────────────────────────
BASE_MODEL    = "meta-llama/Llama-3.2-3B"   # or local path to model weights
DATASET_PATH  = "xai_cybersec_dataset.jsonl" # relative to this script
OUTPUT_DIR    = "./orion-xai-adapter"        # LoRA adapter saved here
MERGED_DIR    = "./orion-xai-merged"         # optional: merged model for GGUF export

# LoRA
LORA_R        = 16
LORA_ALPHA    = 32
LORA_DROPOUT  = 0.05
TARGET_MODS   = ["q_proj", "v_proj", "k_proj", "o_proj"]

# Training
EPOCHS        = 3
BATCH_SIZE    = 2
GRAD_ACCUM    = 4         # effective batch = BATCH_SIZE * GRAD_ACCUM = 8
LR            = 2e-4
MAX_SEQ_LEN   = 2048
WARMUP_RATIO  = 0.03
VAL_SPLIT     = 0.1       # 10% held out for validation

# ─────────────────────────────────────────────────────────
# ALPACA PROMPT TEMPLATE
# ─────────────────────────────────────────────────────────
PROMPT_WITH_INPUT = (
    "Below is an instruction that describes a task, paired with an input "
    "that provides further context. Write a response that appropriately "
    "completes the request.\n\n"
    "### Instruction:\n{instruction}\n\n"
    "### Input:\n{input}\n\n"
    "### Response:\n{output}"
)

PROMPT_NO_INPUT = (
    "Below is an instruction that describes a task. Write a response that "
    "appropriately completes the request.\n\n"
    "### Instruction:\n{instruction}\n\n"
    "### Response:\n{output}"
)

def format_example(example):
    if example.get("input", "").strip():
        return PROMPT_WITH_INPUT.format(**example)
    return PROMPT_NO_INPUT.format(**example)


# ─────────────────────────────────────────────────────────
# LOAD DATASET
# ─────────────────────────────────────────────────────────
def load_dataset_from_jsonl(path):
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"Loaded {len(records)} training examples from {path}")
    return records


# ─────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Orion-XAI  |  QLoRA Fine-Tuning")
    print("=" * 60)

    # 1. Load raw data
    records = load_dataset_from_jsonl(DATASET_PATH)
    formatted = [{"text": format_example(r)} for r in records]

    # Train / val split
    split_idx   = int(len(formatted) * (1 - VAL_SPLIT))
    train_data  = formatted[:split_idx]
    val_data    = formatted[split_idx:]
    train_ds    = Dataset.from_list(train_data)
    val_ds      = Dataset.from_list(val_data)
    print(f"Train: {len(train_ds)} | Val: {len(val_ds)}")

    # 2. Quantization config (4-bit NF4)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit              = True,
        bnb_4bit_compute_dtype    = torch.bfloat16,
        bnb_4bit_quant_type       = "nf4",
        bnb_4bit_use_double_quant = True,
    )

    # 3. Load tokenizer
    print(f"\nLoading tokenizer from {BASE_MODEL} ...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tokenizer.pad_token    = tokenizer.eos_token
    tokenizer.padding_side = "right"   # required for causal LM training

    # 4. Load base model in 4-bit
    print(f"Loading model from {BASE_MODEL} (4-bit QLoRA) ...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config = bnb_config,
        device_map          = "auto",
        trust_remote_code   = True,
    )
    model.config.use_cache = False           # disable KV-cache during training
    model.config.pretraining_tp = 1          # tensor parallelism = 1 for single GPU

    # 5. Prepare for k-bit training (cast norms to fp32, enable grads)
    model = prepare_model_for_kbit_training(model)
    model.enable_input_require_grads()       # needed with gradient checkpointing

    # 6. LoRA config
    lora_config = LoraConfig(
        r             = LORA_R,
        lora_alpha    = LORA_ALPHA,
        target_modules= TARGET_MODS,
        lora_dropout  = LORA_DROPOUT,
        bias          = "none",
        task_type     = TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # 7. Training arguments
    training_args = TrainingArguments(
        output_dir                  = OUTPUT_DIR,
        num_train_epochs            = EPOCHS,
        per_device_train_batch_size = BATCH_SIZE,
        per_device_eval_batch_size  = BATCH_SIZE,
        gradient_accumulation_steps = GRAD_ACCUM,
        gradient_checkpointing      = True,
        optim                       = "paged_adamw_32bit",
        learning_rate               = LR,
        weight_decay                = 0.001,
        lr_scheduler_type           = "cosine",
        warmup_ratio                = WARMUP_RATIO,
        evaluation_strategy         = "epoch",
        save_strategy               = "epoch",
        load_best_model_at_end      = True,
        metric_for_best_model       = "eval_loss",
        logging_steps               = 10,
        fp16                        = not torch.cuda.is_bf16_supported(),
        bf16                        = torch.cuda.is_bf16_supported(),
        report_to                   = "none",  # set to "wandb" if you want tracking
        dataloader_pin_memory       = False,
    )

    # 8. Trainer
    trainer = SFTTrainer(
        model           = model,
        train_dataset   = train_ds,
        eval_dataset    = val_ds,
        tokenizer       = tokenizer,
        args            = training_args,
        dataset_text_field = "text",
        max_seq_length  = MAX_SEQ_LEN,
        packing         = True,   # pack short sequences together for efficiency
    )

    # 9. Train
    print("\nStarting training ...")
    trainer.train()

    # 10. Save adapter
    print(f"\nSaving LoRA adapter to {OUTPUT_DIR} ...")
    trainer.model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print("Adapter saved.")

    # 11. Optional: merge and save full model (needed for GGUF/Ollama export)
    merge = input("\nMerge LoRA into base model for GGUF export? [y/N]: ").strip().lower()
    if merge == "y":
        print(f"Merging and saving to {MERGED_DIR} ...")
        from peft import PeftModel
        # Reload base in 16-bit for merging (quantized weights can't be merged)
        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            torch_dtype   = torch.bfloat16,
            device_map    = "cpu",
        )
        merged = PeftModel.from_pretrained(base, OUTPUT_DIR)
        merged = merged.merge_and_unload()
        merged.save_pretrained(MERGED_DIR)
        tokenizer.save_pretrained(MERGED_DIR)
        print(f"Merged model saved to {MERGED_DIR}")
        print("\nNext step: convert to GGUF with llama.cpp:")
        print(f"  python llama.cpp/convert.py {MERGED_DIR} --outtype q4_k_m --outfile orion-xai.gguf")

    print("\nDone! Fine-tuning complete.")
    print(f"Adapter:       {OUTPUT_DIR}/")
    print(f"To use with Ollama, see: Modelfile")


if __name__ == "__main__":
    main()
