// @vitest-environment jsdom
/**
 * Behavioural verification of the menu-dialog fixes:
 *  - requestPrompt/PromptHost actually open a styled prompt and round-trip the
 *    value (the Electron-safe replacement for window.prompt).
 *  - ChangePasswordModal validates + posts (replaces the dead 3×prompt flow).
 *  - SettingsModal scrolls to the deep-linked section (the "wrong section" fix).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '../../src/components/Toast';
import PromptHost from '../../src/components/PromptHost';
import ChangePasswordModal from '../../src/components/ChangePasswordModal';
import { requestPrompt } from '../../src/lib/promptService';

// Stub the heavy section components so the SettingsModal test stays focused on
// the deep-link scroll logic (the anchors live in SettingsModal's own JSX).
vi.mock('../../src/components/KeybindingsSection', () => ({ default: () => <div data-testid="kb-stub" /> }));
vi.mock('../../src/components/PluginsSection', () => ({ default: () => <div data-testid="pl-stub" /> }));
import SettingsModal from '../../src/components/SettingsModal';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('requestPrompt + PromptHost (Electron-safe replacement for window.prompt)', () => {
    it('resolves the typed value on confirm', async () => {
        render(<PromptHost />);
        let result: string | null | undefined;
        const done = requestPrompt({ title: 'Bookmark name', confirmLabel: 'Insert' }).then(v => { result = v; });
        const input = await screen.findByRole('textbox');
        fireEvent.change(input, { target: { value: 'chapter-2' } });
        fireEvent.click(screen.getByText('Insert'));
        await done;
        expect(result).toBe('chapter-2');
    });

    it('resolves null on cancel', async () => {
        render(<PromptHost />);
        let result: string | null | undefined = 'unset';
        const done = requestPrompt({ title: 'X' }).then(v => { result = v; });
        await screen.findByRole('textbox');
        fireEvent.click(screen.getByText('Cancel'));
        await done;
        expect(result).toBeNull();
    });

    it('cancels a pending prompt when a second request supersedes it (no hung promise, fresh state)', async () => {
        render(<PromptHost />);
        let first: string | null | undefined = 'unset';
        let second: string | null | undefined;
        const firstDone = requestPrompt({ title: 'First', initialValue: '' }).then(v => { first = v; });
        const input1 = await screen.findByRole('textbox');
        fireEvent.change(input1, { target: { value: 'typed-into-first' } });
        // A second prompt fires while the first is still open (e.g. Electron's
        // native menu, which the DOM overlay does not block).
        const secondDone = requestPrompt({ title: 'Second', initialValue: 'seeded' }).then(v => { second = v; });
        await firstDone; // must settle (null), not hang forever
        expect(first).toBeNull();
        // The replacement modal must mount fresh: its own initialValue, not the
        // text typed into the superseded prompt.
        await screen.findByText('Second');
        await waitFor(() => {
            const input2 = screen.getByRole('textbox') as HTMLInputElement;
            expect(input2.value).toBe('seeded');
        });
        fireEvent.click(screen.getByText('OK'));
        await secondDone;
        expect(second).toBe('seeded');
    });

    it('supports a select prompt (topic / category picker)', async () => {
        render(<PromptHost />);
        let result: string | null | undefined;
        const done = requestPrompt({
            title: 'Move Entry', confirmLabel: 'Move',
            options: [{ value: '1', label: 'Journal' }, { value: '2', label: 'Work' }],
        }).then(v => { result = v; });
        const select = await screen.findByRole('combobox');
        fireEvent.change(select, { target: { value: '2' } });
        fireEvent.click(screen.getByText('Move'));
        await done;
        expect(result).toBe('2');
    });
});

describe('ChangePasswordModal', () => {
    it('rejects mismatched new passwords without calling the API', () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const { container } = render(<ChangePasswordModal onClose={() => {}} />);
        const inputs = container.querySelectorAll('input[type=password]');
        fireEvent.change(inputs[0], { target: { value: 'oldpass12' } });
        fireEvent.change(inputs[1], { target: { value: 'newpass12' } });
        fireEvent.change(inputs[2], { target: { value: 'different99' } });
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
        expect(screen.getByText(/do not match/i)).toBeTruthy();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('posts the change and closes on success', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchSpy);
        vi.stubGlobal('alert', vi.fn());
        const onClose = vi.fn();
        const { container } = render(<ChangePasswordModal onClose={onClose} />);
        const inputs = container.querySelectorAll('input[type=password]');
        fireEvent.change(inputs[0], { target: { value: 'oldpass12' } });
        fireEvent.change(inputs[1], { target: { value: 'newpass12' } });
        fireEvent.change(inputs[2], { target: { value: 'newpass12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/user/password', expect.objectContaining({ method: 'POST' })));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

describe('SettingsModal section deep-link', () => {
    it('scrolls to the requested section (e.g. Plugins) on open', async () => {
        const scrollSpy = vi.fn();
        (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
        // next-themes reads matchMedia, which jsdom doesn't implement.
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation((q: string) => ({
            matches: false, media: q, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        })));
        render(
            <ThemeProvider attribute="class">
                <ToastProvider>
                    <SettingsModal isOpen initialSection="plugins" onClose={() => {}} />
                </ToastProvider>
            </ThemeProvider>,
        );
        await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
        const anchor = document.querySelector('[data-settings-section="plugins"]');
        expect(anchor).toBeTruthy();
        const calledOn = scrollSpy.mock.instances[0] as HTMLElement | undefined;
        if (calledOn) expect(calledOn.getAttribute('data-settings-section')).toBe('plugins');
    });
});
