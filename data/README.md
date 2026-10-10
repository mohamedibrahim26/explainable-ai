# Training data

All files are Alpaca-style JSONL (`instruction`, `input`, `output`).

## How the data was made

The examples are **synthetic**: they were generated for this project, not
collected from real SOC alerts or logs. `scripts/generate_soc_dataset.py` is
the generator for the SOC workflow set. Content is based on the XAI
literature (SHAP, LIME, Anchors, counterfactuals) and public frameworks such
as MITRE ATT&CK and the PICERL incident-response phases. The data has not
been reviewed by independent security analysts.

## Files

| File | Rows | Contents |
| --- | ---: | --- |
| `orion_xai_final_dataset.jsonl` | 3,601 | Core XAI + cybersecurity set. **Already includes** the SOC, incident-response and LLM-reasoning files below. |
| `soc_workflows_dataset.jsonl` | 283 | SOC alert triage and escalation (also inside the final file) |
| `incident_response_dataset.jsonl` | 200 | PICERL incident response with XAI explanations (also inside the final file) |
| `llm_reasoning_security_dataset.jsonl` | 200 | LLM reasoning chains for security decisions (also inside the final file) |
| `ml_security_code_dataset.jsonl` | 300 | Python ML/security code examples with XAI |
| `trustworthy_ai_dataset.jsonl` | 150 | Trustworthy AI, EU AI Act, GDPR, governance |
| `xai_llm_reasoning_chains_dataset.jsonl` | 100 | XAI evidence → LLM reasoning → security decision |
| `mitre_threat_intel_combined.jsonl` | 18 | MITRE ATT&CK techniques and threat intel |

## Honest counts

- **Unique examples: 4,169** (3,601 + 300 + 150 + 100 + 18).
- The original Kaggle training run loaded every `.jsonl` file, so it saw
  **4,870 rows**: the 683 SOC / incident-response / LLM-reasoning rows twice,
  plus an identical copy of the MITRE file (since removed).
- Across all rows there are 4,155 unique instructions.

To train without duplicates, use `orion_xai_final_dataset.jsonl` plus the four
files that are **not** marked "also inside the final file".
