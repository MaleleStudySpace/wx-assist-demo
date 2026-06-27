# 微信助手 Demo — 用户操作指南

> 本文档覆盖 wx-assist-demo 的所有用户可见功能，包含每个操作背后的执行逻辑。

---

## 目录

1. [启动与访问](#1-启动与访问)
2. [首页 Dashboard](#2-首页-dashboard)
3. [会话管理](#3-会话管理)
4. [收藏管理](#4-收藏管理)
5. [朋友圈](#5-朋友圈)
6. [公众号助手](#6-公众号助手)
7. [群聊助手](#7-群聊助手)
8. [AI 对话](#8-ai-对话)
9. [系统配置](#9-系统配置)
10. [剧本回放 (DEMO)](#10-剧本回放-demo)
11. [引导流程 (Onboarding)](#11-引导流程-onboarding)

---

## 1. 启动与访问

### 操作

1. 运行 `python server.py`
2. 浏览器打开 `http://127.0.0.1:7328`

### 背后逻辑

- `server.py` 启动 `ThreadingHTTPServer`，监听 `127.0.0.1:7328`
- 自动启动 `DemoDigestScheduler` 后台线程，每 60 秒检查定时任务
- 自动启动 WebSocket 广播线程，向前端推送实时事件
- 前端由 `dist/` 目录下的静态文件提供（Vite 构建的 React 应用）
- 首次加载时，前端通过 `/api/status` 获取运行状态

---

## 2. 首页 Dashboard

Dashboard 是项目的总览页面，一览服务状态、关键词提醒、定时任务。

### 2.1 服务状态卡片

**操作**：查看服务运行状态、启动/停止服务

**显示内容**：
- 服务运行状态（运行中 / 已停止）
- AI 模型名称
- 已处理消息数
- 运行时长
- 监控群聊数

**按钮**：
- 「启动服务」→ `POST /api/start` → 将 `ServerStatus.running` 设为 `true`
- 「停止服务」→ `POST /api/stop` → 将 `running` 设为 `false`

**背后逻辑**：服务停止后，定时摘要和关键词检测暂停，但 Web UI 仍可访问和配置。

### 2.2 系统健康面板

**操作**：查看四个健康指标

| 指标 | 数据来源 | 含义 |
|------|----------|------|
| 数据库 | `status.db_ok` | 永远为 `true`（Demo 模式无真实数据库） |
| 微信 | `status.wechat_online` | 永远为 `true`（Demo 模式模拟在线） |
| AI 后端 | `status.ai_ok` | 检测 AI API Key 是否配置且可达 |
| 助手服务 | `status.running` | 是否已启动 |

**环境检查按钮**：`GET /api/onboarding/diagnose` → 返回各组件的检查结果（数据库路径、AI Key 有效性等）。

### 2.3 关键词提醒面板

**操作**：快速查看已配置的关键词监控群

**显示内容**：
- 提醒群总数 / 启用数 / 禁用数
- 每个群：群名、关键词标签（最多3个+更多）、启用状态绿点
- 「查看全部」链接 → 跳转到群聊助手 Tab

**背后逻辑**：`GET /api/assistant/config` → 读取 `alert_groups` 数组，前端 `KeywordAlertCard` 渲染。

### 2.4 定时任务面板

**操作**：快速查看所有定时任务（群聊摘要 + 公众号摘要）

**显示内容**：
- 任务总数 / 启用数 / 禁用数
- 每个任务：类型标签（群聊摘要=绿色 / 公众号摘要=紫色）、任务名、执行时间、回溯时长、推送状态、启用状态

**背后逻辑**：`GET /api/scheduled-tasks` → 合并 `assistant_config.json` 的 `digest_groups` 和 `oa-groups.json` 的 OA 分组数据。

---

## 3. 会话管理

会话管理 Tab 展示微信聊天会话列表和消息记录。

### 3.1 会话列表

**操作**：浏览、搜索、筛选聊天会话

**显示内容**：
- 左侧会话列表：头像、昵称/群名、最新消息摘要、时间、未读数
- 顶部搜索框：按名称搜索
- 筛选标签：全部 / 群聊 / 好友 / 公众号 / 服务号

**背后逻辑**：`GET /api/chat/sessions` → 读取 `mock/chat-sessions.json`，按 `local_type` 字段分类（1=好友, 2=群聊, 3=公众号, 4=服务号）。

### 3.2 聊天记录

**操作**：点击会话 → 右侧展示消息流

**显示内容**：
- 消息气泡：发送者、内容、时间
- 支持的消息类型：文本、图片、语音、引用消息、系统消息
- 顶部：对方昵称、成员数（群聊）
- 「导出」按钮 → `POST /api/chat/export` → 生成文件下载

**背后逻辑**：`GET /api/chat/messages?talker=xxx` → 读取 `mock/chat-messages.json` 中对应 talker 的消息数组。

### 3.3 群成员与共同群聊

**操作**：
- 群聊 → 点击成员图标 → 查看群成员列表、搜索成员
- 好友 → 查看共同群聊

**背后逻辑**：
- `GET /api/chat/members?chat_id=xxx` → 返回 mock 成员数据
- `GET /api/chat/common-groups?wxid=xxx` → 返回 mock 共同群聊

---

## 4. 收藏管理

收藏 Tab 展示微信收藏内容。

### 4.1 收藏列表

**操作**：浏览、按标签筛选、搜索、查看详情

**显示内容**：
- 收藏条目卡片：类型图标、标题/摘要、来源、时间
- 左侧标签列表：可点击筛选
- 搜索框：按标题搜索

**背后逻辑**：`GET /api/fav/list` → 读取 `mock/favorites.json`；`GET /api/fav/tags` → 读取 `mock/fav-tags.json`。

### 4.2 收藏详情与导出

**操作**：
- 点击条目 → 展开详情（完整内容、图片、语音等）
- 「导出」→ `POST /api/fav/export` → Demo 模式返回"不支持导出"提示

---

## 5. 朋友圈

朋友圈 Tab 展示微信朋友圈动态。

### 5.1 朋友圈时间线

**操作**：浏览朋友圈动态、搜索

**显示内容**：
- 动态卡片：发布者头像、昵称、文字内容、图片、发布时间、点赞/评论数
- 搜索框：按内容搜索

**背后逻辑**：`GET /api/sns/timeline` → 读取 `mock/moments.json`；`GET /api/sns/search?q=xxx` → 在 mock 数据中搜索。

---

## 6. 公众号助手

公众号 Tab 管理 OA（Official Account）分组，AI 定时生成摘要。

### 6.1 公众号总览

**操作**：查看已关注公众号列表，点击查看历史文章

**显示内容**：
- 公众号列表：5 个 mock 公众号（科技日报、AI前沿观察、产品思维、开发者生活、Python周刊）
- 搜索框（超过 10 个时显示）
- 点击公众号 → 展开历史文章面板

**背后逻辑**：
- `GET /api/oa/accounts` → 读取 `mock/oa-accounts.json`
- `GET /api/oa/articles?gh_id=xxx` → 读取 `mock/oa-articles.json` 中对应公众号的文章

### 6.2 文章搜索

**操作**：在搜索框输入关键词，搜索公众号文章

**背后逻辑**：`GET /api/oa/search?q=xxx` → 在 `oa-articles.json` 所有文章的标题和摘要中搜索。

### 6.3 摘要分组管理

**操作**：新建/编辑/删除摘要分组

**预设分组**：
- **科技资讯**：科技日报 + AI前沿观察，每天 9:00，tech 模板，微信推送
- **开发资源**：Python周刊 + 开发者生活 + 产品思维，每天 20:00，default 模板

**创建分组步骤**：
1. 输入分组名称
2. 从公众号列表勾选（可搜索）
3. 选择执行时间（预设 / 自定义 Cron）
4. 选择摘要模板（默认 / 技术详尽 / 娱乐简报 / 商业要点 / 新闻摘要 / 自定义提示词）
5. 设置回溯时间（智能 / 手动指定小时数）
6. 开关"推送到微信"

**背后逻辑**：
- `POST /api/oa/groups/create` → 创建分组，写入内存缓存
- `PUT /api/oa/groups/{id}` → 更新分组
- `DELETE /api/oa/groups/{id}` → 删除分组

### 6.4 生成摘要

**操作**：点击分组的「生成摘要」按钮

**执行流程**：
1. 前端 `POST /api/oa/digest/run/{group_id}`
2. 后端从 `oa-articles.json` 读取该分组关联公众号的文章
3. 按 `digest_template` 选择提示词模板
4. 调用 AI API 生成摘要
5. 将结果存入通知队列（`add_notification`）
6. 通过 WebSocket 广播 `oa_digest_result` 事件
7. 前端实时显示摘要内容

**模板说明**：

| 模板 | 提示词方向 |
|------|-----------|
| 默认摘要 | 每篇 2-3 句话，突出核心观点 |
| 技术详尽 | 标注技术栈、版本号、性能数据 |
| 娱乐简报 | 轻松语气，可加评论 |
| 商业要点 | 行业趋势、投资信号 |
| 新闻摘要 | 新闻五要素，按重要性排序 |
| 自定义 | 用户编写的提示词 |

---

## 7. 群聊助手

群聊助手是核心功能面板，管理关键词提醒、定时群摘要、通知中心。

### 7.1 基础设置

**操作**：开启/关闭微信助手总开关

**背后逻辑**：开关控制 `assistant_enabled` 字段。关闭后所有助手功能暂停，但配置保留。

### 7.2 关键词即时提醒

**操作**：配置关键词监控，当群消息命中关键词时生成通知

**配置项**：
- 选择群聊（从下拉列表搜索）
- 输入关键词（TagInput，回车添加）
- 启用/禁用开关

**预设数据**：技术交流群，关键词：紧急、BUG、线上问题

**空状态引导**：
- 「+ 添加提醒群」→ 打开编辑器
- 「▶ 体验演示」→ 自动添加预设关键词 + 滚动到剧本回放

**背后逻辑**：
- 配置变更 → 500ms 防抖自动保存 → `PUT /api/assistant/config`
- 关键词命中流程：剧本回放注入消息 → `_do_inject()` 匹配关键词 → `add_notification(type="keyword_alert")` → WebSocket 广播

### 7.3 定时群摘要

**操作**：配置定时摘要任务

**配置项**：
- 选择群聊
- 摘要时间：频率（每天/工作日/自定义）+ 时间点（预设 09:00 等 + 自定义）
- 高阶 Cron 设置
- 回溯时长：3h / 6h / 12h / 24h
- 仅摘要未读：开关
- 推送到微信：开关（需先绑定 iLink Bot）
- 群档案 Profile：群用途、群说明、关注点、忽略内容、摘要风格、自定义摘要指令

**预设数据**：
- 技术交流群：每天 09:00，6h 回溯，仅未读，微信推送
- 家人群：每天 12:00，4h 回溯，全部消息，不推送

**背后逻辑**：
- `DemoDigestScheduler` 后台线程每 60 秒检查一次
- 匹配 cron 表达式或 HH:MM 格式
- 匹配后在新线程中调用 AI 生成摘要
- 结果写入通知队列 + WebSocket 广播

### 7.4 剧本回放 (DEMO)

**操作**：点击「开始回放」→ 模拟技术交流群对话

**回放过程**：
1. 后端 `ScenarioPlayer` 按预设剧本逐条注入消息
2. 每条消息检查关键词命中
3. 命中时生成 keyword_alert 通知 + WebSocket 广播
4. 前端实时显示：第几条/共几条、发送者、内容、命中关键词

**剧本内容**：12 条消息，模拟从早安到 BUG 紧急再到修复的完整场景。3 条消息命中关键词：
- "紧急BUG！线上接口超时了" → 命中 BUG + 线上问题
- "线上问题已回滚，正在排查根因" → 命中 线上问题
- "BUG已修复，提交了PR" → 命中 BUG

### 7.5 通知中心

**操作**：查看和管理通知队列

**通知投递队列**：
- 开关：启用/暂停通知队列
- 保留时间：通知保留小时数
- 外部 Agent 拉取地址：`GET /api/assistant/notifications/pending`
- 「写入测试通知」→ `POST /api/assistant/notifications/test`

**通知记录**：
- 三维筛选：群聊 / 类型（关键词提醒/定时摘要）/ 状态（待投递/已投递/已忽略/失败）
- 每条通知：类型标签、状态指示灯、时间、标题、群名、内容
- 操作：标记投递 / 忽略（仅 pending 状态）

**通知类型**：
| 类型 | 触发条件 |
|------|----------|
| keyword_alert | 消息命中关键词 |
| digest | 定时摘要生成完成 |
| oa_digest | 公众号摘要生成完成 |

**通知生命周期**：`pending` → `delivered`（标记投递）/ `ignored`（忽略）/ `failed`（推送失败）

---

## 8. AI 对话

AI 对话功能允许用户与 AI 助手在群聊上下文中自然对话。

### 8.1 开启对话

**操作**：在会话管理中，点击群聊右上角的 AI 图标，或从群聊助手发起

**背后逻辑**：
- `POST /api/ai/chat/start` → 创建 AI 会话，加载群聊上下文
- AI 会话状态存储在 `server.py` 的 `_ai_chat_sessions` 字典中（内存）

### 8.2 发送消息

**操作**：输入消息，发送

**背后逻辑**：
- `POST /api/ai/chat/message` → 将用户消息添加到会话上下文 → 调用 AI API → 流式返回响应
- 支持流式输出（SSE），前端逐字显示

### 8.3 压缩对话

**操作**：对话过长时，点击压缩按钮

**背后逻辑**：`POST /api/ai/chat/compress` → 将早期对话压缩为摘要，保留近期消息，减少 token 消耗。

### 8.4 销毁对话

**操作**：关闭 AI 对话窗口

**背后逻辑**：`POST /api/ai/chat/destroy` → 从 `_ai_chat_sessions` 中移除会话，释放内存。

### 8.5 对话历史

**操作**：查看过往 AI 对话记录

**背后逻辑**：`GET /api/ai/chat/history` → 返回存储的对话历史。

---

## 9. 系统配置

系统配置 Tab 管理 AI 后端、微信推送等系统级设置。

### 9.1 AI 后端配置

**操作**：配置 AI API 连接

**配置项**：
- AI 站点 URL（如 `https://api.deepseek.com`）
- API Key
- Provider 类型：自动检测 / OpenAI / Anthropic
- 模型 ID

**自动检测流程**：
1. `GET /v1/models` → 解析返回格式判断 Provider 类型
2. `POST /v1/chat/completions` 最小请求 → 确认 OpenAI 兼容
3. `POST /v1/messages` 最小请求 → 确认 Anthropic 兼容
4. 自动填充可用模型列表

**背后逻辑**：`src/summarize/provider_detector.py` 实现三步探测，支持 OpenAI 兼容和 Anthropic 两种 API 格式。

### 9.2 微信推送 (iLink Bot)

**操作**：绑定 iLink Bot，将通知推送到微信

**绑定流程**：
1. 点击「绑定」→ `GET /api/ilink/qrcode` → 获取二维码
2. 用微信扫描二维码
3. 前端轮询 `GET /api/ilink/qrcode-status` → 等待确认
4. 确认后，iLink 账号信息保存到 `data/ilink_account.json`

**推送记录**：
- 筛选：类型（关键词提醒/定时摘要/公众号摘要）+ 状态（推送成功/推送失败）
- 每条记录：类型标签(橙/蓝/绿)、状态(绿点/红点)、时间、标题、群名、内容预览、失败原因
- 「测试推送」→ `POST /api/ilink/test-push`
- 「解绑」→ `POST /api/ilink/unbind`

**推送机制**：
- 通知触发时，如果 `push_target == "ilink"` 且 iLink 已绑定
- 调用 `ILinkPush.send_message()` → HTTP POST 到 iLink API
- 速率限制：2.5 秒最小间隔
- 失败重试：3 次，指数退避（3s → 6s → 12s）
- 消息截断：4000 字符上限
- 会话过期检测：errcode=-14 时标记为 `session_expired`

### 9.3 昵称管理

**操作**：为群聊设置自定义昵称

**背后逻辑**：`GET /api/nicknames` → 读取 `data/nicknames.json`；`PUT /api/nicknames` → 保存。

### 9.4 日志查看

**操作**：查看运行日志

**背后逻辑**：`GET /api/logs` → 读取 `data/demo.log` 最后 500 行，按格式解析为 `{ts, level, msg, raw}`。

### 9.5 配置导入/导出

**操作**：
- 导出：`GET /api/config/export` → 导出当前配置为 JSON
- 导入：`POST /api/config/import` → 从 JSON 文件导入配置

---

## 10. 剧本回放 (DEMO)

剧本回放是 Demo 版本特有的功能，让用户体验关键词检测的完整流程。

### 操作

1. 进入群聊助手 Tab
2. 找到「剧本回放」面板
3. 点击「▶ 开始回放」
4. 观看消息逐条出现，关键词命中时显示橙色标签

### 引导入口

- 关键词提醒空状态 → 「▶ 体验演示」→ 自动添加预设关键词 + 滚动到回放面板
- 关键词提醒非空 → 「🎬 运行演示回放，测试关键词检测」链接

### 剧本内容

12 条消息，4 个角色，3 次关键词命中：

| 序号 | 发送者 | 内容 | 命中关键词 |
|------|--------|------|-----------|
| 4 | 张伟 | 紧急BUG！线上接口超时了 | BUG, 线上问题 |
| 9 | 陈静 | 线上问题已回滚，正在排查根因 | 线上问题 |
| 12 | 王磊 | BUG已修复，提交了PR | BUG |

### 背后逻辑

- `POST /api/demo/scenario/start` → `ScenarioPlayer.start()` → 启动后台线程
- 线程按 `delay * speed_mult` 间隔逐条注入消息
- 每条消息通过 `_do_inject()` 处理 → 匹配关键词 → 生成通知 → WebSocket 广播
- `GET /api/demo/scenario/status` → 查询回放是否进行中
- `POST /api/demo/scenario/stop` → 停止回放

---

## 11. 引导流程 (Onboarding)

首次使用时的引导流程，帮助用户配置 AI 后端。

### 操作步骤

1. **Step 1**：AI 后端配置 — 填写 API URL 和 Key，自动检测 Provider
2. **Step 2**：模型选择 — 从可用模型列表中选择
3. **Step 3**：完成 — 跳转到 Dashboard

### 背后逻辑

- `GET /api/onboarding/status` → 检查 `ONBOARDING_DONE` 环境变量
- `POST /api/onboarding/step1` → 保存 AI 配置到 `.env`
- `GET /api/onboarding/diagnose` → 运行诊断检查

---

## 附录：Mock 数据清单

| 文件 | 内容 | 数据量 |
|------|------|--------|
| `mock/status.json` | 服务状态（默认） | 1 条 |
| `mock/config.json` | 系统配置（默认） | 1 条 |
| `mock/chat-sessions.json` | 聊天会话列表 | ~20 条 |
| `mock/chat-messages.json` | 聊天消息（按 talker 分组） | ~100 条 |
| `mock/favorites.json` | 收藏列表 | ~10 条 |
| `mock/fav-tags.json` | 收藏标签 | ~5 个 |
| `mock/moments.json` | 朋友圈动态 | ~8 条 |
| `mock/oa-accounts.json` | 公众号列表 | 5 个 |
| `mock/oa-articles.json` | 公众号文章（按 gh_id 分组） | 15 篇 |
| `mock/oa-groups.json` | OA 摘要分组 | 2 个 |
| `mock/assistant-config.json` | 助手配置（关键词+摘要） | 1 条 |
| `mock/nickname-groups.json` | 群聊列表（用于下拉选择） | 4 个 |
| `mock/notifications.json` | 预设通知 | 3 条 |
| `mock/ai-responses.json` | AI 响应缓存 | 多条 |
| `mock/logs.json` | 日志数据 | 多条 |
