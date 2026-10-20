# 部署方案

OAA 由两个**相互独立**的组件组成：

| 角色 | 组件 | 部署位置 | 职责 |
|---|---|---|---|
| 凭据生产 | **OAA-local**（`bin/` `src/`） | Windows / macOS / Linux 电脑 | 读取本机已登录客户端的凭据，保存到本地账号库，推送到网关 |
| 聚合与路由 | **OAA-server**（`OAA-server/`） | Docker（本机 / Linux 服务器 / NAS） | 接收账号、维护账号池、按优先级与健康度路由、暴露 OpenAI 兼容端点 |

```
  ┌─ 电脑端（需已登录各平台客户端）────┐        ┌─ 服务端 / 本机网关 ──────────────┐
  │  客户端登录态（只读解密）           │        │  OAA-server  (面板:3066)        │
  │            │                        │        │  账号池 · 优先级 · 429 降级      │
  │            ▼                        │        │        ▲                        │
  │  OAA-local  harvest                 │        │        │ POST /api/accounts     │
  │  scan → accounts.json (0600)        │        │        │ (x-api-key / Bearer)   │
  │            │   push                 │───────▶│────────┘                        │
  └────────────┼────────────────────────┘        │        ▼  /v1/chat/completions  │
               │                                 │   任意 OpenAI 兼容客户端        │
               │                                 └─────────────────────────────────┘
               └─ 服务端**不发起任何登录**，只接收电脑端已生成好的凭据
```

