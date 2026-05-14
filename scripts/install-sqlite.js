/**
 * Rebuild the native SQLCipher binding against the Electron runtime that will
 * actually ship in the installer. Runs before `electron-builder` so the
 * packaged `node_modules/@journeyapps/sqlcipher/build/` directory contains a
 * binding compiled for Electron's V8 ABI rather than the host Node's.
 *
 * Previous versions hard-coded `better-sqlite3@12.6.2` (wrong package) and
 * `electron 33.2.1 / x64` (wrong version, wrong arch). The app uses
 * `@journeyapps/sqlcipher` and Electron is whatever package.json declares — we
 * read that here so the script can't drift again.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(repoRoot, 'package.json'));

const electronVersionRange = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
if (!electronVersionRange) {
    console.error('[install-sqlite] No `electron` entry in package.json');
    process.exit(1);
}
// Strip leading ^/~/= so npm_config_target gets a bare semver.
const electronVersion = electronVersionRange.replace(/^[^\d]*/, '');

const arch = process.env.npm_config_arch || process.arch;
const platform = process.env.npm_config_platform || process.platform;

console.log(`[install-sqlite] Rebuilding @journeyapps/sqlcipher for Electron ${electronVersion} (${platform}/${arch})`);

const result = spawnSync(
    'npx',
    [
        '--yes',
        '@electron/rebuild',
        '--force',
        '--version', electronVersion,
        '--arch', arch,
        '--only', '@journeyapps/sqlcipher',
    ],
    { cwd: repoRoot, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }
);

if (result.status !== 0) {
    console.error('[install-sqlite] @electron/rebuild failed');
    process.exit(result.status ?? 1);
}
console.log('[install-sqlite] Done.');
