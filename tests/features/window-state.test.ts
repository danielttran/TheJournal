import { describe, it, expect } from 'vitest';
import { clampWindowBounds, type WorkArea } from '../../src/lib/windowState';

const primary: WorkArea = { x: 0, y: 0, width: 1920, height: 1080 };

describe('clampWindowBounds', () => {
    it('returns null for missing or corrupt saved bounds', () => {
        expect(clampWindowBounds(null, [primary])).toBeNull();
        expect(clampWindowBounds({ x: 0, y: 0, width: NaN, height: 600 }, [primary])).toBeNull();
        expect(clampWindowBounds({ x: 0, y: 0 }, [primary])).toBeNull();
    });

    it('returns null when there are no display areas', () => {
        expect(clampWindowBounds({ x: 0, y: 0, width: 800, height: 600 }, [])).toBeNull();
    });

    it('passes through bounds that sit on a visible screen', () => {
        expect(clampWindowBounds({ x: 100, y: 80, width: 1000, height: 700 }, [primary]))
            .toEqual({ x: 100, y: 80, width: 1000, height: 700 });
    });

    it('floors width/height to sane minimums', () => {
        const r = clampWindowBounds({ x: 10, y: 10, width: 50, height: 20 }, [primary])!;
        expect(r.width).toBeGreaterThanOrEqual(480);
        expect(r.height).toBeGreaterThanOrEqual(360);
    });

    it('caps width/height to the largest available area', () => {
        const r = clampWindowBounds({ x: 0, y: 0, width: 5000, height: 5000 }, [primary])!;
        expect(r.width).toBe(1920);
        expect(r.height).toBe(1080);
    });

    it('recenters a window that is entirely off every screen', () => {
        // Saved on a monitor that is now unplugged (negative coords far away).
        const r = clampWindowBounds({ x: -3000, y: -3000, width: 800, height: 600 }, [primary])!;
        expect(r.x).toBe(Math.round((1920 - 800) / 2));
        expect(r.y).toBe(Math.round((1080 - 600) / 2));
    });

    it('keeps a window placed on a secondary monitor', () => {
        const second: WorkArea = { x: 1920, y: 0, width: 1280, height: 1024 };
        const r = clampWindowBounds({ x: 2000, y: 100, width: 900, height: 700 }, [primary, second])!;
        expect(r).toEqual({ x: 2000, y: 100, width: 900, height: 700 });
    });
});
