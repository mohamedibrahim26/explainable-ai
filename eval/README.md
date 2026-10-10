# Evaluation

Does fine-tuning make Llama 3.2 3B better at XAI and security questions? This
folder answers that by comparing the base model with Orion-XAI (base + LoRA adapter).

## Run it

Open `notebooks/orion_xai_eval.ipynb` on Kaggle with a T4 GPU and internet on,
then run all cells. Or, on any CUDA machine from the repo root:

```bash
pip install transformers peft accelerate bitsandbytes
python eval/check_overlap.py               # confirm questions aren't in the training data
python eval/run_eval.py --out results      # multiple choice + generated answers
GROQ_API_KEY=... python eval/run_eval.py --out results --judge   # + blind LLM judge
```

## What is measured

| Test | File | How it's scored |
| --- | --- | --- |
| Multiple choice (40) | `mcq.jsonl` | Model's probability for each option letter. No answer parsing, no randomness. |
| Open-ended (25) | `open_prompts.jsonl` | Greedy answers from both models, judged blind by a larger LLM |
| Format | — | Share of answers using the trained headings (style, not quality) |

**Three setups on multiple choice:** base model in its chat format, base model in
the Alpaca format used for training, and the fine-tuned model. Comparing the
last two isolates the effect of fine-tuning from the effect of the prompt format.

**Judge design:** every pair is judged twice with the answers swapped. A model
only wins if it wins both times; otherwise it is a tie. The judge is told not to
prefer longer answers.

## Honest limits

- 7 MCQs ask about MITRE technique IDs that also appear in training. They are
  flagged `seen_in_training` and reported separately.
- 40 questions is small. One question = 2.5 percentage points.
- Questions were written by the author, not an independent expert panel.
- An LLM judge is not a human SOC analyst.
