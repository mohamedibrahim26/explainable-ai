"""
Provider-agnostic LLM service.

Supports: OpenAI · Anthropic · Groq · Google Gemini · Ollama (local/free)

Key features
------------
* Single unified interface regardless of which backend is chosen
* Automatic fallback: if the primary provider fails, tries the next in chain
* Streaming support via async generators (SSE-ready)
* Per-provider model defaults
* Token-count reporting where available
"""

import asyncio
import logging
from typing import AsyncGenerator, List, Optional, Tuple
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import settings
from models.schemas import Message

logger = logging.getLogger(__name__)

# ── Per-provider default models ───────────────────────────────────────────────
PROVIDER_DEFAULTS: dict[str, str] = {
    "openai":    "gpt-4o-mini",
    "anthropic": "claude-3-haiku-20240307",
    "groq":      "llama-3.3-70b-versatile",
    "gemini":    "gemini-1.5-flash",
    "ollama":    "orion-xai",
}

PROVIDER_MODELS: dict[str, List[str]] = {
    "openai":    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    "anthropic": ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229"],
    "groq":      ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    "gemini":    ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
    "ollama":    ["orion-xai", "llama3.2", "llama3.1", "mistral", "phi3", "qwen2.5"],
}


# ── Availability check ────────────────────────────────────────────────────────

def is_provider_available(provider: str) -> Tuple[bool, str]:
    """Return (available, reason) for a given provider."""
    if provider == "openai":
        if not settings.openai_api_key:
            return False, "OPENAI_API_KEY not set"
        return True, ""
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            return False, "ANTHROPIC_API_KEY not set"
        return True, ""
    if provider == "groq":
        if not settings.groq_api_key:
            return False, "GROQ_API_KEY not set"
        return True, ""
    if provider == "gemini":
        if not settings.gemini_api_key:
            return False, "GEMINI_API_KEY not set"
        return True, ""
    if provider == "ollama":
        # Ollama is always "configured" — it just needs to be running locally
        return True, ""
    return False, f"Unknown provider: {provider}"


def get_effective_provider(requested: Optional[str] = None) -> str:
    """
    Resolve which provider to actually use.
    Priority: requested → default → first available in fallback chain.
    """
    chain = [requested] if requested else []
    chain += [settings.default_provider] + settings.fallback_providers

    for p in chain:
        if p and is_provider_available(p)[0]:
            return p

    raise RuntimeError(
        "No LLM provider is available. Set at least one API key in .env "
        "or install Ollama locally (https://ollama.ai)."
    )


# ── OpenAI ────────────────────────────────────────────────────────────────────

