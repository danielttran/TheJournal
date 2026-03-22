import argon2 from 'argon2';
import { createHash } from 'crypto';
import { cookies } from "next/headers";

const PEPPER = "TheJournalPepper2026";

export async function deriveMasterKey(password: string): Promise<string> {
    // 1. Generate deterministic 16-byte salt from password + pepper
    const salt = createHash('sha256').update(password + PEPPER).digest().slice(0, 16);
    
    // 2. Derive 32-byte key using Argon2id
    const rawKey = await argon2.hash(password, {
        type: argon2.argon2id,
        salt: salt,
        raw: true,
        memoryCost: 65536, // 64 MB
        timeCost: 3,       // 3 iterations
        parallelism: 4     // 4 threads
    });

    return rawKey.toString('hex');
}

export async function getSessionUserId(): Promise<number | null> {
    const cookieStore = await cookies();
    const userIdCookie = cookieStore.get("userId");
    if (!userIdCookie) return null;
    return parseInt(userIdCookie.value, 10);
}
