/**
 * Pure helper: should the app auto-lock after inactivity?
 *
 *  - thresholdMinutes <= 0 (or non-finite) means the feature is disabled.
 *  - lastActivityMs is the timestamp of the most recent user input
 *    (mouse / keyboard / touch) recorded by the renderer.
 *  - nowMs is the current time. Passed in so this stays testable.
 *
 * Returns true when the user has been idle for at least thresholdMinutes
 * and the app should lock. We treat a future lastActivityMs (clock skew)
 * as fresh activity rather than locking instantly.
 */
export function shouldLockForIdle(
    thresholdMinutes: number,
    lastActivityMs: number,
    nowMs: number,
): boolean {
    if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) return false;
    const elapsedMs = nowMs - lastActivityMs;
    if (elapsedMs <= 0) return false;
    return elapsedMs >= thresholdMinutes * 60_000;
}
