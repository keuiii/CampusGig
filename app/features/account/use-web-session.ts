import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";

const legacyAccessTokenKeys = [
  "campusgig.webToken",
  "campusgig.adminToken",
  "campusgig.providerToken",
] as const;

export function clearLegacyAccessTokenStorage(storage: Storage) {
  for (const key of legacyAccessTokenKeys) storage.removeItem(key);
}

export function useWebSession(onUnauthorized: () => void) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const applySession = useCallback((accessToken: string, account: AuthUser) => {
    clearLegacyAccessTokenStorage(window.localStorage);
    setToken(accessToken);
    setUser(account);
  }, []);

  const clearSession = useCallback(() => {
    clearLegacyAccessTokenStorage(window.localStorage);
    setToken("");
    setUser(null);
  }, []);

  useEffect(() => {
    const legacyToken = legacyAccessTokenKeys
      .map((key) => window.localStorage.getItem(key))
      .find((value): value is string => Boolean(value));
    const restore = legacyToken
      ? api.me(legacyToken).then((account) => ({ accessToken: legacyToken, user: account }))
      : api.refreshSession();
    void restore
      .then((restored) => applySession(restored.accessToken, restored.user))
      .catch(() => clearLegacyAccessTokenStorage(window.localStorage));
  }, [applySession]);

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const refreshed = (event as CustomEvent<{ accessToken: string; user: AuthUser }>).detail;
      if (refreshed?.accessToken && refreshed.user)
        applySession(refreshed.accessToken, refreshed.user);
    };
    const handleUnauthorized = () => {
      clearSession();
      unauthorizedRef.current();
    };
    window.addEventListener("campusgig:session-refreshed", handleRefresh);
    window.addEventListener("campusgig:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("campusgig:session-refreshed", handleRefresh);
      window.removeEventListener("campusgig:unauthorized", handleUnauthorized);
    };
  }, [applySession, clearSession]);

  return { token, user, setUser, applySession, clearSession };
}
