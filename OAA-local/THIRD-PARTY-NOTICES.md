# 第三方声明（Third-Party Notices）

本目录（OAA-local）的**部分源文件**源自第三方开源项目。按各自许可的要求，
以下版权声明与许可全文**必须原样保留**，不得移除或修改。

---

## 1. CreditDaddy

- 上游项目：<https://github.com/techysy/CreditDaddy>
- 来源版本：**v1.5.1**（本目录代码的提取基线）
- 许可：MIT（无附加限制）
- 版权：Copyright (c) 2026 CreditDaddy contributors

### 派生文件清单（第三方来源）

| 本目录文件 | 来源 |
|---|---|
| `src/detect/qoderApp.js` | CreditDaddy `src/qoderApp.js` |
| `src/detect/qoderLegacy.js` | CreditDaddy `src/localDetect.js` |
| `src/detect/workbuddy.js` | CreditDaddy `src/workbuddyLocal.js` |
| `src/detect/zcode.js` | CreditDaddy `src/zcodeLocal.js` |
| `src/detect/zcrypto.js` | CreditDaddy `src/zcrypto.js` |
| `src/detect/mirasim.js` | CreditDaddy `src/mirasimLocal.js` |
| `src/detect/catpaw.js` | CreditDaddy `src/catpawLocal.js` |
| `src/detect/trae.js` | CreditDaddy `src/traeLocal.js` |
| `src/detect/minimax.js` | CreditDaddy `src/minimaxLocal.js` |
| `src/detect/index.js` | CreditDaddy `src/daemon.js` 的 `/api/local/detect` 逻辑 |
| `src/store.js` | CreditDaddy `src/store.js`（按需裁剪） |
| `src/accounts.js` | CreditDaddy `src/accounts.js`（按需裁剪） |
| `src/scan.js` | CreditDaddy `src/daemon.js` 的 `/api/local/scan` + `/api/local/import` 逻辑 |
| `src/constants.js` | CreditDaddy `src/constants.js` |
| `src/jwt.js` | CreditDaddy `src/workbuddyClient.js` 的 JWT 解析部分 |
| `src/winProc.js` | CreditDaddy `src/winProc.js` |
| `bin/harvest.js` | 采集编排部分源自 CreditDaddy `src/daemon.js` / `bin/creditdaddy.js`；CLI 与 `push` 子命令为原创 |

### 原创文件（非第三方派生，受本目录 `LICENSE` 约束）

`src/push/oaa.js`、`README.md`、`LICENSE`、本文件。

> 上表派生部分仍受 MIT 许可约束：任何获得本软件副本的人，对**这部分代码**继续享有 MIT 授予的
> 使用、复制、修改、合并、发布、分发、再许可与销售的权利（需保留上述版权声明与本许可）。

```
MIT License

Copyright (c) 2026 CreditDaddy contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
