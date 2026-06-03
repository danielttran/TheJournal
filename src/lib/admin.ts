import type { DBManager } from './db';
import { db } from './db';

/**
 * Multi-tenant admin gate. The app's documented model is single-active-user,
 * but it supports multiple User accounts — and a few routes are inherently
 * cross-tenant (whole-DB backup export, listing/creating/deleting accounts).
 * Without a gate, ANY authenticated user could export every user's data or
 * delete other accounts.
 *
 * The bootstrap admin is the first-registered account = the lowest UserID.
 * For a single-user install this is the only user, so gating is a no-op; for
 * multi-user it correctly restricts cross-tenant operations to the owner.
 *
 * Dependency-injected (accepts any DBManager) so it's unit-testable against a
 * temp DB; the default uses the process singleton.
 */
export async function getAdminUserId(dbm: Pick<DBManager, 'prepare'> = db): Promise<number | null> {
    const row = await dbm.prepare('SELECT MIN(UserID) AS id FROM User').get() as { id: number | null } | undefined;
    return row?.id ?? null;
}

export async function isAdminUser(userId: number, dbm: Pick<DBManager, 'prepare'> = db): Promise<boolean> {
    const adminId = await getAdminUserId(dbm);
    return adminId !== null && adminId === userId;
}
