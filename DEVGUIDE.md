# wx-assist-demo 开发文档

> **目标**: 上下文压缩后，仅凭此文档即可完全恢复开发进度和实现细节。

---

## 一、项目定位

**wx-assist-demo** 是从 `C:\Users\74062\Desktop\webot-main` 抽离的 demo 项目，路径 `C:\Users\74062\Desktop\wx-assist-demo`。

**核心原则**: 改动 demo 项目时，**永远不要改动 webot-main 项目**。

**demo 的定位**: 脱离微信的独立可运行应用，但 AI/调度/告警功能必须真实可用。微信数据层（WCDB、消息轮询、窗口操控）用模拟数据替代。

---

## 二、技术方案

**用 Python 后端替换了原来的 Node.js mock server**，因为 AI 后端（summarize 模块）是 Python，移植无意义。

### 启动方式

```powershell
cd C:\Users\74062\Desktop\wx-assist-demo
pip install -r requirements.txt       # 依赖: anthropic, openai, python-dotenv, requests, pydantic, httpx
python server.py                      # 启动后端，http://127.0.0.1:7327
```

**前端构建**（如果需要重新构建）:
```powershell
cd ui-src && npm install && npm run build && cd ..
# 构建输出到 dist/ 目录
```

---

## 三、项目文件结构

```
wx-assist-demo/
├── server.py                     # ⭐ Python 后端入口 (替换了 server.js)
├── DESIGN.md                     # 原始设计方案文档
├── DEVGUIDE.md                   # ⭐ 本文档 — 开发指南
├── requirements.txt              # Python 依赖
├── .env.example                  # 配置模板
├── .gitignore                    # 排除 __pycache__/, data/*.log, data/.env 等
├── dist/                         # 前端构建输出 (React SPA)
├── mock/                         # 模拟数据 (JSON, 前端兼容)
│   ├── ai-responses.json         #   AI mock 响应 (无 API Key 时的回退)
│   ├── assistant-config.json     #   助手配置默认值
│   ├── chat-messages.json        #   聊天消息 (keyed by talker ID)
│   ├── chat-sessions.json        #   会话列表 (8个会话, 已有ok/data包装)
│   ├── config.json               #   Bot 配置默认值
│   ├── favorites.json            #   收藏列表 (已有ok/data/total包装)
│   ├── fav-tags.json             #   收藏标签
│   ├── logs.json                 #   日志条目
│   ├── moments.json              #   朋友圈
│   ├── nickname-groups.json      #   群成员昵称
│   ├── notifications.json        #   通知
│   ├── oa-accounts.json          #   公众号账号
│   ├── oa-groups.json            #   OA 群组
│   ├── scheduled-tasks.json      #   定时任务
│   └── status.json               #   状态
├── data/                         # 运行时数据 (gitignore)
│   ├── .env                      #   实际配置文件
│   ├── assistant_config.json     #   助手配置持久化
│   └── demo.log                  #   日志文件
├── ui-src/                       # 前端源码 (React 19 + Vite 8 + Tailwind 4)
│   ├── src/components/
│   │   ├── SharedComponents.jsx  #   API_BASE='' (空=同源), UI组件库
│   │   ├── AIChatPanel.jsx       #   AI对话面板, SSE streaming, hoisted state
│   │   ├── ChatDrawer.jsx        #   滑入式抽屉
│   │   ├── Dashboard.jsx         #   仪表盘
│   │   ├── ConfigPanel.jsx       #   配置面板 (AI/身份/数据路径)
│   │   ├── AssistantPanel.jsx    #   助手面板 (关键词告警/定时摘要/通知)
│   │   ├── ChatTab.jsx           #   会话管理 + AI 对话
│   │   ├── FavoritesTab.jsx      #   收藏 + AI 对话
│   │   ├── MomentsTab.jsx        #   朋友圈
│   │   ├── OATab.jsx             #   公众号
│   │   ├── LogViewer.jsx         #   日志查看器
│   │   ├── SchedulerPanel.jsx    #   调度任务面板
│   │   └── ...                   #   其他组件
│   └── App.jsx                   #   主应用 (sidebar, tabs, WebSocket)
├── src/                          # ⭐ Python 后端源码
│   ├── __init__.py
│   ├── config.py                 #   配置加载 (.env -> BotConfig)
│   ├── summarize/                #   AI 后端 (从 webot-main 复制, 零改动)
│   │   ├── __init__.py           #     create_summarizer(config) 工厂
│   │   ├── base.py               #     AbstractSummarizer (chat/summarize/stream)
│   │   ├── claude_backend.py     #     ClaudeSummarizer (Anthropic SDK)
│   │   ├── deepseek_backend.py   #     OpenAICompatSummarizer (OpenAI SDK)
│   │   ├── models.py             #     SummaryResult Pydantic model
│   │   ├── prompts.py            #     所有 prompt 模板
│   │   └── provider_detector.py  #     AI Provider 自动检测
│   ├── utils/
│   │   ├── logging_config.py     #   日志配置
│   │   └── llm_logger.py         #   LLM 交互日志
│   └── demo/                     #   Demo 专用模块
│       ├── __init__.py
│       └── digest_scheduler.py   #   定时摘要调度器 (cron匹配 + AI调用)
└── server.js                     # ⚠️ 已被 server.py 替代, 仍保留作参考
```

