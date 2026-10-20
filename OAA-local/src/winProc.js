// 提取自 CreditDaddy (https://github.com/techysy/CreditDaddy) src/winProc.js，MIT License。
// Windows 进程探测：tasklist 输出跟随控制台代码页（简体中文为 GBK），统一在此解码。

import { execFileSync } from 'node:child_process';

/** tasklist 的 Buffer 输出 → 字符串（GBK 优先，解码器不可用时退回 utf8） */
export function decodeTasklist(buf) {
  try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString('utf8'); }
}

/** tasklist 在「无匹配」时输出的那行（各语言版本） */
const NO_TASKS = /No Tasks|没有运行的任务|没有找到|没有任务/i;

/**
 * 任一 exe 是否在运行。查不到（命令不存在 / 超时）一律按「没在运行」处理。
 * @param {string|string[]} exes
 */
export function anyProcRunning(exes) {
  if (process.platform !== 'win32') return false;
  for (const exe of [].concat(exes)) {
    try {
      const out = decodeTasklist(execFileSync('tasklist.exe', ['/FI', `IMAGENAME eq ${exe}`, '/NH'],
        { windowsHide: true, encoding: 'buffer', timeout: 8000 }));
      if (!NO_TASKS.test(out)) return true;
    } catch { /* 查不到就换下一名 */ }
  }
  return false;
}
