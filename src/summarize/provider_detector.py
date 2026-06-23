"""AI Provider auto-detection.

Three-step fallback:
1. GET /v1/models → parse response format to identify Anthropic vs OpenAI
2. POST /v1/chat/completions minimal probe → OpenAI compatible
3. POST /v1/messages minimal probe → Anthropic compatible

All steps use a 5-second timeout.  Returns a ProviderInfo dataclass.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 10.0


@dataclass
class ProviderInfo:
    provider_type: str = ""       # "anthropic" | "openai" | ""
    available_models: list[str] = field(default_factory=list)
    error: str = ""


def _normalize_base(base_url: str) -> str:
    """Strip trailing /v1 so we can consistently append /v1/models etc.

    Users may paste https://api.example.com/v1 or just https://api.example.com.
    We normalize to the root, then always append /v1/... ourselves.
    """
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        url = url[:-3]
    return url


def _try_models_endpoint(base_url: str, api_key: str) -> Optional[ProviderInfo]:
    """Step 1: Try GET /v1/models to detect provider and list models."""
    url = _normalize_base(base_url) + "/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 401 or resp.status_code == 403:
            logger.debug("GET /v1/models returned %d (auth error)", resp.status_code)
            return ProviderInfo(error="API Key 无效或站点地址错误，请检查后重试。")
        if resp.status_code != 200:
            logger.debug("GET /v1/models returned %d", resp.status_code)
            return None
        data = resp.json()

        # OpenAI format: {"object": "list", "data": [...]}
        # Anthropic format: {"data": [...], "has_more": ...} (no "object" at top)
        if isinstance(data, dict) and "data" in data:
            models = [m["id"] for m in data.get("data", []) if isinstance(m, dict) and "id" in m]
            if data.get("object") == "list":
                provider_type = "openai"
            else:
                provider_type = "anthropic"
            logger.info(
                "Provider detected as '%s' via /v1/models (%d models)",
                provider_type, len(models),
            )
            return ProviderInfo(provider_type=provider_type, available_models=models)
        else:
            logger.debug("Unexpected /v1/models response format")
            return None
    except requests.RequestException as e:
        logger.debug("GET /v1/models failed: %s", e)
        return None
    except Exception as e:
        logger.debug("GET /v1/models parse error: %s", e)
        return None


def _try_openai_endpoint(base_url: str, api_key: str) -> Optional[bool]:
    """Step 2: POST /v1/chat/completions with a minimal request.

    Returns True if OpenAI-compatible, False if not, None if auth error.
    A 200 or 400 (model not found but endpoint correct) confirms OpenAI compat.
    """
    url = _normalize_base(base_url) + "/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
        if resp.status_code in (401, 403):
            logger.debug("POST /v1/chat/completions returned %d (auth error)", resp.status_code)
            return None  # auth error — caller should report
        # 200 = success (model exists), 400 = bad request (endpoint exists, model wrong)
        # Both confirm this is an OpenAI-compatible endpoint.
        if resp.status_code in (200, 400):
            logger.info("OpenAI-compatible endpoint confirmed (status=%d)", resp.status_code)
            return True
        logger.debug("POST /v1/chat/completions returned %d", resp.status_code)
        return False
    except requests.RequestException as e:
        logger.debug("POST /v1/chat/completions failed: %s", e)
        return False


def _try_anthropic_endpoint(base_url: str, api_key: str) -> Optional[bool]:
    """Step 2: POST /v1/messages with a minimal request.

    Returns True if Anthropic-compatible, False if not, None if auth error.
    A 200 or 400 confirms Anthropic compatibility.
    """
    url = _normalize_base(base_url) + "/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    body = {
        "model": "claude-haiku-4-5",
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "hi"}],
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
        if resp.status_code in (401, 403):
            logger.debug("POST /v1/messages returned %d (auth error)", resp.status_code)
            return None  # auth error
        if resp.status_code in (200, 400):
            logger.info("Anthropic-compatible endpoint confirmed (status=%d)", resp.status_code)
            return True
        logger.debug("POST /v1/messages returned %d", resp.status_code)
        return False
    except requests.RequestException as e:
        logger.debug("POST /v1/messages failed: %s", e)
        return False


def detect_provider(base_url: str, api_key: str) -> ProviderInfo:
    """Detect AI provider type and available models.

    Returns ProviderInfo with provider_type="" and error set on total failure.
    """
    if not base_url or not api_key:
        return ProviderInfo(error="请填写站点 URL 和 API Key")

    # Step 1: try models endpoint
    info = _try_models_endpoint(base_url, api_key)
    if info is not None:
        if info.error:
            return info  # auth error from models endpoint
        if info.provider_type:
            return info

    # Step 2: probe actual endpoints
    is_openai = _try_openai_endpoint(base_url, api_key)
    is_anthropic = _try_anthropic_endpoint(base_url, api_key)

    # Auth error from both probes → key/site mismatch
    if is_openai is None and is_anthropic is None:
        return ProviderInfo(error="API Key 无效或站点地址错误，请检查后重试。")

    if is_openai:
        return ProviderInfo(provider_type="openai")
    if is_anthropic:
        return ProviderInfo(provider_type="anthropic")

    # Step 3: total failure
    return ProviderInfo(
        error="无法自动检测 Provider 类型。请手动选择并输入模型 ID。"
    )
