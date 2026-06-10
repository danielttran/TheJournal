/**
 * Editor spell-check preference (J8 ships configurable live spell checking;
 * here the checker itself is the platform's native one, and this controls
 * whether it runs). Default ON — only an explicit '0' disables it, so junk
 * values fail safe.
 */

export const SPELLCHECK_KEY = 'editorSpellcheck';
export const SPELLCHECK_EVENT = 'spellcheck-changed';

export function parseSpellcheckSetting(raw: string | null): boolean {
    return raw !== '0';
}

export function isSpellcheckEnabled(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return parseSpellcheckSetting(localStorage.getItem(SPELLCHECK_KEY));
}

/** Persist + notify open editors to re-apply (mirrors toolbar-config-changed). */
export function setSpellcheckEnabled(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SPELLCHECK_KEY, enabled ? '1' : '0');
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(SPELLCHECK_EVENT));
    }
}
