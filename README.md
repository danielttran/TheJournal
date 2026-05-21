# TheJournal

A cross-platform journaling and note-taking application built with Next.js and Electron. Features both journal-style date-based entries and notebook-style hierarchical pages.

## Screenshots

![Secure Login](screenshot/create%20account.png)
*Privacy-first authentication with local-only storage.*

![Notebook Mode](screenshot/notebook.png)
*Organize your thoughts with hierarchical pages and sections.*

## Features

- 📅 **Journal Mode** - Date-based entries with calendar navigation
- 📓 **Notebook Mode** - Hierarchical pages and sections with drag-and-drop
- 🔒 **End-to-End Local Encryption** - Full database encryption via SQLCipher (AES-256)
- 🔑 **Secure Key Derivation** - Argon2id master key derivation for maximum security
- 🎨 **Rich Text Editor** - Full formatting with TipTap
- 🌙 **Dark/Light Themes** - System-aware with manual toggle
- 💾 **Auto-Save** - Content saved automatically with crash recovery
- 📦 **Import/Export** - Encrypted backups of your entire journal
- 🔍 **Search** - Full-text search across titles and content with advanced filters
- 🪟 **Split View** - Side-by-side editor panes for multi-entry editing
- **Local Plugins** - Trusted local plugins can register custom TipTap extensions and editor NodeViews

## Quick start

```bash
git clone https://github.com/danielttran/TheJournal.git
cd TheJournal
npm install
npm run dev                  # web at http://localhost:3000
# — or —
npm run dev:electron         # Electron desktop window
```

Node **22+** required. The SQLCipher native binding is built for napi-v6;
older Node versions fail to load it.

## Build & deploy

TheJournal has two deployable targets that share the same codebase:

| Target | What you ship | Who runs it |
|---|---|---|
| **Web** | `.next/standalone/` directory (~80 MB) | A Linux server you control |
| **Electron** | `TheJournal Setup vX.Y.Z.exe` NSIS installer (~150 MB) | Each end-user on Windows |

The web target uses Next.js's standalone output (a self-contained
`server.js` + traced `node_modules`). Electron embeds the same Next.js
build but launches it programmatically via `next()`.

### Command reference

| Command | What it does | Output |
|---|---|---|
| `npm run dev` | Hot-reload dev server (web) | `http://localhost:3000` |
| `npm run dev:electron` | Hot-reload dev server + Electron window | desktop window |
| `npm run build` | Production web build + stage assets | `.next/standalone/` |
| `npm run start:web` | Run the staged standalone bundle | `http://localhost:3000` (or `$PORT`) |
| `npm run build:installer` | Build the Windows NSIS installer | `dist/TheJournal Setup vX.Y.Z.exe` |
| `npm test` | Run the vitest suite (~750 tests) | — |

### Web app — production deployment

**1. Build the standalone bundle on a Linux box.**

```bash
git clone https://github.com/danielttran/TheJournal.git
cd TheJournal
npm ci
npm run build
```

`npm run build` chains `next build` → `node scripts/stage-standalone.js`.
The staging script copies `.next/static/`, `public/`, and `plugins/`
next to `.next/standalone/server.js` so the bundle is self-contained.
After it finishes you can `rm -rf` everything except `.next/standalone/`,
`package.json`, and the env file (below).

**2. Set the required env vars.**

```bash
JOURNAL_DB_SECRET=$(openssl rand -hex 32)   # CRITICAL — back up separately
JOURNAL_DB_PATH=/var/lib/thejournal/data/journal.tjdb
JOURNAL_PLUGINS_DIR=/var/lib/thejournal/data/plugins
NODE_ENV=production
PORT=3000
```

Lose `JOURNAL_DB_SECRET` and the database is unrecoverable — every entry
is encrypted with a key derived from it. Production **refuses to start**
on the dev default secret (see `src/lib/auth.ts` `checkDbSecret`).

**3. Run the server.**

```bash
cd .next/standalone
node server.js
# or: npm run start:web  (from the repo root)
```

The standalone `server.js` listens on `$PORT` (default 3000) and serves
the full app. There is no `next` CLI involved at runtime — it's just a
Node process.

**4. Front it with Caddy for HTTPS.**

A working `Caddyfile` is in [`deploy/Caddyfile.example`](./deploy/Caddyfile.example).
Edit the hostname and reload:

```Caddyfile
your.hostname.com {
  reverse_proxy localhost:3000
  request_body { max_size 250MB }     # matches Next.js bodySizeLimit for video uploads
}
```

