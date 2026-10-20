// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/daemon.js 的 /api/local/detect 逻辑，MIT License。
// 本机各平台客户端安装 / 登录环境侦测汇总。

import { detectQoderApps } from './qoderApp.js';
import { detectInstalls } from './qoderLegacy.js';
import { workbuddyAuthDir } from './workbuddy.js';
import { detectZcode } from './zcode.js';
import { detectMirasim } from './mirasim.js';
import { detectCatpaw } from './catpaw.js';
import { detectTrae } from './trae.js';
import { detectMiniMax } from './minimax.js';

/** 一次性探测本机所有平台的安装与登录环境 */
export function detectAll() {
  return {
    qoder: detectQoderApps(),
    workbuddyDir: workbuddyAuthDir(),
    zcode: detectZcode(),
    mirasim: detectMirasim(),
    catpaw: detectCatpaw(),
    trae: detectTrae(),
    minimax: detectMiniMax(),
    legacy: detectInstalls(),
  };
}

export {
  detectQoderApps, detectInstalls, workbuddyAuthDir,
  detectZcode, detectMirasim, detectCatpaw, detectTrae, detectMiniMax,
};
