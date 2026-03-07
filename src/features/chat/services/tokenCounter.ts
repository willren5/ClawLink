import { usePricingStore } from '../../settings/store/pricingStore';
import { estimateCostFromTotalTokens, estimateCostFromUsage } from '../../settings/services/pricingMath';
import type { ChatMessageUsage } from '../types';

const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / CHARS_PER_TOKEN_ESTIMATE));
}

export function estimateSessionCost(totalTokens: number, model: string | undefined): number {
  return estimateCostFromTotalTokens(totalTokens, model, usePricingStore.getState().pricing);
}

export function estimateSessionCostFromUsage(usage: ChatMessageUsage | null | undefined, model: string | undefined): number {
  return estimateCostFromUsage(usage, model, usePricingStore.getState().pricing);
}
