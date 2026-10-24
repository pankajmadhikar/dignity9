import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/services/api';
import type { ClinicInfo, StaffUser } from '@/types';

type AuthState = {
  user: StaffUser | null;
  clinic: ClinicInfo | null;
  ready: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [ready, setReady] = useState(false);

  async function refresh() {
    try {
      const data = await api<{ user: StaffUser; clinic: ClinicInfo | null }>('/api/auth/me');
      setUser(data.user);
      setClinic(data.clinic);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setClinic(null);
        return;
      }
      setUser(null);
      setClinic(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      clinic,
      ready,
      refresh,
      logout: async () => {
        await api('/api/auth/logout', { method: 'POST' });
        setUser(null);
        setClinic(null);
      },
    }),
    [user, clinic, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}
