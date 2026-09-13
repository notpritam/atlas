export type AppearancePreference = 'system' | 'light' | 'dark';
export function normalizeAppearance(value: unknown): AppearancePreference { return value === 'light' || value === 'dark' ? value : 'system'; }
export function resolvedAppearance(preference: AppearancePreference, system: string | null | undefined): 'light' | 'dark' { return preference === 'system' ? system === 'dark' ? 'dark' : 'light' : preference; }
export const appearanceStorageKey = (environment: string) => `foundkeep.${environment}.appearance`;
