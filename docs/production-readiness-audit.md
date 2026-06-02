# Production Readiness Audit (2026-06-02)

## Scope
- Verified the shared Next.js application used by both the standalone web bundle and the Electron desktop shell.
- Reviewed the Windows Electron release path (`package.json`, `electron-builder.yml`, and `.github/workflows/release.yml`).
- Re-ran lint, TypeScript checks, focused packaging regression tests, and the available Vitest suite in the audit environment.

## Fixed release blockers
1. **Electron release builds now compile the application before packaging**
   - `npm run build:installer` runs `npm run build:electron` before the packaging-only `npm run package:installer` step.
   - The tag-driven Windows release workflow can no longer invoke `electron-builder` against a checkout with no compiled `.next` application.
2. **Desktop installers now use a runtime-only allow-list**
   - `electron-builder.yml` no longer begins with `"**/*"`.
   - Installers include the compiled Next.js application, runtime dependencies, public assets, bundled plugins, Electron shell, and shared menu specification only.
   - Electron packages only the required `.next` runtime surface (`BUILD_ID`, root manifests, `server`, and `static`); nested standalone output, build caches, and diagnostics remain outside the installer.
   - Development databases, backups, tests, screenshots, docs, scripts, and other checkout-only files are outside the package boundary.
3. **Development database artifacts are no longer versioned**
   - The tracked `journal.db` and `journal.db.bak` files were removed. The existing `.gitignore` database rules prevent them from being added again.
4. **Standalone web output has an independent safety check**
   - The trace exclusion map uses the documented global `/*` route glob.
   - Staging fails if a standalone bundle contains database files or checkout-only top-level directories, even if tracing configuration regresses later.
5. **Release configuration has regression coverage**
   - A focused Vitest file asserts installer ordering, Electron package boundaries, the global trace glob, and standalone safety verification.

## Verification notes
- `npm run lint` completes with no errors. Existing warnings remain and should continue to be reduced, but they do not block the configured lint command.
- The full Vitest command remains partially blocked in this audit container because the prebuilt `@journeyapps/sqlcipher` binary requires `libcrypto.so.1.1`. CI installs the matching `libssl1.1` compatibility package before running tests.
- The focused desktop-packaging regression suite does not import SQLCipher and runs in the audit container.

## Remaining operational checks before a public desktop release
1. Run the Windows tag-driven release workflow and install the generated NSIS package on a clean Windows VM.
2. Confirm the packaged app starts, creates its journal under Electron `userData`, and loads bundled plugins.
3. Confirm a standalone web deployment starts from `.next/standalone/server.js` with production secrets configured as documented in `docs/env-vars.md`.
4. Add Windows code signing when distributing broadly; unsigned NSIS builds will trigger SmartScreen warnings.

## Conclusion
The web and Electron targets continue to use the same compiled Next.js application. The audited desktop release path now builds that application reliably and packages only required runtime files, eliminating both a broken-installer risk and an accidental local-data disclosure risk.
