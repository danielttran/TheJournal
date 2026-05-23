import { describe, it, expect } from 'vitest';
import { classifyFile, classifyMedia, MAX_UPLOAD_SIZE_BYTES } from '../../src/lib/uploadPolicy';

describe('classifyFile (generic File Attachment)', () => {
    it('accepts any non-empty file within the size limit', () => {
        expect(classifyFile({ size: 1 })).toEqual({ ok: true });
        expect(classifyFile({ size: 1024 * 1024 })).toEqual({ ok: true });
        expect(classifyFile({ size: MAX_UPLOAD_SIZE_BYTES })).toEqual({ ok: true });
    });

    it('rejects empty / non-finite sizes', () => {
        expect(classifyFile({ size: 0 }).ok).toBe(false);
        expect(classifyFile({ size: -5 }).ok).toBe(false);
        expect(classifyFile({ size: NaN }).ok).toBe(false);
    });

    it('rejects files over the ceiling', () => {
        expect(classifyFile({ size: MAX_UPLOAD_SIZE_BYTES + 1 }).ok).toBe(false);
    });
});

describe('classifyMedia still gates by MIME (unchanged)', () => {
    it('accepts images/videos and rejects others', () => {
        expect(classifyMedia({ type: 'image/png', size: 10 })).toEqual({ ok: true, kind: 'image' });
        expect(classifyMedia({ type: 'video/mp4', size: 10 })).toEqual({ ok: true, kind: 'video' });
        expect(classifyMedia({ type: 'application/pdf', size: 10 }).ok).toBe(false);
    });
});
