/**
 * Server-side plugin storage for the web build.
 *
 * Mirrors the Electron plugin layout (`[userData]/plugins/<id>/manifest.json`
 * + `<id>/main.js`) on the server's filesystem so the same plugin folder
 * structure works in both. Web users typically self-host TheJournal, so
 * the trust model is identical to the Electron one — "trusted local
 * scripts" — and the user is responsible for what gets uploaded.
 *
 * The renderer doesn't post a zip; it posts a JSON payload built from the
 * browser's File API after reading `manifest.json` and `main.js` from the
 * picked folder. This sidesteps unzip-on-server complexity and matches
 * the existing PluginPayload shape used by /api/electron.
 *
 * Location precedence:
 *   1. JOURNAL_PLUGINS_DIR env var (explicit override).
 *   2. ./plugins/ relative to the server's CWD (matches the repo layout
 *      so the bundled sentence-diagrammer plugin is auto-discovered).
 */
import { promises as fs } from 'fs';
import * as path from 'path';

const MANIFEST_MAX_BYTES = 16 * 1024;   // 16 KB JSON manifest cap
const SCRIPT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB plugin script cap

export interface PluginPayload {
    id: string;
    manifest: Record<string, unknown>;
    scriptContent: string;
}

export function getPluginDir(): string {
    if (process.env.JOURNAL_PLUGINS_DIR) {
        return path.resolve(process.env.JOURNAL_PLUGINS_DIR);
    }
    return path.resolve(process.cwd(), 'plugins');
}

/**
 * Same sanitization the Electron install uses, so installs done via either
 * UI produce identical on-disk layouts.
 */
export function sanitizePluginId(rawId: string): string | null {
    const stripped = (rawId ?? '').replace(/[^A-Za-z0-9._-]/g, '-');
    if (!stripped
        || stripped === '.'
        || stripped === '..'
        || stripped.startsWith('.')
        || stripped.includes('/')
        || stripped.includes('\\')) {
        return null;
    }
    return stripped;
}

async function pathIsInsideDir(target: string, dir: string): Promise<boolean> {
    const rel = path.relative(dir, target);
    return !!rel
        && !rel.startsWith('..')
        && !path.isAbsolute(rel)
        && rel.split(path.sep).length === 1;
}

async function safeReadFile(filePath: string, maxBytes: number): Promise<string | null> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) return null;
        if (stat.size > maxBytes) return null;
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Scan the plugin directory and return every valid plugin found.
 * Invalid plugins (missing files, unparseable manifest, oversized script)
 * are silently skipped so one broken plugin can't take the others down.
 */
export async function readInstalledPlugins(dir?: string): Promise<PluginPayload[]> {
    const pluginDir = dir ?? getPluginDir();
    await fs.mkdir(pluginDir, { recursive: true });

    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try {
        entries = await fs.readdir(pluginDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const plugins: PluginPayload[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = sanitizePluginId(entry.name);
        // Skip directories that wouldn't be installable through the UI.
        // Doesn't fall back to the raw name — we'd rather hide a
        // foreign-named folder than let it through.
        if (!id || id !== entry.name) continue;

        const pluginPath = path.join(pluginDir, entry.name);
        const manifestRaw = await safeReadFile(path.join(pluginPath, 'manifest.json'), MANIFEST_MAX_BYTES);
        const scriptContent = await safeReadFile(path.join(pluginPath, 'main.js'), SCRIPT_MAX_BYTES);
        if (!manifestRaw || !scriptContent) continue;

        let manifest: Record<string, unknown>;
        try { manifest = JSON.parse(manifestRaw); }
        catch { continue; }

        plugins.push({ id: entry.name, manifest, scriptContent });
    }
    return plugins;
}

export class PluginInstallError extends Error {
    constructor(msg: string, readonly code: 'BAD_ID' | 'BAD_MANIFEST' | 'BAD_SCRIPT' | 'TRAVERSAL' | 'IO') {
        super(msg);
        this.name = 'PluginInstallError';
    }
}

/**
 * Install a plugin from a JSON payload posted by the renderer. The id is
 * sanitised; the manifest is validated; the script is size-capped; the
 * destination path is verified to live inside the plugin directory.
 *
 * Idempotent: if the plugin id already exists, its files are overwritten.
 */
export async function installPluginFromPayload(
    payload: { id?: unknown; manifest?: unknown; scriptContent?: unknown },
    dir?: string,
): Promise<{ id: string; pluginDir: string }> {
    const id = sanitizePluginId(typeof payload.id === 'string' ? payload.id : '');
    if (!id) throw new PluginInstallError('Invalid plugin id', 'BAD_ID');

    if (!payload.manifest || typeof payload.manifest !== 'object') {
        throw new PluginInstallError('Manifest must be an object', 'BAD_MANIFEST');
    }
    let manifestJson: string;
    try { manifestJson = JSON.stringify(payload.manifest); }
    catch { throw new PluginInstallError('Manifest is not serialisable', 'BAD_MANIFEST'); }
    if (manifestJson.length > MANIFEST_MAX_BYTES) {
        throw new PluginInstallError(`Manifest exceeds ${MANIFEST_MAX_BYTES} bytes`, 'BAD_MANIFEST');
    }

    if (typeof payload.scriptContent !== 'string') {
        throw new PluginInstallError('scriptContent must be a string', 'BAD_SCRIPT');
    }
    if (payload.scriptContent.length > SCRIPT_MAX_BYTES) {
        throw new PluginInstallError(`Script exceeds ${SCRIPT_MAX_BYTES} bytes`, 'BAD_SCRIPT');
    }

    const pluginsRoot = dir ?? getPluginDir();
    await fs.mkdir(pluginsRoot, { recursive: true });
    const pluginPath = path.resolve(pluginsRoot, id);
    if (!(await pathIsInsideDir(pluginPath, pluginsRoot))) {
        throw new PluginInstallError('Resolved path escapes the plugin directory', 'TRAVERSAL');
    }

    try {
        await fs.mkdir(pluginPath, { recursive: true });
        await fs.writeFile(path.join(pluginPath, 'manifest.json'), manifestJson, 'utf8');
        await fs.writeFile(path.join(pluginPath, 'main.js'), payload.scriptContent, 'utf8');
    } catch (err) {
        throw new PluginInstallError(err instanceof Error ? err.message : String(err), 'IO');
    }
    return { id, pluginDir: pluginPath };
}

/**
 * Remove a plugin by id. Returns true when something was removed, false
 * when the id didn't exist. Rejects ids that fail sanitisation OR resolve
 * outside the plugins root.
 */
export async function uninstallPlugin(rawId: string, dir?: string): Promise<boolean> {
    const id = sanitizePluginId(rawId);
    if (!id) throw new PluginInstallError('Invalid plugin id', 'BAD_ID');
    const pluginsRoot = dir ?? getPluginDir();
    const pluginPath = path.resolve(pluginsRoot, id);
    if (!(await pathIsInsideDir(pluginPath, pluginsRoot))) {
        throw new PluginInstallError('Resolved path escapes the plugin directory', 'TRAVERSAL');
    }
    try {
        await fs.rm(pluginPath, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}
