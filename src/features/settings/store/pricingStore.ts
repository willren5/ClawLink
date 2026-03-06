import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

const PRICING_STORE_KEY = 'pricing-store';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricingConfig = Record<string, ModelPricing>;

interface PricingStoreState {
  pricing: PricingConfig;
  upsertModelPricing: (model: string, pricing: ModelPricing) => void;
  removeModelPricing: (model: string) => void;
}

const DEFAULT_PRICING: PricingConfig = {
  DeepSeek: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  Qwen: { inputPerMillion: 0.2, outputPerMillion: 0.8 },
  Kimi: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  others: { inputPerMillion: 0.25, outputPerMillion: 0.95 },
};

export const usePricingStore = create<PricingStoreState>()(
  persist(
    (set, get) => ({
      pricing: DEFAULT_PRICING,
      upsertModelPricing: (model, pricing) => {
        const normalized = model.trim();
        if (!normalized) {
          return;
        }

        set({
          pricing: {
            ...get().pricing,
            [normalized]: pricing,
          },
        });
      },
      removeModelPricing: (model) => {
        const normalized = model.trim();
        if (!normalized) {
          return;
        }

        const next = { ...get().pricing };
        delete next[normalized];
        set({ pricing: next });
      },
    }),
    {
      name: PRICING_STORE_KEY,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({ pricing: state.pricing }),
    },
  ),
);

export function estimateCostFromTokens(
  usageByModel: Array<{ model: string; tokens: number }>,
  pricing: PricingConfig,
): number {
  const total = usageByModel.reduce((sum, item) => {
    const direct = pricing[item.model] ?? pricing[item.model.toLowerCase()] ?? pricing.others;
    if (!direct) {
      return sum;
    }

    const unit = direct.inputPerMillion / 1_000_000;
    return sum + item.tokens * unit;
  }, 0);

  return Number(total.toFixed(4));
}
