// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/qoderApp.js，MIT License。
// 本机 Qoder 客户端（Qoder App，Electron）凭据采集——全部在本机完成，不联网、不依赖第三方包。
//   1. 安装探测：国际版 Qoder / 国内版 Qoder CN 的程序目录、数据目录、版本号
//   2. 登录凭据读取：解密客户端数据目录下的 auth.v1.dat（Electron safeStorage）
//        Windows: "v10" + nonce(12) + AES-256-GCM(密文+tag)，密钥 = DPAPI 解开 Local State 的 os_crypt.encrypted_key
//        macOS:   "v10" + AES-128-CBC，密钥 = PBKDF2(钥匙串 "<App> Safe Storage", 'saltysalt', 1003)
//        Linux:   "v10" + AES-128-CBC，密钥 = PBKDF2('peanuts', 'saltysalt', 1)（v11 需系统密钥环，不支持）
// 原项目中的设备风控身份（runtime-info / UMID）、客户端切号、进程结束等与「凭据采集」无关的部分已剔除。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';

const VARIANTS = [
  { provider: 'qoder', label: 'Qoder 国际版', installName: 'Qoder', appId: 'com.qoder.app' },
  { provider: 'qoder-cn', label: 'Qoder 国内版', installName: 'Qoder CN', appId: 'com.qodercn.app' },
];

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

const versionParts = (s) => s.split('.').map((n) => Number(n) || 0);
function compareVersionDesc(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  }
  return 0;
}

/**
 * 一个安装目录下的 resources 候选：0.3+ 的启动器把实际运行的版本放在
 * .qoder-versions\<ver>\resources（按版本从新到旧），顶层 resources 可能只是首装时的旧版残留。
 */
function resourceDirsIn(installDir) {
  const root = path.join(installDir, '.qoder-versions');
  let versions = [];
  try {
    versions = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+(\.\d+)*$/.test(e.name))
      .map((e) => e.name)
      .sort(compareVersionDesc);
  } catch {}
  return [...versions.map((ver) => path.join(root, ver, 'resources')), path.join(installDir, 'resources')];
}

/**
 * 卸载注册表里登记的安装目录（自定义安装路径）。DisplayName 形如「Qoder 0.4.1」/「Qoder CN 0.4.1」，
 * 不匹配「Qoder IDE」（IDE 不带 runtime-info）。走 PowerShell 以正确读出中文路径；结果缓存 5 分钟。
 */
let registryCache = { at: 0, entries: null };
function registryInstallDirs(v) {
  if (process.platform !== 'win32') return [];
  if (!registryCache.entries || Date.now() - registryCache.at > 5 * 60_000) {
    let entries = [];
    try {
      const script = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
        + "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue"
        + " | Where-Object { $_.DisplayName -like 'Qoder*' }"
        + ' | Select-Object DisplayName,InstallLocation,UninstallString,DisplayIcon | ConvertTo-Json -Compress';
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out) entries = [].concat(JSON.parse(out));
    } catch {}
    registryCache = { at: Date.now(), entries };
  }
  const nameRe = new RegExp(`^${v.installName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+v?\\d[\\d.]*)?$`, 'i');
  const exeDir = (s) => {
    const m = String(s || '').match(/^\s*"([^"]+)"|^\s*([^,]+?\.exe)/i);
    return m ? path.dirname(m[1] || m[2]) : null;
  };
  const dirs = [];
  for (const e of registryCache.entries) {
    if (!nameRe.test(String(e?.DisplayName || '').trim())) continue;
    const dir = (e.InstallLocation && String(e.InstallLocation).trim()) || exeDir(e.UninstallString) || exeDir(e.DisplayIcon);
    if (dir) dirs.push(dir.replace(/[\\/]+$/, ''));
  }
  return dirs;
}

function candidateResourceDirs(v, { registry = false } = {}) {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const installDirs = [
      path.join(local, 'Programs', v.installName),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', v.installName),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', v.installName),
      ...(registry ? registryInstallDirs(v) : []),
    ];
    const seen = new Set();
    const unique = installDirs.filter((d) => {
      const k = path.resolve(d).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [
      ...unique.flatMap(resourceDirsIn),
      path.join(local, 'Microsoft', 'WindowsApps', v.installName),
      path.join(local, 'electron', 'updates', v.installName),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      `/Applications/${v.installName}.app/Contents/Resources`,
      path.join(home, 'Applications', `${v.installName}.app`, 'Contents', 'Resources'),
      `/Applications/Qoder.app/Contents/Resources`,
      `/Applications/Qoder\\ CN.app/Contents/Resources`,
    ];
  }
  const slug = v.installName.toLowerCase().replace(/\s+/g, '-');
  return [`/opt/${v.installName}/resources`, `/opt/${slug}/resources`, `/usr/lib/${slug}/resources`, '/snap/qoder/current/resources'];
}

function userDataDir(v) {
  const home = os.homedir();
  const name = `${v.appId}.stable`;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name);
}

function readVersion(resourcesDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'build-manifest.json'), 'utf8'));
    if (typeof m.productVersion === 'string') return m.productVersion;
  } catch {}
  return null;
}

