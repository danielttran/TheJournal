/**
 * Read/write helpers that transparently encrypt or decrypt entry content
 * when the owning category has a password set AND the EEK is currently
 * cached for this user. When the EEK is NOT cached, reads return the
 * ciphertext as-is and writes are refused (the route should return 423).
 *
 * Why route-side and not DB-side: SQLCipher already encrypts everything
 * at rest; the per-category layer is a separate trust boundary that the
 * user must unlock explicitly even on an already-unlocked database.
 */
import type { DBManager } from './db';
import { ENC_PREFIX, decryptWithKey, encryptWithKey } from './categoryCrypto';
import { getCategoryKey } from './categoryKeyCache';

export interface DecryptedContent {
    html: string | null;
    documentJson: string | null;
    /** True when the entry sits in a locked category and we don't have the EEK. */
    locked: boolean;
}

export async function getEntryCategoryId(
    dbm: DBManager,
    entryId: number,
): Promise<number | null> {
    const row = await dbm.prepare(
        'SELECT CategoryID FROM Entry WHERE EntryID = ?'
    ).get(entryId) as { CategoryID: number } | undefined;
    return row?.CategoryID ?? null;
}

/**
 * Decrypt an entry's HtmlContent / DocumentJson for the calling user.
 * Returns { locked: true, html: null, documentJson: null } when the
 * category is locked and the EEK isn't cached — callers should surface
 * a "this entry is locked" placeholder rather than the ciphertext.
 */
export async function decryptEntryContent(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    html: string | null,
    documentJson: string | null,
): Promise<DecryptedContent> {
    const looksEncrypted = (html ?? '').startsWith(ENC_PREFIX) || (documentJson ?? '').startsWith(ENC_PREFIX);
    if (!looksEncrypted) return { html, documentJson, locked: false };

    const eek = getCategoryKey(userId, categoryId);
    if (!eek) return { html: null, documentJson: null, locked: true };

    try {
        const outHtml = html != null ? decryptWithKey(html, eek) : null;
        const outJson = documentJson != null ? decryptWithKey(documentJson, eek) : null;
        return { html: outHtml, documentJson: outJson, locked: false };
    } catch {
        // Tag check failed — treat as locked rather than crashing the request.
        return { html: null, documentJson: null, locked: true };
    }
}

/**
 * Encrypt the html / documentJson before persisting, if the category has
 * a password set. Returns the values to write. Throws when the category
 * is locked but no EEK is cached — the route should map that to 423.
 */
export async function maybeEncryptForCategory(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    html: string | null,
    documentJson: string | null,
): Promise<{ html: string | null; documentJson: string | null }> {
    const row = await dbm.prepare(
        'SELECT PasswordHash FROM Category WHERE CategoryID = ? AND UserID = ?'
    ).get(categoryId, userId) as { PasswordHash: string | null } | undefined;
    if (!row || !row.PasswordHash) return { html, documentJson };

    const eek = getCategoryKey(userId, categoryId);
    if (!eek) {
        const err = new Error('Category is locked');
        (err as Error & { code?: string }).code = 'CATEGORY_LOCKED';
        throw err;
    }

    return {
        html: html != null ? encryptWithKey(html, eek) : null,
        documentJson: documentJson != null ? encryptWithKey(documentJson, eek) : null,
    };
}
