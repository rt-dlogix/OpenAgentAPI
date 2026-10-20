// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/accounts.js，MIT License。
// 账号新增 / 导入的统一入口：去重 + 入库在 withAccounts 串行队列内完成。
// 本采集器不做网络校验（原项目的 userinfo 校验 / token 刷新回写 / 网页会话挂载已剔除）：
// 本机客户端登录态可信，直接入库。
//   同一 provider 下 uid 相同但 token 不同 → 视为 token 续期，原地更新而不是新增。

import { normalizeAccountInput, findDuplicate, loadAccounts, withAccounts } from './store.js';

/**
 * 用新记录刷新已存在账号（保留 id / 名字）：
 *   token 不同 → 续期（换 token + 凭据元数据）；token 相同 → 只补全缺失的 uid / 邮箱 / 有效期 / refreshToken
 * @returns {boolean} 是否有变化
 */
function refreshExisting(existing, incoming) {
  let changed = false;
  const set = (k, v) => { if (v && existing[k] !== v) { existing[k] = v; changed = true; } };
  if (existing.token !== incoming.token) {
    set('token', incoming.token);
    // 换了 token 就一起换 refreshToken：新会话没带 refreshToken 时，保留旧的会留下已被服务端作废的值。
    if (existing.refreshToken !== (incoming.refreshToken || null)) {
      existing.refreshToken = incoming.refreshToken || null;
      changed = true;
    }
    set('expiresAt', incoming.expiresAt);
  } else {
    if (!existing.refreshToken) set('refreshToken', incoming.refreshToken);
    if (!existing.expiresAt) set('expiresAt', incoming.expiresAt);
  }
  if (!existing.uid) set('uid', incoming.uid);
  if (!existing.email) set('email', incoming.email);
  const incomingMeta = incoming.meta && Object.keys(incoming.meta).length ? incoming.meta : null;
  if (incomingMeta) {
    existing.meta = { ...(existing.meta || {}), ...incomingMeta };
    changed = true;
  }
  if (changed) existing.updatedAt = new Date().toISOString();
  return changed;
}

/** 在锁内合并一条记录：新增 / 续期 / 重复 */
function mergeInto(accounts, account) {
  const dup = findDuplicate(accounts, account.provider, account.token, account.uid);
  if (!dup) {
    accounts.push(account);
    return { account, duplicate: false, updated: false };
  }
  const refreshed = refreshExisting(dup, account);
  return { account: dup, duplicate: true, updated: refreshed };
}

/**
 * 新增一个账号（本机导入：trusted）。
 * @param {{name?, provider, token, uid?, email?, refreshToken?, expiresAt?, source?, meta?}} input
 * @returns {Promise<{account, duplicate: boolean, updated: boolean}>}
 *   duplicate=true 时 account 为已存在的记录；updated=true 表示已用新 token 续期
 */
export function addAccount(input) {
  const account = normalizeAccountInput(input);
  return withAccounts((accounts) => mergeInto(accounts, account));
}

/**
 * 批量导入（已解析的记录数组），不做网络校验。
 * @returns {Promise<{added, updated, skipped}>}
 */
export function importAccounts(list) {
  return withAccounts(async (accounts) => {
    let added = 0, updated = 0, skipped = 0;
    for (const item of list) {
      try {
        const r = mergeInto(accounts, normalizeAccountInput(item));
        if (!r.duplicate) added++;
        else if (r.updated) updated++;
        else skipped++;
      } catch { skipped++; }
    }
    return { added, updated, skipped };
  });
}
