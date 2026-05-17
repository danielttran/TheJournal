import type { CanvasPath } from 'react-sketch-canvas';

const METADATA_RE = /<metadata id="tj-drawing-data">([\s\S]*?)<\/metadata>/;

/** Unicode-safe base64 of the stroke JSON (chunked to survive large drawings). */
function encodePaths(paths: CanvasPath[]): string {
    const bytes = new TextEncoder().encode(JSON.stringify(paths));
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Recover the editable strokes from a previously-saved drawing SVG.
 * Returns null if the SVG wasn't produced by the drawing modal or the
 * embedded payload is missing/corrupt.
 */
export function extractDrawingPaths(svg: string): CanvasPath[] | null {
    const m = svg.match(METADATA_RE);
    if (!m) return null;
    try {
        const bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        return Array.isArray(parsed) ? (parsed as CanvasPath[]) : null;
    } catch {
        return null;
    }
}

/**
 * Build a self-contained, re-editable SVG: a white background so the sketch
 * is visible on any theme, plus the editable paths embedded as <metadata>.
 */
export function buildDrawingSvg(rawSvg: string, paths: CanvasPath[]): string {
    let svg = rawSvg;
    const openTagEnd = svg.indexOf('>');
    if (openTagEnd !== -1) {
        svg =
            svg.slice(0, openTagEnd + 1) +
            '<rect width="100%" height="100%" fill="#ffffff"/>' +
            svg.slice(openTagEnd + 1);
    }
    const meta = `<metadata id="tj-drawing-data">${encodePaths(paths)}</metadata>`;
    return svg.replace('</svg>', `${meta}</svg>`);
}
