/**
 * Regenerates src/lib/bundledPlugins.ts from the first-party plugins under
 * plugins/<id>/ (manifest.json + main.js). Run after editing a bundled plugin:
 *
 *   node scripts/gen-bundled-plugins.js
 *
 * The plugin scriptContent is JSON-escaped, so template literals / quotes in the
 * plugin source survive intact.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLED_IDS = ['drawio', 'sentence-diagrammer'];

const entries = BUNDLED_IDS.map((id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', id, 'manifest.json'), 'utf8'));
    const scriptContent = fs.readFileSync(path.join(ROOT, 'plugins', id, 'main.js'), 'utf8');
    return { id, manifest, scriptContent };
});

const header = `/**
 * Bundled-in plugins (drawio, sentence-diagrammer). Generated from plugins/<id>/
 * by scripts/gen-bundled-plugins.js — DO NOT EDIT BY HAND; re-run the script.
 *
 * These ship inside the app bundle so the first-party plugins ALWAYS load on
 * both web and Electron with no runtime /api fetch (fixes "fail to fetch" when
 * the filesystem plugin dir is empty/unavailable). User-installed plugins are
 * still loaded from /api/plugins and merged on top (by id).
 */
export interface BundledPlugin { id: string; manifest: { id: string; name: string; version: string; description?: string }; scriptContent: string; }

export const BUNDLED_PLUGINS: BundledPlugin[] = `;

fs.writeFileSync(
    path.join(ROOT, 'src', 'lib', 'bundledPlugins.ts'),
    header + JSON.stringify(entries, null, 2) + ';\n',
);
console.log('Regenerated src/lib/bundledPlugins.ts from', BUNDLED_IDS.join(', '));
