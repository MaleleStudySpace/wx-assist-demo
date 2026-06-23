# wx-assist-demo 后续搬运开发指南

> 上下文压缩后，仅凭此文档即可无缝继续开发。

---

## 一、项目状态

**Demo 项目路径**: `C:\Users\74062\Desktop\wx-assist-demo`
**主项目路径**: `C:\Users\74062\Desktop\webot-main`
**核心原则**: 改动 demo 时，**永远不要改动 webot-main**

### 已完成

| 阶段 | Commit | 内容 |
|---|---|---|
| P0 | `d8071ab` | Python 后端+AI+配置+SSE |
| P1 | `a92363a` | 定时摘要调度器+开发文档 |
| P2 | `d245f83` | 消息注入+剧本回放+OA摘要 |
| P3 | `ebc1182` | Onboarding适配+ConfigPanel精简+日志修复+配置导入导出 |
| 端口 | `8d4777d` | 7327→7328 + 环境变量 DEMO_HOST/DEMO_PORT |
| 部署 | `ce52020` | DEPLOY.md + 消除硬编码地址 |
| 搬运1 | `a59c39a` | iLink推送 + AI真实压缩 |

### 启动方式

```powershell
cd C:\Users\74062\Desktop\wx-assist-demo
pip install -r requirements.txt
python server.py   # http://127.0.0.1:7328
```

---

## 二、待搬运模块清单（按优先级）

### P0 — 核心补全（推荐先做，3 个模块，约 642 行）

#### P0-1. `assistant/config.py` — 完整 AssistantConfig 数据结构

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/config.py` (322行) |
| **Demo 当前状态** | `load_assistant_config()` 返回原始 dict，无类型约束 |
| **微信依赖** | **零** — 纯 dataclass + JSON 序列化 |
| **搬运方式** | 直接复制到 `src/assistant/config.py`，零改动 |
| **搬运后效果** | `AlertGroup`/`DigestGroup`/`OAGroup`/`GroupProfile` 等 dataclass 类型安全操作；被后续 outbox/alert/oa_groups 模块依赖 |
| **改动点** | demo `server.py` 中 `load_assistant_config()` / `save_assistant_config()` 改为调用 `_config_to_dict()` / `_dict_to_config()` |

**关键 dataclass**:
```python
AlertGroup(chat_id, group_name, keywords, enabled)
DigestGroup(chat_id, group_name, schedule, cron_expr, lookback_hours, enabled, profile, memory, unread_only, push_target)
OAGroup(id, name, accounts, schedule, digest_template, push_target, lookback_hours, enabled)
GroupProfile(purpose, description, focus, ignore, style, custom_prompt)
NotificationQueue(enabled, retention_hours)
SchedulerTask(id, name, task_type, cron_expr, ref_id, enabled, last_run_time, status)
AssistantConfig(version, assistant_enabled, alert_groups, digest_groups, oa_groups, ...)
```

#### P0-2. `assistant/digest.py` — 群聊摘要引擎

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/digest.py` (143行) |
| **Demo 当前状态** | `digest_scheduler.py` 中简单拼接消息文本，无过滤无群档案 |
| **微信依赖** | **零** — 纯提示词构建和消息过滤 |
| **搬运方式** | 直接复制到 `src/assistant/digest.py`，零改动 |
| **搬运后效果** | 自动过滤噪声词（"收到"、"好的"等）；过滤系统消息（加入/退出/改名）；根据群档案生成定向摘要；摘要记忆更新 |
| **改动点** | `DemoDigestScheduler._run_digest()` 中调用 `filter_messages()` + `build_digest_prompt()` 替代简单拼接 |

**核心函数**:
```python
NOISE_REPLIES = {"收到", "好的", "嗯", "1", ...}  # 30+ 噪声词
SYSTEM_KEYWORDS = ["加入了群聊", "修改群名为", "移出了", ...]  # 系统消息

def filter_messages(messages, lookback_hours=6) -> list[dict]:
    """过滤噪声和系统消息，返回有价值的消息"""

def build_digest_prompt(group_name, profile, memory, unread_only=False) -> str:
    """根据群档案构建摘要 prompt"""
```

