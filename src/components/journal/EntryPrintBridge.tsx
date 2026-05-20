"use client";

import { useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

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
async function fetchEntryHtml(entryId: number): Promise<{ html: string; title: string } | null> {
    try {
        const res = await fetch(`/api/entry/${entryId}/print`);
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

function printHtmlInIframe(html: string) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-10000px';
    iframe.style.bottom = '-10000px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const cleanup = () => {
        // Defer removal so the print dialog finishes referencing the doc.
        setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* gone */ } }, 1000);
    };
    iframe.onload = () => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } catch {
            // Pop-up blockers or sandbox issues — fall back to a new tab.
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } finally {
            cleanup();
        }
    };
    iframe.srcdoc = html;
}

export default function EntryPrintBridge() {
    const searchParams = useSearchParams();

    const runPrint = useCallback(async () => {
        const entry = searchParams.get('entry');
        if (!entry) {
            window.alert('Open an entry first, then try printing.');
            return;
        }
        const id = parseInt(entry, 10);
        if (!Number.isFinite(id)) return;
        const data = await fetchEntryHtml(id);
        if (!data) {
            window.alert('Could not load entry for printing.');
            return;
        }
        printHtmlInIframe(data.html);
    }, [searchParams]);

    const runExportPdf = useCallback(async () => {
        const entry = searchParams.get('entry');
        if (!entry) {
            window.alert('Open an entry first, then try exporting.');
            return;
        }
        const id = parseInt(entry, 10);
        if (!Number.isFinite(id)) return;
        const data = await fetchEntryHtml(id);
        if (!data) {
            window.alert('Could not load entry for export.');
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
    }, [searchParams]);

    useEffect(() => {
        // Electron File-menu hooks.
        if (typeof window !== 'undefined' && window.electron?.onPrintCurrentEntry) {
            const u = window.electron.onPrintCurrentEntry(() => runPrint());
            return () => { u?.(); };
        }
    }, [runPrint]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.onExportCurrentEntryPdf) {
            const u = window.electron.onExportCurrentEntryPdf(() => runExportPdf());
            return () => { u?.(); };
        }
    }, [runExportPdf]);

    useEffect(() => {
        // Web / in-app triggers — Editor's Print + PDF buttons dispatch these.
        const onPrint = () => runPrint();
        const onExport = () => runExportPdf();
        window.addEventListener('trigger-print-entry', onPrint);
        window.addEventListener('trigger-export-pdf', onExport);
        return () => {
            window.removeEventListener('trigger-print-entry', onPrint);
            window.removeEventListener('trigger-export-pdf', onExport);
        };
    }, [runPrint, runExportPdf]);

    return null;
}
