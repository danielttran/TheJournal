// @vitest-environment jsdom
/**
 * Verifies the Sentence Studio diagrammer plugin: the local heuristic parser,
 * the three diagram renderers (Reed-Kellogg / tree / dependency), the static
 * preview SVG, the TipTap node serialization contract, and legacy-state safety.
 * Runs the actual bundled plugin script (no full React app).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BUNDLED_PLUGINS } from '../../src/lib/bundledPlugins';
import { TheJournalAPI } from '../../src/lib/pluginApi';
import { inlineDiagramPreviews } from '../../src/lib/export-formats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ss: any;

beforeAll(() => {
    TheJournalAPI.reset();
    const plugin = BUNDLED_PLUGINS.find((p) => p.id === 'sentence-diagrammer')!;
    new Function(plugin.scriptContent)();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ss = (window as any).__sentenceStudio;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).setPointerCapture = () => {};
});

afterEach(() => {
    document.querySelectorAll('.tj-ss-overlay').forEach((o) => o.remove());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__tjSentenceStudioOpen = false;
});

const findButton = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);

describe('Sentence Studio engine', () => {
    it('exposes its engine and registers a toolbar button', () => {
        expect(ss).toBeTruthy();
        expect(typeof ss.parseSentence).toBe('function');
        expect(TheJournalAPI.registeredToolbarButtons.some((b) => b.id === 'sentence-diagrammer')).toBe(true);
    });

    it('heuristically tags parts of speech for common sentences', () => {
        const p = ss.heuristicParse('The dog runs.');
        expect(p.tokens.map((t: { word: string }) => t.word)).toEqual(['The', 'dog', 'runs']);
        expect(p.tokens.map((t: { pos: string }) => t.pos)).toEqual(['DET', 'NOUN', 'VERB']);
    });

    it('finds subject / verb / object in a transitive sentence', () => {
        const p = ss.heuristicParse('She caught the ball');
        const c = p.clauses[0];
        const word = (i: number) => p.tokens[i].word;
        expect(word(c.subject)).toBe('She');
        expect(word(c.verb)).toBe('caught');
        expect(word(c.object)).toBe('ball');
        // determiner is recorded as a modifier of its noun
        expect(p.modifiers.some((m: { kind: string }) => m.kind === 'det')).toBe(true);
    });

    it('attaches a prepositional phrase to its object', () => {
        const p = ss.heuristicParse('A book on the table');
        expect(p.preps.length).toBe(1);
        const prep = p.preps[0];
        expect(p.tokens[prep.prep].word).toBe('on');
        expect(p.tokens[prep.obj].word).toBe('table');
    });

    it('produces a parser schema with every required field', () => {
        const p = ss.heuristicParse('The quick brown fox jumps over a lazy dog');
        for (const k of ['tokens', 'clauses', 'modifiers', 'preps', 'compounds', 'deps']) {
            expect(Array.isArray(p[k])).toBe(true);
        }
        // adjectives slant under the noun they describe
        expect(p.modifiers.some((m: { kind: string }) => m.kind === 'adj')).toBe(true);
        // deps are derived for the dependency view
        expect(p.deps.length).toBeGreaterThan(0);
    });

    it('parseSentence resolves to the heuristic parse', async () => {
        const p = await ss.parseSentence('Birds sing');
        expect(p.tokens.map((t: { word: string }) => t.word)).toEqual(['Birds', 'sing']);
        expect(p.tokens[1].pos).toBe('VERB');
    });

    it('defaultParse() has the curated John 3:16 shape the renderers expect', () => {
        const d = ss.defaultParse();
        expect(d.tokens).toHaveLength(25);
        expect(d.tokens[1].word).toBe('God');
        expect(d.clauses).toHaveLength(4);
        expect(d.clausesMeta).toHaveLength(4);
        expect(d.tokens[1].role).toBe('subject');
        expect(d.tokens[1].clause).toBe('c1');
    });

    it.each([
        ['rk', 'God'],
        ['tree', 'Son'],
        ['dep', 'world'],
    ])('renders a self-contained preview SVG for the %s style', (style, word) => {
        const state = ss.emptyState();
        state.style = style;
        const svg = ss.renderPreviewSvg(state);
        expect(svg).toContain('<svg');
        expect(svg).toContain('xmlns');
        expect(svg).toContain(word);
        // export SVG bakes concrete colors — no unresolved CSS vars for ink
        expect(svg).not.toContain('var(--ink)');
    });

    it('renders an auto-layout preview for a parsed (non-default) sentence', () => {
        const state = ss.emptyState();
        state.parse = ss.heuristicParse('The dog runs');
        state.isDefault = false;
        const svg = ss.renderPreviewSvg(state);
        expect(svg).toContain('<svg');
        expect(svg).toContain('dog');
        expect(svg).toContain('runs');
    });

    it('normalizeState resets a legacy LexiGraph state without throwing, keeping the text', () => {
        const legacy = {
            canvas: { zoom: 1, panX: 0, panY: 0 },
            sentence: { rawText: 'cats sleep soundly', tokens: [{ id: 't1', text: 'cats', used: true }] },
            nodes: { a: { id: 'a', type: 'BASELINE', startX: 0, startY: 0, length: 200, angle: 0, slots: [], dividers: [] } },
        };
        const st = ss.normalizeState(legacy);
        expect(st.sentence).toBe('cats sleep soundly');
        expect(st.style).toBe('rk');
        expect(Array.isArray(st.parse.tokens)).toBe(true);
        // and it still renders
        expect(ss.renderPreviewSvg(st)).toContain('<svg');
    });

    it('openStudio builds the overlay and Save emits {state, previewSvg}', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let saved: any = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ss.openStudio(null, (r: any) => { saved = r; });
        const overlay = document.querySelector('.tj-ss-overlay') as HTMLElement;
        expect(overlay).toBeTruthy();
        expect(overlay.querySelector('.tj-ss-topbar')).toBeTruthy();
        expect(overlay.querySelector('.tj-ss-strip')).toBeTruthy();
        findButton('Save')!.click();
        expect(saved).toBeTruthy();
        expect(typeof saved.state).toBe('object');
        expect(saved.previewSvg).toContain('<svg');
        expect(overlay.isConnected).toBe(false);
    });

    it('switches diagram styles in the overlay', () => {
        ss.openStudio(null, () => {});
        const overlay = document.querySelector('.tj-ss-overlay') as HTMLElement;
        // default renders Reed-Kellogg (curved dashed connectors present)
        expect(overlay.querySelector('.tj-ss-diagram')).toBeTruthy();
        findButton('Dependency')!.click();
        // dependency view labels each word's POS under it
        const texts = Array.from(overlay.querySelectorAll('.tj-ss-diagram text')).map((t) => t.textContent);
        expect(texts).toContain('NOUN');
    });

    it('serializes the diagram as inline SVG so exports/prints are not blank (regression)', () => {
        const ext = TheJournalAPI.registeredExtensions.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (e: any) => e.name === 'sentenceDiagram',
        )!;
        const previewSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>cats</text></svg>';
        const editor = new Editor({
            element: document.createElement('div'),
            extensions: [StarterKit, ext],
            content: { type: 'doc', content: [{ type: 'sentenceDiagram', attrs: { state: { sentence: 'cats' }, previewSvg } }] },
        });
        const html = editor.getHTML();
        expect(html).toContain('data-type="sentence-diagram"');
        expect(html).toContain('<svg');
        expect(html).toContain('cats');

        const reopened = new Editor({
            element: document.createElement('div'),
            extensions: [StarterKit, ext],
            content: html,
        });
        const json = reopened.getJSON();
        const node = json.content!.find((n) => n.type === 'sentenceDiagram')!;
        expect(node.attrs!.previewSvg).toContain('cats');
        editor.destroy();
        reopened.destroy();
    });
});

describe('inlineDiagramPreviews (legacy export shim)', () => {
    const legacyDiv = () => {
        const div = document.createElement('div');
        div.setAttribute('data-state', JSON.stringify({ sentence: 'cats sleep' }));
        div.setAttribute('data-preview', '<svg xmlns="http://www.w3.org/2000/svg"><text>cats &amp; dogs</text></svg>');
        div.setAttribute('data-type', 'sentence-diagram');
        return div.outerHTML;
    };

    it('inlines a legacy data-preview SVG into the empty diagram div', () => {
        const out = inlineDiagramPreviews(`<p>hi</p>${legacyDiv()}<p>bye</p>`);
        expect(out).toContain('<svg');
        expect(out).toContain('<text>cats &amp; dogs</text>');
        expect(out).not.toContain('data-preview=');
        expect(out).toContain('data-state=');
        expect(out).toContain('<p>hi</p>');
    });

    it('is idempotent and leaves already-inlined diagrams untouched', () => {
        const once = inlineDiagramPreviews(legacyDiv());
        expect(inlineDiagramPreviews(once)).toBe(once);
    });

    it('is a no-op on HTML with no diagrams', () => {
        const html = '<p>just text</p><div data-type="other"></div>';
        expect(inlineDiagramPreviews(html)).toBe(html);
        expect(inlineDiagramPreviews('')).toBe('');
        expect(inlineDiagramPreviews(null)).toBe('');
    });
});
