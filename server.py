"""wx-assist-demo — Python backend server.

Replaces the Node.js mock server with real AI integration,
real config persistence, and real scheduling — all without WeChat.

Usage:
    python server.py
    # Visit http://127.0.0.1:7328
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

# ── Online-demo mode ──────────────────────────────────────────────────
# When ONLINE_DEMO=true, all write endpoints become no-op to prevent
# any user from modifying server-side data (config, mock data, scheduler).
ONLINE_DEMO = os.getenv("ONLINE_DEMO", "").lower() in ("true", "1", "yes")

# ── AI Chat sessions ──────────────────────────────────────────────────
_ai_sessions: dict[str, dict] = {}  # session_id -> {messages, summarizer, ...}
_ai_session_lock = threading.Lock()
_ai_session_counter = 0

# ── Server status ─────────────────────────────────────────────────────
class ServerStatus:
    """Thread-safe status holder, mirrors webot-main's _ServerStatus."""

    def __init__(self):
        self.running = True          # Demo: always running
        self.uptime_sec = 0
        self.messages_processed = 42 # Demo: fake some activity
        self.wechat_backend = "demo"
        self.ai_backend = "deepseek"
        self.db_ok = True
        self.wechat_online = True   # Demo: always online
        self.ai_ok = True           # Demo: always ok
        self.ai_verified = True
        self.model_name = "demo-mode"
        self.group_count = 4
        self.last_api_call_sec_ago = 12
        self.last_api_call_time = time.time() - 12
        self.error = ""
        self._start_time = time.time()
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


# ── iLink push ─────────────────────────────────────────────────────────

def get_ilink_push():
    """Get the global ILinkPush singleton."""
    from src.demo.ilink_push import get_ilink_push as _get
    return _get()


def _do_inject(chat_id: str, sender_name: str, content: str) -> dict:
    """Inject: add message to mock data so ChatTab shows it + optional keyword alert."""
    # 1. Add message to mock chat-messages
    all_messages = load_mock("chat-messages") or {}
    messages = all_messages.get(chat_id, [])
    messages.append({
        "local_id": int(time.time() * 1000),
        "localType": 1,
        "sender": "wxid_injected",
        "sender_name": sender_name,
        "sender_avatar": f"https://i.pravatar.cc/40?u={sender_name}",
        "is_self": sender_name == "我",
        "content": content,
        "create_time": int(time.time()),
    })
    all_messages[chat_id] = messages
    _mock_cache["chat-messages"] = all_messages

    # 2. Keyword check — only if global switch is on
    matched_keywords = []
    asst_config = load_assistant_config()
    config = asst_config.get("config", asst_config)
    if config.get("keyword_alert_enabled", True):
        alert_groups = config.get("alert_groups", [])
        for ag in alert_groups:
            if not ag.get("enabled", True):
                continue
            if ag.get("chat_id") and ag["chat_id"] != chat_id:
                continue
            for kw in ag.get("keywords", []):
                if kw.lower() in content.lower():
                    matched_keywords.append(kw)
    if matched_keywords:
        add_notification(
            notif_type="keyword_alert",
            title="\U0001f514 关键词命中",
            content=f"群: {chat_id}\n发送人: {sender_name}\n命中: {', '.join(matched_keywords)}\n消息: {content}",
            chat_id=chat_id,
            priority="high",
        )
        logger.info("Keyword hit in %s: sender=%s, keywords=%s, message=%.50s",
                    chat_id, sender_name, matched_keywords, content[:50])
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
    """Load assistant config.

    Online-demo mode: always reads from in-memory cache (which starts
    from mock data, and gets updated by save_assistant_config).
    Never reads from disk.
    """
    # Check in-memory cache first (updated by save_assistant_config)
    cached = _mock_cache.get("assistant-config")
    if cached:
        return cached
    # Load mock default and cache it
    mock = load_mock("assistant-config")
    if mock:
        _mock_cache["assistant-config"] = mock
        return mock
    # Return default with preset keyword alert for demo
    default = {"config": {"version": 1, "assistant_enabled": True, "keyword_alert_enabled": True, "alert_groups": [
        {"chat_id": "12345678@chatroom", "group_name": "技术交流群", "keywords": ["BUG", "线上问题"], "enabled": True},
    ], "digest_groups": [], "notification_queue": {"enabled": True, "retention_hours": 24}, "outbox_retention_hours": 24}}
    _mock_cache["assistant-config"] = default
    return default


def save_assistant_config(data: dict):
    """Online-demo mode: config changes are in-memory only, not persisted to disk.

    This means every deploy / restart resets all users' configs to defaults,
    which is the desired behavior for a public demo (like Apple Store demo phones).
    """
    # Update the in-memory cache so the current session sees changes
    _mock_cache["assistant-config"] = data


# ── Notification store (in-memory for demo) ───────────────────────────
_notifications: list[dict] = []
_notif_lock = threading.Lock()
_notif_counter = 0

# Pre-fill from mock data so AssistantPanel shows notifications on first load
_mock_notifs = load_mock("notifications")
if _mock_notifs and isinstance(_mock_notifs, dict):
    for n in _mock_notifs.get("notifications", []):
        _notif_counter += 1
        _notifications.append({
            "id": _notif_counter,
            "type": n.get("type", "keyword_alert"),
            "title": n.get("title", ""),
            "content": n.get("content", ""),
            "chat_id": n.get("chat_id", ""),
            "group_name": n.get("group_name", ""),
            "priority": "normal",
            "status": n.get("status", "delivered"),
            "push_status": n.get("push_status", "not_pushed"),
            "push_time": n.get("push_time", ""),
            "push_error": n.get("push_error", ""),
            "create_time": n.get("created_at", time.strftime("%Y-%m-%d %H:%M:%S")),
            "timestamp": int(time.time()),
        })


