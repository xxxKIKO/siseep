import type { ApiError as ApiErrorBody, AuthResponse } from '@siseep/shared';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

/** Error thrown for any non-2xx response. `message` is the API's Spanish message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Access token: kept only in memory (never localStorage). The refresh token lives in an
// httpOnly cookie that JavaScript cannot read.
// ---------------------------------------------------------------------------
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type SessionListener = (session: AuthResponse | null) => void;
const sessionListeners = new Set<SessionListener>();

/** Notified when the interceptor renews the session (new user data) or loses it (null). */
export function onSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emitSession(session: AuthResponse | null): void {
  for (const listener of sessionListeners) listener(session);
}

// ---------------------------------------------------------------------------
// Refresh: one request at a time. Concurrent 401s share the same promise, and the Web Locks
// API serializes refreshes across tabs so two tabs never present the same (rotated) token,
// which the API would treat as reuse and revoke every session.
// ---------------------------------------------------------------------------
let refreshPromise: Promise<AuthResponse | null> | null = null;

async function doRefresh(): Promise<AuthResponse | null> {
  const run = async (): Promise<AuthResponse | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      return (await res.json()) as AuthResponse;
    } catch {
      return null;
    }
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('siseep-auth-refresh', run) : run();
}

/** Renews the access token with the refresh cookie. Returns null when there is no session. */
export function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh()
      .then((session) => {
        setAccessToken(session?.accessToken ?? null);
        emitSession(session);
        return session;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Send the access token and retry once after refreshing on 401. Default: true. */
  auth?: boolean;
  /** `blob` for binary responses (images, files). Default: JSON. */
  responseType?: 'json' | 'blob';
}

const NETWORK_ERROR_MESSAGE = 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.';

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // FormData (file uploads) sets its own multipart Content-Type with the boundary.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    return new ApiError(
      res.status,
      body.code ?? 'UNKNOWN_ERROR',
      body.message ?? 'Ocurrió un error inesperado. Intenta de nuevo.',
      body.details,
    );
  } catch {
    return new ApiError(
      res.status,
      'UNKNOWN_ERROR',
      'Ocurrió un error inesperado. Intenta de nuevo.',
    );
  }
}

/**
 * Calls the API. On a 401 it renews the access token with /auth/refresh exactly once and
 * repeats the request; if the refresh fails the session is cleared and the 401 is thrown.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  if (res.status === 401 && options.auth !== false) {
    const session = await refreshSession();
    if (session) res = await send(path, options);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  if (options.responseType === 'blob') return (await res.blob()) as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  /** multipart/form-data upload (FormData body). */
  upload: <T>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST') =>
    apiRequest<T>(path, { method, body: form }),
  /** Binary response (PDF, images). POST for generated files that take a body. */
  blob: (path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}) =>
    apiRequest<Blob>(path, {
      method: options.method ?? 'GET',
      body: options.body,
      responseType: 'blob',
    }),
};

/** Spanish message for any error, for toasts and form alerts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}
