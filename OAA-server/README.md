# OAA-server

多提供商本地网关（headless 服务端）：把各家 AI 桌面客户端的登录态包装成本地 **OpenAI 兼容 API**。
任何支持自定义 `base_url` 的客户端填 `http://<主机>:3065/v1` 即可调用这些账号的模型额度。

> 本目录是 **OAA 项目**的服务端组件，独立演进，不跟任何第三方仓库同步。

## 许可

见 [`LICENSE`](./LICENSE)：MIT 条款 **加上**一份使用声明（禁止商业用途、二次分发牟利、批量账号运营）。
**个人学习、研究、自用**以及不以牟利为目的的分享不受该限制。LICENSE 中保留的第三方版权声明是许可要求的一部分，请勿删除。

## 目录结构

```
OAA-server/
├── Cargo.toml               # cargo 虚拟 workspace 根（members = ["server"] + release profile）
├── Cargo.lock               # 锁定依赖版本
├── LICENSE                  # MIT + 使用声明
├── Dockerfile               # 只编 server crate；面板用 ui/ 产物
├── docker-compose.yml       # 简单部署（./data 绑定挂载）
├── server/                  # 网关本体（全部 Rust 源码：多家 provider 适配、账号池、面板后端）
│   └── src/bin/oaa-server.rs# headless 二进制入口
├── ui/                      # 面板前端**构建产物**（Dockerfile 直接 COPY，构建期不跑 npm）
└── deploy/docker/           # 加固版 compose + .env.example
```

本目录**不含**桌面壳与前端源码 —— 只保留运行服务端所需的最小集合。

## 环境要求

| 项 | 要求 |
|---|---|
| Rust | ≥ 1.88（`rusqlite 0.40` → `libsqlite3-sys 0.38` 决定） |
| C 工具链 | 需要（`rusqlite` 用 `bundled`，会编 SQLite 的 C 源码） |
| Docker | 推荐（镜像构建自带完整工具链，宿主无需装 Rust） |

## 构建与运行（推荐：Docker）

```bash
# 简单版
docker compose up -d --build

# 加固版（只读根文件系统 + cap_drop ALL + 默认只绑 127.0.0.1 + 命名卷）
cp deploy/docker/.env.example deploy/docker/.env
docker compose -f deploy/docker/compose.yaml up -d --build
```

首次：浏览器打开 `http://<主机>:3065/` → 注册管理员 → 「网关 Key」页建一把 Key
（**未建 Key 前 `/v1` 是 fail-closed，拒绝转发**）。

```bash
curl http://127.0.0.1:3065/health       # {"status":"ok"}
```

本地（非容器）构建：

```bash
cargo build --release -p oaa-server     # 产物：target/release/oaa-server
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OAA_HOST` | `0.0.0.0` | 监听地址 |
| `OAA_PROXY_PORT` | `3065` | 监听端口 |
| `OAA_PANEL_PORT` | 空 | 面板分端口（设置后面板独立监听，主端口只留 `/v1`） |
| `OAA_PROXY_HOME` | `~/.oaa`（容器内 `/data`） | 配置 / 数据目录 |
| `OAA_UI_DIR` | 空 | 面板静态目录（容器内 `/app/ui`） |
| `OAA_ADMIN_USER` / `OAA_ADMIN_PASSWORD` | 空 | 预置管理员（密码明文填，启动时转哈希）；留空走面板注册 |
| `OAA_ALLOW_NO_KEY` | 空 | 置 `1` 关闭 `/v1` 的 fail-closed，**仅限纯内网** |
| `OAA_CAPTCHA_ENABLED` | `1` | 登录页人机验证开关 |

## 数据与端点

| 项 | 值 |
|---|---|
| 数据目录 | `~/.oaa/`（容器内 `/data`），SQLite 库 `oaa.db` |
| 面板 | `/`（自托管 `OAA_UI_DIR`） |
| OpenAI 端点 | `/v1`（Chat / Responses / Messages） |
| 探活 | `/health` |

## 面板

`ui/` 是构建产物；本目录不含前端源码，如需改动面板样式/文案，需另备前端工程后重新构建并把产物覆盖到 `ui/`。

## 验证状态

| 项 | 结果 |
|---|---|
| manifest / workspace 结构 | ✅ `cargo metadata --offline --no-deps` 通过（package `oaa-server`，targets = `oaa_server` + `oaa-server`） |
| 依赖解析 / 编译 | ⚠️ 未在本机验证（本机缺 MSVC 链接器与 C 工具链）；请以 Docker 构建为准 |
