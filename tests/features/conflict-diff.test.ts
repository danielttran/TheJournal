/**
 * Conflict resolution helper.
 *  - computeConflictDiff(base, server, client) returns three lists of line-blocks:
 *    - common (shared by both)
 *    - serverOnly (lines present in server but not in client/base)
 *    - clientOnly (lines present in client but not in server/base)
 *  - autoMerge(base, server, client) attempts a 3-way merge; returns
 *    { merged, conflict }. When both sides changed the same line, conflict=true.
 */
import { describe, it, expect } from 'vitest';
import { computeConflictDiff, autoMerge } from '../../src/lib/conflict';

describe('computeConflictDiff', () => {
    it('identical inputs → empty server/client deltas', () => {
        const d = computeConflictDiff('a\nb\nc', 'a\nb\nc', 'a\nb\nc');
        expect(d.serverOnly).toEqual([]);
        expect(d.clientOnly).toEqual([]);
    });

    it('server added a line — appears in serverOnly', () => {
        const d = computeConflictDiff('a\nb', 'a\nb\nc', 'a\nb');
        expect(d.serverOnly).toContain('c');
    });

    it('client added a line — appears in clientOnly', () => {
        const d = computeConflictDiff('a\nb', 'a\nb', 'a\nb\nc');
        expect(d.clientOnly).toContain('c');
    });

    it('both sides added different lines — both appear in respective sides', () => {
        const d = computeConflictDiff('a', 'a\nserver-line', 'a\nclient-line');
        expect(d.serverOnly).toContain('server-line');
        expect(d.clientOnly).toContain('client-line');
    });
});

describe('autoMerge', () => {
    it('merges non-conflicting changes', () => {
        const r = autoMerge('a\nb\nc', 'a\nb\nc\nd', 'a\nb\nc\ne');
        expect(r.conflict).toBe(false);
        expect(r.merged).toContain('d');
        expect(r.merged).toContain('e');
    });

    it('detects a conflict when both sides change the same line', () => {
        const r = autoMerge('hello', 'hello server', 'hello client');
        expect(r.conflict).toBe(true);
    });

    it('returns server text unchanged if client made no changes', () => {
        const r = autoMerge('a\nb', 'a\nB', 'a\nb');
        expect(r.conflict).toBe(false);
        expect(r.merged).toContain('B');
    });

    it('returns client text unchanged if server made no changes', () => {
        const r = autoMerge('a\nb', 'a\nb', 'a\nbb');
        expect(r.conflict).toBe(false);
        expect(r.merged).toContain('bb');
    });
});
