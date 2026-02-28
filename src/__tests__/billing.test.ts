import { calculateCostCents, formatBalanceForDisplay, LOW_BALANCE_THRESHOLD_CENTS } from '../billing/usage-tracker';
import { PLAN_LIMITS, checkLimit } from '../billing/plans';

describe('Usage Tracker', () => {
  describe('calculateCostCents', () => {
    test('zero tokens = zero cost', () => {
      expect(calculateCostCents({ inputTokens: 0, outputTokens: 0 })).toBe(0);
    });

    test('calculates cost for typical Haiku usage', () => {
      // 1000 input tokens at $0.80/MTok = $0.0008 = 0.08 cents
      // 500 output tokens at $4.00/MTok = $0.002 = 0.2 cents
      // Total = 0.28 cents → rounds up to 1 cent
      const cost = calculateCostCents({ inputTokens: 1000, outputTokens: 500 });
      expect(cost).toBe(1);
    });

    test('rounds up to nearest cent', () => {
      // Any fractional cent should round up
      const cost = calculateCostCents({ inputTokens: 1, outputTokens: 1 });
      expect(cost).toBe(1);
    });

    test('large token usage', () => {
      // 1M input = $0.80 = 80 cents
      // 1M output = $4.00 = 400 cents
      // Total = 480 cents
      const cost = calculateCostCents({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
      expect(cost).toBe(480);
    });

    test('output tokens are 5x more expensive than input', () => {
      const inputOnly = calculateCostCents({ inputTokens: 1_000_000, outputTokens: 0 });
      const outputOnly = calculateCostCents({ inputTokens: 0, outputTokens: 1_000_000 });
      expect(outputOnly).toBe(5 * inputOnly);
    });

    test('typical agent response cost (4k in, 1k out)', () => {
      const cost = calculateCostCents({ inputTokens: 4000, outputTokens: 1000 });
      // Input: 4000/1M * 0.80 = $0.0032 = 0.32 cents
      // Output: 1000/1M * 4.00 = $0.004 = 0.4 cents
      // Total = 0.72 cents → 1 cent
      expect(cost).toBe(1);
    });

    test('cost never returns negative', () => {
      // Even with zero or small values
      expect(calculateCostCents({ inputTokens: 0, outputTokens: 0 })).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatBalanceForDisplay', () => {
    test('formats whole dollars', () => {
      expect(formatBalanceForDisplay(100)).toBe('$1.00');
      expect(formatBalanceForDisplay(500)).toBe('$5.00');
      expect(formatBalanceForDisplay(2000)).toBe('$20.00');
    });

    test('formats cents', () => {
      expect(formatBalanceForDisplay(50)).toBe('$0.50');
      expect(formatBalanceForDisplay(1)).toBe('$0.01');
      expect(formatBalanceForDisplay(99)).toBe('$0.99');
    });

    test('formats zero', () => {
      expect(formatBalanceForDisplay(0)).toBe('$0.00');
    });

    test('formats negative (overdrawn)', () => {
      expect(formatBalanceForDisplay(-50)).toBe('$-0.50');
    });
  });

  test('LOW_BALANCE_THRESHOLD_CENTS is $0.50', () => {
    expect(LOW_BALANCE_THRESHOLD_CENTS).toBe(50);
  });
});

describe('Plan Limits', () => {
  test('free plan has limits', () => {
    expect(PLAN_LIMITS.free.meetingsPerMonth).toBe(10);
    expect(PLAN_LIMITS.free.messagesPerMonth).toBe(50);
  });

  test('pro plan is unlimited', () => {
    expect(PLAN_LIMITS.pro.meetingsPerMonth).toBe(-1);
    expect(PLAN_LIMITS.pro.messagesPerMonth).toBe(-1);
  });

  test('enterprise plan is unlimited', () => {
    expect(PLAN_LIMITS.enterprise.meetingsPerMonth).toBe(-1);
    expect(PLAN_LIMITS.enterprise.messagesPerMonth).toBe(-1);
  });

  describe('checkLimit', () => {
    test('allows message within limit', () => {
      const result = checkLimit(
        { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0, messagesSent: 5 },
        PLAN_LIMITS.free,
        'message'
      );
      expect(result.allowed).toBe(true);
    });

    test('blocks message at limit', () => {
      const result = checkLimit(
        { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0, messagesSent: 50 },
        PLAN_LIMITS.free,
        'message'
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('50 messages');
    });

    test('blocks meeting at limit', () => {
      const result = checkLimit(
        { meetingsCreated: 10, meetingsUpdated: 0, meetingsDeleted: 0, messagesSent: 0 },
        PLAN_LIMITS.free,
        'meeting'
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('10 meetings');
    });

    test('pro plan always allows', () => {
      const result = checkLimit(
        { meetingsCreated: 999, meetingsUpdated: 0, meetingsDeleted: 0, messagesSent: 9999 },
        PLAN_LIMITS.pro,
        'message'
      );
      expect(result.allowed).toBe(true);
    });

    test('meeting limit only counts meetingsCreated', () => {
      const result = checkLimit(
        { meetingsCreated: 5, meetingsUpdated: 100, meetingsDeleted: 100, messagesSent: 0 },
        PLAN_LIMITS.free,
        'meeting'
      );
      expect(result.allowed).toBe(true);
    });
  });
});
