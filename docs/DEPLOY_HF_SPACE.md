# Live demo on Hugging Face Spaces (free)

**Space:** https://huggingface.co/spaces/SnowyIbrahim/orion-xai

The demo is a Gradio chat app (`deploy/hf-space/app.py`) running on Hugging Face's free **ZeroGPU**
hardware. It loads `unsloth/Llama-3.2-3B-Instruct` with the LoRA adapter
[`SnowyIbrahim/orion-xai-adapter`](https://huggingface.co/SnowyIbrahim/orion-xai-adapter) and lets
visitors switch between the fine-tuned model and the base model to compare answers.

## Why not the full app?

On free Hugging Face accounts, Docker Spaces and CPU hardware now need a payment method, and
ZeroGPU is Gradio-only. So the Space shows the part that matters most, the fine-tuned model,
while the full stack (Node backend, RAG, auth, admin) runs locally (see *How to run* in the main README).

## Details

- Prompts use the **Alpaca** template the adapter was trained on. The base model uses its normal chat template.
- ZeroGPU attaches a GPU only while a reply is being generated (`@spaces.GPU(duration=60)`).
- Free quota: about **2 minutes of GPU per visitor per day** (5 if logged in to Hugging Face).
- The Space sleeps after inactivity and wakes on the next visit.

## Updating the Space

Edit the files in `deploy/hf-space/`, then copy them to the Space: either upload them under
**Files → Add file → Upload files** on the Space page, or with the CLI:

```bash
hf upload SnowyIbrahim/orion-xai deploy/hf-space . --repo-type=space
```
