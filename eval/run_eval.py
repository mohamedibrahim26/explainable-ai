"""Compare base Llama 3.2 3B Instruct with Orion-XAI (base + LoRA adapter).

Three tests:
  1. Multiple choice (eval/mcq.jsonl): objective accuracy. Each option letter is
     scored by the model's next-token probability, so no answer parsing.
  2. Open-ended answers (eval/open_prompts.jsonl): both models answer, then an
     independent LLM judge compares each pair blind, in both orders.
  3. Format check: how often answers use the trained section headings.

Usage on Kaggle (T4 GPU, internet on):
    python eval/run_eval.py --out results/
    python eval/run_eval.py --out results/ --judge   # needs GROQ_API_KEY

Run from the repo root.
"""
import argparse
import json
import os
import random
import re
import time
from pathlib import Path

BASE_MODEL = "unsloth/Llama-3.2-3B-Instruct"
ADAPTER = "SnowyIbrahim/orion-xai-adapter"

# Exactly the template used in notebooks/orion_xai_kaggle_train.ipynb
ALPACA = (
    "Below is an instruction that describes a task. Write a response that "
    "appropriately completes the request.\n\n"
    "### Instruction:\n{instruction}\n\n### Input:\n{input}\n\n### Response:\n"
)

TRAINED_HEADINGS = ["## XAI Evidence", "## LLM Reasoning Chain", "## Security Decision"]


# ── Data ──────────────────────────────────────────────────────────────────────

def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def mcq_text(item):
    opts = "\n".join(f"{k}. {v}" for k, v in item["options"].items())
    return (f"{item['question']}\n\n{opts}\n\n"
            "Reply with only the letter of the correct answer.")


# ── Prompt formats ────────────────────────────────────────────────────────────

def chat_prompt(tokenizer, text):
    return tokenizer.apply_chat_template(
        [{"role": "user", "content": text}], tokenize=False, add_generation_prompt=True)


def alpaca_prompt(text):
    return ALPACA.format(instruction=text, input="")


# The fine-tuned model was trained only on the Alpaca format. The base model is
# a chat model. Each is tested in its own format; the base model is also tested
# in Alpaca format so the effect of fine-tuning is not confused with the format.
CONFIGS = {
    "base_chat":      {"adapter": False, "format": "chat"},
    "base_alpaca":    {"adapter": False, "format": "alpaca"},
    "finetuned":      {"adapter": True,  "format": "alpaca"},
}


def build_prompt(tokenizer, text, fmt):
    return chat_prompt(tokenizer, text) if fmt == "chat" else alpaca_prompt(text)


# ── Model ─────────────────────────────────────────────────────────────────────

def load_model(base=BASE_MODEL, adapter=ADAPTER, four_bit=True):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tok = AutoTokenizer.from_pretrained(base)
    kwargs = {"device_map": "auto"}
    if four_bit and torch.cuda.is_available():
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForCausalLM.from_pretrained(base, **kwargs)
    model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    return model, tok


class adapter_state:
    """Context manager: run with the LoRA adapter on or off."""

    def __init__(self, model, enabled):
        self.model, self.enabled = model, enabled
        self._ctx = None

    def __enter__(self):
        if not self.enabled:
            self._ctx = self.model.disable_adapter()
            self._ctx.__enter__()

    def __exit__(self, *exc):
        if self._ctx is not None:
            self._ctx.__exit__(*exc)


def letter_token_ids(tok):
    """Token ids for 'A'..'D' with and without a leading space."""
    ids = {}
    for letter in "ABCD":
        cands = set()
        for variant in (letter, " " + letter):
            enc = tok.encode(variant, add_special_tokens=False)
            if len(enc) == 1:
                cands.add(enc[0])
        ids[letter] = sorted(cands)
    return ids


def score_mcq(model, tok, items, fmt, use_adapter):
    import torch

    letters = letter_token_ids(tok)
    rows = []
    with adapter_state(model, use_adapter), torch.no_grad():
        for item in items:
            prompt = build_prompt(tok, mcq_text(item), fmt)
            enc = tok(prompt, return_tensors="pt", add_special_tokens=fmt != "chat").to(model.device)
            logits = model(**enc).logits[0, -1].float()
            scores = {L: max(logits[i].item() for i in ids) for L, ids in letters.items()}
            pred = max(scores, key=scores.get)
            rows.append({"id": item["id"], "category": item["category"],
                         "seen_in_training": item.get("seen_in_training", False),
                         "pred": pred, "answer": item["answer"],
                         "correct": pred == item["answer"]})
    return rows


