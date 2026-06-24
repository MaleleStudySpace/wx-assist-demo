# 微信助手 Demo — 技术开发文档

> 本文档面向开发者，分模块讲解后端架构、数据流、API 实现、前端组件及构建流程。

---

## 目录

1. [项目架构总览](#1-项目架构总览)
2. [后端架构](#2-后端架构)
3. [API 路由表](#3-api-路由表)
4. [核心模块详解](#4-核心模块详解)
5. [前端架构](#5-前端架构)
6. [数据流图](#6-数据流图)
7. [Mock 数据系统](#7-mock-数据系统)
8. [构建与部署](#8-构建与部署)
9. [配置系统](#9-配置系统)

---

## 1. 项目架构总览

```
wx-assist-demo/
├── server.py                # 后端入口：HTTP 服务器 + 所有 API 处理逻辑
├── build.js                 # 前端构建脚本
├── package.json             # Node.js 依赖（Express 用于构建时）
├── dist/                    # 前端构建输出（Vite → 静态文件）
├── data/                    # 运行时数据
│   ├── .env                 # 环境变量（AI Key 等）
│   ├── assistant_config.json # 助手配置（用户修改后持久化到这里）
│   ├── ilink_account.json   # iLink Bot 绑定信息
│   └── demo.log             # 运行日志
├── mock/                    # Mock 数据（所有前端展示的数据源）
├── ui-src/                  # 前端源码
│   ├── src/
│   │   ├── main.jsx         # React 入口
│   │   ├── App.jsx          # 主应用（路由 + Tab 切换）
│   │   └── components/      # React 组件
│   └── vite.config.js       # Vite 配置
├── src/                     # Python 模块
│   ├── config.py            # 配置加载（.env → BotConfig）
│   ├── demo/                # Demo 专用模块
│   │   ├── scenario.py      # 剧本回放引擎
│   │   ├── digest_scheduler.py # 定时摘要调度器
│   │   └── ilink_push.py    # iLink Bot 推送通道
│   ├── summarize/           # AI 摘要模块
│   │   ├── base.py          # AbstractSummarizer 基类
│   │   ├── deepseek_backend.py  # DeepSeek 实现
│   │   ├── claude_backend.py    # Claude 实现
│   │   ├── provider_detector.py # AI Provider 自动检测
│   │   ├── prompts.py       # 提示词模板
│   │   └── models.py        # SummaryResult 数据模型
│   └── utils/
│       ├── logging_config.py # 日志配置
│       └── llm_logger.py    # LLM 交互日志
└── docs/                    # 文档
```

**关键设计决策**：
- 单文件服务器（`server.py`）包含所有 API 处理逻辑，降低 Demo 项目复杂度
- Mock 数据系统替代真实微信数据库，所有 `load_mock()` 读取 JSON 文件
- AI 调用是真实的（调用 DeepSeek/Claude API），仅数据源是 Mock

---

## 2. 后端架构

### 2.1 HTTP 服务器

```
ThreadingHTTPServer (127.0.0.1:7328)
  └── DemoHandler (BaseHTTPRequestHandler)
       ├── do_GET()   → 静态文件 / WebSocket / API GET
       ├── do_POST()  → API POST
       ├── do_PUT()   → API PUT
       └── do_DELETE() → API DELETE
```

**线程模型**：
- 主线程：HTTP 服务器事件循环
- Daemon 线程 1：`DemoDigestScheduler` — 每 60s 检查定时任务
- Daemon 线程 2：`_status_broadcast_loop` — 每 5s 通过 WebSocket 广播状态
- 临时线程：`ScenarioPlayer` 回放线程、Digest 生成线程

### 2.2 WebSocket

路径 `/ws`，升级协议为 WebSocket。

**广播消息类型**：

| 事件 | 触发 | 数据 |
|------|------|------|
| `status` | 每 5s 定时广播 | `{type: "status", running, db_ok, ...}` |
| `scenario_message` | 剧本回放每条消息 | `{event, chat_id, sender, content, keyword_hits}` |
| `scenario_finished` | 剧本回放结束 | `{event, chat_id}` |
| `digest_result` | 定时摘要完成 | `{event, group_name, chat_id, summary, notification_id}` |
| `digest_push_result` | 摘要推送结果 | `{type, success, group_name, error}` |
| `oa_digest_result` | 公众号摘要完成 | `{event, template, summary}` |
| `oa_digest_progress` | 公众号摘要进度 | `{type, status, progress}` |
| `oa_digest_push_result` | 公众号推送结果 | `{type, success, group_name, error}` |

### 2.3 通知系统

```python
_notifications: list[dict]  # 全局内存队列

# 通知结构
{
    "id": int,                  # 自增 ID
    "type": str,                # keyword_alert | digest | oa_digest
    "status": str,              # pending | delivered | ignored | failed
    "title": str,               # 通知标题
    "content": str,             # 通知正文
    "chat_id": str,             # 来源群聊 ID
    "group_name": str,          # 来源群聊名
    "priority": str,            # high | normal | low
    "push_status": str,         # not_pushed | delivered | failed
    "push_time": str | None,    # 推送时间
    "push_error": str | None,   # 推送失败原因
    "created_at": str,          # 创建时间
}
```

**通知生命周期**：

```
add_notification() → status=pending, push_status=not_pushed
  │
  ├─ push_target="ilink" 且 iLink 已绑定
  │   ├─ ILinkPush.send_message() 成功 → push_status=delivered, push_time=now
  │   └─ ILinkPush.send_message() 失败 → push_status=failed, push_error=reason
  │
  └─ push_target="" → 保持 not_pushed（不出现在推送记录中）

用户操作：
  ├─ ack_notification() → status=delivered
  └─ ignore_notification() → status=ignored
```

### 2.4 配置持久化

```
load_assistant_config()
  ├─ data/assistant_config.json 存在 → 读取
  ├─ 不存在 → mock/assistant-config.json → 读取
  └─ 都不存在 → 硬编码默认值（含预设关键词提醒）

save_assistant_config(data)
  └─ 写入 data/assistant_config.json
```

**前端自动保存**：配置变更后 500ms 防抖 → `PUT /api/assistant/config` → `save_assistant_config()` 写磁盘。`beforeunload` 事件刷新前强制保存。

---

## 3. API 路由表

### GET 请求

| 路径 | 处理函数 | 数据源 | 说明 |
|------|----------|--------|------|
| `/api/status` | 内联 | `ServerStatus` 实时数据 | 服务状态 |
| `/api/load-config` | `_handle_load_config` | `data/.env` + `BotConfig` | 加载系统配置 |
| `/api/config/export` | `_handle_config_export` | 运行时配置 | 导出配置 JSON |
| `/api/logs` | `_handle_get_logs` | `data/demo.log` | 日志（最后 500 行） |
| `/api/chat/sessions` | 内联 | `mock/chat-sessions.json` | 会话列表 |
| `/api/chat/messages` | `_handle_chat_messages` | `mock/chat-messages.json` | 聊天消息 |
| `/api/chat/members` | 内联 | `mock/chat-sessions.json` | 群成员 |
| `/api/chat/common-groups` | 内联 | `mock/chat-sessions.json` | 共同群聊 |
| `/api/fav/list` | 内联 | `mock/favorites.json` | 收藏列表 |
| `/api/fav/tags` | 内联 | `mock/fav-tags.json` | 收藏标签 |
| `/api/sns/timeline` | 内联 | `mock/moments.json` | 朋友圈时间线 |
| `/api/sns/protect/status` | 内联 | 硬编码 | 朋友圈保护状态 |
| `/api/sns/search` | 内联 | `mock/moments.json` | 朋友圈搜索 |
| `/api/oa/accounts` | 内联 | `mock/oa-accounts.json` | 公众号列表 |
| `/api/oa/groups` | 内联 | `mock/oa-groups.json` | OA 摘要分组 |
| `/api/oa/articles` | 内联 | `mock/oa-articles.json` | 公众号文章 |
| `/api/oa/search` | 内联 | `mock/oa-articles.json` | 公众号文章搜索 |
| `/api/assistant/config` | 内联 | `load_assistant_config()` | 助手配置 |
| `/api/assistant/notifications` | 内联 | `_notifications` 队列 | 通知列表 |
| `/api/assistant/notifications/pending` | 内联 | `_notifications` 筛选 pending | 待投递通知 |
| `/api/nicknames/groups` | 内联 | `mock/nickname-groups.json` | 群聊下拉列表 |
| `/api/nicknames` | 内联 | `data/nicknames.json` | 自定义昵称 |
| `/api/scheduled-tasks` | `_handle_get_scheduler_tasks` | assistant_config + oa-groups | 定时任务列表 |
| `/api/ai/chat/history` | `_handle_ai_chat_history` | `_ai_chat_sessions` 内存 | AI 对话历史 |
| `/api/lots` | 内联 | 硬编码 | 抽签功能 |
| `/api/onboarding/status` | 内联 | `ONBOARDING_DONE` env | 引导流程状态 |
| `/api/onboarding/diagnose` | `_handle_onboarding_diagnose` | 运行时检查 | 诊断检查 |
| `/api/wechat-data-dir/detect` | 内联 | 硬编码 | 数据目录检测 |
| `/api/browse` | 内联 | 硬编码 | 文件浏览 |
| `/api/ilink/status` | 内联 | `ILinkPush.get_status()` | iLink 绑定状态 |
| `/api/ilink/push-history` | `_handle_push_history` | `_notifications` | 推送记录 |
| `/api/ilink/qrcode` | 内联 | `ILinkPush.get_qrcode()` | 获取 iLink 二维码 |
| `/api/ilink/qrcode-status` | 内联 | `ILinkPush.check_qrcode_status()` | 二维码扫描状态 |
| `/api/demo/scenario/status` | 内联 | `ScenarioPlayer.running` | 剧本回放状态 |
| `/api/image/*` | 内联 | 占位图 | 图片代理 |
| `/api/voice/*` | 内联 | 硬编码 | 语音代理 |
| `/api/sns/video/*` | 内联 | 硬编码 | 视频代理 |

### POST 请求

| 路径 | 处理函数 | 说明 |
|------|----------|------|
| `/api/start` | `_handle_bot_start` | 启动助手服务 |
| `/api/stop` | `_handle_bot_stop` | 停止助手服务 |
| `/api/config` | `_handle_save_config` | 保存系统配置 |
| `/api/config/import` | `_handle_config_import` | 导入配置 |
| `/api/ai/chat/start` | `_handle_ai_chat_start` | 创建 AI 对话会话 |
| `/api/ai/chat/message` | `_handle_ai_chat_message` | 发送 AI 对话消息（流式） |
| `/api/ai/chat/compress` | `_handle_ai_chat_compress` | 压缩 AI 对话历史 |
| `/api/ai/chat/destroy` | `_handle_ai_chat_destroy` | 销毁 AI 对话会话 |
| `/api/assistant/ai/detect` | `_handle_ai_detect` | AI Provider 自动检测 |
| `/api/assistant/digest/run` | `_handle_digest_run` | 手动触发群聊摘要 |
| `/api/oa/digest/run` | `_handle_oa_digest_run` | 手动触发公众号摘要 |
| `/api/oa/digest/run/{id}` | `_handle_oa_digest_run` | 按分组触发公众号摘要 |
| `/api/sandbox/test` | `_handle_sandbox_test` | 沙盒测试 |
| `/api/assistant/notifications/test` | `_handle_notification_test` | 创建测试通知 |
| `/api/assistant/notifications/{id}/ack` | 内联 | 标记通知已投递 |
| `/api/assistant/notifications/{id}/ignore` | 内联 | 忽略通知 |
| `/api/chat/export` | 内联 | 导出聊天记录 |
| `/api/fav/export` | 内联 | 导出收藏（Demo 不支持） |
| `/api/export/open-folder` | 内联 | 打开导出文件夹 |
| `/api/onboarding/step*` | `_handle_onboarding_step` | 引导流程步骤 |
| `/api/onboarding/reset` | 内联 | 重置引导流程 |
| `/api/scheduler/tasks` | `_handle_create_scheduler_task` | 创建定时任务 |
| `/api/demo/inject-message` | `_handle_inject_message` | 注入消息 |
| `/api/demo/scenario/start` | `_handle_scenario_start` | 启动剧本回放 |
| `/api/demo/scenario/stop` | `_handle_scenario_stop` | 停止剧本回放 |
| `/api/ilink/test-push` | `_handle_ilink_test_push` | 测试 iLink 推送 |
| `/api/ilink/unbind` | 内联 | 解绑 iLink |
| `/api/oa/groups/create` | `_handle_oa_group_create` | 创建 OA 分组 |

### PUT 请求

| 路径 | 处理函数 | 说明 |
|------|----------|------|
| `/api/assistant/config` | 内联 | 更新助手配置 |
| `/api/oa/groups/{id}` | `_handle_oa_group_update` | 更新 OA 分组 |

### DELETE 请求

| 路径 | 处理函数 | 说明 |
|------|----------|------|
| `/api/scheduler/tasks/{id}` | `_handle_delete_scheduler_task` | 删除定时任务 |
| `/api/oa/groups/{id}` | `_handle_oa_group_delete` | 删除 OA 分组 |

---

## 4. 核心模块详解

### 4.1 ScenarioPlayer (`src/demo/scenario.py`)

**职责**：按预设剧本回放对话，触发关键词检测。

```python
class ScenarioPlayer:
    def __init__(inject_func, ws_broadcast_func, status_update_func)
    def start(scenario_name, chat_id, speed, loop) -> dict
    def stop()
    def _run(script, chat_id, speed_mult, loop)  # 内部线程
```

**内置剧本**：
- `default`：12 条消息，4 个角色，从早安到 BUG 紧急到修复
- `tech_discuss`：7 条消息，技术讨论场景

**速度倍率**：`fast=0.3x`, `normal=1x`, `slow=2x`

**线程安全**：`_running` 标志位 + `stop()` 时 `join(timeout=3)` 等待线程退出。

### 4.2 DemoDigestScheduler (`src/demo/digest_scheduler.py`)

**职责**：后台定时检查 cron 表达式，触发 AI 摘要。

```python
class DemoDigestScheduler:
    def start()         # 启动 daemon 线程
    def stop()          # 停止
    def _run_loop()     # 每 60s 循环
    def _check_and_trigger()  # 检查所有 digest_groups
    def _run_digest(group_config)  # 单个群摘要生成
```

**Cron 匹配**：5 字段标准 cron（分 时 日 月 周），支持 `*`、范围 `1-5`、步长 `*/15`、列表 `1,3,5`。

**防重复**：`_last_run` 字典记录每个群上次触发时间，60 秒内不重复触发。

**摘要生成流程**：
1. 读取 mock 消息数据
2. 按 `lookback_hours` 过滤（Mock 数据不严格过滤时间戳）
3. 调用 `summarizer.summarize()` 或自定义提示词路径
4. 结果写入通知队列 + WebSocket 广播

### 4.3 ILinkPush (`src/demo/ilink_push.py`)

**职责**：通过 iLink Bot API 将消息推送到微信。

```python
class ILinkPush:
    def is_available() -> bool
    def get_status() -> dict
    def get_qrcode() -> dict
    def check_qrcode_status(qrcode_id) -> dict
    def send_message(text) -> dict
    def unbind()
    def reload()
```

**发送机制**：
- 速率限制：2.5s 最小间隔
- 消息截断：4000 字符
- 重试策略：3 次，指数退避（3s → 6s → 12s）
- 会话过期检测：`errcode == -14` → 返回 `session_expired`
- 限流重试：`ret == -2` → 触发重试

**账号持久化**：`data/ilink_account.json`，原子写入（tmp → replace）。

### 4.4 AI Summarizer (`src/summarize/`)

**架构**：

```
AbstractSummarizer (base.py)
  ├── DeepSeekSummarizer (deepseek_backend.py)
  └── ClaudeSummarizer (claude_backend.py)
```

**核心方法**：
- `summarize(messages, requester_name)` → `SummaryResult` — 结构化 map-reduce 摘要
- `_call_long_api(system_prompt, messages, max_tokens, temperature)` — 长文本 API 调用
- `_call_digest_api(system_prompt, messages)` — 摘要专用 API 调用
- `consolidate_memory(existing_memory, new_messages)` — 记忆合并

**摘要策略**：
- 消息少于 `chunk_size` 条 → 直接摘要
- 消息多于 `chunk_size` 条 → 分 chunk 摘要 → 合并 chunk 摘要
- 合并批次：`merge_batch_size = 5`

### 4.5 ProviderDetector (`src/summarize/provider_detector.py`)

**三步探测**：

1. `GET {base}/v1/models` → 解析响应格式
   - `{"object": "list", "data": [...]}` → OpenAI
   - `{"data": [...]}` → Anthropic
2. `POST {base}/v1/chat/completions` 最小请求 → 200/400 = OpenAI 兼容
3. `POST {base}/v1/messages` 最小请求 → 200/400 = Anthropic 兼容

**返回**：`ProviderInfo(provider_type, available_models, error)`

### 4.6 Config (`src/config.py`)

**BotConfig 数据类字段**：

| 字段 | 环境变量 | 默认值 |
|------|----------|--------|
| `ai_backend` | `AI_BACKEND` | `deepseek` |
| `deepseek_api_key` | `DEEPSEEK_API_KEY` | `""` |
| `deepseek_base_url` | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `deepseek_model` | `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
| `anthropic_api_key` | `ANTHROPIC_API_KEY` | `""` |
| `ai_provider_base_url` | `AI_PROVIDER_BASE_URL` | `""` |
| `ai_provider_api_key` | `AI_PROVIDER_API_KEY` | `""` |
| `ai_provider_type` | `AI_PROVIDER_TYPE` | `auto` |
| `ai_provider_model` | `AI_PROVIDER_MODEL` | `""` |
| `bot_display_name` | `BOT_DISPLAY_NAME` | `群聊小助手` |
| `demo_mode` | — | `True` |
| `log_level` | `LOG_LEVEL` | `INFO` |
| `log_file` | `LOG_FILE` | `data/demo.log` |

**.env 文件搜索顺序**：
1. `WEBOT_ENV_FILE` 环境变量指定的路径
2. `data/.env`
3. `.env`（项目根目录）
4. 当前工作目录 `.env`

**原子写入**：`write_env_atomic()` 使用文件锁（`msvcrt.locking`）防止并发写入冲突。

---

## 5. 前端架构

### 5.1 组件树

```
App.jsx
  ├── Onboarding.jsx          # 首次引导
  ├── Dashboard.jsx           # 首页
  │   ├── StatusTile          # 健康指标
  │   ├── KeywordAlertCard    # 关键词提醒预览
  │   ├── ScheduledTasksCard  # 定时任务预览
  │   └── KeyExtractionBanner # 密钥提取（Demo 不触发）
  ├── ChatTab.jsx             # 会话管理
  │   ├── ChatDrawer.jsx      # 聊天记录抽屉
  │   └── AIChatPanel.jsx     # AI 对话面板
  ├── FavoritesTab.jsx        # 收藏管理
  ├── MomentsTab.jsx          # 朋友圈
  ├── OATab.jsx               # 公众号助手
  │   ├── GroupCard           # 摘要分组卡片
  │   ├── GroupEditor         # 分组编辑器
  │   └── ArticleCard         # 文章卡片
  ├── AssistantPanel.jsx      # 群聊助手
  │   ├── ScenarioPanel       # 剧本回放
  │   ├── AlertGroupCard      # 关键词提醒卡片
  │   ├── AlertGroupEditor    # 关键词编辑器
  │   ├── DigestGroupCard     # 定时摘要卡片
  │   ├── DigestGroupEditor   # 摘要编辑器
  │   ├── ScheduleConfig      # 时间配置（频率+时间+Cron）
  │   ├── NotificationCard    # 通知卡片
  │   └── SearchableGroupSelect # 可搜索群聊下拉
  ├── ConfigPanel.jsx         # 系统配置
  │   └── PushSection         # 微信推送 + 推送记录
  ├── LogViewer.jsx           # 日志查看
  └── SharedComponents.jsx    # 共享组件（Toggle, Input, TagInput 等）
```

### 5.2 状态管理

**无全局状态库**，各组件自管理状态：

- `AssistantPanel`：`config` state + `configRef`（用于 beforeunload 保存）+ 防抖保存
- `OATab`：`accounts` + `groups` state，CRUD 操作更新 `_mock_cache`
- `AIChatPanel`：per-session `messages` state，会话隔离
- `Dashboard`：纯展示，无写操作

**跨组件通信**：
- `onTabChange` prop：Dashboard → 侧边栏切换 Tab
- WebSocket 广播：后端推送 → 前端 `window.__ws` 监听
- `localStorage`：部分 UI 状态（如侧边栏展开）

### 5.3 关键共享组件

| 组件 | 用途 |
|------|------|
| `Toggle` | 开关（brand-green 配色） |
| `Input` | 输入框（统一样式） |
| `TagInput` | 标签输入（关键词编辑） |
| `SectionHeader` | 区块标题（带色条 + 图标） |
| `API_BASE` | API 地址常量（`window.location.origin`） |

---

## 6. 数据流图

### 6.1 关键词提醒流程

```
剧本回放 / 消息注入
  → _do_inject(chat_id, sender, content)
    → 遍历 alert_groups，检查 content 是否包含 keywords
    → 命中 → add_notification(type="keyword_alert", ...)
      → 如果 push_target="ilink" → ILinkPush.send_message()
      → push_status 更新
    → ws_broadcast({event: "scenario_message", keyword_hits: [...]})
  → 前端 ScenarioPanel 显示命中标签
  → 前端 AssistantPanel 通知列表更新
```

### 6.2 定时摘要流程

```
DemoDigestScheduler._run_loop() (每60s)
  → _check_and_trigger()
    → 遍历 digest_groups
    → cron 匹配 → _run_digest(group_config)
      → load mock messages
      → summarizer.summarize(messages)
      → add_notification(type="digest", ...)
      → ws_broadcast({event: "digest_result"})
```

### 6.3 公众号摘要流程

```
前端 OATab.handleRunDigest(groupId)
  → POST /api/oa/digest/run/{groupId}
  → _handle_oa_digest_run(path)
    → 从 URL 提取 group_id
    → 从 oa-groups.json 找到目标分组
    → 从 oa-articles.json 读取该分组公众号的文章
    → 按 digest_template 选择提示词
    → AI API 生成摘要
    → add_notification(type="oa_digest", ...)
    → ws_broadcast({event: "oa_digest_result"})
    → 返回 {ok, articles_count, summary}
```

### 6.4 iLink 推送流程

```
通知产生时 (add_notification)
  → 检查 push_target == "ilink"
  → ILinkPush.send_message(content)
    → 速率限制等待（2.5s 间隔）
    → 构建消息 payload
    → POST {base_url}/ilink/bot/sendmessage
    → 失败重试（3次，指数退避）
    → 返回 {success, error}
  → 更新 push_status / push_time / push_error
```

---

## 7. Mock 数据系统

### 7.1 加载机制

```python
_mock_cache: dict[str, Any] = {}

def load_mock(name: str):
    """加载 mock/{name}.json，带缓存。"""
    if name in _mock_cache:
        return _mock_cache[name]
    path = MOCK_DIR / f"{name}.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        _mock_cache[name] = data
        return data
    return None

def invalidate_mock(name: str):
    """清除缓存，下次重新从文件读取。"""
    _mock_cache.pop(name, None)
```

### 7.2 数据格式规范

所有 mock JSON 文件遵循两种格式：

**格式 A：带 ok 包装**（用于列表接口）
```json
{
  "ok": true,
  "data": [...]
}
```

**格式 B：无包装**（用于键值映射）
```json
{
  "gh_technology_daily": [...],
  "gh_ai_frontier": [...]
}
```

### 7.3 运行时修改

OA 分组的 CRUD 操作修改 `_mock_cache`（内存），不写回文件。重启后恢复到 `mock/*.json` 的原始状态。

助手配置（`assistant_config`）的修改通过 `save_assistant_config()` 写入 `data/assistant_config.json`，重启后仍生效。

---

## 8. 构建与部署

### 8.1 前端构建

```bash
node build.js
```

**构建流程**：
1. 复制 `ui-src/` → `ui-temp/`
2. 在 `ui-temp/` 执行 `npm install && npm run build`
3. Vite 配置 `outDir: '../dist'`（相对于 ui-temp），直接输出到项目 `dist/`

**Vite 配置要点**：
- `outDir: path.resolve(__dirname, '../../dist')` — 输出到项目 dist
- `server.proxy` — 开发时代理 `/api` 和 `/ws` 到后端
- `build.chunkSizeWarningLimit: 1000` — 抑制大包警告

### 8.2 静态文件服务

`DemoHandler` 的 `do_GET` 方法：
- `/api/*` → API 处理
- `/ws` → WebSocket 升级
- 其他 → 从 `dist/` 目录提供静态文件
- MIME 类型：`.html`, `.js`, `.css`, `.json`, `.png`, `.jpg`, `.svg`, `.ico`, `.woff2`

### 8.3 运行

```bash
# 源码模式
python server.py

# 自定义端口
DEMO_PORT=8080 python server.py
```

---

## 9. 配置系统

### 9.1 环境变量 (.env)

```env
# AI 后端
AI_BACKEND=deepseek
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

# 或统一 AI Provider
AI_PROVIDER_BASE_URL=https://api.example.com
AI_PROVIDER_API_KEY=sk-xxx
AI_PROVIDER_TYPE=auto
AI_PROVIDER_MODEL=deepseek-v4-flash

# Bot 设置
BOT_DISPLAY_NAME=群聊小助手
LOG_LEVEL=INFO
LOG_FILE=data/demo.log

# 引导完成标记
ONBOARDING_DONE=true

# 服务配置
DEMO_HOST=127.0.0.1
DEMO_PORT=7328
```

### 9.2 配置优先级

```
1. 环境变量（最高优先级）
2. data/.env 文件
3. 代码默认值（BotConfig dataclass defaults）
```

### 9.3 助手配置 (assistant_config.json)

```json
{
  "config": {
    "version": 1,
    "assistant_enabled": true,
    "allow_wechat_send": false,
    "alert_groups": [
      {
        "chat_id": "12345678@chatroom",
        "group_name": "技术交流群",
        "keywords": ["紧急", "BUG", "线上问题"],
        "enabled": true
      }
    ],
    "digest_groups": [
      {
        "chat_id": "12345678@chatroom",
        "group_name": "技术交流群",
        "schedule": ["09:00"],
        "cron_expr": "0 9 * * *",
        "lookback_hours": 6,
        "enabled": true,
        "unread_only": true,
        "push_target": "ilink",
        "profile": {
          "purpose": "技术交流",
          "description": "技术讨论群",
          "focus": ["技术问题", "代码分享"],
          "ignore": ["闲聊", "表情包"],
          "style": "简洁专业",
          "custom_prompt": ""
        }
      }
    ],
    "notification_queue": {
      "enabled": true,
      "retention_hours": 48
    },
    "outbox_retention_hours": 48
  }
}
```

### 9.4 OA 分组配置 (oa-groups.json)

```json
{
  "ok": true,
  "data": [
    {
      "id": "oa-group-1",
      "name": "科技资讯",
      "accounts": ["gh_technology_daily", "gh_ai_frontier"],
      "schedule": ["0 9 * * *"],
      "digest_template": "tech",
      "custom_prompt": "",
      "lookback_hours": 24,
      "lookback_mode": "auto",
      "push_target": "ilink",
      "enabled": true
    }
  ]
}
```

**注意**：OA 分组 CRUD 只修改内存缓存（`_mock_cache`），不持久化到文件。
