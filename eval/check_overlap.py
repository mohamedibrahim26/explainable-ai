"""Check that evaluation questions are not copies of training examples.

Run from the repo root:  python eval/check_overlap.py
Flags any eval item whose text is very similar to a training instruction.
"""
import glob
import json
import re
from difflib import SequenceMatcher


def norm(t):
    return re.sub(r"[^a-z0-9 ]", " ", t.lower()).split()


def shingles(words, n=5):
    return {" ".join(words[i:i + n]) for i in range(max(1, len(words) - n + 1))}


train = []
for path in glob.glob("data/*.jsonl"):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                train.append((row.get("instruction", "") + " " + row.get("input", "")).strip())

train_norm = [" ".join(norm(t)) for t in train]
train_sh = [shingles(norm(t)) for t in train]

items = []
for path, key in [("eval/mcq.jsonl", "question"), ("eval/open_prompts.jsonl", "prompt")]:
    with open(path, encoding="utf-8") as f:
        items += [(json.loads(l)["id"], json.loads(l)[key]) for l in f if l.strip()]

flagged = 0
for item_id, text in items:
    words = norm(text)
    sh = shingles(words)
    best, best_i = 0.0, -1
    for i, tsh in enumerate(train_sh):
        if not sh or not tsh:
            continue
        overlap = len(sh & tsh) / len(sh)
        if overlap > best:
            best, best_i = overlap, i
    ratio = SequenceMatcher(None, " ".join(words), train_norm[best_i]).ratio() if best_i >= 0 else 0
    if best >= 0.5 or ratio >= 0.8:
        flagged += 1
        print(f"[CHECK] {item_id}: 5-gram overlap {best:.0%}, similarity {ratio:.0%}")
        print(f"   eval : {text[:120]}")
        print(f"   train: {train[best_i][:120]}")

print(f"\n{len(items)} eval items checked against {len(train)} training rows; {flagged} flagged.")
