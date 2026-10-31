import axios from 'axios';

// A same-origin path proxied to Kong's Admin API by the dev server (vite.config.ts).
const ADMIN_PATH = '/kong-admin';

// Separate from the app's own client: the Admin API takes no app token, and
// its errors must not trigger the app-wide 401/500 redirects.
export const kongAdmin = axios.create({ baseURL: ADMIN_PATH });

/** The HTTP status a failed call was answered with; undefined when there was no answer at all. */
export function kongErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Kong's own explanation of a failed call, or '' when it gave none (e.g. it is not running). */
export function kongErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
  }
  return '';
}
