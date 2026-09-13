import palettes from '../palettes.json' with { type: 'json' };

export type AppearancePreference = 'system' | 'light' | 'dark';
export function normalizeAppearance(value: unknown): AppearancePreference { return value === 'light' || value === 'dark' ? value : 'system'; }
export function resolvedAppearance(preference: AppearancePreference, system: string | null | undefined): 'light' | 'dark' { return preference === 'system' ? system === 'dark' ? 'dark' : 'light' : preference; }
/** Native color resources are resolved when text and icon nodes mount. */
export const nativeThemeRevision = (scheme: 'light' | 'dark', fontScale = 1) => `${scheme}:${fontScale}`;
export function resolvedThemeColor<T>(value: T, scheme: 'light' | 'dark'): T | string {
  if (!value || typeof value !== 'object') return value;
  const paths = (value as { resource_paths?: unknown }).resource_paths;
  if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string') return value;
  const match = /^@color\/foundkeep_([a-z]+)$/.exec(paths[0]);
  if (!match) return value;
  const key = Object.keys(palettes[scheme]).find(candidate => candidate.toLowerCase() === match[1]);
  return key ? palettes[scheme][key as keyof typeof palettes.light] : value;
}
export const appearanceStorageKey = (environment: string) => `foundkeep.${environment}.appearance`;
