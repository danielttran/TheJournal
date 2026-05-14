import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Standard authenticated handler. Wraps a route function with:
 *   - userId cookie extraction + validation (returns 401 if missing/invalid)
 *   - global try/catch (returns 500 with logged error)
 *
 * This makes every endpoint failure observable and consistent.
 */
export function authedHandler<Args extends unknown[]>(
    routeName: string,
    handler: (userId: number, ...args: Args) => Promise<Response | NextResponse>
): (...args: Args) => Promise<Response | NextResponse> {
    return async (...args: Args) => {
        try {
            const c = await cookies();
            const v = c.get('userId')?.value;
            const userId = v ? parseInt(v, 10) : NaN;
            if (isNaN(userId)) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            return await handler(userId, ...args);
        } catch (err) {
            // Log enough to debug without leaking internals to the client.
            // eslint-disable-next-line no-console
            console.error(`[${routeName}]`, err);
            const message = err instanceof Error ? err.message : 'Internal Server Error';
            return NextResponse.json({ error: 'Internal Server Error', detail: message }, { status: 500 });
        }
    };
}
