import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
};
const builderConfig = readFileSync('electron-builder.yml', 'utf8');

describe('desktop release packaging', () => {
    it('builds Next.js before electron-builder packages an installer', () => {
        expect(packageJson.scripts['build:installer']).toBe('npm run build:electron && npm run package:installer');
        expect(packageJson.scripts['package:installer']).toBe('node scripts/install-sqlite.js && electron-builder');
    });

    it('uses an explicit runtime allow-list instead of packaging the checkout', () => {
        expect(builderConfig).not.toMatch(/^\s*-\s*["']?\*\*\/\*["']?\s*$/m);
        expect(builderConfig).toContain('- ".next/**/*"');
        expect(builderConfig).toContain('- "src/electron/**/*"');
        expect(builderConfig).toContain('- "src/lib/menuSpec.js"');
        expect(builderConfig).toContain('- "plugins/**/*"');
    });
});
