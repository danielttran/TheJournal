import { createReadStream } from 'fs';
import { createHash } from 'crypto';

/** Stream the file through SHA-256 — avoids loading the whole DB into memory. */
export function computeFileSha256(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(path);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/** Returns true iff the file exists and its SHA-256 matches `expectedHash`. */
export async function verifyBackup(path: string, expectedHash: string): Promise<boolean> {
    try {
        const actual = await computeFileSha256(path);
        return actual.toLowerCase() === expectedHash.toLowerCase();
    } catch {
        return false;
    }
}
