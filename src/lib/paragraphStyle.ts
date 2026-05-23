/**
 * Pure helpers for the paragraph line-spacing + block-indent editor feature
 * (David RM "Paragraph Adjustments"). Kept DOM-free so the clamping/most math
 * is unit-testable; the TipTap extension in
 * components/journal/extensions/ParagraphStyle.ts consumes these.
 */

export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'] as const;
export const MAX_INDENT = 8;
export const INDENT_STEP_EM = 2;

/** Clamp an indent level into [0, MAX_INDENT] as a whole number. */
export function clampIndent(level: number): number {
    if (!Number.isFinite(level)) return 0;
    return Math.max(0, Math.min(MAX_INDENT, Math.floor(level)));
}

/** Left margin (in em) for an indent level. */
export function indentMarginEm(level: number): number {
    return clampIndent(level) * INDENT_STEP_EM;
}
