// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { logAction, actionDebugEnabled } from '../../src/lib/actionLog';
import ActionDebugLogger from '../../src/components/journal/ActionDebugLogger';

let debugSpy: ReturnType<typeof vi.spyOn>;
let store: Record<string, string>;

beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    store = {};
    // jsdom in this setup doesn't expose localStorage; install a minimal fake.
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => (k in store ? store[k] : null),
            setItem: (k: string, v: string) => { store[k] = String(v); },
            removeItem: (k: string) => { delete store[k]; },
        },
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('action logging', () => {
    it('logAction logs by default and respects the off switch', () => {
        expect(actionDebugEnabled()).toBe(true);
        logAction('test', 'do-thing');
        expect(debugSpy).toHaveBeenCalled();

        debugSpy.mockClear();
        store.tjDebugActions = '0';
        expect(actionDebugEnabled()).toBe(false);
        logAction('test', 'do-thing');
        expect(debugSpy).not.toHaveBeenCalled();
    });

    it('ActionDebugLogger logs every trigger-* event, ignores others', () => {
        const { unmount } = render(React.createElement(ActionDebugLogger));
        debugSpy.mockClear();

        window.dispatchEvent(new CustomEvent('trigger-go-today', { detail: { x: 1 } }));
        expect(debugSpy.mock.calls.some((c: unknown[]) => c.includes('trigger-go-today'))).toBe(true);

        debugSpy.mockClear();
        window.dispatchEvent(new Event('some-other-event'));
        expect(debugSpy.mock.calls.some((c: unknown[]) => c.includes('some-other-event'))).toBe(false);

        unmount();
    });
});
