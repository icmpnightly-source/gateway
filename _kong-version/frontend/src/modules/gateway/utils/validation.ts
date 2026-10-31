// What Kong accepts in the names of its services and routes.
export const NAME_PATTERN = /^[\p{L}\p{N}._~-]+$/u;

// Prefix paths only: Kong's regex paths (starting with "~") are not offered.
export const PATH_PATTERN = /^\/(?!.*\/\/)[^\s?#]*$/;

// What Kong accepts in a header name.
export const HEADER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A destination is a base address: Kong takes no query string or fragment in it. */
export function isBaseUrl(value: string) {
  if (!isHttpUrl(value)) return false;

  const url = new URL(value);
  return !url.search && !url.hash;
}

/**
 * Whether an address names the machine it is used on. Kong runs in a
 * container, so from where it stands such an address is the container itself,
 * never the computer the gateway was started on.
 */
export function isLoopbackUrl(value: string) {
  if (!isHttpUrl(value)) return false;

  const { hostname } = new URL(value);
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

/** "*" or a bare origin such as https://app.example.com — no path, as browsers send it. */
export function isOrigin(value: string) {
  if (value === '*') return true;
  return isHttpUrl(value) && new URL(value).origin === value;
}
