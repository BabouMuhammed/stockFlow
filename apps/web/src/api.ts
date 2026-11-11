export const API_BASE_URL = import.meta.env.PROD
  ? '/api/v1'
  : (import.meta.env.VITE_API_URL ?? '/api/v1');
let csrf: string | undefined;
export const setCsrfToken = (value?: string) => {
  csrf = value;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE_URL + path, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf && options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/session')
      window.dispatchEvent(new Event('stockflow:unauthenticated'));
    throw new ApiError(response.status, data.error ?? 'Request failed', data.issues);
  }
  return data as T;
}
