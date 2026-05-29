# DavidRM "The Journal 8" — Gap Analysis & Parity Audit

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
