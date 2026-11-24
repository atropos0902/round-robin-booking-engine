interface SentryLike {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
}

const KEEP_HEADERS = new Set(['host', 'user-agent', 'content-type', 'x-request-id']);

/**
 * Runs on everything that goes to Sentry. Keys travel in headers, names and mail addresses in
 * bodies, and the token that cancels a booking in addresses and query strings.
 */
export function scrub<T extends SentryLike>(event: T): T {
  const request = event.request;
  if (!request) return event;
  delete request.data;
  delete request.cookies;
  delete request.query_string;
  if (request.url) request.url = request.url.replace(/[?#].*$/, '').replace(/\/bookings\/[^/]+$/, '/bookings/[token]');
  if (request.headers) {
    request.headers = Object.fromEntries(Object.entries(request.headers).filter(([k]) => KEEP_HEADERS.has(k.toLowerCase())));
  }
  return event;
}
