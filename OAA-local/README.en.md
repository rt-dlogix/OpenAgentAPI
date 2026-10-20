# OAA-local

PC-side credential harvesting: reads the **login state** of each platform's local clients (read-only decrypt), saves it to a local account store, and pushes it to OAA-server.

## Usage

Requires **Node.js ≥ 20** (zero third-party runtime dependencies):

```bash
node bin/harvest.js detect              # Probe this machine's client install / login environment
node bin/harvest.js scan --save         # Harvest locally logged-in accounts and persist
node bin/harvest.js list                # View the local account store (tokens masked)
node bin/harvest.js push --dry-run      # Dry run: only shows the request body that would be sent
node bin/harvest.js push --key <gatewayKey> # Push to OAA-server
node bin/harvest.js export              # Export to a file selectable by the panel's "Import Accounts"
```

For the full command list and options see [USAGE.md](../USAGE.md) at the repo root;
for deployment and scheduled tasks see [DEPLOY.md](../DEPLOY.md).

## Directory

```
OAA-local/
├── bin/harvest.js      # CLI entry: detect / scan / list / push
├── src/
│   ├── detect/         # Per-platform local login-state reading & decryption (read-only)
│   ├── push/oaa.js     # Push to OAA-server (POST /api/accounts)
│   ├── store.js        # Local account store (0600 + atomic write)
│   ├── accounts.js     # Account de-duplication & merge
│   ├── scan.js         # Harvest orchestration
│   └── constants.js · jwt.js · winProc.js
└── package.json
```

## Data location

| Item | Value |
|---|---|
| Data directory | `$OAA_HOME` (default `~/.oaa`) |
| Account store | `<data dir>/accounts.json` (0600 permissions, contains **plaintext** credentials) |

## License

- The parts of this directory **originated by the copyright holder**: **proprietary license, All Rights Reserved** — see [LICENSE](./LICENSE).
- Parts derived from third parties remain bound by their original licenses; the notice and scope are in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

> The copyright-holder name in `LICENSE` is a placeholder — fill in your name / entity.

## Notes

- This tool is **read-only on the local login state**: it doesn't log in for you, doesn't refresh credentials, and does no browser cookie capture.
- The newer **WorkBuddy** client encrypts fields such as tokens at rest (a `$wbEncrypted` envelope); at harvest time the **WorkBuddy client must stay running**: the decryption key exists only in its process memory, retrieved on Windows via the OS-bundled PowerShell read-only scan (`src/detect/wb-memscan.ps1`).
- The local account store holds **plaintext tokens**; don't commit them to a public repo, upload them to cloud storage, or share them.
