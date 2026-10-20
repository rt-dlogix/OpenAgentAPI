// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/workbuddyClient.js 的 JWT 解析部分，MIT License。
// 纯本地解析，不联网：仅用于从 token 中读出归属、uid、过期时间与昵称。

/** 解码 JWT payload（不校验签名，仅供展示 / 识别用户） */
export function decodeJwt(jwt) {
  try {
    const seg = String(jwt).split('.')[1];
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 从 WorkBuddy / CodeBuddy 登录 token 推断归属。
 * 登录 token 是 Keycloak JWT，签发方决定归属：
 *   www.codebuddy.cn / www.workbuddy.cn / copilot.tencent.com → 国内版
 *   www.codebuddy.ai / www.workbuddy.ai / workbuddy.cc        → 国际版
 * @returns {{ provider: string|null, host: string|null, uid: string|null, expiresAt: string|null, name: string|null }}
 *          不是 CodeBuddy 系 token 时 provider 为 null。
 */
export function inspectToken(token) {
  const c = decodeJwt(token) || {};
  let host = null;
  try { host = new URL(c.iss).host; } catch { /* 无 iss 或非法 URL */ }
  let provider = null;
  if (host && /(codebuddy|workbuddy)\.ai$|workbuddy\.cc$/.test(host)) provider = 'workbuddy-intl';
  else if (host && /(codebuddy|workbuddy)\.cn$|copilot\.tencent\.com$/.test(host)) provider = 'workbuddy';
  return {
    provider,
    host,
    uid: typeof c.sub === 'string' ? c.sub : null,
    expiresAt: Number.isFinite(c.exp) ? new Date(c.exp * 1000).toISOString() : null,
    name: c.name || c.preferred_username || c.nickname || null,
  };
}
