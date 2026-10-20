# Usage Guide (OAA-local)

Entry point: `node OAA-local/bin/harvest.js <command>`. Five commands: `detect` / `scan` / `list` / `push` / `export`.

---

## 1. Command overview

| Command | Purpose |
|---|---|
| `detect [--json]` | Probe whether each platform's client on this machine is installed / logged in |
| `scan [--save] [--json] [--reveal] [--no-legacy] [--legacy-provider <p>]` | Read the locally logged-in accounts (decrypt each client's credentials) |
| `list [--json]` | List the accounts already saved to the local account store (tokens masked) |
| `push [--endpoint <url>] [--key <k>] [--only <p1,p2>] [--dry-run] [--timeout <ms>] [--no-health]` | Push the local accounts to the OAA-server gateway |
| `export [--out <file>] [--json]` | Export to a file directly usable by OAA-server's panel "Import Accounts" |

### scan options

| Option | Description |
|---|---|
| `--save` | Write the harvest result into the local account store (by default it only probes and does not persist) |
| `--json` | Output as JSON (includes candidates and error details; **contains raw tokens** — do not redirect to a log file) |
| `--reveal` | Show full tokens in human-readable output (masked by default) |
| `--no-legacy` | Skip old-version IDE / CLI plaintext-token scanning |
| `--legacy-provider <p>` | When `--save`, assign legacy-token candidates to the specified provider (skipped by default) |

### push options

| Option | Default | Description |
|---|---|---|
| `--endpoint <url>` | `http://127.0.0.1:3065` | OAA-server **management-surface** address; under split-port deployment it's the panel port (default `3066`) |
| `--key <key>` | env var `OAA_KEY` | Gateway API Key (use the env var — keeps it off the process list) |
| `--only <p1,p2>` | all | Push only the specified providers, e.g. `--only qoder,workbuddy,trae` |
| `--dry-run` | off | Only print the request body that would be sent; send nothing |
| `--timeout <ms>` | `20000` | Per-request timeout |
| `--no-health` | off | Skip the `/health` self-check before pushing |

Exit code: `1` when any account push fails, so scripts can branch on it.

### export options

| Option | Default | Description |
|---|---|---|
| `--out <file>` | `<data dir>/accounts.server.json` | Output file (0600 permissions, contains plaintext tokens) |
| `--json` | off | Output the export result as JSON |

`export` produces **OAA-server's own export format** (`{version, exportedAt, customProviders, accounts:[…]}`,
recorded in flattened form with `accessToken`/`refreshToken`/identity fields at the top level), so it can be
selected directly on the panel under "Settings → Data → Import Accounts". Its only difference from `push` is the channel:
`push` requires the gateway to be online and carry a Key, sending each entry via `POST /api/accounts`; `export` only writes a
file and can be produced offline — suitable for manual import or migrating to another machine. Both use the **same provider
mapping**; accounts that are unsupported / lack a uid are likewise skipped with a reason.

---

## 2. Typical usage

```bash
node OAA-local/bin/harvest.js detect                 # See what's harvestable on this machine
node OAA-local/bin/harvest.js scan --save            # Harvest and persist
node OAA-local/bin/harvest.js list                   # View the local account store
node OAA-local/bin/harvest.js push --dry-run         # Dry run (strongly recommended first)
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --key sk-xxxxx    # Real push
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --only qoder,qoder-cn,workbuddy,workbuddy-intl,trae --key sk-xxxxx
node OAA-local/bin/harvest.js export                 # Export to a panel-importable file
```

> `--endpoint` hits the **management-surface port**: under default single-port deployment that's `3065`; under split-port
> deployment (compose sets `OAA_PANEL_PORT=3066` by default, with only 3065 mapped publicly) it must be `3066`.

### Example output

```text
$ node OAA-local/bin/harvest.js scan
Harvested 1 candidate (client login 1, legacy file 0)
  ✓ Trae  T.sl  uid=3440790062505251  expires=2026-10-26T04:20:27.605Z  [new]  Trae currently logged in
（not persisted; add --save to write the local account store）

$ node OAA-local/bin/harvest.js push --dry-run
Pushing to http://127.0.0.1:3065 (1 account total) [dry-run]
  · Trae  T.sl → trae  [dry-run]
Summary: success 0, failed 0, skipped 0, dry-run 1
```

