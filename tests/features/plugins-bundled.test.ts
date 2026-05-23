/**
 * Bundled plugins (plugins/drawio, plugins/sentence-diagrammer) are
 * browser code, not Node libs — they call into window.TheJournalAPI to
 * register Tiptap extensions and toolbar buttons. The real renderer
 * loads them via `new Function(scriptContent)()` inside Editor.tsx.
 *
 * We can't drive the full Tiptap editor from vitest's Node harness,
 * but we CAN:
 *   1. Read the plugin script from disk.
 *   2. Mock the minimal globals it touches (window, document, btoa/atob).
 *   3. Execute it via `new Function(...)`.
 *   4. Assert it registered at least one extension and one toolbar button
 *      via the mocked API.
 *
 * On top of registration smoke tests, the drawio plugin runs through
 * full data-layer round-trips:
 *   - attribute parseHTML/renderHTML for `xml` and `previewSvg`
 *   - the postMessage protocol with embed.diagrams.net
 *     (init → load → save → export → commit)
 *   - origin enforcement on inbound messages
 *   - the export-timeout fallback that still commits the xml
 *
 * This is the smoke + integration test that catches "the plugin throws
 * on registration" AND "the save flow loses data" regression classes —
 * exactly the bugs an absent test masks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

interface CapturedButton { id: string; label: string; icon?: string; onClick: unknown }
interface Captured {
    extensions: Record<string, unknown>[];
    toolbarButtons: CapturedButton[];
}

// Minimal harness used by both registration tests AND the postMessage
// flow tests. Returns the captured registrations plus the function that
// invoked the plugin so tests can re-create per-call state.
function runPluginInMockedBrowser(scriptPath: string, opts?: {
    onWindowMessageHandler?: (cb: (ev: MessageEvent) => void) => void;
    overrideWindow?: Partial<Window & { TheJournalAPI: unknown }>;
    createElement?: (tag: string) => unknown;
}): {
    captured: Captured;
    fakeWindow: Record<string, unknown>;
    fakeDocument: Record<string, unknown>;
} {
    const script = readFileSync(scriptPath, 'utf8');
    const captured: Captured = { extensions: [], toolbarButtons: [] };

    const fakeApi = {
        registerTiptapExtension(ext: Record<string, unknown>) {
            captured.extensions.push(ext);
        },
        registerToolbarButton(button: CapturedButton) {
            captured.toolbarButtons.push(button);
        },
    };

    const makeStubElement = (tag: string) => ({
        tagName: tag.toUpperCase(),
        children: [] as unknown[],
        listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
        appendChild(this: { children: unknown[] }, c: unknown) { this.children.push(c); return c; },
        removeChild(this: { children: unknown[] }, c: unknown) {
            const i = this.children.indexOf(c);
            if (i !== -1) this.children.splice(i, 1);
            return c;
        },
        setAttribute() {},
        getAttribute(k: string) {
            const self = this as Record<string, unknown>;
            const attrs = (self.__attrs as Record<string, string>) || {};
            return attrs[k] ?? null;
        },
        addEventListener(this: { listeners: Map<string, unknown[]> }, ev: string, fn: unknown) {
            const arr = this.listeners.get(ev) ?? [];
            arr.push(fn);
            this.listeners.set(ev, arr);
        },
        removeEventListener(this: { listeners: Map<string, unknown[]> }, ev: string, fn: unknown) {
            const arr = this.listeners.get(ev) ?? [];
            const i = arr.indexOf(fn);
            if (i !== -1) arr.splice(i, 1);
        },
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        style: new Proxy({}, { set: () => true }),
        classList: { add() {}, remove() {} },
        innerHTML: '',
        textContent: '',
        src: '',
        referrerPolicy: '',
        contentWindow: { postMessage(_data: unknown, _origin?: string) {} },
    });

    const createElement = opts?.createElement ?? makeStubElement;
    const body = makeStubElement('body');
    const fakeDocument: Record<string, unknown> = {
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        body,
        addEventListener() {},
        removeEventListener() {},
    };

    const fakeWindow: Record<string, unknown> = {
        TheJournalAPI: fakeApi,
        addEventListener(ev: string, fn: (e: MessageEvent) => void) {
            if (ev === 'message' && opts?.onWindowMessageHandler) {
                opts.onWindowMessageHandler(fn);
            }
        },
        removeEventListener() {},
        dispatchEvent() { return true; },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        ...(opts?.overrideWindow ?? {}),
    };

    const fn = new Function('window', 'document', 'btoa', 'atob', 'unescape', 'escape',
        'encodeURIComponent', 'decodeURIComponent', script);
    fn(
        fakeWindow,
        fakeDocument,
        (s: string) => Buffer.from(s, 'binary').toString('base64'),
        (s: string) => Buffer.from(s, 'base64').toString('binary'),
        globalThis.unescape ?? ((s: string) => decodeURIComponent(s)),
        globalThis.escape ?? ((s: string) => encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, '%$1')),
        encodeURIComponent,
        decodeURIComponent,
    );

    return { captured, fakeWindow, fakeDocument };
}

describe('bundled plugin: sentence-diagrammer', () => {
    const path = join(process.cwd(), 'plugins', 'sentence-diagrammer', 'main.js');

    it('loads and registers exactly one Tiptap extension', () => {
        const { captured } = runPluginInMockedBrowser(path);
        expect(captured.extensions.length).toBe(1);
        expect(captured.extensions[0].name).toBe('sentenceDiagram');
    });

    it('registers a toolbar button with id sentence-diagrammer', () => {
        const { captured } = runPluginInMockedBrowser(path);
        expect(captured.toolbarButtons.length).toBe(1);
        expect(captured.toolbarButtons[0].id).toBe('sentence-diagrammer');
        expect(captured.toolbarButtons[0].icon).toBe('network');
        expect(typeof captured.toolbarButtons[0].onClick).toBe('function');
    });
});

describe('bundled plugin: drawio — registration', () => {
    const path = join(process.cwd(), 'plugins', 'drawio', 'main.js');

    it('loads and registers the drawioDiagram extension', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram');
        expect(ext, 'drawioDiagram extension not registered').toBeDefined();
    });

    it('exposes `xml` and `previewSvg` attributes with parseHTML/renderHTML round-trips', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { addAttributes?: () => Record<string, { default?: string; parseHTML?: (el: unknown) => string; renderHTML?: (attrs: Record<string, unknown>) => Record<string, string> }> };
        expect(ext.addAttributes).toBeDefined();
        const attrs = ext.addAttributes!();
        expect(attrs.xml).toBeDefined();
        expect(attrs.previewSvg).toBeDefined();
        // renderHTML produces the data-* attributes; parseHTML reads them.
        const html = attrs.xml.renderHTML!({ xml: '<mxGraphModel/>' });
        expect(html['data-xml']).toBe('<mxGraphModel/>');
        // round-trip for previewSvg via the b64 attr
        const svgRaw = '<svg xmlns="http://www.w3.org/2000/svg"><text>café 中文</text></svg>';
        const written = attrs.previewSvg.renderHTML!({ previewSvg: svgRaw });
        const b64 = written['data-preview-svg-b64'];
        expect(b64).toBeTruthy();
        // Read back via parseHTML's mocked element accessor.
        const fakeEl = { getAttribute: (k: string) => k === 'data-preview-svg-b64' ? b64 : null };
        const readBack = attrs.previewSvg.parseHTML!(fakeEl);
        expect(readBack).toBe(svgRaw);
    });

    it('registers a toolbar button with id drawio + git-merge icon', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const btn = captured.toolbarButtons.find(b => b.id === 'drawio');
        expect(btn, 'drawio toolbar button not registered').toBeDefined();
        expect(btn!.icon).toBe('git-merge');
        expect(btn!.label).toBe('Diagram');
        expect(typeof btn!.onClick).toBe('function');
    });

    it('declares itself as an atom block node', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { group?: string; atom?: boolean };
        expect(ext.group).toBe('block');
        expect(ext.atom).toBe(true);
    });

    it('parses the existing data-xml attribute back into the xml node attr', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { addAttributes?: () => Record<string, { parseHTML?: (el: unknown) => string }> };
        const attrs = ext.addAttributes!();
        const xmlText = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
        const fakeEl = { getAttribute: (k: string) => k === 'data-xml' ? xmlText : null };
        expect(attrs.xml.parseHTML!(fakeEl)).toBe(xmlText);
    });

    it('falls back to empty string when previewSvg attribute is missing', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { addAttributes?: () => Record<string, { parseHTML?: (el: unknown) => string }> };
        const attrs = ext.addAttributes!();
        const fakeEl = { getAttribute: (_k: string) => null };
        expect(attrs.previewSvg.parseHTML!(fakeEl)).toBe('');
    });

    it('falls back to empty string when previewSvg attribute is corrupt base64', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { addAttributes?: () => Record<string, { parseHTML?: (el: unknown) => string }> };
        const attrs = ext.addAttributes!();
        // '!' is not a valid base64 character; atob throws.
        const fakeEl = { getAttribute: (k: string) => k === 'data-preview-svg-b64' ? '!!!not_b64!!!' : null };
        expect(attrs.previewSvg.parseHTML!(fakeEl)).toBe('');
    });

    it('omits the data-preview-svg-b64 attribute when previewSvg is empty', () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { addAttributes?: () => Record<string, { renderHTML?: (a: Record<string, unknown>) => Record<string, string> }> };
        const attrs = ext.addAttributes!();
        const out = attrs.previewSvg.renderHTML!({ previewSvg: '' });
        expect(out['data-preview-svg-b64']).toBeUndefined();
    });

    it("the node's renderHTML returns a div with data-type='drawio-diagram'", () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { renderHTML?: (a: { HTMLAttributes: Record<string, string> }) => [string, Record<string, string>] };
        const out = ext.renderHTML!({ HTMLAttributes: { 'data-xml': '<x/>' } });
        expect(out[0]).toBe('div');
        expect(out[1]['data-type']).toBe('drawio-diagram');
        expect(out[1]['data-xml']).toBe('<x/>');
    });

    it("the node's parseHTML matches div[data-type='drawio-diagram']", () => {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { parseHTML?: () => { tag: string }[] };
        const rules = ext.parseHTML!();
        expect(rules).toHaveLength(1);
        expect(rules[0].tag).toBe('div[data-type="drawio-diagram"]');
    });
});

/**
 * Full DB round-trip simulation.
 *
 * Tiptap's saved HTML for a drawio node looks like:
 *
 *   <div data-type="drawio-diagram" data-xml="..." data-preview-svg-b64="..."></div>
 *
 * On load, parseHTML extracts xml + previewSvg back into node attrs. We
 * verify the renderHTML → parseHTML cycle is lossless for the exact
 * attribute mechanism the editor uses, including:
 *   - large XML (40 KB stress case — comparable to a real diagram)
 *   - UTF-8 SVGs with embedded `<` `>` `&` `"`
 */
