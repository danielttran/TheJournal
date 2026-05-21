# TheJournal — Project Memory

Quick-orientation document for any future Claude session opened against
this repo. Aim: a working mental model in ≤2 minutes.

## What this project is

A self-hostable journaling app with feature parity to DavidRM's
"The Journal 8". Single codebase serves two targets:

- **Electron** desktop (Windows NSIS), embeds Next.js via `next()`.
- **Web** self-hosted, Next.js standalone bundle behind Caddy/nginx.

## Stack

| Layer | Tech |
|---|---|
| UI | Next.js 16 (App Router) + React 19 + TipTap |
| State | Server actions + REST under `/api/*` |
| DB | SQLite via `@journeyapps/sqlcipher` (AES-256 at rest) |
| Auth | Cookie sessions + Argon2id password hashes |
| Per-category lock | Envelope encryption: scrypt-derived KEK wraps AES-GCM EEK; EEK encrypts entry HTML/JSON inline |
| Tests | vitest (Node env), `tests/features/*.test.ts` |

## Repo layout you actually care about

```
src/
├── app/
│   ├── api/*              REST routes (authedHandler from lib/route-helpers)
│   ├── journal/[id]/      The editor page
│   └── actions.ts         Server actions (login, register, logout)
├── components/
│   ├── journal/Editor.tsx The 1450-line TipTap shell. Pure helpers
│   │                      live in src/lib/* — don't add new logic here.
│   ├── SettingsModal.tsx  Settings UI; hosts Keybindings + Plugins sections
│   └── PluginsSection.tsx Plugin install/uninstall UI (folder picker)
├── electron/
│   ├── main.js            Electron entry. Sets JOURNAL_PLUGINS_DIR +
│   │                      JOURNAL_DB_PATH before spawning Next.js.
│   ├── preload.js         contextBridge surface for the renderer.
│   └── settings.js        [userData]/settings.json wrapper (atomic write).
└── lib/                   Pure helpers — no React, no DOM, all testable.
    ├── auth.ts            Argon2id + getAppDbKey (refuses dev secret in prod)
    ├── db.ts              DBManager singleton + lazy-unlock proxy
    ├── categoryCrypto.ts  Per-category envelope encryption
    ├── categoryKeyCache.ts In-memory EEK cache with sliding TTL + zeroing
    ├── entryEncryption.ts decryptEntryContent + maybeEncryptForCategory
    ├── commands.ts        Keybinding registry (parseBinding, COMMANDS list)
    ├── pluginApi.ts       window.TheJournalAPI surface
    ├── serverPlugins.ts   Web-side plugin install/list/uninstall
    └── ...                ~40 other focused modules

plugins/
└── sentence-diagrammer/   Bundled example plugin (DavidRM-style diagrams)

scripts/
├── install-sqlite.js      Rebuilds SQLCipher against Electron ABI
├── stage-standalone.js    Copies .next/static + public + plugins into
│                          .next/standalone/ after next build
├── build-web.bat          Windows: full web build pipeline
├── build-electron.bat     Windows: full Electron installer pipeline
└── build-all.bat          Windows: both

deploy/
├── Caddyfile.example      Reverse proxy template with auto-HTTPS
└── README.md              End-to-end self-host runbook (systemd + Caddy)

docs/
├── env-vars.md            Every JOURNAL_* env var, what it controls
├── backup-runbook.md      WAL-aware backup workflows
├── release.md             Maintainer tag-based release flow
└── plugins.md             Plugin authoring guide
```

## Conventions

- **Tests-first.** New behaviour gets a test in `tests/features/*.test.ts`
  before the implementation lands. Vitest config excludes `.next/**` and
  `node_modules/**`.
- **Pure libs, thin routes/components.** API routes are auth + validate +
  delegate to `src/lib/*`. Tests hit the lib directly via a `DBManager`
  pointed at a temp `.tjdb`. Don't add logic to React components.
- **No emojis in code or commits** unless the user asks. Same for
  multi-paragraph docstrings.
- **Comments explain WHY, not WHAT.** Never narrate well-named functions.
- **Cross-tenant scoping.** Every DB query filters by `UserID` —
  enforced even when the route uses `authedHandler`.
- **No new dependencies unless needed.** Reuse what's installed:
  - `@dnd-kit/*` for drag-and-drop.
  - `lucide-react` for icons.
  - `next-themes` for theme persistence.
  - `argon2` for password hashing.
  - `@journeyapps/sqlcipher` for the encrypted DB.
  - `electron-updater` for auto-update.

## Critical security model

1. **At-rest encryption** is per-database via SQLCipher; the key is
   derived from `JOURNAL_DB_SECRET`. **Production refuses to start with
   the dev default** — see `src/lib/auth.ts` `checkDbSecret()`.
2. **Per-category passwords** add a second envelope. A random EEK is
   wrapped by a scrypt-derived KEK; the EEK encrypts entry HTML/JSON
   inline with AES-256-GCM (prefix `ENC1:`). `categoryKeyCache.ts`
   holds plaintext EEKs in-process with a sliding TTL and zeros the
   buffer on eviction.
