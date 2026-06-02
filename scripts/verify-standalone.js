#!/usr/bin/env node
/**
 * Refuse to ship checkout-only data in the standalone web bundle. Next.js
 * output-file tracing is the first line of defense; this verification pass is
 * deliberately independent so a future tracing-config regression fails the
 * production build instead of publishing private data.
 */
const fs = require('fs');
const path = require('path');

const FORBIDDEN_TOP_LEVEL_DIRS = new Set([
    '.github',
    'deploy',
    'dist',
    'docs',
    'screenshot',
    'scripts',
    'src',
    'tests',
]);

function isDatabaseArtifact(name) {
    return /\.(?:db|tjdb|sqlite)(?:$|[-.])/i.test(name);
}

function findForbiddenStandaloneFiles(standaloneDir) {
    const root = path.resolve(standaloneDir);
    const forbidden = [];

    function walk(currentDir) {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);
            const relativePath = path.relative(root, fullPath);
            const topLevelDir = relativePath.split(path.sep)[0];

            if (FORBIDDEN_TOP_LEVEL_DIRS.has(topLevelDir)) {
                forbidden.push(`${relativePath}${entry.isDirectory() ? path.sep : ''}`);
                continue;
            }

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (isDatabaseArtifact(entry.name)) {
                forbidden.push(relativePath);
            }
        }
    }

    walk(root);
    return forbidden.sort();
}

function assertStandaloneSafe(standaloneDir) {
    const forbidden = findForbiddenStandaloneFiles(standaloneDir);
    if (forbidden.length > 0) {
        throw new Error(
            `Standalone bundle contains forbidden checkout artifacts:\n${forbidden.map(file => `  - ${file}`).join('\n')}`,
        );
    }
    console.log('[verify-standalone] bundle contains no forbidden checkout artifacts');
}

if (require.main === module) {
    const standaloneDir = process.argv[2];
    if (!standaloneDir) {
        console.error('Usage: node scripts/verify-standalone.js <standalone-directory>');
        process.exit(1);
    }
    assertStandaloneSafe(standaloneDir);
}

module.exports = { assertStandaloneSafe, findForbiddenStandaloneFiles, isDatabaseArtifact };