describe('bundled plugin: drawio — DB round-trip', () => {
    const path = join(process.cwd(), 'plugins', 'drawio', 'main.js');

    function extractAttrs() {
        const { captured } = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as {
            addAttributes?: () => Record<string, {
                default?: string;
                parseHTML?: (el: { getAttribute: (k: string) => string | null }) => string;
                renderHTML?: (attrs: Record<string, unknown>) => Record<string, string>;
            }>;
        };
        return ext.addAttributes!();
    }

    function roundTripOnce(xml: string, previewSvg: string): { xml: string; previewSvg: string } {
        const attrs = extractAttrs();
        const xmlOut = attrs.xml.renderHTML!({ xml });
        const svgOut = attrs.previewSvg.renderHTML!({ previewSvg });
        const stored: Record<string, string> = { ...xmlOut, ...svgOut };
        // Simulate parseHTML reading from a DOM element by exposing stored attrs.
        const el = { getAttribute: (k: string) => stored[k] ?? null };
        return {
            xml: attrs.xml.parseHTML!(el),
            previewSvg: attrs.previewSvg.parseHTML!(el),
        };
    }

    it('preserves a realistic mxGraphModel XML payload', () => {
        const xml = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="2" value="Hello" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`;
        const { xml: out } = roundTripOnce(xml, '');
        expect(out).toBe(xml);
    });

    it('preserves a UTF-8 SVG preview through base64 round-trip', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">' +
            '<text x="10" y="30" font-size="14">café 中文 — résumé</text>' +
            '<rect x="2" y="2" width="96" height="46" fill="none" stroke="black"/></svg>';
        const { previewSvg: out } = roundTripOnce('<x/>', svg);
        expect(out).toBe(svg);
    });

    it('preserves a 40 KB XML payload (comparable to a real diagram)', () => {
        const cell = '<mxCell id="x" value="lorem ipsum dolor sit amet" style="rounded=1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="20" as="geometry"/></mxCell>';
        const cells = Array.from({ length: 400 }, () => cell).join('');
        const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
        const { xml: out } = roundTripOnce(xml, '');
        expect(out.length).toBeGreaterThan(40_000);
        expect(out).toBe(xml);
    });

    it("round-trips an empty diagram (xml='', previewSvg='') without losing the attrs", () => {
        const { xml, previewSvg } = roundTripOnce('', '');
        expect(xml).toBe('');
        expect(previewSvg).toBe('');
    });
});

/**
 * Toolbar onClick behaviour.
 *
 * The toolbar button's onClick is what the user invokes to insert a fresh
 * diagram. We capture the editor.chain().insertContent(...).run() call
 * chain so we can assert the inserted node spec is exactly what the
 * drawioDiagram extension expects.
 */
describe('bundled plugin: drawio — toolbar onClick', () => {
    const path = join(process.cwd(), 'plugins', 'drawio', 'main.js');

    interface ChainCall { method: string; args: unknown[] }
    interface Chain {
        focus(): Chain;
        insertContent(node: unknown): Chain;
        run(): boolean;
    }

    function buildFakeEditor() {
        const calls: ChainCall[] = [];
        const chain: Chain = {
            focus() { calls.push({ method: 'focus', args: [] }); return chain; },
            insertContent(node: unknown) {
                calls.push({ method: 'insertContent', args: [node] });
                return chain;
            },
            run() { calls.push({ method: 'run', args: [] }); return true; },
        };
        return {
            chain: () => chain,
            calls,
        };
    }

    it("inserts a drawioDiagram node with empty xml + previewSvg", () => {
        const { captured } = runPluginInMockedBrowser(path);
        const btn = captured.toolbarButtons.find(b => b.id === 'drawio')!;
        const editor = buildFakeEditor();
        (btn.onClick as (e: unknown) => void)(editor);
        // Expect: focus().insertContent({...}).run()
        const insertCall = editor.calls.find(c => c.method === 'insertContent');
        expect(insertCall, 'insertContent never called').toBeDefined();
        const node = insertCall!.args[0] as {
            type: string;
            attrs: { xml: string; previewSvg: string };
        };
        expect(node.type).toBe('drawioDiagram');
        expect(node.attrs).toEqual({ xml: '', previewSvg: '' });
        // Order matters: focus → insertContent → run
        expect(editor.calls.map(c => c.method)).toEqual(['focus', 'insertContent', 'run']);
    });
});

/**
 * postMessage protocol simulation.
 *
 * The plugin's openEditor() is a closure not exposed on window, so we
 * can't call it directly. But we know it's invoked from:
 *   1. Toolbar onClick → editor.chain().insertContent(...) (insert path,
 *      no editor opens)
 *   2. Existing node's click handler / Edit button (edit path,
 *      addNodeView builds the click handler)
 *
 * To exercise the postMessage flow we drive addNodeView's click handler,
 * which calls openEditor with realistic options, and then send
 * synthetic messages to the captured window.message listener.
 */
describe('bundled plugin: drawio — postMessage protocol', () => {
    const pluginPath = join(process.cwd(), 'plugins', 'drawio', 'main.js');
    const EMBED_HOST = 'https://embed.diagrams.net';

    interface Iframe {
        tagName: string;
        src: string;
        contentWindow: { postMessage: ReturnType<typeof vi.fn> };
        // Capture all element interactions for later inspection.
        __postedMessages: unknown[];
    }

    interface Harness {
        captured: Captured;
        fakeWindow: Record<string, unknown>;
        messageHandler: ((ev: MessageEvent) => void) | null;
        iframe: Iframe | null;
        nodeViewClickHandler: (() => void) | null;
        nodeAttrs: Record<string, unknown>;
        dispatchedTransactions: { attrs: Record<string, unknown> }[];
    }

    function buildHarness(initialAttrs: Record<string, unknown> = {}): Harness {
        const state: Harness = {
            captured: { extensions: [], toolbarButtons: [] },
            fakeWindow: {},
            messageHandler: null,
            iframe: null,
            nodeViewClickHandler: null,
            nodeAttrs: { xml: '', previewSvg: '', ...initialAttrs },
            dispatchedTransactions: [],
        };

        const createElement = (tag: string): Record<string, unknown> => {
            const el: Record<string, unknown> = {
                tagName: tag.toUpperCase(),
                children: [] as unknown[],
                listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
                appendChild(this: { children: unknown[] }, c: unknown) { this.children.push(c); return c; },
                removeChild(this: { children: unknown[] }, c: unknown) {
                    const i = this.children.indexOf(c);
                    if (i !== -1) this.children.splice(i, 1);
                    return c;
                },
                setAttribute() {},
                getAttribute() { return null; },
                addEventListener(this: { listeners: Map<string, unknown[]> }, ev: string, fn: unknown) {
                    const arr = this.listeners.get(ev) ?? [];
                    arr.push(fn);
                    this.listeners.set(ev, arr);
                },
                removeEventListener() {},
                remove() {},
                querySelector: () => null,
                querySelectorAll: () => [],
                getBoundingClientRect: () => ({ width: 0, height: 0 }),
                style: new Proxy({}, { set: () => true }),
                classList: { add() {}, remove() {} },
                innerHTML: '',
                textContent: '',
                src: '',
                type: '',
                referrerPolicy: '',
            };
            if (tag === 'iframe') {
                const iframe: Iframe = {
                    tagName: 'IFRAME',
                    src: '',
                    contentWindow: { postMessage: vi.fn() },
                    __postedMessages: [],
                };
                el.tagName = 'IFRAME';
                Object.assign(el, iframe);
                el.contentWindow = iframe.contentWindow;
                iframe.contentWindow.postMessage.mockImplementation((data: unknown) => {
                    iframe.__postedMessages.push(data);
                });
                state.iframe = iframe;
            }
            return el;
        };

        const { captured, fakeWindow } = runPluginInMockedBrowser(pluginPath, {
            createElement,
            onWindowMessageHandler: (cb) => { state.messageHandler = cb; },
        });
        state.captured = captured;
        state.fakeWindow = fakeWindow;

        // Build a fake nodeView click handler by invoking addNodeView.
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as {
            addNodeView?: () => (args: {
                node: { attrs: Record<string, unknown>; type: { name: string } };
                view: { state: { tr: { setNodeMarkup: (p: number, t: unknown, a: Record<string, unknown>) => { _tr: true; attrs: Record<string, unknown> } } }; dispatch: (tr: unknown) => void };
                getPos: () => number;
            }) => { dom: unknown; update?: (n: unknown) => boolean };
        };
        const nodeViewFactory = ext.addNodeView!();
        const fakeView = {
            state: {
                tr: {
                    setNodeMarkup: (_p: number, _t: unknown, a: Record<string, unknown>) => ({
                        _tr: true as const,
                        attrs: a,
                    }),
                },
            },
            dispatch: (tr: unknown) => {
                state.dispatchedTransactions.push({ attrs: (tr as { attrs: Record<string, unknown> }).attrs });
                // Reflect the dispatch back into nodeAttrs so subsequent re-opens see the new xml.
                state.nodeAttrs = { ...state.nodeAttrs, ...(tr as { attrs: Record<string, unknown> }).attrs };
            },
        };
        const nodeViewInstance = nodeViewFactory({
            node: { attrs: state.nodeAttrs, type: { name: 'drawioDiagram' } },
            view: fakeView,
            getPos: () => 0,
        });
        // The nodeView's dom registered a 'click' listener. Grab it.
        const dom = nodeViewInstance.dom as { listeners: Map<string, unknown[]> };
        const clickHandlers = dom.listeners.get('click') ?? [];
        if (clickHandlers.length > 0) {
            state.nodeViewClickHandler = clickHandlers[0] as () => void;
        }

        return state;
    }

    let harness: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('ignores messages from a different origin', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        expect(harness.messageHandler).not.toBeNull();
        expect(harness.iframe).not.toBeNull();
        // Send an "init" from the WRONG origin — must be ignored (no load posted).
        harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: 'https://attacker.example.com',
            data: JSON.stringify({ event: 'init' }),
        } as unknown as MessageEvent);
        expect(harness.iframe!.__postedMessages.length).toBe(0);
    });

    it('ignores messages whose source is not our iframe', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        // Different source (some other iframe) — must be ignored.
        harness.messageHandler!({
            source: { postMessage: () => {} },
            origin: EMBED_HOST,
            data: JSON.stringify({ event: 'init' }),
        } as unknown as MessageEvent);
        expect(harness.iframe!.__postedMessages.length).toBe(0);
    });

    it('responds to init with a `load` postMessage carrying the initial xml', () => {
        const initialXml = '<mxGraphModel data-test="initial"/>';
        harness = buildHarness({ xml: initialXml });
        harness.nodeViewClickHandler!();
        harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify({ event: 'init' }),
        } as unknown as MessageEvent);
        // Exactly one outbound message (the load).
        expect(harness.iframe!.__postedMessages.length).toBe(1);
        const sent = JSON.parse(harness.iframe!.__postedMessages[0] as string);
        expect(sent).toEqual({ action: 'load', xml: initialXml });
    });

    it('sends EMPTY_XML on init when no initial xml is present', () => {
        harness = buildHarness({ xml: '' });
        harness.nodeViewClickHandler!();
        harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify({ event: 'init' }),
        } as unknown as MessageEvent);
        const sent = JSON.parse(harness.iframe!.__postedMessages[0] as string);
        expect(sent.action).toBe('load');
        // Must be a valid mxGraphModel skeleton — not literally '' which would
        // make the embed editor unhappy.
        expect(sent.xml).toMatch(/<mxGraphModel/);
        expect(sent.xml).toMatch(/mxCell id="0"/);
    });

    it('on save: requests xmlsvg export, then commits xml + decoded svg on export reply', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        const msg = (event: Record<string, unknown>) => harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify(event),
        } as unknown as MessageEvent);

        msg({ event: 'init' });
        // 1 outbound (load); now clear and run save flow.
        expect(harness.iframe!.__postedMessages.length).toBe(1);

        const savedXml = '<mxGraphModel data-test="saved"><root><mxCell id="0"/></root></mxGraphModel>';
        msg({ event: 'save', xml: savedXml, modified: true });
        // Should have requested an export.
        expect(harness.iframe!.__postedMessages.length).toBe(2);
        const exportRequest = JSON.parse(harness.iframe!.__postedMessages[1] as string);
        expect(exportRequest).toEqual({ action: 'export', format: 'xmlsvg' });

        // No commit yet — we still need the export reply.
        expect(harness.dispatchedTransactions.length).toBe(0);

        // Now embed replies with the export.
        const svgRaw = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
        const svgB64 = Buffer.from(svgRaw, 'utf-8').toString('base64');
        msg({ event: 'export', data: `data:image/svg+xml;base64,${svgB64}` });

        // Exactly one transaction committed with both xml + previewSvg.
        expect(harness.dispatchedTransactions.length).toBe(1);
        expect(harness.dispatchedTransactions[0].attrs.xml).toBe(savedXml);
        expect(harness.dispatchedTransactions[0].attrs.previewSvg).toBe(svgRaw);
    });

    it('commits xml WITHOUT preview if the export reply never lands (timeout fallback)', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        const msg = (event: Record<string, unknown>) => harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify(event),
        } as unknown as MessageEvent);

        msg({ event: 'init' });

        const savedXml = '<mxGraphModel data-test="timeout-case"/>';
        msg({ event: 'save', xml: savedXml });
        // Advance past the EXPORT_TIMEOUT_MS (5s) — fake timers must fire.
        vi.advanceTimersByTime(6_000);

        expect(harness.dispatchedTransactions.length).toBe(1);
        // xml committed, previewSvg NOT touched (so existing/default value retained).
        expect(harness.dispatchedTransactions[0].attrs.xml).toBe(savedXml);
        // previewSvg should NOT have been included in the patch — i.e. the
        // commit was {xml} only, so the dispatched attrs merged in the
        // existing default previewSvg=''.
        expect(harness.dispatchedTransactions[0].attrs.previewSvg).toBe('');
    });

    it('flushes a pending save on exit even if export never replied', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        const msg = (event: Record<string, unknown>) => harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify(event),
        } as unknown as MessageEvent);

        msg({ event: 'init' });
        const savedXml = '<mxGraphModel data-test="exit-flush"/>';
        msg({ event: 'save', xml: savedXml });
        // BEFORE export reply lands, user hits exit.
        msg({ event: 'exit', modified: true });
        // exit should have flushed the save.
        expect(harness.dispatchedTransactions.length).toBe(1);
        expect(harness.dispatchedTransactions[0].attrs.xml).toBe(savedXml);
    });

    it('still commits xml when the export reply has a non-base64 / unexpected prefix', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        const msg = (event: Record<string, unknown>) => harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify(event),
        } as unknown as MessageEvent);

        msg({ event: 'init' });
        const savedXml = '<mxGraphModel data-test="weird-export"/>';
        msg({ event: 'save', xml: savedXml });
        // Embed sends something unexpected — not the data: URL we want.
        msg({ event: 'export', data: 'unexpected-format-payload' });

        expect(harness.dispatchedTransactions.length).toBe(1);
        expect(harness.dispatchedTransactions[0].attrs.xml).toBe(savedXml);
        // No preview to set, so empty string remains.
        expect(harness.dispatchedTransactions[0].attrs.previewSvg).toBe('');
    });

    it('drops the editor-open reentrancy flag after teardown so a second open works', () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        // First open: __tjDrawioEditorOpen should be true (flag set inside openEditor).
        expect((harness.fakeWindow as Record<string, unknown>).__tjDrawioEditorOpen).toBe(true);

        // exit event tears down → flag back to false
        harness.messageHandler!({
            source: harness.iframe!.contentWindow,
            origin: EMBED_HOST,
            data: JSON.stringify({ event: 'exit' }),
        } as unknown as MessageEvent);
        expect((harness.fakeWindow as Record<string, unknown>).__tjDrawioEditorOpen).toBe(false);
    });

    it("ignores a second open while the first overlay is active (no extra iframe)", () => {
        harness = buildHarness();
        harness.nodeViewClickHandler!();
        const iframesBefore = harness.iframe;
        // Second click while first overlay still up — reentrancy guard kicks in.
        harness.nodeViewClickHandler!();
        // iframe reference unchanged (no new iframe was created).
        expect(harness.iframe).toBe(iframesBefore);
    });
});
