# 签到调度整合：折叠 Trae 定点轮进 `auto_checkin`

> 日期：2026-10-23　分支：`feature/fold-trae-daily-checkin`
> 关联：消除项目里第三个调度循环，统一「定点签到」入口。

## 一、背景

项目原先有 **3 个独立调度循环**：

| 调度器 | 形状 | 状态存储 | 托管 |
|---|---|---|---|
| `core::scheduled_tasks::spawn`（间隔型） | 每 N 分钟重复 | DB `task_state` | 凭证维护 / 余额 / 目录 / 版本 / Trae 签到(间隔) / CodeArts 福利 |
| `core::auto_checkin`（定点型·通用） | 每天 HH:MM 一次 | config.json `autoCheckin` | WorkBuddy / 小浣熊 / AutoClaw / Qoder |
| `trae::checkin::spawn_daily`（定点型·Trae） | 每天 HH:MM 一次 | **进程内存** | 仅 Trae |

`trae::checkin::spawn_daily` 是 `auto_checkin` 的近重复——同样的「30s 轮询 + 当天去重 + 启动补签 + 墙上时钟自愈」骨架，只因 Trae 的 claim 复杂（status 预检 → claim、拥挤 9074 去重、账号间隔）而单独复制了一套。这是项目里唯一一处与通用定点调度器重复的逻辑。

## 二、改动说明

让 Trae 成为 `auto_checkin` 的一个签到家，`fire` 里按 provider 分派。删掉 `spawn_daily`，定点时刻与去重都走 `auto_checkin` 的统一口径。**间隔型 `traeCheckin` 任务保留**（定点 + 间隔都留的语义不变，间隔负责兜底）。

### 文件清单

| 文件 | 改动 |
|---|---|
| `core/auto_checkin.rs` | `CHECKIN_PROVIDERS` 加 `"trae"`（5→6）；`provider_label("trae")` → `"Trae"`；`fire()` 改为按 provider 分派——其余家走 `billing::checkin::run_checkin`、trae 走 `trae::checkin::run_round`，两段结果合并成一份 `lastResult`；删 `record_success`（逻辑内联）；新增 3 个接线测试 |
| `core/providers/trae/checkin.rs` | 删 `spawn_daily` + `LAST_FIRED_DAY` + `last_fired()` + `DAILY_TICK`，留 relocation 注释；`run_round`/`status_all`/`classify_error` 全部不动 |
| `server/mod.rs` | 删 `spawn_daily` 的 bootstrap 调用（第 437 行） |
| `core/billing/checkin.rs` | `supports_checkin` 对 trae 仍返 false（run_checkin 不碰 trae），注释更新为「trae 签到由 auto_checkin 直调 run_round，不经本函数」 |
| `api/trae_checkin.rs` | `GET` 去掉 `traeCheckinTime` 字段；`PUT` 去掉 time 分支只留 `traeCheckinGapMinutes`；模块头说明定点时刻移至 `/api/auto-checkin` |
| `config/mod.rs` + `config/types.rs` | `trae_checkin_time()` / `set_trae_checkin_time` / `KEY_TRAE_CHECKIN_TIME` 标弃用（`#[allow(dead_code)]` + 注释），字段保留不破坏旧 config.json |
| `ui/islands/ui.js` | Trae 面板删「签到时刻」输入行 + `T()` 函数 + `[c,u]` state + `j()` 里的 time 读取；detail 段补「定点时刻在「定时签到」页统一设置（勾选 Trae）」 |

### 不变（红线）

间隔型 `traeCheckin` 任务、CodeArts 福利、凭证维护 / 余额 / 目录 / 版本任务、其余 5 家签到、手动「立即签到」按钮（`POST /api/scheduled-tasks/traeCheckin/run`）、`run_round` 的 status 预检 / 拥挤 9074 去重 / 账号间隔 / 错误分类、edition 排除、`traeCheckinGapMinutes`、签到历史台账。

### 行为变更（有意）

| 项 | 改前 | 改后 |
|---|---|---|
| Trae 定点时刻 | `traeCheckinTime`（默认 09:00） | `autoCheckin.time`（默认 00:01） |
| Trae 当天去重 | 进程内存（重启清空 → 补签） | `lastFiredDate` 落盘（重启后已签不再补发，与其余家一致） |
| 当天已跑过后再勾选 Trae | trae 会在自己定点时刻补跑 | 当天不补签，等次日（与其余家一致） |

> 依赖 09:00 定点的用户：部署后在「定时签到」页把 `time` 设回 09:00。
> 旧 config.json 里的 `traeCheckinTime` 字段保留但被忽略，无数据破坏。

## 三、前端界面使用步骤示例

> 前提：已添加 Trae 账号（「账号」页）。以下步骤对应部署本改动后的界面。

### 步骤 1：开启定时签到并设时刻（「定时签到」页）

1. 进入「定时签到」页（侧栏入口）。
2. 打开「定时签到」开关。
3. 在「触发时刻」填入每天签到的时刻，例如 `09:00`。
4. 在「签到提供商」复选框里勾选 **Trae**（与其余需要的家一同勾选，缺省全选）。
5. 保存。

> 此时刻对所有勾选的签到家统一生效（含 Trae）。Trae 不再有独立的定点时刻。

### 步骤 2：设 Trae 账号间隔（「福利」页 → Trae 标签）

1. 进入「福利」页，切到 **Trae** 标签。
2. 在「账号之间的间隔」填入分钟数（默认 10，`0` = 不等待）。
   - 作用：多个 Trae 账号共用同一出口 IP，真正写上游的账号之间隔多久再签下一个，防同 IP 连打被风控。
3. 点「保存」。

> 原先这里的「签到时刻」输入框已移除——定点时刻改在步骤 1 设置。

### 步骤 3：手动立即签到（可选）

- 在「福利」页 Trae 标签点 **「立即签到」** 按钮；
- 或在「定时任务」页找到 `traeCheckin` 任务，点「立即执行」。

两条手动路径都走同一个 `run_round`：先只读 `status` 预检，今天没签的才发 `claim`，已签的只花一次只读请求，不会重复写上游。

### 步骤 4：查看签到历史

- 「福利」页 Trae 标签点 **「签到历史」** 按钮。
- 同一份台账按 provider 过滤，WorkBuddy 系 / 小浣熊 / AutoClaw / Trae 的记录在同一张表里。
- 每条记录的 `来源` 标明：`manual`（面板手点）/ `daily`（定点轮）/ `interval`（间隔型任务）。

### 步骤 5：间隔兜底（「定时任务」页，可选）

1. 进入「定时任务」页。
2. 找到 **「自动签到（Trae）」** 任务（间隔型，默认 6 小时一轮，可改）。
3. 保持开启即可。

作用：万一定点那一轮失败（网络抖、上游 5xx），下一轮间隔还能补上。两者都调 `run_round`，靠服务端 `checked_in` 幂等，不会重复签。

## 四、验证

- `cargo check`：干净，无警告。
- `cargo test --lib`：284 passed / 5 ignored / 1 failed（唯一失败是 `welfare.rs` 既有测试 `an_unreadable_ledger_is_refused_not_treated_as_fresh`，与本次改动无关——已用 `git stash` 在干净 HEAD 上复现）。
- 新增 3 个接线测试（`auto_checkin::tests`）：钉住 Trae 进了 `CHECKIN_PROVIDERS` / `provider_label` / 缺省全选 / `normalize_providers` 保留 trae。

## 五、回滚

如需回退，恢复 `feature/fold-trae-daily-checkin` 的父提交即可。`traeCheckinTime` 配置字段未被删除，回滚后旧值仍能被读回。
