// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy)，MIT License，Copyright (c) 2026 CreditDaddy contributors。
// 仅保留本地凭据采集所需的产品线常量；原项目中的 Qoder 接口端点 / 请求头 / 版本号等网络侧常量已按需剔除。

// 账号的 provider = 产品 + 区域。只登记「有本机客户端登录态」的产品线。
export const PROVIDERS = [
  'qoder', 'qoder-cn',
  'workbuddy', 'workbuddy-intl',
  'zcode', 'mirasim', 'catpaw',
  'trae', 'minimax',
];

export const PROVIDER_LABEL = {
  qoder: 'Qoder 国际版',
  'qoder-cn': 'Qoder 国内版',
  workbuddy: 'WorkBuddy 国内版',
  'workbuddy-intl': 'WorkBuddy 国际版',
  zcode: 'ZCode',
  mirasim: 'mirasim',
  catpaw: '妙手',
  trae: 'Trae',
  minimax: 'MiniMax',
};

/** provider → 产品线（同产品的国内 / 国际版归一） */
export const productOf = (provider) => {
  const p = String(provider);
  if (p.startsWith('workbuddy')) return 'workbuddy';
  if (p.startsWith('zcode')) return 'zcode';
  if (p === 'mirasim') return 'mirasim';
  if (p === 'catpaw') return 'catpaw';
  if (p.startsWith('trae')) return 'trae';
  if (p === 'minimax') return 'minimax';
  return 'qoder';
};
