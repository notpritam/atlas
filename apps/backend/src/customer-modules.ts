import type { Context } from 'hono';
import type { Auth, CustomerEnv } from './customer.ts';
import type { SavedVia } from '../../../packages/shared/src/collection-presentation.ts';
export type CustomerContext = Context<CustomerEnv>;
export type CustomerServices = {
  auth(c: CustomerContext, cookieOnly?: boolean, countRequest?: boolean): Auth;
  jsonBody(c: CustomerContext, max?: number): Promise<Record<string, unknown>>;
  usage(accountId: string): { captures: number; bytes: number; maxCaptures: number; maxBytes: number };
  savingClient(auth: Auth): SavedVia | null;
  globalMaxCaptures: number;
  globalMaxBytes: number;
  rate(key: string, limit: number, window: number): void;
};
export class CustomerModuleError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503, readonly code: string, message: string) { super(message); }
}
export function moduleFail(status: CustomerModuleError['status'], code: string, message: string): never {
  throw new CustomerModuleError(status, code, message);
}
