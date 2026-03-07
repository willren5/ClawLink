import { translate } from '../../../lib/i18n';
import { getString, setString } from '../../../lib/mmkv/storage';
import {
  DAILY_BUDGET_WARNING_RATIO,
  evaluateDailyBudget,
  formatCurrencyAmount,
  usePricingStore,
} from '../../settings/store/pricingStore';
import { getCurrentNotificationLanguage } from './notificationActions';

const STORAGE_KEY_BUDGET_NEAR_LIMIT_DAY = 'alerts:budget-near-limit-day';
const STORAGE_KEY_BUDGET_EXCEEDED_DAY = 'alerts:budget-exceeded-day';

export interface DailyBudgetAlert {
  type: 'budget_near_limit' | 'budget_exceeded';
  severity: 'warning' | 'critical';
  title: string;
  body: string;
  dayKey: string;
  dedupeMs: number;
  storageKey: string;
}

export function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function msUntilNextLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  const next = new Date(date);
  next.setHours(24, 0, 0, 0);
  return Math.max(60_000, next.getTime() - timestamp);
}

export function buildDailyBudgetAlert(costToday: number | null, now = Date.now()): DailyBudgetAlert | null {
  const dailyBudget = usePricingStore.getState().dailyBudget;
  if (dailyBudget === null || costToday === null) {
    return null;
  }

  const currency = usePricingStore.getState().currency;
  const budgetStatus = evaluateDailyBudget(costToday, dailyBudget, DAILY_BUDGET_WARNING_RATIO);
  if (budgetStatus.state !== 'near_limit' && budgetStatus.state !== 'exceeded') {
    return null;
  }

  const language = getCurrentNotificationLanguage();
  const spendLabel = formatCurrencyAmount(budgetStatus.spendToday, currency, language);
  const budgetLabel = formatCurrencyAmount(budgetStatus.dailyBudget ?? 0, currency, language);
  const dayKey = toLocalDateKey(now);

  if (budgetStatus.state === 'exceeded') {
    return {
      type: 'budget_exceeded',
      severity: 'critical',
      title: translate(language, 'notifications_alert_budget_exceeded_title'),
      body:
        language === 'zh'
          ? `今日费用 ${spendLabel}，已超过日限额 ${budgetLabel}。`
          : `Today's spend is ${spendLabel}, above the daily limit of ${budgetLabel}.`,
      dayKey,
      dedupeMs: msUntilNextLocalDay(now),
      storageKey: STORAGE_KEY_BUDGET_EXCEEDED_DAY,
    };
  }

  return {
    type: 'budget_near_limit',
    severity: 'warning',
    title: translate(language, 'notifications_alert_budget_near_limit_title'),
    body:
      language === 'zh'
        ? `今日费用已到 ${spendLabel} / ${budgetLabel}，接近日限额。`
        : `Today's spend reached ${spendLabel} / ${budgetLabel} and is close to the daily limit.`,
    dayKey,
    dedupeMs: msUntilNextLocalDay(now),
    storageKey: STORAGE_KEY_BUDGET_NEAR_LIMIT_DAY,
  };
}

export function hasPublishedDailyBudgetAlert(alert: DailyBudgetAlert): boolean {
  return getString(alert.storageKey) === alert.dayKey;
}

export function markDailyBudgetAlertPublished(alert: DailyBudgetAlert): void {
  setString(alert.storageKey, alert.dayKey);
}
