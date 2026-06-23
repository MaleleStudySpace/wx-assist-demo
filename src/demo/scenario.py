"""Demo scenario player — replays pre-scripted conversations.

Loads a scenario script and releases messages on schedule,
triggering keyword alerts and digest schedules in real-time.
"""

import logging
import threading
import time
from typing import Callable

logger = logging.getLogger(__name__)


# ── Built-in scenarios ─────────────────────────────────────────────────

SCENARIOS: dict[str, list[dict]] = {
    "default": [
        {"delay": 1, "sender": "张伟", "content": "早上好！有人在吗？"},
        {"delay": 4, "sender": "李芳", "content": "早！昨晚那个bug看了吗"},
        {"delay": 7, "sender": "王磊", "content": "看了，是并发问题，加个锁应该就行"},
        {"delay": 11, "sender": "张伟", "content": "紧急BUG！线上接口超时了"},
        {"delay": 14, "sender": "陈静", "content": "什么接口？我看看日志"},
        {"delay": 17, "sender": "张伟", "content": "用户反馈的那个，/api/report"},
        {"delay": 21, "sender": "王磊", "content": "找到了，数据库连接池满了"},
        {"delay": 24, "sender": "李芳", "content": "那得赶紧扩容啊"},
        {"delay": 28, "sender": "陈静", "content": "线上问题已回滚，正在排查根因"},
        {"delay": 31, "sender": "赵经理", "content": "做个事故复盘，明天开会"},
        {"delay": 35, "sender": "张伟", "content": "收到，我写文档"},
        {"delay": 38, "sender": "王磊", "content": "BUG已修复，提交了PR"},
    ],
    "tech_discuss": [
        {"delay": 1, "sender": "张伟", "content": "有人用过 WebSocket 的 SSE 方案吗？"},
        {"delay": 5, "sender": "李芳", "content": "用过，SSE 比 WebSocket 轻量很多"},
        {"delay": 8, "sender": "王磊", "content": "但是 SSE 只能服务端推送，不能双向"},
        {"delay": 12, "sender": "陈静", "content": "看场景吧，通知推送用 SSE 就够了"},
        {"delay": 16, "sender": "张伟", "content": "对了，React 19 正式版出了"},
        {"delay": 20, "sender": "李芳", "content": "Server Components 终于稳定了"},
        {"delay": 24, "sender": "王磊", "content": "性能提升挺明显的"},
    ],
}


class ScenarioPlayer:
    """Replays a scripted conversation scenario.

    Messages are injected one-by-one with configurable delay,
    triggering keyword alerts and AI processing in real-time.
    """

    def __init__(self, inject_func: Callable[[str, str, str], dict],
                 ws_broadcast_func: Callable[[dict], None],
                 status_update_func: Callable[[], None]):
        """
        Args:
            inject_func: Function(chat_id, sender, content) -> result dict
            ws_broadcast_func: Function(data) to broadcast via WebSocket
            status_update_func: Function to call after each injection
        """
        self._inject = inject_func
        self._broadcast = ws_broadcast_func
        self._update_status = status_update_func
        self._running = False
        self._thread = None

    @property
    def running(self) -> bool:
        return self._running

    def start(self, scenario_name: str, chat_id: str,
              speed: str = "normal", loop: bool = False) -> dict:
        """Start a scenario playback.

        Args:
            scenario_name: Key in SCENARIOS dict, or "default"
            chat_id: Target chat room ID
            speed: "fast" (0.3x), "normal" (1x), "slow" (2x)
            loop: Whether to repeat the scenario

        Returns:
            Status dict with ok, message_count, estimated_seconds
        """
        if self._running:
            return {"ok": False, "error": "Scenario already running"}

        script = SCENARIOS.get(scenario_name, SCENARIOS["default"])
        speed_mult = {"fast": 0.3, "normal": 1.0, "slow": 2.0}.get(speed, 1.0)

        self._running = True
        self._thread = threading.Thread(
            target=self._run,
            args=(script, chat_id, speed_mult, loop),
            daemon=True,
            name="ScenarioPlayer",
        )
        self._thread.start()

        total_delay = sum(m["delay"] for m in script) * speed_mult
        return {
            "ok": True,
            "scenario": scenario_name,
            "message_count": len(script),
            "estimated_seconds": round(total_delay, 1),
        }

    def stop(self):
        """Stop the current scenario."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
        self._thread = None

    def _run(self, script: list[dict], chat_id: str,
             speed_mult: float, loop: bool):
        """Execute the scenario script."""
        while self._running:
            for msg in script:
                if not self._running:
                    break

                delay = msg["delay"] * speed_mult
                time.sleep(delay)

                if not self._running:
                    break

                result = self._inject(chat_id, msg["sender"], msg["content"])

                # Broadcast the injected message event
                self._broadcast({
                    "event": "scenario_message",
                    "chat_id": chat_id,
                    "sender": msg["sender"],
                    "content": msg["content"],
                    "keyword_hits": result.get("keyword_hits", []),
                })

                self._update_status()

                logger.info(
                    "Scenario: [%s] %s: %s (hits: %s)",
                    chat_id, msg["sender"], msg["content"][:30],
                    result.get("keyword_hits", []),
                )

            if not loop:
                break

        self._running = False
        self._broadcast({"event": "scenario_finished", "chat_id": chat_id})
        logger.info("Scenario playback finished for %s", chat_id)
