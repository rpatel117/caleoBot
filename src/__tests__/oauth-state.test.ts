describe('OAuth State Signing', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.OAUTH_STATE_SECRET;
  });

  function load() {
    return require('../auth/oauth-state') as {
      createSignedState: typeof import('../auth/oauth-state').createSignedState;
      verifyAndDecodeState: typeof import('../auth/oauth-state').verifyAndDecodeState;
    };
  }

  test('roundtrip: sign and verify', () => {
    const { createSignedState, verifyAndDecodeState } = load();
    const data = { userId: 'U123', workspaceId: 'T456', provider: 'google' };
    const state = createSignedState(data);
    const decoded = verifyAndDecodeState(state);
    expect(decoded).toEqual(data);
  });

  test('state format contains dot separator', () => {
    const { createSignedState } = load();
    const state = createSignedState({ userId: 'U1', workspaceId: 'W1', provider: 'microsoft' });
    expect(state).toContain('.');
    const parts = state.split('.');
    expect(parts).toHaveLength(2);
    // First part is base64 JSON, second is hex signature
    expect(/^[A-Za-z0-9+/=]+$/.test(parts[0])).toBe(true);
    expect(/^[0-9a-f]+$/.test(parts[1])).toBe(true);
  });

  test('rejects tampered payload', () => {
    const { createSignedState, verifyAndDecodeState } = load();
    const state = createSignedState({ userId: 'U123', workspaceId: 'T456', provider: 'google' });
    const [, sig] = state.split('.');
    // Create a different payload
    const tampered = Buffer.from(JSON.stringify({ userId: 'UATTACKER', workspaceId: 'T456', provider: 'google' })).toString('base64');
    expect(() => verifyAndDecodeState(`${tampered}.${sig}`)).toThrow('signature mismatch');
  });

  test('rejects tampered signature', () => {
    const { createSignedState, verifyAndDecodeState } = load();
    const state = createSignedState({ userId: 'U123', workspaceId: 'T456', provider: 'google' });
    const [payload] = state.split('.');
    const fakeSig = 'a'.repeat(64);
    expect(() => verifyAndDecodeState(`${payload}.${fakeSig}`)).toThrow('signature mismatch');
  });

  test('rejects state without signature', () => {
    const { verifyAndDecodeState } = load();
    const noSig = Buffer.from(JSON.stringify({ userId: 'U1', workspaceId: 'W1', provider: 'google' })).toString('base64');
    expect(() => verifyAndDecodeState(noSig)).toThrow('missing signature');
  });

  test('rejects state with missing fields', () => {
    const { verifyAndDecodeState } = load();
    // Manually create a signed state with missing fields
    const crypto = require('crypto');
    const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest();
    const payload = Buffer.from(JSON.stringify({ userId: 'U1' })).toString('base64');
    const sig = crypto.createHmac('sha256', key).update(payload).digest('hex');
    expect(() => verifyAndDecodeState(`${payload}.${sig}`)).toThrow('missing required fields');
  });

  test('rejects empty state string', () => {
    const { verifyAndDecodeState } = load();
    expect(() => verifyAndDecodeState('')).toThrow();
  });

  test('uses ENCRYPTION_KEY by default', () => {
    const { createSignedState, verifyAndDecodeState } = load();
    const data = { userId: 'U1', workspaceId: 'W1', provider: 'google' };
    const state = createSignedState(data);
    // Verify works with same key
    expect(verifyAndDecodeState(state)).toEqual(data);
  });

  test('different keys produce different signatures', () => {
    const { createSignedState } = load();
    const data = { userId: 'U1', workspaceId: 'W1', provider: 'google' };
    const state1 = createSignedState(data);

    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    jest.resetModules();
    const mod2 = load();
    const state2 = mod2.createSignedState(data);

    const sig1 = state1.split('.')[1];
    const sig2 = state2.split('.')[1];
    expect(sig1).not.toBe(sig2);
  });

  test('throws if no signing key is set', () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.OAUTH_STATE_SECRET;
    jest.resetModules();
    const { createSignedState } = load();
    expect(() => createSignedState({ userId: 'U1', workspaceId: 'W1', provider: 'google' })).toThrow();
  });

  // Timing attack resistance: verifyAndDecodeState uses timingSafeEqual
  test('uses constant-time comparison (signature length mismatch throws)', () => {
    const { createSignedState, verifyAndDecodeState } = load();
    const state = createSignedState({ userId: 'U1', workspaceId: 'W1', provider: 'google' });
    const [payload] = state.split('.');
    // Short signature — timingSafeEqual will throw on length mismatch
    expect(() => verifyAndDecodeState(`${payload}.abc`)).toThrow();
  });
});
