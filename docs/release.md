# Release workflow

For maintainers shipping a new version of TheJournal. Tag-driven; the
GitHub Actions workflow does the actual build.

## One-time setup

1. Confirm `electron-builder.yml` `publish.owner` / `publish.repo` point
   at the right GitHub repository. The repo must allow GitHub Actions to
   create Releases (Settings → Actions → General → Workflow
   permissions → "Read and write permissions").
2. Add the `electron-updater` dependency (already in package.json on this
   branch).

No code signing certificates are wired in yet — Windows users will see
SmartScreen "Unrecognized app" on first run until you add a code-signing
cert (out of scope here; see [electron-builder
docs](https://www.electron.build/code-signing.html)).

## Cutting a release

```bash
# 1. Bump the version (semver). Use `npm version` so package.json,
#    package-lock.json, and git are updated atomically.
npm version patch          # or `minor` / `major` / `1.2.3` (exact)

# 2. Push the tag. `npm version` creates a `vX.Y.Z` tag locally; push it.
git push && git push --tags

# 3. The release workflow (.github/workflows/release.yml) triggers on
#    the tag, builds the Windows NSIS installer on a windows-latest
#    runner, and uploads:
#       - TheJournal Setup vX.Y.Z.exe
#       - latest.yml      (electron-updater manifest)
#    to the GitHub Release.
```

That's it. Running TheJournal installations will pick up the new
version on their next 6-hourly auto-update check, or immediately if
the user hits Help → "Check for Updates…".

## What the user sees

- 60 seconds after launch, `autoUpdater.checkForUpdatesAndNotify()`
  fires. If the published `latest.yml` reports a higher version, it
  downloads the new installer in the background.
- When the download completes, a dialog appears: "Update ready —
  Restart now / Later". Clicking Restart now calls
  `autoUpdater.quitAndInstall()`.

## Verifying a release

After CI finishes:

1. Open the GitHub Release page in the browser. Confirm both files are
   attached: `TheJournal Setup vX.Y.Z.exe` and `latest.yml`.
2. On a clean Windows VM, install the **previous** version, run it,
   then trigger Help → "Check for Updates…". You should see the
   download progress in the dialog, then the restart prompt.
3. After restart, Help → "About TheJournal" should display the new
   version number.

## Hot-fix release

For an urgent patch on the current stable line:

1. Branch from the previous tag: `git checkout -b hotfix/X.Y.Z vX.Y.(Z-1)`.
2. Cherry-pick or write the fix.
3. `npm version patch && git push && git push --tags`.
4. CI builds and uploads; auto-update reaches users within 6 hours.

## Rolling back

`electron-updater` doesn't support automatic downgrade. If a release
ships broken:

1. Delete the bad GitHub Release (or mark it as a draft).
2. The corresponding tag stays in Git but the workflow re-runs idempotently if you delete the Release artifacts.
3. Cut a new patch version that contains the fix. Users on the broken
   build will update again on next check.

## What gets cached in CI

The release workflow caches `node_modules/` keyed on
`package-lock.json` so subsequent runs are 2-3 minutes instead of
6-7. If a release fails with native-binding errors, clear the cache
from the GitHub Actions UI and re-run.
