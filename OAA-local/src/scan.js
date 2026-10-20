// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/daemon.js 的 /api/local/scan + /api/local/import 逻辑，MIT License。
// 采集编排：解密 / 读取本机已登录的全部平台账号 → 候选列表；再按候选导入本地账号库。

import { readQoderAppAccounts } from './detect/qoderApp.js';
import { readWorkbuddySessions } from './detect/workbuddy.js';
import { liveToAccount as zcodeLive } from './detect/zcode.js';
import { liveToAccount as mirasimLive } from './detect/mirasim.js';
import { liveToAccount as catpawLive } from './detect/catpaw.js';
import { liveToAccount as traeLive } from './detect/trae.js';
import { liveToAccount as minimaxLive } from './detect/minimax.js';
import { detectInstalls, scanLocalTokens, putCandidate, peekCandidate } from './detect/qoderLegacy.js';
import { loadAccounts } from './store.js';
import { addAccount } from './accounts.js';

export { detectAll } from './detect/index.js';

const mask = (token) => (typeof token === 'string' && token.length >= 12
  ? `${token.slice(0, 5)}...${token.slice(-4)}`
  : '***');

/**
 * 采集本机已登录的全部平台账号。
 * @param {{ includeLegacy?: boolean }} opts includeLegacy：是否额外扫描旧版 Qoder IDE / CLI 的明文 token（默认 true）
 * @returns {Promise<{ candidates: Array, errors: Array, scanned: number, scannedDirs: string[] }>}
 */
export async function scan({ includeLegacy = true } = {}) {
  const existing = await loadAccounts();
  const known = (provider, token, uid) => existing.some((a) => (!provider || a.provider === provider)
    && (a.token === token || (uid && a.uid === uid)));
  const candidates = [];
  const errors = [];

  const addRecord = (record, extra) => {
    candidates.push({
      id: putCandidate({ token: record.token, record }),
      kind: 'app',
      provider: record.provider,
      name: record.name,
      email: record.email,
      uid: record.uid,
      phone: record.meta?.phone ? record.meta.phone.slice(0, 3) + '****' + record.meta.phone.slice(-4) : null,
      token: record.token,
      tokenMasked: mask(record.token),
      expiresAt: record.expiresAt,
      hasRefreshToken: Boolean(record.refreshToken),
      imported: known(record.provider, record.token, record.uid),
      ...extra,
    });
  };

  // 1) Qoder 客户端：解密 auth.v1.dat
  const app = await readQoderAppAccounts();
  errors.push(...app.errors);
  for (const c of app.accounts) {
    addRecord({
      provider: c.provider, token: c.token, name: c.user.name || c.user.email, uid: c.user.id, email: c.user.email,
      refreshToken: c.refreshToken, expiresAt: c.expiresAt, source: 'local-app',
      // 存整份解密后的 auth.v1.dat（里面除 token 还有客户端读的其它字段）
      meta: { qoderAuth: c.authJson, qoderAuthFile: c.file },
    }, { source: c.source, current: true });
  }

  // 2) WorkBuddy 客户端：当前会话 + 历史会话
  const wb = readWorkbuddySessions();
  errors.push(...wb.errors);
  for (const c of wb.accounts) {
    const { file: _f, fileTime: _t, current, ...record } = c;
    addRecord({ ...record, source: current ? 'workbuddy-current' : 'workbuddy-history' }, { source: c.source, current });
  }

  // 3) ZCode 客户端：解密 ~/.zcode/v2/credentials.json 的当前登录
  try {
    const z = zcodeLive();
    if (z) addRecord(z, { source: 'ZCode 当前登录', current: true });
  } catch (e) { errors.push({ file: '~/.zcode/v2/credentials.json', error: e.message }); }

  // 4) mirasim 客户端：解密 ~/.mirasim/setting.json 的当前登录
  try {
    const m = await mirasimLive();
    if (m) addRecord(m, { source: 'mirasim 当前登录', current: true });
  } catch (e) { errors.push({ file: '~/.mirasim/setting.json', error: e.message }); }

  // 5) 妙手客户端：解密 %APPDATA%\catpaw-moon\catx-credential.json 的当前登录
  try {
    const cp = catpawLive();
    if (cp) addRecord(cp, { source: '妙手当前登录', current: true });
  } catch (e) { errors.push({ file: 'catpaw-moon/catx-credential.json', error: e.message }); }

  // 6) Trae 客户端：解密 <userData>\User\globalStorage\storage.json 的 tc 信封当前登录
  try {
    const tr = traeLive();
    if (tr) addRecord(tr, { source: 'Trae 当前登录', current: true });
  } catch (e) { errors.push({ file: 'TRAE SOLO CN/User/globalStorage/storage.json', error: e.message }); }

  // 7) MiniMax 客户端：读取 ~/.minimax 凭据当前登录
  try {
    const mm = minimaxLive();
    if (mm) addRecord(mm, { source: 'MiniMax 当前登录', current: true });
  } catch (e) { errors.push({ file: '~/.minimax/auth/.../auth.json', error: e.message }); }

  // 8) 旧版 VS Code 系 Qoder IDE / CLI：明文 token 扫描（归属需调用方指定 provider）
  let scanned = 0;
  const dirs = [];
  if (includeLegacy) {
    const det = detectInstalls();
    dirs.push(...det.ideDataDirs.filter((d) => d.exists).map((d) => d.path));
    if (det.cliDir.exists) dirs.push(det.cliDir.path);
    const legacy = await scanLocalTokens(dirs);
    scanned = legacy.scanned;
    for (const c of legacy.candidates) {
      candidates.push({ ...c, provider: null, source: '旧版 Qoder IDE / CLI 文件', imported: known(null, c.token) });
    }
  }
  return { candidates, errors, scanned, scannedDirs: [...dirs, wb.dir] };
}

/**
 * 按候选导入本地账号库。
 * @param {string} candidateId scan() 返回的候选 id
 * @param {{ provider?: string, name?: string }} opts provider：旧版 token 候选需显式指定（默认 qoder）
 */
export async function importCandidate(candidateId, { provider, name } = {}) {
  const cand = peekCandidate(String(candidateId || ''));
  if (!cand) {
    const e = new Error('候选不存在或已过期，请重新扫描');
    e.code = 'CANDIDATE_EXPIRED';
    throw e;
  }
  const record = cand.record || {
    provider: provider === 'qoder-cn' ? 'qoder-cn' : (provider || 'qoder'),
    token: cand.token,
    source: 'local-scan',
  };
  return addAccount({ ...record, name: name || record.name || null });
}

/** 导入 scan() 产出的全部候选（旧版 token 候选按 provider 归入，默认跳过） */
export async function importAll(candidates, { legacyProvider = null } = {}) {
  let added = 0, updated = 0, skipped = 0;
  const details = [];
  for (const c of candidates) {
    try {
      if (c.kind !== 'app' && !legacyProvider) { skipped++; continue; }
      const r = await importCandidate(c.id, { provider: legacyProvider });
      if (!r.duplicate) added++;
      else if (r.updated) updated++;
      else skipped++;
      details.push({ provider: r.account.provider, name: r.account.name, duplicate: r.duplicate, updated: r.updated });
    } catch {
      skipped++;
    }
  }
  return { added, updated, skipped, details };
}
