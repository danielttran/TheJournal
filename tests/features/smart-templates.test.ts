/**
 * Feature: Smart Templates with variables
 *  - parseTemplateVariables(html) finds {{name}} / {{name:default}} / {{prompt:Question}} placeholders
 *  - substituteVariables(html, values) replaces placeholders with provided values
 *  - Built-in variables: {{date}}, {{date:FMT}}, {{time}}, {{datetime}}, {{title}}
 *  - Unknown variables passed through unchanged
 */
import { describe, it, expect } from 'vitest';
import { parseTemplateVariables, substituteVariables, applyBuiltins } from '../../src/lib/smartTemplates';

describe('parseTemplateVariables', () => {
    it('finds simple variables', () => {
        const vars = parseTemplateVariables('Hello {{name}}, today is {{date}}.');
        expect(vars.map(v => v.key)).toEqual(['name', 'date']);
    });

    it('captures default arg after colon', () => {
        const vars = parseTemplateVariables('{{date:yyyy-MM-dd}}');
        expect(vars[0].key).toBe('date');
        expect(vars[0].arg).toBe('yyyy-MM-dd');
    });

    it('captures prompt variables', () => {
        const vars = parseTemplateVariables('{{prompt:What did you learn today?}}');
        expect(vars[0].key).toBe('prompt');
        expect(vars[0].arg).toBe('What did you learn today?');
    });

    it('deduplicates repeated variables', () => {
        const vars = parseTemplateVariables('{{x}} and {{x}}');
        expect(vars.length).toBe(1);
    });
});

describe('substituteVariables', () => {
    it('replaces matched variables', () => {
        const out = substituteVariables('Hi {{name}}, age {{age}}', { name: 'Ada', age: '30' });
        expect(out).toBe('Hi Ada, age 30');
    });

    it('replaces all instances of the same variable', () => {
        const out = substituteVariables('{{x}} and {{x}}', { x: 'foo' });
        expect(out).toBe('foo and foo');
    });

    it('handles variables with args', () => {
        const out = substituteVariables('{{date:yyyy}}', { 'date:yyyy': '2026' });
        expect(out).toBe('2026');
    });

    it('leaves unknown variables in place', () => {
        const out = substituteVariables('hello {{nope}}', {});
        expect(out).toBe('hello {{nope}}');
    });

    it('escapes regex meta in arg', () => {
        // .  in key should still match the literal placeholder
        const out = substituteVariables('{{a.b}}', { 'a.b': 'matched' });
        expect(out).toBe('matched');
    });
});

describe('applyBuiltins', () => {
    it('fills {{date}} with today', () => {
        const today = new Date().toISOString().slice(0, 10);
        const out = applyBuiltins('Today is {{date}}', { title: '' });
        expect(out).toContain(today);
    });

    it('fills {{title}} with provided title', () => {
        const out = applyBuiltins('Entry: {{title}}', { title: 'My Journal' });
        expect(out).toBe('Entry: My Journal');
    });

    it('does not touch unknown variables', () => {
        const out = applyBuiltins('hello {{nope}}', { title: '' });
        expect(out).toBe('hello {{nope}}');
    });

    it('handles date:yyyy format', () => {
        const year = String(new Date().getFullYear());
        const out = applyBuiltins('{{date:yyyy}}', { title: '' });
        expect(out).toContain(year);
    });
});
