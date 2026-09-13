import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import FoundkeepShared from '../../modules/foundkeep-shared/src';
import { createFoundkeepClient, FoundkeepApiError } from '../api/client.ts';
import type { Account, NativeSession, Usage } from '../api/types.ts';
import { DEFAULT_MOBILE_POLICY, fetchMobilePolicy, normalizeMobilePolicy, requiresBinaryUpdate, type MobilePolicy } from '../policy/mobilePolicy.ts';
import { safeReturnPath } from '../linking/deepLinks.ts';
import { syncNotificationRegistration } from '../notifications/notifications.ts';
import { pendingOAuth } from '../auth-oauth.ts';

type Credentials = { email: string; password: string };
type SessionValue = {
  ready: boolean; account: Account | null; usage: Usage | null; token: string | null; recoveryCode: string | null;
  policy: MobilePolicy; updateRequired: boolean;
  pendingRoute: string | null;
  setPendingRoute(value: string | null): void;
  consumePendingRoute(): string | null;
  client: ReturnType<typeof createFoundkeepClient>;
  register(value: Credentials & { name: string }): Promise<void>;
  login(value: Credentials): Promise<void>;
  recover(value: Credentials & { recoveryCode: string }): Promise<void>;
  acceptOAuthSession(value: NativeSession): Promise<void>;
  acknowledgeRecovery(): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(proof: string | { reauthToken: string }): Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [policy, setPolicy] = useState<MobilePolicy>(DEFAULT_MOBILE_POLICY);
  const [pendingRoute, setPendingRouteState] = useState<string | null>(null);
  const getToken = useCallback(async () => token ?? FoundkeepShared.getToken(), [token]);
  const client = useMemo(() => createFoundkeepClient({ getToken }), [getToken]);

  const accept = useCallback(async (session: NativeSession) => {
    pendingOAuth.clear();
    await FoundkeepShared.setSession(session.token, JSON.stringify(session.account));
    setToken(session.token); setAccount(session.account); setRecoveryCode(session.recoveryCode || null);
    void FoundkeepShared.retryPending();
  }, []);
  const refresh = useCallback(async () => {
    const credential = await getToken();
    try {
      const me = await client.me();
      if (!credential || await FoundkeepShared.getToken() !== credential) return;
      await FoundkeepShared.refreshSession(credential, JSON.stringify(me.account));
      if (await FoundkeepShared.getToken() !== credential) return;
      setAccount(me.account); setUsage(me.usage);
    }
    catch (error) {
      if (error instanceof FoundkeepApiError && error.status === 401 && await FoundkeepShared.getToken() === credential) {
        await FoundkeepShared.clearSession(); setToken(null); setAccount(null); setUsage(null);
      } else throw error;
    }
  }, [client, getToken]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await FoundkeepShared.getToken();
      if (!live) return;
      setToken(stored);
      if (stored) { try { await refresh(); } catch {} }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [refresh]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const cachedRaw = await FoundkeepShared.getPolicy();
      let cached: MobilePolicy | null = null;
      try { cached = cachedRaw ? normalizeMobilePolicy(JSON.parse(cachedRaw)) : null; } catch {}
      if (cached && live) setPolicy(cached);
      const remote = await fetchMobilePolicy();
      if (remote && (!cached || remote.revision >= cached.revision)) {
        await FoundkeepShared.setPolicy(JSON.stringify(remote));
        if (live) setPolicy(remote);
      }
    })().catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
    if (state === 'active' && token) {
      void FoundkeepShared.retryPending().then(() => { client.invalidate(); return refresh(); }).catch(() => {});
    }
    });
    return () => subscription.remove();
  }, [client, refresh, token]);
  useEffect(() => {
    if (token) void syncNotificationRegistration(client, policy.features.notifications).catch(() => {});
  }, [client, policy.features.notifications, token]);

  const deviceName = Device.deviceName || Device.modelName || (Platform.OS === 'android' ? 'Android' : 'iPhone');
  const value = useMemo<SessionValue>(() => ({
    ready, account, usage, token, recoveryCode, policy, pendingRoute, updateRequired: requiresBinaryUpdate('1.0.0', policy.minimumVersion), client,
    setPendingRoute: value => setPendingRouteState(safeReturnPath(value)),
    consumePendingRoute: () => {
      const value = pendingRoute;
      setPendingRouteState(null);
      return safeReturnPath(value);
    },
    register: async input => accept(await client.register({ ...input, deviceName })),
    login: async input => accept(await client.login({ ...input, deviceName })),
    recover: async input => accept(await client.recover({ ...input, deviceName })),
    acceptOAuthSession: accept,
    acknowledgeRecovery: () => setRecoveryCode(null), refresh,
    logout: async () => {
      pendingOAuth.clear();
      try { if (token) await client.logout(); } finally {
        await FoundkeepShared.clearSession(); setToken(null); setAccount(null); setUsage(null); setRecoveryCode(null); setPendingRouteState(null);
      }
    },
    deleteAccount: async password => {
      await client.deleteAccount(password);
      pendingOAuth.clear();
      await FoundkeepShared.clearSession(); setToken(null); setAccount(null); setUsage(null); setRecoveryCode(null); setPendingRouteState(null);
    },
  }), [ready, account, usage, token, recoveryCode, policy, pendingRoute, client, deviceName, accept, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}
