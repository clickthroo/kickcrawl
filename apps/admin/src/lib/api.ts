const BASE = '/api';

export class ApiError extends Error {
  status: number;
  /** The full parsed response body, when the server sent one - lets a caller read extra fields (e.g. a diagnostic) beyond just `error`. */
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Without this, a request the backend never actually answers (a hung DB
// query, an unresponsive Redis) leaves fetch()'s promise pending forever -
// not rejected, just never settled - so a page whose data-load .then()
// has no .catch() (or does, but nothing ever calls it) is stuck on its
// loading state permanently with no way to tell "still working" apart
// from "will never finish". Bounding every request means a genuine
// backend hang surfaces as a real, visible error within a fixed time
// instead of an indefinite blank/loading screen.
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: 'include',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        // Fastify rejects a request outright when Content-Type is JSON but the
        // body is empty (e.g. a bodyless POST like "run map" or "log out"), so
        // this header is only sent when there's actually a body to describe.
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(0, `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new ApiError(0, 'Network error - could not reach the server');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed with ${res.status}`, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
