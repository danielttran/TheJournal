/**
 * Feature: voice-memo helpers (David RM "Audio entries").
 *  - saveVoiceMemo persists + returns ID; refuses non-audio mime + empty payload.
 *  - listVoiceMemos returns newest-first metadata, scoped per user.
 *  - loadVoiceMemoData returns raw bytes; null when missing or cross-user.
 *  - deleteVoiceMemo removes only audio rows, only the user's own.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    saveVoiceMemo,
    listVoiceMemos,
    loadVoiceMemoData,
    deleteVoiceMemo,
    isAudioMime,
} from '../../src/lib/audio';

const TEST_DB_PATH = join(process.cwd(), `test-audio-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'me');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'other');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Attachment').run();
});

describe('isAudioMime', () => {
    it('accepts audio/* and rejects others', () => {
        expect(isAudioMime('audio/webm')).toBe(true);
        expect(isAudioMime('audio/mp4')).toBe(true);
        expect(isAudioMime('AUDIO/Ogg')).toBe(true);
        expect(isAudioMime('image/png')).toBe(false);
        expect(isAudioMime('')).toBe(false);
        // @ts-expect-error — defensive against non-string input
        expect(isAudioMime(undefined)).toBe(false);
    });
});

describe('saveVoiceMemo', () => {
    it('inserts an audio attachment and returns its ID', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID,
            filename: 'morning-memo.webm',
            mimeType: 'audio/webm',
            data: Buffer.from('fake audio bytes'),
        });
        expect(id).toBeGreaterThan(0);
        const list = await listVoiceMemos(dbm, USER_ID);
        expect(list).toHaveLength(1);
        expect(list[0].AttachmentID).toBe(id);
        expect(list[0].Filename).toBe('morning-memo.webm');
        expect(list[0].MimeType).toBe('audio/webm');
        expect(list[0].Size).toBe(Buffer.from('fake audio bytes').length);
    });

    it('refuses non-audio mime types', async () => {
        await expect(saveVoiceMemo(dbm, {
            userId: USER_ID,
            filename: 'note.txt',
            mimeType: 'text/plain',
            data: Buffer.from('hi'),
        })).rejects.toThrow(/audio\/\*/);
    });

    it('refuses an empty payload', async () => {
        await expect(saveVoiceMemo(dbm, {
            userId: USER_ID,
            filename: 'empty.webm',
            mimeType: 'audio/webm',
            data: Buffer.alloc(0),
        })).rejects.toThrow(/empty/i);
    });

    it('synthesises a filename when blank', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID,
            filename: '   ',
            mimeType: 'audio/mp4',
            data: Buffer.from([1, 2, 3]),
        });
        const list = await listVoiceMemos(dbm, USER_ID);
        const row = list.find(m => m.AttachmentID === id)!;
        expect(row.Filename).toMatch(/^memo-\d+/);
    });

    it('accepts Uint8Array as well as Buffer', async () => {
        const u8 = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID,
            filename: 'riff.wav',
            mimeType: 'audio/wav',
            data: u8,
        });
        expect(await loadVoiceMemoData(dbm, USER_ID, id)).toEqual(Buffer.from(u8));
    });
});

describe('listVoiceMemos', () => {
    it('returns newest first by CreatedAt then AttachmentID', async () => {
        const a = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'a.webm', mimeType: 'audio/webm', data: Buffer.from('a'),
        });
        const b = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'b.webm', mimeType: 'audio/webm', data: Buffer.from('b'),
        });
        const list = await listVoiceMemos(dbm, USER_ID);
        expect(list[0].AttachmentID).toBe(b);
        expect(list[1].AttachmentID).toBe(a);
    });

    it('ignores non-audio attachments', async () => {
        await dbm.prepare(
            `INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
             VALUES (?, ?, ?, ?, ?)`
        ).run(USER_ID, 'pic.png', 'image/png', 4, Buffer.from('png!'));
        await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'voice.webm', mimeType: 'audio/webm', data: Buffer.from('vv'),
        });
        const list = await listVoiceMemos(dbm, USER_ID);
        expect(list.map(m => m.Filename)).toEqual(['voice.webm']);
    });

    it('is scoped per user', async () => {
        await saveVoiceMemo(dbm, { userId: USER_ID, filename: 'mine.webm', mimeType: 'audio/webm', data: Buffer.from('x') });
        await saveVoiceMemo(dbm, { userId: OTHER_USER_ID, filename: 'theirs.webm', mimeType: 'audio/webm', data: Buffer.from('y') });
        expect((await listVoiceMemos(dbm, USER_ID)).map(m => m.Filename)).toEqual(['mine.webm']);
        expect((await listVoiceMemos(dbm, OTHER_USER_ID)).map(m => m.Filename)).toEqual(['theirs.webm']);
    });

    it('respects limit', async () => {
        for (let i = 0; i < 5; i++) {
            await saveVoiceMemo(dbm, {
                userId: USER_ID, filename: `m${i}.webm`, mimeType: 'audio/webm', data: Buffer.from([i]),
            });
        }
        expect(await listVoiceMemos(dbm, USER_ID, 2)).toHaveLength(2);
    });
});

describe('loadVoiceMemoData', () => {
    it('returns the raw bytes', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'm.webm', mimeType: 'audio/webm', data: Buffer.from('hello'),
        });
        const got = await loadVoiceMemoData(dbm, USER_ID, id);
        expect(got?.toString('utf8')).toBe('hello');
    });

    it('returns null for cross-user requests', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'm.webm', mimeType: 'audio/webm', data: Buffer.from('hi'),
        });
        expect(await loadVoiceMemoData(dbm, OTHER_USER_ID, id)).toBeNull();
    });

    it('returns null when attachment is a non-audio row', async () => {
        const r = await dbm.prepare(
            `INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
             VALUES (?, ?, ?, ?, ?)`
        ).run(USER_ID, 'pic.png', 'image/png', 4, Buffer.from('png!'));
        expect(await loadVoiceMemoData(dbm, USER_ID, r.lastInsertRowid)).toBeNull();
    });
});

describe('deleteVoiceMemo', () => {
    it('removes the row and returns true', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'm.webm', mimeType: 'audio/webm', data: Buffer.from('x'),
        });
        expect(await deleteVoiceMemo(dbm, USER_ID, id)).toBe(true);
        expect(await listVoiceMemos(dbm, USER_ID)).toHaveLength(0);
    });

    it('returns false when nothing matched', async () => {
        expect(await deleteVoiceMemo(dbm, USER_ID, 999999)).toBe(false);
    });

    it('refuses to delete another user\'s memo', async () => {
        const id = await saveVoiceMemo(dbm, {
            userId: USER_ID, filename: 'm.webm', mimeType: 'audio/webm', data: Buffer.from('x'),
        });
        expect(await deleteVoiceMemo(dbm, OTHER_USER_ID, id)).toBe(false);
        expect(await listVoiceMemos(dbm, USER_ID)).toHaveLength(1);
    });
});
