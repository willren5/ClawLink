import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import {
  DAILY_BUDGET_WARNING_RATIO,
  DEFAULT_PRICING,
  DEFAULT_PRICING_CURRENCY,
  SUPPORTED_PRICING_CURRENCIES,
  estimateCostFromTokens,
  evaluateDailyBudget,
  formatCurrencyAmount,
  normalizeDailyBudget,
  normalizePricingCurrency,
  pricingCurrencyLabel,
  sanitizePricingConfig,
  type ModelPricing,
  type PricingConfig,
  type PricingCurrency,
} from '../services/pricingMath';

interface PricingStoreState {
  currency: PricingCurrency;
  pricing: PricingConfig;
  dailyBudget: number | null;
  setCurrency: (currency: PricingCurrency) => void;
  setDailyBudget: (dailyBudget: number | null) => void;
  upsertModelPricing: (model: string, pricing: ModelPricing) => void;
  removeModelPricing: (model: string) => void;
}

export const usePricingStore = create<PricingStoreState>()(
  persist(
    (set, get) => ({
      currency: DEFAULT_PRICING_CURRENCY,
      pricing: DEFAULT_PRICING,
      dailyBudget: null,
      setCurrency: (currency) => {
        set({ currency: normalizePricingCurrency(currency) });
      },
      setDailyBudget: (dailyBudget) => {
        set({ dailyBudget: normalizeDailyBudget(dailyBudget) });
      },
      upsertModelPricing: (model, pricing) => {
        const normalized = model.trim();
        if (!normalized) {
          return;
        }

        set({
          pricing: sanitizePricingConfig({
            ...get().pricing,
            [normalized]: pricing,
          }),
        });
      },
      removeModelPricing: (model) => {
        const normalized = model.trim();
        if (!normalized || normalized.toLowerCase() === 'others') {
          return;
        }

        const next = { ...get().pricing };
        delete next[normalized];
        set({ pricing: sanitizePricingConfig(next) });
      },
    }),
    {
      name: STORAGE_KEYS.PRICING_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        currency: state.currency,
        pricing: state.pricing,
        dailyBudget: state.dailyBudget,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        usePricingStore.setState({
          currency: normalizePricingCurrency(state.currency),
          pricing: sanitizePricingConfig(state.pricing),
          dailyBudget: normalizeDailyBudget(state.dailyBudget),
        });
      },
    },
  ),
);

export type { ModelPricing, PricingConfig, PricingCurrency };
export {
  DAILY_BUDGET_WARNING_RATIO,
  DEFAULT_PRICING,
  DEFAULT_PRICING_CURRENCY,
  SUPPORTED_PRICING_CURRENCIES,
  estimateCostFromTokens,
  evaluateDailyBudget,
  formatCurrencyAmount,
  normalizePricingCurrency,
  pricingCurrencyLabel,
};