---

## 四、server.py 架构详解

### 4.1 核心组件

| 组件 | 变量名 | 说明 |
|---|---|---|
| 状态 | `status: ServerStatus` | 线程安全状态, `to_dict()` 返回 JSON, `start()/stop()` 控制 |
| WS 客户端 | `_ws_clients: list` | WebSocket 连接列表, `ws_broadcast()` 广播 |
| AI 后端 | `_summarizer` | 懒初始化, `get_summarizer()` 创建, `reset_summarizer()` 重置 |
| AI 会话 | `_ai_sessions: dict` | session_id -> {messages, chat_id, context_type, ...} |
| 通知队列 | `_notifications: list` | 内存中通知列表, `add/get/ack/ignore_notification()` |
| 调度器 | `_digest_scheduler` | `DemoDigestScheduler` 实例, bot start/stop 时启停 |
| Mock 数据 | `_mock_cache: dict` | JSON 文件缓存, `load_mock(name)` 加载 |

### 4.2 请求处理

`DemoHandler(BaseHTTPRequestHandler)` 处理所有请求:
- **GET /api/*** → `_handle_api_get(path, params)`
- **POST /api/*** → `_handle_api_post(path)`
- **PUT /api/*** → `_handle_api_put(path)`
- **DELETE /api/*** → `_handle_api_delete(path)`
- **GET /ws** → WebSocket upgrade (`_handle_ws_upgrade()`)
- **其他 GET** → 静态文件服务 (`_serve_static_file()`, SPA fallback)

### 4.3 SSE 流式 AI 对话

关键流程:
1. `POST /api/ai/chat/start` → 创建 session, 返回 session_id
2. `POST /api/ai/chat/message` → SSE 流式响应:
   - 有 AI 后端: `_stream_ai_response()` → 调用 `summarizer._call_chat_api_stream()` → 逐 token 发送 SSE event
   - 无 AI 后端: `_stream_mock_response()` → 从 `ai-responses.json` 随机抽取, 逐字发送
3. SSE 格式: `event: token\ndata: "文本"\n\n` / `event: done\ndata: ""\n\n` / `event: error\ndata: "错误"\n\n`

### 4.4 Mock 数据兼容性

部分 mock JSON 已经有 `{ok: true, data: [...]}` 包装, 处理方式:
```python
data = load_mock("chat-sessions") or {}
if isinstance(data, dict) and "ok" in data:
    self._send_json(data)  # 直接传透
else:
    self._send_json({"ok": True, "data": data})  # 包装
```

已这样处理的端点: `/api/chat/sessions`, `/api/fav/list`, `/api/sns/timeline`

### 4.5 WebSocket 帧编码

已修复 >125 字节帧编码 bug:
```python
def _ws_encode_text_frame(payload: bytes) -> bytes:
    length = len(payload)
    if length <= 125:
        return b'\x81' + bytes([length]) + payload
    elif length <= 65535:
        return b'\x81' + b'\x7e' + length.to_bytes(2, 'big') + payload
    else:
        return b'\x81' + b'\x7f' + length.to_bytes(8, 'big') + payload
```

---

## 五、src/config.py 适配说明

Demo 版与 webot-main 版的关键差异:
1. **AI Key 不强制** — `load_config()` 不抛异常, 没有 Key 也返回 BotConfig
2. **去掉微信字段** — `wechat_backend`, `wechat_data_dir`, `wechat_groups` 简化
3. **.env 搜索路径** — 优先 `data/.env`, 然后 `PROJECT_ROOT/.env`, 然后 `cwd/.env`
4. **demo_mode: bool = True** — 新增标志位

---

## 六、src/demo/digest_scheduler.py 详解

### 初始化参数

```python
DemoDigestScheduler(
    mock_messages_func=lambda: load_mock("chat-messages") or {},
    add_notification_func=add_notification,
    ws_broadcast_func=ws_broadcast,
    get_summarizer_func=get_summarizer,
    load_assistant_config_func=load_assistant_config,
    server_status=status,
)
```

### 调度逻辑

1. 60秒轮询, 读取 `assistant_config.json` 的 `digest_groups`
2. 对每个 enabled 的 group, 检查 cron 表达式或 HH:MM 格式
3. 匹配时, 启动新线程执行 `_run_digest()`
4. 防重复: 同一 group_key 60秒内不重复触发

### Cron 匹配

`_match_cron(expr, now)` 支持: `*`, `*/15`, `1-5`, `1,3,5`, `1-5/2`

### Digest 执行

1. 从 mock_messages 取数据
2. 转换为 summarizer 格式 `{sender_name, content, timestamp, msg_type}`
3. 有 custom_prompt → `_call_digest_api()` 单次调用
4. 无 custom_prompt → `summarize()` Map-Reduce
5. 结果 → 通知队列 + WebSocket 广播 `digest_result` 事件

---

## 七、已完成的 API 端点清单

### Bot 控制
| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/start` | POST | ✅ 启动 status + 初始化 AI + 启动调度器 |
| `/api/stop` | POST | ✅ 停止 status + 停止调度器 |
| `/api/status` | GET | ✅ 返回 ServerStatus.to_dict() |

