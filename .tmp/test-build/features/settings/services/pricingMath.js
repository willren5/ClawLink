"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRICING = exports.DAILY_BUDGET_WARNING_RATIO = exports.DEFAULT_PRICING_CURRENCY = exports.SUPPORTED_PRICING_CURRENCIES = void 0;
exports.normalizePricingCurrency = normalizePricingCurrency;
exports.sanitizeModelPricing = sanitizeModelPricing;
exports.sanitizePricingConfig = sanitizePricingConfig;
exports.resolveModelPricing = resolveModelPricing;
exports.estimateCostFromTotalTokens = estimateCostFromTotalTokens;
exports.estimateCostFromUsage = estimateCostFromUsage;
exports.estimateCostFromTokens = estimateCostFromTokens;
exports.normalizeDailyBudget = normalizeDailyBudget;
exports.evaluateDailyBudget = evaluateDailyBudget;
exports.formatCurrencyAmount = formatCurrencyAmount;
exports.pricingCurrencyLabel = pricingCurrencyLabel;
exports.SUPPORTED_PRICING_CURRENCIES = ['USD', 'CNY'];
exports.DEFAULT_PRICING_CURRENCY = 'USD';
exports.DAILY_BUDGET_WARNING_RATIO = 0.8;
exports.DEFAULT_PRICING = {
    DeepSeek: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
    Qwen: { inputPerMillion: 0.2, outputPerMillion: 0.8 },
    Kimi: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    others: { inputPerMillion: 0.25, outputPerMillion: 0.95 },
};
function roundMoney(value) {
    return Number(value.toFixed(4));
}
function sanitizeNonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
function blendedPricePerMillion(pricing) {
    const input = sanitizeNonNegativeNumber(pricing.inputPerMillion);
    const output = sanitizeNonNegativeNumber(pricing.outputPerMillion);
    if (input > 0 && output > 0) {
        return (input + output) / 2;
    }
    return input > 0 ? input : output;
}
function resolveMaxFractionDigits(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1) {
        return 2;
    }
    if (absolute >= 0.1) {
        return 3;
    }
    return 4;
}
function normalizePricingCurrency(value) {
    return value?.trim().toUpperCase() === 'CNY' ? 'CNY' : exports.DEFAULT_PRICING_CURRENCY;
}
function sanitizeModelPricing(input) {
    return {
        inputPerMillion: sanitizeNonNegativeNumber(input?.inputPerMillion),
        outputPerMillion: sanitizeNonNegativeNumber(input?.outputPerMillion),
    };
}
function sanitizePricingConfig(input) {
    const next = {};
    for (const [rawModel, rawPricing] of Object.entries(input ?? {})) {
        const model = rawModel.trim();
        if (!model) {
            continue;
        }
        next[model] = sanitizeModelPricing(rawPricing);
    }
    if (!Object.keys(next).some((key) => key.toLowerCase() === 'others')) {
        next.others = exports.DEFAULT_PRICING.others;
    }
    return Object.keys(next).length > 0 ? next : exports.DEFAULT_PRICING;
}
function resolveModelPricing(model, pricing) {
    const fallback = pricing.others ?? exports.DEFAULT_PRICING.others;
    const normalized = model?.trim();
    if (!normalized) {
        return fallback;
    }
    const exact = pricing[normalized] ??
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
function estimateCostFromTotalTokens(totalTokens, model, pricing) {
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
        return 0;
    }
    const resolvedPricing = resolveModelPricing(model, pricing);
    const cost = (Math.max(0, totalTokens) / 1_000_000) * blendedPricePerMillion(resolvedPricing);
    return roundMoney(cost);
}
function estimateCostFromUsage(usage, model, pricing) {
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
function estimateCostFromTokens(usageByModel, pricing) {
    const total = usageByModel.reduce((sum, item) => sum + estimateCostFromTotalTokens(item.tokens, item.model, pricing), 0);
    return roundMoney(total);
}
function normalizeDailyBudget(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}
function evaluateDailyBudget(spendToday, dailyBudget, warningRatio = exports.DAILY_BUDGET_WARNING_RATIO) {
    const spend = Math.max(0, Number(Number.isFinite(spendToday) ? spendToday : 0));
    const normalizedBudget = normalizeDailyBudget(dailyBudget);
    const normalizedWarningRatio = Number.isFinite(warningRatio) && warningRatio > 0 && warningRatio < 1 ? warningRatio : exports.DAILY_BUDGET_WARNING_RATIO;
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
        state: spend >= normalizedBudget
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
function formatCurrencyAmount(value, currency, language) {
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
    }
    catch {
        const symbol = currency === 'CNY' ? 'CNY' : 'USD';
        return `${symbol} ${amount.toFixed(maximumFractionDigits)}`;
    }
}
function pricingCurrencyLabel(currency, language) {
    if (currency === 'CNY') {
        return language === 'zh' ? '人民币 (CNY)' : 'Chinese Yuan (CNY)';
    }
    return language === 'zh' ? '美元 (USD)' : 'US Dollar (USD)';
}
