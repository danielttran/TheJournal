export interface TemplateVariable {
    key: string;        // e.g. 'date', 'prompt', 'title'
    arg?: string;       // e.g. 'yyyy-MM-dd' (after colon)
    raw: string;        // e.g. '{{date:yyyy-MM-dd}}' (the full match)
}

/** Find all {{name}} or {{name:arg}} placeholders, deduplicated by `raw`. */
export function parseTemplateVariables(text: string): TemplateVariable[] {
    const seen = new Set<string>();
    const out: TemplateVariable[] = [];
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_-]*)(?::([^}]*))?\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        out.push({
            key: m[1],
            arg: m[2]?.trim(),
            raw: m[0],
        });
    }
    return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace placeholders in `text` based on `values` map. Keys in `values` may be
 *   - 'foo' to replace `{{foo}}`
 *   - 'foo:bar' to replace `{{foo:bar}}`
 */
export function substituteVariables(text: string, values: Record<string, string>): string {
    let out = text;
    for (const [key, value] of Object.entries(values)) {
        const re = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
        out = out.replace(re, value);
    }
    return out;
}

/**
 * Format a Date using a subset of tokens: yyyy, MM, dd, HH, mm, ss.
 * Tokens longer than expected ignored; not a full format library.
 */
function formatDate(d: Date, fmt: string): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const map: Record<string, string> = {
        yyyy: String(d.getFullYear()),
        MM: pad(d.getMonth() + 1),
        dd: pad(d.getDate()),
        HH: pad(d.getHours()),
        mm: pad(d.getMinutes()),
        ss: pad(d.getSeconds()),
    };
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (m) => map[m] ?? m);
}

export interface BuiltinContext {
    title: string;
    now?: Date;
}

/** Apply built-in variables. Leaves unknown variables unchanged. */
export function applyBuiltins(text: string, ctx: BuiltinContext): string {
    const now = ctx.now ?? new Date();
    const vars = parseTemplateVariables(text);
    let out = text;
    for (const v of vars) {
        let replacement: string | null = null;
        switch (v.key) {
            case 'date':
                replacement = v.arg ? formatDate(now, v.arg) : now.toISOString().slice(0, 10);
                break;
            case 'time':
                replacement = v.arg ? formatDate(now, v.arg) : now.toTimeString().slice(0, 5);
                break;
            case 'datetime':
                replacement = now.toISOString();
                break;
            case 'title':
                replacement = ctx.title ?? '';
                break;
        }
        if (replacement !== null) {
            const re = new RegExp(escapeRegex(v.raw), 'g');
            out = out.replace(re, replacement);
        }
    }
    return out;
}
