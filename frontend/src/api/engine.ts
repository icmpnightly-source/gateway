import axios from 'axios';

// The gateway engine that runs inside the app serves this page, so its API is
// simply the same address. (In development the dev server passes it on: see
// vite.config.ts.)
const API_PATH = '/api';

// Separate from the starter's own client: the engine takes no app token, and
// its errors must not trigger the app-wide 401/500 redirects.
export const engine = axios.create({ baseURL: API_PATH });

/** The HTTP status a failed call was answered with; undefined when there was no answer at all. */
export function engineErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** The engine's own explanation of a failed call, or '' when it gave none (e.g. it is not running). */
export function engineErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
  }
  return '';
}
