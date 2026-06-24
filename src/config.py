"""Configuration loading from .env file.

Adapted from webot-main/src/config.py for demo mode:
- Removed WeChat-specific validation (no WCDB key required)
- AI key validation is relaxed (not required for demo startup)
- Added demo mode defaults
"""

import logging
import msvcrt
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

from dotenv import load_dotenv

logger = logging.getLogger(__name__)


def _decode_wechat_groups(raw: str) -> str:
    """Decode URL-encoded group names from .env WECHAT_GROUPS value."""
    if not raw or raw.strip() == "*":
        return raw.strip() if raw else "*"
    decoded = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            d = unquote(chunk)
            decoded.append(d)
        except Exception:
            decoded.append(chunk)
    return ",".join(decoded) if decoded else "*"


def _sanitize_display_name(name: str) -> str:
    """Remove dangerous characters from a display name."""
    if not name:
        return "群聊小助手"
    name = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) > 128:
        name = name[:128]
    if not name:
        return "群聊小助手"
    return name


def _resolve_project_root() -> Path:
    app_home = os.getenv("WEBOT_APP_HOME", "").strip()
    if app_home:
        return Path(app_home).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = _resolve_project_root()


def write_env_atomic(env_path: Path, updates: dict[str, str]) -> None:
    """Thread- and process-safe atomic update of .env key=value pairs."""
    lock_path = env_path.with_suffix(".lock")

    if not env_path.exists():
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text("", encoding="utf-8")

    lock_fd = open(lock_path, "w")
    try:
        for _ in range(10):
            try:
                msvcrt.locking(lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                import time
                time.sleep(0.05)
        else:
            logger.warning("Could not acquire .env.lock after 10 attempts, proceeding without lock")

        lines = []
        try:
            lines = env_path.read_text(encoding="utf-8").splitlines()
        except Exception:
            lines = []

        updated_keys = set()
        new_lines = []
        for line in lines:
            stripped = line.strip()
            updated = False
            if stripped and not stripped.startswith("#") and "=" in stripped:
                k = stripped.split("=", 1)[0].strip()
                if k in updates:
                    new_lines.append(f"{k}={updates[k]}")
                    updated_keys.add(k)
                    updated = True
            if not updated:
                new_lines.append(line)

        for k, v in updates.items():
            if k not in updated_keys:
                new_lines.append(f"{k}={v}")

        tmp = env_path.with_suffix(".tmp")
        tmp.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        os.replace(tmp, env_path)

    finally:
        try:
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
        lock_fd.close()


def find_env_file() -> Path | None:
    """Find the .env file using a consistent search order."""
    explicit_env = os.getenv("WEBOT_ENV_FILE", "").strip()
    if explicit_env:
        explicit_path = Path(explicit_env).expanduser()
        if explicit_path.exists():
            return explicit_path

    locations = [
        PROJECT_ROOT / "data" / ".env",
        PROJECT_ROOT / ".env",
        Path.cwd() / ".env",
    ]
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        locations.insert(0, exe_dir / ".env")

    for loc in locations:
        if loc.exists():
            return loc
    return None


_env_path = find_env_file()

if _env_path:
    load_dotenv(_env_path)
else:
    load_dotenv()

if _env_path:
    logger.info("Loaded .env from: %s", _env_path)


@dataclass
class BotConfig:
    """All configuration for the demo — relaxed validation."""

    # === AI Backend (legacy) ===
    ai_backend: str = "deepseek"

    # === Claude (Anthropic) — legacy ===
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"
    summarize_model: str = "claude-haiku-4-5-20251001"

    # === DeepSeek — legacy ===
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"

    # === AI Provider (new unified config) ===
    ai_provider_base_url: str = ""
    ai_provider_api_key: str = ""
    ai_provider_type: str = "auto"
    ai_provider_model: str = ""

    # === Bot Identity ===
    bot_display_name: str = "群聊小助手"

    # === Demo mode flag ===
    demo_mode: bool = True

    # === Trigger Keywords ===
    trigger_keywords: list[str] = field(default_factory=lambda: [
        "总结一下", "之前发了什么", "错过了什么", "summarize",
        "what did i miss", "聊天总结", "帮我总结", "前面说了什么",
        "说了啥", "发生了什么",
    ])

    # === Tuning ===
    chunk_size: int = 400

    # === Logging ===
    log_level: str = "INFO"
    log_file: str = "data/demo.log"


def load_config() -> BotConfig:
    """Load configuration from environment variables.

    In demo mode, AI keys are NOT required — the server starts without them,
    and AI features will show a clear error until configured.
    """
    # Re-read .env file so saved config changes are visible without process restart
    env_path = find_env_file()
    if env_path:
        load_dotenv(env_path, override=True)

    kwargs: dict = {
        "ai_backend": os.getenv("AI_BACKEND", "deepseek").strip().lower(),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", "").strip(),
        "anthropic_base_url": os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").strip(),
        "summarize_model": os.getenv("SUMMARIZE_MODEL", "claude-haiku-4-5-20251001").strip(),
        "deepseek_api_key": os.getenv("DEEPSEEK_API_KEY", "").strip(),
        "deepseek_base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip(),
        "bot_display_name": _sanitize_display_name(os.getenv("BOT_DISPLAY_NAME", "群聊小助手")),
        "chunk_size": int(os.getenv("CHUNK_SIZE", "400")),
        "log_level": os.getenv("LOG_LEVEL", "INFO").strip(),
        "log_file": os.getenv("LOG_FILE", "data/demo.log").strip(),
        "ai_provider_base_url": os.getenv("AI_PROVIDER_BASE_URL", "").strip(),
        "ai_provider_api_key": os.getenv("AI_PROVIDER_API_KEY", "").strip(),
        "ai_provider_type": os.getenv("AI_PROVIDER_TYPE", "auto").strip(),
        "ai_provider_model": os.getenv("AI_PROVIDER_MODEL", "").strip(),
    }

    deepseek_model = os.getenv("DEEPSEEK_MODEL")
    if deepseek_model is not None:
        kwargs["deepseek_model"] = deepseek_model.strip()

    keywords_str = os.getenv("TRIGGER_KEYWORDS", "").strip()
    if keywords_str:
        kwargs["trigger_keywords"] = [kw.strip() for kw in keywords_str.split(",") if kw.strip()]

    return BotConfig(**kwargs)


def is_onboarding_done() -> bool:
    """Check if onboarding has been completed."""
    env_path = find_env_file()
    if env_path and env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ONBOARDING_DONE="):
                return line.split("=", 1)[1].strip().lower() == "true"
        return False
    return False