def generate(model, tok, prompts, fmt, use_adapter, max_new_tokens=512):
    import torch

    out = []
    with adapter_state(model, use_adapter), torch.no_grad():
        for p in prompts:
            text = build_prompt(tok, p["prompt"], fmt)
            enc = tok(text, return_tensors="pt", add_special_tokens=fmt != "chat").to(model.device)
            t0 = time.time()
            gen = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False,
                                 repetition_penalty=1.1, pad_token_id=tok.eos_token_id)
            answer = tok.decode(gen[0, enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            out.append({"id": p["id"], "category": p["category"], "prompt": p["prompt"],
                        "answer": answer, "words": len(answer.split()),
                        "seconds": round(time.time() - t0, 1)})
            print(f"  {p['id']} ({out[-1]['words']} words, {out[-1]['seconds']}s)")
    return out


# ── Judge ─────────────────────────────────────────────────────────────────────

JUDGE_PROMPT = """You are a senior SOC analyst and machine learning expert grading two answers to the same question.

Judge on: (1) technical accuracy, (2) how useful the answer is to a security practitioner, (3) clarity.
Do NOT prefer an answer because it is longer or uses more headings. Penalise factual errors heavily.

QUESTION:
{question}

ANSWER A:
{a}

ANSWER B:
{b}

Reply with JSON only: {{"winner": "A" or "B" or "tie", "reason": "<one sentence>"}}"""


def call_judge(question, a, b, model_name, api_key, retries=3):
    import requests

    for attempt in range(retries):
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model_name, "temperature": 0,
                  "response_format": {"type": "json_object"},
                  "messages": [{"role": "user", "content": JUDGE_PROMPT.format(
                      question=question, a=a[:6000], b=b[:6000])}]},
            timeout=120)
        if r.status_code == 429:
            time.sleep(10 * (attempt + 1))
            continue
        r.raise_for_status()
        verdict = json.loads(r.json()["choices"][0]["message"]["content"])
        w = str(verdict.get("winner", "tie")).strip().upper()
        return ("tie" if w not in ("A", "B") else w), verdict.get("reason", "")
    raise RuntimeError("Judge kept returning 429 (rate limit)")


def judge_pairs(base_answers, ft_answers, model_name, api_key, seed=0):
    """Each pair is judged twice with positions swapped. A model only wins if it
    wins both times; otherwise it is a tie. This cancels position bias."""
    rng = random.Random(seed)
    results = []
    for b, f in zip(base_answers, ft_answers):
        assert b["id"] == f["id"]
        first_ft = rng.random() < 0.5
        orders = [(f, b), (b, f)] if first_ft else [(b, f), (f, b)]
        wins = []
        reasons = []
        for x, y in orders:
            w, reason = call_judge(b["prompt"], x["answer"], y["answer"], model_name, api_key)
            winner = "tie" if w == "tie" else ("finetuned" if (x is f) == (w == "A") else "base")
            wins.append(winner)
            reasons.append(reason)
        final = wins[0] if wins[0] == wins[1] else "tie"
        results.append({"id": b["id"], "category": b["category"], "winner": final,
                        "rounds": wins, "reasons": reasons})
        print(f"  {b['id']}: {final}  {wins}")
    return results


# ── Reporting ─────────────────────────────────────────────────────────────────

def accuracy(rows, cond=lambda r: True):
    sel = [r for r in rows if cond(r)]
    return (sum(r["correct"] for r in sel) / len(sel), len(sel)) if sel else (float("nan"), 0)


def format_rate(answers):
    hits = sum(all(h.lower() in a["answer"].lower() for h in TRAINED_HEADINGS) for a in answers)
    return hits / len(answers) if answers else float("nan")


