import { describe, it, expect } from 'vitest';
import { normalizeLinkUrl } from '../../src/lib/linkUrl';

describe('normalizeLinkUrl', () => {
    it('passes through http(s) URLs (trimmed)', () => {
        expect(normalizeLinkUrl('  https://example.com/x ')).toEqual({ ok: true, href: 'https://example.com/x' });
        expect(normalizeLinkUrl('http://a.test')).toEqual({ ok: true, href: 'http://a.test' });
    });

    it('promotes a bare host to https', () => {
        expect(normalizeLinkUrl('example.com')).toEqual({ ok: true, href: 'https://example.com' });
        expect(normalizeLinkUrl('example.com/path?q=1')).toEqual({ ok: true, href: 'https://example.com/path?q=1' });
    });

    it('allows root-relative paths and internal journal links', () => {
        expect(normalizeLinkUrl('/journal/3')).toEqual({ ok: true, href: '/journal/3' });
        expect(normalizeLinkUrl('journal://entry/12')).toEqual({ ok: true, href: 'journal://entry/12' });
        expect(normalizeLinkUrl('mailto:a@b.com')).toEqual({ ok: true, href: 'mailto:a@b.com' });
    });

    it('rejects dangerous schemes', () => {
        expect(normalizeLinkUrl('javascript:alert(1)').ok).toBe(false);
        expect(normalizeLinkUrl('data:text/html,x').ok).toBe(false);
        expect(normalizeLinkUrl('vbscript:msgbox').ok).toBe(false);
        expect(normalizeLinkUrl('file:///etc/passwd').ok).toBe(false);
    });

    it('rejects protocol-relative URLs', () => {
        expect(normalizeLinkUrl('//evil.com').ok).toBe(false);
    });

    it('rejects empty and plain-word inputs', () => {
        expect(normalizeLinkUrl('').ok).toBe(false);
        expect(normalizeLinkUrl('   ').ok).toBe(false);
        expect(normalizeLinkUrl('notaurl').ok).toBe(false);
        expect(normalizeLinkUrl('two words.com').ok).toBe(false);
    });
});
