# Environment variables

Reference for every environment variable TheJournal reads. Set them in
whichever way your supervisor supports — a systemd `Environment=` line,
a `.env` file loaded by Node, `docker run -e`, etc.

## Required in production (web)

### `JOURNAL_DB_SECRET`

The SQLCipher database key. Used to derive the AES-256 key that
encrypts your `.tjdb` file at rest. Lose this and the database is
unrecoverable — back it up alongside the DB file.

- **Default (dev only):** a hard-coded value embedded in
  `src/lib/auth.ts`. **THIS MUST BE OVERRIDDEN IN PRODUCTION.** If you
  ship with the default, any attacker who lifts your DB file from disk
  can read every entry without your user password.
- **How to generate:** `openssl rand -hex 32` (64 hex characters,
  representing 32 bytes).
- **Scope:** server / Electron.
- **Read at:** `src/lib/auth.ts:14`.

## Recommended

### `JOURNAL_DB_PATH`

Absolute path to the SQLCipher database file. WAL sidecars
(`.tjdb-wal`, `.tjdb-shm`) live next to it.

- **Default:** `<cwd>/journal.tjdb` for the web build,
  `[Electron userData]/journal.tjdb` for the desktop build.
- **Permissions:** the server process needs read + write on the file
  and the containing directory (SQLite creates the sidecars
  on-the-fly).
- **Scope:** server / Electron.
- **Read at:** `src/lib/db.ts:97`, `src/app/api/backup/export/route.ts:16`,
  `src/electron/main.js:42`.

### `JOURNAL_PLUGINS_DIR`

Where the server looks for plugin folders. Each plugin is a directory
containing `manifest.json` + `main.js`. See `docs/plugins.md`.

- **Default:** `<cwd>/plugins/` for the web build,
  `[Electron userData]/plugins/` for the desktop build (Electron sets
  this env var explicitly on startup so its embedded Next.js server
  and the native Plugins menu point at the same folder).
- **Scope:** server / Electron.
- **Read at:** `src/lib/serverPlugins.ts:33`, `src/electron/main.js:110`.

## Optional

### `PORT`

The port the Next.js standalone server listens on.

- **Default:** `3000`.
- **Scope:** server only — Electron picks its own port via
  `get-port` (`src/electron/main.js`).
- **Read at:** Next.js's own bootstrap.

### `NODE_ENV`

Standard Node convention. Several code paths gate behaviour on
`production` vs everything else:

| When set to `production` | Effect |
| --- | --- |
| Session cookies | `secure: true` (`src/app/actions.ts:20`) |
| Backup-route error responses | Don't include stack traces (`src/app/api/backup/*/route.ts`) |
| DB Manager singleton | Not stashed on `globalThis` (`src/lib/db.ts:615`) |
| Route helper error logging | Quieter (`src/lib/route-helpers.ts:29`) |
| Electron `dev` flag | Production behaviour throughout `src/electron/main.js` |

- **Default:** unset (treated as not-production).
- **Set to:** `production` for live deployments.

## Quick checklist (web prod)

```bash
export NODE_ENV=production
export JOURNAL_DB_SECRET=$(openssl rand -hex 32)
export JOURNAL_DB_PATH=/var/lib/thejournal/journal.tjdb
export JOURNAL_PLUGINS_DIR=/var/lib/thejournal/plugins
export PORT=3000
```

Persist these in your supervisor's config — not in your shell — so a
reboot doesn't lose them.

## What is NOT an environment variable

These look like settings but live elsewhere:

- **Backup destination path, retention count, font size, theme** —
  stored per-installation in `[userData]/settings.json` (Electron) or
  the browser's `localStorage` (web). See `src/electron/settings.js`.
- **Per-category passwords** — stored in the DB itself (envelope
  encryption: `Category.PasswordSalt` + `Category.PasswordWrappedKey`).
  See `src/lib/categoryCrypto.ts`.
- **Keybindings** — Settings → Keyboard Shortcuts, persisted in
  `settings.json` / `localStorage`.
