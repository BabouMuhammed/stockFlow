import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request, setCsrfToken } from '../api';
export type Session = {
  registrationCompleted?: boolean;
  user: { id: string; name: string; email: string; role: 'OWNER' | 'MANAGER' | 'CASHIER' };
  business: {
    id: string;
    name: string;
    isDemo: boolean;
    currency: string;
    defaultLowStockThreshold?: string;
  };
  csrfToken: string;
  expiresAt: string;
  branchAccess: 'MAIN_STORE';
};
const SessionContext = createContext<{
  session: Session | null | undefined;
  isPending: boolean;
  error: Error | null;
  refresh: () => void;
  login: (input: { businessId?: string; email: string; password: string }) => Promise<void>;
  registerBusiness: (input: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const session = await request<Session>('/auth/session');
        setCsrfToken(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setCsrfToken();
          void client.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
          client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 60000,
  });
  const scope = query.data
    ? query.data.business.id + ':' + query.data.user.id + ':' + query.data.user.role
    : 'anonymous';
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) {
      void client.cancelQueries({
        predicate: (q) => q.queryKey[0] !== 'session' && q.getObserversCount() === 0,
      });
      client.removeQueries({
        predicate: (q) => q.queryKey[0] !== 'session' && q.getObserversCount() === 0,
      });
      previousScope.current = scope;
    }
  }, [scope, client]);
  const clear = () => {
    setCsrfToken();
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    client.setQueryData(['session'], null);
  };
  useEffect(() => {
    const reset = () => {
      setCsrfToken();
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      client.setQueryData(['session'], null);
    };
    window.addEventListener('stockflow:unauthenticated', reset);
    return () => window.removeEventListener('stockflow:unauthenticated', reset);
  }, [client]);
  useEffect(() => {
    if (!query.data) return;
    const delay = Math.max(0, new Date(query.data.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setCsrfToken();
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      client.setQueryData(['session'], null);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [query.data, client]);
  return (
    <SessionContext.Provider
      key={scope}
      value={{
        session: query.data,
        isPending: query.isPending,
        error: query.error,
        refresh: () => {
          void query.refetch();
        },
        login: async (input) => {
          const session = await request<Session>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(input),
          });
          await client.cancelQueries();
          client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
          setCsrfToken(session.csrfToken);
          client.setQueryData(['session'], session);
        },
        registerBusiness: async (input) => {
          const session = await request<Session>('/auth/register', {
            method: 'POST',
            body: JSON.stringify(input),
          });
          await client.cancelQueries();
          client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
          setCsrfToken(session.csrfToken);
          client.setQueryData(['session'], { ...session, registrationCompleted: true });
        },
        logout: async () => {
          await request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
          clear();
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider required');
  return value;
}
