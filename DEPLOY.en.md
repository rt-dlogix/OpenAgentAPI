# Deployment Guide

OAA consists of two **mutually independent** components:

| Role | Component | Where deployed | Responsibility |
|---|---|---|---|
| Credential production | **OAA-local** (`bin/` `src/`) | Windows / macOS / Linux PC | Reads credentials of locally logged-in clients, saves them to a local account store, pushes to the gateway |
| Aggregation & routing | **OAA-server** (`OAA-server/`) | Docker (local machine / Linux server / NAS) | Receives accounts, maintains the account pool, routes by priority & health, exposes an OpenAI-compatible endpoint |

```
  ┌─ PC side (must have each platform's client logged in)────┐        ┌─ Server / local gateway ──────────────┐
  │  Client login state (read-only decrypt)                   │        │  OAA-server  (panel:3066)            │
  │            │                                             │        │  Account pool · priority · 429 fallback│
  │            ▼                                             │        │        ▲                              │
  │  OAA-local  harvest                                      │        │        │ POST /api/accounts             │
  │  scan → accounts.json (0600)                             │        │        │ (x-api-key / Bearer)             │
  │            │   push                                      │───────▶│────────┘                                │
  └────────────┼─────────────────────────────────────────────┘        │        ▼  /v1/chat/completions        │
                │                                                      │   any OpenAI-compatible client        │
                │                                                      └─────────────────────────────────────┘
                └─ The server initiates NO login; it only receives credentials already produced by the PC side
```

