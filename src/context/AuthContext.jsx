import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService.js';
import { setToken, setUnauthorizedHandler } from '../services/session.js';
import { can as canRole } from '../utils/permissions.js';

// Session handling:
//  * The access token lives in memory and is mirrored to sessionStorage (cleared when the tab closes).
//    NOTE: sessionStorage is readable by any script on the page. If Member 2 can issue an
//    httpOnly, SameSite cookie instead, prefer that (see docs/API_INTEGRATION.md).
//  * Tokens expire: the UI signs the user out at expiry and on any 401 from the backend.
//  * Logout asks the backend to revoke the token (best effort) and clears local state.

const STORAGE_KEY = 'erdash.session';
const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token || !s?.user || !s?.expiresAt || s.expiresAt <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    const s = readStoredSession();
    setToken(s?.token); // set before any child effect fires a request
    return s;
  });
  const [notice, setNotice] = useState(null);

  const clearSession = useCallback((message) => {
    setToken(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
    setNotice(message || null);
  }, []);

  const login = useCallback(async (identifier, password) => {
    const s = await authService.login(identifier, password);
    setToken(s.token);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* private mode: session still works in memory */
    }
    setNotice(null);
    setSession(s);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout(); // revoke first, while the token is still attached
    clearSession('You have been signed out.');
  }, [clearSession]);

  // Any 401 from the backend ends the session.
  useEffect(() => {
    setUnauthorizedHandler((message) => clearSession(message || 'Your session has expired. Please sign in again.'));
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Sign out automatically when the token expires.
  useEffect(() => {
    if (!session) return undefined;
    const ms = session.expiresAt - Date.now();
    if (ms <= 0) {
      clearSession('Your session has expired. Please sign in again.');
      return undefined;
    }
    const t = setTimeout(() => clearSession('Your session has expired. Please sign in again.'), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [session, clearSession]);

  const value = useMemo(
    () => ({
      user: session?.user || null,
      expiresAt: session?.expiresAt || null,
      isAuthenticated: !!session,
      notice,
      clearNotice: () => setNotice(null),
      login,
      logout,
      can: (permission) => canRole(session?.user?.role, permission),
    }),
    [session, notice, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
