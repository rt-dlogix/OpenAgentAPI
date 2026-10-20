// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/catpawLocal.js，MIT License。
// 妙手（美团 CatPaw）桌面客户端本机凭据读取。
//
// 凭据存储（Windows）：
//   %APPDATA%\catpaw-moon\catx-credential.json   { ssoTokenEnc }
//   ssoTokenEnc = base64( iv(12B) ‖ gcmTag(16B) ‖ ciphertext )，AES-256-GCM
//   key = sha256( machineId + ":catpaw-desk-token-v2" )
//   machineId = HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
//   明文结构 { access_token, modified_at }
//
// 原项目的切号 / 凭据写回 / 进程结束 / 网关 profile 补全 已剔除（本采集器只读、不联网）。
// 注意：仅 Windows 可用（密钥派生自注册表 MachineGuid）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const EXE_NAME = '妙手.exe';

function credentialFile() {
  if (process.env.CATPAW_CREDENTIAL_FILE) return process.env.CATPAW_CREDENTIAL_FILE;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'catpaw-moon', 'catx-credential.json');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ── 密钥派生（MachineGuid → sha256） ──

let keyCache = null;        // Buffer | null（本机不可用）
let machineIdOverride = null; // 测试钩子：注入固定机器 ID

function machineId() {
  if (machineIdOverride) return machineIdOverride;
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('REG.exe',
      ['QUERY', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { windowsHide: true, timeout: 10_000 }).toString();
    // MachineGuid    REG_SZ    {xxxxxxxx-....}（与 node-machine-id 一致：去空白 + 小写）
    return out.split('REG_SZ')[1].replace(/\r+|\n+|\s+/g, '').toLowerCase();
  } catch { return null; }
}

function tokenKey() {
  if (machineIdOverride) {
    return crypto.createHash('sha256').update(machineIdOverride + ':catpaw-desk-token-v2').digest();
  }
  if (keyCache) return keyCache;
  if (keyCache === false) return null;
  const id = machineId();
  if (!id) { keyCache = false; return null; }
  keyCache = crypto.createHash('sha256').update(id + ':catpaw-desk-token-v2').digest();
  return keyCache;
}

/** 解密本机妙手登录凭据 → { accessToken, modifiedAt }；不可用 / 未登录返回 null */
export function readCredential() {
  const file = credentialFile();
  const j = readJson(file);
  if (!j || typeof j.ssoTokenEnc !== 'string' || !j.ssoTokenEnc) return null;
  const key = tokenKey();
  if (!key) return null;
  try {
    const blob = Buffer.from(j.ssoTokenEnc, 'base64');
    if (blob.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    const plain = JSON.parse(Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8'));
    if (!plain || typeof plain.access_token !== 'string' || !plain.access_token) return null;
    return { accessToken: plain.access_token, modifiedAt: plain.modified_at ?? null };
  } catch { return null; }
}

// ── 本机探测 ──

export function candidateClientPath() {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const p = path.join(local, '妙手', EXE_NAME);
  return fs.existsSync(p) ? p : null;
}

export function detectCatpaw() {
  const file = credentialFile();
  const cred = readCredential();
  const clientPath = candidateClientPath();
  return {
    dataDir: path.dirname(file),
    exists: fs.existsSync(file),
    signedIn: Boolean(cred),
    clientInstalled: Boolean(clientPath),
    clientPath,
  };
}

/** 当前客户端登录的 token */
export function currentCatpawToken() {
  try { return readCredential()?.accessToken || null; } catch { return null; }
}

/**
 * 读取妙手客户端当前登录，返回标准化账号对象（供 addAccount / scan）。
 * uid / name 原项目通过网关 auth/current-user 补全；本采集器离线，故留空。
 */
export function liveToAccount() {
  const cred = readCredential();
  if (!cred) return null;
  return {
    provider: 'catpaw',
    token: cred.accessToken,
    refreshToken: null,
    uid: null,
    name: null,
    expiresAt: null,
    source: 'local-app',
    meta: { capturedAt: new Date().toISOString() },
  };
}

/** 测试钩子：注入固定机器 ID 派生密钥（null 恢复真实探测）；同时复位密钥缓存 */
export function _setMachineIdForTests(id) {
  machineIdOverride = id || null;
  keyCache = null;
}
