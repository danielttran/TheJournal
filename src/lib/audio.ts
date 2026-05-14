import type { DBManager } from './db';

/**
 * Voice-memo helpers — David RM parity for "Audio entries". Re-uses the
 * existing Attachment table; mime-type discriminates voice from generic
 * uploads. The UI layer is responsible for the MediaRecorder + duration
 * extraction; this module wraps the persistence + listing.
 */

const AUDIO_MIME_PREFIX = 'audio/';

export interface SaveVoiceMemoInput {
    userId: number;
    filename: string;       // suggested original name; defaults to a synthesized "memo-{ts}.{ext}"
    mimeType: string;       // must start with "audio/"
    data: Buffer | Uint8Array;
}

export interface VoiceMemo {
    AttachmentID: number;
    Filename: string;
    MimeType: string;
    Size: number;
    CreatedAt: string;
}

export function isAudioMime(mimeType: string): boolean {
    return typeof mimeType === 'string'
        && mimeType.toLowerCase().startsWith(AUDIO_MIME_PREFIX);
}

/**
 * Persist a voice memo. Returns the new AttachmentID. Refuses non-audio
 * mime types so the listing query stays trustworthy.
 */
export async function saveVoiceMemo(
    dbm: DBManager,
    input: SaveVoiceMemoInput
): Promise<number> {
    if (!isAudioMime(input.mimeType)) {
        throw new Error(`saveVoiceMemo: mimeType must be audio/* (got "${input.mimeType}")`);
    }
    const buf = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
    if (buf.length === 0) {
        throw new Error('saveVoiceMemo: empty payload');
    }
    const filename = input.filename?.trim() || `memo-${Date.now()}`;
    const r = await dbm.prepare(
        `INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
         VALUES (?, ?, ?, ?, ?)`
    ).run(input.userId, filename, input.mimeType, buf.length, buf);
    return r.lastInsertRowid;
}

/**
 * List the user's voice memos, newest first. Returns metadata only — the
 * raw Data blob is fetched separately by the playback UI so a long list
 * doesn't pull megabytes per row.
 */
export async function listVoiceMemos(
    dbm: DBManager,
    userId: number,
    limit?: number
): Promise<VoiceMemo[]> {
    const lim = typeof limit === 'number' && limit > 0
        ? ` LIMIT ${Math.floor(limit)}`
        : '';
    return dbm.prepare(`
        SELECT AttachmentID, Filename, MimeType, Size, CreatedAt
        FROM Attachment
        WHERE UserID = ? AND MimeType LIKE 'audio/%'
        ORDER BY CreatedAt DESC, AttachmentID DESC${lim}
    `).all(userId) as Promise<VoiceMemo[]>;
}

/** Load a single memo's raw audio data for playback. */
export async function loadVoiceMemoData(
    dbm: DBManager,
    userId: number,
    attachmentId: number
): Promise<Buffer | null> {
    const row = await dbm.prepare(
        `SELECT Data FROM Attachment
         WHERE AttachmentID = ? AND UserID = ? AND MimeType LIKE 'audio/%'`
    ).get(attachmentId, userId) as { Data: Buffer } | undefined;
    return row ? row.Data : null;
}

export async function deleteVoiceMemo(
    dbm: DBManager,
    userId: number,
    attachmentId: number
): Promise<boolean> {
    const r = await dbm.prepare(
        `DELETE FROM Attachment
         WHERE AttachmentID = ? AND UserID = ? AND MimeType LIKE 'audio/%'`
    ).run(attachmentId, userId);
    return r.changes > 0;
}
