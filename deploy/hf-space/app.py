"""Orion-XAI demo: Llama 3.2 3B + the orion-xai LoRA adapter, on Hugging Face ZeroGPU.

Switch between the fine-tuned model and the base model to compare answers.
Source, training data and evaluation: https://github.com/mohamedibrahim26/explainable-ai
"""
from threading import Thread

import gradio as gr
import spaces
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

BASE_MODEL = "unsloth/Llama-3.2-3B-Instruct"   # same weights the adapter was trained on
ADAPTER = "SnowyIbrahim/orion-xai-adapter"

FINETUNED = "Orion-XAI (fine-tuned)"
BASE = "Base Llama 3.2 3B (no fine-tuning)"

# The adapter was trained on this Alpaca template (notebooks/orion_xai_kaggle_train.ipynb).
ALPACA = (
    "Below is an instruction that describes a task. Write a response that "
    "appropriately completes the request.\n\n"
    "### Instruction:\n{instruction}\n\n### Input:\n{context}\n\n### Response:\n"
)

tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16)
model = PeftModel.from_pretrained(model, ADAPTER, torch_device="cpu")  # load on CPU; moved to GPU below
model.to("cuda")   # ZeroGPU attaches a real GPU only inside @spaces.GPU calls
model.eval()


def build_prompt(message, history, mode):
    if mode == BASE:
        msgs = [{"role": m["role"], "content": m["content"]} for m in history[-6:]]
        msgs.append({"role": "user", "content": message})
        return tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True), False

    # Fine-tuned model: previous turns go in the Input field as context.
    context = "\n".join(f"{m['role']}: {m['content']}" for m in history[-4:])
    return ALPACA.format(instruction=message, context=context), True


@spaces.GPU(duration=60)
def respond(message, history, mode, max_new_tokens, temperature):
    prompt, add_special = build_prompt(message, history, mode)
    inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=add_special).to("cuda")
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=int(max_new_tokens),
        do_sample=temperature > 0,
        temperature=max(float(temperature), 1e-5),
        top_p=0.9,
        repetition_penalty=1.1,
        pad_token_id=tokenizer.eos_token_id,
    )

    def run():
        with torch.no_grad():
            if mode == BASE:
                with model.disable_adapter():
                    model.generate(**kwargs)
            else:
                model.generate(**kwargs)

    Thread(target=run).start()
    text = ""
    for chunk in streamer:
        text += chunk
        if "### Instruction:" in text:          # stop if the model starts a new Alpaca turn
            text = text.split("### Instruction:")[0]
            break
        yield text.strip()
    yield text.strip()


EXAMPLES = [
    ["A random forest IDS flags a flow as a port scan. Top SHAP values: dst_port_count=+0.41, syn_flag_ratio=+0.27, avg_packet_size=-0.05. Explain this to a junior analyst and say what to check next."],
    ["When should I use Anchors instead of SHAP to explain a phishing classifier to a compliance team? Give an example rule."],
    ["Triage this alert: EDR reports rundll32.exe spawned by excel.exe connecting to an IP first seen today. Priority, reasoning, next steps."],
    ["Map to MITRE ATT&CK: malicious link, PowerShell shell, LSASS dump, then PsExec to a file server."],
]

DESCRIPTION = """
**Llama 3.2 3B fine-tuned with QLoRA on 4,169 synthetic XAI + cybersecurity examples** (SHAP, LIME, Anchors, SOC triage, MITRE ATT&CK).
Switch the model below to compare the fine-tuned answer with the base model's.

Runs on a free shared GPU with a small daily quota per visitor (about 2 minutes, or 5 if you log in to Hugging Face). The first reply after the Space wakes up can take a minute.
[Code, training data & evaluation on GitHub](https://github.com/mohamedibrahim26/explainable-ai)
"""

demo = gr.ChatInterface(
    respond,
    title="🛡️ Orion-XAI",
    description=DESCRIPTION,
    additional_inputs=[
        gr.Radio([FINETUNED, BASE], value=FINETUNED, label="Model"),
        gr.Slider(64, 1024, value=384, step=32, label="Max new tokens"),
        gr.Slider(0.0, 1.2, value=0.7, step=0.1, label="Temperature (0 = deterministic)"),
    ],
    additional_inputs_accordion=gr.Accordion("Model & settings", open=True),
    examples=EXAMPLES,
    cache_examples=False,
)

if __name__ == "__main__":
    demo.launch()
