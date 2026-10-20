// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/workbuddyLocal.js，MIT License。
// 本机 WorkBuddy（腾讯 CodeBuddy 系）客户端凭据读取。
//
// WorkBuddy（与 CodeBuddy CLI / 插件共用）把会话存成 JSON：
//   Windows: %LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\<认证ID>.info
//   macOS:   ~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/
//   Linux:   ~/.local/share/CodeBuddyExtension/Data/Public/auth/
// 当前会话是 workbuddy-desktop.info；带时间戳的同名文件是客户端留下的历史会话。
// 文件结构：{ account: { uid, nickname, phoneNumber, enterpriseId… }, auth: { accessToken, refreshToken, expiresAt, domain… } }
//
// v5.8+ 起敏感字段（accessToken / refreshToken / nickname / phoneNumber）会以
// {"$wbEncrypted":1,"envelope":…} 的 AES-256-GCM 信封落盘，需在客户端运行时取回 at-rest
// 密钥才能解密（见 ./wbcrypto.js）。
//
// 原项目的「切号写回会话文件」部分已剔除（本采集器只读）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectToken } from '../jwt.js';
import { isEncryptedField, readField, resolveAtRestKey } from './wbcrypto.js';

export function workbuddyAuthDir() {
  const home = os.homedir();
  const tail = ['CodeBuddyExtension', 'Data', 'Public', 'auth'];
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), ...tail);
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', ...tail);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), ...tail);
}

const CURRENT_RE = /^[a-z0-9-]+\.info$/i;           // workbuddy-desktop.info
const HISTORY_RE = /^[a-z0-9-]+\.\d{4}-.*\.info$/i;  // workbuddy-desktop.<时间戳>.<pid>.<uuid>.info

/** 会话 JSON → 账号记录（纯本地，不含网络请求）。key 为 at-rest 密钥，字段加密时用它解密。 */
export function sessionToAccount(session, source, key) {
  const auth = session?.auth || {};
  const token = readField(key, auth.accessToken);
  if (typeof token !== 'string' || !token) return null;
  const info = inspectToken(token);
  if (!info.provider) return null;
  const acc = session.account || {};
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  return {
    provider: info.provider,
    token,
    refreshToken: readField(key, auth.refreshToken) || null,
    expiresAt: iso(auth.expiresAt) || info.expiresAt,
    uid: acc.uid || info.uid,
    name: readField(key, acc.nickname) || readField(key, acc.name) || null,
    email: acc.email || null,
    source,
    meta: {
      domain: auth.domain || info.host,
      enterpriseId: acc.enterpriseId || null,
      phone: readField(key, acc.phoneNumber) || null,
      refreshExpiresAt: iso(auth.refreshExpiresAt),
    },
  };
}

/**
 * 读取本机 WorkBuddy 会话：当前会话 + 历史会话（按 uid 去重，保留最新）。
 * 字段被 $wbEncrypted 加密时，惰性从运行中的客户端进程内存取回密钥（见 wbcrypto.js）。
 * @returns {{ dir: string, accounts: Array<{...账号记录, current: boolean, file: string, fileTime: number}>, errors: Array }}
 */
export function readWorkbuddySessions() {
  const dir = workbuddyAuthDir();
  const out = { dir, accounts: [], errors: [] };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const byUid = new Map();
  let key;                 // 惰性：只有真遇到加密字段才去扫进程内存
  let keyResolved = false;
  let encryptedNoKey = false;
  for (const name of names) {
    if (!CURRENT_RE.test(name) && !HISTORY_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const current = !HISTORY_RE.test(name);
      if (current && fs.existsSync(`${file}.logged-out`)) continue;   // 已登出
      const session = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!keyResolved && isEncryptedField(session?.auth?.accessToken)) {
        keyResolved = true;
        key = resolveAtRestKey();
      }
      const rec = sessionToAccount(session, current ? 'WorkBuddy 当前登录' : 'WorkBuddy 历史会话', key);
      if (!rec) {
        if (isEncryptedField(session?.auth?.accessToken) && !key) encryptedNoKey = true;
        continue;
      }
      const fileTime = fs.statSync(file).mtimeMs;
      const item = { ...rec, current, file, fileTime };
      const prev = byUid.get(rec.uid);
      if (!prev || (current && !prev.current) || (current === prev.current && fileTime > prev.fileTime)) byUid.set(rec.uid, item);
    } catch (e) {
      out.errors.push({ file, error: e.message });
    }
  }
  if (encryptedNoKey) {
    out.errors.push({
      file: dir,
      error: 'accessToken 已加密（$wbEncrypted）：需 WorkBuddy 客户端保持运行，才能从其进程内存取回解密密钥',
    });
  }
  out.accounts = [...byUid.values()].sort((a, b) => b.current - a.current || b.fileTime - a.fileTime);
  return out;
}

/** 当前 WorkBuddy 客户端登录的 uid（未登录返回 null） */
export function currentWorkbuddyUid() {
  return readWorkbuddySessions().accounts.find((a) => a.current)?.uid || null;
}
