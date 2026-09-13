import type { AutomationState } from './types.ts';
export function normalizeAutomation(value: AutomationState): AutomationState {
  const included = Number.isSafeInteger(value.usage?.limit) ? Math.max(0, value.usage.limit) : 0;
  const monthlyLimit = Number.isSafeInteger(value.monthlyLimit) && value.monthlyLimit >= 0 && value.monthlyLimit <= 500 ? value.monthlyLimit : included;
  return { ...value,
    mode: ['instant','scheduled','manual','paused'].includes(value.mode) ? value.mode : 'instant',
    intervalHours: [1,6,24].includes(value.intervalHours) ? value.intervalHours : 24,
    monthlyLimit,
    nextRunAt: typeof value.nextRunAt === 'number' && Number.isFinite(value.nextRunAt) && value.nextRunAt > 0 ? value.nextRunAt : null,
    usage: { ...value.usage, monthlyLimit: Number.isSafeInteger(value.usage?.monthlyLimit) ? value.usage.monthlyLimit : monthlyLimit },
  };
}
