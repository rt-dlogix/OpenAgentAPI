// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/minimaxLocal.js，MIT License。
// MiniMax Code 本机客户端探测与凭据读取。
//
// 客户端文件路径：
//   - 配置与模型: ~/.minimax/config.yaml
//   - 凭据存储: ~/.minimax/auth/prod/cn/mcode-public/auth.json
//   - 凭据状态: ~/.minimax/auth/prod/cn/mcode-public/auth-state.json
//   - 可执行程序（Windows）: %LOCALAPPDATA%\Programs\MiniMax Code\MiniMax Code.exe
//
// 原项目的刷新对齐 / 凭据回写 / 进程探测 / profile 网络补全 已剔除（本采集器只读、不联网）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function minimaxHome() {
  return process.env.MINIMAX_HOME || path.join(os.homedir(), '.minimax');
}

export function minimaxAuthPath() {
  return path.join(minimaxHome(), 'auth', 'prod', 'cn', 'mcode-public', 'auth.json');
}

export function minimaxAuthStatePath() {
  return path.join(minimaxHome(), 'auth', 'prod', 'cn', 'mcode-public', 'auth-state.json');
}

export function minimaxConfigPath() {
  return path.join(minimaxHome(), 'config.yaml');
}

export function minimaxUidCachePath() {
  const authDir = path.dirname(minimaxAuthPath());
  return path.join(authDir, 'uid-cache.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * recordKey → uid 的小缓存。auth.json 的 record 没有稳定 uid 字段，uid 只能靠 profile 接口拿；
 * 缓存一份，供离线 / 接口抖动时比对「客户端当前是哪个账号」。
 * 缓存**只对 auth.json 里仍然存在的 record 生效**（见 currentMiniMaxUid）。
 */
function readUidCache() {
  return readJson(minimaxUidCachePath()) || {};
}

function writeUidCache(recordKey, uid) {
  if (!recordKey || !uid) return;
  try {
    const cache = readUidCache();
    if (cache[recordKey] === String(uid)) return;
    cache[recordKey] = String(uid);
    const live = liveRecordKeys();
    if (live) for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
    writeJson(minimaxUidCachePath(), cache);
  } catch {
    // 缓存写失败不影响调用方
  }
}

/** auth.json 里当前仍有 accessToken 的 recordKey 集合；读不到返回 null */
function liveRecordKeys() {
  const authData = readJson(minimaxAuthPath());
  if (!authData?.records) return null;
  return new Set(Object.keys(authData.records).filter((k) => authData.records[k]?.accessToken));
}

/** 寻找 MiniMax Code.exe 安装路径 */
export function minimaxExePath() {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cand = path.join(local, 'Programs', 'MiniMax Code', 'MiniMax Code.exe');
  return fs.existsSync(cand) ? cand : null;
}

/** 检测本机 MiniMax 客户端安装与登录状态 */
export function detectMiniMax() {
  const exe = minimaxExePath();
  const authFile = minimaxAuthPath();
  const exists = Boolean(exe || fs.existsSync(authFile));
  const authData = readJson(authFile);
  const records = authData?.records || {};
  const hasRecord = Object.values(records).some((r) => r?.accessToken);
  return {
    installed: exists,
    exePath: exe,
    authPath: authFile,
    signedIn: hasRecord,
  };
}

/**
 * 从本机 ~/.minimax 读取当前登录凭据，组装为账号记录。
 * uid 优先用 record 自带字段，缺失时回落到 recordKey 命中的 uid 缓存（离线兜底）。
 */
export function liveToAccount() {
  const authFile = minimaxAuthPath();
  const authData = readJson(authFile);
  if (!authData?.records) return null;

  const recordKey = Object.keys(authData.records).find((k) => authData.records[k]?.accessToken);
  if (!recordKey) return null;
  const record = authData.records[recordKey];
  if (!record || !record.accessToken) return null;

  const uid = record.subject || record.accountId || readUidCache()[recordKey] || null;
  if (uid) writeUidCache(recordKey, uid);

  return {
    provider: 'minimax',
    token: record.accessToken,
    refreshToken: record.refreshToken || null,
    expiresAt: record.expiresAtMs ? new Date(record.expiresAtMs).toISOString() : null,
    uid: uid ? String(uid) : null,
    name: uid ? `MiniMax_${String(uid).slice(-6)}` : 'MiniMax Code',
    email: null,
    source: 'local-app',
    meta: {
      recordKey,
      clientId: record.clientId,
      scopes: record.scopes,
      capturedAt: new Date().toISOString(),
    },
  };
}

/**
 * 获取当前登录的 UID。records 为空（客户端从未登录 / 已登出）时一律返回 null——绝不回落到缓存。
 */
export function currentMiniMaxUid() {
  const authData = readJson(minimaxAuthPath());
  if (!authData?.records) return null;
  const recordKey = Object.keys(authData.records).find((k) => authData.records[k]?.accessToken);
  if (!recordKey) return null;
  const record = authData.records[recordKey];
  const own = record?.subject || record?.accountId;
  if (own) return String(own);
  return readUidCache()[recordKey] || null;
}

/** 获取当前登录记录的稳定 key（token 轮换时保持不变，可跨账号库匹配） */
export function currentMiniMaxRecordKey() {
  const authData = readJson(minimaxAuthPath());
  if (!authData?.records) return null;
  return Object.keys(authData.records).find((k) => authData.records[k]?.accessToken) || null;
}

/** 获取当前登录的 Token（用于比对当前登录账号） */
export function currentMiniMaxToken() {
  const authData = readJson(minimaxAuthPath());
  if (!authData?.records) return null;
  const record = Object.values(authData.records).find((r) => r?.accessToken);
  return record?.accessToken || null;
}

/** 读取指定 record（离线比对用） */
export function readMiniMaxRecord(recordKey) {
  if (!recordKey) return null;
  const authData = readJson(minimaxAuthPath());
  return authData?.records?.[recordKey] || null;
}
