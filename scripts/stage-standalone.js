#!/usr/bin/env node
/**
 * Stage the Next.js standalone build so `node .next/standalone/server.js`
 * can serve the app end-to-end without any extra setup.
 *
 * `next build` with `output: 'standalone'` produces:
 *
 *   .next/standalone/
 *     server.js
 *     node_modules/          (file-traced subset)
 *     .next/
 *
 * But it deliberately leaves out:
 *   - .next/static/   (immutable assets served from /_next/static)
 *   - public/         (favicon, fonts, etc.)
 *   - plugins/        (TheJournal-specific: user-installed plugin folders)
 *
 * Next.js docs say "copy these manually". We copy them as part of the
 * build script so `npm run build` produces a complete, runnable bundle.
 */

const fs = require('fs');
const path = require('path');
const { assertStandaloneSafe } = require('./verify-standalone');

const root = path.resolve(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

function copyDirSync(src, dest, { optional = false } = {}) {
    if (!fs.existsSync(src)) {
        if (optional) {
            console.log(`[stage-standalone] skipping ${path.relative(root, src)} (not present)`);
            return;
        }
        throw new Error(`Source directory missing: ${src}`);
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[stage-standalone] copied ${path.relative(root, src)} → ${path.relative(root, dest)}`);
}

if (!fs.existsSync(standalone)) {
    console.error(`[stage-standalone] .next/standalone/ doesn't exist yet — run \`next build\` first.`);
    process.exit(1);
}

// /_next/static/ is served at /_next/static/* — Next.js looks for it
// next to server.js at .next/static.
copyDirSync(
    path.join(root, '.next', 'static'),
    path.join(standalone, '.next', 'static'),
);

// public/ is served at the root. Required for favicon, robots.txt, etc.
copyDirSync(
    path.join(root, 'public'),
    path.join(standalone, 'public'),
);

// plugins/ is TheJournal-specific. The web plugin API reads from
// $JOURNAL_PLUGINS_DIR (default <cwd>/plugins/). When the operator runs
// `node .next/standalone/server.js`, the cwd is .next/standalone, so we
// stage the repo's bundled plugin folder there too. Operators can
// override via JOURNAL_PLUGINS_DIR.
copyDirSync(
    path.join(root, 'plugins'),
    path.join(standalone, 'plugins'),
    { optional: true },
);

assertStandaloneSafe(standalone);

console.log('[stage-standalone] done. Start the server with `node .next/standalone/server.js`.');
