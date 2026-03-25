// Model pricing (per million tokens)
const HAIKU_INPUT_COST_PER_MTOK = 0.80;    // $/MTok
const HAIKU_OUTPUT_COST_PER_MTOK = 4.00;   // $/MTok
const SONNET_INPUT_COST_PER_MTOK = 3.00;   // $/MTok
const SONNET_OUTPUT_COST_PER_MTOK = 15.00; // $/MTok

export const LOW_BALANCE_THRESHOLD_CENTS = 50; // $0.50

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Calculate cost in cents with blended model pricing.
 * Sonnet is used for the initial routing call; Haiku for tool-loop iterations.
 * Cost = (Haiku tokens × Haiku rate) + (Sonnet tokens × Sonnet rate), then 2x margin.
 */
export function calculateCostCents(totalUsage: TokenUsage, sonnetUsage?: TokenUsage): number {
  // Haiku usage = total minus Sonnet's share
  const haikuInput = totalUsage.inputTokens - (sonnetUsage?.inputTokens || 0);
  const haikuOutput = totalUsage.outputTokens - (sonnetUsage?.outputTokens || 0);

  const haikuCost = (haikuInput / 1_000_000) * HAIKU_INPUT_COST_PER_MTOK
                  + (haikuOutput / 1_000_000) * HAIKU_OUTPUT_COST_PER_MTOK;

  const sonnetCost = sonnetUsage
    ? (sonnetUsage.inputTokens / 1_000_000) * SONNET_INPUT_COST_PER_MTOK
    + (sonnetUsage.outputTokens / 1_000_000) * SONNET_OUTPUT_COST_PER_MTOK
    : 0;

  const totalDollars = haikuCost + sonnetCost;
  // Convert to cents, round up to nearest whole cent to match INTEGER column
  return Math.ceil(totalDollars * 100);
}

/**
 * Format a balance in cents for display: "$1.23"
 */
export function formatBalanceForDisplay(balanceCents: number): string {
  return `$${(balanceCents / 100).toFixed(2)}`;
}
