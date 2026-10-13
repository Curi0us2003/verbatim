"""LLM client for Ollama (local, default) and Groq (optional cloud), with JSON parsing and one retry."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import settings
from .prompts import RETRY_NUDGE

log = logging.getLogger("verbatim.llm")

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


def extract_json(raw: str) -> dict:
    """Parse a JSON object from a model reply, tolerating code fences or stray text around it."""
    text = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("no JSON object in reply")
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("reply is not a JSON object")
    return value


def chat_json(system: str, user: str, schema: type[T]) -> T:
    """Ask for JSON, validate it with Pydantic, retry once on invalid output (SPEC.md → AI prompts)."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    last_error: Exception | None = None
    for _attempt in range(2):
        raw = complete(messages)
        try:
            return schema.model_validate(extract_json(raw))
        except (ValueError, ValidationError) as exc:
            last_error = exc
            log.warning("Invalid JSON from LLM: %s", exc)
            messages = messages + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": RETRY_NUDGE},
            ]
    raise LLMError(f"The AI did not return valid JSON ({last_error}).")


def complete(messages: list[dict]) -> str:
    if settings.llm_engine == "groq":
        return _groq(messages)
    return _ollama(messages)


def _ollama(messages: list[dict]) -> str:
    for attempt in range(3):
        try:
            resp = httpx.post(
                f"{settings.ollama_url.rstrip('/')}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": messages,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": settings.llm_temperature, "num_ctx": settings.ollama_num_ctx},
                },
                timeout=600,
            )
        except httpx.HTTPError as exc:
            raise LLMError(
                "Ollama is not running. Install it from ollama.com, start it, and run "
                f"`ollama pull {settings.ollama_model}`."
            ) from exc
        if resp.status_code == 404:
            raise LLMError(f"The model {settings.ollama_model} is not downloaded. Run: ollama pull {settings.ollama_model}")
        # 5xx: Ollama's model runner can crash while loading onto a GPU that the speech models have
        # only just released; it restarts by itself, so wait a moment and try again.
        if resp.status_code >= 500 and attempt < 2:
            log.warning("Ollama error %s, retrying: %s", resp.status_code, resp.text[:200])
            time.sleep(3 * (attempt + 1))
            continue
        if resp.status_code >= 400:
            raise LLMError(f"Ollama error {resp.status_code}: {resp.text[:300]}")
        return resp.json()["message"]["content"]
    raise LLMError("Ollama kept failing. Try Generate insights again.")


def _groq(messages: list[dict]) -> str:
    if not settings.groq_api_key:
        raise LLMError("LLM_ENGINE=groq needs GROQ_API_KEY in .env.")
    for attempt in range(6):
        try:
            resp = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": settings.groq_llm_model,
                    "messages": messages,
                    "temperature": settings.llm_temperature,
                    "response_format": {"type": "json_object"},
                },
                timeout=120,
            )
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach Groq: {exc}") from exc
        if resp.status_code == 429 and attempt < 5:  # free-tier rate limit: wait and retry
            time.sleep(float(resp.headers.get("retry-after", 15)))
            continue
        if resp.status_code >= 400:
            raise LLMError(f"Groq error {resp.status_code}: {resp.text[:300]}")
        return resp.json()["choices"][0]["message"]["content"]
    raise LLMError("Groq rate limit reached. Try again in a few minutes.")


def unload() -> None:
    """Ask Ollama to release the model from GPU memory now (it normally stays loaded for 5 minutes).
    On a 6 GB GPU the AI model and the speech models do not fit at the same time."""
    if settings.llm_engine != "ollama":
        return
    try:
        httpx.post(
            f"{settings.ollama_url.rstrip('/')}/api/generate",
            json={"model": settings.ollama_model, "keep_alive": 0},
            timeout=10,
        )
    except httpx.HTTPError:
        pass  # Ollama not running: nothing to free


def status() -> dict:
    """Is the configured LLM reachable? Used by /api/health for friendly UI hints."""
    if settings.llm_engine == "groq":
        ok = bool(settings.groq_api_key)
        return {"ready": ok, "detail": None if ok else "GROQ_API_KEY is missing in .env."}
    try:
        tags = httpx.get(f"{settings.ollama_url.rstrip('/')}/api/tags", timeout=2).json()
    except Exception:
        return {"ready": False, "detail": "Ollama is not running. Install it from ollama.com and start it."}
    names = {m.get("name", "") for m in tags.get("models", [])}
    wanted = settings.ollama_model
    if wanted in names or f"{wanted}:latest" in names:
        return {"ready": True, "detail": None}
    return {"ready": False, "detail": f"Run `ollama pull {wanted}` to download the AI model."}
