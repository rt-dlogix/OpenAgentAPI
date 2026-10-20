#!/usr/bin/env node
// OAA 电脑端凭据采集 CLI。
// 用法：
//   node bin/harvest.js detect              探测本机各平台客户端安装 / 登录环境
//   node bin/harvest.js scan [选项]          读取本机已登录账号（解密各客户端凭据）
//   node bin/harvest.js list                列出已保存到本地的账号（脱敏）
//   node bin/harvest.js push [选项]          把本地账号推送到 OAA-server 网关
//   node bin/harvest.js export [选项]        把本地账号导出成 OAA-server 面板可导入的文件
// scan 选项：
//   --json                  以 JSON 输出（含候选与错误明细）
//   --save                  把采集结果写入本地账号库（默认只探测不落库）
//   --reveal                人类可读输出时显示完整 token（默认脱敏）
//   --no-legacy             跳过旧版 Qoder IDE / CLI 明文 token 扫描
//   --legacy-provider <p>   --save 时把旧版 token 候选归入指定 provider（默认跳过）
// push 选项：
//   --endpoint <url>        OAA-server 地址（默认 http://127.0.0.1:3065）
//   --key <key>             网关 API Key（也可用环境变量 OAA_KEY；未配置 Key 时留空）
//   --only <p1,p2>          只推送指定 provider（如 qoder,workbuddy,trae）
//   --dry-run               只打印将要发送的请求体，不实际发送
//   --timeout <ms>          单请求超时（默认 20000）
//   --no-health             跳过推送前的 /health 连通性自检
//
// export 选项：
//   --out <file>            输出文件（默认 <数据目录>/accounts.server.json）
//   --json                  以 JSON 输出导出结果
//
// 采到的凭据保存在 $OAA_HOME（默认 ~/.oaa）的 accounts.json（0600 权限）。

import fs from 'node:fs/promises';
import path from 'node:path';
import { detectAll } from '../src/detect/index.js';
import { scan, importAll } from '../src/scan.js';
import { loadAccounts, publicAccount, dataDir } from '../src/store.js';
import { PROVIDER_LABEL } from '../src/constants.js';
import { DEFAULT_ENDPOINT, checkHealth, pushAccounts, buildServerImportFile } from '../src/push/oaa.js';

function parseArgs(rest) {
  const opts = { legacyProvider: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') opts.json = true;
    else if (a === '--save') opts.save = true;
    else if (a === '--reveal') opts.reveal = true;
    else if (a === '--no-legacy') opts.includeLegacy = false;
    else if (a === '--legacy-provider') opts.legacyProvider = rest[++i] || null;
    else if (a.startsWith('--legacy-provider=')) opts.legacyProvider = a.split('=')[1];
    else if (a === '--endpoint') opts.endpoint = rest[++i] || null;
    else if (a.startsWith('--endpoint=')) opts.endpoint = a.split('=')[1];
    else if (a === '--key') opts.key = rest[++i] || null;
    else if (a.startsWith('--key=')) opts.key = a.split('=')[1];
    else if (a === '--only') opts.only = splitList(rest[++i]);
    else if (a.startsWith('--only=')) opts.only = splitList(a.split('=')[1]);
    else if (a === '--out' || a === '-o') opts.out = rest[++i] || null;
    else if (a.startsWith('--out=')) opts.out = a.split('=')[1];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-health') opts.skipHealth = true;
    else if (a === '--timeout') opts.timeout = Number(rest[++i]) || undefined;
    else if (a.startsWith('--timeout=')) opts.timeout = Number(a.split('=')[1]) || undefined;
  }
  return opts;
}

const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const label = (p) => PROVIDER_LABEL[p] || p || '(待指定)';

function printErrors(errors) {
  for (const e of errors) console.log('  ⚠', e.file || e.provider || '', e.error);
}

