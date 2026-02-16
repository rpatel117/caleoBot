import * as crypto from 'crypto';

/**
 * HMAC-signed checkout parameters.
 * Prevents an attacker from changing the dbUser or amount in the checkout URL.
 */

function getSigningKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || '';
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be set for checkout URL signing');
  }
  return crypto.createHash('sha256').update(key + ':checkout').digest();
}

export function signCheckoutParams(amount: number, userId: string, dbUserId: string): string {
  const payload = `${amount}:${userId}:${dbUserId}`;
  return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

export function verifyCheckoutParams(amount: number, userId: string, dbUserId: string, signature: string): boolean {
  const expected = signCheckoutParams(amount, userId, dbUserId);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
