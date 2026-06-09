// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    parseSpellcheckSetting, isSpellcheckEnabled, setSpellcheckEnabled,
    SPELLCHECK_KEY, SPELLCHECK_EVENT,
} from '../../src/lib/spellcheck';

describe('spell-check preference', () => {
    beforeEach(() => localStorage.clear());

    it('defaults ON and fails safe on junk values', () => {
        expect(parseSpellcheckSetting(null)).toBe(true);
        expect(parseSpellcheckSetting('1')).toBe(true);
        expect(parseSpellcheckSetting('garbage')).toBe(true);
        expect(parseSpellcheckSetting('0')).toBe(false);
        expect(isSpellcheckEnabled()).toBe(true);
    });

    it('persists and notifies open editors', () => {
        const listener = vi.fn();
        window.addEventListener(SPELLCHECK_EVENT, listener);
        setSpellcheckEnabled(false);
        expect(localStorage.getItem(SPELLCHECK_KEY)).toBe('0');
        expect(isSpellcheckEnabled()).toBe(false);
        setSpellcheckEnabled(true);
        expect(isSpellcheckEnabled()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
        window.removeEventListener(SPELLCHECK_EVENT, listener);
    });
});
