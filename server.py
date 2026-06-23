"""wx-assist-demo — Python backend server.

Replaces the Node.js mock server with real AI integration,
real config persistence, and real scheduling — all without WeChat.

Usage:
    python server.py
    # Visit http://127.0.0.1:7327
"""

import json
import logging
import os
import sys
import threading
import time
import traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

# ── Project root ──────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# ── Data directory ────────────────────────────────────────────────────
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────
from src.utils.logging_config import setup_logging

setup_logging(level="INFO", log_file=str(DATA_DIR / "demo.log"))
logger = logging.getLogger("demo")

# ── Config ────────────────────────────────────────────────────────────
from src.config import BotConfig, load_config, write_env_atomic, find_env_file

# ── AI Chat sessions ──────────────────────────────────────────────────
_ai_sessions: dict[str, dict] = {}  # session_id -> {messages, summarizer, ...}
_ai_session_lock = threading.Lock()
_ai_session_counter = 0

# ── Server status ─────────────────────────────────────────────────────
class ServerStatus:
    """Thread-safe status holder, mirrors webot-main's _ServerStatus."""

    def __init__(self):
        self.running = False
        self.uptime_sec = 0
        self.messages_processed = 0
        self.wechat_backend = "demo"
        self.ai_backend = ""
        self.db_ok = True
        self.wechat_online = False  # demo mode: no WeChat
        self.ai_ok = False
        self.ai_verified = False
        self.model_name = ""
        self.group_count = 0
        self.last_api_call_sec_ago = 999
        self.last_api_call_time = 0.0
        self.error = ""
        self._start_time = 0.0
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            self.running = True
            self._start_time = time.time()

    def stop(self):
        with self._lock:
            self.running = False

    def update_ai(self, ok: bool, model: str, backend: str):
        with self._lock:
            self.ai_ok = ok
            self.ai_verified = ok
            self.model_name = model
            self.ai_backend = backend

    def to_dict(self) -> dict:
        with self._lock:
            uptime = int(time.time() - self._start_time) if self._start_time else 0
            last_ago = int(time.time() - self.last_api_call_time) if self.last_api_call_time else 999
            return {
                "running": self.running,
                "uptime_sec": uptime,
                "messages_processed": self.messages_processed,
                "wechat_backend": self.wechat_backend,
                "ai_backend": self.ai_backend,
                "db_ok": self.db_ok,
                "wechat_online": self.wechat_online,
                "ai_ok": self.ai_ok,
                "ai_verified": self.ai_verified,
                "model_name": self.model_name,
                "group_count": self.group_count,
                "last_api_call_sec_ago": last_ago,
                "last_api_call_time": self.last_api_call_time,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "error": self.error,
            }


status = ServerStatus()

# ── WebSocket clients ─────────────────────────────────────────────────
_ws_clients: list = []
_ws_lock = threading.Lock()


def _ws_encode_text_frame(payload: bytes) -> bytes:
    """Encode a WebSocket text frame (opcode 0x1) from raw bytes."""
    length = len(payload)
    if length <= 125:
        return b'\x81' + bytes([length]) + payload
    elif length <= 65535:
        return b'\x81' + b'\x7e' + length.to_bytes(2, 'big') + payload
    else:
        return b'\x81' + b'\x7f' + length.to_bytes(8, 'big') + payload


def ws_broadcast(data: dict):
    """Broadcast data to all connected WebSocket clients."""
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    frame = _ws_encode_text_frame(payload)
    with _ws_lock:
        dead = []
        for i, sock in enumerate(_ws_clients):
            try:
                sock.sendall(frame)
            except Exception:
                dead.append(i)
        for i in reversed(dead):
            _ws_clients.pop(i)


# ── Scenario player ────────────────────────────────────────────────────
_scenario_player = None


def get_scenario_player():
    """Get or create the scenario player."""
    global _scenario_player
    if _scenario_player is None:
        from src.demo.scenario import ScenarioPlayer
        _scenario_player = ScenarioPlayer(
            inject_func=lambda cid, sender, content: _do_inject(cid, sender, content),
            ws_broadcast_func=ws_broadcast,
            status_update_func=lambda: None,
        )
    return _scenario_player


def _do_inject(chat_id: str, sender_name: str, content: str) -> dict:
    """Internal inject used by scenario player (no HTTP, direct call)."""
    matched_keywords = []
    asst_config = load_assistant_config()
    config = asst_config.get("config", asst_config)
    alert_groups = config.get("alert_groups", [])
    for ag in alert_groups:
        if not ag.get("enabled", True):
            continue
        for kw in ag.get("keywords", []):
            if kw.lower() in content.lower():
                matched_keywords.append(kw)
    if matched_keywords:
        add_notification(
            notif_type="keyword_alert",
            title=f"🔔 关键词命中 — {chat_id}",
            content=f"发送人: {sender_name}\n命中关键词: {', '.join(matched_keywords)}\n消息: {content}",
            chat_id=chat_id,
            priority="high",
        )
    status.messages_processed += 1
    return {"ok": True, "keyword_hits": matched_keywords}


# ── Summarizer (lazy init) ────────────────────────────────────────────
_summarizer = None
_summarizer_lock = threading.Lock()
_bot_config: BotConfig | None = None


def get_summarizer():
    """Get or create the AI summarizer based on current config."""
    global _summarizer, _bot_config
    with _summarizer_lock:
        if _summarizer is not None:
            return _summarizer
        try:
            cfg = load_config()
            _bot_config = cfg
            from src.summarize import create_summarizer
            _summarizer = create_summarizer(cfg)
            status.update_ai(
                ok=True,
                model=cfg.ai_provider_model or cfg.deepseek_model or cfg.summarize_model,
                backend=cfg.ai_backend,
            )
            logger.info("AI backend initialized: %s", cfg.ai_backend)
            return _summarizer
        except Exception as e:
            logger.warning("Failed to initialize AI backend: %s", e)
            status.update_ai(ok=False, model="", backend="")
            return None


def reset_summarizer():
    """Reset summarizer so it will be re-created on next access."""
    global _summarizer, _bot_config
    with _summarizer_lock:
        _summarizer = None
        _bot_config = None


# ── Mock data loader ──────────────────────────────────────────────────
_mock_cache: dict[str, any] = {}


