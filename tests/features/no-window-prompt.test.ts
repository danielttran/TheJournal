import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * window.prompt() is a no-op in the Electron renderer (returns null + logs a
 * warning), so any menu/editor flow that used it was silently dead on the
 * desktop target while passing on web. These flows were migrated to the styled
 * PromptModal (via requestPrompt / dedicated modals). This guard fails if a
 * raw prompt() call sneaks back into one of them — the exact regression that
 * made "looks wired, doesn't work in Electron" menu items.
 */

const FILES = [
    'src/components/GlobalIPCManager.tsx',
    'src/components/journal/Sidebar.tsx',
    'src/components/journal/TipTapToolbar.tsx',
    'src/components/journal/Editor.tsx',
    'src/components/journal/SearchPanel.tsx',
];

// A call to window.prompt(...) or a bare prompt(...) — but NOT requestPrompt(,
// .prompt-property access, or the word "prompt" in identifiers/comments.
const PROMPT_CALL = /(?:window\s*\.\s*prompt|(?:^|[^.\w])prompt)\s*\(/;

describe('no dead window.prompt in menu/editor flows (Electron-safe)', () => {
    for (const rel of FILES) {
        it(`${rel} contains no window.prompt() call`, () => {
            const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
            const offenders = src
                .split('\n')
                .map((line, i) => ({ line: line.trim(), n: i + 1 }))
                // Ignore comment-only lines so explanatory comments are allowed.
                .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
                .filter(({ line }) => PROMPT_CALL.test(line));
            expect(offenders.map(o => `L${o.n}: ${o.line}`)).toEqual([]);
        });
    }
});
