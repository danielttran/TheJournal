import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from './session';

/**
 * Standard authenticated handler. Wraps a route function with:
 *   - userId cookie extraction + validation (returns 401 if missing/invalid)
 *   - global try/catch (returns 500 with logged error)
 *
 * This makes every endpoint failure observable and consistent.
 *
 * Implementation note: cookies are read from the NextRequest argument
 * (which Next.js always passes as the first arg to route handlers) rather
 * than via cookies() from "next/headers". The "next/headers" path fails
 * in production-built Turbopack standalone bundles with "cookies was
 * called outside a request scope" because the request's AsyncLocalStorage
 * context isn't propagated to helpers across chunk boundaries.
 * NextRequest#cookies is always populated synchronously, no context.
 */
export function authedHandler<Args extends unknown[]>(
    routeName: string,
    handler: (userId: number, ...args: Args) => Promise<Response | NextResponse>
): (...args: Args) => Promise<Response | NextResponse> {
    return async (...args: Args) => {
        try {
            const req = args[0] as NextRequest | undefined;
            const userId = verifySessionToken(req?.cookies?.get?.(SESSION_COOKIE)?.value);
            if (userId === null) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            return await handler(userId, ...args);
        } catch (err) {
            // Log full detail server-side; never echo internal errors to clients.
            console.error(`[${routeName}]`, err);
            const body: { error: string; detail?: string } = { error: 'Internal Server Error' };
            if (process.env.NODE_ENV !== 'production') {
                body.detail = err instanceof Error ? err.message : String(err);
            }
            return NextResponse.json(body, { status: 500 });
        }
    };
}

/**
 * Reads the userId from a NextRequest's cookies. Returns null when the
 * cookie is missing or malformed. Used by routes that don't go through
 * authedHandler (e.g. when the response shape is unusual or the route
 * has a custom not-authed branch).
 */
export function getUserIdFromRequest(req: NextRequest): number | null {
    return verifySessionToken(req.cookies?.get?.(SESSION_COOKIE)?.value);
}
