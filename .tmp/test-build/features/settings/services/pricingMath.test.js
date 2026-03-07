"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const pricingMath_1 = require("./pricingMath");
(0, node_test_1.default)('estimateCostFromUsage uses input and output prices separately', () => {
    const cost = (0, pricingMath_1.estimateCostFromUsage)({
        promptTokens: 1_500_000,
        completionTokens: 500_000,
        totalTokens: 2_000_000,
    }, 'gpt-5.3-codex', {
        'gpt-5.3-codex': {
            inputPerMillion: 2,
            outputPerMillion: 8,
        },
        others: {
            inputPerMillion: 1,
            outputPerMillion: 1,
        },
    });
    strict_1.default.equal(cost, 7);
});
(0, node_test_1.default)('estimateCostFromTokens falls back to blended pricing for aggregate token totals', () => {
    const cost = (0, pricingMath_1.estimateCostFromTokens)([
        { model: 'gpt-5.3-codex', tokens: 2_000_000 },
        { model: 'unmatched-model', tokens: 1_000_000 },
    ], {
        'gpt-5.3-codex': {
            inputPerMillion: 2,
            outputPerMillion: 8,
        },
        others: {
            inputPerMillion: 1,
            outputPerMillion: 3,
        },
    });
    strict_1.default.equal(cost, 12);
});
(0, node_test_1.default)('evaluateDailyBudget marks near limit and exceeded states correctly', () => {
    const near = (0, pricingMath_1.evaluateDailyBudget)(8, 10, pricingMath_1.DAILY_BUDGET_WARNING_RATIO);
    const exceeded = (0, pricingMath_1.evaluateDailyBudget)(12, 10, pricingMath_1.DAILY_BUDGET_WARNING_RATIO);
    strict_1.default.equal(near.state, 'near_limit');
    strict_1.default.equal(near.remaining, 2);
    strict_1.default.equal(exceeded.state, 'exceeded');
    strict_1.default.equal(exceeded.overBudgetAmount, 2);
});
