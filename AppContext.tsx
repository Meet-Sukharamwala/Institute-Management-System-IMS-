import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AuthUser, Branch, Permission, RoleCode } from '../shared/types';
import { apiFetch, setStoredAuthTokens } from '../lib/api';

interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface DevSandboxInfo {
  passwordHint: string;
  accounts: Array<{ email: string; fullName: string; roleCode: string; branchName: string | null }>;
}

interface AppContextValue {
  user: AuthUser | null;
  loadingAuth: boolean;
  devSandbox: DevSandboxInfo | null;
  branches: Branch[];
  selectedBranchId: string; // 'ALL' or numeric string
  setSelectedBranchId: (val: string) => void;
  hasPermission: (...perms: Permission[]) => boolean;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  notify: (type: ToastItem['type'], message: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [devSandbox, setDevSandbox] = useState<DevSandboxInfo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-1), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const refreshSession = useCallback(async () => {
    setLoadingAuth(true);
    try {
      const me = await apiFetch<{
        authenticated: boolean;
        user: AuthUser | null;
        csrfToken?: string;
        devSandbox: DevSandboxInfo | null;
      }>('/api/auth/me');
      setDevSandbox(me.devSandbox);
      if (me.authenticated && me.user) {
        setUser(me.user);
        if (me.csrfToken) {
          setStoredAuthTokens(localStorage.getItem('ims_bearer_token'), me.csrfToken);
        }
        const canSwitch =
          me.user.roleCode === RoleCode.SUPER_ADMIN ||
          me.user.permissions.includes(Permission.BRANCH_SWITCH);
        if (!canSwitch && me.user.branchId) {
          setSelectedBranchId(String(me.user.branchId));
        }
        const br = await apiFetch<{ branches: Branch[] }>('/api/branches');
        setBranches(br.branches);
      } else {
        setUser(null);
        setBranches([]);
      }
    } catch {
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredAuthTokens(null, null);
    setToasts([]);
    setUser(null);
    setSelectedBranchId('ALL');
  }, []);

  const hasPermission = useCallback(
    (...perms: Permission[]) => {
      if (!user) return false;
      return perms.some((p) => user.permissions.includes(p));
    },
    [user]
  );

  return (
    <AppContext.Provider
      value={{
        user,
        loadingAuth,
        devSandbox,
        branches,
        selectedBranchId,
        setSelectedBranchId,
        hasPermission,
        refreshSession,
        logout,
        notify,
      }}
    >
      {children}
      {/* Accessible Toast Region */}
      <div
        aria-live="polite"
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-50 flex flex-col gap-2 no-print pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto px-3.5 py-2.5 rounded-lg border shadow-sm text-xs font-medium flex items-center justify-between gap-3 bg-white ${
              t.type === 'error'
                ? 'border-red-300 text-red-800'
                : t.type === 'success'
                  ? 'border-emerald-300 text-emerald-900'
                  : 'border-slate-200 text-slate-800'
            }`}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="text-xs text-slate-500 hover:text-slate-900 shrink-0"
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
