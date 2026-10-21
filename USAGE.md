# 使用说明（OAA-local）

入口：`node OAA-local/bin/harvest.js <命令>`。五个命令：`detect` / `scan` / `list` / `push` / `export`。

---

## 一、命令一览

| 命令 | 作用 |
|---|---|
| `detect [--json]` | 探测本机各平台客户端是否安装 / 已登录 |
| `scan [--save] [--json] [--reveal] [--no-legacy] [--legacy-provider <p>]` | 读取本机已登录账号（解密各客户端凭据） |
| `list [--json]` | 列出已保存到本地账号库的账号（token 脱敏） |
| `push [--endpoint <url>] [--key <k>] [--only <p1,p2>] [--dry-run] [--timeout <ms>] [--no-health]` | 把本地账号推送到 OAA-server 网关 |
| `export [--out <file>] [--json]` | 导出成 OAA-server 面板「导入账号」/「添加账号 → 导入」可直接选用的文件 |

### scan 选项

| 选项 | 说明 |
|---|---|
| `--save` | 把采集结果写入本地账号库（默认只探测不落库） |
| `--json` | 以 JSON 输出（含候选与错误明细；**含 token 原文**，别重定向到日志文件） |
| `--reveal` | 人类可读输出时显示完整 token（默认脱敏） |
| `--no-legacy` | 跳过旧版 IDE / CLI 的明文 token 扫描 |
| `--legacy-provider <p>` | `--save` 时把旧版 token 候选归入指定 provider（默认跳过） |

### push 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `--endpoint <url>` | `http://127.0.0.1:3065` | OAA-server **管理面**地址；服务端分端口部署时是面板端口（默认 `3066`） |
| `--key <key>` | 环境变量 `OAA_KEY` | 网关 API Key（推荐用环境变量，避免进进程列表） |
| `--only <p1,p2>` | 全部 | 只推送指定 provider，如 `--only qoder,workbuddy,trae` |
| `--dry-run` | 关 | 只打印将要发送的请求体，不发送 |
| `--timeout <ms>` | `20000` | 单请求超时 |
| `--no-health` | 关 | 跳过推送前的 `/health` 自检 |

退出码：有账号推送失败时为 `1`，便于脚本判断。

### export 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `--out <file>` | `<数据目录>/accounts.server.json` | 输出文件（0600 权限，含明文 token） |
| `--json` | 关 | 以 JSON 输出导出结果 |

`export` 产出的是 **OAA-server 自己的导出格式**（`{version, exportedAt, customProviders, accounts:[…]}`，
记录为平铺形态、`accessToken`/`refreshToken`/身份字段都在顶层），所以能在面板
「设置 → 数据 → 导入账号」里直接选用。它与 `push` 的区别只在通道：`push` 需要网关在线并带 Key，
逐条走 `POST /api/accounts`；`export` 只写一个文件，离线也能产出，适合手动导入或换机迁移。
两者用的是**同一套 provider 映射**，不支持 / 缺 uid 的账号同样会被跳过并给出原因。

### 在面板里导入文件（两个入口，认的是同一份文件）

`export` 的产物可以在面板里从两处导入，都走同一个接口 `POST /api/accounts/import`（merge 语义：按身份匹配，命中更新、未命中追加）：

| 入口 | 位置 | 说明 |
|---|---|---|
| 「添加账号」弹窗 → **导入** 分段 | 账号页「添加账号」→ 分段控件第四项「导入」 | 选文件 → 逐条勾选预览 → 「导入所选」；不离开弹窗就能导入 |
| 「导入账号」按钮 | 设置 → 数据 | 选文件后直接整份提交（旧入口，行为不变） |

两个入口都只吃**服务端自己的导出格式**（顶层对象 + `accounts` 数组、记录平铺）。文件的来源可以是面板
「导出账号」，也可以是 `node OAA-local/bin/harvest.js export` —— 两者结构一致。

> 为什么要走「整份文件」而不是逐平台粘贴凭证：采集器导出的 Qoder 记录是**设备流**凭证
> （`accessToken` = `dt-…`、`refreshToken` = `drt-…`），而 Qoder 的「填写凭证」表单只收官网生成的
> PAT（`pt-…`）。两者格式不通，所以 Qoder 这类平台**保持原样**、不硬塞进凭证表单；
> 它的设备流记录随文件导入即可，服务端会自动补齐缺失的 `machineId` 并用 `drt-` 走设备刷新端点。

---

## 二、典型用法

```bash
node OAA-local/bin/harvest.js detect                 # 看本机有什么可采
node OAA-local/bin/harvest.js scan --save            # 采集并落库
node OAA-local/bin/harvest.js list                   # 查看本地账号库
node OAA-local/bin/harvest.js push --dry-run         # 预演（强烈建议先跑）
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --key sk-xxxxx    # 真实推送
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --only qoder,qoder-cn,workbuddy,workbuddy-intl,trae --key sk-xxxxx
node OAA-local/bin/harvest.js export                 # 导出成面板可导入的文件
```

