# wx-assist-demo 真实功能实现设计

## 核心原则

**demo 的定位：** 脱离微信的独立可运行应用，但所有「AI 相关」和「调度相关」功能必须真实可用。微信数据层（WCDB、消息轮询、窗口操控）是唯一被替换的部分——用模拟数据源替代。

## 一、当前状态 vs 目标状态

| 功能 | 当前 | 目标 |
|---|---|---|
| AI 对话（SSE 流式） | ❌ 假响应，随机抽取 canned 文本 | ✅ 真实调用 AI API，支持 DeepSeek/Claude/OpenAI 兼容 |
| AI Provider 配置 | ❌ 存了但不生效 | ✅ 真实写入 `.env`，真正生效 |
| AI Provider 自动检测 | ❌ 返回硬编码结果 | ✅ 真实探测 `/v1/models` → `/v1/chat/completions` → `/v1/messages` |
| 定时摘要调度 | ❌ 返回空数组 | ✅ 真实 cron 调度，到时触发 AI 调用 |
| 关键词告警 | ❌ 返回硬编码通知 | ✅ 真实匹配关键词，生成通知 |
| OA 摘要 | ❌ 返回假结果 | ✅ 真实 AI 摘要（模拟文章源） |
| 沙盒测试 | ❌ 返回固定文本 | ✅ 真实 AI 调用 |
| 配置持久化 | ❌ POST 不写入 | ✅ 真实写入 `.env`/JSON 文件 |
| WebSocket 状态推送 | ❌ 每 5 秒发固定 JSON | ✅ 真实状态变化时推送 |
| 聊天记录/收藏/朋友圈 | ❌ 静态 JSON | ⚠️ 保持模拟数据（无微信 DB），但 AI 对话可作用于这些数据 |
| iLink 推送 | ❌ 假的 | ⚠️ 可选实现（不需要微信，是独立 HTTP API） |
| 图片/语音/视频解密 | ❌ SVG 占位 | ⚠️ 不适用（无加密数据源），保持占位 |

## 二、技术方案选型

### 方案：Python 后端替换 Node.js mock server

**为什么不用 Node.js 继续做？**

1. webot-main 的 AI 后端（`src/summarize/`）是 Python 写的，包含 provider 检测、Map-Reduce 摘要、SSE 流式、token 管理、上下文压缩等复杂逻辑，**移植到 Node.js 工作量巨大且无意义**
2. 定时调度逻辑（`DigestScheduler` + `APScheduler`）也是 Python
3. 保持与主项目相同的 AI 调用路径，确保行为一致

**方案架构：**

```
wx-assist-demo/
├── server.py              # Python 后端 (替换 server.js)
├── src/                   # 从 webot-main 抽离的核心模块（精简版）
│   ├── config.py          # 配置系统（复用）
│   ├── summarize/         # AI 后端（复用）
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── claude_backend.py
│   │   ├── deepseek_backend.py
│   │   ├── models.py
│   │   ├── prompts.py
│   │   └── provider_detector.py
│   ├── scheduler/         # 定时调度（复用）
│   ├── web/               # Web 服务器（精简版，去掉微信相关端点）
│   │   ├── server.py
│   │   └── demo_api.py    # demo 专用的 API handler
│   ├── assistant/         # 助手系统（复用告警/摘要，去掉 iLink）
│   │   ├── alert_engine.py
│   │   └── digest_scheduler.py
│   └── demo/              # demo 专用模块
│       ├── mock_data.py   # 模拟数据源（替代 WCDB）
│       └── data_feed.py   # 模拟消息流（替代微信轮询）
├── ui-src/                # 前端源码（基本不变）
├── dist/                  # 构建输出
├── data/                  # 运行时数据
│   ├── .env               # 配置文件
│   ├── demo.db            # SQLite（消息/通知持久化）
│   └── assistant_config.json
└── requirements.txt       # Python 依赖（精简版）
```

### 关键设计：`src/demo/` — 模拟数据层

这是 demo 与主项目的核心差异点。主项目的数据来自 WCDB，demo 的数据来自 `mock_data.py`：

```python
# src/demo/mock_data.py
"""
模拟微信数据源 — 不依赖 WCDB，用 JSON/SQLite 提供相同结构的数据
"""

# 复用现有 mock/ 目录的 JSON 数据，但改为动态生成
# 会话列表 — 与主项目 /api/chat/sessions 返回结构一致
# 聊天消息 — 与主项目 /api/chat/messages 返回结构一致
# 收藏 — 与主项目 /api/fav/list 返回结构一致
# 朋友圈 — 与主项目 /api/sns/timeline 返回结构一致

# 关键：数据结构必须与 webot-main 的 API 返回格式完全一致
# 这样前端零改动
```