### 配置
| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/load-config` | GET | ✅ 读 .env -> BotConfig, 掩码 API Key |
| `/api/config` | POST | ✅ 写 .env (原子), reset_summarizer() |
| `/api/assistant/config` | GET | ✅ 读 data/assistant_config.json |
| `/api/assistant/config` | PUT | ✅ 写 data/assistant_config.json |

### AI
| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/ai/chat/start` | POST | ✅ 创建 AI 会话 |
| `/api/ai/chat/message` | POST | ✅ SSE 流式 (真实AI/mock回退) |
| `/api/ai/chat/compress` | POST | ✅ 简单压缩 (保留首2末2消息) |
| `/api/ai/chat/destroy` | POST | ✅ 销毁会话 |
| `/api/ai/chat/history` | GET | ✅ 获取会话历史 |
| `/api/assistant/ai/detect` | POST | ✅ 真实 ProviderDetector 探测 |
| `/api/sandbox/test` | POST | ✅ 真实 AI 调用 |
| `/api/assistant/digest/run` | POST | ✅ 真实 AI 摘要 (mock数据) |

### 告警 & 通知
| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/assistant/notifications` | GET | ✅ 查询通知列表 |
| `/api/assistant/notifications/pending` | GET | ✅ 待处理通知 |
| `/api/assistant/notifications/test` | POST | ✅ 创建测试通知 |
| `/api/assistant/notifications/{id}/ack` | POST | ✅ 确认通知 |
| `/api/assistant/notifications/{id}/ignore` | POST | ✅ 忽略通知 |
| `/api/demo/inject-message` | POST | ✅ 注入消息+关键词匹配 |

### 调度
| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/scheduler/tasks` | GET | ✅ 从 assistant_config 读取 |
| `/api/scheduler/tasks` | POST | ✅ 添加调度任务 |
| `/api/scheduler/tasks/{id}` | DELETE | ✅ 删除调度任务 |

