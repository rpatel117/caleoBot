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
    };
  }

  test('sign and verify roundtrip', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', sig)).toBe(true);
  });

  test('rejects wrong amount', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(verifyCheckoutParams(1000, 'U123', 'db-uuid-1', sig)).toBe(false);
  });

  test('rejects wrong userId', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(verifyCheckoutParams(500, 'UATTACKER', 'db-uuid-1', sig)).toBe(false);
  });

  test('rejects wrong dbUserId', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(verifyCheckoutParams(500, 'U123', 'attacker-db-uuid', sig)).toBe(false);
  });

  test('rejects tampered signature', () => {
    const { verifyCheckoutParams } = load();
    const fakeSig = 'a'.repeat(64);
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', fakeSig)).toBe(false);
  });

  test('signature is hex string', () => {
    const { signCheckoutParams } = load();
    const sig = signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
    expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  test('all allowed amounts produce valid signatures', () => {
    const { signCheckoutParams, verifyCheckoutParams } = load();
    for (const amount of [500, 1000, 2000]) {
      const sig = signCheckoutParams(amount, 'U123', 'db-uuid-1');
      expect(verifyCheckoutParams(amount, 'U123', 'db-uuid-1', sig)).toBe(true);
    }
  });

  test('different keys produce different signatures', () => {
    const { signCheckoutParams } = load();
    const sig1 = signCheckoutParams(500, 'U123', 'db-uuid-1');

    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    jest.resetModules();
    const mod2 = load();
    const sig2 = mod2.signCheckoutParams(500, 'U123', 'db-uuid-1');
    expect(sig1).not.toBe(sig2);
  });

  test('throws when ENCRYPTION_KEY is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    jest.resetModules();
    const { signCheckoutParams } = load();
    expect(() => signCheckoutParams(500, 'U123', 'db-uuid-1')).toThrow('ENCRYPTION_KEY must be set');
  });

  // Edge: signature length mismatch causes false (not crash)
  test('rejects short signature gracefully', () => {
    const { verifyCheckoutParams } = load();
    // Length mismatch is caught before timingSafeEqual — returns false, not throw
    expect(verifyCheckoutParams(500, 'U123', 'db-uuid-1', 'tooshort')).toBe(false);
  });
});
