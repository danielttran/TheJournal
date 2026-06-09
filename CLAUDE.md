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

0. **Sessions are HMAC-signed**, not a bare id. The cookie is a
   `userId.expiry.signature` token (`src/lib/session.ts`), signed with a
   key derived from `JOURNAL_DB_SECRET`. `getUserIdFromRequest` /
   `authedHandler` and the server pages verify the signature — a client
   cannot forge identity by editing the cookie. (Pre-audit this was a
   plaintext `userId` integer = trivial impersonation.)
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
5. **Restore is lossless + replace-not-duplicate** — `backup/import`
   round-trips every user-owned table (incl. per-category
   `PasswordWrappedKey`, Template/Topic/Snippet/Habit/UserSetting) with
   FK remapping, deletes the user's old rows first, and **validates the
   file is a real journal before the destructive delete**. A drift guard
   (`tests/features/backup-import-coverage.test.ts`) fails CI if a new
   user-owned table isn't taught to the importer. Untrusted attachment
   blobs are served `nosniff` + strict CSP, with svg/html forced to
   download (`api/attachment/[id]`).

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
- **J8 gap closure + audit (2026-05-29)**: in-entry Find bar with
  highlight/cycle (`inEntryFind.ts` + `SearchHighlight.ts` PM-decoration
  extension + `FindBar.tsx`), side-by-side split orientation, styled
  hyperlink dialog (`linkUrl.ts`). See `docs/j8-gap-analysis.md` top section.
- **Dialog UX + remaining gaps (2026-05-29)**: `useEscapeToClose` across
  modals, reusable `PromptModal` replacing window.prompt, in-app Print
  Preview, and the **hierarchical category tree** (`categoryTree.ts` +
  `CategoryTree.tsx`, `ParentCategoryID` column, parent dropdown in
  Category Properties, vertical-tabs tree view).
- **Pre-ship security audit (2026-05-30)**: closed three confirmed
  ship-blockers. (1) **Signed sessions** (`session.ts`) — replaced the
  forgeable plaintext `userId` cookie. (2+3) **Lossless restore** —
  `backup/import` was dropping 9/16 tables and the per-category wrapped
  EEK (locked entries became undecryptable); now full-fidelity with
  FK remap + pre-delete validation + a coverage guard test. (4)
  **Attachment XSS hardening** — `nosniff`, per-route CSP, svg/html forced
  to download; baseline security headers in `next.config.ts`. Known
  not-yet-fixed (documented in audit): login/unlock rate limiting,
  `NODE_ENV`-independent secret guard.
- **Stability/perf audit (2026-06-03c)**: fixed a crypto key-cache aliasing bug
  (`getCategoryKey` returned the live EEK buffer a concurrent evict could zero
  mid-encrypt — now returns a copy + 12h absolute TTL cap), the category-reorder
  route's unawaited `stmt.run` (silent write loss), the `entry/move` cycle-guard
  TOCTOU (now transactional), and serialized `backup/import` (concurrent imports
  collided on the `imported` ATTACH alias). Closed the **multi-tenant admin
  gate** (`src/lib/admin.ts`, bootstrap admin = lowest UserID): `users` CRUD +
  whole-DB `backup/export` are now admin-only (no-op for single-user). Editor:
  guarded the entry-metadata side-fetch against fast-switch races, made the
  unload save beacon-first + storage writes try/catch (no data loss on quota),
  routed autosave through a ref (no stale editor). Sidebar: memoized grouping +
  calendar day-bucketing + debounced tag refetch.
- **J8 parity round 4 (2026-06-03)**: closed the three biggest buildable
  deferred gaps. (1) **Drag-to-nest categories** — the vertical category tree
  now accepts drag-to-reparent (drop on a row = child; drop on the root zone =
  top level), reusing the cycle-guarded reparent route with optimistic
  revert-on-reject (`resolveCategoryDrop` in `categoryTree.ts`). (2)
  **Electron window-state persistence + system tray** — window size/position +
  maximized state survive restarts (`windowState.js`/`.d.ts` clamps recovery
  onto a visible display); a guarded tray + `minimizeToTray` option keep the
  app running on close. Also fixed the missing `public/favicon.ico` that
  `electron-builder.yml` referenced. (3) **Customizable editor toolbar** —
  nine named toolbar groups can be shown/hidden from Settings (pure
  `toolbarConfig.ts`; defaults to all-visible). See `docs/j8-gap-analysis.md`.

- **J8 parity round 5 (2026-06-03b)**: closed the remaining deferred items
  outside the import carve-out. (1) **Customizable menus** — hide menu items
  from Settings ▸ Menus; pure `menuCustomization.js`/`.d.ts` filters the shared
  spec, web `MenuBar` re-reads live, Electron native menu rebuilds on
  `settings.menuHiddenItems`. (2) **Inline (block-level) topic tagging** — new
  `InlineTag` TipTap mark + pure `inlineTag.ts`; **Topic ▸ Tag Selection with
  Topic…** + context menu. (3) **Cross-platform Electron targets** — mac
  (dmg/zip) + linux (AppImage/deb) in `electron-builder.yml` + `package:mac`/
  `package:linux`; `release.yml` is a 3-OS matrix gated by one verify job. Also
  fixed an asar `files` packaging bug (round-4 libs `windowState.js` +
  `menuCustomization.js` weren't whitelisted → would crash the packaged app).

- **Parity audit round (2026-06-09)**: fixed the SearchPanel scope-resync
  no-op + the PromptHost concurrent-prompt hang; closed verified J8 gaps
  (Change Entry Date/Time with editor version-sync, spell-check toggle,
  Ctrl+Alt+J global hotkey + tray New Entry); wired four stranded features
  (Favorites panel, Habit Tracker panel, web scheduled backups with verified
  snapshots + admin gate + hourly sweep started from db.ts — NOT
  instrumentation.ts, whose file trace ignores outputFileTracingExcludes and
  shipped journal.tjdb into the bundle — and min-words-per-entry); wired the
  stats year heatmap; removed superseded orphans (api/autolink/outline/
  hourActivity libs + route). To-do carry-forward confirmed NOT a J8 feature
  (davidrm.com) — not built.

## What's intentionally NOT done

- **Importers (Outlook / Penzu / Diaro / WordPress) + external Category Sync**:
  the goal's only carve-out ("bridge all gaps except importing from other
  apps"). Category Sync is the same class — sync/import from an external service.
- **macOS code signing / notarization**: a credential, not code. `release.yml`
  consumes `CSC_LINK`/`CSC_KEY_PASSWORD` if the repo provides them; the mac +
  linux *builds* are otherwise configured. (The mac/linux installers cannot be
  built or run inside this Linux CI/dev container, only on their own runners.)
- **Toolbar group REORDER** (show/hide IS offered): the toolbar interleaves
  contextual controls (image-resize, plugin buttons, flex spacer) whose
  left-to-right position is meaningful, so only visibility is configurable.

## Running tests / type checks

```bash
npx tsc --noEmit
npx vitest run
# Baseline: 982 tests as of the last commit.
```

When tests need a DB, use the pattern in any existing
`tests/features/*-*.test.ts`: `new DBManager('/tmp/test-foo.tjdb')` +
`unlock('deadbeef'.repeat(8))`. Clean up in `afterAll`.
