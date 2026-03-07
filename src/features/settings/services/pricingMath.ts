export const SUPPORTED_PRICING_CURRENCIES = ['USD', 'CNY'] as const;

export type PricingCurrency = (typeof SUPPORTED_PRICING_CURRENCIES)[number];

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricingConfig = Record<string, ModelPricing>;

export interface UsageLike {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export type DailyBudgetState = 'disabled' | 'within_limit' | 'near_limit' | 'exceeded';

export const DEFAULT_PRICING_CURRENCY: PricingCurrency = 'USD';
export const DAILY_BUDGET_WARNING_RATIO = 0.8;

export const DEFAULT_PRICING: PricingConfig = {
  DeepSeek: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  Qwen: { inputPerMillion: 0.2, outputPerMillion: 0.8 },
  Kimi: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  others: { inputPerMillion: 0.25, outputPerMillion: 0.95 },
};

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}

function sanitizeNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function blendedPricePerMillion(pricing: ModelPricing): number {
  const input = sanitizeNonNegativeNumber(pricing.inputPerMillion);
  const output = sanitizeNonNegativeNumber(pricing.outputPerMillion);

  if (input > 0 && output > 0) {
    return (input + output) / 2;
  }

  return input > 0 ? input : output;
}

function resolveMaxFractionDigits(value: number): number {
  const absolute = Math.abs(value);
  if (absolute >= 1) {
    return 2;
  }
  if (absolute >= 0.1) {
    return 3;
  }
  return 4;
}

export function normalizePricingCurrency(value: string | null | undefined): PricingCurrency {
  return value?.trim().toUpperCase() === 'CNY' ? 'CNY' : DEFAULT_PRICING_CURRENCY;
}

export function sanitizeModelPricing(input: Partial<ModelPricing> | null | undefined): ModelPricing {
  return {
    inputPerMillion: sanitizeNonNegativeNumber(input?.inputPerMillion),
    outputPerMillion: sanitizeNonNegativeNumber(input?.outputPerMillion),
  };
}

export function sanitizePricingConfig(
  input: Record<string, Partial<ModelPricing> | undefined> | null | undefined,
): PricingConfig {
  const next: PricingConfig = {};

  for (const [rawModel, rawPricing] of Object.entries(input ?? {})) {
    const model = rawModel.trim();
    if (!model) {
      continue;
    }
    next[model] = sanitizeModelPricing(rawPricing);
  }

  if (!Object.keys(next).some((key) => key.toLowerCase() === 'others')) {
    next.others = DEFAULT_PRICING.others;
  }

  return Object.keys(next).length > 0 ? next : DEFAULT_PRICING;
}

export function resolveModelPricing(model: string | undefined, pricing: PricingConfig): ModelPricing {
  const fallback = pricing.others ?? DEFAULT_PRICING.others;
  const normalized = model?.trim();

  if (!normalized) {
    return fallback;
  }

  const exact =
    pricing[normalized] ??
    pricing[normalized.toLowerCase()] ??
    pricing[normalized.toUpperCase()];

  if (exact) {
    return exact;
  }

  const matchedKey = Object.keys(pricing)
    .filter((key) => key.toLowerCase() !== 'others')
    .sort((left, right) => right.length - left.length)
    .find((key) => normalized.toLowerCase().includes(key.toLowerCase()));

  if (matchedKey) {
    return pricing[matchedKey];
  }

  return fallback;
}

export function estimateCostFromTotalTokens(
  totalTokens: number,
  model: string | undefined,
  pricing: PricingConfig,
): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return 0;
  }

  const resolvedPricing = resolveModelPricing(model, pricing);
  const cost = (Math.max(0, totalTokens) / 1_000_000) * blendedPricePerMillion(resolvedPricing);
  return roundMoney(cost);
}

export function estimateCostFromUsage(
  usage: UsageLike | null | undefined,
  model: string | undefined,
  pricing: PricingConfig,
): number {
  const promptTokens = Math.max(0, Math.floor(Number(usage?.promptTokens ?? 0) || 0));
  const completionTokens = Math.max(0, Math.floor(Number(usage?.completionTokens ?? 0) || 0));
  const totalTokens = Math.max(0, Math.floor(Number(usage?.totalTokens ?? 0) || 0));

  if (promptTokens === 0 && completionTokens === 0) {
    return estimateCostFromTotalTokens(totalTokens, model, pricing);
  }

  const resolvedPricing = resolveModelPricing(model, pricing);
  const inputCost = (promptTokens / 1_000_000) * sanitizeNonNegativeNumber(resolvedPricing.inputPerMillion);
  const outputCost = (completionTokens / 1_000_000) * sanitizeNonNegativeNumber(resolvedPricing.outputPerMillion);
  return roundMoney(inputCost + outputCost);
}

export function estimateCostFromTokens(
  usageByModel: Array<{ model: string; tokens: number }>,
  pricing: PricingConfig,
): number {
  const total = usageByModel.reduce(
    (sum, item) => sum + estimateCostFromTotalTokens(item.tokens, item.model, pricing),
    0,
  );

  return roundMoney(total);
}

export function normalizeDailyBudget(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}

export function evaluateDailyBudget(
  spendToday: number,
  dailyBudget: number | null | undefined,
  warningRatio = DAILY_BUDGET_WARNING_RATIO,
): {
  state: DailyBudgetState;
  spendToday: number;
  dailyBudget: number | null;
  progress: number;
  progressClamped: number;
  remaining: number | null;
  overBudgetAmount: number;
  warningRatio: number;
} {
  const spend = Math.max(0, Number(Number.isFinite(spendToday) ? spendToday : 0));
  const normalizedBudget = normalizeDailyBudget(dailyBudget);
  const normalizedWarningRatio =
    Number.isFinite(warningRatio) && warningRatio > 0 && warningRatio < 1 ? warningRatio : DAILY_BUDGET_WARNING_RATIO;

  if (normalizedBudget === null) {
    return {
      state: 'disabled',
      spendToday: roundMoney(spend),
      dailyBudget: null,
      progress: 0,
      progressClamped: 0,
      remaining: null,
      overBudgetAmount: 0,
      warningRatio: normalizedWarningRatio,
    };
  }

  const progress = spend / normalizedBudget;
  const overBudgetAmount = Math.max(0, spend - normalizedBudget);
  const remaining = Math.max(0, normalizedBudget - spend);

  return {
    state:
      spend >= normalizedBudget
        ? 'exceeded'
        : progress >= normalizedWarningRatio
          ? 'near_limit'
          : 'within_limit',
    spendToday: roundMoney(spend),
    dailyBudget: normalizedBudget,
    progress,
    progressClamped: Math.max(0, Math.min(1, progress)),
    remaining: roundMoney(remaining),
    overBudgetAmount: roundMoney(overBudgetAmount),
    warningRatio: normalizedWarningRatio,
  };
}

export function formatCurrencyAmount(
  value: number,
  currency: PricingCurrency,
  language: 'zh' | 'en',
): string {
  const amount = Number.isFinite(value) ? value : 0;
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const maximumFractionDigits = resolveMaxFractionDigits(amount);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(amount);
  } catch {
    const symbol = currency === 'CNY' ? 'CNY' : 'USD';
    return `${symbol} ${amount.toFixed(maximumFractionDigits)}`;
  }
}

export function pricingCurrencyLabel(currency: PricingCurrency, language: 'zh' | 'en'): string {
  if (currency === 'CNY') {
    return language === 'zh' ? '人民币 (CNY)' : 'Chinese Yuan (CNY)';
  }

  return language === 'zh' ? '美元 (USD)' : 'US Dollar (USD)';
}