---

## 3. Supported platforms & credential sources

| provider | Local credential source | Read method | Pushable to gateway |
|---|---|---|---|
| `qoder` / `qoder-cn` | `<user data dir>/auth.v1.dat` | Electron safeStorage: Windows DPAPI+AES-256-GCM; macOS Keychain+AES-128-CBC; Linux `peanuts`+AES-128-CBC | ✅ → `qoder` |
| `workbuddy` / `workbuddy-intl` | `CodeBuddyExtension/Data/Public/auth/*.info` | v5.8+ sensitive fields use a `$wbEncrypted` envelope (AES-256-GCM); the key exists only in the running client's process memory, retrieved at harvest time via a read-only PowerShell scan (**Windows only, client must stay running**). Older versions are plaintext JSON. Domestic / international edition distinguished by the Keycloak JWT issuer domain | ✅ → `workbuddy` |
| `zcode` | `~/.zcode/v2/credentials.json` | `enc:v1:` AES-256-GCM (key derived from the local environment) | ✅ → `zcode` (must be able to recover access_token) |
| `trae` | `iCubeAuthInfo://icube.cloudide` in `<userData>/User/globalStorage/storage.json` | Trae's in-house "tc" envelope: SHA512 derivation + AES-128-CBC + integrity prefix | ✅ → `trae` (short-lived) |
| `catpaw` (Miaoshou) | `%APPDATA%\catpaw-moon\catx-credential.json` | AES-256-GCM, key derived from the registry `MachineGuid` (**Windows only**) | ⚠️ → `catpaw` (**requires uid**; unavailable offline → skipped) |
| `mirasim` | `~/.mirasim/setting.json` | `mrs1:` AES-256-GCM (master key from DPAPI / Electron safeStorage / env var) | ❌ no such provider in gateway |
| `minimax` | `~/.minimax/auth/prod/cn/mcode-public/auth.json` | Plaintext records | ❌ no such provider in gateway |
| Legacy IDE / CLI | IDE data dir / text files under `~/.qoder` | Regex-scan `dt-` / `pt-` plaintext tokens | ⚠️ attribution needs `--legacy-provider` |

**Harvest scope**: only reads "the local clients' login state" — no browser-session cookie capture, and it does not log in for you.

---

## 4. Field mapping when pushing to OAA-server

Gateway endpoint: `POST /api/accounts` (per account), auth header `x-api-key: <key>` or `Authorization: Bearer <key>`;
on success returns `{account, list}`, on failure returns `{success:false, error:"…"}`.
This endpoint is mounted on the **management-surface port**: `3065` under single-port deployment,
`OAA_PANEL_PORT` (`3066`) under split-port deployment.

| Local provider | Target provider | Key fields |
|---|---|---|
| workbuddy / workbuddy-intl | `workbuddy` | nested `auth{accessToken,refreshToken,expiresAt,domain}` + `account{uid,…}`; `edition=cn\|intl` |
| qoder / qoder-cn | `qoder` | flattened `accessToken,refreshToken,expiresAt,userId,machineId`; `mode=global\|cn` |
| trae | `trae` | `auth{accessToken,expiresAt,domain,apiHost,deviceId,variant:'solo'}` + `account{uid}` |
| zcode | `zcode` | flattened `accessToken`/`jwt`/`userId` |
| catpaw | `catpaw` | `accessToken` + standalone `uid` |

Conventions & notes:

- `expiresAt` is uniformly converted to an **epoch-millisecond number** (the gateway only accepts a JSON number).
- The gateway merges by **uid** (hit → update / miss → append), so **repeated pushes are idempotent**.
- When no Key is configured the management interface is open; **once a Key is configured you must supply the correct one**, otherwise 401.
- `--dry-run --json` shows each account's complete `body` to be sent, handy for verification.

---

## 5. Data directory & environment variables