const RUNTIME_INFO_EXE = process.platform === 'win32' ? 'runtime-info.exe' : 'runtime-info';
const runtimeInfoIn = (resources) => (exists(path.join(resources, 'umid', RUNTIME_INFO_EXE)) ? path.join(resources, 'umid', RUNTIME_INFO_EXE) : null);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** 在候选里选 resources：优先带 runtime-info 的，否则第一个存在的 */
function pickResources(dirs) {
  const existing = dirs.filter(isDir);
  return existing.find((d) => runtimeInfoIn(d)) || existing[0] || null;
}

/** 探测本机已安装的 Qoder 客户端（国际版 / 国内版） */
export function detectQoderApps() {
  return VARIANTS.map((v) => {
    let resources = pickResources(candidateResourceDirs(v));
    if (process.platform === 'win32' && !(resources && runtimeInfoIn(resources))) {
      resources = pickResources(candidateResourceDirs(v, { registry: true })) || resources;
    }
    const data = userDataDir(v);
    return {
      provider: v.provider,
      label: v.label,
      installed: Boolean(resources),
      resourcesDir: resources,
      version: resources ? readVersion(resources) : null,
      runtimeInfo: resources ? runtimeInfoIn(resources) : null,
      dataDir: data,
      dataExists: exists(data),
      signedIn: exists(path.join(data, 'auth.v1.dat')),
    };
  });
}

// ─── Electron safeStorage 解密 ───

function dpapiUnprotect(buf) {
  const script = 'Add-Type -AssemblyName System.Security;'
    + '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());'
    + "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
  // 使用 -EncodedCommand 传入 UTF-16LE Base64，避免命令行参数中包含敏感 API 关键字被杀毒软件误报
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20_000 }, (err, stdout) => {
        if (err) return reject(new Error('DPAPI 解密失败：' + err.message));
        resolve(Buffer.from(String(stdout).trim(), 'base64'));
      });
    child.stdin.end(buf.toString('base64'));
  });
}

function macKeychainPassword(service) {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-w', '-s', service], { timeout: 20_000 },
      (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

const keyCache = new Map();

/**
 * 某个 Electron userData 目录对应的 safeStorage 解码器（仅解密）。
 * Windows = 'v10' + nonce(12) + AES-256-GCM 密文 + tag(16)；mac/linux = 'v10' + AES-128-CBC。
 */
export async function safeStorageCodec(userData, appNames) {
  if (keyCache.has(userData)) return keyCache.get(userData);
  let decrypt;
  if (process.platform === 'win32') {
    const ls = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'));
    const enc = Buffer.from(ls?.os_crypt?.encrypted_key || '', 'base64');
    if (enc.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Local State 中没有 DPAPI 密钥');
    const key = await dpapiUnprotect(enc.subarray(5));
    decrypt = (data) => {
      if (data.subarray(0, 3).toString() !== 'v10') throw new Error('未知的加密格式');
      const nonce = data.subarray(3, 15);
      const tag = data.subarray(data.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data.subarray(15, data.length - 16)), d.final()]).toString('utf8');
    };
  } else {
    let password = 'peanuts', iterations = 1;
    if (process.platform === 'darwin') {
      for (const n of appNames) {
        password = await macKeychainPassword(`${n} Safe Storage`);
        if (password) break;
      }
      if (!password) throw new Error('无法从钥匙串读取 Qoder 的 Safe Storage 密钥');
      iterations = 1003;
    }
    const key = crypto.pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');
    decrypt = (data) => {
      const ver = data.subarray(0, 3).toString();
      if (ver !== 'v10') throw new Error(ver === 'v11' ? '需要系统密钥环（v11），暂不支持' : '未知的加密格式');
      const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
      return Buffer.concat([d.update(data.subarray(3)), d.final()]).toString('utf8');
    };
  }
  const codec = { decrypt };
  keyCache.set(userData, codec);
  return codec;
}

/**
 * 读取本机 Qoder 客户端当前登录的账号（解密 auth.v1.dat）。
 * @returns {Promise<{accounts: Array, errors: Array}>}
 *          每个账号含 provider / token / refreshToken / expiresAt / user
 */
export async function readQoderAppAccounts() {
  const accounts = [];
  const errors = [];
  for (const app of detectQoderApps()) {
    const file = path.join(app.dataDir, 'auth.v1.dat');
    if (!exists(file)) continue;
    try {
      const { decrypt } = await safeStorageCodec(app.dataDir, ['Qoder App', app.label.includes('国内') ? 'Qoder CN' : 'Qoder']);
      const obj = JSON.parse(decrypt(fs.readFileSync(file)));
      if (typeof obj?.token !== 'string' || !obj.token) throw new Error('auth.v1.dat 中没有 token');
      accounts.push({
        provider: app.provider,
        source: `${app.label} 客户端`,
        file,
        authJson: obj,
        token: obj.token,
        refreshToken: typeof obj.refreshToken === 'string' ? obj.refreshToken : null,
        expiresAt: typeof obj.expiresAt === 'string' ? obj.expiresAt : null,
        user: {
          id: obj.user?.id || null,
          name: obj.user?.name || null,
          email: obj.user?.email || null,
        },
      });
    } catch (e) {
      errors.push({ provider: app.provider, file, error: e.message });
    }
  }
  return { accounts, errors };
}