async def _stream_openai(
    messages: List[Message],
    model: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
    api_key: str,
    base_url: Optional[str] = None,   # used for Groq (OpenAI-compatible)
) -> AsyncGenerator[str, None]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    formatted = []
    if system_prompt:
        formatted.append({"role": "system", "content": system_prompt})
    for m in messages:
        formatted.append({"role": m.role, "content": m.content})

    stream = await client.chat.completions.create(
        model=model,
        messages=formatted,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


# ── Anthropic ─────────────────────────────────────────────────────────────────

async def _stream_anthropic(
    messages: List[Message],
    model: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    formatted = [{"role": m.role, "content": m.content} for m in messages
                 if m.role in ("user", "assistant")]

    kwargs = dict(
        model=model,
        messages=formatted,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if system_prompt:
        kwargs["system"] = system_prompt

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


# ── Google Gemini ─────────────────────────────────────────────────────────────

async def _stream_gemini(
    messages: List[Message],
    model: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    import google.generativeai as genai

    genai.configure(api_key=settings.gemini_api_key)

    generation_config = genai.GenerationConfig(
        temperature=temperature,
        max_output_tokens=max_tokens,
    )

    sys_instruction = system_prompt or ""
    gemini_model = genai.GenerativeModel(
        model_name=model,
        generation_config=generation_config,
        system_instruction=sys_instruction if sys_instruction else None,
    )

    # Convert to Gemini format
    history = []
    last_user_msg = ""
    for m in messages:
        if m.role == "system":
            continue
        role = "user" if m.role == "user" else "model"
        if m == messages[-1] and m.role == "user":
            last_user_msg = m.content
        else:
            history.append({"role": role, "parts": [m.content]})

    chat = gemini_model.start_chat(history=history)

    # Gemini streaming is synchronous — run in executor
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: chat.send_message(last_user_msg or messages[-1].content, stream=True)
    )

    for chunk in response:
        if chunk.text:
            yield chunk.text


# ── Ollama (local, free) ──────────────────────────────────────────────────────

async def _stream_ollama(
    messages: List[Message],
    model: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    import httpx

    formatted = []
    if system_prompt:
        formatted.append({"role": "system", "content": system_prompt})
    for m in messages:
        formatted.append({"role": m.role, "content": m.content})

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": model,
                "messages": formatted,
                "stream": True,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                import json
                try:
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue


# ── Public interface ──────────────────────────────────────────────────────────

async def stream_chat(
    messages: List[Message],
    provider: Optional[str] = None,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncGenerator[str, None]:
    """
    Stream chat tokens from whichever provider is resolved.
    Automatically falls back through the chain on failure.

    Yields individual text tokens as they arrive.
    Also yields a final sentinel: {"provider": "...", "model": "..."}
    """
    providers_to_try = []

    if provider:
        providers_to_try.append(provider)

    # Add fallback chain (dedup)
    for p in settings.fallback_providers:
        if p not in providers_to_try:
            providers_to_try.append(p)

    # Append XAI instruction to every system prompt
    from prompts.templates import XAI_SUFFIX
    xai_system = (system_prompt or "") + XAI_SUFFIX

    last_err = None
    for p in providers_to_try:
        available, reason = is_provider_available(p)
        if not available:
            logger.debug(f"Skipping {p}: {reason}")
            continue

        effective_model = model or PROVIDER_DEFAULTS.get(p, "")
        logger.info(f"Trying provider={p} model={effective_model}")

        try:
            gen = _get_stream_generator(
                p, messages, effective_model, xai_system, temperature, max_tokens
            )
            async for token in gen:
                yield token
            # Signal which provider/model was used
            import json
            yield f"\n\n[ORION_META]{json.dumps({'provider': p, 'model': effective_model})}"
            return
        except Exception as e:
            last_err = e
            logger.warning(f"Provider {p} failed: {e}. Trying next...")
            continue

    raise RuntimeError(
        f"All providers failed. Last error: {last_err}. "
        "Set at least one API key or run Ollama locally."
    )


def _get_stream_generator(
    provider: str,
    messages: List[Message],
    model: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    if provider == "openai":
        return _stream_openai(
            messages, model, system_prompt, temperature, max_tokens,
            api_key=settings.openai_api_key,
        )
    if provider == "groq":
        return _stream_openai(
            messages, model, system_prompt, temperature, max_tokens,
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )
    if provider == "anthropic":
        return _stream_anthropic(messages, model, system_prompt, temperature, max_tokens)
    if provider == "gemini":
        return _stream_gemini(messages, model, system_prompt, temperature, max_tokens)
    if provider == "ollama":
        return _stream_ollama(messages, model, system_prompt, temperature, max_tokens)

    raise ValueError(f"Unknown provider: {provider}")


async def complete_chat(
    messages: List[Message],
    provider: Optional[str] = None,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> Tuple[str, str, str]:
    """
    Non-streaming version. Returns (full_text, provider_used, model_used).
    Used internally by roadmap and safety services.
    """
    p = get_effective_provider(provider)
    effective_model = model or PROVIDER_DEFAULTS.get(p, "")

    full_text = ""
    gen = _get_stream_generator(p, messages, effective_model, system_prompt, temperature, max_tokens)
    async for token in gen:
        full_text += token

    return full_text, p, effective_model


def get_all_provider_statuses():
    """Return status of all known providers — used by /providers endpoint."""
    from models.schemas import ProviderStatus
    statuses = []
    for p, models in PROVIDER_MODELS.items():
        available, reason = is_provider_available(p)
        statuses.append(ProviderStatus(
            provider=p,
            available=available,
            models=models,
            reason=reason if not available else None,
        ))
    return statuses