| Variable | Purpose |
|---|---|
| `OAA_HOME` | Data directory (default `~/.oaa`); the account store `accounts.json` (0600) lives here |
| `OAA_KEY` | `push`'s default gateway Key (equivalent to `--key`) |
| `ZCODE_HOME` / `ZCODE_CREDENTIAL_SECRET` | Override ZCode data dir / credential key |
| `MIRASIM_HOME` / `MIRASIM_DESKTOP_DATA_DIR` / `MIRASIM_SECRET_KEY` / `MIRASIM_APP_SECRET_KEY` | Override mirasim dir / master key |
| `MINIMAX_HOME` | Override MiniMax data dir |
| `TRAE_HOME` | Override Trae data dir (point at the dir containing `User/globalStorage/storage.json`) |
| `CATPAW_CREDENTIAL_FILE` | Override Miaoshou credential file path |
| `LOCALAPPDATA` / `APPDATA` / `XDG_DATA_HOME` / `XDG_CONFIG_HOME` | Base of each platform's default paths (usually no need to change) |

Account-store record structure: `id / name / provider / token / uid / email / refreshToken / expiresAt / source / meta / createdAt`.

---

## 6. Troubleshooting

| Symptom | Cause & handling |
|---|---|
| `detect` shows "not installed / not logged in" | Client not installed, not logged in, or its data dir was moved (use the corresponding `*_HOME` env var to specify) |
| `scan` can't list a platform | That platform isn't logged in; or that platform has only one "currently logged in" state, requiring per-account login then separate import |
| mirasim reports `MISSING_SECRET_KEY` | Can't get the master key locally: fully quit Mirasim, then restart and log in, or specify via `MIRASIM_SECRET_KEY` |
| `push` reports "cannot connect to OAA-server" | Gateway not started / wrong port / firewall blocking; confirm `curl http://<host>:3065/health` succeeds |
| `push` says "no /health provided… skipping health self-check" | Normal: `/health` exists only on the gateway port (3065); the management-surface port (3066) doesn't serve it — this tool treats 404 as "port is listening" and continues pushing |
| `push` fails every account with 404 "Not found: POST /api/accounts" | `--endpoint` pointed at the gateway port; change it to the **management-surface port** (3066 under split-port deployment) |
| `push` reports 401 | Gateway has a Key but you didn't supply the right one: pass the panel-created Key via `--key` or `OAA_KEY` |
| `push` reports 400 "missing uid" | That account lacks a uid (e.g. abnormal WorkBuddy session / offline Miaoshou import) — the gateway needs a uid to identify the account |
| Miaoshou skipped "missing uid" | Offline local read can't get the uid, gateway rejects it; this is expected behavior |
| mirasim / minimax skipped | No such provider in the gateway's registry; expected |
| Trae forwards 401 after a while | This tool **deliberately does not save** Trae's refreshToken (saving it would kick your IDE offline) — it's a short-lived credential: re-log in to Trae → `scan --save` → `push` |
| Panel "Import Accounts" reports "operation failed: import content must be a JSON object" | The selected file is an **array** at top level (e.g. the harvester's `~/.oaa/accounts.json`). This entry only eats the server's own export format (top-level object + `accounts` array + top-level `accessToken`): use the file produced by `harvest.js export`, or switch to `push` |
| Push succeeds but the panel shows nothing | The panel loads asynchronously — refresh once; or confirm you pushed to the same gateway instance |

---

## 7. Limitations & risks

- **Read-only local login state**: doesn't log in for you, doesn't refresh Trae credentials (to avoid kicking your in-use IDE offline), and does no browser cookie capture.
- **Plaintext on disk**: both the local `accounts.json` and the gateway data volume store plaintext tokens; don't commit them to a public repo / upload them to cloud storage.
- **Compliance**: forwarding that "reuses login state in a non-official-client form" may violate upstream service terms, with risks of account risk-control / ban; the quota still comes from your own account's allowance. Use only for accounts you have authorized, and control your usage intensity.
- **Upstream is volatile**: each platform's private protocol can change at any time (especially Trae's constant table and Qoder's install-dir detection); when it breaks, adapt accordingly.