def load_mock(name: str):
    """Load a mock JSON file from mock/ directory."""
    if name not in _mock_cache:
        path = PROJECT_ROOT / "mock" / f"{name}.json"
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                _mock_cache[name] = json.load(f)
        else:
            _mock_cache[name] = None
    return _mock_cache[name]


def invalidate_mock(name: str):
    _mock_cache.pop(name, None)


# ── Assistant config ──────────────────────────────────────────────────
ASSISTANT_CONFIG_PATH = DATA_DIR / "assistant_config.json"


def load_assistant_config() -> dict:
    """Load assistant config, creating default if not exists."""
    if ASSISTANT_CONFIG_PATH.exists():
        try:
            with open(ASSISTANT_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    # Return mock default
    mock = load_mock("assistant-config")
    if mock:
        return mock
    return {"config": {"version": 1, "assistant_enabled": True, "alert_groups": [], "digest_groups": []}}


def save_assistant_config(data: dict):
    """Save assistant config to disk."""
    with open(ASSISTANT_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Notification store (in-memory for demo) ───────────────────────────
_notifications: list[dict] = []
_notif_lock = threading.Lock()
_notif_counter = 0


def add_notification(notif_type: str, title: str, content: str,
                     chat_id: str = "", group_name: str = "",
                     priority: str = "normal") -> int:
    global _notif_counter
    with _notif_lock:
        _notif_counter += 1
        notif = {
            "id": _notif_counter,
            "type": notif_type,
            "title": title,
            "content": content,
            "chat_id": chat_id,
            "group_name": group_name,
            "priority": priority,
            "status": "pending",
            "create_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "timestamp": int(time.time()),
        }
        _notifications.append(notif)
        return notif["id"]


def get_notifications(limit: int = 50, status_filter: str = "") -> list[dict]:
    with _notif_lock:
        result = list(reversed(_notifications))
        if status_filter:
            result = [n for n in result if n["status"] == status_filter]
        return result[:limit]


def ack_notification(nid: int) -> bool:
    with _notif_lock:
        for n in _notifications:
            if n["id"] == nid:
                n["status"] = "acked"
                return True
    return False


def ignore_notification(nid: int) -> bool:
    with _notif_lock:
        for n in _notifications:
            if n["id"] == nid:
                n["status"] = "ignored"
                return True
    return False


# ── HTTP Request Handler ──────────────────────────────────────────────

class DemoHandler(BaseHTTPRequestHandler):
    """Handle all HTTP requests for the demo server."""

    # Silence default logging
    def log_message(self, format, *args):
        pass  # We use our own logger

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def _read_json(self) -> dict:
        body = self._read_body()
        if body:
            return json.loads(body.decode("utf-8"))
        return {}

    def _serve_static_file(self, path: str):
        """Serve a static file from dist/ directory."""
        dist_dir = PROJECT_ROOT / "dist"
        if path == "/" or path == "":
            path = "/index.html"

        file_path = dist_dir / path.lstrip("/")

        # SPA fallback: if file doesn't exist and has no extension, serve index.html
        if not file_path.exists():
            if "." not in Path(path).name:
                file_path = dist_dir / "index.html"
            else:
                self.send_error(404)
                return

        if not file_path.exists():
            self.send_error(404)
            return

        # Security: prevent path traversal
        try:
            file_path.resolve().relative_to(dist_dir.resolve())
        except ValueError:
            self.send_error(403)
            return

        # MIME type
        suffix = file_path.suffix.lower()
        mime_types = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
        }
        mime = mime_types.get(suffix, "application/octet-stream")

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    # ── Route dispatch ────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # WebSocket upgrade
        if path == "/ws":
            self._handle_ws_upgrade()
            return

        # API routes
        if path.startswith("/api/"):
            self._handle_api_get(path, params)
            return

        # Static files
        self._serve_static_file(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self._handle_api_post(path)
            return

        self.send_error(404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self._handle_api_put(path)
            return

        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self._handle_api_delete(path)
            return

        self.send_error(404)

    # ── WebSocket upgrade ─────────────────────────────────────────────

    def _handle_ws_upgrade(self):
        """Handle WebSocket handshake (basic RFC 6455)."""
        import hashlib
        import base64
        import socket

        ws_key = self.headers.get("Sec-WebSocket-Key", "")
        if not ws_key:
            self.send_error(400, "Missing Sec-WebSocket-Key")
            return

        # Compute accept key
        magic = "258EAFA5-E914-47DA-95CA-5AB5DC8CDE5B"
        accept = base64.b64encode(
            hashlib.sha1((ws_key + magic).encode()).digest()
        ).decode()

        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        # Register client
        sock = self.connection
        with _ws_lock:
            _ws_clients.append(sock)

        # Send initial status
        try:
            payload = json.dumps(status.to_dict(), ensure_ascii=False).encode("utf-8")
            frame = _ws_encode_text_frame(payload)
            sock.sendall(frame)
        except Exception:
            pass

        # Keep connection alive, read frames (ping/pong)
        try:
            while True:
                header = sock.recv(2)
                if not header or len(header) < 2:
                    break
                opcode = header[0] & 0x0F
                if opcode == 0x8:  # close
                    break
                elif opcode == 0x9:  # ping
                    length = header[1] & 0x7F
                    if length == 126:
                        length = int.from_bytes(sock.recv(2), "big")
                    mask = sock.recv(4) if (header[1] & 0x80) else b""
                    data = sock.recv(length)
                    if mask:
                        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
                    # Send pong
                    pong = b'\x8a' + bytes([length]) + data
                    sock.sendall(pong)
                else:
                    # Skip other frames
                    length = header[1] & 0x7F
                    if length == 126:
                        length = int.from_bytes(sock.recv(2), "big")
                    elif length == 127:
                        length = int.from_bytes(sock.recv(8), "big")
                    mask = sock.recv(4) if (header[1] & 0x80) else b""
                    if length > 0:
                        sock.recv(length)
        except Exception:
            pass
        finally:
            with _ws_lock:
                if sock in _ws_clients:
                    _ws_clients.remove(sock)

    # ── GET API handlers ──────────────────────────────────────────────

    def _handle_api_get(self, path: str, params: dict):
        if path == "/api/status":
            self._send_json(status.to_dict())

        elif path == "/api/load-config":
            self._handle_load_config()

        elif path == "/api/config/export":
            self._handle_config_export()

        elif path == "/api/logs":
            self._handle_get_logs()

        elif path == "/api/chat/sessions":
            data = load_mock("chat-sessions") or {}
            # Mock JSON may already have ok/data wrapper — pass through as-is
            if isinstance(data, dict) and "ok" in data:
                self._send_json(data)
            else:
                self._send_json({"ok": True, "data": data})

        elif path == "/api/chat/messages":
            self._handle_chat_messages(params)

        elif path == "/api/chat/members":
            self._send_json({"ok": True, "members": [
                {"wxid": "wxid_demo1", "nickname": "张三", "is_friend": True},
                {"wxid": "wxid_demo2", "nickname": "李四", "is_friend": True},
                {"wxid": "wxid_demo3", "nickname": "王五", "is_friend": False},
            ]})

        elif path == "/api/chat/common-groups":
            self._send_json({"ok": True, "groups": []})

        elif path == "/api/fav/list":
            data = load_mock("favorites") or {}
            if isinstance(data, dict) and "ok" in data:
                self._send_json(data)
            else:
                self._send_json({"ok": True, "items": data, "total": len(data) if isinstance(data, list) else 0})

        elif path == "/api/fav/tags":
            self._send_json({"ok": True, "tags": load_mock("fav-tags") or []})

        elif path == "/api/sns/timeline":
            data = load_mock("moments") or {}
            if isinstance(data, dict) and "ok" in data:
                self._send_json(data)
            else:
                self._send_json({"ok": True, "items": data, "total": len(data) if isinstance(data, list) else 0})

        elif path == "/api/oa/accounts":
            self._send_json({"ok": True, "accounts": load_mock("oa-accounts") or []})

        elif path == "/api/oa/groups":
            self._send_json({"ok": True, "groups": load_mock("oa-groups") or []})

        elif path == "/api/assistant/config":
            self._send_json(load_assistant_config())

        elif path == "/api/assistant/notifications":
            limit = int(params.get("limit", [50])[0])
            self._send_json({"ok": True, "notifications": get_notifications(limit)})

        elif path == "/api/assistant/notifications/pending":
            self._send_json({"ok": True, "notifications": get_notifications(status_filter="pending")})

        elif path == "/api/nicknames/groups":
            self._send_json({"ok": True, "groups": load_mock("nickname-groups") or []})

        elif path == "/api/nicknames":
            self._send_json({"ok": True, "members": []})

        elif path == "/api/scheduler/tasks":
            self._handle_get_scheduler_tasks()

        elif path == "/api/ai/chat/history":
            self._handle_ai_chat_history(params)

        elif path == "/api/lots":
            self._send_json({"ok": True, "config": {}})

        elif path == "/api/onboarding/status":
            env_path = find_env_file()
            done = False
            if env_path and env_path.exists():
                try:
                    with open(env_path, "r", encoding="utf-8") as f:
                        for line in f:
                            if line.strip().startswith("ONBOARDING_DONE") and "true" in line.lower():
                                done = True
                                break
                except Exception:
                    pass
            self._send_json({"onboarding_done": done})

        elif path == "/api/onboarding/diagnose":
            self._handle_onboarding_diagnose()

        elif path == "/api/wechat-data-dir/detect":
            self._send_json({"found": True, "accounts": [{"wxid": "wxid_demo", "nickname": "Demo用户"}]})

        elif path == "/api/browse":
            self._send_json({"ok": True, "entries": [], "current_path": "C:\\"})

        elif path == "/api/ilink/status":
            self._send_json({"bound": False, "error": "Demo 模式不支持 iLink 绑定"})

        elif path == "/api/ilink/qrcode":
            self._send_json({"error": "Demo 模式不支持 iLink 绑定"})

        # Image/voice placeholders
        elif path.startswith("/api/image/") or path.startswith("/api/chat/image") or path.startswith("/api/fav/image"):
            self._send_svg_placeholder()
        elif path.startswith("/api/voice") or path.startswith("/api/fav/voice"):
            self.send_error(404, "Demo mode: no voice data")
        elif path.startswith("/api/sns/video"):
            self.send_error(404, "Demo mode: no video data")

        else:
            self._send_json({"ok": True, "error": f"Unknown endpoint: {path}"})

    # ── POST API handlers ─────────────────────────────────────────────

    def _handle_api_post(self, path: str):
        if path == "/api/start":
            self._handle_bot_start()
        elif path == "/api/stop":
            self._handle_bot_stop()
        elif path == "/api/config":
            self._handle_save_config()
        elif path == "/api/config/import":
            self._handle_config_import()
        elif path == "/api/ai/chat/start":
            self._handle_ai_chat_start()
        elif path == "/api/ai/chat/message":
            self._handle_ai_chat_message()
        elif path == "/api/ai/chat/compress":
            self._handle_ai_chat_compress()
        elif path == "/api/ai/chat/destroy":
            self._handle_ai_chat_destroy()
        elif path == "/api/assistant/ai/detect":
            self._handle_ai_detect()
        elif path == "/api/assistant/digest/run":
            self._handle_digest_run()
        elif path == "/api/oa/digest/run":
            self._handle_oa_digest_run()
        elif path == "/api/sandbox/test":
            self._handle_sandbox_test()
        elif path == "/api/assistant/notifications/test":
            self._handle_notification_test()
        elif path.startswith("/api/assistant/notifications/") and path.endswith("/ack"):
            nid = int(path.split("/")[-2])
            ack_notification(nid)
            self._send_json({"ok": True})
        elif path.startswith("/api/assistant/notifications/") and path.endswith("/ignore"):
            nid = int(path.split("/")[-2])
            ignore_notification(nid)
            self._send_json({"ok": True})
        elif path == "/api/chat/export":
            self._send_json({"ok": True, "error": "Demo 模式不支持导出"})
        elif path == "/api/fav/export":
            self._send_json({"ok": True, "error": "Demo 模式不支持导出"})
        elif path == "/api/export/open-folder":
            self._send_json({"ok": True, "path": "/demo"})
        elif path.startswith("/api/onboarding/step"):
            self._handle_onboarding_step(path)
        elif path == "/api/onboarding/reset":
            # Remove ONBOARDING_DONE from .env so onboarding shows again
            env_path = find_env_file()
            if env_path and env_path.exists():
                try:
                    with open(env_path, "r", encoding="utf-8") as f:
                        lines = f.readlines()
                    with open(env_path, "w", encoding="utf-8") as f:
                        for line in lines:
                            if not line.strip().startswith("ONBOARDING_DONE"):
                                f.write(line)
                except Exception:
                    pass
            self._send_json({"ok": True})
        elif path == "/api/scheduler/tasks":
            self._handle_create_scheduler_task()
        elif path == "/api/demo/inject-message":
            self._handle_inject_message()
        elif path == "/api/demo/scenario/start":
            self._handle_scenario_start()
        elif path == "/api/demo/scenario/stop":
            self._handle_scenario_stop()
        else:
            self._send_json({"ok": True, "error": f"Unknown endpoint: {path}"})

    # ── PUT API handlers ──────────────────────────────────────────────

    def _handle_api_put(self, path: str):
        if path == "/api/assistant/config":
            data = self._read_json()
            save_assistant_config(data)
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": True})

    # ── DELETE API handlers ───────────────────────────────────────────

    def _handle_api_delete(self, path: str):
        if path.startswith("/api/scheduler/tasks/"):
            self._handle_delete_scheduler_task(path)
        else:
            self._send_json({"ok": True})

    # ── Implementation: Bot control ───────────────────────────────────

    def _handle_bot_start(self):
        try:
            status.start()
            # Try to initialize AI backend (non-blocking — don't crash if no key)
            try:
                summ = get_summarizer()
                if summ:
                    status.update_ai(ok=True, model=getattr(summ, 'model', 'unknown'),
                                   backend=getattr(summ, '_backend_name', 'unknown'))
                else:
                    status.update_ai(ok=False, model="", backend="")
            except Exception as e:
                logger.warning("AI init failed in bot start: %s", e)
                status.update_ai(ok=False, model="", backend="")

            # Set group count from mock data
            sessions_data = load_mock("chat-sessions") or {}
            if isinstance(sessions_data, dict) and "data" in sessions_data:
                sessions_list = sessions_data["data"]
            elif isinstance(sessions_data, list):
                sessions_list = sessions_data
            else:
                sessions_list = []
            status.group_count = len([s for s in sessions_list if s.get("local_type") == 2])

            ws_broadcast(status.to_dict())

            # Start digest scheduler
            try:
                start_digest_scheduler()
            except Exception as e:
                logger.warning("Failed to start digest scheduler: %s", e)

            self._send_json({"ok": True})
        except Exception as e:
            logger.error("Bot start error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    def _handle_bot_stop(self):
        status.stop()
        stop_digest_scheduler()
        ws_broadcast(status.to_dict())
        self._send_json({"ok": True})

    # ── Implementation: Config ────────────────────────────────────────

    def _handle_load_config(self):
        env_path = find_env_file()
        if env_path and env_path.exists():
            try:
                cfg = load_config()
                config_dict = {
                    "ai_backend": cfg.ai_backend,
                    "deepseek_api_key": cfg.deepseek_api_key[:8] + "••••" if cfg.deepseek_api_key else "",
                    "deepseek_base_url": cfg.deepseek_base_url,
                    "deepseek_model": cfg.deepseek_model,
                    "anthropic_api_key": cfg.anthropic_api_key[:8] + "••••" if cfg.anthropic_api_key else "",
                    "anthropic_base_url": cfg.anthropic_base_url,
                    "summarize_model": cfg.summarize_model,
                    "ai_provider_base_url": cfg.ai_provider_base_url,
                    "ai_provider_api_key": cfg.ai_provider_api_key[:8] + "••••" if cfg.ai_provider_api_key else "",
                    "ai_provider_type": cfg.ai_provider_type,
                    "ai_provider_model": cfg.ai_provider_model,
                    "bot_display_name": cfg.bot_display_name,
                    "wechat_backend": "demo",
                    "wechat_groups": "*",
                    "log_level": cfg.log_level,
                }
                self._send_json({"ok": True, "config": config_dict})
                return
            except Exception as e:
                logger.warning("Failed to load config: %s", e)

        # Fallback to mock config
        mock = load_mock("config")
        if mock:
            self._send_json(mock)
        else:
            self._send_json({"ok": True, "config": {}})

    def _handle_save_config(self):
        data = self._read_json()
        config = data.get("config", data)

        # Map frontend field names to .env keys
        env_updates = {}
        field_map = {
            "ai_backend": "AI_BACKEND",
            "deepseek_api_key": "DEEPSEEK_API_KEY",
            "deepseek_base_url": "DEEPSEEK_BASE_URL",
            "deepseek_model": "DEEPSEEK_MODEL",
            "anthropic_api_key": "ANTHROPIC_API_KEY",
            "anthropic_base_url": "ANTHROPIC_BASE_URL",
            "summarize_model": "SUMMARIZE_MODEL",
            "ai_provider_base_url": "AI_PROVIDER_BASE_URL",
            "ai_provider_api_key": "AI_PROVIDER_API_KEY",
            "ai_provider_type": "AI_PROVIDER_TYPE",
            "ai_provider_model": "AI_PROVIDER_MODEL",
            "bot_display_name": "BOT_DISPLAY_NAME",
            "wechat_groups": "WECHAT_GROUPS",
            "log_level": "LOG_LEVEL",
        }

        bool_fields = {
            "fun_enabled": "FUN_ENABLED",
            "proactive_enabled": "PROACTIVE_ENABLED",
            "summarize_enabled": "SUMMARIZE_ENABLED",
            "memory_consolidation_enabled": "MEMORY_CONSOLIDATION_ENABLED",
        }

        for frontend_key, env_key in field_map.items():
            if frontend_key in config:
                val = config[frontend_key]
                if val is not None:
                    env_updates[env_key] = str(val)

        for frontend_key, env_key in bool_fields.items():
            if frontend_key in config:
                val = config[frontend_key]
                env_updates[env_key] = "true" if val else "false"

        if env_updates:
            env_path = find_env_file() or (DATA_DIR / ".env")
            try:
                write_env_atomic(env_path, env_updates)
                # Reset summarizer so it picks up new config
                reset_summarizer()
                logger.info("Config saved: %s", list(env_updates.keys()))
            except Exception as e:
                logger.error("Failed to save config: %s", e)
                self._send_json({"ok": False, "error": str(e)})
                return

        self._send_json({"ok": True, "saved": list(env_updates.keys()), "requires_restart": True})

    def _handle_config_export(self):
        """Export current config as JSON for backup."""
        try:
            cfg = load_config()
            export = {
                "ai_backend": cfg.ai_backend,
                "deepseek_api_key": cfg.deepseek_api_key,
                "deepseek_base_url": cfg.deepseek_base_url,
                "deepseek_model": cfg.deepseek_model,
                "anthropic_api_key": cfg.anthropic_api_key,
                "anthropic_base_url": cfg.anthropic_base_url,
                "summarize_model": cfg.summarize_model,
                "ai_provider_base_url": cfg.ai_provider_base_url,
                "ai_provider_api_key": cfg.ai_provider_api_key,
                "ai_provider_type": cfg.ai_provider_type,
                "ai_provider_model": cfg.ai_provider_model,
                "bot_display_name": cfg.bot_display_name,
                "wechat_backend": "demo",
                "wechat_groups": "*",
                "log_level": cfg.log_level,
                "demo_mode": True,
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition", "attachment; filename=wx-assist-demo-config.json")
            self.end_headers()
            self.wfile.write(json.dumps(export, ensure_ascii=False, indent=2).encode("utf-8"))
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)})

    def _handle_config_import(self):
        """Import config from JSON backup."""
        try:
            data = self._read_json()
            # Write imported values to .env
            env_updates = {}
            field_map = {
                "ai_backend": "AI_BACKEND",
                "deepseek_api_key": "DEEPSEEK_API_KEY",
                "deepseek_base_url": "DEEPSEEK_BASE_URL",
                "deepseek_model": "DEEPSEEK_MODEL",
                "anthropic_api_key": "ANTHROPIC_API_KEY",
                "anthropic_base_url": "ANTHROPIC_BASE_URL",
                "summarize_model": "SUMMARIZE_MODEL",
                "ai_provider_base_url": "AI_PROVIDER_BASE_URL",
                "ai_provider_api_key": "AI_PROVIDER_API_KEY",
                "ai_provider_type": "AI_PROVIDER_TYPE",
                "ai_provider_model": "AI_PROVIDER_MODEL",
                "bot_display_name": "BOT_DISPLAY_NAME",
                "wechat_groups": "WECHAT_GROUPS",
                "log_level": "LOG_LEVEL",
            }
            for k, env_key in field_map.items():
                if k in data and data[k]:
                    env_updates[env_key] = str(data[k])
            if env_updates:
                env_path = find_env_file() or (DATA_DIR / ".env")
                write_env_atomic(env_path, env_updates)
                reset_summarizer()
            self._send_json({"ok": True, "imported": list(env_updates.keys())})
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)})

    # ── Implementation: AI Chat ───────────────────────────────────────

    def _handle_ai_chat_start(self):
        global _ai_session_counter
        data = self._read_json()

        with _ai_session_lock:
            _ai_session_counter += 1
            session_id = f"demo-session-{_ai_session_counter}"

        session = {
            "id": session_id,
            "messages": [],
            "chat_id": data.get("chat_id", ""),
            "context_type": data.get("context_type", "group"),  # group | private | favorite
            "context_text": data.get("context_text", ""),
            "created_at": time.time(),
        }

        with _ai_session_lock:
            _ai_sessions[session_id] = session

        self._send_json({
            "ok": True,
            "session_id": session_id,
            "messages": [],
            "token_usage": {"used": 0, "limit": 100000},
        })

    def _handle_ai_chat_message(self):
        """SSE streaming AI chat — real AI call if available, fallback to mock."""
        data = self._read_json()
        session_id = data.get("session_id", "")
        user_message = data.get("message", "")

        with _ai_session_lock:
            session = _ai_sessions.get(session_id)
            if session is None:
                self._send_json({"ok": False, "error": "Session not found"})
                return
            session["messages"].append({"role": "user", "content": user_message})

        # Try real AI
        summ = get_summarizer()

        if summ:
            self._stream_ai_response(summ, session, user_message)
        else:
            self._stream_mock_response(user_message)

    def _stream_ai_response(self, summarizer, session: dict, user_message: str):
        """Stream real AI response via SSE."""
        # Build system prompt based on context type
        from src.summarize.prompts import (
            GROUP_CHAT_SYSTEM_PROMPT, PRIVATE_CHAT_SYSTEM_PROMPT,
            FAV_CHAT_SYSTEM_PROMPT, COMPRESSION_PROMPT,
        )

        context_type = session.get("context_type", "group")
        context_text = session.get("context_text", "")

        if context_type == "favorite":
            system_prompt = FAV_CHAT_SYSTEM_PROMPT.format(context_text=context_text)
        elif context_type == "private":
            contact_name = session.get("chat_id", "好友")
            msg_count = len(session["messages"])
            system_prompt = PRIVATE_CHAT_SYSTEM_PROMPT.format(
                contact_name=contact_name, message_count=msg_count,
                context_text=context_text,
            )
        else:
            group_name = session.get("chat_id", "群聊")
            msg_count = len(session["messages"])
            system_prompt = GROUP_CHAT_SYSTEM_PROMPT.format(
                group_name=group_name, message_count=msg_count,
                context_text=context_text,
            )

        # Build messages list (include history)
        api_messages = []
        for msg in session["messages"]:
            api_messages.append({"role": msg["role"], "content": msg["content"]})

        # Send SSE headers
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._send_cors_headers()
        self.end_headers()

        # Stream tokens
        full_response = ""
        try:
            for token in summarizer._call_chat_api_stream(system_prompt, api_messages):
                full_response += token
                # SSE format: event: token\ndata: "text"\n\n
                event = f"event: token\ndata: {json.dumps(token, ensure_ascii=False)}\n\n"
                self.wfile.write(event.encode("utf-8"))
                self.wfile.flush()

            # Save assistant response to session
            with _ai_session_lock:
                if session["id"] in _ai_sessions:
                    _ai_sessions[session["id"]]["messages"].append(
                        {"role": "assistant", "content": full_response}
                    )

            # Send done event
            done_event = f"event: done\ndata: {json.dumps('', ensure_ascii=False)}\n\n"
            self.wfile.write(done_event.encode("utf-8"))
            self.wfile.flush()

            # Update status
            status.last_api_call_time = time.time()
            status.messages_processed += 1

        except Exception as e:
            logger.error("AI streaming error: %s", e)
            error_event = f"event: error\ndata: {json.dumps(str(e), ensure_ascii=False)}\n\n"
            try:
                self.wfile.write(error_event.encode("utf-8"))
                self.wfile.flush()
            except Exception:
                pass

    def _stream_mock_response(self, user_message: str):
        """Fallback: stream a mock response character by character."""
        responses = load_mock("ai-responses") or ["这是 Demo 模式的模拟回复。配置 AI 后端后可获得真实 AI 对话。"]
        import random
        response_text = random.choice(responses)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._send_cors_headers()
        self.end_headers()

        for char in response_text:
            event = f"event: token\ndata: {json.dumps(char, ensure_ascii=False)}\n\n"
            self.wfile.write(event.encode("utf-8"))
            self.wfile.flush()
            time.sleep(0.03)

        done_event = f"event: done\ndata: {json.dumps('', ensure_ascii=False)}\n\n"
        self.wfile.write(done_event.encode("utf-8"))
        self.wfile.flush()

    def _handle_ai_chat_compress(self):
        data = self._read_json()
        session_id = data.get("session_id", "")

        with _ai_session_lock:
            session = _ai_sessions.get(session_id)
            if session and len(session["messages"]) > 4:
                # Simple compression: keep first 2 and last 2 messages
                old_count = len(session["messages"])
                session["messages"] = session["messages"][:2] + session["messages"][-2:]
                new_count = len(session["messages"])
                self._send_json({"ok": True, "compressed_from": old_count, "compressed_to": new_count})
                return

        self._send_json({"ok": True, "compressed_from": 0, "compressed_to": 0})

    def _handle_ai_chat_destroy(self):
        data = self._read_json()
        session_id = data.get("session_id", "")
        with _ai_session_lock:
            _ai_sessions.pop(session_id, None)
        self._send_json({"ok": True})

    def _handle_ai_chat_history(self, params: dict):
        session_id = params.get("session_id", [""])[0]
        with _ai_session_lock:
            session = _ai_sessions.get(session_id)
            if session:
                self._send_json({"ok": True, "messages": session["messages"]})
            else:
                self._send_json({"ok": True, "messages": []})

    # ── Implementation: AI Provider detection ─────────────────────────

    def _handle_ai_detect(self):
        data = self._read_json()
        base_url = data.get("base_url", "").strip()
        api_key = data.get("api_key", "").strip()

        if not base_url or not api_key:
            self._send_json({"ok": False, "error": "请填写站点 URL 和 API Key"})
            return

        try:
            from src.summarize.provider_detector import detect_provider
            info = detect_provider(base_url, api_key)
            self._send_json({
                "ok": True,
                "provider_type": info.provider_type,
                "available_models": info.available_models,
                "error": info.error,
            })
        except Exception as e:
            logger.error("Provider detection failed: %s", e)
            self._send_json({"ok": False, "error": str(e)})

    # ── Implementation: Sandbox test ──────────────────────────────────

    def _handle_sandbox_test(self):
        data = self._read_json()
        prompt = data.get("prompt", "你好")
        system_prompt = data.get("system_prompt", "你是一个友好的AI助手。")

        summ = get_summarizer()
        if summ:
            try:
                result = summ._call_chat_api(
                    system_prompt,
                    [{"role": "user", "content": prompt}],
                )
                status.last_api_call_time = time.time()
                self._send_json({"ok": True, "reply": result})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)})
        else:
            self._send_json({"ok": False, "error": "AI 后端未配置，请先在配置面板设置 API Key"})

    # ── Implementation: Digest run ────────────────────────────────────

    def _handle_digest_run(self):
        data = self._read_json()
        chat_id = data.get("chat_id", "")

        summ = get_summarizer()
        if not summ:
            self._send_json({"ok": False, "error": "AI 后端未配置"})
            return

        # Get mock messages for this chat
        all_messages = load_mock("chat-messages") or {}
        messages = all_messages.get(chat_id, [])
        if not messages:
            # Try any available messages
            for k, v in all_messages.items():
                if v:
                    messages = v
                    break

        if not messages:
            self._send_json({"ok": False, "error": "没有可用的消息数据"})
            return

        try:
            # Convert mock messages to the format expected by summarizer
            summary_messages = []
            for msg in messages[:200]:  # limit to 200 messages
                summary_messages.append({
                    "sender_name": msg.get("sender_name", "unknown"),
                    "content": msg.get("content", ""),
                    "timestamp": msg.get("create_time", int(time.time())),
                    "msg_type": msg.get("localType", 1),
                })

            result = summ.summarize(summary_messages, "Demo用户")
            status.last_api_call_time = time.time()

            # Create notification
            add_notification(
                notif_type="digest",
                title="📋 群聊摘要",
                content=result.summary_text,
                chat_id=chat_id,
                priority="normal",
            )

            self._send_json({
                "ok": True,
                "summary": result.summary_text,
                "topics": result.topics,
            })
        except Exception as e:
            logger.error("Digest failed: %s", e)
            self._send_json({"ok": False, "error": str(e)})

    # ── Implementation: Notification test ─────────────────────────────

    def _handle_notification_test(self):
        nid = add_notification(
            notif_type="test",
            title="🧪 测试通知",
            content="这是一条测试通知，用于验证通知系统工作正常。",
            priority="normal",
        )
        ws_broadcast({"event": "notification", "id": nid})
        self._send_json({"ok": True, "id": nid})

    # ── Implementation: Scheduler tasks ───────────────────────────────

    def _handle_get_scheduler_tasks(self):
        asst_config = load_assistant_config()
        config = asst_config.get("config", asst_config)
        digest_groups = config.get("digest_groups", [])

        tasks = []
        for i, dg in enumerate(digest_groups):
            tasks.append({
                "id": f"digest-{i}",
                "type": "digest",
                "name": f"摘要: {dg.get('group_name', '未知群')}",
                "chat_id": dg.get("chat_id", ""),
                "group_name": dg.get("group_name", ""),
                "schedule": dg.get("schedule", []),
                "cron_expr": dg.get("cron_expr", ""),
                "enabled": dg.get("enabled", True),
                "lookback_hours": dg.get("lookback_hours", 6),
            })

        self._send_json({"ok": True, "tasks": tasks})

    def _handle_create_scheduler_task(self):
        data = self._read_json()
        asst_config = load_assistant_config()
        config = asst_config.get("config", asst_config)

        if "digest_groups" not in config:
            config["digest_groups"] = []

        new_group = {
            "chat_id": data.get("chat_id", ""),
            "group_name": data.get("group_name", "新群聊"),
            "schedule": data.get("schedule", ["09:00"]),
            "cron_expr": data.get("cron_expr", "0 9 * * *"),
            "lookback_hours": data.get("lookback_hours", 6),
            "enabled": data.get("enabled", True),
            "unread_only": True,
            "push_target": "",
            "profile": {
                "purpose": "",
                "description": "",
                "focus": [],
                "ignore": [],
                "style": "",
                "custom_prompt": "",
            },
        }

        config["digest_groups"].append(new_group)
        asst_config["config"] = config
        save_assistant_config(asst_config)

        self._send_json({"ok": True})

    def _handle_delete_scheduler_task(self, path: str):
        # Extract task index from path like /api/scheduler/tasks/digest-0
        task_id = path.split("/")[-1]
        if task_id.startswith("digest-"):
            try:
                idx = int(task_id.split("-")[1])
                asst_config = load_assistant_config()
                config = asst_config.get("config", asst_config)
                digest_groups = config.get("digest_groups", [])
                if 0 <= idx < len(digest_groups):
                    digest_groups.pop(idx)
                    config["digest_groups"] = digest_groups
                    asst_config["config"] = config
                    save_assistant_config(asst_config)
            except (ValueError, IndexError):
                pass

        self._send_json({"ok": True})

    # ── Implementation: Chat messages ─────────────────────────────────

    def _handle_chat_messages(self, params: dict):
        talker = params.get("talker", [""])[0]
        all_messages = load_mock("chat-messages") or {}
        messages = all_messages.get(talker, [])
        self._send_json({"ok": True, "messages": messages, "total": len(messages)})

    # ── Implementation: Logs ──────────────────────────────────────────

    def _handle_get_logs(self):
        log_path = DATA_DIR / "demo.log"
        lines = []
        if log_path.exists():
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()[-500:]
            except Exception:
                pass

        # Format as the frontend LogViewer expects:
        # { ts, level, msg, raw }
        import re
        log_entries = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Parse log format: 2026-06-23 12:00:00 [INFO] name: message
            m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.*?): (.*)", line)
            if m:
                ts = m.group(1)
                # Shorten timestamp to HH:MM:SS for frontend display
                ts_short = ts.split(" ")[1] if " " in ts else ts
                log_entries.append({
                    "ts": ts_short,
                    "level": m.group(2),
                    "msg": f"[{m.group(3)}] {m.group(4)}",
                    "raw": line,
                })
            else:
                log_entries.append({
                    "ts": "",
                    "level": "INFO",
                    "msg": line,
                    "raw": line,
                })

        self._send_json({"ok": True, "logs": log_entries})

    # ── Implementation: Onboarding ────────────────────────────────────

    def _handle_onboarding_diagnose(self):
        self._send_json({
            "ok": True,
            "diagnostics": {
                "python": {"ok": True, "value": f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"},
                "requirements": {"ok": True, "missing": [], "value": "依赖已安装"},
                "wechat": {"ok": True, "value": "Demo 模式：不需要微信"},
                "env": {"ok": True, "value": str(find_env_file() or "未创建")},
                "db": {"ok": True, "value": "Demo 模式：使用模拟数据"},
            },
        })

    def _handle_onboarding_step(self, path: str):
        data = self._read_json()
        step = path.rstrip("/").split("/")[-1]

        if step == "step1":
            # Demo: skip WCDB key extraction
            self._send_json({"ok": True, "message": "Demo 模式：跳过密钥提取"})
        elif step == "step2":
            # Save identity config
            env_updates = {}
            if "bot_display_name" in data:
                env_updates["BOT_DISPLAY_NAME"] = data["bot_display_name"]
            if env_updates:
                env_path = find_env_file() or (DATA_DIR / ".env")
                write_env_atomic(env_path, env_updates)
            self._send_json({"ok": True})
        elif step == "step3":
            # Save AI config and test connectivity
            env_updates = {}
            field_map = {
                "ai_provider_base_url": "AI_PROVIDER_BASE_URL",
                "ai_provider_api_key": "AI_PROVIDER_API_KEY",
                "ai_provider_type": "AI_PROVIDER_TYPE",
                "ai_provider_model": "AI_PROVIDER_MODEL",
                "ai_backend": "AI_BACKEND",
                "deepseek_api_key": "DEEPSEEK_API_KEY",
                "anthropic_api_key": "ANTHROPIC_API_KEY",
            }
            for k, v in field_map.items():
                if k in data and data[k]:
                    env_updates[v] = str(data[k])

            if env_updates:
                env_path = find_env_file() or (DATA_DIR / ".env")
                write_env_atomic(env_path, env_updates)
                reset_summarizer()

            # Try to verify AI connectivity
            verified = False
            error = ""
            try:
                summ = get_summarizer()
                if summ:
                    verified = True
            except Exception as e:
                error = str(e)

            self._send_json({"ok": True, "verified": verified, "error": error})
        elif step == "step4":
            # Mark onboarding done
            env_path = find_env_file() or (DATA_DIR / ".env")
            write_env_atomic(env_path, {"ONBOARDING_DONE": "true"})
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": True})

    # ── Implementation: Message injection (demo-specific) ─────────────

    def _handle_inject_message(self):
        """Inject a message into the mock data stream for testing."""
        try:
            data = self._read_json()
            chat_id = data.get("chat_id", "")
            sender_name = data.get("sender_name", "测试用户")
            content = data.get("content", "")

            if not content:
                self._send_json({"ok": False, "error": "消息内容不能为空"})
                return

            # Check keywords
            asst_config = load_assistant_config()
            config = asst_config.get("config", asst_config)
            alert_groups = config.get("alert_groups", [])

            matched_keywords = []
            for ag in alert_groups:
                if not ag.get("enabled", True):
                    continue
                for kw in ag.get("keywords", []):
                    if kw.lower() in content.lower():
                        matched_keywords.append(kw)

            if matched_keywords:
                nid = add_notification(
                    notif_type="keyword_alert",
                    title=f"🔔 关键词命中 — {chat_id}",
                    content=f"发送人: {sender_name}\n命中关键词: {', '.join(matched_keywords)}\n消息: {content}",
                    chat_id=chat_id,
                    priority="high",
                )
                ws_broadcast({"event": "keyword_alert", "id": nid, "keywords": matched_keywords})

            status.messages_processed += 1
            ws_broadcast(status.to_dict())

            self._send_json({
                "ok": True,
                "keyword_hits": matched_keywords,
                "notification_created": len(matched_keywords) > 0,
            })
        except Exception as e:
            logger.error("Inject message error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    # ── Implementation: OA Digest (real AI) ───────────────────────────

    def _handle_oa_digest_run(self):
        """Generate OA article digest using real AI with mock article data."""
        try:
            data = self._read_json()
            account_id = data.get("account_id", "")
            template = data.get("template", "default")

            summ = get_summarizer()
            if not summ:
                self._send_json({"ok": False, "error": "AI 后端未配置"})
                return

            # Mock OA articles
            mock_articles = [
                {"title": "GPT-5 发布：多模态能力大幅提升", "content": "OpenAI 今日发布 GPT-5，在视觉、语音和代码生成方面均有显著提升。新模型支持 1M token 上下文窗口，推理速度提升 3 倍。"},
                {"title": "Rust 2026 Edition 正式发布", "content": "Rust 2026 Edition 带来了更完善的异步支持、改进的错误处理宏，以及新的 cargo 子命令。社区反响热烈。"},
                {"title": "Python 3.14 性能提升 40%", "content": "Python 3.14 通过新的 JIT 编译器和优化字节码，在基准测试中性能提升约 40%。no-GIL 实验特性也取得进展。"},
                {"title": "WebAssembly 组件模型 1.0 发布", "content": "W3C 正式发布 WebAssembly 组件模型 1.0 规范，为 Wasm 生态带来标准化的接口定义和跨语言互操作能力。"},
                {"title": "Kubernetes 2.0 架构预览", "content": "CNCF 发布 Kubernetes 2.0 架构预览，引入声明式 API v2、原生 eBPF 支持，以及更轻量的控制平面。"},
            ]

            # Build prompt
            articles_text = "\n\n".join(
                f"## {a['title']}\n{a['content']}" for a in mock_articles
            )

            template_prompts = {
                "default": "你是公众号文章摘要助手。请用中文对以下文章生成简洁摘要，每篇2-3句话，突出核心观点。",
                "tech": "你是技术文章摘要助手。请用中文对以下技术文章生成摘要，重点标注技术栈、版本号、性能数据。",
                "entertainment": "你是内容摘要助手。请用轻松的语气对以下文章生成摘要，可以适当加入评论。",
                "business": "你是商业分析助手。请从商业角度对以下文章生成摘要，分析行业趋势和投资机会。",
                "news": "你是新闻摘要助手。请用新闻简报格式对以下文章生成摘要，按重要性排序。",
            }

            system_prompt = template_prompts.get(template, template_prompts["default"])
            user_prompt = f"以下是最新的公众号文章：\n\n{articles_text}"

            result_text = summ._call_long_api(
                system_prompt,
                [{"role": "user", "content": user_prompt}],
                max_tokens=2000,
                temperature=0.3,
            )
            status.last_api_call_time = time.time()

            # Create notification
            add_notification(
                notif_type="oa_digest",
                title="📰 公众号摘要",
                content=result_text,
                priority="normal",
            )

            # Broadcast
            ws_broadcast({
                "event": "oa_digest_result",
                "template": template,
                "summary": result_text[:500],
            })

            self._send_json({
                "ok": True,
                "message": "已生成公众号摘要",
                "articles_count": len(mock_articles),
                "summary": result_text,
            })

        except Exception as e:
            logger.error("OA digest error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    # ── Implementation: Scenario playback ─────────────────────────────

    def _handle_scenario_start(self):
        """Start a scenario playback."""
        try:
            data = self._read_json()
            chat_id = data.get("chat_id", "12345678@chatroom")
            speed = data.get("speed", "fast")
            scenario_name = data.get("scenario", "default")

            player = get_scenario_player()
            result = player.start(scenario_name, chat_id, speed=speed)
            self._send_json(result)
        except Exception as e:
            logger.error("Scenario start error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    def _handle_scenario_stop(self):
        """Stop scenario playback."""
        try:
            player = get_scenario_player()
            player.stop()
            self._send_json({"ok": True})
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)})

    # ── SVG placeholder ───────────────────────────────────────────────

    def _send_svg_placeholder(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#f0f0f0" width="200" height="200"/><text x="100" y="100" text-anchor="middle" fill="#999" font-size="14">Demo</text></svg>'
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(svg)))
        self.end_headers()
        self.wfile.write(svg)