#### P0-3. `assistant/alert.py` — 结构化关键词引擎

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/alert.py` (83行) |
| **Demo 当前状态** | `_do_inject()` 中手动 for 循环匹配关键词 |
| **微信依赖** | **零** — 纯文本匹配 |
| **搬运方式** | 直接复制到 `src/assistant/alert.py`，零改动 |
| **搬运后效果** | 统一 AlertEngine 类，支持优先级、与 Outbox 集成 |
| **改动点** | demo 中关键词匹配替换为 `AlertEngine.check()` 调用；依赖 `AssistantConfig` 和 `Outbox` |

**注意**: AlertEngine 依赖 Outbox，如果不做持久化可以传入 mock outbox 或改写为直接调用 `add_notification()`。

---

### P1 — 功能增强（3 个模块，约 1,168 行）

#### P1-1. `assistant/oa_groups.py` — OA 分组 CRUD

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/oa_groups.py` (168行) |
| **Demo 当前状态** | OATab 前端有创建/编辑/删除分组 UI，但后端返回 mock 数据 |
| **微信依赖** | **零** — 纯 JSON 读写 |
| **搬运方式** | 复制到 `src/assistant/oa_groups.py`，零改动 |
| **搬运后效果** | OA 分组增删改查真实持久化到 `assistant_config.json` |
| **需要** | 先完成 P0-1 (`assistant/config.py`) |
| **改动点** | server.py 中 `/api/oa/groups` 系列端点改为调用 `OADgroupManager` |

#### P1-2. `web/ai_chat.py` — AI 聊天全功能引擎

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/web/ai_chat.py` (880行) |
| **Demo 当前状态** | server.py 内嵌简化版 (~200行)，缺 TTL/预算/上下文构建/OOM保护/日志 |
| **微信依赖** | **低** — `_build_favorites_context()` 和 `_build_group_chat_context()` 依赖 WCDB，可注入 mock 数据 |
| **搬运方式** | 复制到 `src/web/ai_chat.py`，修改上下文构建函数为可注入 |
| **搬运后效果** | 30min 会话自动过期、token 预算追踪+预压缩、200K OOM 保护、操作日志+LLM日志 |
| **需要** | 先完成 `src/utils/op_logger.py` (60行，零改动直接复制) |

**缺失功能对照**:
| 功能 | 主项目 | Demo |
|------|--------|------|
| Session TTL 30min 清理 | `_cleanup_expired()` | 无 |
| Token 预算追踪 | `AIChatSession.token_budget` | 无 |
| 预压缩 (>70% budget) | 自动调用 AI compress | 无 |
| 上下文 200K 上限 | `MAX_CONTEXT_CHARS` | 无 |
| 单条消息截断 | `MAX_SINGLE_MSG_CHARS=2000` | 无 |
| 操作日志 | `op_log` / `op_log_error` | 无 |
| LLM 调用日志 | `log_llm_interaction` | 无 |

**改造要点**:
- `_build_favorites_context(wcdb_client, ...)` → 改为 `_build_favorites_context(data_source, ...)`，demo 传入 mock 数据
- `_build_group_chat_context(wcdb_client, ...)` → 同上
- `_decompress_content_safe()` → demo 中直接 return content（无压缩数据）

#### P1-3. `utils/op_logger.py` — 操作日志

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/utils/op_logger.py` (~60行) |
| **Demo 当前状态** | 缺失 |
| **微信依赖** | **零** — 纯日志工具 |
| **搬运方式** | 直接复制，零改动 |
| **搬运后效果** | 结构化 `[BOOT]`/`[AI-CHAT]`/`[DIGEST]` 等标签日志，前端 LogViewer 彩色展示 |

---

### P2 — OA 完整化（3 个模块，约 919 行）

#### P2-1. `assistant/oa_parser.py` — 公众号文章解析器

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/oa_parser.py` (332行) |
| **微信依赖** | **低** — `fetch_oa_articles()` 需要 WCDB，但 `decode_content()`/`parse_oa_article()` 零依赖 |
| **搬运方式** | 复制，移除或条件化 `fetch_oa_articles()` 中的 WCDB 调用 |
| **搬运后效果** | 从 mock OA 消息 XML 中解析文章标题/摘要/封面/链接 |

#### P2-2. `assistant/oa_reader.py` — 文章正文抓取

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/oa_reader.py` (142行) |
| **微信依赖** | **零** — 纯 HTTP 请求 + HTML 解析 |
| **搬运方式** | 直接复制，零改动 |
| **搬运后效果** | OA 摘要时从文章 URL 抓取完整正文，摘要更准确 |

