---
title: Orion-XAI
emoji: 🛡️
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 6.30.0
app_file: app.py
pinned: false
license: mit
short_description: Fine-tuned Llama 3.2 3B that explains security ML decisions
models:
  - SnowyIbrahim/orion-xai-adapter
  - unsloth/Llama-3.2-3B-Instruct
---

# Orion-XAI

Chat with **Orion-XAI**: Llama 3.2 3B fine-tuned with QLoRA to explain security ML decisions
(SHAP, LIME, Anchors, SOC triage, MITRE ATT&CK). Switch to the base model to compare answers side by side.

- Runs the LoRA adapter [SnowyIbrahim/orion-xai-adapter](https://huggingface.co/SnowyIbrahim/orion-xai-adapter) on a free ZeroGPU.
- Training data is synthetic; see the evaluation in the GitHub repo before trusting answers.

Source, data and evaluation: https://github.com/mohamedibrahim26/explainable-ai
