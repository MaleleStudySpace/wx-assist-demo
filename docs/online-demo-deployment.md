# Online Demo 部署指南

> wx-assist-demo 在线部署的完整记录，包括 Render 配置、多人安全修复、AI 连通性修复、写入保护。

## 项目信息

| 项 | 值 |
|---|---|
| 本地路径 | `C:\Users\74062\Desktop\wx-assist-demo` |
| GitHub | https://github.com/MaleleStudyHome/wx-assist-demo |
| 部署分支 | `online-demo` |
| Render URL | https://wx-assist-demo.onrender.com |

---

## 一、Render 部署配置

### Build & Start

| 项 | 值 |
|---|---|
| Build Command | `pip install -r requirements.txt && cd ui-src && npm install && npm run build` |
| Start Command | `python server.py` |

### 环境变量

| 变量 | 值 | 说明 |
|---|---|---|
| `DEMO_HOST` | `0.0.0.0` | 监听所有接口 |
| `DEMO_PORT` | `10000` | Render 内部端口 |
| `PORT` | `10000` | Render 要求的端口变量 |
| `ONLINE_DEMO` | `true` | **写入保护开关**（见第四节） |
| `AI_PROVIDER_BASE_URL` | *(见服务商文档)* | 讯飞 MaaS API 地址 |
| `AI_PROVIDER_API_KEY` | *(secret)* | 讯飞 MaaS API Key |
| `AI_PROVIDER_MODEL` | `xop35qwen2b` | 讯飞 MaaS 模型 ID |
| `AI_PROVIDER_TYPE` | `openai` | OpenAI 兼容协议 |

### 保活

UptimeRobot 每 5 分钟 ping `/api/status`，防止 Render 免费层休眠。

---

## 二、多人安全修复

在线 demo 多人访问，任何用户的操作不应影响其他用户或修改服务器数据。

### 2.1 启停前端化

- `POST /api/stop` 和 `POST /api/start` 改为 no-op，返回提示信息
- Dashboard 启停按钮改为 `sessionStorage` 本地状态，只影响当前浏览器
- 后端 `running` 状态始终为 `true`

### 2.2 AI 配置只读

- ConfigPanel AI 配置区改为只读展示，显示 "Demo 版本不支持自定义 AI 配置"
- API Key 显示为 `sk-•••••••••••••••••••`，不对外暴露
- 新增「测试连通性」按钮，POST `/api/ai/ping`，显示 ✅/❌ 结果

### 2.3 隐私提示

- Onboarding 和 Dashboard 加 "配置仅存于当前浏览器，不会上传至服务器" 提示

### 2.4 iLink per-browser

- iLink 绑定状态存 `sessionStorage`，关闭标签页自动解绑
- 后端不持久化 iLink 账号信息
- `POST /api/ilink/unbind` 为 no-op（前端自行清除 sessionStorage）

### 2.5 Onboarding 简化

- `/api/onboarding/status` 始终返回 `false`，每个新访客都看到欢迎页
- Onboarding 改为单步欢迎页，无需配置 AI Key

---

## 三、跨平台 & 协议适配

### 3.1 跨平台文件锁

- Windows 用 `msvcrt.locking()`，Linux 用 `fcntl.flock()`
- 解决 Render（Linux）部署时 `ModuleNotFoundError: No module named 'msvcrt'`

### 3.2 WebSocket 协议自动适配

- HTTPS 页面自动用 `wss://`，HTTP 用 `ws://`
- 解决 Render 部署后 `SecurityError: An insecure WebSocket connection`

### 3.3 HEAD 请求处理

- 新增 `do_HEAD` 方法，UptimeRobot 的 HEAD 请求不再返回 501

---

## 四、写入保护（ONLINE_DEMO）

### 4.1 机制

`server.py` 顶部定义：

```python
ONLINE_DEMO = os.getenv("ONLINE_DEMO", "").lower() in ("true", "1", "yes")
```

当 `ONLINE_DEMO=true` 时，**所有写入型 API 端点变成 no-op**，任何用户都无法修改服务器数据。不设此变量时行为完全不变（向后兼容本地开发）。

### 4.2 保护的端点

| 端点 | 原行为 | ONLINE_DEMO 时行为 | 优先级 |
|---|---|---|---|
| `POST /api/config` | `write_env_atomic()` 写 .env | 返回 `{"ok":true,"note":"Demo 版本不支持保存配置..."}` | HIGH |
| `POST /api/config/import` | `write_env_atomic()` 写 .env | 同上 | HIGH |
| `POST /api/onboarding/reset` | 删 .env 中的 ONBOARDING_DONE | 跳过，返回 `{"ok":true}` | HIGH |
| `POST /api/onboarding/step2` | `write_env_atomic()` 写 BOT_DISPLAY_NAME | 跳过写文件 | HIGH |
| `POST /api/demo/inject-message` | 修改共享聊天记录 + ws_broadcast | 返回 `{"ok":false,"error":"..."}` | HIGH |
| `POST /api/demo/scenario/start` | 启动 ScenarioPlayer + broadcast | 返回 `{"ok":false,"error":"..."}` | HIGH |
| `POST /api/demo/scenario/stop` | 停止全局 ScenarioPlayer | 返回 `{"ok":true}` | HIGH |
| `POST /api/assistant/digest/run` | `add_notification()` 创建共享通知 | 跳过通知，只在 HTTP response 返回结果 | MEDIUM |
| `POST /api/oa/digest/run` | 通知 + `ws_broadcast()` 全用户广播 | 跳过通知和广播 | MEDIUM |
| `POST /api/scheduler/tasks` | 修改调度器配置 | 返回 `{"ok":true,"note":"..."}` | MEDIUM |
| `POST /api/oa/groups/create` | 修改共享 OA 群组数据 | 返回 `{"ok":false,"error":"..."}` | LOW |