Caddy auto-provisions Let's Encrypt certs on first request.

**5. Verify.**

```bash
curl -s https://your.hostname.com/api/health
# {"status":"ok","dbUnlocked":true,"uptimeMs":1234,"version":"0.1.0"}
```

For the **full step-by-step runbook** including a hardened systemd unit,
backup workflow, libssl1.1 troubleshooting on Ubuntu 24.04, and
zero-downtime upgrades, see [`deploy/README.md`](./deploy/README.md).

### Electron desktop app — packaging the installer

The Electron target ships a single `.exe` that bundles Chromium, Node,
the standalone Next.js bundle, and the SQLCipher native binding compiled
against Electron's ABI.

**1. Build.**

```bash
npm ci
npm run build:installer
```

This chains:
- `scripts/install-sqlite.js` — rebuilds `@journeyapps/sqlcipher` for
  Electron's napi version (the regular Node binding can't load into the
  Electron renderer).
- `electron-builder` — packages the app per `electron-builder.yml`.

**2. Output.**

`dist/TheJournal Setup vX.Y.Z.exe` is the installer. On install it
unpacks to `%LOCALAPPDATA%\Programs\TheJournal\` and creates the user
data folder at `%APPDATA%\TheJournal\` (or `%APPDATA%\temp-app\` for
unpackaged dev builds).

**3. Cross-build notes.**

Electron-builder can cross-build Windows installers from macOS/Linux,
but **the SQLCipher native binding must match the target platform's
ABI**. The repo's setup builds Windows-only on a Windows runner
(`windows-latest`) — see `.github/workflows/release.yml`. Building
Windows targets from Linux requires Wine + cross-compiled libssl1.1,
which is fragile; just use a Windows VM or the GitHub Actions runner.

### Electron desktop app — releases & auto-update

Tag-driven release flow. Bumping a `vX.Y.Z` tag triggers
`.github/workflows/release.yml` to build the installer on a
`windows-latest` runner and publish it to a GitHub Release with a
`latest.yml` manifest. Running TheJournal installations check
`autoUpdater.checkForUpdatesAndNotify()` 60 s after launch and every
6 h thereafter; when a newer `latest.yml` is found, the new installer
downloads in the background and prompts the user to restart.

See [`docs/release.md`](./docs/release.md) for the full maintainer
workflow, hot-fix process, and rollback procedure.

### Windows convenience scripts

Three `.bat` wrappers in `scripts/` cover the common build flows on
Windows. Each verifies Node version, runs `npm ci`, executes the build,
and prints output paths.

```cmd
scripts\build-web.bat        REM Web standalone bundle only
scripts\build-electron.bat   REM Electron NSIS installer only
scripts\build-all.bat        REM Both
```

They exit non-zero on any failure — safe to chain in CI.

### Reference docs

- [`deploy/README.md`](./deploy/README.md) — full web self-host runbook (systemd + Caddy + backup + upgrades).
- [`docs/env-vars.md`](./docs/env-vars.md) — every `JOURNAL_*` env var, defaults, scope (server / electron / both), what's required in production.
- [`docs/backup-runbook.md`](./docs/backup-runbook.md) — WAL-aware backup workflow (rsync / S3 / B2) + nightly cron snippet.
- [`docs/release.md`](./docs/release.md) — maintainer release flow (tag → CI → installer → auto-update).
- [`docs/plugins.md`](./docs/plugins.md) — plugin authoring guide + bundled examples.

## Search

Press **Ctrl+F** anywhere in the journal view to open the search panel, or use the **View → Search** menu item, or right-click in the editor.

### Simple search
Type any text and results appear as you type (350 ms debounce). Click a result to navigate directly to that entry.

### Advanced search
Click **Advanced** in the search panel to reveal additional filters:

| Filter | Options |
|--------|---------|
| Search in | Titles only · Content only · Both |
| Scope | Current notebook/journal · All |
| Date range | From / To date pickers |
| Entry type | All · Journal · Notebook |
| Match case | Exact case matching |
| Whole word | Word-boundary matching |

Results show a snippet centred on the first match with the matching text highlighted. Pagination loads 30 results at a time.

## Local Plugins

Both the Electron desktop app **and** the self-hosted web build load
trusted local plugins from a single plugins folder.

- **Electron**: use **Plugins → Install Plugin…** to pick a plugin
  folder, or **Plugins → Open Plugins Folder** to manage them manually.
  On first launch the bundled plugins are seeded into
  `%APPDATA%\TheJournal\plugins\` automatically.
- **Web**: use **Settings → Plugins → Install plugin…** (the browser
  POSTs the folder to `/api/plugins`), or drop folders directly into
  `$JOURNAL_PLUGINS_DIR` on the server.

A plugin folder must contain:

```text
my-plugin/
  manifest.json
  main.js
