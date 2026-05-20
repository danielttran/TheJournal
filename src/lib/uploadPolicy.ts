/**
 * Single source of truth for the upload MIME allowlist and size ceiling.
 * Shared by /api/upload (server) and any client code that wants to
 * pre-flight a file before invoking the upload endpoint.
 *
 * Add new MIMEs here, not in the route, so client + server stay in sync.
 */

export const MAX_UPLOAD_SIZE_BYTES = 225 * 1024 * 1024; // DavidRM parity

const ALLOWED_IMAGE_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/svg+xml', 'image/avif', 'image/tiff',
]);

const ALLOWED_VIDEO_MIMES = new Set([
    'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
]);

export type ClassifyResult =
    | { ok: true; kind: 'image' | 'video' }
    | { ok: false; reason: string };

export function classifyMedia(input: { type: string; size: number }): ClassifyResult {
    if (input.size > MAX_UPLOAD_SIZE_BYTES) {
        return {
            ok: false,
            reason: `File too large (size ${input.size} > limit ${MAX_UPLOAD_SIZE_BYTES})`,
        };
    }
    if (ALLOWED_IMAGE_MIMES.has(input.type)) return { ok: true, kind: 'image' };
    if (ALLOWED_VIDEO_MIMES.has(input.type)) return { ok: true, kind: 'video' };
    return { ok: false, reason: `Unsupported MIME type: ${input.type || '(unknown)'}` };
}
