# OAA（OpenAgentAPI）

> 把你电脑上**已经登录的各家 AI 客户端**，一键变成一把统一的 **OpenAI 兼容 API** —— 无需额外付费、无需逆向破解，复用你本就拥有的账号额度。

---

## 为什么需要它

你可能在电脑上同时装了多家 AI 客户端：Qoder、Trae、ZCode（智谱 GLM / Z.ai）、WorkBuddy（腾讯 CodeBuddy）、CatPaw（美团妙手）、MiniMax Code、Mirasim……有的送额度、有的送会员、有的适合写代码、有的擅长长文。但它们彼此孤立，各自一套登录态、各自一套客户端，**没法在一个地方统一调度**。

OAA 做的事很简单：

> **读取你本机已经登录的客户端凭据 → 聚合成一个账号池 → 暴露成标准的 `/v1/chat/completions`**。

于是你常用的任何 OpenAI 兼容客户端（Cherry Studio、Open WebUI、VS Code 插件、自建脚本……）都能直接接入，由 OAA 在背后按**优先级 + 健康度 + 429 降级**自动挑一个可用的账号去转发。

---

## 它能为你做什么

- 🔌 **统一入口**：一个 `base_url` 接入所有 OpenAI 兼容客户端，告别"换个工具就要换登录"。
- 🪪 **零成本复用额度**：只读取你本机已登录账号的本地登录态，额度来自你账号本就拥有的配额，不破解、不绕过任何鉴权。
- 🧠 **多账号智能调度**：账号池支持按优先级、健康度路由，遇到 `429` / 限流自动降级到下一个可用账号，连续调用不中断。
- 🖥️ **桌面端 + IDE 通吃**：自动识别并采集本机已登录的 Qoder、Trae、ZCode、WorkBuddy、CatPaw、MiniMax Code、Mirasim 等客户端（桌面端 / IDE 插件），逐个采集、幂等推送。
- 🛡️ **安全自检**：网关在没建 Key 时 **fail-closed（默认拒绝转发）**，凭据落盘为明文但强制 `0600` 权限 + 原子写。
- 🐳 **一条命令起网关**：Docker 一键部署，管理面板 + OpenAI 兼容端点分端口隔离。

```
┌─ 电脑端（Windows / macOS / Linux · Node ≥ 20）────────┐
│  各平台客户端已登录                                    │
│        │ 本地解密（只读）                              │
│        ▼                                              │
│  OAA-local  采集凭据 → 存本地账号库 → 推送 ───────────┼──┐
└──────────────────────────────────────────────────────┘  │ POST /api/accounts
                                                           ▼
┌─ 服务端 / 本机网关（Docker · Rust ≥ 1.88）─────────────┐
│  OAA-server  账号池 · 优先级 · 429 降级 · 出站脱敏      │
│                     │                                  │
│                     ▼  /v1/chat/completions            │
│              任意 OpenAI 兼容客户端                     │
└────────────────────────────────────────────────────────┘
```

> **服务端不发起任何登录**：它只接收电脑端已经生成好的凭据。多账号靠"逐个登录 → 采集 → 推送"积累。

---

## 组件

| 目录 | 角色 | 技术栈 | 说明 |
|---|---|---|---|
| `bin/` `src/` | **OAA-local** —— 电脑端凭据采集与推送 | Node ≥ 20（零第三方运行时依赖） | 读取本机客户端登录态，保存到本地账号库，推送到网关 |
| `OAA-server/` | **OAA-server** —— 聚合与路由网关 | Rust ≥ 1.88 / Docker | 账号池、优先级调度、OpenAI 兼容端点、管理面板 |

两个组件**相互独立**：OAA-server 可在服务器上跑，OAA-local 必须在装有客户端的机器上跑。

---

## 快速开始

### 1. 起网关（OAA-server）

```bash
cd OAA-server
docker compose up -d --build
```

浏览器打开 `http://<主机>:3066/` → 注册管理员 → 「网关 Key」页建一把 Key。

> 端口分两个：`3066` 是面板（界面 + `/api/*`，默认只绑回环），`3065` 是网关
> （`/v1/*` + `/health`，对外只暴露这一个）。详见 DEPLOY.md 的「1.5 分端口部署」。

