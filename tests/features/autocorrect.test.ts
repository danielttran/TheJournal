// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    AUTOCORRECT_RULES, correctWord, wordBehindCaret,
    parseAutocorrectSetting, isAutocorrectEnabled, setAutocorrectEnabled,
} from '../../src/lib/autocorrect';

describe('auto-correct (J8 common-misspelling correction)', () => {
    beforeEach(() => localStorage.clear());

    it('corrects known misspellings and leaves correct words alone', () => {
        expect(correctWord('teh')).toBe('the');
        expect(correctWord('recieve')).toBe('receive');
        expect(correctWord('the')).toBeNull();
        expect(correctWord('')).toBeNull();
        expect(correctWord('xyzzy')).toBeNull();
    });

    it('preserves leading-cap and all-caps casing', () => {
        expect(correctWord('Teh')).toBe('The');
        expect(correctWord('TEH')).toBe('THE');
        expect(correctWord('Definately')).toBe('Definitely');
    });

    it('handles apostrophe corrections', () => {
        expect(correctWord('dont')).toBe("don't");
        expect(correctWord('Youre')).toBe("You're");
    });

    it('extracts the word ending at the caret', () => {
        expect(wordBehindCaret('I went teh')).toBe('teh');
        expect(wordBehindCaret('hello world ')).toBe('');
        expect(wordBehindCaret('dont')).toBe('dont');
        expect(wordBehindCaret('say "wierd')).toBe('wierd');
        expect(wordBehindCaret('')).toBe('');
    });

    it('every rule maps a lowercase key to a different value', () => {
        for (const [bad, good] of Object.entries(AUTOCORRECT_RULES)) {
            expect(bad).toBe(bad.toLowerCase());
            expect(good).not.toBe(bad);
            expect(good.length).toBeGreaterThan(0);
        }
    });

    it('setting defaults on, persists, fails safe on junk', () => {
        expect(parseAutocorrectSetting(null)).toBe(true);
        expect(parseAutocorrectSetting('junk')).toBe(true);
        expect(parseAutocorrectSetting('0')).toBe(false);
        expect(isAutocorrectEnabled()).toBe(true);
        setAutocorrectEnabled(false);
        expect(isAutocorrectEnabled()).toBe(false);
        setAutocorrectEnabled(true);
        expect(isAutocorrectEnabled()).toBe(true);
    });
});