> Ports: by default a **split-port** deployment — the panel and `/api/*` (including the account-push endpoint) are on **3066**,
> while the gateway `/v1/*` and `/health` are on **3065**. Only expose `3065` outward; see [1.5](#15-split-port-deployment-public-network-maps-only-3065).

> Pre-emptive note: WorkBuddy and Qoder **do not support keeping multiple accounts actively logged in on the same PC at once**.
> For multiple accounts you must "log in one → `scan --save` to harvest → log out → log in the next" and accumulate them one by one.

---

## 1. Server side: deploying OAA-server

### 1.1 Docker (recommended)

```bash
cd OAA-server

# Simple version (data via ./data bind mount)
docker compose up -d --build

# Or hardened version (read-only root filesystem + cap_drop ALL + named volume + binds 127.0.0.1 by default)
cp deploy/docker/.env.example deploy/docker/.env
docker compose -f deploy/docker/compose.yaml up -d --build
```

The first build compiles the entire Rust dependency tree; afterward only the source layer is recompiled.

Both variants are **split-port**: gateway `3065`, panel `3066` (step 1 below and `push --endpoint` follow this).
All commands run inside the `OAA-server` directory.

### 1.2 First-time configuration

1. Open `http://<host>:3066/` in a browser (panel port);
2. On first entry, the wizard **registers an admin account**;
3. Open the **"Gateway Key"** page and create an API Key — **this is the value OAA-local's `push --key` must carry**;
4. Note the client access address: `http://<host>:3065/v1` (gateway port, different from the panel port).

> ⚠️ Before any Key is created, `/v1` is **fail-closed (refuses to forward)**; the management interface `/api/*` is open
> while "not a single Key has been configured", so **you must create a Key before pushing**, otherwise `push` gets a 401.

### 1.3 Environment variables

| Variable | Default | Description |
|---|---|---|
| `OAA_HOST` | `0.0.0.0` | Listen address |
| `OAA_PROXY_PORT` | `3065` | Listen port |
| `OAA_PANEL_PORT` | set in compose to `3066` | Panel split-port: the management surface (panel UI + `/api/*`) listens independently on this port; the main port keeps only `/v1/*` + `/health` |
| `OAA_PROXY_HOME` | `~/.oaa` (inside container `/data`) | Config / data directory |
| `OAA_UI_DIR` | empty | Panel static directory (inside container `/app/ui`) |
| `OAA_ADMIN_USER` / `OAA_ADMIN_PASSWORD` | empty | Pre-provisioned admin (password in plaintext, hashed at startup); leave empty to use panel registration |
| `OAA_ALLOW_NO_KEY` | empty | Set `1` to disable `/v1`'s fail-closed — **LAN-only** |
| `OAA_CAPTCHA_ENABLED` | `1` | Login-page human-verification toggle |

### 1.4 Network & security

- Inside the container it listens on `0.0.0.0`; **the actual exposure surface is decided by the compose port mapping**:
  - Both compose variants are split-port by default; `3066` (panel + `/api/*`) binds only `127.0.0.1` by default;
  - `3065` (gateway) also binds loopback by default; to expose it, change `.env`'s `OAA_BIND_ADDRESS`, or let a tunnel forward to loopback.
- Over a public network, put a reverse proxy / tunnel in front and **enable TLS** (the gateway itself does not do TLS); both
  `push --endpoint` and the client `base_url` should point at `https://…`.
- **Do not map `3066` to the public network**: it is the management surface; exposing it means the panel login page + `/api/*` are
  both public, leaving only the account-password layer as a door.
- The gateway Key is **equivalent to management credentials** — a leak means the account pool can be taken over by others.
- What the gateway persists is **plaintext credentials** (`accessToken` / `refreshToken`); strictly limit access to the data volume.

### 1.5 Split-port deployment (public network maps only 3065)

Both compose variants are split-port by default, with the following landing points:

| Port | Content | Exposure scope |
|---|---|---|
| `3065` | Gateway: `/v1/*` (chat) and `/health` | **Outward** — tunnels / frp / public mapping expose only this one |
| `3066` | Management surface: panel UI and `/api/*` (account push is also here) | Local loopback / LAN only |

Key points:

- **OAA-local's `push --endpoint` must point at `3066`** (not `3065`) — `/api/accounts` is mounted only on the management surface.
  At that point `push` prints an extra line "skipping health self-check" because this port has no `/health`; this is normal.
- **To push from a PC on the same LAN**: change `OAA_PANEL_BIND_ADDRESS` in `.env` to the host's LAN address
  (e.g. `192.168.1.10`), then `push --endpoint http://192.168.1.10:3066`; **do not** fill in a public-network address.
- **The panel itself should only be accessed from the LAN**: to view the panel remotely, or to push across machines,
  use a private-network channel; do not map `3066` to the public network just for convenience.
- The tunnel / frp backend target is only one: `127.0.0.1:3065`; the client `base_url` uses `https://<tunnel-domain>/v1`.

---

## 2. PC side: deploying OAA-local

### 2.1 Install

No install needed; requires **Node.js ≥ 20**:

```bash
node OAA-local/bin/harvest.js --help
```

### 2.2 Data directory

| Item | Value |
|---|---|
| Default directory | `~/.oaa` |
| Override | environment variable `OAA_HOME` |
| Account-store file | `<data dir>/accounts.json` (0600 permissions, atomic write) |

### 2.3 First harvest & push

```bash
node OAA-local/bin/harvest.js detect                  # Probe this machine's client install / login environment
node OAA-local/bin/harvest.js scan                    # Harvest (probe only, no persistence)
node OAA-local/bin/harvest.js scan --save             # Persist
node OAA-local/bin/harvest.js push --dry-run          # Dry run: only shows the request body that would be sent
node OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066 --key <gatewayKey>
```

> `--endpoint` points at the **panel port** (under split-port deployment that's `3066`): `/api/accounts` is mounted only on the management surface.

Pushing is **per-account `POST /api/accounts`**, the gateway merges by uid (hit → update / miss → append), so **repeated pushes are idempotent**.

### 2.4 Scheduled tasks

Tokens expire, so periodically re-harvest and re-push. **Windows (Task Scheduler)** — first write a serial script `oaa-sync.cmd`:

```bat
@echo off
set OAA_HOME=%USERPROFILE%\.oaa
node "e:\path\to\OpenAgentAPI\bin\harvest.js" scan --save
node "e:\path\to\OpenAgentAPI\bin\harvest.js" push --endpoint http://127.0.0.1:3066 --key <gatewayKey>
```

```powershell
schtasks /Create /TN "OAA-Sync" /SC DAILY /ST 09:30 /TR "e:\path\to\oaa-sync.cmd" /F
```

**Linux / NAS (cron)**:

```cron
30 9 * * * OAA_HOME=/home/me/.oaa OAA_KEY=<key> /usr/bin/node /opt/OpenAgentAPI/OAA-local/bin/harvest.js scan --save && OAA_HOME=/home/me/.oaa OAA_KEY=<key> /usr/bin/node /opt/OpenAgentAPI/OAA-local/bin/harvest.js push --endpoint http://127.0.0.1:3066
```

> Pass the Key via environment variable `OAA_KEY` to keep it off the command line (which process listings can see).

### 2.5 Deployment boundaries

- OAA-local **must run on a machine that can read the clients' login state** (it reads the local clients' encrypted credential
  files; on Windows it also depends on DPAPI / the registry), so it cannot be moved to a server.
- OAA-server **may** run on another machine, as long as OAA-local can reach its **management-surface port** (under split-port
  deployment that's `3066`, see 1.5; for same-machine deployment use loopback, for cross-machine point `OAA_PANEL_BIND_ADDRESS`
  at the LAN address or use a private-network channel).

---

## 3. Integration & acceptance checklist

| # | Check | Command / location | Expected |
|---|---|---|---|
| 1 | Gateway alive | `curl http://<host>:3065/health` | 200 (gateway port) |
| 2 | Gateway Key created | Panel (`3066`) "Gateway Key" page | at least one enabled Key |
| 3 | Local environment recognized | `node OAA-local/bin/harvest.js detect` | target platforms show "logged in" |
| 4 | Credentials read successfully | `node OAA-local/bin/harvest.js scan` | accounts listed, `expires` field has a value |
| 5 | Payload correct | `node OAA-local/bin/harvest.js push --dry-run --json` | each provider's `body` field matches the mapping table in USAGE.md |
| 6 | Real push | `push --endpoint http://<host>:3066 --key <Key>` | summary shows "success N" |
| 7 | Persisted and visible | Panel (`3066`) "Accounts" page | corresponding account appears |
| 8 | End-to-end | Client `base_url=http://<host>:3065/v1` | normal chat works |

---

## 4. Security & compliance

- This project **only reuses the local login state of your own accounts** — no cracking, no bypassing of any authentication; the quota comes from what your accounts already include.
- Forwarding that **reuses login state in a non-official-client form** may **violate upstream service terms**, with risks of rate limiting / risk control / freezing. Assess and control your usage intensity at your own discretion.
- Credentials are **stored in plaintext on both ends**: never commit them to a public repo, upload them to cloud storage, or share them.
- Recommendation: split the panel onto its own port and bind loopback (compose does this by default); expose only the gateway port outward; use a TLS tunnel / reverse proxy over a public network; rotate the gateway Key periodically.
