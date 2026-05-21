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
 * This is the smoke test that catches "the plugin throws on registration"
 * regressions — exactly the class of bug an absent test masks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Captured {
    extensions: Record<string, unknown>[];
    toolbarButtons: { id: string; label: string; icon?: string; onClick: unknown }[];
}

function runPluginInMockedBrowser(scriptPath: string): Captured {
    const script = readFileSync(scriptPath, 'utf8');
    const captured: Captured = { extensions: [], toolbarButtons: [] };

    const fakeApi = {
        registerTiptapExtension(ext: Record<string, unknown>) {
            captured.extensions.push(ext);
        },
        registerToolbarButton(button: { id: string; label: string; icon?: string; onClick: unknown }) {
            captured.toolbarButtons.push(button);
        },
    };

    // The plugin uses document.createElement / createElementNS to build
    // DOM bits up front. We don't actually need a working DOM — just
    // enough to keep the registration code from throwing. registration
    // itself doesn't touch the DOM; only the node-view code does, and
    // node-view doesn't run until Tiptap mounts.
    const stubElement = {
        appendChild() {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        remove() {},
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        style: new Proxy({}, { set: () => true }),
        classList: { add() {}, remove() {} },
        querySelector: () => null,
        querySelectorAll: () => [],
        innerHTML: '',
        textContent: '',
        contentWindow: { postMessage() {} },
    };
    const fakeDocument = {
        createElement: () => ({ ...stubElement }),
        createElementNS: () => ({ ...stubElement }),
        body: { appendChild() {}, removeChild() {} },
        addEventListener() {},
        removeEventListener() {},
    };

    // btoa/atob exist on Node 16+ globals, so we just expose them via
    // the closure passed to new Function. window is also needed.
    const fakeWindow: Record<string, unknown> = {
        TheJournalAPI: fakeApi,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
    };

    // Run the IIFE.
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

    return captured;
}

describe('bundled plugin: sentence-diagrammer', () => {
    const path = join(process.cwd(), 'plugins', 'sentence-diagrammer', 'main.js');

    it('loads and registers exactly one Tiptap extension', () => {
        const captured = runPluginInMockedBrowser(path);
        expect(captured.extensions.length).toBe(1);
        expect(captured.extensions[0].name).toBe('sentenceDiagram');
    });

    it('registers a toolbar button with id sentence-diagrammer', () => {
        const captured = runPluginInMockedBrowser(path);
        expect(captured.toolbarButtons.length).toBe(1);
        expect(captured.toolbarButtons[0].id).toBe('sentence-diagrammer');
        expect(captured.toolbarButtons[0].icon).toBe('network');
        expect(typeof captured.toolbarButtons[0].onClick).toBe('function');
    });
});

describe('bundled plugin: drawio', () => {
    const path = join(process.cwd(), 'plugins', 'drawio', 'main.js');

    it('loads and registers the drawioDiagram extension', () => {
        const captured = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram');
        expect(ext, 'drawioDiagram extension not registered').toBeDefined();
    });

    it('exposes `xml` and `previewSvg` attributes with parseHTML/renderHTML round-trips', () => {
        const captured = runPluginInMockedBrowser(path);
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
        const captured = runPluginInMockedBrowser(path);
        const btn = captured.toolbarButtons.find(b => b.id === 'drawio');
        expect(btn, 'drawio toolbar button not registered').toBeDefined();
        expect(btn!.icon).toBe('git-merge');
        expect(btn!.label).toBe('Diagram');
        expect(typeof btn!.onClick).toBe('function');
    });

    it('declares itself as an atom block node', () => {
        const captured = runPluginInMockedBrowser(path);
        const ext = captured.extensions.find(e => e.name === 'drawioDiagram') as
            { group?: string; atom?: boolean };
        expect(ext.group).toBe('block');
        expect(ext.atom).toBe(true);
    });
});
