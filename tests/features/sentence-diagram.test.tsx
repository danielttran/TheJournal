// @vitest-environment jsdom
/**
 * Verifies the LexiGraph sentence-diagrammer engine: tokenizer, the magnetic
 * perpendicular-projection snapping math, nearest-line selection, and SVG
 * preview rendering. Runs the actual bundled plugin script (no full canvas).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BUNDLED_PLUGINS } from '../../src/lib/bundledPlugins';
import { TheJournalAPI } from '../../src/lib/pluginApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lex: any;

beforeAll(() => {
    TheJournalAPI.reset();
    const plugin = BUNDLED_PLUGINS.find((p) => p.id === 'sentence-diagrammer')!;
    new Function(plugin.scriptContent)();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lex = (window as any).__lexigraph;
});

describe('LexiGraph engine', () => {
    it('exposes its engine and registers a toolbar button', () => {
        expect(lex).toBeTruthy();
        expect(TheJournalAPI.registeredToolbarButtons.some((b) => b.id === 'sentence-diagrammer')).toBe(true);
    });

    it('tokenizes words and drops punctuation', () => {
        const toks = lex.tokenize('The local employees arrive before ten.');
        expect(toks.map((t: { text: string }) => t.text)).toEqual(['The', 'local', 'employees', 'arrive', 'before', 'ten']);
        expect(toks.every((t: { used: boolean }) => t.used === false)).toBe(true);
    });

    it('projects a point perpendicularly onto a line (snapping math)', () => {
        const line = { startX: 0, startY: 0, length: 100, angle: 0 };
        const p = lex.projectToLine(50, 20, line);
        expect(p.t).toBeCloseTo(0.5, 5);
        expect(p.x).toBeCloseTo(50, 5);
        expect(p.y).toBeCloseTo(0, 5);
        expect(p.dist).toBeCloseTo(20, 5);
        // points beyond the segment clamp to the endpoints (t in [0,1])
        expect(lex.projectToLine(-40, 0, line).t).toBe(0);
        expect(lex.projectToLine(999, 0, line).t).toBe(1);
    });

    it('nearestLine picks the closest line to a point', () => {
        const state = lex.normalizeState({
            nodes: {
                a: { id: 'a', type: 'BASELINE', startX: 0, startY: 0, length: 100, angle: 0, slots: [], dividers: [] },
                b: { id: 'b', type: 'BASELINE', startX: 0, startY: 200, length: 100, angle: 0, slots: [], dividers: [] },
            },
        });
        expect(lex.nearestLine(state, 50, 10).id).toBe('a');
        expect(lex.nearestLine(state, 50, 190).id).toBe('b');
    });

    it('openEditor builds the overlay UI and Save emits {state, previewSvg}', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let saved: any = null;
        lex.openEditor(
            { sentence: { rawText: 'cats sleep', tokens: [{ id: 't1', text: 'cats', used: true }] }, nodes: { a: { id: 'a', type: 'BASELINE', startX: 0, startY: 0, length: 200, angle: 0, slots: [{ position: 0.5, tokenId: 't1' }], dividers: [] } } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: any) => { saved = r; },
        );
        const overlay = document.body.lastElementChild as HTMLElement;
        expect(overlay).toBeTruthy();
        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Save');
        expect(saveBtn).toBeTruthy();
        saveBtn!.click();
        expect(saved).toBeTruthy();
        expect(typeof saved.state).toBe('object');
        expect(saved.previewSvg).toContain('cats');
        expect(overlay.isConnected).toBe(false); // closed on save
    });

    it('re-tokenizing preserves placed words and prunes removed ones (regression)', () => {
        // place "cats" on a line, then edit the sentence — the placed word must
        // keep its token id (so it still renders) and stay marked used.
        const state = lex.normalizeState({
            sentence: { rawText: 'cats sleep', tokens: [{ id: 'tA', text: 'cats', used: true }, { id: 'tB', text: 'sleep', used: false }] },
            nodes: { a: { id: 'a', type: 'BASELINE', startX: 0, startY: 0, length: 200, angle: 0, slots: [{ position: 0.5, tokenId: 'tA', role: 'SUBJECT' }], dividers: [] } },
        });
        lex.reconcileTokens(state, 'cats sleep soundly');
        const cats = state.sentence.tokens.find((t: { text: string }) => t.text === 'cats');
        // same token object id is reused → the existing slot stays valid
        expect(cats.id).toBe('tA');
        expect(cats.used).toBe(true);
        expect(state.nodes.a.slots).toHaveLength(1);
        expect(state.sentence.tokens.map((t: { text: string }) => t.text)).toEqual(['cats', 'sleep', 'soundly']);

        // now remove "cats" from the sentence → its slot is pruned
        lex.reconcileTokens(state, 'sleep soundly');
        expect(state.nodes.a.slots).toHaveLength(0);
        expect(state.sentence.tokens.map((t: { text: string }) => t.text)).toEqual(['sleep', 'soundly']);
    });

    it('renders a preview SVG containing the placed word', () => {
        const state = lex.normalizeState({
            sentence: { rawText: 'cats sleep', tokens: [{ id: 't1', text: 'cats', used: true }] },
            nodes: { a: { id: 'a', type: 'BASELINE', startX: 0, startY: 0, length: 200, angle: 0, slots: [{ position: 0.5, tokenId: 't1', role: 'SUBJECT' }], dividers: [{ position: 0.5, height: 40, full: true }] } },
        });
        const svg = lex.renderPreviewSvg(state);
        expect(svg).toContain('<svg');
        expect(svg).toContain('cats');
    });
});
