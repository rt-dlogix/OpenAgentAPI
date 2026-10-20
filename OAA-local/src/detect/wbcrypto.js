// WorkBuddy（腾讯 CodeBuddy 系）v5.8+ 新版凭据的 at-rest 字段解密。
//
// 新版客户端把 auth.accessToken / refreshToken 以及 account.nickname / phoneNumber 等敏感字段
// 改成 {"$wbEncrypted":1,"envelope":"<base64>"} 信封落盘，信封内容为
// {suite:1,keyId,nonce,authTag,ciphertext}，AES-256-GCM。
// 解密密钥 = SHA-256(atRestSecretKey)（atRestSecretKey 是 44 字符的规范化 base64 字符串，
// 对字符串本身做 SHA-256，不是先 base64 解码）。
//
// 该密钥由客户端内置原生绑定在启动时构造，只存在于运行中的 WorkBuddy 进程内存里，
// 磁盘无副本，故只能在客户端运行时通过 wb-memscan.ps1 从其进程内存取回（仅 Windows）。
// 本模块只读内存、只读文件，不修改客户端状态。
//
// 移植自 reference: checkin-server local/sync_credentials.py（wb_scan_secret_key / wb_decrypt_field）。

import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCAN_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wb-memscan.ps1');
const SECRET_RE = /[A-Za-z0-9+/]{43}=/;

let cachedKey;          // undefined = 尚未尝试；null = 尝试过但拿不到

/** 能否在本机取回 at-rest 密钥（仅 Windows 客户端运行时） */
export function atRestKeySupported() {
  return process.platform === 'win32';
}

/**
 * 取回 at-rest 解密密钥（32 字节）；客户端未运行 / 非 Windows 时返回 null。
 * 结果在进程内缓存，避免同一次采集里重复扫描内存。
 */
export function resolveAtRestKey({ force = false } = {}) {
  if (!force && cachedKey !== undefined) return cachedKey;
  cachedKey = scanAtRestKey();
  return cachedKey;
}

function scanAtRestKey() {
  if (!atRestKeySupported()) return null;
  let out;
  try {
    process.stderr.write('  …正在尝试从 WorkBuddy 进程内存读取解密密钥（需客户端保持运行，约数秒）\n');
    out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCAN_SCRIPT,
    ], { encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const m = String(out).match(SECRET_RE);
  if (!m) return null;
  try {
    return crypto.createHash('sha256').update(m[0], 'utf8').digest();
  } catch {
    return null;
  }
}

/** 是否是标准（sym-v1）at-rest 加密字段信封 */
export function isEncryptedField(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
    && v.$wbEncrypted === 1 && v.scheme === undefined && typeof v.envelope === 'string';
}

const lenPref = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length, 0); return Buffer.concat([l, b]); };
const uint32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };

// 对应客户端 at-rest-crypto sym-v1 / framing=field 信封的 AAD：
//   "WB-AAD\0" | 0x01 | lenPref("WBEV1") | lenPref("sym-v1") | uint32(1) | lenPref(keyId) | 0x02 | 0x00 | 0x00
function fieldAad(keyId) {
  return Buffer.concat([
    Buffer.from('WB-AAD\0', 'ascii'), Buffer.from([1]),
    lenPref(Buffer.from('WBEV1', 'ascii')), lenPref(Buffer.from('sym-v1', 'ascii')),
    uint32(1), lenPref(Buffer.from(keyId, 'ascii')), Buffer.from([2, 0, 0]),
  ]);
}

/** 用 at-rest 密钥解密单个 $wbEncrypted 字段，返回明文字符串；失败抛错 */
export function decryptField(key, wrapper) {
  const env = JSON.parse(Buffer.from(wrapper.envelope, 'base64').toString('utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'));
  d.setAAD(fieldAad(env.keyId));
  d.setAuthTag(Buffer.from(env.authTag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]).toString('utf8');
}

/**
 * 读取一个可能加密也可能明文的字段：明文直接返回，$wbEncrypted 用 key 解密，
 * 无 key / 非标准信封 / 解密失败一律返回 null（不抛错）。
 */
export function readField(key, value) {
  if (typeof value === 'string') return value;
  if (!key || !isEncryptedField(value)) return null;
  try { return decryptField(key, value); } catch { return null; }
}
