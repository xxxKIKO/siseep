import type { AuthResponse } from '@siseep/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, getAccessToken, onSessionChange, setAccessToken } from './api-client';

const session = (token: string): AuthResponse => ({
  accessToken: token,
  expiresIn: 900,
  user: {
    id: '111111111111111111111111',
    schoolId: '222222222222222222222222',
    username: 'MAE26-0001',
    email: 'viry@escuela.mx',
    firstName: 'Viry',
    lastName: '',
    roles: ['TEACHER'],
    status: 'ACTIVE',
  },
});

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const unauthorized = () =>
  json(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Inicia sesión para continuar.' });

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('old-token');
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
  const authHeader = (call: number) =>
    (fetchMock.mock.calls[call]?.[1]?.headers as Record<string, string>).Authorization;

  it('sends the in-memory access token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.get('/auth/me')).resolves.toEqual({ ok: true });
    expect(authHeader(0)).toBe('Bearer old-token');
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json(200, session('new-token')))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(api.get('/auth/me')).resolves.toEqual({ ok: true });
    expect(urls()).toEqual(['/api/v1/auth/me', '/api/v1/auth/refresh', '/api/v1/auth/me']);
    expect(authHeader(2)).toBe('Bearer new-token');
    expect(getAccessToken()).toBe('new-token');
  });

  it('does not refresh more than once for the same request', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json(200, session('new-token')))
      .mockResolvedValueOnce(unauthorized());

    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(urls().filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the session and throws when the refresh fails', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json(401, { code: 'INVALID_REFRESH_TOKEN' }));

    const error = await api.get('/auth/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Inicia sesión para continuar.');
    expect(getAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it('shares one refresh between concurrent 401s', async () => {
    let resolveRefresh: (res: Response) => void = () => {};
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      const token = (init?.headers as Record<string, string>).Authorization;
      return Promise.resolve(token === 'Bearer new-token' ? json(200, { url }) : unauthorized());
    });

    const requests = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    await vi.waitFor(() => expect(urls().filter((u) => u.endsWith('/refresh'))).toHaveLength(1));
    resolveRefresh(json(200, session('new-token')));

    await expect(requests).resolves.toHaveLength(3);
    expect(urls().filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('does not try to refresh for public calls', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Correo o contraseña incorrectos.',
      }),
    );
    await expect(
      api.post('/auth/login', { email: 'a@b.mx', password: 'x' }, { auth: false }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Correo o contraseña incorrectos.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeader(0)).toBeUndefined();
  });

  it('turns network failures into a Spanish error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/auth/me')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.',
    });
  });
});
