/**
 * Constrain a value to a single valid CSS length before it is interpolated into
 * an inline `style` string. Image/video width attributes can originate from
 * pasted or imported HTML (a data-width / width attribute), so anything that
 * isn't a plain number with an optional unit, a percentage, or "auto" falls back
 * to the default — closing a CSS-injection surface.
 */
export function sanitizeCssLength(raw: unknown, fallback = '100%'): string {
    const v = typeof raw === 'string' ? raw.trim() : '';
    return /^(auto|\d+(\.\d+)?(px|%|em|rem|vw|vh|ch)?)$/i.test(v) ? v : fallback;
}
