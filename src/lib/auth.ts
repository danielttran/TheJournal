import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const ITERATIONS = 600000;
const KEYLEN = 64;
const DIGEST = "sha256";

export function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");

    return {
        hash,
        salt,
        iterations: ITERATIONS,
    };
}

export function verifyPassword(password: string, hash: string, salt: string, iterations: number) {
    const derivedHash = pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST).toString("hex");

    // Timing safe comparison to prevent timing attacks
    const derivedHashBuff = Buffer.from(derivedHash, 'hex');
    const originalHashBuff = Buffer.from(hash, 'hex');

    return timingSafeEqual(derivedHashBuff, originalHashBuff);
}