def add_notification(notif_type: str, title: str, content: str,
                     chat_id: str = "", group_name: str = "",
                     priority: str = "normal", push_ilink: bool = True) -> int:
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
            "push_status": "not_pushed",  # not_pushed | delivered | failed
            "create_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "timestamp": int(time.time()),
        }
        _notifications.append(notif)

    # Online-demo mode: iLink push is NOT automatic.
    # Each user pushes via POST /api/ilink/push with their own credentials
    # stored in sessionStorage (per-browser, clears on tab close).
    # This avoids needing a global iLink binding — each browser user has their own.

    logger.info("Notification created: id=%d type=%s title=%.40s chat_id=%s",
                notif["id"], notif_type, title[:40], chat_id)

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

    def do_HEAD(self):
        """Handle HEAD requests (used by monitoring services like UptimeRobot)."""
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            # For API routes, just return headers without body
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
        else:
            # For static files, treat like GET but without body
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()

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
            tags_data = load_mock("fav-tags") or {}
            if isinstance(tags_data, dict) and "ok" in tags_data:
                self._send_json(tags_data)
            elif isinstance(tags_data, list):
                self._send_json({"ok": True, "data": tags_data})
            else:
                self._send_json({"ok": True, "data": []})

        elif path == "/api/sns/timeline":
            data = load_mock("moments") or {}
            if isinstance(data, dict) and "ok" in data:
                self._send_json(data)
            else:
                self._send_json({"ok": True, "items": data, "total": len(data) if isinstance(data, list) else 0})

        elif path == "/api/sns/protect/status":
            self._send_json({"ok": True, "enabled": False})

        elif path == "/api/sns/search":
            q = params.get("q", [""])[0].lower()
            moments_data = load_mock("moments") or {}
            items = moments_data.get("data", moments_data) if isinstance(moments_data, dict) else moments_data
            if not isinstance(items, list):
                items = []
            results = [m for m in items if not q or q in (m.get("content", "") + m.get("nickname", "")).lower()]
            self._send_json({"ok": True, "data": results, "total": len(results)})

        elif path == "/api/fav/export":
            self._send_json({"ok": True, "error": "Demo 模式不支持导出"})

        elif path == "/api/sns/export":
            self._send_json({"ok": True, "error": "Demo 模式不支持导出"})

        elif path == "/api/oa/accounts":
            acc_data = load_mock("oa-accounts") or {}
            # oa-accounts.json has {ok, data} wrapper — pass through
            if isinstance(acc_data, dict) and "ok" in acc_data:
                self._send_json(acc_data)
            elif isinstance(acc_data, list):
                self._send_json({"ok": True, "data": acc_data})
            else:
                self._send_json({"ok": True, "data": []})

        elif path == "/api/oa/groups":
            grp_data = load_mock("oa-groups") or {}
            if isinstance(grp_data, dict) and "ok" in grp_data:
                self._send_json(grp_data)
            elif isinstance(grp_data, list):
                self._send_json({"ok": True, "data": grp_data})
            else:
                self._send_json({"ok": True, "data": []})

        elif path == "/api/oa/articles":
            gh_id = params.get("gh_id", [""])[0]
            articles_data = load_mock("oa-articles") or {}
            if gh_id and isinstance(articles_data, dict):
                articles = articles_data.get(gh_id, [])
            else:
                # Return all articles flattened
                articles = []
                if isinstance(articles_data, dict):
                    for arts in articles_data.values():
                        if isinstance(arts, list):
                            articles.extend(arts)
            self._send_json({"ok": True, "data": articles})

        elif path == "/api/oa/search":
            q = params.get("q", [""])[0].lower()
            articles_data = load_mock("oa-articles") or {}
            results = []
            if isinstance(articles_data, dict):
                for arts in articles_data.values():
                    if isinstance(arts, list):
                        for art in arts:
                            if not q or q in (art.get("title", "") + art.get("digest", "")).lower():
                                results.append(art)
            self._send_json({"ok": True, "data": results})

        elif path == "/api/assistant/config":
            self._send_json(load_assistant_config())

        elif path == "/api/assistant/notifications":
            limit = int(params.get("limit", [50])[0])
            self._send_json({"ok": True, "notifications": get_notifications(limit)})

        elif path == "/api/assistant/notifications/pending":
            self._send_json({"ok": True, "notifications": get_notifications(status_filter="pending")})

        elif path == "/api/nicknames/groups":
            data = load_mock("nickname-groups") or {}
            # nickname-groups.json may have {ok, groups} wrapper — pass through
            if isinstance(data, dict) and "ok" in data:
                self._send_json(data)
            else:
                self._send_json({"ok": True, "groups": data})

        elif path == "/api/nicknames":
            self._send_json({"ok": True, "members": []})

        elif path in ("/api/scheduler/tasks", "/api/scheduled-tasks"):
            self._handle_get_scheduler_tasks()

        elif path == "/api/ai/chat/history":
            self._handle_ai_chat_history(params)

        elif path == "/api/lots":
            self._send_json({"ok": True, "config": {}})

        elif path == "/api/onboarding/status":
            # Online-demo mode: always show onboarding for new visitors.
            # Each browser session should see the welcome guide.
            self._send_json({"onboarding_done": False})

        elif path == "/api/onboarding/diagnose":
            self._handle_onboarding_diagnose()

        elif path == "/api/wechat-data-dir/detect":
            self._send_json({"found": True, "accounts": [{"wxid": "wxid_demo", "nickname": "Demo用户"}]})

        elif path == "/api/browse":
            self._send_json({"ok": True, "entries": [], "current_path": "C:\\"})

        elif path == "/api/ilink/status":
            # Online-demo: iLink status is managed per-browser via sessionStorage.
            # The backend just reports whether the iLink API is reachable.
            self._send_json({"ok": True, "bound": False, "mode": "per-browser"})

        elif path == "/api/ilink/push-history":
            self._handle_push_history(params)

        elif path == "/api/demo/scenario/status":
            player = get_scenario_player()
            self._send_json({"ok": True, "running": player.running})

        elif path == "/api/ilink/qrcode":
            try:
                ilink = get_ilink_push()
                result = ilink.get_qrcode()
                self._send_json(result)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)[:200]})

        elif path == "/api/ilink/qrcode-status":
            qrcode_id = params.get("qrcode", [""])[0]
            try:
                ilink = get_ilink_push()
                result = ilink.check_qrcode_status(qrcode_id)
                # Online-demo: don't persist the account server-side.
                # Instead, return credentials for the frontend to store in sessionStorage.
                # The ILinkPush.check_qrcode_status auto-saves to disk — undo that.
                if result.get("status") == "confirmed":
                    try:
                        from src.demo.ilink_push import ACCOUNT_PATH
                        if ACCOUNT_PATH.exists():
                            ACCOUNT_PATH.unlink()
                    except Exception:
                        pass
                self._send_json(result)
            except Exception:
                self._send_json({"ok": True, "status": "timeout"})

        # Image endpoints — proxy or redirect to mock images
        elif path.startswith("/api/image/") or path.startswith("/api/chat/image") or path.startswith("/api/fav/image"):
            self._handle_image_proxy(path, params)
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
        elif path == "/api/ai/ping":
            self._handle_ai_ping()
        elif path == "/api/assistant/digest/run":
            self._handle_digest_run()
        elif path == "/api/oa/digest/run":
            self._handle_oa_digest_run("")
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
            if ONLINE_DEMO:
                self._send_json({"ok": True})
            else:
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
        elif path == "/api/demo/digest/preview":
            self._handle_digest_preview()
        elif path == "/api/ilink/test-push":
            self._handle_ilink_test_push()
        elif path == "/api/ilink/unbind":
            # Online-demo: unbind is handled client-side (clear sessionStorage)
            self._send_json({"ok": True})
        elif path == "/api/oa/groups/create":
            self._handle_oa_group_create()
        elif path.startswith("/api/oa/digest/run/"):
            self._handle_oa_digest_run(path)
        else:
            self._send_json({"ok": True, "error": f"Unknown endpoint: {path}"})

    # ── PUT API handlers ──────────────────────────────────────────────

    def _handle_api_put(self, path: str):
        if path == "/api/assistant/config":
            data = self._read_json()
            save_assistant_config(data)
            self._send_json({"ok": True})
        elif path.startswith("/api/oa/groups/"):
            self._handle_oa_group_update(path)
        else:
            self._send_json({"ok": True})

    # ── DELETE API handlers ───────────────────────────────────────────

    def _handle_api_delete(self, path: str):
        if path.startswith("/api/scheduler/tasks/"):
            self._handle_delete_scheduler_task(path)
        elif path.startswith("/api/oa/groups/"):
            self._handle_oa_group_delete(path)
        else:
            self._send_json({"ok": True})

    # ── Implementation: Bot control ───────────────────────────────────

    def _handle_bot_start(self):
        # Online-demo: start/stop is frontend-only, backend always runs
        self._send_json({"ok": True, "note": "demo-mode: backend always running"})

    def _handle_bot_stop(self):
        # Online-demo: start/stop is frontend-only, backend always runs
        self._send_json({"ok": True, "note": "demo-mode: backend always running"})

    # ── Implementation: Config ────────────────────────────────────────

    def _handle_load_config(self):
        env_path = find_env_file()
        if env_path and env_path.exists():
            try:
                cfg = load_config()
                config_dict = {
                    "ai_backend": cfg.ai_backend,
                    "deepseek_api_key": cfg.deepseek_api_key or "",
                    "deepseek_base_url": cfg.deepseek_base_url,
                    "deepseek_model": cfg.deepseek_model,
                    "anthropic_api_key": cfg.anthropic_api_key or "",
                    "anthropic_base_url": cfg.anthropic_base_url,
                    "summarize_model": cfg.summarize_model,
                    "ai_provider_base_url": cfg.ai_provider_base_url,
                    "ai_provider_api_key": cfg.ai_provider_api_key or "",
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
        if ONLINE_DEMO:
            self._send_json({"ok": True, "note": "Demo 版本不支持保存配置，配置由部署者管理"})
            return

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
                # Skip masked values — don't overwrite real keys with "••••" placeholders
                if val is not None and "••••" not in str(val):
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
        if ONLINE_DEMO:
            self._send_json({"ok": True, "note": "Demo 版本不支持导入配置"})
            return
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

    def _build_moments_context(self, moments_count: int = 30) -> str:
        """Build text-only context from the N most recent moments."""
        moments_data = load_mock("moments") or {}
        items = moments_data.get("data", moments_data) if isinstance(moments_data, dict) else moments_data
        if not isinstance(items, list):
            items = []

        # Sort by create_time descending (newest first), then take N
        sorted_items = sorted(items, key=lambda p: p.get("create_time", 0), reverse=True)
        if moments_count > 0:
            sorted_items = sorted_items[:moments_count]

        if not sorted_items:
            return "（没有朋友圈内容）"

        # Format: text content only (no images/videos)
        lines = []
        for post in sorted_items:
            nickname = post.get("nickname", post.get("username", "未知"))
            ct = post.get("create_time", 0)
            time_str = time.strftime("%Y-%m-%d %H:%M", time.localtime(ct)) if ct else ""
            content = post.get("content", "")
            if not content:
                continue  # Skip posts with no text

            line = f"[{nickname} {time_str}]\n{content}"

            # Add text comments
            comments = post.get("comments", [])
            if comments:
                comment_parts = []
                for c in comments:
                    cn = c.get("nickname", "未知")
                    cc = c.get("content", "")
                    ref = c.get("refNickname", "")
                    if ref:
                        comment_parts.append(f"{cn}回复{ref}: {cc}")
                    else:
                        comment_parts.append(f"{cn}: {cc}")
                line += "\n评论: " + " / ".join(comment_parts)

            lines.append(line)

        return "\n\n".join(lines)

    def _build_favorites_context(self, tag_id: str = "", fav_types: list = None) -> str:
        """Build text-only context from favorites mock data."""
        fav_data = load_mock("favorites") or {}
        items = fav_data.get("data", fav_data.get("items", []))
        if isinstance(fav_data, dict) and "data" in fav_data:
            items = fav_data["data"]
        elif isinstance(fav_data, dict) and "items" in fav_data:
            items = fav_data["items"]
        if not isinstance(items, list):
            items = []
        logger.info("_build_favorites_context: items=%d tag_id=%s fav_types=%s", len(items), tag_id, fav_types)

        if not items:
            return "（没有收藏内容）"

        # Filter by tag if specified
        if tag_id:
            items = [f for f in items if tag_id in str(f.get("tags", ""))]

        # Filter by type if specified
        if fav_types:
            items = [f for f in items if f.get("fav_type", f.get("type", 0)) in fav_types]

        lines = []
        for i, fav in enumerate(items):
            title = fav.get("title", fav.get("fav_title", ""))
            content = fav.get("content", fav.get("digest", ""))
            fav_type = fav.get("fav_type", fav.get("type", 0))
            url = fav.get("url", "")

            if not content and not title:
                continue

            line = f"[收藏 #{i+1}]"
            if title:
                line += f" {title}"
            if content:
                line += f"\n{content[:500]}"  # Truncate long content
            if url and fav_type in (5, 33):  # Link/article types
                line += f"\n链接: {url}"

            lines.append(line)

        return "\n\n".join(lines) if lines else "（没有匹配的收藏内容）"

    def _build_chat_context(self, talker: str, start_time: int = 0, end_time: int = 0) -> str:
        """Build text-only context from chat messages mock data."""
        all_messages = load_mock("chat-messages") or {}
        logger.info("_build_chat_context: talker=%s data_type=%s keys=%s",
                     talker, type(all_messages).__name__,
                     list(all_messages.keys())[:3] if isinstance(all_messages, dict) else "N/A")
        messages = all_messages.get(talker, [])
        if not isinstance(messages, list):
            messages = []

        if not messages:
            return ""

        # Filter by time range
        if start_time or end_time:
            filtered = []
            for msg in messages:
                ct = msg.get("create_time", 0)
                if start_time and ct < start_time:
                    continue
                if end_time and ct > end_time:
                    continue
                filtered.append(msg)
            messages = filtered

        if not messages:
            return ""

        # Sort chronologically
        messages.sort(key=lambda m: m.get("create_time", 0))

        # Limit to last 200 messages to avoid token overflow
        if len(messages) > 200:
            messages = messages[-200:]

        lines = []
        for msg in messages:
            sender = msg.get("sender_name", msg.get("nickname", "未知"))
            ct = msg.get("create_time", 0)
            time_str = time.strftime("%H:%M", time.localtime(ct)) if ct else ""
            content = msg.get("content", "")
            if not content:
                continue
            lines.append(f"[{sender} {time_str}]\n{content}")

        return "\n\n".join(lines)

    def _find_group_name(self, chat_id: str) -> str:
        """Find group name from mock sessions data."""
        sessions_data = load_mock("chat-sessions") or {}
        if isinstance(sessions_data, dict) and "data" in sessions_data:
            sessions_list = sessions_data["data"]
        elif isinstance(sessions_data, list):
            sessions_list = sessions_data
        else:
            return ""
        for s in sessions_list:
            if s.get("username", s.get("chat_id", "")) == chat_id:
                return s.get("nickname", s.get("group_name", ""))
        return ""

    def _handle_ai_chat_start(self):
        global _ai_session_counter
        data = self._read_json()

        source_type = data.get("source_type", "")
        context_type = data.get("context_type", "")
        context_text = data.get("context_text", "")
        source_id = data.get("source_id", data.get("chat_id", ""))
        logger.info("ai_chat_start: source_type=%s context_type=%s source_id=%s", source_type, context_type, source_id)

        # Auto-detect context_type from source_type if not provided
        if not context_type:
            if source_type == "moments":
                context_type = "moments"
            elif source_type == "favorites":
                context_type = "favorite"
            elif source_type in ("group_chat", "private_chat"):
                context_type = "private" if source_type == "private_chat" else "group"

        # Auto-load context for each type
        if not context_text:
            if context_type == "moments":
                context_text = self._build_moments_context(data.get("moments_count", 30))
            elif context_type == "favorite":
                context_text = self._build_favorites_context(
                    data.get("tag_id", ""),
                    data.get("fav_types", []),
                )
            elif context_type in ("group", "private"):
                context_text = self._build_chat_context(
                    source_id,
                    data.get("start_time", 0),
                    data.get("end_time", 0),
                )
                if not context_text:
                    context_text = "（所选范围内没有聊天记录）"

        with _ai_session_lock:
            _ai_session_counter += 1
            session_id = f"demo-session-{_ai_session_counter}"

        source_name = ""
        if context_type == "moments":
            source_name = "朋友圈"
        elif context_type == "favorite":
            source_name = "微信收藏"
        elif context_type == "private":
            source_name = source_id or "好友"
        elif context_type == "group":
            # Try to find group name from mock sessions
            source_name = self._find_group_name(source_id) or source_id or "群聊"

        session = {
            "id": session_id,
            "messages": [],
            "chat_id": source_id,
            "context_type": context_type,
            "context_text": context_text,
            "created_at": time.time(),
        }

        logger.info("AI session created: id=%s type=%s source=%s context_len=%d",
                     session_id, context_type, source_name, len(context_text))

        with _ai_session_lock:
            _ai_sessions[session_id] = session

        self._send_json({
            "ok": True,
            "session_id": session_id,
            "messages": [],
            "token_usage": {"used": 0, "limit": 100000},
            "source_name": source_name,
            "context_summary": f"已加载 {len(context_text)} 字符的{source_name}内容" if context_text else "无上下文",
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
            # Always try real AI — if ai_ok was False from a previous failure,
            # a successful call will recover it. Only skip if summarizer is None.
            self._stream_ai_response(summ, session, user_message)
        else:
            self._stream_mock_response(user_message)

    def _stream_ai_response(self, summarizer, session: dict, user_message: str):
        """Stream real AI response via SSE."""
        # Build system prompt based on context type
        from src.summarize.prompts import (
            GROUP_CHAT_SYSTEM_PROMPT, PRIVATE_CHAT_SYSTEM_PROMPT,
            FAV_CHAT_SYSTEM_PROMPT, MOMENTS_CHAT_SYSTEM_PROMPT,
            COMPRESSION_PROMPT,
        )

        context_type = session.get("context_type", "group")
        context_text = session.get("context_text", "")
        logger.info("AI streaming: context_type=%s context_len=%d", context_type, len(context_text))

        if context_type == "favorite":
            system_prompt = FAV_CHAT_SYSTEM_PROMPT.format(context_text=context_text)
        elif context_type == "moments":
            system_prompt = MOMENTS_CHAT_SYSTEM_PROMPT.format(context_text=context_text)
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
            # ✅ Recover ai_ok — a successful stream proves AI is reachable
            if not status.ai_ok:
                logger.info("AI stream succeeded — recovering ai_ok to True")
                status.update_ai(ok=True, model=status.model_name, backend=status.ai_backend)

        except Exception as e:
            logger.error("AI streaming error: %s", e)
            status.update_ai(ok=False, model="", backend="")
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

        # Send warning event to inform frontend this is a mock fallback
        warning_event = f"event: warning\ndata: {json.dumps({'msg': 'AI 后端不可用，以下为模拟回复'}, ensure_ascii=False)}\n\n"
        try:
            self.wfile.write(warning_event.encode("utf-8"))
            self.wfile.flush()
        except Exception:
            pass

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
            if not session or len(session["messages"]) <= 4:
                self._send_json({"ok": True, "compressed_from": 0, "compressed_to": 0})
                return

            old_count = len(session["messages"])
            early = session["messages"][:-4]
            recent = session["messages"][-4:]

        # Try real AI compression
        summ = get_summarizer()
        if summ:
            try:
                from src.summarize.prompts import COMPRESSION_PROMPT
                history_text = "\n".join(
                    f"{'用户' if m.get('role') == 'user' else 'AI'}: {m.get('content', '')}"
                    for m in early
                )
                sys_prompt = COMPRESSION_PROMPT.format(chat_history_text=history_text)
                summary = summ._call_chat_api(
                    sys_prompt,
                    [{"role": "user", "content": "请压缩以上对话历史"}],
                )
                status.last_api_call_time = time.time()

                with _ai_session_lock:
                    session = _ai_sessions.get(session_id)
                    if session:
                        session["messages"] = [
                            {"role": "system", "content": f"[对话历史摘要]\n{summary}"},
                        ] + recent
                        new_count = len(session["messages"])
                        self._send_json({"ok": True, "compressed_from": old_count, "compressed_to": new_count, "method": "ai"})
                        return
            except Exception as e:
                logger.warning("AI compression failed, falling back to truncation: %s", e)

        # Fallback: simple truncation
        with _ai_session_lock:
            session = _ai_sessions.get(session_id)
            if session and len(session["messages"]) > 4:
                old_count = len(session["messages"])
                session["messages"] = session["messages"][:2] + session["messages"][-2:]
                new_count = len(session["messages"])
                self._send_json({"ok": True, "compressed_from": old_count, "compressed_to": new_count, "method": "truncate"})
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

    def _handle_ai_ping(self):
        """Lightweight AI connectivity check using server-side config."""
        summ = get_summarizer()
        if summ:
            try:
                # Minimal streaming call — just verify the backend responds
                tokens = list(summ._call_chat_api_stream(
                    "You are a connectivity test.", [{"role": "user", "content": "ping"}]
                ))
                if tokens:
                    # ✅ Recover ai_ok if it was previously False
                    if not status.ai_ok:
                        logger.info("AI ping succeeded — recovering ai_ok to True")
                    status.update_ai(ok=True, model=status.model_name, backend=status.ai_backend)
                    self._send_json({"ok": True, "model": status.model_name, "backend": status.ai_backend})
                else:
                    status.update_ai(ok=False, model="", backend="")
                    self._send_json({"ok": False, "error": "AI 后端返回空响应"})
            except Exception as e:
                status.update_ai(ok=False, model="", backend="")
                self._send_json({"ok": False, "error": str(e)[:200]})
        else:
            self._send_json({"ok": False, "error": "AI 后端未配置或初始化失败"})

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

            # Create notification (skip in ONLINE_DEMO to avoid cross-user pollution)
            if not ONLINE_DEMO:
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
        # Collect digest_groups from assistant config
        asst_config = load_assistant_config()
        config = asst_config.get("config", asst_config)
        digest_groups = config.get("digest_groups", [])

        tasks = []

        # Group digest tasks
        for i, dg in enumerate(digest_groups):
            tasks.append({
                "id": f"digest-{i}",
                "type": "group_digest",
                "name": f"摘要: {dg.get('group_name', '未知群')}",
                "chat_id": dg.get("chat_id", ""),
                "group_name": dg.get("group_name", ""),
                "schedule": dg.get("schedule", []),
                "cron_expr": dg.get("cron_expr", ""),
                "enabled": dg.get("enabled", True),
                "lookback_hours": dg.get("lookback_hours", 6),
                "lookback": dg.get("lookback_hours", 6),
                "mode": "仅未读" if dg.get("unread_only") else "全部",
                "push": "微信推送" if dg.get("push_target") == "ilink" else "不推送",
            })

        # OA digest tasks from oa-groups mock data
        oa_groups_data = load_mock("oa-groups") or {}
        oa_groups_list = oa_groups_data.get("data", []) if isinstance(oa_groups_data, dict) else (oa_groups_data if isinstance(oa_groups_data, list) else [])
        for i, og in enumerate(oa_groups_list):
            schedule_arr = og.get("schedule", [])
            schedule_str = schedule_arr[0] if schedule_arr else ""
            tasks.append({
                "id": f"oa-digest-{i}",
                "type": "oa_digest",
                "name": f"公众号: {og.get('name', '未知分组')}",
                "schedule": schedule_str,
                "cron_expr": schedule_str,
                "enabled": og.get("enabled", True),
                "account_count": len(og.get("accounts", [])),
                "push": "微信推送" if og.get("push_target") == "ilink" else "不推送",
            })

        data = {
            "total": len(tasks),
            "enabled": sum(1 for t in tasks if t.get("enabled", True)),
            "tasks": tasks,
        }

        self._send_json({"ok": True, "data": data})

    def _handle_create_scheduler_task(self):
        if ONLINE_DEMO:
            self._send_json({"ok": True, "note": "Demo 版本不支持修改调度任务"})
            return
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
        self._send_json({"ok": True, "data": messages, "total": len(messages)})

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
            if not ONLINE_DEMO:
                env_updates = {}
                if "bot_display_name" in data:
                    env_updates["BOT_DISPLAY_NAME"] = data["bot_display_name"]
                if env_updates:
                    env_path = find_env_file() or (DATA_DIR / ".env")
                    write_env_atomic(env_path, env_updates)
            self._send_json({"ok": True})
        elif step == "step3":
            # Save AI config — online-demo mode: only update runtime, don't write .env
            # (AI keys come from Render environment variables, not user input)
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
            # Online-demo: onboarding is per-session, not persisted.
            # The frontend stores completion in sessionStorage.
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": True})

    # ── Implementation: Message injection (demo-specific) ─────────────

    def _handle_inject_message(self):
        """Inject a message into a mock group chat — visible in ChatTab + optional keyword alert."""
        if ONLINE_DEMO:
            self._send_json({"ok": False, "error": "Demo 版本不支持消息注入"})
            return
        try:
            data = self._read_json()
            chat_id = data.get("chat_id", "")
            sender_name = data.get("sender_name", "测试用户")
            content = data.get("content", "")

            if not chat_id:
                self._send_json({"ok": False, "error": "请选择群聊"})
                return
            if not content:
                self._send_json({"ok": False, "error": "消息内容不能为空"})
                return

            # 1. Add message to mock chat-messages
            result = _do_inject(chat_id, sender_name, content)
            keyword_hits = result.get("keyword_hits", [])

            # 2. Broadcast update
            if keyword_hits:
                ws_broadcast({"event": "keyword_alert", "keywords": keyword_hits})
            ws_broadcast(status.to_dict())

            self._send_json({
                "ok": True,
                "keyword_hits": keyword_hits,
                "notification_created": len(keyword_hits) > 0,
            })
        except Exception as e:
            logger.error("Inject message error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    def _handle_push_history(self, params: dict):
        """Return iLink push history from notifications with push_status != not_pushed."""
        type_filter = params.get("type", [""])[0]
        status_filter = params.get("status", [""])[0]
        limit = int(params.get("limit", [50])[0])

        with _notif_lock:
            records = []
            for n in reversed(_notifications):
                ps = n.get("push_status", "not_pushed")
                if ps == "not_pushed":
                    continue
                if type_filter and n.get("type", "") != type_filter:
                    continue
                if status_filter and ps != status_filter:
                    continue
                records.append({
                    "id": n["id"],
                    "type": n.get("type", ""),
                    "title": n.get("title", ""),
                    "group_name": n.get("group_name", ""),
                    "chat_id": n.get("chat_id", ""),
                    "push_status": ps,
                    "push_time": n.get("push_time", ""),
                    "push_error": n.get("push_error", ""),
                    "create_time": n.get("create_time", ""),
                    "content": n.get("content", ""),
                })
                if len(records) >= limit:
                    break

        self._send_json({"ok": True, "records": records, "total": len(records)})

    # ── Implementation: OA Digest (real AI) ───────────────────────────

    def _handle_oa_digest_run(self, path: str = ""):
        """Generate OA article digest using real AI with mock article data."""
        try:
            # Extract group_id from URL path like /api/oa/digest/run/oa-group-1
            group_id = ""
            if path and "/api/oa/digest/run/" in path:
                group_id = path.split("/api/oa/digest/run/")[-1].strip("/")

            data = self._read_json() if not group_id else {}
            if not group_id:
                group_id = data.get("group_id", "")
            template = data.get("template", "default") if data else "default"

            summ = get_summarizer()
            if not summ:
                self._send_json({"ok": False, "error": "AI 后端未配置"})
                return

            # Load mock OA articles from oa-articles.json
            articles_data = load_mock("oa-articles") or {}
            oa_groups_data = load_mock("oa-groups") or {}
            oa_groups_list = oa_groups_data.get("data", []) if isinstance(oa_groups_data, dict) else oa_groups_data

            # Determine which accounts to include
            target_accounts = None
            target_group = None
            if group_id:
                for g in (oa_groups_list or []):
                    if g.get("id") == group_id:
                        target_accounts = g.get("accounts", [])
                        target_group = g
                        template = target_group.get("digest_template", template) or template
                        break

            # Collect articles for the target accounts (or all if no specific group)
            mock_articles = []
            if isinstance(articles_data, dict):
                for gh_id, arts in articles_data.items():
                    if target_accounts and gh_id not in target_accounts:
                        continue
                    if isinstance(arts, list):
                        for art in arts:
                            mock_articles.append({
                                "title": art.get("title", ""),
                                "content": art.get("digest", art.get("content", "")),
                                "source": art.get("source_name", gh_id),
                            })

            # Fallback to hardcoded if no articles found
            if not mock_articles:
                mock_articles = [
                    {"title": "GPT-5 发布：多模态能力大幅提升", "content": "OpenAI 今日发布 GPT-5，在视觉、语音和代码生成方面均有显著提升。新模型支持 1M token 上下文窗口，推理速度提升 3 倍。", "source": "科技日报"},
                    {"title": "Rust 2026 Edition 正式发布", "content": "Rust 2026 Edition 带来了更完善的异步支持、改进的错误处理宏，以及新的 cargo 子命令。社区反响热烈。", "source": "科技日报"},
                    {"title": "Python 3.14 性能提升 40%", "content": "Python 3.14 通过新的 JIT 编译器和优化字节码，在基准测试中性能提升约 40%。no-GIL 实验特性也取得进展。", "source": "Python周刊"},
                    {"title": "WebAssembly 组件模型 1.0 发布", "content": "W3C 正式发布 WebAssembly 组件模型 1.0 规范，为 Wasm 生态带来标准化的接口定义和跨语言互操作能力。", "source": "AI前沿观察"},
                    {"title": "Kubernetes 2.0 架构预览", "content": "CNCF 发布 Kubernetes 2.0 架构预览，引入声明式 API v2、原生 eBPF 支持，以及更轻量的控制平面。", "source": "科技日报"},
                ]

            # Build prompt — include source name for context
            articles_text = "\n\n".join(
                f"## {a['title']}\n来源: {a.get('source', '未知')}\n{a['content']}" for a in mock_articles
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

            # Create notification + broadcast (even in ONLINE_DEMO — these are runtime, not persistent)
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

    # ── Implementation: OA Groups CRUD ───────────────────────────────

    def _handle_oa_group_create(self):
        if ONLINE_DEMO:
            self._send_json({"ok": False, "error": "Demo 版本不支持创建群组"})
            return
        data = self._read_json()
        groups_data = load_mock("oa-groups") or {}
        groups_list = groups_data.get("data", groups_data) if isinstance(groups_data, dict) else groups_data
        if not isinstance(groups_list, list):
            groups_list = []
        new_group = {
            "id": f"oa-group-{int(time.time())}",
            "name": data.get("name", "新建分组"),
            "accounts": data.get("accounts", []),
            "schedule": data.get("schedule", ["0 9 * * *"]),
            "digest_template": data.get("digest_template", "default"),
            "custom_prompt": data.get("custom_prompt", ""),
            "lookback_hours": data.get("lookback_hours", 24),
            "lookback_mode": data.get("lookback_mode", "auto"),
            "push_target": data.get("push_target", ""),
            "enabled": data.get("enabled", True),
        }
        groups_list.append(new_group)
        # Update mock data in cache
        _mock_cache["oa-groups"] = {"ok": True, "data": groups_list}
        self._send_json({"ok": True, "data": new_group})

    def _handle_oa_group_update(self, path: str):
        group_id = path.split("/api/oa/groups/")[-1]
        data = self._read_json()
        groups_data = load_mock("oa-groups") or {}
        groups_list = groups_data.get("data", groups_data) if isinstance(groups_data, dict) else groups_data
        if not isinstance(groups_list, list):
            self._send_json({"ok": False, "error": "No groups data"})
            return
        for i, g in enumerate(groups_list):
            if g.get("id") == group_id:
                groups_list[i] = {**g, **data}
                _mock_cache["oa-groups"] = {"ok": True, "data": groups_list}
                self._send_json({"ok": True, "data": groups_list[i]})
                return
        self._send_json({"ok": False, "error": "Group not found"})

    def _handle_oa_group_delete(self, path: str):
        group_id = path.split("/api/oa/groups/")[-1]
        groups_data = load_mock("oa-groups") or {}
        groups_list = groups_data.get("data", groups_data) if isinstance(groups_data, dict) else groups_data
        if not isinstance(groups_list, list):
            self._send_json({"ok": True})
            return
        groups_list = [g for g in groups_list if g.get("id") != group_id]
        _mock_cache["oa-groups"] = {"ok": True, "data": groups_list}
        self._send_json({"ok": True})

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

    def _handle_digest_preview(self):
        """Generate a one-off digest preview for the demo preset group.

        Uses the first digest_groups entry from assistant config, or a
        hardcoded fallback. Calls real AI to generate the summary.
        """
        try:
            summ = get_summarizer()
            if not summ:
                self._send_json({"ok": False, "error": "AI 后端未配置"})
                return

            # Load preset config for context
            asst_config = load_assistant_config()
            config = asst_config.get("config", asst_config)
            digest_groups = config.get("digest_groups", [])

            # Pick the first enabled digest group, or use hardcoded fallback
            dg = None
            for g in digest_groups:
                if g.get("enabled", True):
                    dg = g
                    break

            group_name = dg.get("group_name", "技术交流群") if dg else "技术交流群"
            lookback = dg.get("lookback_hours", 6) if dg else 6
            unread_only = dg.get("unread_only", False) if dg else False
            profile = dg.get("profile", {}) if dg else {}

            # Build mock messages for the demo group
            mock_messages = [
                {"sender_name": "张伟", "content": "紧急BUG！线上接口超时了"},
                {"sender_name": "李芳", "content": "什么接口？我看看日志"},
                {"sender_name": "王磊", "content": "找到了，数据库连接池满了，需要扩容"},
                {"sender_name": "陈静", "content": "线上问题已回滚，正在排查根因"},
                {"sender_name": "赵经理", "content": "做个事故复盘，明天开会"},
                {"sender_name": "张伟", "content": "收到，我写复盘文档"},
                {"sender_name": "王磊", "content": "BUG已修复，提交了PR，大家帮忙review"},
                {"sender_name": "李芳", "content": "看了，代码没问题，可以合并"},
            ]

            # Build system prompt
            from src.summarize.prompts import DIGEST_SYSTEM_PROMPT, DIGEST_PROFILE_TEMPLATE
            profile_section = ""
            if profile and any(profile.get(k) for k in ["purpose", "description", "focus_points", "ignore_content", "style"]):
                profile_section = DIGEST_PROFILE_TEMPLATE.format(
                    purpose=profile.get("purpose", "未指定"),
                    description=profile.get("description", "未指定"),
                    focus_points=profile.get("focus_points", "未指定"),
                    ignore_content=profile.get("ignore_content", "无"),
                    style=profile.get("style", "简洁清晰"),
                )
            system_prompt = DIGEST_SYSTEM_PROMPT.format(profile_section=profile_section)

            # Build user prompt from mock messages
            context_text = "\n".join(f"{m['sender_name']}: {m['content']}" for m in mock_messages)
            unread_hint = "（仅摘要未读消息）" if unread_only else ""
            user_prompt = f"请根据以下群聊记录生成摘要{unread_hint}：\n\n{context_text}"

            result_text = summ._call_long_api(
                system_prompt,
                [{"role": "user", "content": user_prompt}],
                max_tokens=1500,
                temperature=0.3,
            )
            status.last_api_call_time = time.time()

            # Create notification
            add_notification(
                notif_type="group_digest",
                title=f"📋 {group_name} 群摘要",
                content=result_text,
                chat_id=dg.get("chat_id", "12345678@chatroom") if dg else "12345678@chatroom",
                group_name=group_name,
                priority="normal",
            )

            logger.info("Digest preview generated for %s (lookback=%dh, unread=%s)",
                        group_name, lookback, unread_only)

            self._send_json({
                "ok": True,
                "group_name": group_name,
                "summary": result_text,
                "lookback_hours": lookback,
            })

        except Exception as e:
            logger.error("Digest preview error: %s", e)
            try:
                self._send_json({"ok": False, "error": str(e)})
            except Exception:
                pass

    # ── Implementation: iLink push ───────────────────────────────────

    def _handle_ilink_test_push(self):
        """Send a test push message via iLink.

        Online-demo mode: credentials come from the request body
        (stored in the user's sessionStorage), not from disk.
        """
        data = self._read_json() if self.command == "POST" else {}
        bot_token = data.get("bot_token", "")
        account_id = data.get("account_id", "")
        user_id = data.get("user_id", "")
        base_url = data.get("base_url", "https://ilinkai.weixin.qq.com")

        if not bot_token or not account_id or not user_id:
            self._send_json({"ok": False, "error": "iLink 未绑定，请先绑定 Bot"})
            return

        # Create a temporary ILinkPush instance with the user's credentials
        from src.demo.ilink_push import ILinkPush
        ilink = ILinkPush()
        ilink._account = {
            "bot_token": bot_token,
            "account_id": account_id,
            "user_id": user_id,
            "base_url": base_url,
        }
        result = ilink.send_message("🧪 wx-assist-demo 测试推送 — 如果你收到了这条消息，说明推送通道工作正常！")
        if result.get("success"):
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": False, "error": result.get("error", "推送失败")})

    # ── Image proxy for mock data ───────────────────────────────────────

    # Map fullmd5 values from mock data to picsum.photos URLs
    _MOCK_IMAGE_MAP = {
        "img_tech_sse": "https://picsum.photos/seed/sse_diagram/600/400",
        "img_food_hongshaorou": "https://picsum.photos/seed/hongshaorou/600/400",
        "img_travel_qiandaohu": "https://picsum.photos/seed/qiandaohu1/600/400",
        "img_sunset": "https://picsum.photos/seed/fav_sunset/600/400",
        "img_mountain": "https://picsum.photos/seed/fav_mountain/600/400",
        "abc123": "https://picsum.photos/seed/fav_arch/600/400",
    }

    def _handle_image_proxy(self, path: str, params: dict):
        """Handle image requests — redirect to mock image URLs or return placeholder."""
        # /api/image/proxy?url=... — redirect to external URL
        if "/api/image/proxy" in path:
            url = params.get("url", [""])[0]
            if url and (url.startswith("https://picsum.photos") or url.startswith("https://i.pravatar.cc")):
                self.send_response(302)
                self.send_header("Location", url)
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                return

        # /api/chat/image?fullmd5=... or /api/fav/image?fullmd5=... — map to mock image
        fullmd5 = params.get("fullmd5", [""])[0]
        if fullmd5 and fullmd5 in self._MOCK_IMAGE_MAP:
            self.send_response(302)
            self.send_header("Location", self._MOCK_IMAGE_MAP[fullmd5])
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            return

        # /api/fav/image?id=...&size=thumb — try to find image from favorites mock data
        fav_id = params.get("id", [""])[0]
        if fav_id:
            favs = load_mock("favorites")
            if favs and isinstance(favs, dict):
                for item in favs.get("data", []):
                    if str(item.get("id")) == fav_id:
                        images = item.get("images", [])
                        if images:
                            img = images[0]
                            url = img.get("thumbUrl") or img.get("url", "")
                            if url:
                                self.send_response(302)
                                self.send_header("Location", url)
                                self.send_header("Cache-Control", "public, max-age=86400")
                                self.end_headers()
                                return

        # Fallback: SVG placeholder
        self._send_svg_placeholder()

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
    host = os.getenv("DEMO_HOST", "0.0.0.0")
    port = int(os.getenv("DEMO_PORT", os.getenv("PORT", "7328")))

    # Demo: auto-start digest scheduler since we default to running
    try:
        start_digest_scheduler()
        logger.info("Digest scheduler auto-started (demo mode)")
    except Exception as e:
        logger.warning("Failed to auto-start digest scheduler: %s", e)

    server = ThreadingHTTPServer((host, port), DemoHandler)
    logger.info("wx-assist-demo server starting on http://%s:%d", host, port)
    print(f"wx-assist-demo server running at http://{host}:{port}")
    print("Press Ctrl+C to stop")

    # Eagerly probe AI backend on startup (real request, not just init)
    try:
        summ = get_summarizer()
        if summ:
            # Do a minimal real call to verify the backend actually works
            try:
                tokens = list(summ._call_chat_api_stream(
                    "You are a connectivity test.", [{"role": "user", "content": "ping"}]
                ))
                if tokens:
                    logger.info("AI backend probe: OK (model=%s)", status.model_name)
                else:
                    # Empty response — model may return nothing for "ping", don't mark as failed
                    # The summarizer was created successfully, that's enough
                    logger.warning("AI backend probe: EMPTY RESPONSE (model=%s) — keeping ai_ok=True", status.model_name)
            except Exception as e:
                logger.warning("AI backend probe: FAILED (%s) — keeping ai_ok=True, will retry on next call", e)
                # Don't poison ai_ok on startup probe failure — transient network issues
                # are common on cloud hosts. ai_ok stays True; actual calls will
                # update it if they fail.
        else:
            logger.warning("AI backend probe: FAILED (get_summarizer returned None)")
    except Exception as e:
        logger.warning("AI backend probe exception: %s", e)

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
