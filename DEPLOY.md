# wx-assist-demo 部署与配置指南

> 部署到任何服务器前需要关注的所有配置项。

---

## 一、启动参数

`server.py` 末尾的 `main()` 函数：

| 参数 | 当前值 | 说明 | 部署时改法 |
|---|---|---|---|
| `host` | `"127.0.0.1"` | 监听地址 | 服务器部署改为 `"0.0.0.0"`，否则只接受本地连接 |
| `port` | `7328` | 监听端口 | 按需修改，或改为读取环境变量 `PORT` |

**建议改法**：

```python
# server.py main() 中
host = os.getenv("DEMO_HOST", "127.0.0.1")
port = int(os.getenv("DEMO_PORT", "7328"))
```

---

## 二、.env 配置文件

`.env` 文件搜索顺序：`data/.env` → 项目根目录 `.env` → 当前工作目录 `.env`，找到第一个即停。

### 2.1 AI 后端配置（核心）

| 变量名 | 默认值 | 必须 | 说明 |
|---|---|---|---|
| `AI_PROVIDER_BASE_URL` | _(空)_ | **是** | AI API 根地址，如 `https://api.deepseek.com` |
| `AI_PROVIDER_API_KEY` | _(空)_ | **是** | 对应站点的 API Key |
| `AI_PROVIDER_TYPE` | `auto` | 否 | `openai` / `anthropic` / `auto`（自动检测） |
| `AI_PROVIDER_MODEL` | _(空)_ | 否 | 模型 ID，如 `deepseek-v4-flash`。`auto` 时自动选第一个检测到的 |

> 不填 AI 配置也能启动，但 AI 相关功能（对话/摘要/检测）会返回错误或模拟响应。

### 2.2 Legacy AI 配置（不推荐，新项目忽略）

| 变量名 | 默认值 | 必须 | 说明 |
|---|---|---|---|
| `AI_BACKEND` | `deepseek` | 否 | `deepseek` 或 `claude`（仅在未填 AI_PROVIDER_* 时生效） |
| `DEEPSEEK_API_KEY` | _(空)_ | 否 | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 否 | DeepSeek API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 否 | DeepSeek 模型 |
| `ANTHROPIC_API_KEY` | _(空)_ | 否 | Anthropic API Key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | 否 | Anthropic API 地址 |
| `SUMMARIZE_MODEL` | `claude-haiku-4-5-20251001` | 否 | Claude 模型 |

> **优先级**：`AI_PROVIDER_*` > legacy `DEEPSEEK_*` / `ANTHROPIC_*`

### 2.3 机器人设置

| 变量名 | 默认值 | 必须 | 说明 |
|---|---|---|---|
| `BOT_DISPLAY_NAME` | `群聊小助手` | 否 | 机器人显示名（Demo 中仅展示用） |
| `LOG_LEVEL` | `INFO` | 否 | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `LOG_FILE` | `data/demo.log` | 否 | 日志文件路径（相对于项目根目录） |
| `CHUNK_SIZE` | `400` | 否 | AI 摘要分块大小 |
| `TRIGGER_KEYWORDS` | _(内置列表)_ | 否 | 逗号分隔的触发关键词，覆盖默认值 |

### 2.4 系统标记

| 变量名 | 默认值 | 必须 | 说明 |
|---|---|---|---|
| `ONBOARDING_DONE` | _(不存在)_ | 否 | 值为 `true` 时跳过引导页，由系统自动写入 |
| `WEBOT_ENV_FILE` | _(空)_ | 否 | 显式指定 .env 文件绝对路径，覆盖自动搜索 |
| `WEBOT_APP_HOME` | _(空)_ | 否 | 显式指定项目根目录 |

---

## 三、前端配置

| 配置项 | 位置 | 值 | 说明 |
|---|---|---|---|
| `API_BASE` | `ui-src/src/components/SharedComponents.jsx` | `''` (空字符串) | 同源请求，**不需要改**。部署后浏览器访问哪个地址，API 就请求哪个地址 |
| Vite dev port | `ui-src/vite.config.js` | `5173` | 仅开发用，生产环境由 server.py serve dist/ |

> 前端零硬编码地址，部署不需要改任何前端代码。

---

## 四、运行时配置文件

`data/` 目录下的持久化文件（首次运行自动创建）：

| 文件 | 说明 | 格式 |
|---|---|---|
| `data/.env` | 实际配置（优先于根目录 .env） | key=value |
| `data/assistant_config.json` | 助手配置（关键词告警/定时摘要） | JSON |
| `data/demo.log` | 运行日志 | 文本 |

### assistant_config.json 结构

```jsonc
{
  "config": {
    "version": 1,
    "assistant_enabled": true,
    "allow_wechat_send": false,
    "alert_groups": [
      {
        "chat_id": "群聊ID",
        "group_name": "群名",
        "keywords": ["紧急", "BUG"],
        "enabled": true
      }
    ],
    "digest_groups": [
      {
        "chat_id": "群聊ID",
        "group_name": "群名",
        "schedule": ["09:00"],
        "cron_expr": "0 9 * * *",
        "lookback_hours": 6,
        "enabled": true,
        "unread_only": true,
        "push_target": "ilink",
        "profile": {
          "purpose": "用途",
          "description": "描述",
          "focus": ["关注点"],
          "ignore": ["忽略内容"],
          "style": "摘要风格",
          "custom_prompt": ""
        }
      }
    ]
  }
}
```

> 此文件通过前端「群聊助手」面板编辑保存，一般不需要手动改。

---

## 五、部署步骤

### 5.1 服务器部署（Linux / 云主机）

```bash
# 1. 克隆项目
git clone <repo-url> wx-assist-demo
cd wx-assist-demo

# 2. 安装依赖
pip install -r requirements.txt

# 3. 创建配置
cp .env.example data/.env
# 编辑 data/.env，填入 AI_PROVIDER_BASE_URL 和 AI_PROVIDER_API_KEY

# 4. 构建前端（如果 dist/ 不在仓库中）
cd ui-src && npm install && npm run build && cd ..

# 5. 启动
#    修改 server.py 中 host 为 "0.0.0.0"，或设置环境变量
DEMO_HOST=0.0.0.0 DEMO_PORT=7328 python server.py
```

### 5.2 Docker 部署（参考）

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN cd ui-src && npm install && npm run build && cd ..
EXPOSE 7328
CMD ["python", "server.py"]
```

### 5.3 注意事项

- **host**：默认 `127.0.0.1` 只监听本地，服务器部署必须改为 `0.0.0.0`
- **端口**：默认 `7328`，与正式项目 `7327` 不冲突
- **.env 位置**：建议放在 `data/.env`，不会被 git 跟踪
- **data/ 目录**：运行时自动创建，包含 .env / assistant_config.json / demo.log
- **前端**：SPA 架构，`API_BASE=''` 同源请求，不需要配置后端地址

---

## 六、配置检查清单

部署前逐项确认：

- [ ] `server.py` 中 `host` 改为 `"0.0.0.0"`（或环境变量 `DEMO_HOST`）
- [ ] `server.py` 中 `port` 改为需要的端口（或环境变量 `DEMO_PORT`）
- [ ] `data/.env` 中 `AI_PROVIDER_BASE_URL` 填入 API 地址
- [ ] `data/.env` 中 `AI_PROVIDER_API_KEY` 填入有效 Key
- [ ] `data/.env` 中 `AI_PROVIDER_MODEL` 填入模型 ID（或填 `auto` 让检测自动选）
- [ ] 前端 `dist/` 已构建（`cd ui-src && npm run build`）
- [ ] 防火墙放行对应端口
