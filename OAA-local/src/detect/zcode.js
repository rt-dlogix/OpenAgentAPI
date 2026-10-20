// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/zcodeLocal.js，MIT License。
// 本机 ZCode 客户端凭据读取（移植自 zcode-switch (MIT) src-tauri/src/store.rs）。
//
// ZCode（智谱 GLM / Z.ai 桌面客户端）把当前登录态存在：
//   ~/.zcode/v2/credentials.json      当前登录凭据（值多为 enc:v1: 加密，见 zcrypto.js）
//   ~/.zcode/v2/config.json           当前 provider/模型配置
//   ~/.zcode/v2/telemetry-state.json  { deviceMid, lastDailyActiveDate }
// 只有一份「当前登录」，没有像 WorkBuddy 那样的历史会话文件。
//
// 原项目的切号（写回 credentials/config/setting/provider_config、虚拟设备指纹）已剔除（本采集器只读）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as zc from './zcrypto.js';

function home() {
  return process.env.ZCODE_HOME || os.homedir();
}

/**
 * ZCode 支持把数据目录整体挪盘，真实位置写在 ~/.zcode/v2/setting.json 的 dataBaseDir 里。
 * 凭据加密密钥仍由 os.homedir() 派生（见 zcrypto.defaultSecret）。
 */
function dataRoot(h) {
  const s = readJson(path.join(h, '.zcode', 'v2', 'setting.json'));
  const d = typeof s?.dataBaseDir === 'string' ? s.dataBaseDir.trim() : '';
  return d && path.isAbsolute(d) ? d : h;
}

export function zcodePaths() {
  const h = home();
  const v2 = path.join(dataRoot(h), '.zcode', 'v2');
  return {
    home: h,
    credentials: path.join(v2, 'credentials.json'),
    config: path.join(v2, 'config.json'),
    setting: path.join(h, '.zcode', 'v2', 'setting.json'),
    providerConfig: path.join(v2, 'provider_config.json'),
    telemetry: path.join(v2, 'telemetry-state.json'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function detectZcode() {
  const p = zcodePaths();
  const creds = readJson(p.credentials);
  return {
    dataDir: path.dirname(p.credentials),
    exists: fs.existsSync(p.credentials),
    signedIn: Boolean(creds && zc.isLoggedIn(creds)),
  };
}

/** 当前登录凭据 → 账号记录（供 addAccount），不做网络请求。返回 null 表示未登录或读取失败。 */
export function liveToAccount(secretOpts) {
  const p = zcodePaths();
  const creds = readJson(p.credentials);
  if (!creds || !zc.isLoggedIn(creds)) return null;
  const secret = zc.defaultSecret(p.home, secretOpts);
  const id = zc.identityWithSecret(creds, secret);
  return {
    provider: 'zcode',
    // ZCode 没有单一 access_token 字段可直接当 Bearer 用，这里存整份 creds 快照
    // （仍是各字段各自的 enc:v1 密文），token 字段留一个可读标记供列表展示。
    token: `zcode-creds:${id.userId || crypto.randomUUID()}`,
    uid: id.userId,
    name: zc.identityLabel(id),
    email: id.email,
    source: 'local-app',
    meta: {
      credentials: creds,
      config: readJson(p.config),
      setting: readJson(p.setting),
      providerConfig: readJson(p.providerConfig),
      canonicalHash: zc.canonicalHash(creds),
      deviceMid: readJson(p.telemetry)?.deviceMid || null,
      capturedAt: new Date().toISOString(),
    },
  };
}

/** ZCode 客户端当前登录账号的完整身份（未登录返回 null） */
export function currentZcodeIdentity() {
  const p = zcodePaths();
  const creds = readJson(p.credentials);
  if (!creds || !zc.isLoggedIn(creds)) return null;
  const id = zc.identityWithSecret(creds, zc.defaultSecret(p.home));
  return { uid: id.userId ?? null, email: id.email || null, username: id.username || null };
}

/** ZCode 客户端当前登录账号的 uid（未登录返回 null） */
export function currentZcodeUid() {
  const id = currentZcodeIdentity();
  return id?.uid != null ? String(id.uid) : null;
}

/** 账号库里是否已有同一登录（先比规范化哈希，哈希对不上再比身份） */
export function findSameLogin(liveCreds, secret, existingAccounts) {
  const hash = zc.canonicalHash(liveCreds);
  const byHash = existingAccounts.find((a) => a.meta?.canonicalHash === hash);
  if (byHash) return byHash;
  const liveId = zc.identityWithSecret(liveCreds, secret);
  if (!liveId.userId && !liveId.username && !liveId.email) return null;
  return existingAccounts.find((a) => {
    const cid = a.meta?.credentials && zc.identityWithSecret(a.meta.credentials, secret);
    if (!cid) return false;
    return Boolean(
      (liveId.userId && cid.userId && liveId.userId === cid.userId)
      || (liveId.email && cid.email && liveId.email === cid.email)
      || (liveId.username && cid.username && liveId.username === cid.username),
    );
  });
}
