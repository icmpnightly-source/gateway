// Helps point a work's destination at the computer the app is running on:
// what the "my IP" button of the destination field fills in.

const STORAGE_KEY = 'konggate.my-address';

/** Which of this computer's addresses the user chose last time, if any. */
export function rememberedAddress(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberAddress(address: string) {
  try {
    localStorage.setItem(STORAGE_KEY, address);
  } catch {
    // Storage disabled: it just won't be remembered.
  }
}

/** A destination with its host swapped for `host`; one that has no port yet is left ready for it to be typed. */
export function withHost(destination: string, host: string) {
  const match = /^(https?:\/\/)[^/:?#]*(.*)$/.exec(destination.trim());
  if (!match) return `http://${host}:`;

  const [, scheme, rest] = match;
  return `${scheme}${host}${rest || ':'}`;
}
