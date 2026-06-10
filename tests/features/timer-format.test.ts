import { describe, it, expect } from 'vitest';
import { formatElapsed, insertTimerText } from '../../src/lib/timerFormat';

describe('writing timer formatting', () => {
    it('formats sub-hour times as M:SS', () => {
        expect(formatElapsed(0)).toBe('0:00');
        expect(formatElapsed(5_000)).toBe('0:05');
        expect(formatElapsed(65_000)).toBe('1:05');
        expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59');
    });

    it('formats hour+ times as H:MM:SS', () => {
        expect(formatElapsed(3_600_000)).toBe('1:00:00');
        expect(formatElapsed(3_600_000 + 65_000)).toBe('1:01:05');
        expect(formatElapsed(10 * 3_600_000)).toBe('10:00:00');
    });

    it('clamps negatives and truncates sub-second precision', () => {
        expect(formatElapsed(-5_000)).toBe('0:00');
        expect(formatElapsed(1_999)).toBe('0:01');
    });

    it('builds the insert sentence', () => {
        expect(insertTimerText(65_000)).toBe('Time elapsed: 1:05');
    });
});
