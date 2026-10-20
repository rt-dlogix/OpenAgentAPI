// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/mirasimLocal.js，MIT License。
// mirasim（原生 AI 编程开发环境）本机凭据读取。
//
// 凭据存储：
//   ~/.mirasim/setting.json        auth: { token, refreshToken, userId, name, exp }（mrs1: 加密）
//   ~/.mirasim/secret.key          DPAPI 加密的 master key（Windows 上是 hex 字符串；旧版）
//   %APPDATA%\@mirasim\desktop\secret-key.enc
//                                  新版桌面端：Electron safeStorage 密文（v10 + AES-256-GCM）
//   MIRASIM_SECRET_KEY / MIRASIM_APP_SECRET_KEY  环境变量（64 字符 hex）
//
// 加密格式：mrs1:<base64(12B IV + 16B tag + ciphertext)>，AES-256-GCM，key = DPAPI Unprotect(secret.key) → utf16le。
// 原项目的切号 / 凭据回写 / 进程结束 / master key 回写修复 已剔除（本采集器只读）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const ENC_PREFIX = 'mrs1:';

export function mirasimHome() {
  return process.env.MIRASIM_HOME || path.join(os.homedir(), '.mirasim');
}

/** 新版桌面端（Electron）userData 目录 */
export function mirasimDesktopDataDir() {
  if (process.env.MIRASIM_DESKTOP_DATA_DIR) return process.env.MIRASIM_DESKTOP_DATA_DIR;
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(roaming, '@mirasim', 'desktop');
}

export function mirasimPaths() {
  const h = mirasimHome();
  const desktop = mirasimDesktopDataDir();
  return {
    home: h,
    setting: path.join(h, 'setting.json'),
    secretKey: path.join(h, 'secret.key'),
    secretKeyEnc: path.join(desktop, 'secret-key.enc'),
    localState: path.join(desktop, 'Local State'),
    insights: path.join(h, 'insights'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ── DPAPI 解密 master key ──

let masterKeyCache = null;

function readEnvironmentMasterKey() {
  const value = process.env.MIRASIM_SECRET_KEY || process.env.MIRASIM_APP_SECRET_KEY;
  if (!value) return null;
  const hex = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function dpapiUnprotect(buf) {
  const script = 'Add-Type -AssemblyName System.Security;'
    + '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());'
    + "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
        if (err) return reject(new Error('DPAPI 解密失败：' + err.message));
        resolve(Buffer.from(String(stdout).trim(), 'base64'));
      });
    child.stdin.end(buf.toString('base64'));
  });
}

/** 新版桌面端 secret-key.enc（Electron safeStorage，仅 Windows）→ master key；读不到返回 null */
async function readSafeStorageMasterKey(p) {
  if (process.platform !== 'win32' || !fs.existsSync(p.secretKeyEnc)) return null;
  try {
    const enc = fs.readFileSync(p.secretKeyEnc);
    const ek = Buffer.from(readJson(p.localState)?.os_crypt?.encrypted_key || '', 'base64');
    if (enc.length < 3 + 12 + 16 || enc.subarray(0, 3).toString('latin1') !== 'v10') return null;
    if (ek.subarray(0, 5).toString('latin1') !== 'DPAPI') return null;
    const aesKey = await dpapiUnprotect(ek.subarray(5));
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, enc.subarray(3, 15));
    decipher.setAuthTag(enc.subarray(enc.length - 16));
    const hex = Buffer.concat([decipher.update(enc.subarray(15, enc.length - 16)), decipher.final()]).toString('utf8').trim();
    return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
  } catch { return null; }
}