```python
# src/demo/data_feed.py
"""
模拟消息流 — 定时产生模拟聊天消息，触发 AI 处理
"""

class DemoDataFeed:
    """模拟微信消息轮询"""

    def __init__(self, mock_data, config):
        self.messages = []
        self._timer = None

    def start(self, callback):
        """启动模拟消息流，有新消息时调用 callback"""
        # 方案1: 基于预设剧本，按时间线释放消息
        # 方案2: 让用户在 UI 上手动输入消息（类似聊天界面）
        # 方案3: 定时从 mock 数据中随机抽取消息
        pass

    def stop(self):
        pass

    def inject_message(self, chat_id, sender, content):
        """手动注入消息 — 用于测试关键词告警和 AI 响应"""
        pass
```

## 三、各模块详细设计

### 3.1 AI 后端 — 真实可用

**直接复用** `src/summarize/` 的全部代码，零改动：

- `provider_detector.py` — 真实探测 AI Provider
- `claude_backend.py` — 真实调用 Claude API
- `deepseek_backend.py` — 真实调用 DeepSeek/OpenAI 兼容 API
- `prompts.py` — 真实 prompt 模板
- `base.py` — 摘要/对话/压缩/记忆整合逻辑

**需要的 Python 依赖：**
```
anthropic>=0.40.0
openai>=1.30.0
python-dotenv
```

**API 端点变化：**

| 端点 | 当前 (mock) | 改造后 |
|---|---|---|
| `POST /api/ai/chat/message` | 返回 canned 文本 | 真实 SSE 流式调用 AI API |
| `POST /api/ai/chat/start` | 返回假 session | 真实创建会话，关联 AI 后端 |
| `POST /api/ai/chat/compress` | 返回假结果 | 真实 AI 压缩上下文 |
| `POST /api/assistant/ai/detect` | 返回硬编码 | 真实 ProviderDetector 探测 |
| `POST /api/sandbox/test` | 返回固定文本 | 真实 AI 调用 |
| `POST /api/assistant/digest/run` | 返回假摘要 | 真实 AI Map-Reduce 摘要 |

### 3.2 配置持久化 — 真实读写

**复用** `src/config.py` 的 `BotConfig` + `write_env_atomic()`：

- `GET /api/load-config` → 真实读 `.env` 文件
- `POST /api/config` → 真实原子写入 `.env`
- `GET /api/assistant/config` → 真实读 `data/assistant_config.json`
- `PUT /api/assistant/config` → 真实写 `data/assistant_config.json`
- `POST /api/onboarding/step3` → 保存 AI 配置并立即测试连通性

### 3.3 定时摘要调度 — 真实 cron

**复用** `DigestScheduler` 核心逻辑，适配 demo 场景：

```python
# src/demo/demo_digest.py
class DemoDigestScheduler:
    """
    demo 版摘要调度器
    - 读取 assistant_config.json 中的 digest_groups 配置
    - 按cron表达式匹配调度时间
    - 到时触发：从 mock 数据取消息 → AI 摘要 → 推送通知
    """

    def __init__(self, mock_data, summarizer, config):
        self.mock_data = mock_data
        self.summarizer = summarizer
        self.config = config  # assistant_config
        self._thread = None

    def start(self):
        """启动调度守护线程"""
        # 复用主项目的 60 秒轮询 + cron 匹配逻辑
        pass

    def _check_and_run(self, group_config):
        """检查是否到时间，触发摘要"""
        # 1. cron 匹配
        # 2. 从 mock_data 取该群最近 N 条消息
        # 3. 调用 summarizer.summarize()
        # 4. 结果写入通知队列
        # 5. WebSocket 推送
        pass
```

**前端调度面板** (`SchedulerPanel.jsx`) 改造：

- `GET /api/scheduler/tasks` → 返回真实的调度任务列表（从 `assistant_config.json` 读取）
- `POST /api/scheduler/tasks` → 添加/修改调度任务
- `DELETE /api/scheduler/tasks/:id` → 删除调度任务
- 任务触发时通过 WebSocket 推送 `digest_result` 事件

### 3.4 关键词告警 — 真实匹配

**复用** `TriggerDetector` + `AlertEngine` 核心逻辑：

```python
# src/demo/demo_alert.py
class DemoAlertEngine:
    """
    demo 版关键词告警
    - 监控模拟消息流
    - 匹配关键词 → 生成通知 → WebSocket 推送
    """

    def __init__(self, mock_data, config):
        self.trigger_detector = TriggerDetector(config.alert_keywords)
        self.notifications = []  # SQLite 持久化

    def check_message(self, msg):
        """检查消息是否命中关键词"""
        hits = self.trigger_detector.detect(msg['content'])
        if hits:
            notification = self._create_notification(msg, hits)
            self._persist(notification)
            self._ws_broadcast(notification)

    def get_notifications(self, filters):
        """查询通知列表"""
        pass

    def ack_notification(self, nid):
        """确认通知"""
        pass
```

### 3.5 模拟消息流 — 让系统「活」起来

这是 demo 最关键的新能力：**让用户能看到系统在真实工作**。

**三种消息来源：**

| 来源 | 触发方式 | 用途 |
|---|---|---|
| **手动注入** | UI 上的「发送测试消息」按钮 | 测试关键词告警、AI 对话 |
| **剧本回放** | 预设的对话剧本，按时间线自动释放 | 演示定时摘要效果 |
| **AI 生成** | 用 AI 生成模拟群聊对话 | 丰富的测试数据 |

