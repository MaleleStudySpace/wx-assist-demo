# 微信助手 Demo

> 微信消息总结机器人的 Demo 版本 — 完整 UI + 真实 AI 调用 + Mock 数据，零依赖微信即可体验全部功能。

## ✨ 功能一览

| 模块 | 功能 | 数据源 |
|------|------|--------|
| 🏠 首页 | 服务状态、关键词提醒预览、定时任务预览 | 实时 + Mock |
| 💬 会话管理 | 聊天会话列表、消息流、群成员、共同群聊、聊天导出 | Mock |
| ⭐ 收藏管理 | 收藏列表、标签筛选、搜索、详情查看 | Mock |
| 📱 朋友圈 | 动态时间线、搜索、保护模式 | Mock |
| 📰 公众号助手 | OA 列表、文章查看、分组管理、AI 定时摘要、6 种摘要模板 | Mock + 真实 AI |
| ⚡ 群聊助手 | 关键词即时提醒、定时群摘要、剧本回放、通知中心 | Mock + 真实 AI |
| 🤖 AI 对话 | 群聊上下文对话、流式输出、对话压缩 | 真实 AI |
| ⚙️ 系统配置 | AI 后端配置、iLink 微信推送、推送记录、日志查看 | 真实 API |
| 🎬 剧本回放 | 预设对话回放、关键词命中演示 | Mock + 真实检测 |

## 🚀 快速开始

### 前置条件

- Python 3.10+（推荐 3.13）
- Node.js 18+（仅构建前端时需要）
- AI API Key（DeepSeek / Claude / 任意 OpenAI 兼容 API）

### 1. 构建前端

```bash
cd ui-src
npm install
npm run build
# 输出到 ../dist/
```

或使用构建脚本：

```bash
node build.js
```

### 2. 配置 AI 后端

编辑 `data/.env`：

```env
# 方式一：DeepSeek
AI_BACKEND=deepseek
DEEPSEEK_API_KEY=sk-your-key

# 方式二：任意 OpenAI 兼容 API
AI_PROVIDER_BASE_URL=https://api.example.com
AI_PROVIDER_API_KEY=sk-your-key
AI_PROVIDER_TYPE=openai
AI_PROVIDER_MODEL=your-model

# 方式三：Claude
AI_BACKEND=claude
ANTHROPIC_API_KEY=sk-ant-your-key
```

### 3. 启动服务

```bash
python server.py
```

打开浏览器访问 **http://127.0.0.1:7328**

### 4. 验证

访问 http://127.0.0.1:7328/api/status ，应返回：

```json
{
  "running": true,
  "db_ok": true,
  "ai_ok": true,
  "error": ""
}
```

## 📖 文档

| 文档 | 内容 |
|------|------|
| [用户操作指南](docs/user-guide.md) | 所有功能点的操作说明 + 背后执行逻辑 |
| [技术开发文档](docs/technical-reference.md) | 后端架构、API 路由表、模块详解、数据流 |
| [推送记录设计](docs/push-history-design.md) | 推送记录功能的产品设计文档 |

## 🏗️ 项目结构

```
wx-assist-demo/
├── server.py              # 后端（单文件，所有 API + WebSocket）
├── ui-src/                # 前端源码（React + Vite）
├── dist/                  # 前端构建输出
├── src/                   # Python 模块
│   ├── config.py          # 配置加载
│   ├── demo/              # Demo 专用
│   │   ├── scenario.py    # 剧本回放引擎
│   │   ├── digest_scheduler.py  # 定时摘要调度
│   │   └── ilink_push.py  # iLink 微信推送
│   └── summarize/         # AI 摘要（DeepSeek + Claude）
├── mock/                  # Mock 数据（15 个 JSON 文件）
├── data/                  # 运行时数据（.env, 配置, 日志）
└── docs/                  # 文档
```

## 🔧 技术栈

- **后端**：Python 3.13 + `http.server` + `threading`
- **前端**：React 19 + Vite 8 + Framer Motion + Phosphor Icons
- **AI**：DeepSeek / Claude / 任意 OpenAI 兼容 API
- **推送**：iLink Bot API（微信推送通道）
- **构建**：Node.js + Vite

## 🎯 Demo vs 真实项目

| 能力 | Demo | 真实项目 (webot-main) |
|------|------|----------------------|
| 微信数据库 | Mock JSON | WCDB 直读（wcdb_api.dll） |
| 消息来源 | Mock JSON | 实时微信消息 Hook |
| AI 摘要 | ✅ 真实 API 调用 | ✅ 真实 API 调用 |
| 关键词检测 | ✅ 真实逻辑 | ✅ 真实逻辑 |
| 微信推送 | ✅ 真实 iLink API | ✅ 真实 iLink API |
| 密钥提取 | ❌ Mock | ✅ wx_key.dll Hook |

## 📋 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEMO_HOST` | `127.0.0.1` | 监听地址 |
| `DEMO_PORT` | `7328` | 监听端口 |
| `AI_BACKEND` | `deepseek` | AI 后端类型 |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `ANTHROPIC_API_KEY` | — | Claude API Key |
| `AI_PROVIDER_BASE_URL` | — | 统一 AI 站点 URL |
| `AI_PROVIDER_API_KEY` | — | 统一 AI API Key |
| `AI_PROVIDER_TYPE` | `auto` | Provider 类型（auto/openai/anthropic） |
| `AI_PROVIDER_MODEL` | — | 模型 ID |
| `BOT_DISPLAY_NAME` | `群聊小助手` | Bot 显示名 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `ONBOARDING_DONE` | `false` | 引导流程完成标记 |

## 📄 License

Internal demo project — not for public distribution.
