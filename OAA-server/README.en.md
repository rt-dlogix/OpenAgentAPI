# OAA-server

A multi-provider local gateway (headless server component): wraps the login state of various AI desktop clients into a local **OpenAI-compatible API**.
Any client that supports a custom `base_url` simply fills in `http://<host>:3065/v1` to call those accounts' model quota.

> This directory is the **OAA project's** server component; it evolves independently and is not synced with any third-party repository.

## License

See [`LICENSE`](./LICENSE): MIT terms **plus** a usage notice (commercial use, redistribution for profit, and bulk-account operation are prohibited).
**Personal learning, research, and self-use**, as well as non-profit sharing, are not restricted by this notice. The third-party copyright notices retained in LICENSE are part of the license requirement and must not be removed.

## Directory structure

```
OAA-server/
├── Cargo.toml               # cargo virtual workspace root (members = ["server"] + release profile)
├── Cargo.lock               # pinned dependency versions
├── LICENSE                  # MIT + usage notice
├── Dockerfile               # compiles only the server crate; panel uses ui/ artifacts
├── docker-compose.yml       # simple deployment (./data bind mount)
├── server/                  # gateway body (all Rust source: multi-provider adapters, account pool, panel backend)
│   └── src/bin/oaa-server.rs# headless binary entry point
├── ui/                      # panel frontend **build artifacts** (Dockerfile COPYs them directly; npm is not run at build time)
└── deploy/docker/           # hardened compose + .env.example
```

This directory **does not contain** the desktop shell or frontend source — only the minimal set needed to run the server.

## Requirements

| Item | Requirement |
|---|---|
| Rust | ≥ 1.88 (determined by `rusqlite 0.40` → `libsqlite3-sys 0.38`) |
| C toolchain | Required (`rusqlite` uses `bundled`, compiling SQLite's C source) |
| Docker | Recommended (image build bundles the full toolchain; host needs no Rust installed) |

## Build & run (recommended: Docker)

```bash
# Simple version
docker compose up -d --build

# Hardened version (read-only root filesystem + cap_drop ALL + binds 127.0.0.1 by default + named volume)
cp deploy/docker/.env.example deploy/docker/.env
docker compose -f deploy/docker/compose.yaml up -d --build
```

First time: open `http://<host>:3065/` in a browser → register an admin → create a Key on the "Gateway Key" page
(**before any Key is created, `/v1` is fail-closed and refuses to forward**).

```bash
curl http://127.0.0.1:3065/health       # {"status":"ok"}
```

Local (non-container) build:

```bash
cargo build --release -p oaa-server     # artifact: target/release/oaa-server
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OAA_HOST` | `0.0.0.0` | Listen address |
| `OAA_PROXY_PORT` | `3065` | Listen port |
| `OAA_PANEL_PORT` | empty | Panel split-port (once set, the panel listens independently; main port keeps only `/v1`) |
| `OAA_PROXY_HOME` | `~/.oaa` (inside container `/data`) | Config / data directory |
| `OAA_UI_DIR` | empty | Panel static directory (inside container `/app/ui`) |
| `OAA_ADMIN_USER` / `OAA_ADMIN_PASSWORD` | empty | Pre-provisioned admin (password in plaintext, hashed at startup); leave empty to use panel registration |
| `OAA_ALLOW_NO_KEY` | empty | Set `1` to disable `/v1`'s fail-closed — **LAN-only** |
| `OAA_CAPTCHA_ENABLED` | `1` | Login-page human-verification toggle |

## Data & endpoints

| Item | Value |
|---|---|
| Data directory | `~/.oaa/` (inside container `/data`), SQLite db `oaa.db` |
| Panel | `/` (self-hosted `OAA_UI_DIR`) |
| OpenAI endpoint | `/v1` (Chat / Responses / Messages) |
| Health probe | `/health` |

## Panel

`ui/` are build artifacts; this directory does not contain frontend source. To change panel styles/copy you must prepare a separate frontend project, rebuild, and overwrite the `ui/` artifacts.

## Verification status

| Item | Result |
|---|---|
| manifest / workspace structure | ✅ `cargo metadata --offline --no-deps` passes (package `oaa-server`, targets = `oaa_server` + `oaa-server`) |
| dependency resolution / compilation | ⚠️ not verified on this machine (missing MSVC linker and C toolchain); rely on the Docker build |
