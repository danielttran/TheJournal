"use client";

import { useEffect, useState } from 'react';
import PromptModal from './journal/PromptModal';
import { APP_PROMPT_EVENT, type PromptRequestDetail } from '@/lib/promptService';

/**
 * Single global listener for requestPrompt(). Mounted once (providers) so any
 * component — Sidebar, TipTapToolbar, GlobalIPCManager, Editor — can raise a
 * styled prompt that works on web AND Electron (window.prompt does not).
 */
export default function PromptHost() {
    const [req, setReq] = useState<PromptRequestDetail | null>(null);

    useEffect(() => {
        const onRequest = (e: Event) => {
            const next = (e as CustomEvent<PromptRequestDetail>).detail;
            setReq((prev) => {
                // A second prompt while one is open (Electron's native menu isn't
                // blocked by the DOM overlay) must not strand the first caller's
                // promise — cancel it so the awaiting flow continues.
                if (prev && !prev.settled) {
                    prev.settled = true;
                    prev.resolve(null);
                }
                return next;
            });
        };
        window.addEventListener(APP_PROMPT_EVENT, onRequest);
        return () => window.removeEventListener(APP_PROMPT_EVENT, onRequest);
    }, []);

    if (!req) return null;

    // Resolve exactly once: PromptModal calls onConfirm then its own onClose, so
    // guard against the confirm value being overwritten by the trailing null.
    const settle = (value: string | null) => {
        if (req.settled) return;
        req.settled = true;
        req.resolve(value);
        setReq(null);
    };

    return (
        <PromptModal
            key={req.id}
            config={{ ...req.config, onConfirm: (value) => { settle(value); } }}
            onClose={() => settle(null)}
        />
    );
}
