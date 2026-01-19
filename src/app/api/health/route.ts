import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     description: Returns the health status of the API
 *     responses:
 *       200:
 *         description: API is healthy
 */
export async function GET() {
    return NextResponse.json({ status: 'ok' });
}
