// What a work's name may hold.
export const NAME_PATTERN = /^[\p{L}\p{N}._~-]+$/u;

// A path prefix: starts with a slash, no doubled slashes, no query.
export const PATH_PATTERN = /^\/(?!.*\/\/)[^\s?#]*$/;

// What a header's name may hold.
export const HEADER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A destination is a base address: no query string or fragment in it. */
export function isBaseUrl(value: string) {
  if (!isHttpUrl(value)) return false;

  const url = new URL(value);
  return !url.search && !url.hash;
}

/** "*" or a bare origin such as https://app.example.com — no path, as browsers send it. */
export function isOrigin(value: string) {
  if (value === '*') return true;
  return isHttpUrl(value) && new URL(value).origin === value;
}