# ── Demo digest scheduler ─────────────────────────────────────────────
_digest_scheduler = None


def start_digest_scheduler():
    """Start the digest scheduler if not already running."""
    global _digest_scheduler
    if _digest_scheduler is not None:
        return

    from src.demo.digest_scheduler import DemoDigestScheduler

    _digest_scheduler = DemoDigestScheduler(
        mock_messages_func=lambda: load_mock("chat-messages") or {},
        add_notification_func=add_notification,
        ws_broadcast_func=ws_broadcast,
        get_summarizer_func=get_summarizer,
        load_assistant_config_func=load_assistant_config,
        server_status=status,
    )
    _digest_scheduler.start()
    logger.info("Digest scheduler started")


def stop_digest_scheduler():
    """Stop the digest scheduler."""
    global _digest_scheduler
    if _digest_scheduler:
        _digest_scheduler.stop()
        _digest_scheduler = None


# ── Status broadcast thread ───────────────────────────────────────────

def _status_broadcast_loop():
    """Periodically broadcast status to WebSocket clients."""
    while True:
        time.sleep(5)
        if _ws_clients:
            ws_broadcast(status.to_dict())


# ── Main ──────────────────────────────────────────────────────────────

def main():
    host = "127.0.0.1"
    port = 7327

    server = ThreadingHTTPServer((host, port), DemoHandler)
    logger.info("wx-assist-demo server starting on http://%s:%d", host, port)
    print(f"wx-assist-demo server running at http://{host}:{port}")
    print("Press Ctrl+C to stop")

    # Start status broadcast thread
    broadcast_thread = threading.Thread(target=_status_broadcast_loop, daemon=True)
    broadcast_thread.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
