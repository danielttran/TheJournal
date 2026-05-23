// @vitest-environment jsdom
/**
 * Proves the first-party plugins (drawio, sentence-diagrammer) are bundled into
 * the app and actually execute + register, with NO runtime fetch — the fix for
 * "the 2 plugins fail to fetch; they need to be bundled".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BUNDLED_PLUGINS } from '../../src/lib/bundledPlugins';
import { TheJournalAPI } from '../../src/lib/pluginApi';

describe('bundled plugins', () => {
    beforeEach(() => { TheJournalAPI.reset(); });

    it('bundles both first-party plugins with non-empty scripts', () => {
        const ids = BUNDLED_PLUGINS.map(p => p.id).sort();
        expect(ids).toEqual(['drawio', 'sentence-diagrammer']);
        for (const p of BUNDLED_PLUGINS) {
            expect(p.scriptContent.length).toBeGreaterThan(1000);
            expect(p.manifest.name.length).toBeGreaterThan(0);
        }
    });

    it('each bundled plugin executes and registers without throwing (no fetch)', () => {
        for (const plugin of BUNDLED_PLUGINS) {
            expect(() => { new Function(plugin.scriptContent)(); }, plugin.id).not.toThrow();
        }
        // After running both, the plugins have registered editor extensions and
        // at least one toolbar button — i.e. there is a usable surface.
        expect(TheJournalAPI.registeredExtensions.length).toBeGreaterThanOrEqual(1);
        expect(TheJournalAPI.registeredToolbarButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('every registered toolbar button has a label (clear way to use)', () => {
        for (const plugin of BUNDLED_PLUGINS) new Function(plugin.scriptContent)();
        for (const btn of TheJournalAPI.registeredToolbarButtons) {
            expect(btn.label.trim().length).toBeGreaterThan(0);
            expect(typeof btn.onClick).toBe('function');
        }
    });
});