### 4.3 不受影响的端点

所有 GET 端点正常读取。AI 对话相关端点（`/api/ai/chat/start`、`/api/ai/chat/message`、`/api/ai/chat/destroy`、`/api/ai/chat/compress`）不受影响，因为它们操作的是 per-session 内存数据。

---

## 五、AI 连通性真实检测

### 5.1 问题

原来 `ai_ok` 永远是 `True`，AI 不可用时用户不知道，mock 回复无提示。

### 5.2 修复

| 改动 | 文件 | 说明 |
|---|---|---|
| `get_summarizer()` 失败时设 `ai_ok=False` | server.py | 原来失败只 log warning |
| 启动时 eager probe 真实调用 | server.py | `_call_chat_api_stream("ping")`，不是只初始化对象 |
| 新增 `/api/ai/ping` | server.py | 最小化真实调用检测，返回 `{ok, model, backend}` 或 `{ok:false, error}` |
| AI streaming 异常时 `status.update_ai(ok=False)` | server.py | 异常后自动降级 |
| `ai_ok=false` 时对话直降 mock | server.py | 不再尝试真实调用再失败 |
| mock fallback 发 `event: warning` SSE | server.py | 告知前端这是模拟回复 |
| ConfigPanel「测试连通性」按钮 | ConfigPanel.jsx | POST `/api/ai/ping`，显示 ✅/❌ |
| AIChatPanel warning 提示条 | AIChatPanel.jsx | 收到 warning event 显示黄色横幅 |
| 各 Tab 传递 `aiWarning` state | ChatTab/FavoritesTab/MomentsTab.jsx | 新对话/重置时清空 warning |

### 5.3 SSE warning event 格式

```
event: warning
data: {"msg": "AI 后端不可用，以下为模拟回复"}
```

前端 AIChatPanel 识别此事件，在消息区顶部显示黄色提示条。

---

## 六、AI 连通性三层修复

AI 在 Render 上连不通，根因有三层：

### 6.1 第一层：`load_dotenv(override=True)` 覆盖环境变量

**问题**：`load_config()` 中 `load_dotenv(env_path, override=True)` 会用 `data/.env` 里的空值覆盖 Render 设置的环境变量。如果 `data/.env` 里有 `AI_PROVIDER_API_KEY=`（空值行），Render 的真实值被清空。

**修复**：改为 `load_dotenv(env_path, override=False)`。Render 环境变量优先，`.env` 只补充缺失值。

**文件**：`src/config.py` line 224

### 6.2 第二层：讯飞 MaaS `/v2` 被错误追加 `/v1`

**问题**：`OpenAICompatSummarizer.__init__` 中，如果 `base_url` 不以 `/v1` 结尾，自动追加 `/v1`。讯飞 MaaS 等使用 `/v2` 路径的 API，被追加后变成 `/v2/v1`，返回 301 重定向。

**修复**：改为正则匹配 `re.search(r"/v\d+$", base_url)`，如果已以 `/v1`、`/v2` 等结尾则不再追加。

**文件**：`src/summarize/deepseek_backend.py` line 161

### 6.3 第三层：用户可写 .env 污染共享数据

**问题**：任何用户通过 `/api/config` 等端点可修改 `.env`，影响所有用户。

**修复**：`ONLINE_DEMO=true` 时所有写入端点 no-op（见第四节）。

---

## 七、前后端合二为一部署

`server.py` 同时 serve API 和 `dist/` 静态文件，不需要 Nginx 或分开部署。

关键方法：
- `_serve_static_file()` — 处理静态文件请求
- SPA fallback — 无扩展名路径返回 `index.html`
- `_send_cors_headers()` — CORS 支持

---

## 八、Git 提交历史（online-demo 分支特有）

```
31f993b fix: 讯飞MaaS base_url /v2 被错误追加 /v1 导致 301 重定向
d7488e7 feat: Online Demo 写入保护 — ONLINE_DEMO 模式禁止用户修改服务器数据
bb35742 fix: Render环境变量被空.env覆盖 — load_dotenv改override=False
db33b54 fix: AI探测假阳性 — 启动probe改为真实调用 + ai_ok=false时对话直降mock
3739486 feat: AI连通性真实检测 + 异常显示
ba615eb fix: 新增 do_HEAD 处理，UptimeRobot 等 HEAD 请求不再返回 501
a4a7af3 fix: 在线demo多人安全 — AI配置只读 + 启停前端化 + 后端no-op + 隐私提示
6537233 fix: WebSocket 协议自动适配 — HTTPS 页面用 wss://
e755cc9 fix: 跨平台文件锁 — Windows msvcrt / Linux fcntl
1de1426 feat: onboarding 改为单步欢迎页
5e59d0c fix: load_assistant_config 从内存缓存读取
129ccde feat: online-demo 模式 — iLink per-browser + 配置不持久化 + Render 部署
```
