/**
 * Electron window-state persistence helpers (J8 remembers its window size and
 * position between launches). Pure + DOM-free so the geometry maths can be unit
 * tested in Node and required by the Electron main process.
 *
 * The hard part isn't saving bounds — it's restoring them safely. A monitor
 * that was unplugged, a resolution change, or a corrupt settings file can leave
 * a saved window entirely off every screen, where the user can never reach it.
 * `clampWindowBounds` rejects junk and nudges an off-screen window back into a
 * visible work area so the app always opens somewhere reachable.
 *
 * CommonJS on purpose: main.js is plain Node (cannot import TS/ESM). Types are
 * in the sibling windowState.d.ts.
 */

const MIN_W = 480;
const MIN_H = 360;
// A window is "reachable" only if at least this much of it overlaps a screen,
// so a sliver poking onto a display doesn't count as visible.
const MIN_VISIBLE = 80;

function isFiniteRect(b) {
    if (!b || typeof b !== 'object') return false;
    return ['x', 'y', 'width', 'height'].every(
        (k) => typeof b[k] === 'number' && Number.isFinite(b[k]),
    );
}

/**
 * Validate + clamp saved bounds against the available display areas. Returns a
 * safe bounds object, or `null` when the saved value is missing/corrupt (caller
 * should fall back to its default geometry).
 */
function clampWindowBounds(saved, areas) {
    if (!isFiniteRect(saved) || !Array.isArray(areas) || areas.length === 0) return null;

    const primary = areas[0];
    let { x, y } = saved;
    let width = Math.round(saved.width);
    let height = Math.round(saved.height);

    const maxW = Math.max(...areas.map((a) => a.width));
    const maxH = Math.max(...areas.map((a) => a.height));
    width = Math.min(Math.max(width, MIN_W), maxW);
    height = Math.min(Math.max(height, MIN_H), maxH);

    const visibleOn = (a) => {
        const xOverlap = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
        const yOverlap = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
        return xOverlap >= MIN_VISIBLE && yOverlap >= MIN_VISIBLE;
    };

    if (!areas.some(visibleOn)) {
        x = Math.round(primary.x + (primary.width - width) / 2);
        y = Math.round(primary.y + (primary.height - height) / 2);
    } else {
        x = Math.round(x);
        y = Math.round(y);
    }

    return { x, y, width, height };
}

module.exports = { clampWindowBounds };