**UI 入口：** 在 Dashboard 增加「消息注入面板」：

```
┌─────────────────────────────────────────┐
│  🧪 消息注入                             │
├─────────────────────────────────────────┤
│  群聊: [下拉选择模拟群聊]                  │
│  发言者: [下拉选择成员 / 自定义]            │
│  内容: [文本输入框]                       │
│  [发送] [发送随机消息] [启动剧本回放]       │
└─────────────────────────────────────────┘
```

### 3.6 OA 摘要 — 真实 AI 处理

OA 摘要在 demo 中可以工作，但文章源改为模拟：

```python
# src/demo/demo_oa.py
class DemoOAService:
    """
    demo 版 OA 摘要
    - 用模拟文章数据（预设 5 篇文章）
    - AI 摘要部分真实调用
    - 摘要模板真实生效
    """

    def run_digest(self, account_id, template):
        # 1. 取模拟文章
        articles = self.mock_data.get_oa_articles(account_id)
        # 2. 真实 AI 摘要
        summary = self.summarizer.oa_digest(articles, template)
        # 3. 推送结果
        return summary
```

### 3.7 iLink 推送 — 可选实现

iLink 是独立的 HTTP API，不依赖微信，**可以在 demo 中完整实现**：

- QR 码绑定流程真实可用
- 推送消息真实发送
- 测试推送真实工作

但需要用户自行注册 iLink 账号，所以标记为**可选**。

## 四、前端改动范围

前端基本保持不变，因为 API 接口和数据结构完全兼容。改动点：

| 组件 | 改动 | 原因 |
|---|---|---|
| `SharedComponents.jsx` | `API_BASE` 可能需要调整 | Python 后端端口可能不同 |
| `Dashboard.jsx` | 增加消息注入面板 | 新功能 |
| `ConfigPanel.jsx` | AI 配置保存后真实生效 | 后端改造 |
| `AssistantPanel.jsx` | 告警/摘要真实工作 | 后端改造 |
| `SchedulerPanel.jsx` | 任务 CRUD 真实持久化 | 后端改造 |
| `OnboardingSteps.jsx` | step3 AI 检测真实运行 | 后端改造 |

## 五、启动方式

```powershell
# 安装依赖
pip install -r requirements.txt

# 构建前端
cd ui-src && npm install && npm run build && cd ..

# 启动（Python 后端 + 静态文件服务）
python server.py
# 访问 http://127.0.0.1:7328
```

`server.py` 是 demo 的入口，启动时：
1. 加载 `.env` 配置
2. 初始化 AI 后端（如果配置了 API key）
3. 初始化调度器
4. 启动 HTTP 服务器（同端口服务前端 + API）
5. WebSocket 状态推送

## 六、从 webot-main 复用的文件清单

以下文件**直接复制**，不做改动或仅做微量调整：

| 文件 | 调整说明 |
|---|---|
| `src/config.py` | 去掉 WCDB 相关配置项 |
| `src/summarize/__init__.py` | 无改动 |
| `src/summarize/base.py` | 无改动 |
| `src/summarize/claude_backend.py` | 无改动 |
| `src/summarize/deepseek_backend.py` | 无改动 |
| `src/summarize/models.py` | 无改动 |
| `src/summarize/prompts.py` | 无改动 |
| `src/summarize/provider_detector.py` | 无改动 |
| `src/utils/logging_config.py` | 无改动 |
| `src/assistant/alert_engine.py` | 去掉 iLink 推送 |
| `src/assistant/digest_scheduler.py` | 改为读 mock 数据 |

## 七、不实现的功能（明确排除）

| 功能 | 原因 |
|---|---|
| WCDB 数据库直读 | 无微信数据目录 |
| 图片/语音/视频解密 | 无加密数据源 |
| 微信窗口操控 | 无微信进程 |
| 消息发送到微信 | 无微信连接 |
| 朋友圈删除保护 | 无真实朋友圈数据 |
| 文件系统浏览器 | 非核心，可后续加 |

## 八、实现优先级

```
P0 — 必须先做（让系统基本跑起来）
  ├── Python 后端框架 (server.py + 路由)
  ├── 配置持久化 (.env 读写)
  ├── AI 后端集成 (summarize 模块)
  └── SSE 流式 AI 对话

P1 — 核心功能
  ├── AI Provider 自动检测
  ├── 定时摘要调度 (DigestScheduler)
  ├── 关键词告警 (AlertEngine)
  ├── 通知队列 (SQLite)
  └── WebSocket 真实状态推送

P2 — 增强体验
  ├── 消息注入面板 (手动/剧本/AI生成)
  ├── OA 摘要 (模拟文章 + 真实 AI)
  ├── 沙盒测试 (真实 AI)
  └── iLink 推送 (可选)

P3 — 打磨
  ├── 错误处理 & 重试
  ├── 日志系统
  └── Onboarding 适配
```
