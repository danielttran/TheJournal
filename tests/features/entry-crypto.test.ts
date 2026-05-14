/**
 * Feature: per-entry encryption (David RM "locked entry").
 *
 * AES-256-GCM keyed by PBKDF2(password, randomSalt). Round-trip recovers
 * plaintext; wrong password OR tampered ciphertext are rejected via the GCM
 * auth tag.
 */
import { describe, it, expect } from 'vitest';
import {
    encryptEntry,
    decryptEntry,
    tryDecryptEntry,
    constantTimeEqual,
    ENCRYPTED_BLOB_VERSION,
    type EncryptedBlob,
} from '../../src/lib/entryCrypto';

describe('encryptEntry / decryptEntry', () => {
    it('round-trips plain ASCII', () => {
        const blob = encryptEntry('hello world', 'pw');
        expect(decryptEntry(blob, 'pw')).toBe('hello world');
    });

    it('round-trips unicode + HTML payloads', () => {
        const plaintext = '<p>こんにちは 🌸 — день добрый</p>';
        const blob = encryptEntry(plaintext, 'pw');
        expect(decryptEntry(blob, 'pw')).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
        const blob = encryptEntry('', 'pw');
        expect(decryptEntry(blob, 'pw')).toBe('');
    });

    it('round-trips a long multi-block payload', () => {
        const big = 'x'.repeat(64 * 1024 + 13);
        const blob = encryptEntry(big, 'pw');
        expect(decryptEntry(blob, 'pw')).toBe(big);
    });

    it('produces different ciphertext every call (fresh salt + IV)', () => {
        const a = encryptEntry('hello', 'pw');
        const b = encryptEntry('hello', 'pw');
        expect(a.salt).not.toBe(b.salt);
        expect(a.iv).not.toBe(b.iv);
        expect(a.ciphertext).not.toBe(b.ciphertext);
        // Both still decrypt to the same plaintext.
        expect(decryptEntry(a, 'pw')).toBe('hello');
        expect(decryptEntry(b, 'pw')).toBe('hello');
    });

    it('stamps the blob with the current version', () => {
        expect(encryptEntry('x', 'pw').version).toBe(ENCRYPTED_BLOB_VERSION);
    });

    it('rejects wrong password', () => {
        const blob = encryptEntry('secret', 'right');
        expect(() => decryptEntry(blob, 'wrong')).toThrow();
    });

    it('rejects tampered ciphertext (GCM auth tag)', () => {
        const blob = encryptEntry('secret', 'pw');
        // Flip one bit in the ciphertext.
        const raw = Buffer.from(blob.ciphertext, 'base64');
        raw[0] ^= 0x01;
        const tampered: EncryptedBlob = { ...blob, ciphertext: raw.toString('base64') };
        expect(() => decryptEntry(tampered, 'pw')).toThrow();
    });

    it('rejects an unsupported blob version', () => {
        const blob = encryptEntry('x', 'pw');
        expect(() => decryptEntry({ ...blob, version: 999 }, 'pw')).toThrow();
    });

    it('rejects corrupt salt/iv length', () => {
        const blob = encryptEntry('x', 'pw');
        expect(() => decryptEntry({ ...blob, salt: 'AAAA' }, 'pw')).toThrow();
        expect(() => decryptEntry({ ...blob, iv: 'AAAA' }, 'pw')).toThrow();
    });

    it('rejects empty password on both encrypt and decrypt', () => {
        expect(() => encryptEntry('x', '')).toThrow();
        const blob = encryptEntry('x', 'pw');
        expect(() => decryptEntry(blob, '')).toThrow();
    });
});

describe('tryDecryptEntry', () => {
    it('returns plaintext on success', () => {
        const blob = encryptEntry('hi', 'pw');
        expect(tryDecryptEntry(blob, 'pw')).toBe('hi');
    });

    it('returns null on any failure (no throw)', () => {
        const blob = encryptEntry('hi', 'pw');
        expect(tryDecryptEntry(blob, 'wrong')).toBeNull();
        expect(tryDecryptEntry({ ...blob, version: 999 }, 'pw')).toBeNull();
    });
});

describe('constantTimeEqual', () => {
    it('returns true for identical strings', () => {
        expect(constantTimeEqual('hello', 'hello')).toBe(true);
        expect(constantTimeEqual('', '')).toBe(true);
    });

    it('returns false for different content of same length', () => {
        expect(constantTimeEqual('hello', 'world')).toBe(false);
    });

    it('returns false for different lengths', () => {
        expect(constantTimeEqual('a', 'aa')).toBe(false);
    });
});