/** 旧版 ~/.mirasim/secret.key → master key；没有或解不开返回 null */
async function readSecretKeyFile(p) {
  if (!fs.existsSync(p.secretKey)) return null;
  try {
    const raw = fs.readFileSync(p.secretKey, 'utf8').trim();
    if (process.platform === 'win32') {
      const bin = /^[0-9a-f]+$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
      const unprotected = await dpapiUnprotect(bin);
      const hex = unprotected.toString('utf16le').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
      const utf8 = unprotected.toString('utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(utf8)) return Buffer.from(utf8, 'hex');
    } else {
      if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    }
  } catch {}
  return null;
}

/**
 * 取得解开后的 32 字节 master key Buffer（未配置或解密失败返回 null）。
 * 依次尝试：~/.mirasim/secret.key（旧版）→ 桌面端 secret-key.enc（新版）→ 环境变量。
 */
export async function getMasterKey() {
  if (masterKeyCache) return masterKeyCache;
  const p = mirasimPaths();
  const fromFile = await readSecretKeyFile(p);
  if (fromFile) return (masterKeyCache = fromFile);
  const fromDesktop = await readSafeStorageMasterKey(p);
  if (fromDesktop) return (masterKeyCache = fromDesktop);
  const fromEnv = readEnvironmentMasterKey();
  if (fromEnv) return (masterKeyCache = fromEnv);
  return null;
}

export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(ENC_PREFIX);
}

/** 解密 mrs1: 字符串 */
export function decryptWithKey(value, key) {
  if (!isEncrypted(value)) return value;
  if (!key) throw new Error('缺少 mirasim master key，无法解密');
  const raw = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
  if (raw.length < 28) throw new Error('mrs1 格式长度不正确');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ── 本机探测 ──

export function detectMirasim() {
  const p = mirasimPaths();
  const exists = fs.existsSync(p.setting);
  let signedIn = false;
  if (exists) {
    const s = readJson(p.setting);
    signedIn = Boolean(s && s.auth && (s.auth.token || s.auth.userId));
  }
  const clientPath = candidateClientPath();
  return {
    dataDir: p.home,
    exists,
    signedIn,
    clientInstalled: Boolean(clientPath),
    clientPath,
  };
}

export function candidateClientPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const p1 = path.join(local, 'Programs', '@mirasimdesktop', 'Mirasim.exe');
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(process.env.ProgramFiles || 'C:\\Program Files', '@mirasimdesktop', 'Mirasim.exe');
    if (fs.existsSync(p2)) return p2;
  } else if (process.platform === 'darwin') {
    const p = '/Applications/Mirasim.app/Contents/MacOS/Mirasim';
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 读取当前登录的 mirasim 账号，返回标准化账号对象（供 addAccount / scan） */
export async function liveToAccount() {
  const p = mirasimPaths();
  const s = readJson(p.setting);
  if (!s || !s.auth || !s.auth.token) return null;

  const key = await getMasterKey();
  let token = s.auth.token;
  let refreshToken = s.auth.refreshToken;
  if (isEncrypted(token)) {
    if (!key) {
      // 明确区分「已登录但缺密钥」「解密失败」「未登录（返回 null）」
      const where = process.platform === 'win32' ? `${p.secretKey} / ${p.secretKeyEnc}` : p.secretKey;
      const err = new Error(`已登录但读不到 mirasim 密钥（已检查 ${where} 与环境变量 MIRASIM_SECRET_KEY / MIRASIM_APP_SECRET_KEY）。请完全退出全部 Mirasim 进程后重启并登录，再重新扫描`);
      err.code = 'MISSING_SECRET_KEY';
      throw err;
    }
    try {
      token = decryptWithKey(token, key);
      refreshToken = refreshToken ? decryptWithKey(refreshToken, key) : null;
    } catch (e) {
      const err = new Error(`解密凭据失败：${e.message}`);
      err.code = 'DECRYPT_FAILED';
      throw err;
    }
  }

  const userId = s.auth.userId || (token.includes('.') ? (() => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub; } catch { return null; }
  })() : null);

  const expiresAt = s.auth.exp ? new Date(s.auth.exp * 1000).toISOString() : null;

  return {
    provider: 'mirasim',
    token,
    refreshToken,
    uid: userId,
    name: s.auth.name || null,
    expiresAt,
    source: 'local-app',
    meta: {
      encryptedAuth: s.auth, // 原始密文备份
      capturedAt: new Date().toISOString(),
    },
  };
}

export function currentMirasimUid() {
  const p = mirasimPaths();
  const s = readJson(p.setting);
  return s?.auth?.userId || null;
}
