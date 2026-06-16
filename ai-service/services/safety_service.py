"""
Safety / content moderation layer.

Two-pass approach:
  Pass 1 — fast local check (profanity + keyword blocklist) — zero latency
  Pass 2 — LLM-based nuanced classification (only if pass 1 is unclear)
"""

import json
import logging
import re
from typing import Tuple, List

from better_profanity import profanity

logger = logging.getLogger(__name__)

# Initialise profanity filter
profanity.load_censor_words()

# Hard blocklist — patterns that are always flagged
_BLOCKLIST = [
    r"\b(how\s+to\s+make\s+(a\s+)?(bomb|weapon|explosive))\b",
    r"\b(synthesize\s+.{0,30}drug)\b",
    r"\b(child\s+porn|csam|cp\s+link)\b",
    r"\b(doxx|dox\s+.{0,20}address)\b",
]
_COMPILED = [re.compile(p, re.IGNORECASE) for p in _BLOCKLIST]


def _local_check(text: str) -> Tuple[bool, List[str]]:
    """
    Fast local safety check. Returns (is_safe, flagged_categories).
    """
    flags = []

    # Profanity
    if profanity.contains_profanity(text):
        flags.append("profanity")

    # Hard blocklist
    for pattern in _COMPILED:
        if pattern.search(text):
            flags.append("dangerous_content")
            break

    # PII patterns (very basic)
    if re.search(r"\b\d{3}-\d{2}-\d{4}\b", text):           # SSN
        flags.append("personal_data")
    if re.search(r"\b\d{16}\b", text.replace(" ", "")):     # Credit card
        flags.append("personal_data")

    is_safe = len(flags) == 0
    return is_safe, flags


async def check_safety(
    text: str,
    use_llm: bool = False,
    provider: str = None,
) -> Tuple[bool, List[str], str]:
    """
    Full safety check.
    Returns (is_safe, flagged_categories, reason).
    """
    # Pass 1 — local
    is_safe, flags = _local_check(text)

    if not is_safe:
        return False, flags, f"Flagged by local filter: {', '.join(flags)}"

    # Pass 2 — LLM (optional, for deeper semantic checking)
    if use_llm:
        try:
            from services.llm_service import complete_chat
            from models.schemas import Message
            from prompts.templates import SAFETY_SYSTEM, safety_check_prompt

            msgs = [Message(role="user", content=safety_check_prompt(text))]
            raw, _, _ = await complete_chat(
                messages=msgs,
                provider=provider,
                system_prompt=SAFETY_SYSTEM,
                temperature=0.0,
                max_tokens=200,
            )

            # Strip any ORION_META marker
            raw = raw.split("[ORION_META]")[0].strip()

            data = json.loads(raw)
            is_safe = bool(data.get("is_safe", True))
            llm_flags = data.get("flagged_categories", [])
            reason = data.get("reason") or ""
            return is_safe, llm_flags, reason

        except Exception as e:
            logger.warning(f"LLM safety check failed: {e}. Falling back to local result.")

    return True, [], ""


def sanitise_output(text: str) -> str:
    """
    Light post-processing of LLM output:
    - Censor profanity
    - Strip any accidentally leaked system-prompt markers
    """
    text = profanity.censor(text)
    # Remove any accidental [ORION_META] leakage
    text = re.sub(r"\[ORION_META\].*$", "", text, flags=re.DOTALL).rstrip()
    return text