> `--endpoint` 打的是**管理面端口**：默认单端口部署是 `3065`，服务端分端口部署
> （compose 默认设了 `OAA_PANEL_PORT=3066`，公网只映射 3065）则要写成 `3066`。

### 输出示例

```text
$ node OAA-local/bin/harvest.js scan
采集到 1 个候选（客户端登录 1，旧版文件 0）
  ✓ Trae  T.sl  uid=3440790062505251  过期=2026-10-26T04:20:27.605Z  [新]  Trae 当前登录
（未落库；加 --save 写入本地账号库）

$ node OAA-local/bin/harvest.js push --dry-run
推送到 http://127.0.0.1:3065（共 1 个账号） [dry-run]
  · Trae  T.sl → trae  [dry-run]
汇总：成功 0，失败 0，跳过 0，预演 1
```

---

## 三、支持的平台与凭据来源

| provider | 本机凭据来源 | 读取方式 | 能否推送到网关 |
|---|---|---|---|
| `qoder` / `qoder-cn` | `<用户数据目录>/auth.v1.dat` | Electron safeStorage：Windows DPAPI+AES-256-GCM；macOS 钥匙串+AES-128-CBC；Linux `peanuts`+AES-128-CBC | ✅ → `qoder` |
| `workbuddy` / `workbuddy-intl` | `CodeBuddyExtension/Data/Public/auth/*.info` | v5.8+ 敏感字段为 `$wbEncrypted` 信封（AES-256-GCM）；密钥只存在于运行中的客户端进程内存，采集时经 PowerShell 只读扫描取回（**仅 Windows，需客户端保持运行**）。早期版本为明文 JSON。按 Keycloak JWT 签发域名区分国内 / 国际版 | ✅ → `workbuddy` |
| `zcode` | `~/.zcode/v2/credentials.json` | `enc:v1:` AES-256-GCM（密钥由本机环境派生） | ✅ → `zcode`（需能解出 access_token） |
| `trae` | `<userData>/User/globalStorage/storage.json` 的 `iCubeAuthInfo://icube.cloudide` | Trae 自研「tc」信封：SHA512 派生 + AES-128-CBC + 完整性前缀 | ✅ → `trae`（短期限） |
| `catpaw`（妙手） | `%APPDATA%\catpaw-moon\catx-credential.json` | AES-256-GCM，密钥由注册表 `MachineGuid` 派生（**仅 Windows**） | ⚠️ → `catpaw`（**需 uid**，离线取不到 → 跳过） |
| `mirasim` | `~/.mirasim/setting.json` | `mrs1:` AES-256-GCM（master key 来自 DPAPI / Electron safeStorage / 环境变量） | ❌ 网关无此 provider |
| `minimax` | `~/.minimax/auth/prod/cn/mcode-public/auth.json` | 明文 records | ❌ 网关无此 provider |
| 旧版 IDE / CLI | IDE 数据目录 / `~/.qoder` 下的文本文件 | 正则扫描 `dt-` / `pt-` 明文 token | ⚠️ 归属需用 `--legacy-provider` 指定 |

**采集范围**：只读取「本机客户端的登录态」，不做浏览器会话 cookie 捕获，也不代替你登录。

---

## 四、推送到 OAA-server 的字段映射

网关接口：`POST /api/accounts`（逐账号），鉴权头 `x-api-key: <key>` 或 `Authorization: Bearer <key>`；
成功返回 `{account, list}`，失败返回 `{success:false, error:"…"}`。
该接口挂在**管理面端口**上：单端口部署是 `3065`，分端口部署（`OAA_PANEL_PORT`）是 `3066`。

| 本地 provider | 目标 provider | 关键字段 |
|---|---|---|
| workbuddy / workbuddy-intl | `workbuddy` | 嵌套 `auth{accessToken,refreshToken,expiresAt,domain}` + `account{uid,…}`；`edition=cn\|intl` |
| qoder / qoder-cn | `qoder` | 平铺 `accessToken,refreshToken,expiresAt,userId,machineId`；`mode=global\|cn` |
| trae | `trae` | `auth{accessToken,expiresAt,domain,apiHost,deviceId,variant:'solo'}` + `account{uid}` |
| zcode | `zcode` | 平铺 `accessToken`/`jwt`/`userId` |
| catpaw | `catpaw` | `accessToken` + 独立 `uid` |

约定与注意：

- `expiresAt` 统一转换成 **epoch 毫秒数字**（网关只认 JSON 数字）。
- 网关按 **uid 合并**（命中更新 / 未命中追加），**重复推送幂等**。
- 网关未配置任何 Key 时管理接口放行；**配了 Key 就必须带对**，否则 401。
- `--dry-run --json` 可查看每条账号将要发送的完整 `body`，便于核对。

