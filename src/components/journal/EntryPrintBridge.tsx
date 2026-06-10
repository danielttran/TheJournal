"use client";

import { useEffect, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

/**
 * Bridges the File-menu "Print Entry" and "Export Entry to PDF" actions to
 * the renderer for BOTH modes:
 *
 *   - Electron: listens to onPrintCurrentEntry / onExportCurrentEntryPdf
 *     IPCs that main.js fires from the File menu.
 *   - Web: listens to window CustomEvents (`trigger-print-entry`,
 *     `trigger-export-pdf`) so the Editor header buttons we add can fire
 *     the same code path.
 *
 * Both paths:
 *   1. Read the current entry id from `?entry=` in the URL.
 *   2. GET /api/entry/:id/print (returns self-contained HTML).
 *   3. Either:
 *        - print: open a hidden iframe and call print() on it
 *          (works on both web and Electron — Electron's print dialog is
 *          the OS dialog).
 *        - exportPdf in Electron: call window.electron.saveEntryPdf(html).
 *        - exportPdf on web: open a hidden iframe and call print() — the
 *          OS print dialog has a "Save to PDF" option on all major
 *          platforms.
 */
interface FetchResult {
    html: string;
    title: string;
}

async function fetchEntryHtml(entryId: number): Promise<FetchResult | { locked: true } | null> {
    try {
        const res = await fetch(`/api/entry/${entryId}/print`);
        if (res.status === 423) return { locked: true };
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
            const data = await res.json() as { html?: string; title?: string };
            if (!data.html) return null;
            return { html: data.html, title: data.title ?? 'entry' };
        }
        const text = await res.text();
        // The /print route currently returns HTML directly; fall back to
        // a title sniffed from <title>...</title>.
        const m = text.match(/<title>([^<]+)<\/title>/i);
        return { html: text, title: m ? m[1] : 'entry' };
    } catch {
        return null;
    }
}

// How long to keep the print iframe attached after the print dialog opens.
// Removing it too early lets the browser GC the document mid-print and the
// dialog ends up blank in some Chromium builds. One second is the conservative
// value used by the html2canvas / print-js projects.
const PRINT_IFRAME_CLEANUP_MS = 1000;

function printHtmlInIframe(html: string) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-10000px';
    iframe.style.bottom = '-10000px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    // SECURITY: the iframe srcdoc carries user-authored entry HTML. Sandbox
    // it to neuter any <script> that slipped past the TipTap schema — without
    // allow-scripts the iframe can't execute JS, but the parent (us) can
    // still call contentWindow.print() because print() is a browser API,
    // not a script-defined function. allow-same-origin keeps parent → iframe
    // access working. We intentionally do NOT set allow-popups or
    // allow-top-navigation.
    iframe.setAttribute('sandbox', 'allow-same-origin');
    document.body.appendChild(iframe);
    const cleanup = () => {
        // Defer removal so the print dialog finishes referencing the doc.
        setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* gone */ } }, PRINT_IFRAME_CLEANUP_MS);
    };
    iframe.onload = () => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } catch {
            // Pop-up blockers or sandbox issues — surface to the user
            // instead of opening an unsandboxed Blob URL tab that would
            // execute any inline JS in the entry HTML.
            window.alert('Could not open the print dialog. Use your browser’s File → Print menu instead.');
        } finally {
            cleanup();
        }
    };
    iframe.srcdoc = html;
}

export default function EntryPrintBridge() {
    const searchParams = useSearchParams();
    const [preview, setPreview] = useState<{ html: string; title: string } | null>(null);
    useEscapeToClose(() => setPreview(null), !!preview);

    const resolveEntryId = useCallback((): number | null => {
        const entry = searchParams.get('entry');
        if (!entry) {
            window.alert('Open an entry first, then try this action.');
            return null;
        }
        const id = parseInt(entry, 10);
        if (!Number.isFinite(id) || id <= 0) {
            window.alert(`Invalid entry id in URL: ${entry}`);
            return null;
        }
        return id;
    }, [searchParams]);

    const runPrint = useCallback(async () => {
        const id = resolveEntryId();
        if (id == null) return;
        const data = await fetchEntryHtml(id);
        if (!data) {
            window.alert('Could not load entry for printing.');
            return;
        }
        if ('locked' in data) {
            window.alert('This entry’s category is locked. Unlock it before printing.');
            return;
        }
        printHtmlInIframe(data.html);
    }, [resolveEntryId]);

    const runPreview = useCallback(async () => {
        const id = resolveEntryId();
        if (id == null) return;
        const data = await fetchEntryHtml(id);
        if (!data) { window.alert('Could not load entry for preview.'); return; }
        if ('locked' in data) { window.alert('This entry’s category is locked. Unlock it before printing.'); return; }
        setPreview({ html: data.html, title: data.title });
    }, [resolveEntryId]);

    const runExportPdf = useCallback(async () => {
        const id = resolveEntryId();
        if (id == null) return;
        const data = await fetchEntryHtml(id);
        if (!data) {
            window.alert('Could not load entry for export.');
            return;
        }
        if ('locked' in data) {
            window.alert('This entry’s category is locked. Unlock it before exporting.');
            return;
        }
        if (typeof window !== 'undefined' && window.electron?.saveEntryPdf) {
            const result = await window.electron.saveEntryPdf(data.html, data.title);
            if (!result?.saved && result?.reason && result.reason !== 'canceled') {
                window.alert(`PDF export failed: ${result.reason}`);
            }
            return;
        }
        // Web fallback — OS print dialog has "Save as PDF" on every major platform.
        printHtmlInIframe(data.html);
    }, [resolveEntryId]);

    useEffect(() => {
        // Electron File-menu hooks.
        if (typeof window !== 'undefined' && window.electron?.onPrintCurrentEntry) {
            const u = window.electron.onPrintCurrentEntry(() => runPrint());
            return () => { u?.(); };
        }
    }, [runPrint]);

    useEffect(() => {
        // Web / in-app triggers — Editor's Print + PDF buttons dispatch these.
        const onPrint = () => runPrint();
        const onExport = () => runExportPdf();
        const onPreview = () => runPreview();
        window.addEventListener('trigger-print-entry', onPrint);
        window.addEventListener('trigger-print-preview', onPreview);
        window.addEventListener('trigger-export-pdf', onExport);
        return () => {
            window.removeEventListener('trigger-print-entry', onPrint);
            window.removeEventListener('trigger-print-preview', onPreview);
            window.removeEventListener('trigger-export-pdf', onExport);
        };
    }, [runPrint, runExportPdf, runPreview]);

    if (!preview) return null;
    return (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/50 p-6" onMouseDown={() => setPreview(null)}>
            <div
                className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-card shadow-2xl"
                onMouseDown={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-border-primary px-4 py-3">
                    <h3 className="truncate text-sm font-semibold text-text-primary">Print preview — {preview.title}</h3>
                    <div className="flex items-center gap-2">
                        <button onClick={() => printHtmlInIframe(preview.html)} className="rounded bg-accent-primary px-3 py-1.5 text-sm text-white hover:opacity-90">Print…</button>
                        <button onClick={() => setPreview(null)} className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-app">Close</button>
                    </div>
                </div>
                {/* Sandbox without allow-scripts: shows user-authored HTML, no JS. */}
                <iframe title="Print preview" sandbox="allow-same-origin" srcDoc={preview.html} className="w-full flex-1 bg-white" />
            </div>
        </div>
    );
}
