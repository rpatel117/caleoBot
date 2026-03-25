/**
 * Fetch wrapper with exponential backoff for calendar API calls.
 * Retries on 429 (rate limit) and 5xx (server error) responses.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function fetchWithRetry(
  url: string | URL,
  options?: RequestInit,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429 || response.status >= 500) {
        if (attempt === maxRetries) return response;

        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000 || BASE_DELAY_MS
          : BASE_DELAY_MS * Math.pow(2, attempt);

        console.warn(
          `[fetchWithRetry] ${response.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms: ${typeof url === 'string' ? url.split('?')[0] : url.toString().split('?')[0]}`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxRetries) throw lastError;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[fetchWithRetry] Network error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('fetchWithRetry: unexpected state');
}
