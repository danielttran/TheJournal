/**
 * sanitizeCssLength guards the image/video width that gets interpolated into an
 * inline style string against CSS injection from pasted/imported HTML.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeCssLength } from '../../src/lib/cssLength';

describe('sanitizeCssLength', () => {
    it('passes valid CSS lengths through', () => {
        for (const v of ['100%', '320px', '50', 'auto', '12.5em', '80vw', '2rem']) {
            expect(sanitizeCssLength(v)).toBe(v);
        }
        expect(sanitizeCssLength('  240px  ')).toBe('240px'); // trimmed
    });

    it('rejects injection attempts, falling back to the default', () => {
        for (const v of ['100%;background:url(x)', '100%;position:fixed', '</style>',
            'expression(alert(1))', 'red', '', null, undefined, '12pt; color:red']) {
            expect(sanitizeCssLength(v)).toBe('100%');
        }
    });

    it('honors a custom fallback', () => {
        expect(sanitizeCssLength('bad', 'auto')).toBe('auto');
    });
});
