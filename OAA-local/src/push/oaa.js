// 对接 OAA-server（本项目服务端组件，Rust 本地网关）的账号推送。
//
// 目标接口（源码：server/src/server/api/accounts.rs）：
//   POST /api/accounts      手动添加单个账号（按 payload.provider 分派；成功返回 {account, list}）
//   GET  /health            连通性自检
//   GET  /api/accounts      账号列表
// 鉴权：请求头 `x-api-key: <key>` 或 `Authorization: Bearer <key>`
//       （源码 http_router.rs 的 require_api_key；未配置任何 Key 时管理接口放行）
// 错误信封：`{ success: false, error: "<message>" }`（源码 errors.rs 的 management_error）
//
// provider 取值（源码 providers/mod.rs 的 PROVIDERS / kind_from_id，仅列本采集器用到的）：
//   workbuddy（国内/国际版由 edition=cn|intl 区分）、qoder（地区由 mode=global|cn）、
//   trae、zcode / zcode-intl、catpaw。
// 本采集器支持的 provider 中，mirasim / minimax 在 OAA-server 注册表里**不存在**，
// 一律按「不支持」跳过，绝不硬塞进 workbuddy 分支（源码注释明确：未知 provider 会被
// 静默存进 workbuddy 组，造成账号与凭证一起错位）。

import os from 'node:os';
import * as zc from '../detect/zcrypto.js';

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3065';
const DEFAULT_TIMEOUT_MS = 20000;

/** OAA-server 注册表里没有的 provider —— 明确标记不支持，不静默丢弃 */
const UNSUPPORTED = {
  mirasim: 'OAA-server 无 mirasim 提供商',
  minimax: 'OAA-server 无 minimax 提供商',
};

