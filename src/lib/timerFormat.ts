/**
 * Elapsed-time formatting for the writing timer (J8 Timer / Insert Timer).
 */

/** 'H:MM:SS' (hours unpadded, omitted entirely under an hour → 'M:SS'). */
export function formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Human sentence for inserting into an entry, e.g. "Time elapsed: 1:05:09". */
export function insertTimerText(ms: number): string {
    return `Time elapsed: ${formatElapsed(ms)}`;
}
