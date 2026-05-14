/**
 * Feature: listJournalsInDirectory / isJournalLikelyOpen
 *  - David RM parity for "Open another journal…": scan a folder, show all
 *    .tjdb files, ignore WAL/SHM siblings, return newest first.
 *  - Lock probe detects a sibling -wal/-shm with non-zero size.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listJournalsInDirectory, isJournalLikelyOpen } from '../../src/lib/journals';

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tj-journals-'));
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function touch(rel: string, bytes = 1, mtime?: Date) {
    const full = join(dir, rel);
    await writeFile(full, Buffer.alloc(bytes));
    if (mtime) await utimes(full, mtime, mtime);
    return full;
}

describe('listJournalsInDirectory', () => {
    it('returns empty for a missing directory', async () => {
        const out = await listJournalsInDirectory(join(dir, 'does-not-exist'));
        expect(out).toEqual([]);
    });

    it('finds .tjdb files and exposes name + size', async () => {
        const sub = join(dir, 'find');
        await mkdir(sub);
        await writeFile(join(sub, 'work.tjdb'), Buffer.alloc(1024));
        await writeFile(join(sub, 'personal.tjdb'), Buffer.alloc(2048));

        const out = await listJournalsInDirectory(sub);
        expect(out).toHaveLength(2);
        const names = out.map(j => j.name).sort();
        expect(names).toEqual(['personal', 'work']);
        const work = out.find(j => j.name === 'work')!;
        expect(work.size).toBe(1024);
        expect(work.path.endsWith('work.tjdb')).toBe(true);
    });

    it('skips -wal / -shm siblings', async () => {
        const sub = join(dir, 'siblings');
        await mkdir(sub);
        await writeFile(join(sub, 'real.tjdb'),     Buffer.alloc(1));
        await writeFile(join(sub, 'real.tjdb-wal'), Buffer.alloc(2));
        await writeFile(join(sub, 'real.tjdb-shm'), Buffer.alloc(3));
        const out = await listJournalsInDirectory(sub);
        expect(out.map(j => j.name)).toEqual(['real']);
    });

    it('skips non-.tjdb files', async () => {
        const sub = join(dir, 'mixed');
        await mkdir(sub);
        await writeFile(join(sub, 'a.tjdb'),    Buffer.alloc(1));
        await writeFile(join(sub, 'b.txt'),     Buffer.alloc(1));
        await writeFile(join(sub, 'README.md'), Buffer.alloc(1));
        const out = await listJournalsInDirectory(sub);
        expect(out.map(j => j.name)).toEqual(['a']);
    });

    it('sorts newest-modified first', async () => {
        const sub = join(dir, 'sorted');
        await mkdir(sub);
        await touch('sorted/old.tjdb',   1, new Date('2020-01-01T00:00:00Z'));
        await touch('sorted/middle.tjdb',1, new Date('2024-06-15T00:00:00Z'));
        await touch('sorted/new.tjdb',   1, new Date('2026-05-14T00:00:00Z'));
        const out = await listJournalsInDirectory(sub);
        expect(out.map(j => j.name)).toEqual(['new', 'middle', 'old']);
    });

    it('ignores subdirectories with .tjdb names', async () => {
        const sub = join(dir, 'with-subdir');
        await mkdir(sub);
        await mkdir(join(sub, 'not-a-journal.tjdb'));
        await writeFile(join(sub, 'real.tjdb'), Buffer.alloc(1));
        const out = await listJournalsInDirectory(sub);
        expect(out.map(j => j.name)).toEqual(['real']);
    });
});

describe('isJournalLikelyOpen', () => {
    it('returns false when no siblings exist', async () => {
        const p = await touch('isOpen-clean.tjdb', 1);
        expect(await isJournalLikelyOpen(p)).toBe(false);
    });

    it('returns true when a non-empty -wal sibling is present', async () => {
        const p = await touch('isOpen-wal.tjdb', 1);
        await writeFile(p + '-wal', Buffer.alloc(128));
        expect(await isJournalLikelyOpen(p)).toBe(true);
    });

    it('returns true when a non-empty -shm sibling is present', async () => {
        const p = await touch('isOpen-shm.tjdb', 1);
        await writeFile(p + '-shm', Buffer.alloc(128));
        expect(await isJournalLikelyOpen(p)).toBe(true);
    });

    it('returns false when a zero-byte sibling is present (clean shutdown left it)', async () => {
        const p = await touch('isOpen-empty.tjdb', 1);
        await writeFile(p + '-wal', Buffer.alloc(0));
        expect(await isJournalLikelyOpen(p)).toBe(false);
    });
});