async function cmdDetect(opts) {
  const d = detectAll();
  if (opts.json) return console.log(JSON.stringify(d, null, 2));
  console.log('本机环境探测：');
  for (const a of d.qoder) {
    console.log(`  Qoder(${a.label})  安装=${a.installed ? '是' : '否'}  已登录=${a.signedIn ? '是' : '否'}  数据目录=${a.dataDir}`);
  }
  console.log(`  WorkBuddy      目录=${d.workbuddyDir}`);
  console.log(`  ZCode          ${d.zcode.exists ? '已安装' : '未安装'}  已登录=${d.zcode.signedIn ? '是' : '否'}`);
  console.log(`  mirasim        ${d.mirasim.exists ? '已安装' : '未安装'}  已登录=${d.mirasim.signedIn ? '是' : '否'}`);
  console.log(`  妙手 CatPaw     ${d.catpaw.exists ? '有凭据' : '无凭据'}  已登录=${d.catpaw.signedIn ? '是' : '否'}`);
  console.log(`  Trae           ${d.trae.exists ? '已安装' : '未安装'}  已登录=${d.trae.signedIn ? '是' : '否'}`);
  console.log(`  MiniMax        ${d.minimax.installed ? '已安装' : '未安装'}  已登录=${d.minimax.signedIn ? '是' : '否'}`);
}

async function cmdScan(opts) {
  const result = await scan({ includeLegacy: opts.includeLegacy !== false });
  let saveResult = null;
  if (opts.save) saveResult = await importAll(result.candidates, { legacyProvider: opts.legacyProvider });

  if (opts.json) {
    return console.log(JSON.stringify({ ...result, save: saveResult, dataDir: dataDir() }, null, 2));
  }
  const apps = result.candidates.filter((c) => c.kind === 'app');
  const legacy = result.candidates.filter((c) => c.kind !== 'app');
  console.log(`采集到 ${result.candidates.length} 个候选（客户端登录 ${apps.length}，旧版文件 ${legacy.length}）`);
  for (const c of apps) {
    console.log(`  ✓ ${label(c.provider)}  ${c.name || '(无昵称)'}  uid=${c.uid || '-'}`
      + `  过期=${c.expiresAt || '-'}  ${c.imported ? '[已入库]' : '[新]'}  ${c.source}`);
  }
  for (const c of legacy) {
    console.log(`  · ${c.tokenMasked}  (${c.kind})  ${c.file}`);
  }
  if (result.errors.length) { console.log('错误：'); printErrors(result.errors); }
  if (opts.reveal) {
    console.log('完整 token：');
    for (const c of result.candidates) console.log(`  ${label(c.provider)}  ${c.token}`);
  }
  if (saveResult) {
    console.log(`已保存到 ${dataDir()}：新增 ${saveResult.added}，续期 ${saveResult.updated}，跳过 ${saveResult.skipped}`);
  } else if (result.candidates.length) {
    console.log('（未落库；加 --save 写入本地账号库）');
  }
}

async function cmdList(opts) {
  const accounts = await loadAccounts();
  const list = accounts.map(publicAccount);
  if (opts.json) return console.log(JSON.stringify({ dataDir: dataDir(), accounts: list }, null, 2));
  console.log(`本地账号库：${dataDir()}  （共 ${list.length} 个）`);
  for (const a of list) {
    console.log(`  ${label(a.provider)}  ${a.name || '(无昵称)'}  uid=${a.uid || '-'}  token=${a.tokenMasked}  来源=${a.source}`);
  }
  if (!list.length) console.log('  （空：先运行 scan --save 采集本机凭据）');
}

async function cmdExport(opts) {
  const accounts = await loadAccounts();
  if (!accounts.length) {
    console.log('（本地账号库为空：先运行 scan --save）');
    return;
  }
  const { payload, results } = buildServerImportFile(accounts);
  const file = opts.out || path.join(dataDir(), 'accounts.server.json');
  await fs.writeFile(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });

  if (opts.json) return console.log(JSON.stringify({ file, results, exported: payload.accounts.length }, null, 2));
  console.log(`已导出 ${payload.accounts.length} 个账号 → ${file}`);
  for (const r of results) {
    const who = `${label(r.provider)}  ${r.name || '(无昵称)'}`;
    if (r.status === 'ok') console.log(`  ✓ ${who} → ${r.providerId}`);
    else console.log(`  – ${who}  跳过：${r.reason}`);
  }
  console.log('可在 OAA-server 面板「设置 → 数据 → 导入账号」直接选择该文件。');
}

