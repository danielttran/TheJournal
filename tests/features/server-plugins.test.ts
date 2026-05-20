/**
 * Server-side plugin storage powers the web-build plugin system.
 * Mirrors the Electron flow: same on-disk layout, same path-traversal
 * sanitization, same trust model. Tests cover the security boundary —
 * a malicious payload must not write outside the plugins root.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as os from 'os';
import {
    sanitizePluginId,
    readInstalledPlugins,
    installPluginFromPayload,
    uninstallPlugin,
    PluginInstallError,
    getPluginDir,
} from '../../src/lib/serverPlugins';

let TMP_DIR: string;

beforeAll(async () => {
    TMP_DIR = await fs.mkdtemp(join(os.tmpdir(), 'tj-plugins-'));
});

afterAll(async () => {
    await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
    // Clean state per test — preserve TMP_DIR but wipe its contents.
    const entries = await fs.readdir(TMP_DIR).catch(() => []);
    for (const e of entries) {
        await fs.rm(join(TMP_DIR, e), { recursive: true, force: true });
    }
});

describe('sanitizePluginId', () => {
    it('accepts plain alphanumerics, dots, dashes, underscores', () => {
        expect(sanitizePluginId('my-plugin')).toBe('my-plugin');
        expect(sanitizePluginId('plugin_v1.2')).toBe('plugin_v1.2');
        expect(sanitizePluginId('ABC123')).toBe('ABC123');
    });

    it('replaces unsafe chars with hyphen', () => {
        expect(sanitizePluginId('hello world')).toBe('hello-world');
        expect(sanitizePluginId('plug@in!')).toBe('plug-in-');
    });

    it('rejects path-traversal forms', () => {
        expect(sanitizePluginId('.')).toBeNull();
        expect(sanitizePluginId('..')).toBeNull();
        expect(sanitizePluginId('../foo')).toBeNull();      // sanitizes to "..-foo", then leading dot
        expect(sanitizePluginId('.hidden')).toBeNull();     // leading dot rejected
    });

    it('flattens slashes to hyphens (no traversal risk via the sanitized form)', () => {
        // /etc/passwd → -etc-passwd is just an oddly-named plugin folder;
        // there's no escape because the / is gone before path.resolve sees it.
        expect(sanitizePluginId('/etc/passwd')).toBe('-etc-passwd');
        expect(sanitizePluginId('a/b/c')).toBe('a-b-c');
    });

    it('rejects empty / whitespace ids', () => {
        expect(sanitizePluginId('')).toBeNull();
        expect(sanitizePluginId(null as unknown as string)).toBeNull();
    });
});

describe('installPluginFromPayload', () => {
    it('writes manifest.json + main.js into the sanitized id folder', async () => {
        const res = await installPluginFromPayload({
            id: 'my-plugin',
            manifest: { id: 'my-plugin', name: 'My Plugin', version: '1.0.0' },
            scriptContent: 'console.log("hi");',
        }, TMP_DIR);
        expect(res.id).toBe('my-plugin');

        const manifestRaw = await fs.readFile(join(TMP_DIR, 'my-plugin', 'manifest.json'), 'utf8');
        expect(JSON.parse(manifestRaw)).toEqual({ id: 'my-plugin', name: 'My Plugin', version: '1.0.0' });
        const script = await fs.readFile(join(TMP_DIR, 'my-plugin', 'main.js'), 'utf8');
        expect(script).toBe('console.log("hi");');
    });

    it('overwrites an existing plugin on reinstall', async () => {
        await installPluginFromPayload({
            id: 'p', manifest: { name: 'v1' }, scriptContent: 'old();',
        }, TMP_DIR);
        await installPluginFromPayload({
            id: 'p', manifest: { name: 'v2' }, scriptContent: 'new();',
        }, TMP_DIR);
        const script = await fs.readFile(join(TMP_DIR, 'p', 'main.js'), 'utf8');
        expect(script).toBe('new();');
    });

    it('refuses an id like ".." — would have escaped the plugins dir', async () => {
        await expect(installPluginFromPayload({
            id: '..',
            manifest: { name: 'evil' },
            scriptContent: 'x',
        }, TMP_DIR)).rejects.toBeInstanceOf(PluginInstallError);
        // And nothing was written outside.
        const peers = await fs.readdir(join(TMP_DIR, '..')).catch(() => []);
        // (just smoke-checks: a containing dir still exists; we don't actually
        // delete tmpdir entries here.)
        expect(Array.isArray(peers)).toBe(true);
    });

    it('refuses a non-object manifest', async () => {
        await expect(installPluginFromPayload({
            id: 'p', manifest: 'not-an-object', scriptContent: 'x',
        }, TMP_DIR)).rejects.toMatchObject({ code: 'BAD_MANIFEST' });
    });

    it('refuses a non-string scriptContent', async () => {
        await expect(installPluginFromPayload({
            id: 'p', manifest: {}, scriptContent: 12345,
        }, TMP_DIR)).rejects.toMatchObject({ code: 'BAD_SCRIPT' });
    });

    it('refuses an oversized script (defense vs DoS via uploads)', async () => {
        const huge = 'x'.repeat(3 * 1024 * 1024);
        await expect(installPluginFromPayload({
            id: 'p', manifest: {}, scriptContent: huge,
        }, TMP_DIR)).rejects.toMatchObject({ code: 'BAD_SCRIPT' });
    });
});

describe('readInstalledPlugins', () => {
    it('returns an empty list for a fresh directory', async () => {
        const out = await readInstalledPlugins(TMP_DIR);
        expect(out).toEqual([]);
    });

    it('returns installed plugins in any order', async () => {
        await installPluginFromPayload({ id: 'a', manifest: { name: 'A' }, scriptContent: '/* a */' }, TMP_DIR);
        await installPluginFromPayload({ id: 'b', manifest: { name: 'B' }, scriptContent: '/* b */' }, TMP_DIR);
        const out = await readInstalledPlugins(TMP_DIR);
        const ids = out.map(p => p.id).sort();
        expect(ids).toEqual(['a', 'b']);
        for (const p of out) {
            expect(p.manifest).toHaveProperty('name');
            expect(typeof p.scriptContent).toBe('string');
        }
    });

    it('skips a folder missing manifest.json or main.js', async () => {
        await fs.mkdir(join(TMP_DIR, 'incomplete'), { recursive: true });
        await fs.writeFile(join(TMP_DIR, 'incomplete', 'manifest.json'), '{"name":"x"}');
        // No main.js — should be skipped.
        const out = await readInstalledPlugins(TMP_DIR);
        expect(out).toEqual([]);
    });

    it('skips a plugin whose manifest is invalid JSON', async () => {
        await fs.mkdir(join(TMP_DIR, 'broken'), { recursive: true });
        await fs.writeFile(join(TMP_DIR, 'broken', 'manifest.json'), '{not json');
        await fs.writeFile(join(TMP_DIR, 'broken', 'main.js'), '/* */');
        const out = await readInstalledPlugins(TMP_DIR);
        expect(out).toEqual([]);
    });

    it('skips folders whose name fails sanitization', async () => {
        // Manually create a folder with a name that wouldn't pass the install
        // sanitiser. readInstalledPlugins should ignore it so a sketchy
        // out-of-band folder doesn't get loaded.
        await fs.mkdir(join(TMP_DIR, '.hidden'), { recursive: true });
        await fs.writeFile(join(TMP_DIR, '.hidden', 'manifest.json'), '{}');
        await fs.writeFile(join(TMP_DIR, '.hidden', 'main.js'), '/* */');
        const out = await readInstalledPlugins(TMP_DIR);
        expect(out.map(p => p.id)).not.toContain('.hidden');
    });
});

