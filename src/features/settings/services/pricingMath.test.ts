import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_BUDGET_WARNING_RATIO,
  estimateCostFromTokens,
  estimateCostFromUsage,
  evaluateDailyBudget,
} from './pricingMath';

test('estimateCostFromUsage uses input and output prices separately', () => {
  const cost = estimateCostFromUsage(
    {
      promptTokens: 1_500_000,
      completionTokens: 500_000,
      totalTokens: 2_000_000,
    },
    'gpt-5.3-codex',
    {
      'gpt-5.3-codex': {
        inputPerMillion: 2,
        outputPerMillion: 8,
      },
      others: {
        inputPerMillion: 1,
        outputPerMillion: 1,
      },
    },
  );

  assert.equal(cost, 7);
});

test('estimateCostFromTokens falls back to blended pricing for aggregate token totals', () => {
  const cost = estimateCostFromTokens(
    [
      { model: 'gpt-5.3-codex', tokens: 2_000_000 },
      { model: 'unmatched-model', tokens: 1_000_000 },
    ],
    {
      'gpt-5.3-codex': {
        inputPerMillion: 2,
        outputPerMillion: 8,
      },
      others: {
        inputPerMillion: 1,
        outputPerMillion: 3,
      },
    },
  );

  assert.equal(cost, 12);
});

test('evaluateDailyBudget marks near limit and exceeded states correctly', () => {
  const near = evaluateDailyBudget(8, 10, DAILY_BUDGET_WARNING_RATIO);
  const exceeded = evaluateDailyBudget(12, 10, DAILY_BUDGET_WARNING_RATIO);

  assert.equal(near.state, 'near_limit');
  assert.equal(near.remaining, 2);
  assert.equal(exceeded.state, 'exceeded');
  assert.equal(exceeded.overBudgetAmount, 2);
});