```

Plugins execute before the TipTap editor mounts and can register
extensions and toolbar buttons:

```js
window.TheJournalAPI.registerTiptapExtension(extension);
window.TheJournalAPI.registerToolbarButton({ id, label, icon, onClick });
```

Two example plugins ship in `plugins/`:

- **`plugins/sentence-diagrammer`** — interactive Reed-Kellogg sentence
  diagrams with draggable word tokens.
- **`plugins/drawio`** — embed editable [draw.io](https://embed.diagrams.net)
  diagrams inline. Click to open a full-screen editor; the diagram XML
  and an SVG preview are stored on the node, so viewing is fully offline
  (editing needs diagrams.net reachable).

See [docs/plugins.md](docs/plugins.md) for the full authoring guide.

## Testing

The project uses [Vitest](https://vitest.dev/) for stress and integration tests that exercise the database layer directly (no HTTP).

### Run all tests

```bash
npm test
```

### Watch mode (re-runs on file save)

```bash
npm run test:watch
```

### Test structure

```
tests/
├── features/
│   └── *.test.ts          # ~750 unit/integration tests
└── stress/
    └── db.stress.test.ts  # ~20 high-concurrency stress tests
```

Each test run creates an isolated temporary database, seeds it with a test user, and deletes all three SQLite files (`.tjdb`, `.tjdb-shm`, `.tjdb-wal`) on teardown.

### What the stress tests cover

| Suite | Tests | Scenario |
|-------|-------|----------|
| Concurrent by-date creation | 2 | 20 simultaneous requests for the same date → exactly 1 entry created (dedup) |
| Optimistic locking | 2 | 10 concurrent writes to version 1 → 1 succeeds, 9 get 409 conflict |
| Sequential saves | 1 | 50 sequential saves increment the version counter correctly |
| Recursive delete — deep | 1 | 100-level chain deleted atomically in < 2 s, no orphaned rows |
| Recursive delete — wide | 1 | Root with 500 direct children deleted in < 3 s, content cleaned up |
| Move guards | 4 | Self-parent rejected, cycle (A→B→C→A) rejected, valid moves pass |
| ViewSettings concurrency | 1 | 20 concurrent JSON merges → all 20 keys present in final result |
| AsyncMutex exclusion | 1 | 30 concurrent counter increments → no lost updates |
| Large dataset | 1 | 1 000 entries inserted, correct subset retrieved |
| Cascade delete integrity | 2 | Deleting entry removes `EntryContent`; partial chain delete leaves no orphans |
| Rapid create/delete | 1 | 200 create+delete ops in rapid succession, DB left clean |
| Edge cases | 3 | Non-existent delete, same date across two categories, version conflict skips content |

### Prerequisites for tests

The database layer uses `@journeyapps/sqlcipher`, a native module linked against **OpenSSL 1.1**. On Ubuntu 22.04+ (which ships OpenSSL 3) you need to install the compatibility library first:

```bash
# Download and install libssl1.1 (one-time, system-wide)
wget http://security.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb
sudo dpkg -i libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb

# Re-download the pre-built binary so it links against the installed library
cd node_modules/@journeyapps/sqlcipher
npx node-pre-gyp install --update-binary
cd ../../..

