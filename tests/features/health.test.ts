/**
 * /api/health is the only unauthenticated endpoint in the app. It's used
 * by reverse proxies, container orchestrators, and uptime monitors to
 * decide whether the server is live and the DB is reachable.
 *
 * The handler must:
 *   - Always return 200 (a 5xx from the healthcheck itself defeats the
 *     point — the monitor can't distinguish "process down" from "DB
 *     down").
 *   - Reflect DB reachability in the `status` field.
 *   - Surface uptimeMs so monitors can detect restarts.
 *   - Never leak secrets / PII.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

// We have to manipulate the dbManager singleton before importing the
// route module so the route picks up our test DB. Easiest path: import
// db.ts directly, swap its internal instance, then dynamic-import the
// route. Done per-describe so tests stay independent.

const TEST_DB_PATH = join(process.cwd(), `test-health-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let testDbm: DBManager;

beforeAll(async () => {
    testDbm = new DBManager(TEST_DB_PATH);
    await testDbm.unlock(TEST_KEY);
});

afterAll(async () => {
    await testDbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('GET /api/health', () => {
    it('returns 200 with status=ok when the DB is reachable', async () => {
        // Swap the module-scoped dbManager for our unlocked one.
        const dbModule = await import('../../src/lib/db');
        const originalInstance = dbModule.dbManager.instance;
        const originalPrepare = dbModule.dbManager.prepare.bind(dbModule.dbManager);
        vi.spyOn(dbModule.dbManager, 'prepare').mockImplementation((sql: string) =>
            testDbm.prepare(sql)
        );
        Object.defineProperty(dbModule.dbManager, 'instance', {
            get: () => testDbm.instance,
            configurable: true,
        });

        try {
            const { GET } = await import('../../src/app/api/health/route');
            const res = await GET();
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe('ok');
            expect(body.dbUnlocked).toBe(true);
            expect(typeof body.uptimeMs).toBe('number');
            expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
            expect(typeof body.version).toBe('string');
            // No PII / secrets in the response.
            expect(JSON.stringify(body)).not.toContain('PasswordHash');
            expect(JSON.stringify(body)).not.toContain('Secret');
        } finally {
            // Restore prepare
            vi.restoreAllMocks();
            // Restore instance getter — define-property doesn't get
            // auto-cleaned by vitest.
            Object.defineProperty(dbModule.dbManager, 'instance', {
                value: originalInstance,
                writable: true,
                configurable: true,
            });
            // Ensure prepare returns to its real implementation.
            (dbModule.dbManager as unknown as { prepare: typeof originalPrepare }).prepare = originalPrepare;
        }
    });

    it('returns 200 with status=degraded when the DB throws on a probe query', async () => {
        const dbModule = await import('../../src/lib/db');
        const originalPrepare = dbModule.dbManager.prepare.bind(dbModule.dbManager);
        vi.spyOn(dbModule.dbManager, 'prepare').mockImplementation(() => {
            // Mimic a borked DB connection — prepare returns a statement
            // whose .get() throws.
            return {
                get: () => Promise.reject(new Error('simulated DB outage')),
                all: () => Promise.reject(new Error('simulated DB outage')),
                run: () => Promise.reject(new Error('simulated DB outage')),
            } as unknown as ReturnType<typeof dbModule.dbManager.prepare>;
        });
        try {
            const { GET } = await import('../../src/app/api/health/route');
            const res = await GET();
            // 200 — never 5xx (a monitor needs to distinguish process-down
            // from db-down; the latter still produces a body).
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe('degraded');
        } finally {
            vi.restoreAllMocks();
            (dbModule.dbManager as unknown as { prepare: typeof originalPrepare }).prepare = originalPrepare;
        }
    });

    it('returns a uptimeMs that monotonically does not decrease across calls', async () => {
        const dbModule = await import('../../src/lib/db');
        vi.spyOn(dbModule.dbManager, 'prepare').mockImplementation((sql: string) =>
            testDbm.prepare(sql)
        );
        Object.defineProperty(dbModule.dbManager, 'instance', {
            get: () => testDbm.instance,
            configurable: true,
        });
        try {
            const { GET } = await import('../../src/app/api/health/route');
            const a = await (await GET()).json();
            // Small wait to ensure clock advances on fast hardware.
            await new Promise(r => setTimeout(r, 5));
            const b = await (await GET()).json();
            expect(b.uptimeMs).toBeGreaterThanOrEqual(a.uptimeMs);
        } finally {
            vi.restoreAllMocks();
        }
    });
});
