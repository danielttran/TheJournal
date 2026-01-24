/**
 * Centralized API client with auto-retry, timeout, and error handling.
 * Mission-critical reliability for network operations.
 */

interface FetchOptions extends RequestInit {
    timeout?: number;
    retries?: number;
}

/**
 * Fetch wrapper with auto-retry and exponential backoff.
 * 
 * @param url - The URL to fetch
 * @param options - Fetch options plus timeout and retries
 * @returns Promise with parsed JSON response
 * @throws Error after all retries exhausted
 */
export async function apiFetch<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const { timeout = 10000, retries = 3, ...fetchOptions } = options;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            const isLastAttempt = attempt === retries - 1;
            const isAbortError = error instanceof Error && error.name === 'AbortError';

            if (isLastAttempt) {
                console.error(`API fetch failed after ${retries} attempts:`, url, error);
                throw error;
            }

            // Don't retry on abort (timeout)
            if (isAbortError) {
                throw new Error(`Request timed out after ${timeout}ms`);
            }

            // Exponential backoff: 500ms, 1000ms, 2000ms
            const delay = 500 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('Unexpected: retries exhausted without throwing');
}

/**
 * POST helper with JSON body
 */
export async function apiPost<T>(url: string, body: object, options: FetchOptions = {}): Promise<T> {
    return apiFetch<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
        body: JSON.stringify(body),
        ...options
    });
}

/**
 * PUT helper with JSON body
 */
export async function apiPut<T>(url: string, body: object, options: FetchOptions = {}): Promise<T> {
    return apiFetch<T>(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
        body: JSON.stringify(body),
        ...options
    });
}

/**
 * DELETE helper
 */
export async function apiDelete<T>(url: string, options: FetchOptions = {}): Promise<T> {
    return apiFetch<T>(url, {
        method: 'DELETE',
        ...options
    });
}
