"""Summarization module — factory for AI backends.

Usage:
    from src.summarize import create_summarizer

    summarizer = create_summarizer(config)
    result = summarizer.summarize(messages, requester_name)
"""

import logging

from .base import AbstractSummarizer
from .models import ParticipantContribution, SummaryResult

logger = logging.getLogger(__name__)

__all__ = [
    "AbstractSummarizer",
    "ClaudeSummarizer",
    "OpenAICompatSummarizer",
    "DeepSeekSummarizer",
    "SummaryResult",
    "ParticipantContribution",
    "create_summarizer",
]


def create_summarizer(config) -> AbstractSummarizer:
    """Create the appropriate summarizer based on config.

    Priority:
    1. New unified ai_provider_base_url + ai_provider_api_key → auto-detect or use type
    2. Legacy ai_backend (claude / deepseek)

    Args:
        config: BotConfig instance.

    Returns:
        An AbstractSummarizer implementation.

    Raises:
        ValueError: If the configured backend is unknown.
    """
    # ── New unified AI provider path ──
    if config.ai_provider_base_url and config.ai_provider_api_key:
        provider_type = config.ai_provider_type
        if provider_type == "auto":
            from .provider_detector import detect_provider
            info = detect_provider(config.ai_provider_base_url, config.ai_provider_api_key)
            provider_type = info.provider_type if info.provider_type else "openai"
            if info.available_models and not config.ai_provider_model:
                logger.info("Auto-selected model: %s", info.available_models[0])

        model = config.ai_provider_model or "gpt-3.5-turbo"

        if provider_type == "anthropic":
            from .claude_backend import ClaudeSummarizer
            logger.info(
                "Creating ClaudeSummarizer via unified provider (model=%s, url=%s)",
                model, config.ai_provider_base_url,
            )
            return ClaudeSummarizer(
                api_key=config.ai_provider_api_key,
                model=model,
                base_url=config.ai_provider_base_url,
                chunk_size=config.chunk_size,
            )
        else:
            from .deepseek_backend import OpenAICompatSummarizer
            logger.info(
                "Creating OpenAICompatSummarizer via unified provider (model=%s, url=%s)",
                model, config.ai_provider_base_url,
            )
            return OpenAICompatSummarizer(
                api_key=config.ai_provider_api_key,
                model=model,
                base_url=config.ai_provider_base_url,
                chunk_size=config.chunk_size,
            )

    # ── Legacy path ──
    backend = config.ai_backend.lower()

    if backend == "deepseek":
        from .deepseek_backend import OpenAICompatSummarizer
        logger.info("Creating OpenAICompatSummarizer (model=%s)", config.deepseek_model)
        return OpenAICompatSummarizer(
            api_key=config.deepseek_api_key,
            model=config.deepseek_model,
            base_url=config.deepseek_base_url,
            chunk_size=config.chunk_size,
        )

    elif backend == "claude":
        from .claude_backend import ClaudeSummarizer
        logger.info("Creating ClaudeSummarizer (model=%s)", config.summarize_model)
        return ClaudeSummarizer(
            api_key=config.anthropic_api_key,
            model=config.summarize_model,
            base_url=config.anthropic_base_url,
            chunk_size=config.chunk_size,
        )

    else:
        raise ValueError(
            f"Unknown AI_BACKEND: '{config.ai_backend}'. "
            f"Supported: 'claude', 'deepseek'."
        )
