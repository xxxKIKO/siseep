import type { AuthResponse, LoginInput, User } from '@siseep/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (input: LoginInput) => Promise<User>;
  /** Stores a session returned by the API (login, accept-invite). */
  startSession: (session: AuthResponse) => User;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