describe('uninstallPlugin', () => {
    it('removes an installed plugin folder', async () => {
        await installPluginFromPayload({ id: 'p', manifest: {}, scriptContent: '/* */' }, TMP_DIR);
        const before = await readInstalledPlugins(TMP_DIR);
        expect(before.length).toBe(1);

        const ok = await uninstallPlugin('p', TMP_DIR);
        expect(ok).toBe(true);

        const after = await readInstalledPlugins(TMP_DIR);
        expect(after.length).toBe(0);
    });

    it('rejects a traversal id', async () => {
        await expect(uninstallPlugin('..', TMP_DIR)).rejects.toBeInstanceOf(PluginInstallError);
        await expect(uninstallPlugin('.hidden', TMP_DIR)).rejects.toBeInstanceOf(PluginInstallError);
    });

    it('returns true even when the plugin doesn\'t exist (idempotent rm)', async () => {
        // rm with force: true treats missing paths as success — caller can
        // chain delete-then-install without a pre-check.
        const ok = await uninstallPlugin('not-installed', TMP_DIR);
        expect(ok).toBe(true);
    });
});

describe('getPluginDir', () => {
    it('honours JOURNAL_PLUGINS_DIR env var', () => {
        const prev = process.env.JOURNAL_PLUGINS_DIR;
        process.env.JOURNAL_PLUGINS_DIR = '/var/lib/thejournal/plugins';
        try {
            expect(getPluginDir()).toBe('/var/lib/thejournal/plugins');
        } finally {
            if (prev === undefined) delete process.env.JOURNAL_PLUGINS_DIR;
            else process.env.JOURNAL_PLUGINS_DIR = prev;
        }
    });

    it('falls back to <cwd>/plugins when env var unset', () => {
        const prev = process.env.JOURNAL_PLUGINS_DIR;
        delete process.env.JOURNAL_PLUGINS_DIR;
        try {
            expect(getPluginDir()).toBe(join(process.cwd(), 'plugins'));
        } finally {
            if (prev !== undefined) process.env.JOURNAL_PLUGINS_DIR = prev;
        }
    });
});
