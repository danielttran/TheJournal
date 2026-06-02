/**
 * Special-character / symbol catalogue for the Insert > Special Character
 * picker (David RM parity). Pure data + a flat accessor so the picker UI
 * stays declarative and vitest can assert the catalogue's integrity.
 */

export interface SpecialCharGroup {
    label: string;
    chars: string[];
}

export const SPECIAL_CHAR_GROUPS: SpecialCharGroup[] = [
    {
        label: 'Punctuation',
        chars: ['–', '—', '…', '•', '·', '‚', '„', '“', '”', '‘', '’', '«', '»', '‹', '›', '¶', '§', '†', '‡', '′', '″'],
    },
    {
        label: 'Currency',
        chars: ['€', '£', '¥', '¢', '₹', '₽', '₩', '₿', '¤'],
    },
    {
        label: 'Math',
        chars: ['×', '÷', '±', '∓', '≈', '≠', '≤', '≥', '∞', '√', '∑', '∏', '∫', '∂', '∆', 'π', 'µ', '°', '‰', '½', '¼', '¾', '⅓', '⅔'],
    },
    {
        label: 'Arrows',
        chars: ['←', '→', '↑', '↓', '↔', '↕', '⇐', '⇒', '⇑', '⇓', '⇔', '↩', '↪', '➤', '⟶'],
    },
    {
        label: 'Symbols',
        chars: ['©', '®', '™', '★', '☆', '♥', '♦', '♣', '♠', '☑', '☐', '☒', '✓', '✗', '✦', '❤', '☀', '☁', '☂', '☃', '⚠', '☼'],
    },
    {
        label: 'Greek',
        chars: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'σ', 'φ', 'ω', 'Ω', 'Σ', 'Δ', 'Φ', 'Ψ', 'Γ', 'Λ'],
    },
];

/** Flat, de-duplicated list of every catalogued symbol. */
export function allSpecialChars(): string[] {
    return [...new Set(SPECIAL_CHAR_GROUPS.flatMap(g => g.chars))];
}
