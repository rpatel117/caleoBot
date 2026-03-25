describe('Checkout Signer', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  function load() {
    return require('../billing/checkout-signer') as {
      signCheckoutParams: typeof import('../billing/checkout-signer').signCheckoutParams;
      verifyCheckoutParams: typeof import('../billing/checkout-signer').verifyCheckoutParams;
      signAutoRefillParams: typeof import('../billing/checkout-signer').signAutoRefillParams;
      verifyAutoRefillParams: typeof import('../billing/checkout-signer').verifyAutoRefillParams;
      signPortalParams: typeof import('../billing/checkout-signer').signPortalParams;
      verifyPortalParams: typeof import('../billing/checkout-signer').verifyPortalParams;
    };
  }

  test('sign and verify roundtrip', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', ts, sig)).toBe(true);
  });

  test('rejects wrong amount', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(verifyCheckoutParams(1000, 'U123', 'db-uuid-1', ts, sig)).toBe(false);
  });

  test('rejects wrong userId', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(verifyCheckoutParams(500, 'UATTACKER', 'db-uuid-1', ts, sig)).toBe(false);
  });

  test('rejects wrong dbUserId', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(verifyCheckoutParams(500, 'U123', 'attacker-db-uuid', ts, sig)).toBe(false);
  });

  test('rejects tampered signature', () => {
    const { verifyCheckoutParams } = load();
    const fakeSig = 'a'.repeat(64);
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', Date.now(), fakeSig)).toBe(false);
  });

  test('signature is hex string', () => {
    const { signCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', Date.now());
    expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
    expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  test('all allowed amounts produce valid signatures', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now();
    for (const amount of [500, 1000, 2000]) {
      const sig = signCheckoutParams(amount, 'U123', 'db-uuid-1', ts);
      expect(verifyCheckoutParams(amount, 'U123', 'db-uuid-1', ts, sig)).toBe(true);
    }
  });

  test('different keys produce different signatures', () => {
    const { signCheckoutParams } = load();
    const ts = Date.now();
    const sig1 = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);

    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    jest.resetModules();
    const mod2 = load();
    const sig2 = mod2.signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(sig1).not.toBe(sig2);
  });

  test('throws when ENCRYPTION_KEY is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    jest.resetModules();
    const { signCheckoutParams } = load();
    expect(() => signCheckoutParams(500, 'U123', 'db-uuid-1', Date.now())).toThrow('ENCRYPTION_KEY must be set');
  });

  // Edge: signature length mismatch causes false (not crash)
  test('rejects short signature gracefully', () => {
    const { verifyCheckoutParams } = load();
    // Length mismatch is caught before timingSafeEqual — returns false, not throw
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', Date.now(), 'tooshort')).toBe(false);
  });

  // --- Expiration tests ---

  test('rejects expired checkout URL', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const oldTs = Date.now() - 16 * 60 * 1000; // 16 minutes ago
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', oldTs);
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', oldTs, sig)).toBe(false);
  });

  test('accepts checkout URL within expiry window', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const ts = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1', ts);
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', ts, sig)).toBe(true);
  });

  // --- AutoRefill tests ---

  test('autorefill sign and verify roundtrip', () => {
    const { signAutoRefillParams, verifyAutoRefillParams } = load();
    const ts = Date.now();
    const sig = signAutoRefillParams(1000, 'U123', 'db-uuid-1', ts);
    expect(verifyAutoRefillParams(1000, 'U123', 'db-uuid-1', ts, sig)).toBe(true);
  });

  test('rejects expired autorefill URL', () => {
    const { signAutoRefillParams, verifyAutoRefillParams } = load();
    const oldTs = Date.now() - 16 * 60 * 1000;
    const sig = signAutoRefillParams(1000, 'U123', 'db-uuid-1', oldTs);
    expect(verifyAutoRefillParams(1000, 'U123', 'db-uuid-1', oldTs, sig)).toBe(false);
  });

  test('accepts autorefill URL within expiry window', () => {
    const { signAutoRefillParams, verifyAutoRefillParams } = load();
    const ts = Date.now() - 10 * 60 * 1000;
    const sig = signAutoRefillParams(1000, 'U123', 'db-uuid-1', ts);
    expect(verifyAutoRefillParams(1000, 'U123', 'db-uuid-1', ts, sig)).toBe(true);
  });

  test('rejects wrong autorefill amount', () => {
    const { signAutoRefillParams, verifyAutoRefillParams } = load();
    const ts = Date.now();
    const sig = signAutoRefillParams(1000, 'U123', 'db-uuid-1', ts);
    expect(verifyAutoRefillParams(2000, 'U123', 'db-uuid-1', ts, sig)).toBe(false);
  });

  // --- Portal tests ---

  test('portal sign and verify roundtrip', () => {
    const { signPortalParams, verifyPortalParams } = load();
    const ts = Date.now();
    const sig = signPortalParams('db-uuid-1', ts);
    expect(verifyPortalParams('db-uuid-1', ts, sig)).toBe(true);
  });

  test('rejects expired portal URL', () => {
    const { signPortalParams, verifyPortalParams } = load();
    const oldTs = Date.now() - 16 * 60 * 1000;
    const sig = signPortalParams('db-uuid-1', oldTs);
    expect(verifyPortalParams('db-uuid-1', oldTs, sig)).toBe(false);
  });

  test('accepts portal URL within expiry window', () => {
    const { signPortalParams, verifyPortalParams } = load();
    const ts = Date.now() - 10 * 60 * 1000;
    const sig = signPortalParams('db-uuid-1', ts);
    expect(verifyPortalParams('db-uuid-1', ts, sig)).toBe(true);
  });

  test('rejects wrong portal dbUserId', () => {
    const { signPortalParams, verifyPortalParams } = load();
    const ts = Date.now();
    const sig = signPortalParams('db-uuid-1', ts);
    expect(verifyPortalParams('db-attacker', ts, sig)).toBe(false);
  });
});
