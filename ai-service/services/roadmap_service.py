"""
Career Roadmap generation service.

Uses LLM to generate structured, month-by-month career roadmaps.
Parses the JSON response and validates it against our schema.
"""

import json
import logging
import re
from typing import Optional, List

from services.llm_service import complete_chat
from models.schemas import Message, RoadmapResponse, RoadmapMilestone
from prompts.templates import ROADMAP_SYSTEM, roadmap_user_prompt

logger = logging.getLogger(__name__)


async def generate_roadmap(
    goal: str,
    current_skills: List[str] = None,
    experience_level: str = "beginner",
    timeframe_months: int = 12,
    provider: Optional[str] = None,
    learning_style: Optional[str] = None,
) -> RoadmapResponse:
    """
    Generate a structured career roadmap using the LLM.
    Retries once with a simpler prompt if the first attempt fails JSON parsing.
    """
    current_skills = current_skills or []

    prompt = roadmap_user_prompt(
        goal=goal,
        current_skills=current_skills,
        experience_level=experience_level,
        timeframe_months=timeframe_months,
        learning_style=learning_style or "",
    )

    msgs = [Message(role="user", content=prompt)]

    raw, provider_used, model_used = await complete_chat(
        messages=msgs,
        provider=provider,
        system_prompt=ROADMAP_SYSTEM,
        temperature=0.4,    # lower = more structured output
        max_tokens=4096,
    )

    # Strip ORION_META marker
    raw = raw.split("[ORION_META]")[0].strip()

    # Parse JSON
    data = _extract_json(raw)
    if data is None:
        raise ValueError(
            "The AI returned an invalid roadmap format. Try again or switch provider."
        )

    # Validate and build response
    milestones = []
    for m in data.get("milestones", []):
        try:
            milestones.append(RoadmapMilestone(
                month=int(m.get("month", 1)),
                title=str(m.get("title", "Milestone")),
                description=str(m.get("description", "")),
                skills=list(m.get("skills", [])),
                resources=list(m.get("resources", [])),
                project_idea=str(m.get("project_idea", "")),
            ))
        except Exception as e:
            logger.warning(f"Skipping malformed milestone: {e}")
            continue

    return RoadmapResponse(
        goal=data.get("goal", goal),
        total_months=int(data.get("total_months", timeframe_months)),
        milestones=milestones,
        final_outcome=str(data.get("final_outcome", "")),
        provider_used=f"{provider_used}/{model_used}",
    )


def _extract_json(text: str) -> Optional[dict]:
    """
    Robustly extract JSON from LLM output.
    Handles markdown code blocks and leading/trailing prose.
    """
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\n?", "", text).strip("` \n")
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Find the outermost JSON object
    start = text.find("{")
    end = text.rfind("}") + 1
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    logger.error(f"Could not extract JSON from response: {text[:300]}")
    return None
