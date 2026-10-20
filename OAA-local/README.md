# OAA-local

电脑端凭据采集：读取本机各平台客户端的**登录态**（只读解密），保存到本地账号库，并推送到 OAA-server。

## 用法

要求 **Node.js ≥ 20**（零第三方运行时依赖）：

```bash
node bin/harvest.js detect              # 探测本机各客户端安装 / 登录环境
node bin/harvest.js scan --save         # 采集本机已登录账号并落库
node bin/harvest.js list                # 查看本地账号库（token 脱敏）
node bin/harvest.js push --dry-run      # 预演：只看将发送的请求体
node bin/harvest.js push --key <网关Key> # 推送到 OAA-server
node bin/harvest.js export              # 导出成面板「导入账号」可选用的文件
```

完整命令与选项见仓库根目录的 [USAGE.md](../USAGE.md)；
部署与定时任务见 [DEPLOY.md](../DEPLOY.md)。

## 目录

```
OAA-local/
├── bin/harvest.js      # CLI 入口：detect / scan / list / push
├── src/
│   ├── detect/         # 各平台本地登录态读取与解密（只读）
│   ├── push/oaa.js     # 推送到 OAA-server（POST /api/accounts）
│   ├── store.js        # 本地账号库（0600 + 原子写）
│   ├── accounts.js     # 账号去重合并
│   ├── scan.js         # 采集编排
│   └── constants.js · jwt.js · winProc.js
└── package.json
```

## 数据位置

| 项 | 值 |
|---|---|
| 数据目录 | `$OAA_HOME`（默认 `~/.oaa`） |
| 账号库 | `<数据目录>/accounts.json`（0600 权限，含**明文**凭据） |

## 许可

- 本目录由**版权方原创**的部分：**专有许可，保留所有权利**（All Rights Reserved）—— 详见 [LICENSE](./LICENSE)。
- 其中源自第三方的部分仍受其原始许可约束，声明与范畴见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

> `LICENSE` 中的版权方名称是占位符，请填写你的名称/实体。

## 注意

- 本工具**只读本机登录态**：不代登录、不刷新凭据、不做浏览器 cookie 捕获。
- 新版 **WorkBuddy** 客户端把 token 等字段加密落盘（`$wbEncrypted` 信封），采集时需 **WorkBuddy 客户端保持运行**：解密密钥只存在于其进程内存中，Windows 下经系统自带 PowerShell 只读扫描（`src/detect/wb-memscan.ps1`）取回。
- 本地账号库存**明文 token**；请勿提交公开仓库、上传网盘或分享。
