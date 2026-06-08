import type { PromptConfig } from '@/components/journal/PromptModal';

/**
 * App-wide replacement for window.prompt(). window.prompt is a no-op in the
 * Electron renderer (returns null + logs a warning), so any menu flow that used
 * it was silently dead on the desktop target. requestPrompt() dispatches a
 * request that the single <PromptHost> (mounted in providers) renders as the
 * styled PromptModal, resolving with the entered value or null on cancel — so
 * the same call works identically on web and Electron.
 */

export const APP_PROMPT_EVENT = 'app-prompt-request';

/** The portion of PromptConfig a caller supplies; the host wires onConfirm. */
export type PromptRequestConfig = Omit<PromptConfig, 'onConfirm'>;

export interface PromptRequestDetail {
    config: PromptRequestConfig;
    resolve: (value: string | null) => void;
    /** Host-internal guard so confirm + the trailing onClose resolve only once. */
    settled?: boolean;
}

export function requestPrompt(config: PromptRequestConfig): Promise<string | null> {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
        const detail: PromptRequestDetail = { config, resolve };
        window.dispatchEvent(new CustomEvent<PromptRequestDetail>(APP_PROMPT_EVENT, { detail }));
    });
}
