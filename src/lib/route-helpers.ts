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
            // Log full detail server-side; never echo internal errors to clients.
            // eslint-disable-next-line no-console
            console.error(`[${routeName}]`, err);
            const body: { error: string; detail?: string } = { error: 'Internal Server Error' };
            if (process.env.NODE_ENV !== 'production') {
                body.detail = err instanceof Error ? err.message : String(err);
            }
            return NextResponse.json(body, { status: 500 });
        }
    };
}
