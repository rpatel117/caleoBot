// Haiku 4.5 pricing (per million tokens)
const HAIKU_INPUT_COST_PER_MTOK = 0.80;   // $/MTok
const HAIKU_OUTPUT_COST_PER_MTOK = 4.00;  // $/MTok

export const LOW_BALANCE_THRESHOLD_CENTS = 50; // $0.50

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Calculate cost in cents for a given token usage.
 */
export function calculateCostCents(usage: TokenUsage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * HAIKU_INPUT_COST_PER_MTOK;
  const outputCost = (usage.outputTokens / 1_000_000) * HAIKU_OUTPUT_COST_PER_MTOK;
  const totalDollars = inputCost + outputCost;
  // Convert to cents, round up to nearest whole cent to match INTEGER column
  return Math.ceil(totalDollars * 100);
}

/**
 * Format a balance in cents for display: "$1.23"
 */
export function formatBalanceForDisplay(balanceCents: number): string {
  return `$${(balanceCents / 100).toFixed(2)}`;
}
