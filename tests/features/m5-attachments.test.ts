/**
 * M5 — Attachments.
 *
 * The upload route enforces the MIME allowlist and a 225MB size ceiling.
 * The route is a Next.js handler that's awkward to drive in vitest, so we
 * keep the route's pure decision functions inline and test them by
 * importing the route module's exports lightly.
 *
 * Here we just cover the MIME / size policy via a tiny pure helper so any
 * future drift between route and toolbar stays caught.
 */
import { describe, it, expect } from 'vitest';
import { classifyMedia, MAX_UPLOAD_SIZE_BYTES } from '../../src/lib/uploadPolicy';

describe('classifyMedia', () => {
    it('classifies images', () => {
        expect(classifyMedia({ type: 'image/png', size: 1000 })).toEqual({ ok: true, kind: 'image' });
        expect(classifyMedia({ type: 'image/jpeg', size: 1000 })).toEqual({ ok: true, kind: 'image' });
        expect(classifyMedia({ type: 'image/svg+xml', size: 1000 })).toEqual({ ok: true, kind: 'image' });
    });

    it('classifies videos', () => {
        expect(classifyMedia({ type: 'video/mp4', size: 1000 })).toEqual({ ok: true, kind: 'video' });
        expect(classifyMedia({ type: 'video/webm', size: 1000 })).toEqual({ ok: true, kind: 'video' });
        expect(classifyMedia({ type: 'video/quicktime', size: 1000 })).toEqual({ ok: true, kind: 'video' });
    });

    it('rejects non-media MIMEs', () => {
        expect(classifyMedia({ type: 'application/pdf', size: 1 }).ok).toBe(false);
        expect(classifyMedia({ type: 'text/html', size: 1 }).ok).toBe(false);
        expect(classifyMedia({ type: '', size: 1 }).ok).toBe(false);
    });

    it('rejects files above MAX_UPLOAD_SIZE_BYTES', () => {
        const tooBig = classifyMedia({ type: 'video/mp4', size: MAX_UPLOAD_SIZE_BYTES + 1 });
        expect(tooBig.ok).toBe(false);
        if (!tooBig.ok) expect(tooBig.reason).toMatch(/size/i);
    });

    it('accepts exactly MAX_UPLOAD_SIZE_BYTES', () => {
        expect(classifyMedia({ type: 'image/png', size: MAX_UPLOAD_SIZE_BYTES }).ok).toBe(true);
    });

    it('limit matches DavidRM parity at 225 MB', () => {
        expect(MAX_UPLOAD_SIZE_BYTES).toBe(225 * 1024 * 1024);
    });
});
