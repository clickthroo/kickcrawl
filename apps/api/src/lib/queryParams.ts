/** Adds or replaces a single query parameter on a URL, leaving every other part (path, other params) untouched. */
export function withQueryParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/** Removes a single query parameter from a URL, if present. Used to undo withQueryParam on a fetch's reported finalUrl, so a request-only override never leaks into a stored/canonical URL. */
export function stripQueryParam(url: string, key: string): string {
  const u = new URL(url);
  u.searchParams.delete(key);
  return u.toString();
}
