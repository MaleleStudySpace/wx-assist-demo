"""LLM interaction logger — records full request/response for observability.

Writes two log lines per LLM call:
  1. [LLM] summary line — compact, always visible in the log viewer
  2. [LLM-DETAIL] JSON line — full prompts + response, parsed by frontend
     for collapsible display.

Thread-safe. API keys are masked before logging.
"""

import json
import logging
import re
import threading
import time

logger = logging.getLogger(__name__)

_counter = 0
_counter_lock = threading.Lock()


def _next_id() -> str:
    global _counter
    with _counter_lock:
        _counter += 1
        ts = time.strftime("%Y%m%d_%H%M%S")
        return f"llm_{ts}_{_counter:04d}"


_SECRET_PATTERNS = [
    (re.compile(r'(Bearer\s+)\S+', re.IGNORECASE), r'\1***'),
    (re.compile(r'(sk-)\S+'), r'\1***'),
    (re.compile(r'(sk-ant-)\S+'), r'\1***'),
    (re.compile(r'(api[_-]?key\s*[=:]\s*["\']?)\S+', re.IGNORECASE), r'\1***'),
]


def _mask_secrets(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _truncate(text: str, max_len: int = 0) -> str:
    if max_len > 0 and len(text) > max_len:
        return text[:max_len] + f"...({len(text)} chars total)"
    return text


def log_llm_interaction(
    backend: str,
    call_type: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    response: str,
    latency_ms: float,
    token_in: int = 0,
    token_out: int = 0,
    extra: dict | None = None,
) -> str:
    """Log an LLM interaction with both summary and detail lines."""
    interaction_id = _next_id()

    safe_sys = _mask_secrets(system_prompt)
    safe_user = _mask_secrets(user_prompt)
    safe_resp = _mask_secrets(response)

    is_error = safe_resp.startswith("[Error:")
    token_info = ""
    if token_in or token_out:
        token_info = f" | {token_in}→{token_out} tokens"

    resp_preview = _truncate(safe_resp.strip(), 80).replace("\n", " ")
    latency_str = f"{latency_ms / 1000:.1f}s" if latency_ms >= 1000 else f"{latency_ms:.0f}ms"

    status = "FAILED" if is_error else "OK"
    summary = (
        f"[LLM] {call_type} | {backend}/{model}{token_info} "
        f"| {latency_str} | {status} | resp: {resp_preview}"
    )
    logger.info(summary)

    detail = {
        "id": interaction_id,
        "backend": backend,
        "call_type": call_type,
        "model": model,
        "system_prompt": safe_sys,
        "user_prompt": safe_user,
        "response": safe_resp,
        "latency_ms": round(latency_ms, 1),
        "token_in": token_in,
        "token_out": token_out,
    }
    if extra:
        detail["extra"] = extra

    detail_json = json.dumps(detail, ensure_ascii=True)
    logger.info("[LLM-DETAIL] %s", detail_json)

    return interaction_id
