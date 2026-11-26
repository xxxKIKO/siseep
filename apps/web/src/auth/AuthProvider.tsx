import type { AuthResponse, LoginInput, User } from '@siseep/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, onSessionChange, refreshSession, setAccessToken } from '@/lib/api-client';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Restores the session on load from the httpOnly refresh cookie.
  useEffect(() => {
    let active = true;
    void refreshSession().then((session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'anonymous');
    });
    return () => {
      active = false;
    };
  }, []);

  // The HTTP interceptor renews or loses the session in the background.
  useEffect(
    () =>
      onSessionChange((session) => {
        if (session) {
          setUser(session.user);
          setStatus('authenticated');
          return;
        }
        if (statusRef.current === 'authenticated') {
          toast.info('Tu sesión terminó. Vuelve a iniciar sesión.');
          queryClient.clear();
        }
        setUser(null);
        setStatus('anonymous');
      }),
    [queryClient],
  );

  const startSession = useCallback((session: AuthResponse): User => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const login = useCallback(
    async (input: LoginInput): Promise<User> => {
      const session = await api.post<AuthResponse>('/auth/login', input, { auth: false });
      return startSession(session);
    },
    [startSession],
  );

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post<void>('/auth/logout', undefined, { auth: false });
    } finally {
      endSession();
    }
  }, [endSession]);

  const logoutAll = useCallback(async () => {
    await api.post<void>('/auth/logout-all');
    endSession();
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, startSession, logout, logoutAll }),
    [status, user, login, startSession, logout, logoutAll],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