> 端口：默认**分端口**部署 —— 面板与 `/api/*`（含账号推送接口）在 **3066**，
> 网关 `/v1/*` 与 `/health` 在 **3065**。对外只暴露 `3065`，详见 [1.5](#15-分端口部署公网只映射-3065)。

> 前置提醒：WorkBuddy 与 Qoder **不支持同一台电脑并行保持多个账号的活跃登录**。
> 多账号需「登录一个 → `scan --save` 采集 → 退出 → 登录下一个」逐个积累。

---

## 一、服务端：部署 OAA-server

### 1.1 Docker（推荐）

```bash
cd OAA-server

# 简单版（数据用 ./data 绑定挂载）
docker compose up -d --build

# 或加固版（只读根文件系统 + cap_drop ALL + 命名卷 + 默认只绑 127.0.0.1）
cp deploy/docker/.env.example deploy/docker/.env
docker compose -f deploy/docker/compose.yaml up -d --build
```

首次构建要编整棵 Rust 依赖树；之后只重编源码层。

两套都是**分端口**：网关 `3065`、面板 `3066`（下节的步骤 1 与 `push --endpoint` 都按这个来）。
命令都在 `OAA-server` 目录下执行。

### 1.2 首次配置

1. 浏览器打开 `http://<主机>:3066/`（面板端口）；
2. 首次进入引导**注册管理员账号**；
3. 打开「**网关 Key**」页创建一把 API Key —— **这就是 OAA-local `push --key` 要带的值**；
4. 记录客户端接入地址：`http://<主机>:3065/v1`（网关端口，与面板端口不同）。

> ⚠️ 未建 Key 前 `/v1` 是 **fail-closed（拒绝转发）**；管理接口 `/api/*` 在「一把 Key 都没配」时放行，
> 因此**必须先建 Key 再推送**，否则 `push` 会被 401 拒。

### 1.3 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OAA_HOST` | `0.0.0.0` | 监听地址 |
| `OAA_PROXY_PORT` | `3065` | 监听端口 |
| `OAA_PANEL_PORT` | compose 里已设 `3066` | 面板分端口：管理面（面板界面 + `/api/*`）独立监听该端口，主端口只留 `/v1/*` + `/health` |
| `OAA_PROXY_HOME` | `~/.oaa`（容器内 `/data`） | 配置 / 数据目录 |
| `OAA_UI_DIR` | 空 | 面板静态目录（容器内 `/app/ui`） |
| `OAA_ADMIN_USER` / `OAA_ADMIN_PASSWORD` | 空 | 预置管理员（密码明文填，启动时转哈希）；留空走面板注册 |
| `OAA_ALLOW_NO_KEY` | 空 | 置 `1` 关闭 `/v1` 的 fail-closed，**仅限纯内网** |
| `OAA_CAPTCHA_ENABLED` | `1` | 登录页人机验证开关 |

### 1.4 网络与安全

- 容器内监听 `0.0.0.0`，**实际暴露面由 compose 的端口映射决定**：
  - 两套 compose 都默认分端口，`3066`（面板 + `/api/*`）默认只绑 `127.0.0.1`；
  - `3065`（网关）默认也只绑回环，要对外就改 `.env` 的 `OAA_BIND_ADDRESS`，或让隧道转发到回环。
- 跨公网时前置反向代理 / 隧道并**启用 TLS**（网关卡自身不做 TLS），`push --endpoint`
  与客户端 `base_url` 都指向 `https://…`。
- **不要把 `3066` 映射到公网**：它是管理面，暴露即等于面板登录页 + `/api/*` 一起对外，
  只剩账号密码一层门。
- 网关 Key **等同管理凭据**，泄漏即等于账号池可被他人接管。
- 网关落盘的是**明文凭据**（`accessToken` / `refreshToken`），务必限制数据卷访问权限。

### 1.5 分端口部署（公网只映射 3065）

两套 compose 都已默认分端口，落点如下：

| 端口 | 内容 | 暴露范围 |
|---|---|---|
| `3065` | 网关：`/v1/*`（对话）与 `/health` | **对外** —— 隧道 / frp / 公网映射只映射这一个 |
| `3066` | 管理面：面板界面与 `/api/*`（账号推送也在这里） | 仅本机回环 / 内网 |

要点：

- **OAA-local 的 `push --endpoint` 必须指向 `3066`**（不是 `3065`）—— `/api/accounts` 只挂在管理面。
  此时 `push` 会因为该端口没有 `/health` 而多打一行「跳过健康自检」的提示，属正常现象。
- **同内网的电脑要推送**：把 `.env` 里 `OAA_PANEL_BIND_ADDRESS` 改成宿主机内网地址
  （如 `192.168.1.10`），然后 `push --endpoint http://192.168.1.10:3066`；**不要**填公网地址。
- **面板本身只应内网访问**：异地要看面板、或要跨机推送，都走私网通道，
  不要为图省事把 `3066` 也映射到公网。
- 隧道 / frp 的后端目标只有一个：`127.0.0.1:3065`；客户端 `base_url` 用 `https://<隧道域名>/v1`。

---

## 二、电脑端：部署 OAA-local

### 2.1 安装

无需安装，要求 **Node.js ≥ 20**：

```bash
node OAA-local/bin/harvest.js --help
```

### 2.2 数据目录

| 项 | 值 |
|---|---|
| 默认目录 | `~/.oaa` |
| 覆盖方式 | 环境变量 `OAA_HOME` |
| 账号库文件 | `<数据目录>/accounts.json`（0600 权限，原子写） |

### 2.3 首次采集与推送

```bash
node OAA-local/bin/harvest.js detect                  # 探测本机客户端安装 / 登录环境
node OAA-local/bin/harvest.js scan                    # 采集（只探测，不落库）
node OAA-local/bin/harvest.js scan --save             # 落库
node OAA-local/bin/harvest.js push --dry-run          # 预演：只看将发送的请求体
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --key <网关Key>
```

> `--endpoint` 指向**面板端口**（分端口部署下是 `3066`）：`/api/accounts` 只挂在管理面。

推送是**逐账号 `POST /api/accounts`**，网关按 uid 合并（命中更新 / 未命中追加），**反复推送幂等**。

### 2.4 定时任务

token 会过期，建议定期重新采集并推送。**Windows（计划任务）**——先写串行脚本 `oaa-sync.cmd`：

```bat
@echo off
set OAA_HOME=%USERPROFILE%\.oaa
node "e:\path\to\OpenAgentAPI\bin\harvest.js" scan --save
node "e:\path\to\OpenAgentAPI\bin\harvest.js" push --endpoint http://127.0.0.1:3066 --key <网关Key>
```

```powershell
schtasks /Create /TN "OAA-Sync" /SC DAILY /ST 09:30 /TR "e:\path\to\oaa-sync.cmd" /F
```

**Linux / NAS（cron）**：

```cron
30 9 * * * OAA_HOME=/home/me/.oaa OAA_KEY=<密钥> /usr/bin/node /opt/OpenAgentAPI/OAA-local/bin/harvest.js scan --save && OAA_HOME=/home/me/.oaa OAA_KEY=<密钥> /usr/bin/node /opt/OpenAgentAPI/OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066
```

> Key 走环境变量 `OAA_KEY`，避免出现在命令行（会被进程列表看到）。

### 2.5 部署边界

- OAA-local **必须在能读到客户端登录态的机器上跑**（读的是本机客户端的加密凭据文件，Windows 上还依赖 DPAPI / 注册表），不能搬到服务器。
- OAA-server **可以**在另一台机器上跑，只要 OAA-local 能访问其**管理面端口**（分端口部署是 `3066`，
  见 1.5；同机部署走回环即可，跨机需把 `OAA_PANEL_BIND_ADDRESS` 指到内网地址或走私网通道）。

---

## 三、联调与验收清单

| # | 检查 | 命令 / 位置 | 期望 |
|---|---|---|---|
| 1 | 网关存活 | `curl http://<主机>:3065/health` | 200（网关端口） |
| 2 | 网关 Key 已建 | 面板（`3066`）「网关 Key」页 | 至少一把启用的 Key |
| 3 | 本机环境识别 | `node OAA-local/bin/harvest.js detect` | 目标平台显示「已登录」 |
| 4 | 凭据读取成功 | `node OAA-local/bin/harvest.js scan` | 列出账号，`过期` 字段有值 |
| 5 | 载荷正确 | `node OAA-local/bin/harvest.js push --dry-run --json` | 各 provider 的 `body` 字段符合 USAGE.md 的映射表 |
| 6 | 真实推送 | `push --endpoint http://<主机>:3066 --key <Key>` | 汇总显示「成功 N」 |
| 7 | 落库可见 | 面板（`3066`）「账号」页 | 出现对应账号 |
| 8 | 端到端 | 客户端 `base_url=http://<主机>:3065/v1` | 能正常对话 |

---

## 四、安全与合规

- 本项目**只复用你自己账号的本机登录态**，不破解、不绕过任何鉴权；额度来自你账号本就拥有的配额。
- 这类「以非官方客户端形态复用登录态」的转发**可能不符合上游服务条款**，存在被限流 / 风控 / 冻结风险，请自行评估并控制使用强度。
- 凭据在两端**均为明文落盘**：切勿提交公开仓库、上传网盘或分享。
- 建议：面板分端口并绑回环（compose 已默认）；对外只暴露网关端口；跨公网走 TLS 隧道 / 反代；定期轮换网关 Key。