async function cmdPush(opts) {
  const all = await loadAccounts();
  const accounts = opts.only ? all.filter((a) => opts.only.includes(a.provider)) : all;
  if (!accounts.length) {
    console.log(opts.only ? `（本地账号库里没有 provider=${opts.only.join('/')} 的账号）` : '（本地账号库为空：先运行 scan --save）');
    return;
  }
  const cfg = {
    endpoint: opts.endpoint || DEFAULT_ENDPOINT,
    apiKey: opts.key || process.env.OAA_KEY || null,
    dryRun: Boolean(opts.dryRun),
    timeoutMs: opts.timeout,
  };

  let health = null;
  if (!cfg.dryRun && !opts.skipHealth) {
    health = await checkHealth(cfg);
    // 分端口部署（服务端设了 OAA_PANEL_PORT）时 /health 只挂在网关端口上，
    // 而账号推送（/api/accounts）只在管理面端口 —— --endpoint 指向后者时会
    // 拿到 404。404 本身已证明「端口活着且有东西在应答」，照常推送；
    // 真连不上是 fetch 抛错（health.status 为空），那条才拦。
    if (!health.ok && health.status !== 404) {
      console.log(`✗ 无法连接 OAA-server（${cfg.endpoint}）：${health.error || `HTTP ${health.status}`}`);
      console.log('  请确认网关已启动、端口正确；或先用 --dry-run 查看将要发送的请求体。');
      process.exitCode = 1;
      return;
    }
    if (health.status === 404) {
      console.log(`ℹ️  ${cfg.endpoint} 未提供 /health（分端口部署的管理面端口）：跳过健康自检，直接推送`);
    }
  }

  const results = await pushAccounts(accounts, cfg);
  if (opts.json) return console.log(JSON.stringify({ endpoint: cfg.endpoint, health, results }, null, 2));

  console.log(`推送到 ${cfg.endpoint}（共 ${accounts.length} 个账号）${cfg.dryRun ? ' [dry-run]' : ''}`);
  for (const r of results) {
    const tag = r.providerId ? ` → ${r.providerId}` : '';
    const who = `${label(r.provider)}  ${r.name || '(无昵称)'}`;
    if (r.status === 'pushed') console.log(`  ✓ ${who}${tag}`);
    else if (r.status === 'dry-run') console.log(`  · ${who}${tag}  [dry-run]`);
    else if (r.status === 'skipped') console.log(`  – ${who}  跳过：${r.reason}`);
    else console.log(`  ✗ ${who}${tag}  失败：${r.reason}${r.statusCode ? ` (HTTP ${r.statusCode})` : ''}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`汇总：成功 ${count('pushed')}，失败 ${count('failed')}，跳过 ${count('skipped')}${cfg.dryRun ? `，预演 ${count('dry-run')}` : ''}`);
  if (count('failed')) process.exitCode = 1;
}

const HELP = `OAA 凭据采集 CLI

用法：
  node bin/harvest.js detect [--json]          探测本机各平台客户端安装 / 登录环境
  node bin/harvest.js scan [选项]              读取本机已登录账号
  node bin/harvest.js list [--json]            列出已保存到本地的账号
  node bin/harvest.js push [选项]              把本地账号推送到 OAA-server 网关
  node bin/harvest.js export [选项]            导出成 OAA-server 面板可导入的文件

scan 选项：
  --save                   把采集结果写入本地账号库
  --json                   以 JSON 输出
  --reveal                 人类可读输出时显示完整 token
  --no-legacy              跳过旧版 Qoder IDE / CLI 明文 token 扫描
  --legacy-provider <p>    --save 时旧版 token 候选归入的 provider（默认跳过）

push 选项：
  --endpoint <url>         OAA-server 管理面地址（默认 ${DEFAULT_ENDPOINT}）
                           服务端分端口部署（设了 OAA_PANEL_PORT）时指向面板端口（默认 3066）
  --key <key>              网关 API Key（也可用环境变量 OAA_KEY）
  --only <p1,p2>           只推送指定 provider
  --dry-run                只打印将要发送的请求体，不实际发送
  --timeout <ms>           单请求超时（默认 20000）
  --no-health              跳过推送前的 /health 连通性自检

export 选项：
  --out <file>             输出文件（默认 <数据目录>/accounts.server.json）
  --json                   以 JSON 输出导出结果

数据目录：$OAA_HOME（默认 ~/.oaa）`;

const [, , cmd, ...rest] = process.argv;
const opts = parseArgs(rest);
try {
  if (cmd === 'detect') await cmdDetect(opts);
  else if (cmd === 'scan') await cmdScan(opts);
  else if (cmd === 'list') await cmdList(opts);
  else if (cmd === 'push') await cmdPush(opts);
  else if (cmd === 'export') await cmdExport(opts);
  else console.log(HELP);
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
}
