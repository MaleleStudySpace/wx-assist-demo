"""Demo digest scheduler — real cron-based AI digest generation.

Adapted from webot-main/src/assistant/scheduler.py for demo mode:
- Uses mock data instead of WCDB for message source
- Generates AI summaries via real summarize module
- Pushes results to notification queue + WebSocket broadcast
- Supports HH:MM and cron expression matching
"""

import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


def _match_cron(cron_expr: str, now: datetime) -> bool:
    """Match a 5-field cron expression against current time.

    Fields: minute hour day-of-month month day-of-week
    Supports: *, ranges (1-5), steps (*/15), lists (1,3,5)
    """
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False

    fields = [
        (now.minute, range(0, 60)),      # minute
        (now.hour, range(0, 24)),         # hour
        (now.day, range(1, 32)),          # day-of-month
        (now.month, range(1, 13)),        # month
        (now.isoweekday(), range(1, 8)),  # day-of-week (1=Mon)
    ]

    for value, valid_range in zip(fields, parts):
        if not _match_field(value, valid_range, valid_range):
            return False
    return True


def _match_field(value: int, expr: str, valid_range) -> bool:
    """Match a single cron field expression against a value."""
    if expr == "*":
        return True

    # Step: */15
    if expr.startswith("*/"):
        step = int(expr[2:])
        return value % step == 0

    # List: 1,3,5
    if "," in expr:
        for part in expr.split(","):
            if _match_single(value, part.strip(), valid_range):
                return True
        return False

    # Range: 1-5 or 1-5/2
    if "-" in expr:
        range_parts = expr.split("/")
        start_end = range_parts[0].split("-")
        start = int(start_end[0])
        end = int(start_end[1])
        if len(range_parts) > 1:
            step = int(range_parts[1])
            return start <= value <= end and (value - start) % step == 0
        return start <= value <= end

    # Single value
    return value == int(expr)


def _match_hhmm(schedule: str, now: datetime) -> bool:
    """Match HH:MM schedule format."""
    try:
        hour, minute = schedule.strip().split(":")
        return now.hour == int(hour) and now.minute == int(minute)
    except Exception:
        return False


