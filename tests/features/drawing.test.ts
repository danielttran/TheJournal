/**
 * Freehand drawing: editable strokes are embedded in the saved SVG as
 * base64-encoded JSON inside <metadata id="tj-drawing-data">, so a drawing
 * can be re-opened and edited. Covers extractDrawingPaths recovery + the
 * non-drawing / corrupt fallbacks.
 */
import { describe, it, expect } from 'vitest';
import { extractDrawingPaths } from '../../src/lib/drawing';

function embed(paths: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(paths));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const b64 = btoa(binary);
    return `<svg xmlns="http://www.w3.org/2000/svg"><rect/><path d="M0 0"/><metadata id="tj-drawing-data">${b64}</metadata></svg>`;
}

describe('extractDrawingPaths', () => {
    it('round-trips embedded stroke paths', () => {
        const paths = [
            { drawMode: true, strokeColor: '#111827', strokeWidth: 4, paths: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
            { drawMode: false, strokeColor: '#fff', strokeWidth: 12, paths: [{ x: 9, y: 9 }] },
        ];
        expect(extractDrawingPaths(embed(paths))).toEqual(paths);
    });

    it('handles unicode stroke metadata', () => {
        const paths = [{ strokeColor: '#000', note: 'café — 日本語 😀', paths: [] }];
        expect(extractDrawingPaths(embed(paths))).toEqual(paths);
    });

    it('returns null for an SVG without the drawing metadata', () => {
        expect(extractDrawingPaths('<svg><path d="M0 0"/></svg>')).toBeNull();
    });

    it('returns null for corrupt base64 metadata', () => {
        expect(extractDrawingPaths(
            '<svg><metadata id="tj-drawing-data">@@not-base64@@</metadata></svg>'
        )).toBeNull();
    });

    it('returns null when the decoded payload is not an array', () => {
        const b64 = btoa('{"not":"an array"}');
        expect(extractDrawingPaths(
            `<svg><metadata id="tj-drawing-data">${b64}</metadata></svg>`
        )).toBeNull();
    });
});