### 2. 采集并推送（OAA-local）

```bash
# 探测本机各客户端安装 / 登录环境
node OAA-local/bin/harvest.js detect

# 采集本机已登录账号并落库
node OAA-local/bin/harvest.js scan --save

# 预演（只看将要发送的请求体）
node OAA-local/bin/harvest.js push --dry-run

# 真正推送
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --key <网关Key>
```

### 3. 客户端接入

把你常用的 OpenAI 兼容客户端 `base_url` 填成 `http://<主机>:3065/v1`，
`api_key` 填面板建的那把 Key。

---

## 文档

| 文档 | 内容 |
|---|---|
| [DEPLOY.md](./DEPLOY.md) | 部署方案：网关、电脑端、定时任务、联调验收、安全 |
| [USAGE.md](./USAGE.md) | 使用说明：命令与选项、各平台凭据来源、字段映射、故障排查 |
| [OAA-server/README.md](./OAA-server/README.md) | 服务端组件的构建与运行细节 |

---

## 目录结构

```
OpenAgentAPI/
├── OAA-local/                # 电脑端：采集 + 推送（Node ≥ 20）
│   ├── bin/harvest.js        # CLI：detect / scan / list / push
│   ├── src/
│   │   ├── detect/           # 各平台本地登录态读取与解密（只读）
│   │   ├── push/oaa.js       # 推送到 OAA-server（POST /api/accounts）
│   │   ├── store.js          # 本地账号库（0600 + 原子写）
│   │   ├── accounts.js · scan.js
│   │   └── constants.js · jwt.js · winProc.js
│   ├── LICENSE               # 专有许可 · 保留所有权利
│   ├── THIRD-PARTY-NOTICES.md
│   └── package.json
├── OAA-server/               # 服务端组件（Rust ≥ 1.88 / Docker）
├── DEPLOY.md · USAGE.md
├── README.md
└── .gitignore
```

---

## 环境要求

| 组件 | 要求 |
|---|---|
| OAA-local | Node.js ≥ 20；已在本机客户端登录要纳管的账号 |
| OAA-server | Docker（推荐）或 Rust ≥ 1.88 + C 工具链 |

---

## 数据位置

| 组件 | 路径 | 内容 |
|---|---|---|
| OAA-local | `$OAA_HOME`（默认 `~/.oaa`） | `accounts.json`（0600，含明文凭据） |
| OAA-server | `OAA_PROXY_HOME`（容器内 `/data`） | SQLite `oaa.db` + 配置 |

---

## 安全与合规

- 本项目**只复用你自己账号的本机登录态**，不破解、不绕过任何鉴权；额度来自你账号本就拥有的配额。
- 这类「以非官方客户端形态复用登录态」的转发**可能不符合上游服务条款**，存在被限流 / 风控 / 冻结的风险，请自行评估并控制使用强度。
- 凭据在两端**均为明文落盘**，切勿提交公开仓库、上传网盘或分享。
- 建议网关只在内网 / 回环可达；跨公网请走 TLS 反代并限制来源 IP。

---

## 许可

两个组件的许可**不同**：

| 组件 | 许可 |
|---|---|
| **OAA-local** | **专有许可 · 保留所有权利**（All Rights Reserved）—— 见 [OAA-local/LICENSE](./OAA-local/LICENSE)。其中源自第三方的部分仍受其原始 MIT 许可约束，声明与范畴见 [OAA-local/THIRD-PARTY-NOTICES.md](./OAA-local/THIRD-PARTY-NOTICES.md)（两者均须随软件保留） |
| **OAA-server** | **MIT 条款 + 使用声明**（禁止商业用途、二次分发牟利、批量账号运营）—— 见 [OAA-server/LICENSE](./OAA-server/LICENSE)。个人学习、研究、**自用**及不以牟利为目的的分享不受该限制 |

> 说明：OAA-local 的 `LICENSE` 中版权方名称是占位符，请填写你的名称 / 实体。
> 各 LICENSE 中保留的第三方版权声明属许可要求，请勿删除。
