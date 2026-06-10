# DavidRM "The Journal 8" — Gap Analysis & Parity Audit

## Audit round 7 — round-6 verification + Electron IPC surface sweep (2026-06-10f)

Round 7 verified the round-6 commit empirically (COALESCE semantics against
the real SQLCipher driver; the drift-guard regexes executed against the real
importer source, incl. a demonstrated negative case) and audited the whole
preload/contextBridge surface (contextIsolation on, save-setting allowlisted,
sandboxed PDF window — not overly broad). Findings, all fixed:

1. **Electron theme toggle didn't survive a restart** — the live toggle path
   only called `setTheme`, while startup unconditionally re-applied
   `settings.theme`; the one code path that persisted listened on a
   `toggle-theme` IPC channel main.js never sends (orphaned by the
   view-action menu refactor). The toggle now persists via
   `saveSetting('theme', …)` on Electron, and the dead IPC path was removed.
2. **Dead IPC surface removed** — `readFileForImport` (preload + main
   handler; zero callers, unnecessary file-read attack surface) and the
   never-sent `toggle-theme` / `logout-request` / `open-settings` /
   `export-current-entry-pdf` channels with their dead renderer
   subscriptions and type declarations.

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**1021/1021** · `npm run build` + standalone verify clean · main/preload
syntax-checked.

## Audit round 6 — round-5 verification + destructive-flow sweep (2026-06-10e)

Round 6 verified the round-5 commit (cadence math, importer SQL/scoping/
back-compat) and traced the five most data-destructive flows end-to-end
(category delete cascade, permanent entry delete, trash purge, restore
pre-delete validation, transformCategoryEntries) — all guards genuinely
prevent the destructive path. Two defects found in round-5's own guard work,
both fixed:

1. **`Attachment.CreatedAt` was dropped on restore** — a live column (voice
   memo timestamps/ordering) reset to restore time. The importer now carries
   it (`COALESCE(?, CURRENT_TIMESTAMP)` for old backups).
2. **The column-level drift guard accepted substring false positives** — a
   whole-file `includes()` let Attachment.CreatedAt pass via other tables'
   CreatedAt columns. The guard now parses each table's own
   `INSERT [OR …] INTO main.<table> (…)` column lists plus second-pass
   `UPDATE main.<table> SET` statements; PKs are auto-excluded via
   `pragma table_info` (fresh ids, remapped through id maps) and the dead
   legacy `EntryContent.QuillDelta` is a documented exclusion.

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**1021/1021** · `npm run build` + standalone verify clean.

## Audit round 5 — round-4 verification + cross-cutting sweeps (2026-06-10d)

Round 5 verified the round-4 commit fully correct against the library sources
(composite math, crop-skip transition behavior, StrictMode ref reset,
week-start chain, portable target) and ran two cross-cutting sweeps (menuSpec
↔ Electron native handler diff: clean; per-UserID scoping of all
recently-touched routes: clean). Findings, all fixed:

1. **"Entry Frequency" was a dead control** (pre-existing since M1) — the
   Category Properties dropdown persisted and round-tripped but had zero
   behavioral consumers. It now drives its documented purpose: the calendar
   highlights missed cadence (pure `entryCadence.ts` — daily/hourly mark past
   in-month entry-less days; weekly marks only the last day of a fully-elapsed
   empty week; amber ring + explanatory tooltip in the sidebar calendar,
   re-read live with WeekStartDay). `entry-cadence.test.ts`.
2. **Restore dropped `Category.WeekStartDay`** — the round-4 column wasn't
   taught to the importer's explicit column list (the drift guard was only
   table-level). Fixed, and the guard is now **column-level**: every live
   column of every user-owned table must appear in the importer source, with
   a documented exclusion list (Entry.Version = fresh-row counter; standalone
   PKs that nothing references). The upgraded guard immediately caught two
   more pre-existing restore fidelity losses, also fixed:
   **Entry.LastAccessedDate** (recent-entries history survived nothing) and
   **Reminder.NextOccurrenceID** (recurrence chains now remap through a
   reminder id map in a second pass, like the category/entry hierarchies).

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**1021/1021** (+ entry-cadence, column-level import guard) · `npm run build`
+ standalone verify clean.

## Audit round 4 — round-3 diff review + exhaustive feature-page pull (2026-06-10c)

Round 4 ran two fresh passes: a skeptical review of the round-3 commit
(including reading the react-sketch-canvas / react-image-crop library sources)
and a full pull of every davidrm.com feature subpage. The wiring/orphan/test
sweep verified clean end-to-end; the other angles found issues, all fixed:

### Round-3 code defects (all fixed)

1. **Doodle-on-photo export was misaligned/cropped (major)** —
   react-sketch-canvas's `exportWithBackgroundImage` draws the photo unscaled
   at (0,0) while displaying it scaled/centered, so the saved PNG essentially
   never matched what the user drew (and downgraded the photo to canvas size).
   The annotate save now exports the strokes alone and composites them onto
   the photo at its NATURAL resolution (`compositeAnnotation` reproduces the
   "xMidYMid meet" math and maps the on-screen rect back to full size).
2. **VoiceMemos Record silently no-op'd in dev** — the round-3 `unmountedRef`
   was never reset, and StrictMode's mount→cleanup→remount preserves refs, so
   the guard stayed permanently true. The ref now resets at effect start.
3. **The web View menu still advertised Ctrl+Shift+B** for the sidebar after
   the rebind — pressing it created a blockquote. Label updated to Ctrl+Alt+B.
4. **Rotation-only save was unreachable** — react-image-crop auto-fires
   `onComplete` for the default 80% selection seeded after every image load,
   so rotate→Apply silently cropped to 80%. After a rotate the default
   selection is no longer seeded (`skipDefaultCropRef`), making the
   full-image fallback actually reachable.
