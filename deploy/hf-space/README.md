---
title: Orion-XAI
emoji: 🛡️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Fine-tuned Llama 3.2 3B that explains security ML decisions
---

# Orion-XAI

Live demo of [Orion-XAI](https://github.com/mohamedibrahim26/explainable-ai): Llama 3.2 3B fine-tuned with QLoRA
to explain security ML decisions (SHAP, LIME, Anchors, SOC triage, MITRE ATT&CK).

- Runs the **fine-tuned model itself** (4-bit GGUF via Ollama) on free CPU hardware, so answers stream at a few words per second.
- Sign up with any email to try it. Accounts and chats reset whenever the Space restarts.
- The Space sleeps after 48 hours without visitors; the first visit after that takes a minute or two to wake it.

Source code, training data and evaluation: https://github.com/mohamedibrahim26/explainable-ai

This file and the Dockerfile are deployed automatically from GitHub. Edit them there, not here.
