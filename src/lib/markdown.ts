/**
 * Minimal HTML → Markdown converter tuned for TipTap-generated output.
 * Doesn't aim to be a complete spec; handles the subset our editor produces.
 */

function decodeEntities(s: string): string {
    return s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function convertInline(html: string): string {
    return decodeEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
            .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
            .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
            .replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
            .replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)')
            .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![$1]($2)')
            .replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)')
            .replace(/<\/?span[^>]*>/gi, '')
            .replace(/<\/?u>/gi, '')
            .replace(/<\/?mark[^>]*>/gi, '==')
    );
}

function processBlock(tag: string, content: string): string {
    switch (tag) {
        case 'h1': return `# ${convertInline(content)}\n`;
        case 'h2': return `## ${convertInline(content)}\n`;
        case 'h3': return `### ${convertInline(content)}\n`;
        case 'h4': return `#### ${convertInline(content)}\n`;
        case 'h5': return `##### ${convertInline(content)}\n`;
        case 'h6': return `###### ${convertInline(content)}\n`;
        case 'p': return `${convertInline(content)}\n`;
        case 'blockquote': {
            const inner = htmlToMarkdown(content).trim();
            return inner.split('\n').map(l => l ? `> ${l}` : '>').join('\n') + '\n';
        }
        case 'hr': return `---\n`;
        case 'pre': {
            const code = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/i, '$1');
            return '```\n' + decodeEntities(code).trim() + '\n```\n';
        }
        case 'ul': {
            const items = [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1]);
            return items.map(i => `- ${convertInline(i).trim()}`).join('\n') + '\n';
        }
        case 'ol': {
            const items = [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1]);
            return items.map((i, n) => `${n + 1}. ${convertInline(i).trim()}`).join('\n') + '\n';
        }
        default:
            return convertInline(content);
    }
}

export function htmlToMarkdown(html: string): string {
    if (!html) return '';

    // Self-closing hr first
    const out = html.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Block-level matching: greedily eat each top-level block tag.
    const blockRe = /<(h[1-6]|p|blockquote|pre|ul|ol)>([\s\S]*?)<\/\1>/gi;
    const parts: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(out)) !== null) {
        if (m.index > last) {
            const between = out.slice(last, m.index).trim();
            if (between) parts.push(convertInline(between));
        }
        parts.push(processBlock(m[1].toLowerCase(), m[2]));
        last = m.index + m[0].length;
    }
    if (last < out.length) {
        const tail = out.slice(last).trim();
        if (tail) parts.push(convertInline(tail));
    }
    // Insert blank line between block-level parts for readability
    return parts.map(p => p.trim()).filter(Boolean).join('\n\n') + '\n';
}

export interface FrontmatterInput {
    title: string;
    createdDate?: string;
    modifiedDate?: string;
    tags?: string[];
    mood?: string | null;
}

function yamlString(v: string): string {
    if (/[":#]/.test(v) || v !== v.trim()) {
        return `"${v.replace(/"/g, '\\"')}"`;
    }
    return v;
}

export function frontmatter(fm: FrontmatterInput): string {
    const lines: string[] = ['---', `title: ${yamlString(fm.title)}`];
    if (fm.createdDate) lines.push(`created: ${fm.createdDate}`);
    if (fm.modifiedDate) lines.push(`modified: ${fm.modifiedDate}`);
    const tags = (fm.tags ?? []).filter(Boolean);
    lines.push(`tags: [${tags.join(', ')}]`);
    if (fm.mood) lines.push(`mood: ${fm.mood}`);
    lines.push('---');
    return lines.join('\n') + '\n';
}

export function exportEntry(fm: FrontmatterInput, html: string): string {
    return `${frontmatter(fm)}\n${htmlToMarkdown(html)}`;
}

export function exportCategory(items: { entry: FrontmatterInput; html: string }[]): string {
    return items.map(({ entry, html }) => exportEntry(entry, html)).join('\n\n---\n\n');
}
