'use client';
import { createContext, useContext } from 'react';
import type { ApiOptions } from '../../lib/api';
import type { ExtensionStatus, PreferenceEnvelope } from '../../lib/dashboard';
import type { Me } from '../../lib/types';
export interface DashboardContextValue {
  me: Me;
  request: <T>(path: string, options?: ApiOptions) => Promise<T>;
  confirm: (title: string, description: string, label?: string) => Promise<boolean>;
  toast: (message: string) => void;
  refresh: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  detectExtension: () => Promise<ExtensionStatus | null>;
  extension: ExtensionStatus | null;
  extensionConnecting: boolean;
  extensionError: string;
  preferences?: PreferenceEnvelope;
  closePanel: () => void;
  endSession: (code?: string) => void;
}
export const DashboardContext = createContext<DashboardContextValue | null>(null);
export function useDashboard() { const value = useContext(DashboardContext); if (!value) throw new Error('Dashboard context is unavailable'); return value; }
