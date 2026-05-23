/**
 * Lightweight action-debug logging. Every menu / context-menu / keyboard /
 * plugin action is logged at its initiation point via `logAction`, and every
 * resulting `trigger-*` window event is logged centrally by
 * components/journal/ActionDebugLogger.
 *
 * Logging is ON by default (the owner asked to debug actions). Silence it at
 * runtime with `localStorage.setItem('tjDebugActions','0')` and re-enable with
 * '1' (or removing the key).
 */
export function actionDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('tjDebugActions') !== '0'; } catch { return true; }
}

/** Log an action at the point it is initiated (menu click, hotkey, etc.). */
export function logAction(source: string, action: string, extra?: unknown): void {
    if (!actionDebugEnabled()) return;
    // eslint-disable-next-line no-console
    console.debug('%c[TJ action]', 'color:#9333ea;font-weight:bold', `${action} — via ${source}`, extra ?? '');
}