/** ISO 时间 → epoch 毫秒数字（OAA-server 的 expiresAt 只认 JSON 数字，见 trae/credentials.rs） */
function epochMs(value) {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

/** 从 meta 里取出 Qoder 的 machineId（不同来源的键名不一，宽容匹配） */
function qoderMachineId(a) {
  const meta = a.meta || {};
  const auth = meta.qoderAuth || {};
  for (const key of ['machineId', 'machine_id', 'machine-id', 'deviceId']) {
    const v = auth[key] ?? meta[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** ZCode：把 meta.credentials 里可能加密的 access_token / zcodejwttoken 解出来 */
function zcodeCreds(a) {
  const creds = a.meta?.credentials || {};
  const secret = zc.defaultSecret(process.env.ZCODE_HOME || os.homedir());
  let accessToken = '';
  for (const key of Object.keys(creds)) {
    if (key.startsWith('oauth:') && key.endsWith(':access_token')) {
      const plain = zc.safeDecrypt(creds[key], secret);
      if (plain) { accessToken = plain; break; }
    }
  }
  const rawJwt = creds.zcodejwttoken;
  const jwt = typeof rawJwt === 'string' ? (zc.safeDecrypt(rawJwt, secret) || '') : '';
  return { accessToken, jwt };
}

/**
 * 把一条本采集器账号映射成 OAA-server 的 POST /api/accounts 请求体。
 * @returns {{ ok: true, providerId: string, body: object } | { ok: false, reason: string }}
 */
export function toAgent2ApiPayload(account) {
  const p = account.provider;
  if (UNSUPPORTED[p]) return { ok: false, reason: UNSUPPORTED[p] };

  if (p === 'workbuddy' || p === 'workbuddy-intl') {
    // 源码 store_crud.rs::add_account：**必须**是 {auth:{accessToken,refreshToken,…}, account:{uid,…}} 嵌套形态；
    // 平铺的 accessToken 不会被读取（auth 为空对象 → 直接报「缺少 accessToken」）。
    if (!account.uid) return { ok: false, reason: 'WorkBuddy 账号缺少 uid，无法标识账号（oaa 会拒收）' };
    return {
      ok: true,
      providerId: 'workbuddy',
      body: {
        provider: 'workbuddy',
        edition: p === 'workbuddy-intl' ? 'intl' : 'cn',
        name: account.name || undefined,
        auth: {
          accessToken: account.token,
          refreshToken: account.refreshToken || undefined,
          expiresAt: epochMs(account.expiresAt),
          domain: account.meta?.domain || undefined,
        },
        account: {
          uid: account.uid,
          nickname: account.name || undefined,
          phoneNumber: account.meta?.phone || undefined,
          enterpriseId: account.meta?.enterpriseId || undefined,
        },
      },
    };
  }

  if (p === 'qoder' || p === 'qoder-cn') {
    // 源码 qoder/credentials.rs::from_payload：**平铺**键 accessToken/refreshToken/userId/machineId，
    // 地区由 mode（global|cn，见 qoder/endpoints.rs::Region::from_payload）决定。
    if (!account.uid) return { ok: false, reason: 'Qoder 账号缺少 userId，oaa 无法标识账号' };
    return {
      ok: true,
      providerId: 'qoder',
      body: {
        provider: 'qoder',
        mode: p === 'qoder-cn' ? 'cn' : 'global',
        accessToken: account.token,
        refreshToken: account.refreshToken || undefined,
        expiresAt: epochMs(account.expiresAt),
        userId: account.uid,
        machineId: qoderMachineId(account),
        email: account.email || undefined,
        nickname: account.name || undefined,
      },
    };
  }

  if (p === 'trae') {
    // 源码 trae/credentials.rs::from_payload：{auth:{accessToken,refreshToken,expiresAt,domain,apiHost,deviceId,variant,…}, account:{uid,nickname}}。
    // domain 是裸主机名、apiHost 是带 scheme 的基址（见 adapter.rs 的测试夹具：
    // domain="trae.cn" / apiHost="https://api.trae.cn"）。本采集器的 meta.host 存的是
    // 客户端记录里的 **基址**（如 https://api.trae.cn），故映射到 apiHost，并把裸主机名派给 domain。
    // ⚠️ 本采集器**故意不保存** Trae 的 refreshToken 与设备私钥（保存会让 IDE 掉线），
    //    因此这条是「短期凭据」：accessToken 约 14 天到期后需重新登录 Trae 再导入。
    const host = (account.meta?.host || '').trim();
    return {
      ok: true,
      providerId: 'trae',
      body: {
        provider: 'trae',
        name: account.name || undefined,
        auth: {
          accessToken: account.token,
          refreshToken: account.refreshToken || undefined,
          expiresAt: epochMs(account.expiresAt),
          domain: host ? host.replace(/^https?:\/\//, '').replace(/\/+$/, '') : undefined,
          apiHost: host || undefined,
          deviceId: account.meta?.deviceId || undefined,
          variant: 'solo',
        },
        account: { uid: account.uid || undefined, nickname: account.name || undefined },
      },
    };
  }

  if (p === 'zcode') {
    // 源码 api/accounts.rs ZCode 分支：平铺 accessToken / jwt / userId。
    const { accessToken, jwt } = zcodeCreds(account);
    if (!accessToken && !jwt) {
      return { ok: false, reason: 'ZCode 凭证无法解出（缺密钥 / 已轮换），请重新本机导入后再推送' };
    }
    return {
      ok: true,
      providerId: 'zcode',
      body: {
        provider: 'zcode',
        accessToken: accessToken || undefined,
        jwt: jwt || undefined,
        userId: account.uid || undefined,
      },
    };
  }

  if (p === 'catpaw') {
    // 源码 account_store/catpaw_accounts.rs：Cookie 形态 token + **独立 uid**，两者缺一不可。
    // 本采集器离线读取，拿不到 uid → 明确报缺，不推一条必然不可用的记录。
    if (!account.uid) return { ok: false, reason: '妙手账号缺少 uid（本机离线导入拿不到 uid，无法推送到 oaa）' };
    return {
      ok: true,
      providerId: 'catpaw',
      body: { provider: 'catpaw', name: account.name || undefined, accessToken: account.token, uid: account.uid },
    };
  }

  return { ok: false, reason: `未知 provider：${p}` };
}

/**
 * 把一条本采集器账号映射成 OAA-server「导入账号」文件里的一条记录。
 *
 * 与 POST /api/accounts 的 body 不同：导入接口读的是**平铺**记录 —— 身份字段
 * （uid / userId / variant）与凭证（accessToken / refreshToken）都在顶层
 * （见 server/src/server/core/account_transfer/identity.rs 的 identity_of_item）。
 * 所以这里把 add-account 的嵌套 auth / account 摊平，并补上记录必须的 id。
 * @returns {{ ok: true, providerId: string, record: object } | { ok: false, reason: string }}
 */
export function toServerImportRecord(account) {
  const mapped = toAgent2ApiPayload(account);
  if (!mapped.ok) return mapped;
  const record = { id: account.id, provider: mapped.providerId };
  for (const [key, value] of Object.entries(mapped.body)) {
    if (key === 'auth' || key === 'account' || value === undefined) continue;
    record[key] = value;
  }
  for (const group of ['auth', 'account']) {
    for (const [key, value] of Object.entries(mapped.body[group] || {})) {
      if (value !== undefined) record[key] = value;
    }
  }
  return { ok: true, providerId: mapped.providerId, record };
}

/**
 * 把本地账号库拼成 OAA-server 的**导入文件**形态
 * （面板「设置 → 数据 → 导入账号」可直接选它，形状与服务端自己的导出文件一致）。
 * @returns {{ payload: object, results: Array<{provider,name,status,providerId?,reason?}> }}
 */
export function buildServerImportFile(accounts) {
  const records = [];
  const results = [];
  for (const account of accounts) {
    const mapped = toServerImportRecord(account);
    const base = { provider: account.provider, name: account.name };
    if (!mapped.ok) {
      results.push({ ...base, status: 'skipped', reason: mapped.reason });
      continue;
    }
    records.push(mapped.record);
    results.push({ ...base, status: 'ok', providerId: mapped.providerId });
  }
  return {
    payload: { version: 2, exportedAt: Date.now(), customProviders: [], accounts: records },
    results,
  };
}

function extractError(res) {
  const j = res.json;
  if (j) {
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
    if (typeof j.message === 'string') return j.message;
  }
  return (res.text || '').slice(0, 300) || `HTTP ${res.status}`;
}

async function request(method, path, { endpoint, apiKey, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = endpoint.replace(/\/+$/, '') + path;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['x-api-key'] = apiKey;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** 连通性自检：GET /health */
export async function checkHealth({ endpoint, apiKey, timeoutMs } = {}) {
  try {
    const r = await request('GET', '/health', { endpoint: endpoint || DEFAULT_ENDPOINT, apiKey, timeoutMs });
    return { ok: r.ok, status: r.status, body: r.json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 推送单个账号。
 * @returns {{ provider, name, status: 'pushed'|'failed'|'skipped'|'dry-run', providerId?, reason?, statusCode? }}
 */
export async function pushAccount(account, { endpoint, apiKey, dryRun = false, timeoutMs } = {}) {
  const mapped = toAgent2ApiPayload(account);
  const base = { provider: account.provider, name: account.name };
  if (!mapped.ok) return { ...base, status: 'skipped', reason: mapped.reason };
  if (dryRun) return { ...base, status: 'dry-run', providerId: mapped.providerId, body: mapped.body };
  try {
    const r = await request('POST', '/api/accounts', { endpoint: endpoint || DEFAULT_ENDPOINT, apiKey, body: mapped.body, timeoutMs });
    if (r.ok) return { ...base, status: 'pushed', providerId: mapped.providerId, account: r.json?.account };
    return { ...base, status: 'failed', providerId: mapped.providerId, statusCode: r.status, reason: extractError(r) };
  } catch (e) {
    return { ...base, status: 'failed', providerId: mapped.providerId, reason: e.message };
  }
}

/** 批量推送（逐条 POST /api/accounts；逐条返回结果，出错可定位到单个账号） */
export async function pushAccounts(accounts, opts = {}) {
  const results = [];
  for (const account of accounts) results.push(await pushAccount(account, opts));
  return results;
}
