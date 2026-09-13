import variants from '../variants.json' with { type: 'json' };
export type MobileEnvironment = typeof variants.prod;
let environment: MobileEnvironment = variants.prod;
let platform: 'ios' | 'android' = 'ios';
export function resolveEnvironment(value: unknown): MobileEnvironment {
  if (value === undefined || value === 'prod') return variants.prod;
  if (value === 'dev') return variants.dev;
  throw new Error('Unknown Foundkeep environment');
}
/** Only the embedded Expo manifest selects a variant, never a URL or server response. */
export function configureEnvironment(extra: unknown, os: string) {
  const value = extra as Partial<MobileEnvironment> | undefined;
  const selected = resolveEnvironment(value?.environment);
  if (value && Object.keys(selected).some(key => value[key as keyof MobileEnvironment] !== selected[key as keyof MobileEnvironment])) throw new Error('Invalid Foundkeep runtime configuration');
  environment = selected;
  platform = os === 'android' ? 'android' : 'ios';
}
export const getEnvironment = () => environment;
export const getMobilePlatform = () => platform;
