import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
};
const builderConfig = readFileSync('electron-builder.yml', 'utf8');
const nextConfig = readFileSync('next.config.ts', 'utf8');
const tempDirs: string[] = [];

function makeStandaloneFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'thejournal-standalone-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, 'server.js'), 'console.log("ok");');
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('desktop release packaging', () => {
    it('builds Next.js before electron-builder packages an installer', () => {
        expect(packageJson.scripts['build:installer']).toBe('npm run build:electron && npm run package:installer');
        expect(packageJson.scripts['package:installer']).toBe('node scripts/install-sqlite.js && electron-builder');
    });

    it('uses an explicit runtime allow-list without nesting the web standalone bundle', () => {
        expect(builderConfig).not.toMatch(/^\s*-\s*["']?\*\*\/\*["']?\s*$/m);
        expect(builderConfig).not.toContain('- ".next/**/*"');
        expect(builderConfig).toContain('- ".next/BUILD_ID"');
        expect(builderConfig).toContain('- ".next/*.json"');
        expect(builderConfig).toContain('- ".next/server/**/*"');
        expect(builderConfig).toContain('- ".next/static/**/*"');
        expect(builderConfig).toContain('- "src/electron/**/*"');
        expect(builderConfig).toContain('- "src/lib/menuSpec.js"');
        expect(builderConfig).toContain('- "plugins/**/*"');
    });

    it('uses a trace-exclude key that matches every route including the root', () => {
        // Next matches the key against each route with picomatch
        // { contains: true }. '*' matches '/'; '/*' silently misses it,
        // leaking the root page's traced files into the standalone bundle.
        const key = nextConfig.match(/outputFileTracingExcludes:\s*\{\s*(?:\/\/[^\n]*\n\s*)*'([^']+)':/)?.[1];
        expect(key).toBe('*');
        expect(key).not.toBe('/*');
    });
});

describe('standalone bundle verification', () => {
    it('accepts a runtime-only standalone bundle', () => {
        const dir = makeStandaloneFixture();
        mkdirSync(join(dir, '.next'), { recursive: true });
        writeFileSync(join(dir, '.next', 'BUILD_ID'), 'test');

        expect(() => execFileSync(process.execPath, ['scripts/verify-standalone.js', dir])).not.toThrow();
    });

    it('rejects database artifacts anywhere in the standalone bundle', () => {
        const dir = makeStandaloneFixture();
        writeFileSync(join(dir, 'journal.tjdb-wal'), 'private');

        const result = spawnSync(process.execPath, ['scripts/verify-standalone.js', dir]);
        expect(result.status).not.toBe(0);
    });

    it('rejects checkout-only top-level directories in the standalone bundle', () => {
        const dir = makeStandaloneFixture();
        mkdirSync(join(dir, 'tests'), { recursive: true });
        writeFileSync(join(dir, 'tests', 'fixture.ts'), 'private');

        const result = spawnSync(process.execPath, ['scripts/verify-standalone.js', dir]);
        expect(result.status).not.toBe(0);
    });
});