3. **All read routes that surface entry content** (`/api/entry/[id]`,
   `/api/entry/[id]/export`, `/api/category/[id]/export`,
   `/api/entry/[id]/print`, `/api/report`, `/api/search`) call
   `loadEntryHtmlForRead` which returns null when the category is
   locked and the EEK isn't cached. Routes 423 the request rather than
   leaking ciphertext.
4. **`transformCategoryEntries` is atomic** — wraps SELECT-loop-UPDATE in
   `dbm.transaction()`. If decryption throws mid-loop, every UPDATE
   rolls back. Without this, a single corrupt entry during password
   removal would silently lose data.

## Build pipeline

| Target | Command | Output |
|---|---|---|
| Web (Linux/Mac) | `npm run build` | `.next/standalone/` (run with `node server.js`) |
| Web (Windows) | `scripts\build-web.bat` | same |
| Electron installer (Linux/Mac) | `npm run build:installer` | `dist/TheJournal Setup vX.Y.Z.exe` |
| Electron installer (Windows) | `scripts\build-electron.bat` | same |
| Both (Windows) | `scripts\build-all.bat` | both |

`npm run build` chains `next build` → `node scripts/stage-standalone.js`
which copies `.next/static`, `public/`, and `plugins/` next to the
standalone `server.js`. `outputFileTracingExcludes` in `next.config.ts`
prevents the live `journal.tjdb` and `src/`/`tests/`/`screenshot/` from
shipping to production.

## Plugin system

- **Both modes** load plugins from a single folder. Electron sets
  `JOURNAL_PLUGINS_DIR=[userData]/plugins` at startup so its embedded
  Next.js server and the native Plugins menu hit the same path.
- Each plugin = a folder with `manifest.json` + `main.js`.
- The renderer calls `new Function(plugin.scriptContent)()` before the
  editor mounts. Plugins register via `window.TheJournalAPI.registerTiptapExtension(...)`
  / `.registerToolbarButton(...)`.
- Trust model: "trusted local scripts". The operator (self-host) is the
  same person uploading plugins.

## CI / release

- `.github/workflows/ci.yml` runs `tsc --noEmit + vitest run + a
  standalone-build smoke test` on every PR (Ubuntu, Node 22).
- `.github/workflows/release.yml` triggers on `v*.*.*` tag push, runs
  on windows-latest, builds the NSIS installer, uploads it + `latest.yml`
  to the matching GitHub Release. `electron-updater` reads `latest.yml`
  to deliver in-app updates.

## Common gotchas

- **libssl1.1**: SQLCipher's prebuilt binary needs OpenSSL 1.1.
  Ubuntu 24.04 / Debian 12 don't ship it — install the `.deb` from
  `security.ubuntu.com`. CI does this automatically.
- **`process.env.NODE_ENV` is readonly in tests**: cast to
  `process.env as Record<string, string|undefined>` when mutating.
- **`Notification.requestPermission()` in a useEffect** can silently fail
  without a user gesture. `ReminderTicker` early-exits when permission
  is denied so the poll loop doesn't waste DB calls.
- **`output: 'standalone'`** in Next.js 16 greedily copies the project
  root unless `outputFileTracingExcludes` is set — past audit fix.

## Recent work map (for context-loading)

- **M1–M9**: DavidRM-parity feature gaps. Smartbook UI, per-category
  passwords, hierarchical topics, regex search, video uploads, command
  registry / custom keybindings, Help menu.
- **Audit rounds 1–3**: closed ciphertext leaks in read routes, double-
  fire on Ctrl+Z, atomic password rotation, atomic
  `transformCategoryEntries`.
- **Plugin web support**: `/api/plugins` + `PluginsSection.tsx`.
- **Phases 1–4 (deploy)**: `/api/health`, env-var ref, backup runbook,
  standalone build, Caddy, electron-updater, GitHub Actions.
- **Production-readiness audit**: standalone-bundle data leak fix,
  `JOURNAL_DB_SECRET` startup guard, `start:web` cwd fix.

## What's intentionally NOT done

- Hierarchical CATEGORY tree (only Entry hierarchy works) — TabBar is
  horizontal; nesting needs a vertical redesign.
- Outlook integration, Penzu/Diaro/WordPress importers,
  customizable Electron menus, drag-to-reorder toolbar, block-level
  tagging — explicitly deferred per user choice.
- macOS / Linux Electron targets, code signing, auto-minimize-idle.

## Running tests / type checks

```bash
npx tsc --noEmit
npx vitest run
# Baseline: 729 tests as of the last commit.
```

When tests need a DB, use the pattern in any existing
`tests/features/*-*.test.ts`: `new DBManager('/tmp/test-foo.tjdb')` +
`unlock('deadbeef'.repeat(8))`. Clean up in `afterAll`.
