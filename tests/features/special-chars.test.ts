import { describe, it, expect } from 'vitest';
import { SPECIAL_CHAR_GROUPS, allSpecialChars } from '../../src/lib/specialChars';

describe('special character catalogue', () => {
    it('has non-empty named groups', () => {
        expect(SPECIAL_CHAR_GROUPS.length).toBeGreaterThan(0);
        for (const g of SPECIAL_CHAR_GROUPS) {
            expect(g.label.trim()).not.toBe('');
            expect(g.chars.length).toBeGreaterThan(0);
        }
    });

    it('contains no duplicate symbols across groups', () => {
        const flat = allSpecialChars();
        expect(new Set(flat).size).toBe(flat.length);
    });

    it('every entry is a single visible glyph (no empty strings)', () => {
        for (const c of allSpecialChars()) {
            expect(c.length).toBeGreaterThan(0);
            expect(c.trim()).toBe(c);
        }
    });
});
