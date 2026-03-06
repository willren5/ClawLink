import { usePricingStore } from '../../settings/store/pricingStore';

const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / CHARS_PER_TOKEN_ESTIMATE));
}

function resolveInputPricePerMillion(model: string | undefined): number {
  const pricing = usePricingStore.getState().pricing;
  if (!model) {
    return pricing.others?.inputPerMillion ?? 0;
  }

  const normalized = model.trim();
  if (!normalized) {
    return pricing.others?.inputPerMillion ?? 0;
  }

  const exact =
    pricing[normalized] ??
    pricing[normalized.toLowerCase()] ??
    pricing[normalized.toUpperCase()];

  if (exact) {
    return exact.inputPerMillion;
  }

  const matchedKey = Object.keys(pricing).find((key) => normalized.toLowerCase().includes(key.toLowerCase()));
  if (matchedKey) {
    return pricing[matchedKey].inputPerMillion;
  }

  return pricing.others?.inputPerMillion ?? 0;
}

export function estimateSessionCost(totalTokens: number, model: string | undefined): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return 0;
  }
  const pricePerMillion = resolveInputPricePerMillion(model);
  const cost = (totalTokens / 1_000_000) * pricePerMillion;
  return Number(cost.toFixed(4));
}