### 数据 (mock)
| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/chat/sessions` | GET | ✅ 传透 mock JSON |
| `/api/chat/messages` | GET | ✅ 按 talker 参数查询 |
| `/api/fav/list` | GET | ✅ 传透 mock JSON |
| `/api/fav/tags` | GET | ✅ mock |
| `/api/sns/timeline` | GET | ✅ 传透 mock JSON |
| `/api/oa/accounts` | GET | ✅ mock |
| `/api/oa/groups` | GET | ✅ mock |
| `/api/nicknames/groups` | GET | ✅ mock |

### 其他
| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/logs` | GET | ✅ 读 data/demo.log |
| `/api/onboarding/*` | POST | ✅ Step3 保存AI配置+测试连通性 |
| `/api/onboarding/diagnose` | GET | ✅ 系统诊断 |
| `/api/lots` | GET | ✅ 返回空配置 |
| `/api/browse` | GET | ✅ 返回空 |
| `/api/wechat-data-dir/detect` | GET | ✅ 返回 demo 用户 |
| `/api/ilink/*` | GET/POST | ✅ 返回 "Demo 模式不支持" |
| `/api/image/*`, `/api/chat/image`, `/api/fav/image` | GET | ✅ SVG 占位 |
| `/api/voice/*`, `/api/fav/voice/*` | GET | ✅ 404 |
| `/api/sns/video/*` | GET | ✅ 404 |
| `/api/chat/export` | POST | ✅ "Demo 不支持导出" |
| `/api/fav/export` | POST | ✅ "Demo 不支持导出" |
| `/api/export/open-folder` | POST | ✅ 返回空路径 |

---

## 八、待完成功能 (P2-P3)

### P2 — 增强体验

1. **消息注入面板 (前端 UI)**
   - 在 Dashboard.jsx 增加「发送测试消息」面板
   - 下拉选择群聊、发言者、文本输入
   - 调用 `POST /api/demo/inject-message`
   - 显示关键词命中结果

2. **剧本回放**
   - `src/demo/scenario.py` — 预设对话剧本
   - 定时释放消息到系统, 触发告警和调度
   - WebSocket 推送 `inject_message` 事件

3. **OA 摘要 (模拟文章 + 真实 AI)**
   - `POST /api/oa/digest/run/:id` 改为调用真实 AI
   - mock oa-accounts.json 增加文章内容

4. **iLink 推送 (可选)**
   - 不依赖微信, 可以完整实现
   - 需要用户自行注册 iLink 账号

### P3 — 打磨

1. 错误处理 & 重试完善
2. Onboarding 流程适配 demo 模式
3. 前端 ConfigPanel 适配 demo 字段
4. 日志查看器对接 data/demo.log

---

## 九、关键踩坑记录

### 9.1 WebSocket 帧编码 (>125字节)
**问题**: `bytes([len(payload)])` 当 payload > 125 时溢出
**修复**: `_ws_encode_text_frame()` 支持 125/65535/大帧三种编码

### 9.2 Mock JSON 双重包装
**问题**: chat-sessions.json 已有 `{ok, data, ...}` 包装, 又被套了 `{ok, sessions: ...}`
**修复**: 检查 `"ok" in data` → 直接传透, 否则包装

### 9.3 get_summarizer() 在无 Key 时抛异常
**问题**: OpenAI SDK 构造函数校验 api_key, 空 key 抛 OpenAIError
**修复**: get_summarizer() 捕获异常返回 None, 调用方检查 None 后回退到 mock

### 9.4 _handle_bot_start 空响应
**问题**: 异常在 handler 方法内未被捕获, Python BaseHTTPRequestHandler 默默关闭连接
**修复**: 整个 handler 方法外层 try/except, 确保 _send_json 被调用

---

## 十、Git 提交历史

```
d8071ab feat: Python后端替换Node.js mock — 真实AI/配置/调度/告警
```

---

## 十一、从 webot-main 复用的文件清单

| 文件 | 改动 |
|---|---|
| `src/summarize/base.py` | 零改动 |
| `src/summarize/claude_backend.py` | 零改动 |
| `src/summarize/deepseek_backend.py` | 零改动 |
| `src/summarize/models.py` | 零改动 |
| `src/summarize/prompts.py` | 零改动 |
| `src/summarize/provider_detector.py` | 零改动 |
| `src/utils/logging_config.py` | 零改动 |
| `src/utils/llm_logger.py` | 零改动 |
| `src/config.py` | 大幅精简: 去微信字段, AI Key 非强制, .env 路径调整 |