#### P2-3. `assistant/oa_digest.py` — OA 摘要完整服务

| 项目 | 说明 |
|---|---|
| **主项目路径** | `src/assistant/oa_digest.py` (445行) |
| **微信依赖** | **低** — `fetch_oa_articles()` 需 WCDB，可注入 mock |
| **搬运方式** | 复制，将数据源改为可注入 |
| **搬运后效果** | DigestHistory 去重、多模板、智能回溯、自定义 prompt、推送微信 |
| **需要** | 先完成 P2-1 + P2-2 + P1-1 |

---

### P3 — 高级功能（可选）

| 模块 | 行数 | 依赖 | 效果 |
|---|---|---|---|
| `scheduler/task_scheduler.py` | ~200 | 零（需 apscheduler） | APScheduler 真正定时执行 |
| `assistant/scheduler.py` | 314 | 中 | 增强摘要调度（cron/unread_only/记忆） |
| `memory/consolidator.py` | ~200 | 中 | 群聊记忆整合 |
| `utils/web_search.py` | ~80 | 零 | AI 回答可联网搜索 |
| WebSocket 事件补充 | ~30 | 零 | 前端实时进度反馈 |
| OA/SNS Search 端点 | ~200 | 中 | mock 数据搜索 |

---

## 三、推荐执行顺序

```
Step 1: P0-1 assistant/config.py    ← 所有模块的基础
Step 2: P0-3 assistant/alert.py     ← 依赖 config.py
Step 3: P0-2 assistant/digest.py    ← 依赖 config.py
Step 4: P1-3 utils/op_logger.py     ← 被 ai_chat.py 依赖
Step 5: P1-2 web/ai_chat.py         ← 依赖 op_logger
Step 6: P1-1 assistant/oa_groups.py ← 依赖 config.py
Step 7: P2-1~P2-3 OA 完整三件套     ← 依赖 config + oa_groups
Step 8: P3 可选高级功能
```

每步完成后：`git add -A && git commit -m "feat: 搬运XXX — 从webot-main零改动复制"`

---

## 四、搬运注意事项

### 4.1 零改动搬运原则

从 webot-main 复制的文件放在 demo 项目的**同名路径**下：
```
demo/src/assistant/config.py    ← 从 webot-main/src/assistant/config.py
demo/src/assistant/alert.py     ← 从 webot-main/src/assistant/alert.py
demo/src/assistant/digest.py    ← 从 webot-main/src/assistant/digest.py
demo/src/web/ai_chat.py         ← 从 webot-main/src/web/ai_chat.py
demo/src/utils/op_logger.py     ← 从 webot-main/src/utils/op_logger.py
```

### 4.2 server.py 集成方式

搬运新模块后，在 `server.py` 中：
1. 顶部 `import` 新模块
2. 替换简化实现为调用新模块的类/函数
3. 确保所有端点仍然正常工作

### 4.3 WCDB 依赖替代策略

遇到需要 WCDB 的函数时，统一用这个模式：

```python
# 主项目原版
def fetch_articles(wcdb_client, gh_id):
    articles = wcdb_client.query(...)

# Demo 替代版
def fetch_articles(data_source=None):
    if data_source is None:
        # Demo fallback: use mock data
        from server import load_mock
        return load_mock("oa-accounts") or []
    return data_source.query(...)
```

### 4.4 前端不改

所有搬运只涉及后端 Python 文件，前端组件已有完整功能（只是等后端真正实现），搬运后前端自动生效。

---

## 五、参考文档

| 文档 | 位置 |
|---|---|
| 开发指南 | `DEVGUIDE.md` |
| 部署指南 | `DEPLOY.md` |
| 原始设计 | `DESIGN.md` |
| 主项目架构 | webot-main 的 memory 文件 |
