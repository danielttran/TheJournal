import { describe, it, expect } from 'vitest';
import { clampIndent, indentMarginEm, MAX_INDENT, INDENT_STEP_EM } from '../../src/lib/paragraphStyle';

describe('clampIndent', () => {
    it('keeps levels within [0, MAX_INDENT]', () => {
        expect(clampIndent(0)).toBe(0);
        expect(clampIndent(3)).toBe(3);
        expect(clampIndent(-2)).toBe(0);
        expect(clampIndent(MAX_INDENT + 5)).toBe(MAX_INDENT);
    });
    it('floors fractional and coerces non-finite to 0', () => {
        expect(clampIndent(2.9)).toBe(2);
        expect(clampIndent(NaN)).toBe(0);
        expect(clampIndent(Infinity)).toBe(0);
    });
});

describe('indentMarginEm', () => {
    it('scales the clamped level by the step', () => {
        expect(indentMarginEm(0)).toBe(0);
        expect(indentMarginEm(3)).toBe(3 * INDENT_STEP_EM);
        expect(indentMarginEm(-1)).toBe(0);
        expect(indentMarginEm(MAX_INDENT + 1)).toBe(MAX_INDENT * INDENT_STEP_EM);
    });
});