def markdown_report(mcq, gens, judged, judge_model):
    lines = ["## Evaluation: base model vs Orion-XAI", ""]
    any_rows = next(iter(mcq.values()))
    n_all = len(any_rows)
    n_seen = sum(r["seen_in_training"] for r in any_rows)
    lines += [f"### Multiple choice ({n_all} questions, scored by next-token probability)", "",
              f"| Setup | All | Not in training ({n_all - n_seen}) | Seen in training ({n_seen}) | XAI | MITRE | SOC | Trust |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    names = {"base_chat": "Base, chat format", "base_alpaca": "Base, Alpaca format",
             "finetuned": "**Orion-XAI (fine-tuned)**"}
    for cfg, rows in mcq.items():
        cells = [accuracy(rows)[0],
                 accuracy(rows, lambda r: not r["seen_in_training"])[0],
                 accuracy(rows, lambda r: r["seen_in_training"])[0]]
        cells += [accuracy(rows, lambda r, c=c: r["category"] == c)[0]
                  for c in ("xai", "mitre", "soc", "trust")]
        lines.append(f"| {names[cfg]} | " + " | ".join("–" if v != v else f"{v:.0%}" for v in cells) + " |")
    lines.append("")

    if gens:
        lines += [f"### Open-ended answers ({len(next(iter(gens.values())))} prompts)", "",
                  "| Setup | Avg words | Uses trained headings |", "| --- | ---: | ---: |"]
        for cfg, ans in gens.items():
            avg = sum(a["words"] for a in ans) / len(ans)
            lines.append(f"| {names[cfg]} | {avg:.0f} | {format_rate(ans):.0%} |")
        lines.append("")

    if judged:
        n = len(judged)
        ft = sum(j["winner"] == "finetuned" for j in judged)
        base = sum(j["winner"] == "base" for j in judged)
        tie = n - ft - base
        lines += [f"### Blind pairwise judge ({judge_model}, each pair judged in both orders)", "",
                  "| Fine-tuned wins | Base wins | Tie |", "| ---: | ---: | ---: |",
                  f"| {ft} ({ft/n:.0%}) | {base} ({base/n:.0%}) | {tie} ({tie/n:.0%}) |", ""]

    lines += ["### Caveats", "",
              "- Questions were written for this evaluation and checked against the training "
              "data for overlap (`eval/check_overlap.py`). 7 MITRE ID questions cover techniques "
              "that appear in training and are reported separately.",
              "- 40 MCQs is a small sample: a difference of 1 question is 2.5 points.",
              "- The LLM judge is another model, not a human expert, and may share biases "
              "with Llama models.", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="results")
    ap.add_argument("--judge", action="store_true", help="run the Groq LLM judge")
    ap.add_argument("--judge-model", default="llama-3.3-70b-versatile")
    ap.add_argument("--skip-generation", action="store_true")
    ap.add_argument("--limit", type=int, default=None, help="use only the first N items (smoke test)")
    ap.add_argument("--base", default=BASE_MODEL)
    ap.add_argument("--adapter", default=ADAPTER)
    ap.add_argument("--max-new-tokens", type=int, default=512)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    mcq_items = load_jsonl("eval/mcq.jsonl")[:args.limit]
    prompts = load_jsonl("eval/open_prompts.jsonl")[:args.limit]

    model, tok = load_model(args.base, args.adapter)

    print("== Multiple choice")
    mcq = {}
    for name, cfg in CONFIGS.items():
        mcq[name] = score_mcq(model, tok, mcq_items, cfg["format"], cfg["adapter"])
        print(f"  {name}: {accuracy(mcq[name])[0]:.0%}")
    (out / "mcq_results.json").write_text(json.dumps(mcq, indent=2))

    gens = {}
    if not args.skip_generation:
        for name in ("base_chat", "finetuned"):
            print(f"== Generating answers: {name}")
            cfg = CONFIGS[name]
            gens[name] = generate(model, tok, prompts, cfg["format"], cfg["adapter"],
                                  args.max_new_tokens)
        (out / "generations.json").write_text(json.dumps(gens, indent=2, ensure_ascii=False))

    judged = []
    if args.judge and gens:
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise SystemExit("Set GROQ_API_KEY to run the judge.")
        print(f"== Judging with {args.judge_model}")
        judged = judge_pairs(gens["base_chat"], gens["finetuned"], args.judge_model, key)
        (out / "judge_results.json").write_text(json.dumps(judged, indent=2, ensure_ascii=False))

    report = markdown_report(mcq, gens, judged, args.judge_model)
    (out / "REPORT.md").write_text(report)
    print("\n" + report)


if __name__ == "__main__":
    main()
