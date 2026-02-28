describe('EncryptionService', () => {
  const VALID_HEX_KEY = 'a'.repeat(64);

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
  });

  function loadEncryptionService() {
    // Re-import to pick up new env vars
    const { EncryptionService } = require('../encryption');
    return new EncryptionService();
  }

  test('encrypt and decrypt roundtrip', () => {
    const svc = loadEncryptionService();
    const plaintext = 'my-secret-access-token-12345';
    const encrypted = svc.encrypt(plaintext);
    const decrypted = svc.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('encrypted output starts with v2: prefix', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('hello');
    expect(encrypted.startsWith('v2:')).toBe(true);
  });

  test('encrypted output has 3 colon-separated parts after prefix', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('test');
    const parts = encrypted.slice(3).split(':');
    expect(parts).toHaveLength(3); // iv:authTag:ciphertext
  });

  test('different encryptions of same plaintext produce different ciphertext (random IV)', () => {
    const svc = loadEncryptionService();
    const a = svc.encrypt('same-value');
    const b = svc.encrypt('same-value');
    expect(a).not.toBe(b);
    // But both decrypt to same value
    expect(svc.decrypt(a)).toBe('same-value');
    expect(svc.decrypt(b)).toBe('same-value');
  });

  test('decrypt fails with tampered ciphertext', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('sensitive-data');
    // Tamper with the ciphertext portion
    const tampered = encrypted.slice(0, -2) + 'XX';
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  test('decrypt fails with tampered auth tag', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('test');
    const parts = encrypted.slice(3).split(':');
    // Tamper with auth tag
    const tamperedTag = 'A'.repeat(parts[1].length);
    const tampered = `v2:${parts[0]}:${tamperedTag}:${parts[2]}`;
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  test('decrypt fails with wrong key', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('test');

    // Change key
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    const svc2 = loadEncryptionService();
    expect(() => svc2.decrypt(encrypted)).toThrow();
  });

  test('handles empty string encryption', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('');
    expect(svc.decrypt(encrypted)).toBe('');
  });

  test('handles long strings', () => {
    const svc = loadEncryptionService();
    const long = 'x'.repeat(10000);
    const encrypted = svc.encrypt(long);
    expect(svc.decrypt(encrypted)).toBe(long);
  });

  test('handles unicode strings', () => {
    const svc = loadEncryptionService();
    const unicode = 'Hello \u{1F600} \u{1F4C5} \u00E9\u00E8\u00EA';
    const encrypted = svc.encrypt(unicode);
    expect(svc.decrypt(encrypted)).toBe(unicode);
  });

  test('decrypt rejects invalid v2 format (missing parts)', () => {
    const svc = loadEncryptionService();
    expect(() => svc.decrypt('v2:onlyonepart')).toThrow();
    expect(() => svc.decrypt('v2:two:parts')).toThrow();
  });

  test('throws in production with default/missing key', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENCRYPTION_KEY = 'default-key-change-in-production';
    expect(() => loadEncryptionService()).toThrow('ENCRYPTION_KEY is missing or default');
  });

  test('throws in production with empty key', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENCRYPTION_KEY = '';
    expect(() => loadEncryptionService()).toThrow();
  });

  test('non-hex key uses SHA-256 derivation', () => {
    process.env.ENCRYPTION_KEY = 'my-passphrase-not-hex';
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('test');
    expect(svc.decrypt(encrypted)).toBe('test');
  });

  test('generateKey produces valid 64-char hex string', () => {
    const { EncryptionService } = require('../encryption');
    const key = EncryptionService.generateKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  // Security: AES-256-GCM integrity
  test('GCM auth tag prevents bit-flipping attacks', () => {
    const svc = loadEncryptionService();
    const encrypted = svc.encrypt('amount=100');
    // Try to flip a single byte in the ciphertext
    const parts = encrypted.slice(3).split(':');
    const ct = Buffer.from(parts[2], 'base64');
    ct[0] ^= 0x01; // flip one bit
    const tampered = `v2:${parts[0]}:${parts[1]}:${ct.toString('base64')}`;
    expect(() => svc.decrypt(tampered)).toThrow();
  });
});