# Verify
node -e "require('@journeyapps/sqlcipher')" && echo "OK"
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # REST API endpoints
│   │   ├── backup/         # Import/Export DB
│   │   ├── category/       # Notebook/Journal CRUD
│   │   ├── entry/          # Entry CRUD, by-date, dates
│   │   ├── search/         # Full-text search endpoint
│   │   └── health/         # Health check
│   ├── dashboard/          # Dashboard page
│   ├── journal/[categoryId]/ # Journal/Notebook view
│   ├── login/              # Authentication
│   ├── globals.css         # Theme variables & styles
│   ├── layout.tsx          # Root layout with providers
│   └── providers.tsx       # Theme & Electron IPC setup
│
├── components/
│   ├── journal/
│   │   ├── Editor.tsx      # Rich text editor with auto-save, Ctrl+F shortcut
│   │   ├── SplitEditor.tsx # Side-by-side dual-pane editor
│   │   ├── JournalView.tsx # Top-level view, owns search state
│   │   ├── SearchPanel.tsx # Full-text search overlay (simple + advanced)
│   │   ├── EntryGrid.tsx   # Grid view for entries
│   │   ├── Sidebar.tsx     # Navigation (calendar/tree)
│   │   └── TabBar.tsx      # Tab management & menus
│   ├── dashboard/
│   │   └── CategoryCard.tsx
│   └── ThemeToggle.tsx     # Theme switch button
│
├── hooks/                  # Reusable React hooks
│   ├── useClickOutside.ts  # Detect clicks outside element
│   ├── useElectronIPC.ts   # Safe IPC event subscription
│   └── index.ts            # Barrel export
│
├── lib/                    # Pure helpers — no React, no DOM, all testable
│   ├── db.ts               # Encrypted SQLite connection (SQLCipher)
│   ├── auth.ts             # Argon2id key derivation & DB-secret guard
│   ├── route-helpers.ts    # authedHandler + getUserIdFromRequest
│   ├── categoryCrypto.ts   # Per-category envelope encryption
│   ├── serverPlugins.ts    # Web-side plugin install/list/uninstall
│   └── types.ts            # TypeScript interfaces
│
└── electron/               # Electron main process
    ├── main.js             # Window creation, menu, plugin seeding, auto-update
    ├── preload.js          # Context bridge API
    └── settings.js         # User settings persistence

plugins/                    # Bundled example plugins
├── sentence-diagrammer/    # Reed-Kellogg sentence diagrams
└── drawio/                 # Inline draw.io diagram embeds

deploy/                     # Web self-host runbook + Caddyfile
docs/                       # env-vars, backup, release, plugins guides

tests/
├── features/               # ~750 unit/integration tests (DB layer, no HTTP)
└── stress/                 # ~20 high-concurrency stress tests
```

## Component Responsibilities

| Component | Description |
|-----------|-------------|
| **TabBar** | Category tabs, drag-to-reorder, File/View menus |
| **Sidebar** | Journal calendar or notebook tree navigation |
| **JournalView** | Orchestrates editor, split view, and search overlay |
| **Editor** | TipTap-based rich text with auto-save, recovery, and Ctrl+F |
| **SplitEditor** | Dual-pane editor with independent entry loading and optimistic save |
| **SearchPanel** | Full-text search overlay with live results and advanced filters |
| **EntryGrid** | Grid display for browsing past entries |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search` | Full-text search across titles and content |
| GET/POST | `/api/entry` | List / create entries |
| GET/PUT/DELETE | `/api/entry/[id]` | Read / update / delete a single entry |
| POST | `/api/entry/move` | Move entry to a new parent (cycle-safe) |
| GET | `/api/entry/by-date` | Fetch or create today's journal entry |
| GET/PUT/DELETE | `/api/category/[id]` | Category management |
| GET/POST | `/api/backup` | Export / import encrypted backup |

### Search API

```
GET /api/search?q=hello+world
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `q` | — | Search terms (required) |
| `categoryId` | — | Restrict to one notebook/journal |
| `dateFrom` | — | ISO date lower bound |
| `dateTo` | — | ISO date upper bound |
| `searchIn` | `both` | `title` · `content` · `both` |
| `entryType` | `all` | `all` · `journal` · `notebook` |
| `matchCase` | `false` | Case-sensitive matching |
| `wholeWord` | `false` | Whole-word matching |
| `limit` | `30` | Results per page |
| `offset` | `0` | Pagination offset |

Response:
```json
{
  "results": [
    {
      "EntryID": 42,
      "Title": "My Entry",
      "snippet": "…matched context…",
      "CategoryID": 1,
      "CategoryName": "My Journal",
      "EntryDate": "2024-01-15"
    }
  ],
  "total": 120,
  "hasMore": true
}
```

## Database Schema

- **User** - Authentication
- **Category** - Journals and Notebooks
- **Entry** - Individual pages/journal entries (with `Version` field for optimistic locking)
- **EntryContent** - HTML body of each entry (cascade-deleted with Entry)

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Editor**: @tiptap/react (+ TipTap extensions)
- **Styling**: Tailwind CSS with CSS variables
- **Database**: @journeyapps/sqlcipher (AES-256 Encrypted)
- **Key Derivation**: Argon2id
- **Desktop**: Electron 41
- **DnD**: @dnd-kit
- **Testing**: Vitest 4
