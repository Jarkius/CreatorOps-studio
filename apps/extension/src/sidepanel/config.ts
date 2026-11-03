function httpUrlOr(value: string | undefined, fallback: string): string {
  if (value === undefined || value === '') return fallback;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export const API_BASE_URL = httpUrlOr(import.meta.env.VITE_API_BASE_URL, 'http://localhost:3000');
export const DASHBOARD_URL = httpUrlOr(import.meta.env.VITE_DASHBOARD_URL, 'http://localhost:5173');
export const MOCK_AUTH = import.meta.env.VITE_AUTH_MODE === 'mock';