---

## 五、数据目录与环境变量

| 变量 | 作用 |
|---|---|
| `OAA_HOME` | 数据目录（默认 `~/.oaa`）；账号库存于此 `accounts.json`（0600） |
| `OAA_KEY` | `push` 的默认网关 Key（等价 `--key`） |
| `ZCODE_HOME` / `ZCODE_CREDENTIAL_SECRET` | 覆盖 ZCode 数据目录 / 凭据密钥 |
| `MIRASIM_HOME` / `MIRASIM_DESKTOP_DATA_DIR` / `MIRASIM_SECRET_KEY` / `MIRASIM_APP_SECRET_KEY` | 覆盖 mirasim 目录 / master key |
| `MINIMAX_HOME` | 覆盖 MiniMax 数据目录 |
| `TRAE_HOME` | 覆盖 Trae 数据目录（指向含 `User/globalStorage/storage.json` 的目录） |
| `CATPAW_CREDENTIAL_FILE` | 覆盖妙手凭据文件路径 |
| `LOCALAPPDATA` / `APPDATA` / `XDG_DATA_HOME` / `XDG_CONFIG_HOME` | 各平台默认路径的基准（一般无需改） |

账号库结构（每条记录）：`id / name / provider / token / uid / email / refreshToken / expiresAt / source / meta / createdAt`。

---

## 六、故障排查

| 现象 | 原因与处理 |
|---|---|
| `detect` 显示「未安装 / 未登录」 | 客户端未装、未登录，或数据目录被挪过（可用相应 `*_HOME` 环境变量指定） |
| `scan` 列不出某个平台 | 该平台未登录；或该平台只有「当前登录」一份状态，需逐个账号登录后分别导入 |
| mirasim 报 `MISSING_SECRET_KEY` | 本机取不到 master key：完全退出 Mirasim 后重启登录，或用 `MIRASIM_SECRET_KEY` 指定 |
| `push` 报「无法连接 OAA-server」 | 网关未启动 / 端口不对 / 防火墙拦截；确认 `curl http://<主机>:3065/health` 通 |
| `push` 提示「未提供 /health…跳过健康自检」 | 正常：`/health` 只在网关端口（3065），管理面端口（3066）不提供它 —— 本工具按 404 视为「端口在监听」，继续推送 |
| `push` 每个账号都失败 404「Not found: POST /api/accounts」 | `--endpoint` 指到了网关端口；改指**管理面端口**（分端口部署是 3066） |
| `push` 报 401 | 网关已配 Key 但没带对：用 `--key` 或 `OAA_KEY` 传入面板建的 Key |
| `push` 报 400「缺少 uid」 | 该账号缺 uid（如 WorkBuddy 会话异常 / 妙手离线导入）——网关需要 uid 标识账号 |
| 妙手被「跳过：缺少 uid」 | 本机离线读取拿不到 uid，网关拒收；属预期行为 |
| mirasim / minimax 被跳过 | 网关注册表里没有这两家 provider，属预期 |
| Trae 一段时间后转发 401 | 本工具**故意不保存** Trae 的 refreshToken（保存会让你的 IDE 掉线），属短期凭据：重新登录 Trae → `scan --save` → `push` |
| 面板「导入账号」报「操作失败：导入内容必须是 JSON 对象」 | 选的文件顶层是**数组**（如采集器的 `~/.oaa/accounts.json`）。该入口只吃服务端自己的导出格式（顶层对象 + `accounts` 数组 + 顶层 `accessToken`）：改用 `harvest.js export` 产出的文件，或改走 `push` |
| 「添加账号 → 导入」选完文件没有预览行 | 文件不是面板导出格式：面板会就地报原因（顶层数组会直接提示改用 `harvest.js export`）。本地账号库 `~/.oaa/accounts.json` 是数组，不能直接选 |
| 推送成功但面板看不到 | 面板异步加载，刷新一次；或确认推的是同一台网关实例 |

---

## 七、限制与风险

- **只读本机登录态**：不代登录、不刷新 Trae 凭据（避免踢掉你正在用的 IDE）、不做浏览器 cookie 捕获。
- **明文落盘**：本地 `accounts.json` 与网关数据卷都存明文 token；请勿提交公开仓库 / 上传网盘。
- **合规**：这类「以非官方客户端形态复用登录态」的转发可能违反上游服务条款，存在账号被风控 / 封禁风险；额度仍来自你账号自身的配额。请仅用于自己已授权的账号，并控制使用强度。
- **上游易变**：各平台私有协议随时可能调整（尤其 Trae 的常量表、Qoder 的安装目录探测），失效时需同步适配。