class DemoDigestScheduler:
    """Demo version of digest scheduler.

    Reads digest_groups from assistant_config.json, matches schedules
    via cron expressions or HH:MM format, and triggers real AI summaries
    using mock message data.
    """

    def __init__(self, mock_messages_func, add_notification_func,
                 ws_broadcast_func, get_summarizer_func,
                 load_assistant_config_func, server_status):
        """
        Args:
            mock_messages_func: Function returning dict of chat_id -> messages list
            add_notification_func: Function to add a notification (returns id)
            ws_broadcast_func: Function to broadcast data via WebSocket
            get_summarizer_func: Function returning AbstractSummarizer or None
            load_assistant_config_func: Function returning assistant config dict
            server_status: ServerStatus instance to update
        """
        self._mock_messages = mock_messages_func
        self._add_notification = add_notification_func
        self._ws_broadcast = ws_broadcast_func
        self._get_summarizer = get_summarizer_func
        self._load_config = load_assistant_config_func
        self._status = server_status
        self._thread = None
        self._stop_event = threading.Event()
        self._last_run: dict[str, float] = {}  # group_key -> last run timestamp

    def start(self):
        """Start the scheduler daemon thread."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True,
                                         name="DemoDigestScheduler")
        self._thread.start()
        logger.info("DemoDigestScheduler started")

    def stop(self):
        """Stop the scheduler."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("DemoDigestScheduler stopped")

    def _run_loop(self):
        """Main loop: poll every 60s, check schedules, trigger digests."""
        while not self._stop_event.is_set():
            self._stop_event.wait(60)  # wait 60s (or stop signal)
            if self._stop_event.is_set():
                break
            try:
                self._check_and_trigger()
            except Exception as e:
                logger.error("Digest scheduler error: %s", e)

    def _check_and_trigger(self):
        """Check all digest groups and trigger if schedule matches."""
        now = datetime.now()
        config_data = self._load_config()
        config = config_data.get("config", config_data)
        digest_groups = config.get("digest_groups", [])

        for dg in digest_groups:
            if not dg.get("enabled", True):
                continue

            group_key = dg.get("chat_id", dg.get("group_name", ""))
            schedule = dg.get("schedule", [])
            cron_expr = dg.get("cron_expr", "")

            # Check schedule match
            matched = False
            if cron_expr:
                matched = _match_cron(cron_expr, now)
            elif schedule:
                for s in schedule:
                    if _match_hhmm(s, now):
                        matched = True
                        break

            if not matched:
                continue

            # Avoid duplicate runs within the same minute
            last = self._last_run.get(group_key, 0)
            if time.time() - last < 60:
                continue

            self._last_run[group_key] = time.time()
            logger.info("Digest triggered for %s at %s", group_key, now.strftime("%H:%M"))

            # Run digest in a separate thread to not block the scheduler
            threading.Thread(
                target=self._run_digest,
                args=(dg,),
                daemon=True,
                name=f"Digest-{group_key}",
            ).start()

    def _run_digest(self, group_config: dict):
        """Execute digest generation for one group."""
        chat_id = group_config.get("chat_id", "")
        group_name = group_config.get("group_name", "未知群")
        lookback_hours = group_config.get("lookback_hours", 6)
        profile = group_config.get("profile", {})
        custom_prompt = profile.get("custom_prompt", "")

        # Get summarizer
        summarizer = self._get_summarizer()
        if not summarizer:
            logger.warning("No AI backend available for digest of %s", group_name)
            return

        # Get mock messages
        all_messages = self._mock_messages()
        messages = all_messages.get(chat_id, [])

        # If no messages for this chat_id, try all available
        if not messages:
            for k, v in all_messages.items():
                if v:
                    messages = v
                    break

        if not messages:
            logger.info("No messages available for digest of %s", group_name)
            return

        # Filter by lookback (mock data timestamps may be old, use all)
        # Convert to summarizer format
        summary_messages = []
        for msg in messages[:500]:
            summary_messages.append({
                "sender_name": msg.get("sender_name", "unknown"),
                "content": msg.get("content", ""),
                "timestamp": msg.get("create_time", int(time.time())),
                "msg_type": msg.get("localType", 1),
            })

        try:
            # Use custom prompt or default summarize
            if custom_prompt:
                # Custom prompt path: single call with custom_prompt as system prompt
                from src.summarize.prompts import SYSTEM_PROMPT
                # Build context
                context_text = "\n".join(
                    f"{m['sender_name']}: {m['content']}" for m in summary_messages[:200]
                )
                user_prompt = f"请根据以下群聊记录生成摘要：\n\n{context_text}"
                result_text = summarizer._call_digest_api(
                    custom_prompt, [{"role": "user", "content": user_prompt}]
                )
                summary_text = result_text
            else:
                # Default: structured map-reduce summarize
                result = summarizer.summarize(summary_messages, "定时摘要")
                summary_text = result.summary_text

            self._status.last_api_call_time = time.time()

            # Create notification
            nid = self._add_notification(
                notif_type="digest",
                title=f"📋 {group_name} 群聊摘要",
                content=summary_text,
                chat_id=chat_id,
                group_name=group_name,
                priority="normal",
            )

            # Broadcast via WebSocket
            self._ws_broadcast({
                "event": "digest_result",
                "group_name": group_name,
                "chat_id": chat_id,
                "summary": summary_text[:500],  # preview
                "notification_id": nid,
            })

            logger.info("Digest completed for %s: %d chars", group_name, len(summary_text))

        except Exception as e:
            logger.error("Digest generation failed for %s: %s", group_name, e)