5. **Autocorrect rules rewrote legitimate words** — removed
   'alright'→'all right' (real word; style choice), 'wont'→"won't" ("as is
   her wont"), and archaic-valid 'hight'.

### J8 gaps closed (exhaustive davidrm.com subpage pull)

6. **Per-category week-start day** ("customizable category settings including
   week-start day") — additive `Category.WeekStartDay` column (0=Sunday…6,
   idempotent migration, `week-start-day.test.ts`), accepted by the category
   PUT, a "Week starts on" dropdown in Category Properties (Journal type),
   and the sidebar calendar derives its grid + rotated day headers from it
   (re-reads live via `category-settings-changed`).
7. **Portable USB build** — `electron-builder.yml` win targets now include
   `portable` alongside NSIS (J8 installs to a thumb drive).

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**1000/1000** · `npm run build` + standalone verify clean · yml validates.

## Audit round 3 — round-2 diff review + davidrm.com feature-page cross-check (2026-06-10b)

Round 3 (skeptical diff review of round 2 + a fresh J8 feature-list pull from
davidrm.com + wiring/orphan verification). The wiring/orphan sweep came back
fully clean; the other two angles found issues, all fixed:

### Round-2 code defects (all fixed)

1. **Ctrl+Shift+B collided with StarterKit's Blockquote keymap** — inside the
   editor the "toggle sidebar" key created a blockquote (document mutation)
   and the sidebar never moved; the same defect class round 2 fixed for
   Ctrl+Shift+L. `view.toggle-sidebar` now defaults to **Ctrl+Alt+B**
   (Blockquote keeps the standard editor key; the command stays rebindable).
2. **VoiceMemosPanel could leave the microphone hot** — closing the panel
   while the getUserMedia permission prompt was pending let the resolved
   stream start recording with no UI to stop it. The await is now guarded by
   an unmounted ref that stops the tracks immediately.
3. **Ctrl+Shift+T added to `WEB_RESERVED_ACCELS`** — browsers reserve it
   (reopen closed tab), so the web menu no longer advertises it for Insert
   from Template (Electron unaffected; the command stays rebindable on web).
4. **Tag rename stored the raw name in the active filter** — the server
   normalizes tags to lowercase, so renaming an active tag to a name with
   uppercase left a stuck, un-toggleable filter chip. The filter now patches
   with `normalizeTag(to)`.
5. **Backlinks couldn't see the hyperlink dialog's own links** —
   `findBacklinks` only parsed `[[..]]` wiki tokens, so `journal://entry/<id>`
   anchors (including resolved `entry:` references from the same round!) never
   appeared in "Linked from". The candidate filter and matcher now also parse
   `journal://entry` hrefs (`hasJournalAnchor`, regression-tested).

### J8 gaps closed (fresh pull of davidrm.com/features/* pages)

6. **Auto-correction of common misspellings** ("Automatically corrects common
   English misspellings") — new pure `autocorrect.ts` (~110-rule table,
   case-preserving incl. ALL-CAPS and apostrophe fixes like dont→don't) hooked
   into the editor's word-boundary keydown (same hook as snippet expansion;
   the boundary key still inserts). Settings ▸ Editor Preferences toggle
   ("Auto-correct common misspellings", default on). `autocorrect.test.ts`.
7. **Launch at login** ("Launches with Windows") — `openAtLogin` setting
   (Settings ▸ Security, Electron-only) applied via
   `app.setLoginItemSettings` immediately on toggle and re-asserted at
   startup (installer updates can drop the login item). Guarded so an
   unsupported platform can't break startup.
8. **Image rotation** ("rotation, thumbnails, and doodling") — the crop modal
   is now **Crop & Rotate**: 90°-step rotation on an off-screen canvas, crop
   resets on rotate, and Apply can save a rotation alone (full-image crop
   fallback). Cross-origin images surface the canvas-taint limitation
   honestly.
9. **Doodle on a photograph** — new **Doodle** button on the image-selected
   toolbar (`trigger-annotate-image`): opens the drawing canvas with the
   photo as the background (`ReactSketchCanvas backgroundImage` +
   `exportWithBackgroundImage`), composites strokes onto a PNG, and replaces
   the image node in place.
10. **Word cloud from assigned topics** ("from entry text or assigned
    topics") — the Word Cloud panel gained an Entry text / Topics source
    toggle; topic mode weighs each topic by its non-deleted entry count
    (pure SQL — no decryption, so locked categories contribute safely).

### Decisions documented (NOT built, with reasons)

- **Blog publishing** (J8 posts entries to blog platforms): publishing to an
  external service is the same class as the external Category Sync carve-out
  — it needs third-party accounts/credentials that can't be exercised in this
  environment. The syndication *format* half is covered (ATOM export via
  `exportEntriesAsATOM`). Decision: out of scope alongside Category Sync.
- **FTP upload of backups**: scheduled backups write SHA-256-verified
  snapshots to any mounted/synced folder, which is the modern equivalent;
  Node has no built-in FTP client and the no-new-dependencies convention
  holds. Self-host operators can point `DestPath` at a synced/remote mount
  (documented in the backup runbook).

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**998/998** (+ autocorrect, backlinks journal-anchor regression) ·
`npm run build` + standalone verify clean · `node --check` main.js clean.

## Audit round 2 — keyboard layer + remaining stranded clusters (2026-06-10)

Round 2 (fresh diff review of round 1 + a J8 keyboard-shortcuts parity check
against davidrm.com + a fresh orphan scan) found real issues. All fixed:

### Round-1 code defects (minor, both fixed)

1. **StatsPanel heatmap could crash on a non-OK response** — no `r.ok` check
   and an unbounded "previous year" button stored `{error}` in state and threw
   in `heat.cells.map`. Now guarded + year floored at 1900.
2. **Min-words silent desync** — the client had no cap while the route
   rejected >7 digits, and the optimistic state showed an unsaved value.
   Client now caps at 9,999,999 and re-syncs from the server on a failed PUT.

### Keyboard-layer defects (the audit's main findings)

3. **Ctrl+Shift+P did different things per target** — the menu advertised
   Category Properties, but the editor hardcoded it to Writing Prompts on web.
   Fixed via a new `category.properties` registry command (default
   Ctrl+Shift+P → `trigger-category-properties`); the editor's hardcoded
   branches (Ctrl+Shift+T/P, Ctrl+\, Ctrl+F, F11) were removed entirely — the
   registry owns them, so user rebinds finally take effect (`trigger-focus`
   now toggles focus mode so F11 still exits).
4. **Ctrl+Delete hijacked "delete next word" on Electron** — the Delete Entry
   native accelerator consumed the editing keystroke. Accelerator removed
   (menu item + sidebar flows unchanged).
5. **Ctrl+Shift+L three-way collision** — TipTap TextAlign's default keymap
   claimed it for align-left while security.lock also used it; inside the
   editor the paragraph was REALIGNED (a real document mutation that could
   autosave) and then the app locked. TextAlign now drops only the `L`
   binding (center/right/justify keys kept); LockGate no longer has its own
   keydown — it listens for `trigger-lock-app` dispatched by the registry,
   which honors `defaultPrevented` and user rebinds.
6. **Rebinding 8 commands was a silent no-op** — commands missing from
   `COMMAND_TRIGGER_MAP` fell through to a `tj-command` event with zero
   listeners (edit.find, format.bold/italic/underline/strikethrough,
   format.clear, insert.image-url, security.lock). EVERY command now maps to
   a real trigger event with a live listener (new editor listeners for
   marks/clear-format, toolbar listener for image-url); the dead fallthrough
   was deleted and `command-triggers.test.ts` now requires full coverage with
   NO carve-outs, plus a no-duplicate-defaults guard.
7. **Duplicate Ctrl+F defaults** — `edit.find` shadowed `view.search`.
   `edit.find` is now "Find in entry" (maps to the find bar, no default —
   Ctrl+F stays the global search by documented design).
8. **Web menu advertised unbound accelerators** — Ctrl+P / Ctrl+Shift+F /
   Ctrl+Shift+D now have registry commands (`entry.print`,
   `view.search-all`, `view.toggle-theme`) so the labels are true on web; the
   genuinely browser-reserved combos (Ctrl+N, Ctrl+Shift+N, Ctrl+T, Ctrl+W,
   Ctrl+Tab) are hidden from web menu labels (`isAccelShownOnWeb`) instead of
   lying.
9. **No keyboard category cycling (J8 Ctrl+Tab)** — new Category ▸
   Next/Previous Category items (Ctrl+Tab/Ctrl+Shift+Tab native on Electron)
   plus rebindable `nav.next/prev-category` commands (Ctrl+Alt+PageDown/Up,
   web-safe) cycling via the pure `categoryCycle.ts` (wrap-around, tested).

### J8 features added (verified against the J8 shortcuts page)

10. **Thesaurus** — Tools ▸ Thesaurus… looks the selected word up
    (Merriam-Webster web thesaurus; an offline thesaurus would need a new
    dataset dependency, noted as the trade-off).
11. **Writing Timer / Insert Timer** — Tools ▸ Writing Timer… opens a floating
    stopwatch (pause/resume/reset) whose Insert button drops the elapsed time
    at the caret (`timerFormat.ts`, tested).
12. **Right-to-Left paragraph** — Format ▸ Right-to-Left Paragraph toggles the
    standard `dir="rtl"` attribute on the current block (ParagraphStyle
    extension), surviving save/export.
13. **Calendar charms** — verified ALREADY PRESENT: calendar day cells render
    the entry's icon (Sidebar emoji picker = the charm picker). Documented
    rather than rebuilt.

### Stranded clusters wired (built API/lib, no UI — same class as round 1)

14. **Recent entries** — `touchEntry` was never called, so the list was
    permanently empty. Now stamped on entry GET (fire-and-forget); new
    Go ▸ Recent Entries… panel.
15. **Voice memos** — new Tools ▸ Voice Memos… panel (MediaRecorder record,
    list, play, delete over the existing /api/audio routes).
16. **Duplicate entry** — Entry ▸ Duplicate Entry (server-side copy via the
    existing route, opens the copy).
17. **Backlinks** — Entry Properties now shows "Linked from" (clickable list
    via /api/entry/[id]/backlinks).
18. **Reminder snooze** — hover snooze buttons (10m/1h/1d) on open reminders
    in the Reminders panel, calling the existing snooze route.
19. **Daily prompt** — Writing Prompts picker pins the server's deterministic
    "Prompt of the day" (/api/prompts/today) at the top.
20. **Tag rename/merge** — right-click a tag chip in the sidebar tag filter to
    rename it across every entry (merges when the target name exists).
21. **Bulk operations** — Trash panel gained multi-select with bulk Restore /
    Delete-forever via /api/entry/bulk.
22. **Entry references** — the hyperlink dialog now resolves J8-style
    `entry:Category\Title` references (with * / ? wildcards) through
    /api/entry/lookup into internal journal:// links (the entryRefs lib was
    nearly removed as "superseded" — it is a J8 parity feature and is now
    reachable).

### Removed

- Orphans `src/components/ThemeProvider.tsx` (providers uses next-themes
  directly) and `src/hooks/useElectronIPC.ts` (+ barrel entry).

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**991/991** (+ category-cycle, timer-format; command-triggers tightened to
full coverage) · `npm run build` + standalone verify clean.

## Parity + stranded-feature audit round — 2026-06-09

Fresh-eyes audit (two independent passes: a skeptical diff review of the
2026-06-08 commits, and a feature-parity sweep beyond the menu level).
Findings and fixes:

### Defects fixed

1. **"Search Across All Categories…" no-op'd when the panel was already open**
   — `initialScope` only seeded `useState`, so re-firing the menu action on a
   mounted SearchPanel changed nothing (the exact defect the 2026-06-08 fix #7
   claimed to close recurred in this path). Fixed with a `scopeRequestSeq`
   bumped on every open action + a resync effect; works in both directions
   (all→current too). Guarded by `search-scope-resync.test.tsx`.
2. **Concurrent `requestPrompt()` stranded the first caller forever** — a
   second prompt while one was open (reachable via Electron's native menu,
   which the DOM overlay doesn't block) replaced the host's request without
   settling it: the awaiting flow (e.g. a template's `{{prompt}}` loop) hung,
   and the replacement modal inherited the superseded prompt's typed text.
   PromptHost now cancels (resolves null) any pending request before accepting
   a new one, and `PromptModal` is keyed per request id so it mounts fresh.
   Covered in `prompt-and-dialogs.test.tsx`.

### J8 gaps closed (verified against davidrm.com feature pages)

3. **Change Entry Date/Time** (J8: entries can be placed on/moved to any date)
   — new `Entry ▸ Change Entry Date/Time…` menu item; styled datetime prompt
   (PromptModal gained `date`/`datetime-local` input types); `PUT
   /api/entry/[id]` accepts `createdDate` validated by the pure
   `src/lib/entryDate.ts` (`entry-date.test.ts`: noon convention for bare
   dates, Feb-30/hour-24 rejection). The editor adopts the bumped Version via
   an `entry-version-synced` event so its next optimistic-concurrency autosave
   doesn't 409.
4. **Spell-check toggle** (J8 ships configurable live spell check) — Settings ▸
   Editor Preferences ▸ "Check spelling as you type"; pure `spellcheck.ts`
   (default-on, junk-safe) + live re-apply to both editor panes
   (`spellcheck.test.ts`). The checker itself is the platform's native one.
5. **Global hotkey + tray quick entry** (J8: Ctrl+Alt+J summons the app from
   the tray) — Electron registers `Ctrl+Alt+J` (guarded: a conflict can't
   break startup, unregistered on quit) and the tray menu gained **New Entry**
   (routes through the same `view-action → trigger-new-entry` path as the menu).

### Stranded features wired (built API/lib layers that had no UI)

6. **Favorites panel** — `FavoritesPanel.tsx` existed but nothing opened it
   (and its navigation used a wrong `?entryId=` param — fixed to `?entry=`).
   Now at **Tools ▸ Favorites…** (with "Surprise me" random-entry jump).
7. **Habit tracker** — full lib/routes/tests existed with zero UI. New
   `HabitsPanel.tsx` (14-day click-to-toggle day grid, current/best streaks,
   color-coded habits) at **Tools ▸ Habit Tracker…**.
8. **Web scheduled backups** — `BackupSchedule` CRUD existed with no executor
   and no UI. New `src/lib/backupRunner.ts` (hourly sweep started from the
   server's db module; WAL-checkpointed snapshot per due schedule, SHA-256
   verified via the previously-orphaned `backupVerify.ts` — a torn copy is
   deleted and retried, never silently kept; keeps 5 newest per destination;
   LastRun only stamped on success) + a Settings ▸ Backup management UI on the
   web target. The schedule routes are now **admin-gated** (a schedule
   snapshots the whole DB file — same trust level as `backup/export`).
   `backup-runner.test.ts` covers copy/verify/prune/failure-retry.
   Note: the sweep is started from `db.ts` module scope, NOT instrumentation.ts
   — the instrumentation entry's file trace ignores `outputFileTracingExcludes`
   and shipped the live `journal.tjdb` into the standalone bundle (caught by
   `verify-standalone.js`).
9. **Minimum words per entry** — wired as a real feature: Tools ▸ Word Goals
   gained the setting (persisted via `/api/settings` with route-side
   validation), and the editor footer shows an amber "N to go" hint while the
   open entry is under the minimum. The orphaned `minWordGoal.ts` wrapper was
   superseded and removed.
10. **Stats: year activity heatmap** — the built-but-unreachable
    `/api/stats/heatmap` now renders in Text Statistics as a GitHub-style
    year grid with year navigation. The locked-category word-count regression
    test (`wordcount-locked.test.ts`) now exercises `buildHeatmap`.

### Dead code removed (superseded, kept failing fresh audits)

- `src/lib/api.ts` (unused fetch wrapper), `autolink.ts` (TipTap Link's own
  `autolink` covers it), `outline.ts` (no consumer), `hourActivity.ts` +
  `/api/stats/hour-activity` (duplicated `time-of-day`'s by-hour chart), each
  with their orphan tests where applicable.

### Decisions (not gaps)

- **To-do carry-forward**: checked DavidRM's published feature set — NOT a J8
  feature; not built (building it would diverge, and the goal is parity).
- Custom spell-check dictionaries: the platform-native checker manages its own
  dictionary; only the on/off control is app-level.

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors · `vitest run`
**982/982** (was 1001; −19 removed orphan tests, +tests for every item above) ·
`npm run build` + standalone verify clean · `node --check` on all Electron
main-process files · menu spec loads with 0 accelerator conflicts and
`menu-bar.test.tsx` still clicks every leaf.

## Menu correctness audit — 2026-06-08

Goal: go over **every** menu item and verify it fires the right dialog/action,
sets+saves correctly, and works on **both web and Electron** — not just that an
event is wired (the prior rounds proved wiring; this round proves behaviour).

### Defects found and fixed

1. **`window.prompt` flows were silently dead in Electron.** `window.prompt()`
   is a no-op in the Electron renderer (returns `null`, logs a warning), so the
   following menu items looked wired and worked on web but did **nothing** on the
   desktop target: **User ▸ Change Password**, **Insert ▸ Bookmark…** (create +
   link-to), **Topic ▸ Assign Topics…**, **Entry ▸ Move Entry to Category…**,
   **Insert ▸ Insert from Template…** (when the template has `{{prompt:…}}`
   variables), image alt-text, and "save current search". Fixed by an app-wide
   styled-prompt service (`src/lib/promptService.ts` `requestPrompt()` +
   `<PromptHost>` mounted in providers) that works identically on both targets,
   and a dedicated `ChangePasswordModal` (current/new/confirm + inline
   validation). Assign-Topics / Move-Entry now use a **select** of real
   topics/categories instead of free-text, and warn if no entry is open instead
   of silently no-op'ing. Guarded by `no-window-prompt.test.ts` (source scan) so
   the dead call can't return.

2. **Exit did nothing on web.** The spec gives Exit `role:'quit'` for Electron's
   native menu; the web resolver short-circuited on the role to
   `execCommand('quit')` — a silent no-op — so the intended logout never fired.
   `resolveWebMenuAction` now resolves web Exit to `trigger-logout` before the
   role check (Electron still quits natively).

3. **Settings opened to the wrong place.** "Keyboard Shortcuts", "Install
   Plugin…", "Manage Plugins…", and "Open Plugins Folder" all opened the single
   long Settings modal scrolled to the **top**, not their section. Added section
   deep-linking: `SETTINGS_SECTION_FOR_ACTION` (shared by web + Electron), a
   `detail.section` on the `trigger-settings` event, `data-settings-section`
   anchors in `SettingsModal`, and a scroll-into-view + brief highlight on open.
   "Manage Plugins…" got its own `manage-plugins` action (was reusing `settings`,
   indistinguishable from Tools ▸ Options).

4. **"Set up Automatic Login…" opened generic Settings with no auto-login
   control.** Auto-login is real (the login screen's "Remember me" — Electron
   stores an OS-keystore-encrypted password; web pre-fills the username). Added
   an **Automatic login** control to Settings ▸ Security (shows enabled/disabled
   + a disable/clear-credentials button) and deep-linked the menu item there.

5. **Silent no-ops when no entry/category was active.** Assign Topics, Move
   Entry, Category Properties, and Delete Category all guarded on the active
   entry/category and did nothing (no feedback) when none was open. They now
   alert "Open a/an … first." Verified the *correct* ones really work: New
   Category opens a real creation modal (POST `/api/category`); Category
   Properties is `CategorySettingsModal` (GET + **PUT** `/api/category/:id`,
   round-trips); Delete Category is a real DB `DELETE` with a 409 entry-count
   confirm — none were UI-only fakes.

### Real-browser re-audit (2026-06-08, second pass)

The first pass above was verified by handler-reading + jsdom — NOT by clicking a
running app, and I wrongly declared the goal met. A real authenticated browser
drive (puppeteer-core + Chrome, isolated throwaway tenant on the dev server,
every leaf clicked via its real onClick) found two more genuine defects that
code-reading missed:

6. **Toggle Theme did nothing on the first click.** `onToggleTheme` compared the
   `theme` setting (`'system'`) instead of the *resolved* theme, so toggling from
   system→dark was a no-op when the OS was already dark. Now reads `resolvedTheme`
   (via a ref) → reliably flips dark↔light. (Browser-confirmed: dark→light→dark.)

7. **Two menu items were exact duplicates (didn't make sense).** "Search Across
   All Categories…" fired the same `search` action as "Find…" and opened the
   panel scoped to the *current* category — so it didn't search across all.
   "Global Find and Replace…" fired the same `replace` action as "Replace…"
   (per-category; there is no cross-category replace). Fixed: "Search Across All
   Categories…" now uses a distinct `search-all` action that opens the panel
   pre-scoped to **all** categories (`SearchPanel initialScope`); the misleading
   "Global Find and Replace…" was removed rather than left lying.

8. **"Print Setup…" was a third duplicate** — it fired the same `print-entries`
   action (direct print) despite implying a configuration step, and there is no
   page-setup dialog. Removed (Print Preview + Print Entries… cover the real
   capabilities) so it can't lie like the Search/Replace pair did.

9. **"Find Next" didn't advance.** Both `find-next` and `find-in-entry` only
   opened the in-entry find bar; clicking "Find Next" with the bar already open
   did nothing. `FindBar` now listens for `trigger-find-next` and advances to the
   next match (matching its F3 / Next-button behaviour).

**Honest verification framing:** all of the above were exercised on the **web**
target in a real browser. The Electron native-menu path was NOT physically run —
renderer-handled items go through the same `view-action → trigger-*` path the
browser drive covered, and the `window.prompt` removal fixes the desktop-dead
items by construction, but `main.js`'s native handlers (volume/restore dialogs,
plugin folder picker, print, about, updates) are syntax-checked only. The
Settings section *scroll* and the search-all *scope* are verified by their
event→component plumbing + unit tests (jsdom stubs scrollIntoView; the scope chip
lives in the panel's advanced drawer) rather than visually observed.

Everything else was exercised in the real browser and confirmed working: modals
(Journal Volumes, Print Preview, Find/Replace, Go-to-date, Drawing, Template,
Font/Paragraph, Manage Topics/Users, Entry Properties, Lock, Move-Entry select,
Change Password, Settings, Reminders/WordCloud/Stats/Goals/Snippets/Trash,
Install/Manage Plugins, Keyboard Shortcuts); editor ops (Undo/Redo, Table, HR,
Checklist, all Styles, Inline Code, Highlight, Date&Time, plugins insert);
toolbar popovers (Special Char, Sort sub-entries); layout toggles (toolbars,
sidebar left/right/hidden, tabs top/bottom/vertical, split, focus, refresh);
navigation (Today, Go-to-date, prev/next, history); native dialogs (Delete
Category, Sync, Switch User, Check Updates, About, Paste-Special); external links
(Docs, Plugin API, Report Issue → new tab). Items that open an OS-native picker
(File Attachment, Image, Text Color, Import) or operate on the whole DB / end the
session (Backup, Restore, Integrity, Optimize, Print, Exit) were not clicked in
the shared dev DB — verified by code + unit tests.

### Per-item verification (every leaf)

Legend: ✓ correct as-is · ★ fixed this round. "Both" = web + Electron route to
the same handler (Electron `default → view-action → trigger-*`).

| Menu | Item | Action → handler | Status |
|---|---|---|---|
| File | New/Open Journal Volume… | web: Volume Manager modal · Electron: native file dialog | ✓ |
| File | Backup/Restore/Check Integrity/Optimize | download / file-input / `/api/db/*` | ✓ |
| File | Print Setup/Preview/Entries | EntryPrintBridge (preview modal / print) | ✓ |
| File | Exit | web→`trigger-logout`; Electron→native quit | ★ |
| Edit | Undo/Redo/Cut/Copy/Paste/Select All | native roles / execCommand | ✓ |
| Edit | Paste Special… | TipTapToolbar strip-format paste | ✓ |
| Search | Find… / Search Across All | global SearchPanel (cross-category) | ✓ |
| Search | Find in Entry… / Find Next | in-entry FindBar | ✓ |
| Search | Replace… / Global Find and Replace | TabBar replace dialog | ✓ |
| View | Toolbars/Sidebar/Tabs/Split/Theme/Refresh/Focus | JournalView/TabBar/Editor toggles (persisted) | ✓ |
| Go | Today/Go to Date/Prev/Next/History | JournalView + Sidebar nav | ✓ |
| Insert | Attachment/Image/Link/Table/HR/Special/Checklist/Date/Drawing | TipTapToolbar/Editor inserts | ✓ |
| Insert | Bookmark… | styled prompt (was `window.prompt`) | ★ |
| Insert | Insert from Template… | template picker; `{{prompt}}` vars via styled prompt | ★ |
| Format | Font/Paragraph props, Styles, Bullets, Inline Code, Color, Highlight | Editor dialogs + TipTap chains | ✓ |
| Topic | Assign Topics… | topic **select** modal (was `window.prompt`) | ★ |
| Topic | Tag Selection with Topic… / Manage Topics… | inline-tag flow / ManageTopicsModal | ✓ |
| Entry | New/Sub/Save/Delete/Properties/Lock/Sort | Sidebar + Editor | ✓ |
| Entry | Move Entry to Category… | category **select** modal (was `window.prompt`) | ★ |
| Category | New/Properties/Delete/Import/Export/Calendar/Looseleaf | TabBar + JournalView | ✓ |
| Category | Sync Category… | informational alert (carve-out: external sync NOT built) | ✓ |
| User | Log In as Different User / Manage Users | logout / ManageUsersModal | ✓ |
| User | Change Password… | `ChangePasswordModal` (was 3× `window.prompt`) | ★ |
| User | Set up Automatic Login… | Settings ▸ Security auto-login control (deep-link) | ★ |
| Tools | Reminders/WordCloud/Stats/Prompts/On-This-Day/Goals/Snippets/Trash | TabBar + Editor panels | ✓ |
| Tools | Options / Preferences… | Settings modal | ✓ |
| Plugins | Insert Draw.io / Sentence Diagram | `trigger-run-plugin` | ✓ |
| Plugins | Install Plugin… | web→Settings▸Plugins · Electron→native folder picker | ★ |
| Plugins | Manage Plugins… | Settings▸Plugins (deep-link; own action) | ★ |
| Plugins | Open Plugins Folder | web→Settings▸Plugins · Electron→open folder | ★ |
| Help | Documentation / Plugin API / Report Issue | external links | ✓ |
| Help | Keyboard Shortcuts | Settings▸Keyboard Shortcuts (deep-link) | ★ |
| Help | Check for Updates / About | version check / about dialog | ✓ |

### Verification performed

- `npx tsc --noEmit` clean; `npx vitest run` → **1000 tests pass** (added
  `prompt-and-dialogs.test.tsx` real-React renders of PromptHost /
  ChangePasswordModal / SettingsModal-deep-link, `no-window-prompt.test.ts`
  source guard, and menu-actions resolver regressions for exit + section links).
- `menu-bar.test.tsx` renders the real `<MenuBar/>` and **clicks every one of
  the ~80 leaf items**, asserting the resolved behaviour fires.
- Real Next dev server compiles & serves all touched routes (login 200, gated
  routes 307); real Chrome renders the hydrated shell (the new `PromptHost` in
  providers doesn't break client hydration).
- NOT done at the browser level: a fully **authenticated** click-through on the
  live server (would require the operator's credentials / would write to the
  real `journal.tjdb`) and a physical Electron native-menu run. The Electron
  routes are exercised via the shared `view-action → trigger-*` path the tests
  cover, and the `window.prompt` removal makes the previously-dead desktop items
  work by construction.

## Deferred-gap closure round 5 — 2026-06-03b

Closed the remaining deferred items that fall OUTSIDE the goal's only carve-out
("importing from other apps"). After this round the only unbridged items are
the import/sync-from-elsewhere features (explicitly excluded) and macOS code
*signing* (needs an Apple Developer certificate, a credential not available in
this environment — the build targets themselves are now configured).

1. **Customizable menus (web + Electron).** Users can hide menu items from
   **Settings → Menus**. Pure, tested `menuCustomization.js`/`.d.ts` filters the
   shared `J8_MENUS` spec by a hidden label-path id set (keyed by full path so
   hiding one command can't remove another that reuses the same `action`),
   tidies separators, and drops emptied submenus/menus. The web `MenuBar`
   re-reads on a `menu-config-changed` event; the Electron native menu reads
   `settings.menuHiddenItems` and **rebuilds live** when it changes. Hidden
   items still fire via their keyboard accelerator (the dispatcher is
   independent). `menuHiddenItems` added to the renderer-writable allowlist.

2. **Inline (block-level) topic tagging.** Beyond whole-entry topic assignment,
   a SELECTED span can now be tagged: the new `InlineTag` TipTap mark wraps the
   selection in `<span data-tag data-tag-color>` (colored dotted underline) that
   persists in the entry HTML, round-trips through save/export, and keeps the
   tagged text searchable. Pure tested `inlineTag.ts` (name normalization + tag
   extraction). Wired via **Topic ▸ Tag Selection with Topic…** and the editor
   context menu (`trigger-tag-selection`): pick from the user's topics to apply;
   no selection removes an inline tag at the cursor.

3. **Cross-platform Electron build targets.** `electron-builder.yml` now
   declares **macOS** (dmg + zip) and **Linux** (AppImage + deb) targets
   alongside Windows NSIS; new `package:mac` / `package:linux` npm scripts.
   `release.yml` is now a **3-OS matrix** (windows/macos/ubuntu, `fail-fast:
   false` so one platform's failure can't discard the others) gated by a single
   `verify` job (tsc + vitest). macOS signing is opt-in via `CSC_LINK` /
   `CSC_KEY_PASSWORD` secrets; unsigned otherwise.

   **Also fixed a packaging bug introduced in round 4:** `main.js` now requires
   `windowState.js` + `menuCustomization.js`, which were not whitelisted in the
   asar `files` list — the packaged app would have crashed with "Cannot find
   module". Both are now included (verified the require paths resolve).

**Only remaining unbridged (by design / environment):**
- **Importers (Outlook / Penzu / Diaro / WordPress) + external Category Sync**
  — the goal's explicit carve-out ("except importing from other apps").
- **macOS code signing / notarization** — needs an Apple Developer certificate
  (a secret/credential), not a code change; the workflow already consumes it if
  provided. The mac/linux *builds* are otherwise fully configured.

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors (1 pre-existing
`ThemeSettings` warning) · `vitest run` **933/933** (+18: `menu-customization`,
`inline-tag`) · `npm run build` standalone bundle clean · both YAML workflows +
`electron-builder.yml` validate.

---

## Deferred-gap closure round 4 — 2026-06-03

Per the goal "bridge all gaps except importing from other apps," this round
reversed three previously-deferred items that are genuine J8 features and are
buildable + verifiable in this environment. Shared codebase → web + Electron
get them together (window-state/tray are inherently Electron-only OS concerns).

1. **Drag-to-nest categories (vertical tree).** J8 lets you drag categories to
   reorganize the hierarchy; previously this app only re-parented via the
   Category Properties dropdown or the per-row "+". `CategoryTree.tsx` now uses
   `@dnd-kit/core` (already a dependency): drag a row onto another to make it a
   child, or onto the "Drop here to move to top level" zone (shown only
   mid-drag) to promote it to a root. The drop is resolved by the new pure,
   tested `resolveCategoryDrop` (`categoryTree.ts`) which refuses self-drops,
   cycles, and no-ops; it persists through the existing cycle-guarded
   `PUT /api/category/[id]` (`parentCategoryId`) with an optimistic update that
   reverts if the server rejects. The horizontal/bottom strips keep their flat
   drag-REORDER unchanged.

2. **Electron window-state persistence + system tray.** J8 remembers its
   window geometry and offers a tray. New pure helper `windowState.js`/`.d.ts`
   (`clampWindowBounds`, unit-tested) validates saved bounds and recenters a
   window saved on a now-disconnected monitor so the app always opens
   reachable. `main.js` saves normal bounds + maximized state (debounced) and
   restores them on launch. A guarded `Tray` (degrades silently if no icon or
   platform support) plus a `minimizeToTray` setting keep the app running on
   close, reopening from the tray. Fixed the **missing `public/favicon.ico`**
   that `electron-builder.yml` already referenced (latent build/icon bug).
   Settings → Security gains a "Minimize to system tray" toggle (Electron only).

3. **Customizable editor toolbar (show/hide groups).** J8 has customizable
   toolbars. The editor toolbar is now organized into nine named groups
   (font, marks, paragraph style, lists, alignment, blocks/table, insert,
   tools, history); each can be toggled from **Settings → Editor Preferences →
   Editor Toolbar Buttons**. Logic is the pure, tested `toolbarConfig.ts`
   (hidden-group set in `localStorage`, junk-safe parse, canonical-order
   serialize); the toolbar re-reads on a `toolbar-config-changed` window event
   (mirrors `font-size-changed`). Defaults to all-visible — existing layouts
   are unchanged. **Group reorder is intentionally not offered**: the toolbar
   interleaves contextual controls (image-resize that appears on image select,
   plugin buttons, a flex spacer) whose left-to-right position is meaningful.

**Honest remaining non-goals (not buildable/verifiable here, or not J8):**
- **Importers (Outlook / Penzu / Diaro / WordPress) and external Category
  Sync** — explicitly out of scope per the goal.
- **Block-level / inline tagging** — NOT a J8 feature (J8 tags whole entries
  via Topics, which this app already supports incl. hierarchy), so building it
  would diverge from J8, not converge.
- **Customizable Electron menus** — low value and not click-testable in CI
  (native OS menu). Menu stays data-driven from the shared `menuSpec.js`.
- **macOS/Linux Electron targets + code signing + auto-minimize-idle** —
  cannot be built or validated in this Linux CI/dev environment (Windows NSIS
  is the only packaged target).

**Audit gate (all green):** `tsc` clean · `eslint` 0 errors (1 pre-existing
`ThemeSettings` warning) · `vitest run` **915/915** (+20: `resolveCategoryDrop`,
`window-state`, `toolbar-config`) · `npm run build` standalone bundle clean.

---

## Hierarchical category tree — 2026-05-29d

The last substantial deferred feature, built on explicit owner approval. Categories
were flat; they now nest.

- **Data**: additive `ParentCategoryID` column on Category (nullable self-ref,
  `ON DELETE SET NULL` so deleting a parent promotes its children to roots — no
  cascade/data loss), plus an index. Idempotent ALTER migration like the rest.
- **Logic** (`src/lib/categoryTree.ts`, unit-tested): `buildCategoryTree` (nests +
  orders by SortOrder/id, treats missing/self/cyclic parents as roots so a corrupt
  row can never hang the UI), `flattenTree` (collapse-aware render order),
  `wouldCreateCycle` (API guard), `eligibleParentIds` (dropdown options).
- **API**: `POST /api/category` accepts `parentCategoryId` (ownership-checked);
  `PUT /api/category/[id]` accepts it with an ownership + cycle guard
  (`wouldCreateCycle` over the user's category set).
- **UI**: the **vertical** tabs mode (View › Category Tabs Navigation › Vertical)
  now renders a real nested, collapsible tree (`CategoryTree.tsx`) with per-row
  navigate / add-sub (+) / properties / delete; expand state persisted. Nesting is
  set via **Category Properties › Parent category** (dropdown of eligible
  non-descendant categories) or the tree's "+". The horizontal/bottom strips keep
  their flat drag-reorder, unchanged. Re-parenting reflects live via `onSaved`.
- Both targets (shared codebase). Drag-to-*nest* is intentionally not added
  (reorder stays drag; nesting is explicit) — noted in CLAUDE.md.

**Audit gate (all green):** `tsc` clean · `eslint .` 0 errors · `vitest run`
861/861 (+13: category-tree + category-hierarchy) · `npm run build` clean.

---

## Remaining in-app gaps closed — 2026-05-29c

Closed the "remaining minor" items the dialog audit had flagged, plus the two
find/print parity edges:

- **Styled prompt dialogs** — new reusable `src/components/journal/PromptModal.tsx`
  (text / password / single-select, backdrop + Escape dismiss, inline validation,
  Enter to submit) replaces the native `window.prompt` for: entry **lock/unlock
  password** (inline "wrong password" error instead of a blocking alert),
  **background image URL**, **Save Entry As…** (now a format dropdown, not a typed
  string), and **Insert image by URL**. Adjacent error `window.alert`s in those
  flows now route to the existing toast system (`useToast`).
- **In-entry Find now spans the split view** — when split mode is open, the find
  bar drives both panes' `SearchHighlight` (highlights + active cycling stay in
  sync), not just pane 1.
- **Print Preview is a real in-app modal** — "Print Preview" now opens a sandboxed
  iframe preview of the rendered entry with its own Print… button, distinct from
  firing the OS print dialog directly (Print Entries / Ctrl+P still do that). Wired
  on both targets: web via `trigger-print-preview`, Electron via the menu
  `view-action` bridge.

**Still intentionally deferred (owner-decided non-goals; unchanged):** hierarchical
CATEGORY tree / vertical category tabs (a core-navigation redesign), customizable
Electron menus, drag-to-reorder toolbar, block-level tagging, external Category
Sync, Outlook integration, Penzu/Diaro/WordPress importers, and macOS/Linux
Electron build targets + code signing (cannot be built or validated in this
environment). A couple of `confirm()` decision dialogs (delete/overwrite) remain
native by design — they are blocking yes/no prompts, not data entry.

**Audit gate (all green):** `tsc` clean · `eslint .` 0 errors · `vitest run`
848/848 · `npm run build` clean.

---

## Dialog / pop-up UX audit — 2026-05-29b

Audited all ~20 modal/popup surfaces for whether they are logical, organized,
and easy to use. Findings + fixes:

**Consistency — Escape to close (was the big gap).** Every standalone modal
already dismissed on backdrop click (with proper inner `stopPropagation`), but
most did **not** close on Escape — the universal modal expectation. Added a
shared `src/hooks/useEscapeToClose.ts` (capture-phase, so the modal wins the key
over the editor's distraction-free handler) and applied it to: SettingsModal,
ManageUsers, ManageTopics, JournalVolumes, CategorySettings, TemplatePicker.
`WritingPromptsPicker` and `ImageCropModal` already had Escape and were left as-is.
`DrawingModal` is **intentionally excluded** — Escape there would discard an
in-progress drawing; it keeps explicit Cancel / Save buttons.

**Organization — Settings theme controls were split.** The "Theme Palette"
selector sat under *Editor Preferences* at the top while the light/dark toggle
and the accent/background color pickers were in an *Appearance* section buried at
the very bottom (below Plugins). Consolidated: all theme controls (mode, palette,
colors) now live in one **Appearance** section placed right after Editor
Preferences. Section order is now Editor → Appearance → Backup → Security →
Keyboard Shortcuts → Plugins.

**Logic — input clamping.** The Settings default-font-size input clamped its max
(72) but not its min; it now clamps to 8–72.

**Find bar + hyperlink dialog correctness (from the diff review):**
- FindBar kept a stale "n of m" readout and Prev/Next target when the entry was
  edited with the bar open; it now re-syncs from the plugin on every editor
  `update`. The active-match re-clamp after an edit now stays on the last match
  instead of an arbitrary modulo wrap.
- The hyperlink dialog accepted `journal://` internal links but TipTap's URI
  allowlist silently rejected them (link never applied, dialog closed anyway).
  Registered `protocols: ['journal']` on the Link extension (verified:
  `journal://entry/12` now passes, `javascript:` still rejected) and `applyLink`
  now surfaces an error instead of closing when `setLink` reports failure.

**Remaining minor (documented, not changed):** a few quick one-shot prompts still
use the native `window.prompt`/`alert` (Save Entry As… format, per-entry
Background Image URL, entry lock/unlock password, Insert Image by URL). They are
functional and low-traffic; upgrading them to styled dialogs is a future polish
pass, tracked here rather than rushed in this round.

**Audit gate (all green):** `tsc` clean · `eslint .` 0 errors (1 pre-existing
warning in `ThemeSettings`) · `vitest run` 848/848 · `npm run build` clean.

---

## Final gap closure + full audit — 2026-05-29

Closed the last set of "honest remaining gaps" the prior audit had flagged as
design differences / minor, and re-ran the whole verification gate. The only
items still open are the ones CLAUDE.md keeps **intentionally deferred** by owner
decision (hierarchical category tree / vertical tabs, multi-user admin panel,
external Category Sync, macOS/Linux Electron targets).

**Gaps closed this pass (web + Electron, both targets share the codebase):**

1. **In-entry Find with highlight + cycle (the flagship gap).** J8's Ctrl+F finds
   within the open entry and F3 cycles matches; this app kept Ctrl+F for the
   broader global cross-entry search, so in-entry find is now its own find bar:
   - `src/lib/inEntryFind.ts` — pure, unit-tested match maths (literal / regex /
     whole-word / case toggles, zero-width-safe scan, wrap-around index).
   - `src/components/journal/extensions/SearchHighlight.ts` — a ProseMirror
     decoration plugin that highlights every match and marks the active one; it
     reuses the pure lib per text node and maps offsets to doc positions.
   - `src/components/journal/FindBar.tsx` — the overlay bar: "n of m" readout,
     Aa / whole-word / regex toggles, Enter / F3 next, Shift+(Enter/F3) prev,
     Esc to close, scrolls the active match into view without stealing input focus.
   - Wiring: F3 and the new **Search ▸ Find in Entry…** menu item open the bar
     (`trigger-find-in-entry` / `trigger-find-next`, handled in `Editor.tsx`).
     `JournalView` no longer hijacks F3 to the global panel; Ctrl+F stays global.
2. **Side-by-side split screen.** The split editor now toggles between stacked
   (top/bottom) and side-by-side (left/right) via **View ▸ Split Orientation**
   (`trigger-split-orientation`, persisted in `localStorage.splitHorizontal`).
   The drag divider switches axis (row/col-resize) accordingly.
3. **Styled hyperlink dialog.** `TipTapToolbar` replaces the old `window.prompt`
   with an in-app modal (URL field, "open in new tab", inline validation, Remove
   button), backed by the new tested `src/lib/linkUrl.ts` `normalizeLinkUrl`
   (promotes bare hosts to https, allows root-relative / journal:// / mailto:,
   rejects javascript:/data:/file:/protocol-relative).

**Confirmed already-present (earlier docs left ambiguous):** separate Main-toolbar
and Status-bar toggles both exist (`TabBar` `mainToolbarHidden`, `Editor`
`statusBarHidden`). Print Preview remains routed through the OS/browser print
preview (no separate window) — left as a deliberate minor difference.

**Audit gate (all green):** `npx tsc --noEmit` clean · `npx eslint .` 0 errors ·
`npx vitest run` **848/848** (was 828; +20 from `in-entry-find` and `link-url`) ·
`npm run build` standalone bundle clean. New trigger events
(`trigger-find-in-entry`, `trigger-split-orientation`) are in
`HANDLED_WEB_EVENTS`, so `menu-actions.test.ts` / `menu-bar.test.tsx` still prove
no menu item is dead on web, and the Electron `view-action → trigger-${action}`
bridge (`GlobalIPCManager.dispatchViewAction`) routes them identically.

---

## Menu reorder + runtime verification — 2026-05-24b

Owner-specified menu order implemented (13 menus), driven by the shared
`menuSpec.js` on both targets:

**File · Edit · Search · View · Go · Insert · Format · Topic · Entry ·
Category · User · Tools · Help**

- Find/Replace moved to **Search**; User Accounts → its own **User** menu;
  **Topic** menu added (Assign Topics + Manage Topics); plugins + Options under
  **Tools**; **Help** restored as the last menu.
- **Web action dispatch is now a pure, unit-tested resolver** (`src/lib/
  menuActions.ts` `resolveWebMenuAction`). `menu-actions.test.ts` asserts every
  menu leaf resolves to a real behaviour AND every resolved `trigger-*` event is
  in `HANDLED_WEB_EVENTS` (a registered listener) — so **no menu item is dead on
  web**. `menu-spec.test.ts` asserts the 13-menu order + no accelerator conflicts.
- **Fixed the reported "Install Plugin fails on web"**: it was wrongly
  desktop-only. It now opens Settings → Plugins (PluginsSection), which POSTs to
  `/api/plugins`. New web equivalents: install/open-plugins, restore, manage
  users, manage topics, change password.
- **Runtime-verified on a live `npm run dev` server** (not just static checks):
  `/api/health` 200; `/api/plugins`,`/api/topic`,`/api/users` registered (401
  unauth); authenticated end-to-end **plugin install returned
  `{"installed":...}` and topic create/list/delete worked**. Runtime testing
  caught a real bug — topic create requires `color` — now fixed in
  `ManageTopicsModal` (color picker).
- 800 tests, tsc + ESLint(0 errors) + `npm run build` all clean.

### Every item now does real work on web + GUI-level verification (2026-05-24c)

Closed the remaining "desktop-only dialog" items so they perform real actions on
web (no dead-ends):
- **Exit** → logs out (ends session) on web; `role:quit` on Electron.
- **Check for Updates** → fetches `/api/health` version + GitHub latest release and
  reports; native updater on Electron.
- **Set up Automatic Login** → opens Settings (account prefs) on web.
- **New / Open Journal Volume** → opens a real **Journal Volumes** modal that lists
  server volumes via `/api/journals` (live-switching the active DB on a *shared*
  web server is unsafe — it's one process/one DB — so that stays a deployment
  concern, surfaced honestly in the modal). Electron switches volumes live.

**GUI-level verification added** (`tests/features/menu-bar.test.tsx`, jsdom +
@testing-library/react): renders the real `<MenuBar/>`, opens every top menu,
**clicks every leaf item, and asserts the correct side-effect fires** — the
"click through the rendered menus" check, done headlessly. Plus live-server
runtime checks: authed plugin install (`{"installed":…}`), topic CRUD,
`/api/journals` (volumes), `/api/health` (version) all returned 200.

803 tests, tsc + ESLint(0 errors) + `npm run build` all clean.

### Plugins: bundled-in + discoverable (2026-05-24d)

Owner reported the two first-party plugins "fail to fetch" and there was "no
clear way to use" them. Neither plugin calls `fetch()`, so a failure affecting
both was the **plugin load path** (empty/unavailable filesystem plugin dir).
Fixes:
- **Bundled into the app**: `scripts/gen-bundled-plugins.js` generates
  `src/lib/bundledPlugins.ts` (drawio + sentence-diagrammer as embedded,
  JSON-escaped scripts). `Editor.tsx` now executes the bundled plugins on load
  (merged by id with any `/api/plugins`-installed copies) — so they **always
  load on web AND Electron with zero runtime fetch**. Verified by
  `bundled-plugins.test.ts`: both scripts execute in jsdom and register an
  editor extension + a labelled toolbar button, no throw.
- **Clear way to use**: the editor toolbar now shows a labelled **"Plugins"**
  group with each plugin button's name (not a bare icon); Settings → Plugins
  gained a "How to use" note pointing at that toolbar group.
- 806 tests, tsc + ESLint(0 errors) + build clean.

### A dedicated Plugins menu (2026-05-24e)

Owner couldn't find how to access plugins ("many add a plugin menu"). Added a
top-level **Plugins** menu (order is now …Tools · **Plugins** · Help) on both
targets, from the shared spec:
- **Insert Draw.io Diagram** / **Insert Sentence Diagram** — runs the bundled
  plugin's action directly (`run-plugin-<id>` → `trigger-run-plugin` CustomEvent →
  Editor invokes that plugin's registered button `onClick(editor)`).
- **Install Plugin… · Manage Plugins… · Open Plugins Folder** (moved here from
  Tools).
Verified by GUI test: clicking "Insert Draw.io Diagram" dispatches
`trigger-run-plugin` with `id: "drawio"`. 808 tests, tsc + ESLint(0) + build clean.

### Sentence Diagrammer rewritten → LexiGraph (2026-05-24h)

Replaced the static 3-slot sentence-diagram plugin with **LexiGraph**, an
interactive Reed-Kellogg canvas per the owner's design spec
(`plugins/sentence-diagrammer/main.js`, vanilla JS + SVG — plugins run via
`new Function`, no bundler):
- **Word bank**: regex tokenizer → draggable chips; placed chips dim to 0.3 as a
  checklist; click a placed chip to unplace.
- **Magnetic canvas**: lines (Baseline/Modifier/Vertical/Pedestal/Fork/Prep.
  Phrase) created from a left toolbar or B/M/V keys. Dragging a chip runs a
  perpendicular-projection proximity check; within 30px a **ghost preview**
  shows where it lands; drop attaches it as a slot at the projected position.
  Lines auto-grow to fit words; pan (drag bg) + wheel-zoom.
- **Inspector**: angle/length sliders, add/clear vertical dividers, delete line.
- **History/keyboard**: undo/redo (Ctrl+Z/Y), B/M/V tools, Tab cycles bank
  chips, Enter auto-snaps, Esc closes. Export SVG.
- **Storage**: node stores normalized `state` JSON + a static `previewSvg`
  rendered inline in the entry; "Build/Edit diagram" opens the overlay.
- Verified by `sentence-diagram.test.ts`: tokenizer, the projection snapping
  math, nearest-line, preview SVG, AND an overlay-build + Save smoke test (Save
  emits `{state, previewSvg}` containing the placed word). Bundled via
  `gen-bundled-plugins.js`. 816 tests, tsc + ESLint(0) + build clean.

### Action debug logging (2026-05-24g)

Every action is now traceable in the console:
- `src/lib/actionLog.ts` `logAction(source, action, extra)` — called at each
  initiation point: menu bar (`MenuBar.runAction`), keyboard
  (`CommandDispatcher.runCommand`), Electron menu bridge
  (`GlobalIPCManager.dispatchViewAction`), context menu (`CtxItem`), plugin runs
  (`Editor.onRunPlugin`), and the Electron main process (`main.js`
  `sendViewAction` / `handleMenuAction`, logged to the terminal).
- `src/components/journal/ActionDebugLogger.tsx` (mounted in journal/layout)
  patches `window.dispatchEvent` to log EVERY `trigger-*` event centrally — so
  every action's firing shows as `[TJ event] trigger-… {detail}`.
- ON by default; silence with `localStorage.setItem('tjDebugActions','0')`.
- Tested by `action-log.test.tsx`. 810 tests, tsc + ESLint(0) + build clean.

### Editor right-click menu = J8 (2026-05-24f)

Rebuilt the editor right-click context menu (`Editor.tsx`) to match J8 exactly:
Cut · Copy · Paste · Paste as Text · Select All · — · Format Painter ·
Highlighter · — · Font… · Paragraph… · Background Color · Background Image · — ·
Tag Entry with Topic… · Insert ▸ (Attachment/Image/Hyperlink/Table/Horizontal
Line/Special Character/Bookmark) · Insert Template · — · Save Entry As… (F12) ·
Entry Information & Statistics. Each item is wired: clipboard via execCommand
(+async-clipboard paste fallback), Paste-as-Text/Highlighter/Topic/Insert*/
Entry-Info via existing triggers, Font/Paragraph/Template via their dialogs,
Format Painter via a new `trigger-format-painter` (toolbar), Background Color via
a highlight color picker, Background Image via a per-entry localStorage-persisted
URL applied to the editor area, Save As via `/api/entry/[id]/export?format=`.
808 tests, tsc + ESLint(0 errors) + build clean.

Note: drawio's editor still runs in an embedded `embed.diagrams.net` iframe
(its own network-error banner handles offline); bundling the full diagrams.net
app offline is out of scope. The plugin SCRIPT is bundled (always loads); the
external editor surface is drawio's design.

---

## Menu parity rebuild — 2026-05-24 (the menus now mirror J8)

Earlier work scattered actions into ad-hoc dropdowns; the menu structure did
not match J8. This pass rebuilt the menus from a **single shared spec**
(`src/lib/menuSpec.js` + `.d.ts`) consumed by BOTH targets, so they are
identical and match J8's nine menus exactly:

**File · Edit · View · Insert · Format · Tools · Categories · Entries · Go**

- **Electron**: `src/electron/main.js` `createMenu()` builds the native menu
  from the spec (`require('../lib/menuSpec')`).
- **Web**: `src/components/journal/MenuBar.tsx` renders the same spec as an
  in-app menu bar (mounted in `journal/layout.tsx`); the legacy TabBar
  File/View dropdowns are disabled to avoid a duplicate menu. Electron hides the
  web bar and uses its OS-native menu (exactly like J8).

Every leaf action is wired to a working handler on both targets (verified: no
dead items; `menu-spec.test.ts` asserts the 9 menus, all leaves have actions,
and there are no accelerator conflicts). New endpoints/UI added to make items
functional: `/api/users` + `/api/users/[id]` + `ManageUsersModal` (Manage
Users), `/api/entry/[id]/move-category` (Move Entry to Category), Font
Properties & Paragraph Adjustments dialogs, category view-mode actions, tab
orientation (top/bottom/vertical), main/status-bar toggles, sidebar
left/right/hidden, restore-on-web, auto-login, print setup/preview.

Honest minimal/compliant notes (don't oversell):
- **Tabs Navigation**: Top = normal; Bottom = tab strip flex-ordered below the
  content (no overlay); Vertical = tabs stacked as an in-place column (a minimal
  compliant take, NOT the full vertical category-tree redesign CLAUDE.md defers).
- **Sync Category**: informational dialog — no external sync service exists.
- **Move Entry to Category**: works, but refuses moves across a password-locked
  category (encryption boundary) and uses a minimal prompt (the list shows
  `id: name`); a real picker modal would be the polish step.
- **Manage Users**: real list/add/delete CRUD over `/api/users`; no extra
  per-user data isolation beyond the existing per-UserID scoping.
- **Font/Paragraph dialogs**: real dialogs backed by the same TipTap commands the
  toolbar already uses.
- **Print Setup/Preview**: both route to the existing print-render flow (the
  browser/OS print dialog provides the preview); no separate setup dialog.

---


_Generated 2026-05-23. Audits the current web + Electron app against the J8
menu structure supplied by the owner. Status verified against source, not
memory._

## How to read this

- **Status**: `PRESENT` (works on both targets) · `PARTIAL` (backend or
  partial UI; a real gap remains) · `MISSING` · `N-A` (doesn't map to a
  web/Electron app) · `DEFERRED` (previously a deliberate non-goal — see
  bottom; reconfirm before building).
- **Both targets**: the **web** app exposes app-level menus through the
  in-app **TabBar dropdowns** (`src/components/journal/TabBar.tsx`); the
  **Electron** app adds a **native menu** (`src/electron/main.js`). "Web vs
  Electron" notes where the two diverge. OS-level concerns (process exit,
  clipboard roles) only exist in Electron.

---

## 1. File menu

| J8 item | Status | Evidence | Web vs Electron | Recommendation |
|---|---|---|---|---|
| New Journal Volume… | **MISSING** | Only "Open Another" exists (`main.js:448`) | — | Add create-new-`.tjdb` flow (Electron menu + IPC; web: N-A or admin-only) |
| Open Journal Volume… | PRESENT | `lib/journals.ts`, `api/journals/route.ts`, `main.js:448` | Electron native; web via `/api/journals` | OK |
| Backup Journal Volume… | PRESENT | `api/backup/export`, `main.js:402`, auto-backup on close | Both | OK |
| Restore Journal Volume… | PRESENT | `api/backup/import`, `main.js:388` | Both (web FormData / Electron path) | OK |
| Check Integrity & Repair… | **MISSING** | no `PRAGMA integrity_check`/`quick_check` anywhere | — | Add `/api/db/integrity` (PRAGMA integrity_check) + menu item |
| Optimize/Defragment DB… | **MISSING** | no `VACUUM` anywhere | — | Add `/api/db/optimize` (VACUUM + `PRAGMA wal_checkpoint`) + menu |
| Log In as Different User… | PARTIAL | logout `actions.ts:74`; no in-app switch | Both | Add "Switch User…" → logout+login route (low effort) |
| Manage Users… | **DEFERRED?** | User table exists; no admin UI | — | Multi-tenant admin — see "Open scope decisions" |
| Change Password… (user login) | **MISSING** | only **category** password rotation (`api/category/[id]/lock`) | — | Add `/api/user/password` (verify old, re-hash Argon2id). Note: at-rest key is SQLCipher-derived from `JOURNAL_DB_SECRET`, not the user password, so no bulk re-encryption is needed — document that difference |
| Set up Automatic Login… | PRESENT | `main.js` safeStorage + `login/page.tsx` | Electron full; web pre-fills username only (no secure browser store) | OK; document web limitation |
| Print Setup / Print Preview | N-A / PARTIAL | OS handles setup; print route renders HTML | Electron `printToPDF`; web `/api/entry/[id]/print` | Optional: add a Print Preview window |
| Print Entries… (Ctrl+P) | PRESENT | `main.js:428`, `api/entry/[id]/print`, `lib/printRender.ts` | Both | OK |
| Exit | PRESENT | `main.js:462` role:quit | Electron only | OK |

---

## 2. Edit menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| Undo / Redo (Ctrl+Z / Ctrl+Y) | PRESENT | `main.js:468`, `commands.ts:41` | OK |
| Cut / Copy / Paste | PRESENT | `main.js:471` roles; browser-native on web | OK |
| **Paste Special** (unformatted) | **MISSING** | no plain-text paste path | Add Ctrl+Shift+V → `insertContent(text)` stripping marks |
| Select All (Ctrl+A) | PRESENT (native) | browser/Electron default | OK (optionally add to registry) |
| Find (Ctrl+F) | PRESENT | `commands.ts:43`, `main.js:590`, `SearchPanel.tsx` | OK |
| **Find Next (F3)** | **MISSING** | no F3 / "find again" | Add F3 to advance SearchPanel match cursor |
| Replace (Ctrl+H) | PARTIAL | `ReplacePanel.tsx` exists; no Ctrl+H accelerator | Bind Ctrl+H in commands + Electron menu |

---

## 3. View menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| Toolbars (toggle Main/Format/Status) | **MISSING** | floating-toolbar flag only (`Editor.tsx:162`) | Add Settings toggles + persist; status-bar (footer) toggle |
| Sidebar Layout (Left/Right/Hidden) | PARTIAL | sidebar fixed-left; Focus mode hides it | Add Left/Right/Hidden setting |
| Category Tabs Navigation (Top/Bottom/Vertical tree) | PARTIAL | horizontal TabBar only | Vertical tree = **DEFERRED** category-tree item; Top/Bottom is cheap |
| Distraction-Free / Focus (F11) | PRESENT | `Editor.tsx:376`, `main.js:605` | OK |
| Split Screen | PRESENT (vertical) | `Editor.tsx:399`, `main.js:610` (Ctrl+\\) | Horizontal split optional |
| Refresh View (F5) | PARTIAL | Electron hard-reload (`main.js:586`) | Add soft refresh (re-fetch lists) on F5 |

---

## 4. Go menu  ⚠️ ENTIRE MENU ABSENT IN ELECTRON

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| Today (Ctrl+T) | **MISSING + BUG** | Ctrl+T bound to **Toggle Theme** (`main.js:651`) | Rebind theme→Ctrl+Shift+T (or keep in View only); add Today=Ctrl+T jumping to today's entry |
| Go to Date… (Ctrl+G) | **MISSING** | sidebar month grid only; no jump dialog | Add mini-calendar jump modal, Ctrl+G |
| Previous / Next Entry (Ctrl+←/→) | **MISSING** | no sequential nav shortcut | Add nav commands over the current entry list ordering |
| Back / Forward in History | **MISSING** | `Breadcrumbs.tsx` shows path, no stack | Add visited-entry stack + Alt+←/→ |

---

## 5. Insert menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| File Attachment (arbitrary file) | **MISSING** | only image/video upload | Add generic attachment (uses existing `Attachment` table / `lib/audio.ts` pattern) |
| Image / Photo | PRESENT | `TipTapToolbar.tsx` upload+URL+drawing+crop | OK |
| Hyperlink (Ctrl+K) | PARTIAL | button uses `window.prompt`; `insert.link` command not dispatched (`CommandDispatcher`) | Wire Ctrl+K; replace prompt with a proper link dialog |
| Table | PRESENT | toolbar grid picker + row/col ops | OK |
| Horizontal Line | PRESENT | toolbar | OK |
| **Special Character / Symbol** | **MISSING** | no picker | Add symbol/emoji picker dialog + toolbar button |
| Bookmark (anchor + jump) | PARTIAL | `extensions/Bookmark.ts` + set/link buttons; no "jump to bookmark" list | Add a bookmark list / go-to UI |

---

## 6. Format menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| Font Properties (family + size) | PRESENT | font family + size dropdowns | OK |
| **Paragraph Adjustments** (align/line-spacing/indent) | **MISSING** | TextAlign extension installed but **no toolbar buttons**; no line-height; no indent/outdent | Surface 4 alignment buttons; add indent/outdent (lists) + line-spacing |
| Styles (Normal/H1/H2/custom) | PARTIAL | H1–H3 buttons; no unified style dropdown | Add a "Style" dropdown (Normal, H1–H3, Quote, Code) |
| Bullets & Numbering | PRESENT | bullet/ordered/task lists | OK |
| Text Color / Highlight | PRESENT | color + highlight pickers | OK |
| _(Subscript / Superscript)_ | PARTIAL | extensions installed, **not in toolbar** | Add buttons (cheap) |

---

## 7. Tools menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| Search Across All Categories (Ctrl+Shift+F) | PRESENT | `SearchPanel.tsx`; verify Ctrl+Shift+F accelerator | Confirm/global-bind the accelerator |
| Global Find & Replace | PRESENT | `ReplacePanel.tsx`, `api/search/replace` | OK |
| Reminders & Tasks Manager | PRESENT | `RemindersPanel.tsx`, `api/reminder/*` | OK |
| Word Cloud & Text Statistics | PRESENT | `WordCloudPanel.tsx`, `StatsPanel.tsx` | OK |
| Writing Prompts Generator | PRESENT | `WritingPromptsPicker.tsx`, `lib/prompts.ts` | OK |
| Memory Inclusions / On This Day | PRESENT | `OnThisDayPanel.tsx`, `api/on-this-day` | OK |
| Options / Preferences | PRESENT | `SettingsModal.tsx`, `api/settings` | OK; spellcheck toggle worth confirming |

---

## 8. Categories menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| New Category (Ctrl+Shift+N) | PARTIAL | modal in `TabBar.tsx`; no hotkey | Add Ctrl+Shift+N |
| Category Properties (Ctrl+Shift+P) | PARTIAL | `CategorySettingsModal.tsx` (sort, template, smartbook, password); no hotkey | Add hotkey (note Ctrl+Shift+P already = Writing Prompts → pick another) |
| Delete Category | PRESENT | `TabBar.tsx` delete handler (confirm + cascade) | OK |
| Import Entries (per-category) | PARTIAL | DB-level import only | Add per-category RTF/HTML/TXT import |
| Export Entries (RTF/HTML/TXT) | PRESENT | `api/category/[id]/export?format=` (md/rtf/html/txt/atom) | OK |
| Sync Category | **DEFERRED** | none | External sync out of scope — reconfirm |
| View Category as Calendar | **MISSING** | no calendar grid (the "On this day" Calendar icon is unrelated) | Build month calendar view bound to entry dates |
| View Category as Loose-leaf (tree) | PARTIAL | Sidebar renders parent/child tree already | Add explicit per-category calendar/loose-leaf mode toggle |

---

## 9. Entries menu

| J8 item | Status | Evidence | Recommendation |
|---|---|---|---|
| New Entry (Ctrl+N) | PRESENT | `commands.ts`, CommandDispatcher | OK |
| New Sub-Entry (Ctrl+Shift+Enter) | PARTIAL | Sidebar supports `parentEntryId` creation + tree; no labeled "New Sub-Entry" + hotkey | Add explicit action + Ctrl+Shift+Enter |
| Save Entry (Ctrl+S) | PARTIAL | autosave only; no explicit Ctrl+S | Add Ctrl+S = flush save (UX reassurance) |
| Delete Entry (Ctrl+Del) | PRESENT | `lib/trash.ts` soft-delete + restore | OK (optionally bind Ctrl+Del) |
| **Entry Properties** (counts, timestamps, edit trail) | **MISSING** | footer shows word count + reading time only (`Editor.tsx:1150`) | Add Properties dialog: char/word counts, created/modified, category path |
| Lock / Unlock Entry | **PRESENT** | per-entry AES-GCM (`api/entry/[id]/lock`, `lib/entryCrypto.ts`, `entryLock.ts` write-guard, `LockGate.tsx`, `security.lock` Ctrl+Shift+L) | OK — _earlier audits mis-flagged this; it is fully per-entry_ |
| Assign Topics | PRESENT | `api/entry/[id]/topic`, hierarchical topics | OK |
| Move Entry to Category | PRESENT | `api/entry/move` (parent + cycle guards) | OK |
| Sort Sub-Entries | PARTIAL | category-level SortMode; drag reorder in sidebar | Add per-parent sort action |

---

## Bugs / defects found during audit

1. **Ctrl+T conflict** — `main.js:651` binds Ctrl+T to Toggle Theme; J8 reserves
   Ctrl+T for "Today". (Also Toggle Theme accelerator collides with the
   eventual Go>Today.) **Fix when adding Go menu.**
2. **No Go menu in Electron** — navigation entirely absent from the native menu.
3. **Ctrl+Shift+P double-bound** — `insert.prompt` (Writing Prompts,
   `commands.ts:72`) and J8's Category Properties both want it.
4. **`insert.link` command defined but not dispatched** — Ctrl+K does nothing
   (`CommandDispatcher` triggerMap omits it).
5. **F5 hard-reloads** the whole Electron window instead of refreshing data.

(Verify list — confirm each during implementation; #1, #2, #4 confirmed in source.)

6. **[FIXED] Pre-existing Windows test failure** — `server-plugins.test.ts`
   asserted `getPluginDir()` equals a POSIX literal `/var/lib/...`; on Windows
   `path.resolve` drive-prefixes it. Test now compares against `resolve(input)`.
   Baseline was 755/756; now 756/756.

---

## Previously DEFERRED (CLAUDE.md "intentionally NOT done") — reconfirm before building

These were past deliberate non-goals. The new goal text superficially asks for
"all gaps"; surfacing for an explicit decision rather than silently reversing:

- **Hierarchical CATEGORY tree** (vertical tab tree / "View as Loose-leaf" at
  the category level). Entry hierarchy works; category nesting needs a vertical
  redesign of TabBar.
- **Customizable Electron menus**, drag-to-reorder toolbar, block-level tagging.
- **Outlook integration; Penzu/Diaro/WordPress importers; Category Sync.**
- **macOS / Linux Electron targets, code signing.**

---

## Assumptions (decided defaults, owner may override)

The goal says "note [ambiguous features] in a markdown for later decision but
try your best to have both." These are the defaults I proceeded with, chosen to
honor the existing CLAUDE.md "intentionally NOT done" list rather than silently
reverse it:

1. **Multi-user / Manage Users** → **stay deferred**. Build only "Switch User"
   (logout→login, trivial) and user "Change Password" (Argon2id re-hash). No
   admin panel. (Single-active-user-per-session is the documented design.)
2. **Category Sync** → **deferred** (external sync out of scope).
3. **Vertical category tree / "View Category as Calendar / Loose-leaf" toggle**
   → **deferred**. All three need the same vertical-TabBar redesign that
   CLAUDE.md defers. Entry-level hierarchy already works.
4. **New Journal Volume** → **Electron-only** (filesystem/admin operation). Web
   self-host manages volumes at the deployment layer; documented as a web
   limitation.

---

## Proposed implementation order (clear, non-deferred gaps)

**Wave A — editor (highest user-visible value, lib-testable):**
Paragraph alignment + indent + line-spacing · Subscript/Superscript buttons ·
Styles dropdown · Hyperlink dialog + Ctrl+K · Special Character picker ·
Bookmark jump · Paste Special · File Attachment.

**Wave B — navigation:** Go menu (Electron) + web equivalents · Today (fix
Ctrl+T) · Go to Date · Prev/Next entry · Back/Forward history · Find Next (F3) ·
Replace Ctrl+H.

**Wave C — database/admin:** Check Integrity & Repair · Optimize/Defragment ·
Change Password (user) · Switch User · New Journal Volume.

**Wave D — entries/categories:** Entry Properties dialog · New Sub-Entry action +
hotkey · Save Ctrl+S · Calendar view · per-category Calendar/Loose-leaf toggle ·
per-category import.

**Wave E — view:** Toolbar visibility toggles · Sidebar Left/Right/Hidden ·
soft F5 refresh.

Each wave lands with tests (`tests/features/*.test.ts`) per repo convention.

---

## Implementation status — 2026-05-23 session

Baseline before work: 755/756 (one pre-existing Windows path-test failure).
After work: **774/774 green**, `tsc --noEmit` clean.

### Landed (web + Electron)

**Wave 0 — bug fix:** Electron `Toggle Theme` moved off Ctrl+T → `Ctrl+Shift+D`,
freeing Ctrl+T for Go > Today.

**Wave A — editor formatting** (`TipTapToolbar.tsx`):
- Text alignment (left/center/right/justify) buttons (TextAlign was installed but unsurfaced).
- Subscript / Superscript buttons (extensions were installed but unsurfaced).
- List indent / outdent (sink/lift list item).
- Styles dropdown (Normal / H1–H3 / Quote / Code block) replacing the bare H1/H2/H3 buttons.
- Special Character / Symbol picker (`src/lib/specialChars.ts` catalogue + grid dropdown).
- Bookmark "jump to" dropdown (lists anchors in the entry, scrolls to one).
- Hyperlink: Ctrl+K now dispatches to the link action (was a dead command).
- Paste Special — `Ctrl+Shift+V` plain-text paste.

**Wave B — navigation** (`navOrder.ts`, `JournalView.tsx`, `Sidebar.tsx`, Electron Go menu):
- New Electron **Go** menu (was entirely absent).
- Today (Ctrl+T), Go to Date modal (Ctrl+G), Previous/Next entry (Ctrl+PageUp/PageDown),
  Back/Forward (Alt+←/→ via browser history), Find Next (F3 opens search),
  Replace (Ctrl+H opens the Replace panel).

**Wave C — DB / admin** (`dbMaintenance.ts`, `userPassword.ts`, routes, both menus):
- Check Integrity & Repair (`PRAGMA integrity_check`) → `GET /api/db/integrity`.
- Optimize / Defragment (`wal_checkpoint` + `VACUUM`) → `POST /api/db/optimize`.
- Change Password (Argon2id re-hash) → `POST /api/user/password`.
- Switch User (logout → login). All surfaced in the Electron File menu and the web TabBar file menu.

**Wave D — entries** (`entryProperties.ts`, `Editor.tsx`, `Sidebar.tsx`):
- Entry Properties dialog (title, id, created/modified, word/char counts, reading time) — footer ⓘ button + `trigger-entry-properties`.
- New Sub-Entry (Ctrl+Shift+Enter) — child page under the current entry.
- Save (Ctrl+S) — flushes the autosave buffer explicitly.

**Wave E — view:** Show/Hide Sidebar (Ctrl+Shift+B, persisted) + Electron View-menu item.

### Remaining / explicitly deferred (documented, not built)

- **DEFERRED per CLAUDE.md** (unchanged): hierarchical category tree / vertical tabs /
  "View as Calendar / Loose-leaf" toggle, Manage-Users admin panel, Category Sync,
  macOS/Linux Electron targets.
- **Soft F5 refresh**: Electron F5 hard-reloads — functionally a refresh; left as-is.

## Implementation status — 2026-05-24 session (remaining gaps closed)

Goal: "fully bridge the gap, ensure both [desktop] and web have all of them."
(Clarified: "android" = the Electron desktop client; this is a single Next.js
codebase so features land on web + Electron together.) **791/791 green**
(1 known flaky stress test passes in isolation), `tsc` + ESLint clean,
`npm run build` clean.

- **Wave F — File Attachment** (`uploadPolicy.classifyFile`, `/api/upload/file`,
  `extensions/FileAttachment.ts`, attachment route `?download=1`, toolbar paperclip):
  attach any file type; renders a download-link chip. Both targets via HTTP.
- **Wave G — Paragraph adjustments** (`lib/paragraphStyle.ts`,
  `extensions/ParagraphStyle.ts`): line-spacing dropdown + block indent/outdent
  (toolbar indent buttons are now list-aware: sink/lift in lists, block-indent
  otherwise). Both targets.
- **Wave H — Per-category import** (`lib/importEntries.ts`,
  `/api/category/[id]/import`, TabBar "Import entries"): TXT/HTML/RTF → entries
  (RTF is best-effort text extraction; HTML sanitised). Honours category lock.
- **Wave I — view + volumes:** Sidebar Left/Right + Show/Hide, Show/Hide formatting
  toolbar (web View menu + Electron View menu + persisted). **New Journal Volume**
  (Electron save-dialog) + **fixed "Open Another Journal"** which was a dead no-op
  (it messaged the renderer, but the embedded Next server reads `JOURNAL_DB_PATH`
  at startup); both now persist `dbPath` to settings and `app.relaunch()`.

New tested libs: `specialChars`, `navOrder`, `dbMaintenance`, `userPassword`,
`entryProperties`, `uploadPolicy.classifyFile`, `paragraphStyle`, `importEntries`.

## Verification audit — 2026-05-24 (skeptical re-check)

A pass to confirm the claims above against source, find bugs, and correct
earlier mistakes. Wiring integrity verified: **every dispatched `trigger-*`
event has a live listener** (no dead keybindings).

**Corrections to earlier claims:**
- **Calendar view EXISTS** (earlier doc wrongly said MISSING). It is the
  `Journal` category type — `Sidebar.tsx` renders a full month-calendar widget
  for `type === 'Journal'` and the loose-leaf page tree for `type === 'Notebook'`.
- **Category view-mode toggle — NOW CLOSED.** Added `type` to the category PUT
  schema/route + a "View mode" selector in `CategorySettingsModal` (Calendar ↔
  Loose-leaf). Entries are untouched; only the render mode changes.

**Bug fixed during audit:**
- `ParagraphStyle.setLineHeight/unsetLineHeight` used
  `types.every(updateAttributes)`, which returns `false` for the non-active
  block type and made success ambiguous. Rewritten to target only the active
  block type.

**Honest remaining gaps (precise):**
- **In-entry Find / Find Next / highlight** — *paradigm difference, not a missing
  feature.* J8's Ctrl+F finds within the open entry (F3 = next match). This app
  binds Ctrl+F to a **global cross-entry SearchPanel** (regex, filters, saved
  searches) — broader, but it does not highlight/cycle matches inside the open
  entry. Changing Ctrl+F to in-entry find would *regress* the global search, so
  this is left as a deliberate design difference. (F3 currently opens that
  search panel; it does not cycle matches.)
- **Split screen** is one orientation (stacked top/bottom); J8 also offers
  side-by-side. Minor.
- **View > Toolbars** — formatting-toolbar show/hide shipped; J8's separate
  Main-toolbar and Status-bar toggles are not split out. Minor.
- **Print Preview** — no dedicated preview window (print + PDF export exist; the
  OS/browser print dialog provides preview). Minor.
- **Hyperlink** uses the native `window.prompt`, not a styled in-app dialog.
  Functional; cosmetic gap.
- **DEFERRED per CLAUDE.md (unchanged, need owner decision to reverse):**
  hierarchical category tree / vertical category tabs, Manage-Users admin panel,
  Category Sync (external), macOS/Linux Electron targets.

**Runtime boundary (unchanged):** editor extensions and menu flows are verified
by types/lint/build and lib tests, not click-tested. TipTap APIs used
(`updateAttributes`, `resetAttributes`, `sinkListItem`, `setHeading`) confirmed
present in the installed packages; spellcheck is enabled on both editors.

### Web vs Electron deviations (intentional)

- Prev/Next entry uses **Ctrl+PageUp/PageDown** instead of J8's Ctrl+Left/Right, which
  collide with word-caret movement in a web contentEditable.
- Back/Forward ride the **browser history stack** (Alt+←/→).
- New Journal Volume / multi-volume creation is Electron-only (web manages volumes at the
  deployment layer).
