/**
 * Feature-gap audit coverage (pure functions, no DB):
 *  - buildReminderWhere: status-aware filter SQL fragments
 *  - exportEntryAsRTF: emoji/astral escaping + quoted-attribute tolerance
 */
import { describe, it, expect } from 'vitest';
import { buildReminderWhere } from '../../src/lib/reminders';
import { exportEntryAsRTF } from '../../src/lib/export-formats';

describe('buildReminderWhere', () => {
    it('excludes terminal statuses from active-style filters', () => {
        for (const f of ['today', 'upcoming', 'overdue'] as const) {
            const w = buildReminderWhere(f);
            expect(w).toContain("Status NOT IN ('canceled', 'skipped', 'missed')");
            expect(w).toContain('IsComplete = 0');
            expect(w.startsWith('UserID = ?')).toBe(true);
        }
    });

    it('completed filter keys off IsComplete only', () => {
        expect(buildReminderWhere('completed')).toBe('UserID = ? AND IsComplete = 1');
    });

    it('tasks filter narrows to active Task reminders', () => {
        expect(buildReminderWhere('tasks')).toBe(
            "UserID = ? AND ReminderType = 'Task' AND Status = 'active'"
        );
    });

    it('all / unknown falls back to user scope only', () => {
        expect(buildReminderWhere('all')).toBe('UserID = ?');
        // @ts-expect-error exercising the default branch
        expect(buildReminderWhere('bogus')).toBe('UserID = ?');
    });

    it('every fragment is parameterised by exactly one UserID placeholder', () => {
        for (const f of ['all', 'today', 'upcoming', 'overdue', 'completed', 'tasks'] as const) {
            expect(buildReminderWhere(f).match(/\?/g)?.length).toBe(1);
        }
    });
});

describe('exportEntryAsRTF', () => {
    const fm = { title: 'T', createdDate: '2026-01-01', modifiedDate: '2026-01-01', tags: [], mood: null };

    it('encodes BMP non-ASCII as in-range signed 16-bit \\u', () => {
        const rtf = exportEntryAsRTF(fm, '<p>café</p>');
        expect(rtf).toContain('\\u233?'); // é = U+00E9
    });

    it('encodes astral emoji as a valid surrogate pair (two \\u words, each signed 16-bit)', () => {
        const rtf = exportEntryAsRTF(fm, '<p>😀</p>'); // U+1F600
        const codes = [...rtf.matchAll(/\\u(-?\d+)\?/g)].map(m => Number(m[1]));
        // every emitted \u value must fit a signed 16-bit integer
        for (const c of codes) {
            expect(c).toBeGreaterThanOrEqual(-32768);
            expect(c).toBeLessThanOrEqual(32767);
        }
        // surrogate pair for U+1F600 is D83D DE00 → signed: -10179, -8704
        expect(codes).toContain(-10179);
        expect(codes).toContain(-8704);
    });

    it('does not leak tag text when an attribute value contains ">"', () => {
        const rtf = exportEntryAsRTF(fm, '<p><img alt="a>b" src="x"/>hello</p>');
        expect(rtf).toContain('hello');
        expect(rtf).not.toContain('src=');
        expect(rtf).not.toContain('a>b');
    });

    it('escapes RTF control characters in text', () => {
        const rtf = exportEntryAsRTF(fm, '<p>{a\\b}</p>');
        expect(rtf).toContain('\\{a\\\\b\\}');
    });
});
