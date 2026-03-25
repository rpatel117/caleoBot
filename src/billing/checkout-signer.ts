import * as crypto from 'crypto';

/**
 * HMAC-signed checkout parameters with expiration.
 * Prevents an attacker from changing the dbUser or amount in the checkout URL.
 * URLs expire after 15 minutes (URL_EXPIRY_MS).
 */

const URL_EXPIRY_MS = 15 * 60 * 1000;

function getSigningKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || '';
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be set for checkout URL signing');
  }
  return crypto.createHash('sha256').update(key + ':checkout').digest();
}

export function signCheckoutParams(amount: number, userId: string, dbUserId: string, timestamp: number): string {
  const payload = `${amount}:${userId}:${dbUserId}:${timestamp}`;
  return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

export function verifyCheckoutParams(amount: number, userId: string, dbUserId: string, timestamp: number, signature: string): boolean {
  if (Date.now() - timestamp > URL_EXPIRY_MS) return false;
  const expected = signCheckoutParams(amount, userId, dbUserId, timestamp);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

export function signAutoRefillParams(amountCents: number, userId: string, dbUserId: string, timestamp: number): string {
  const payload = `autorefill:${amountCents}:${userId}:${dbUserId}:${timestamp}`;
  return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

export function verifyAutoRefillParams(amountCents: number, userId: string, dbUserId: string, timestamp: number, signature: string): boolean {
  if (Date.now() - timestamp > URL_EXPIRY_MS) return false;
  const expected = signAutoRefillParams(amountCents, userId, dbUserId, timestamp);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

export function signPortalParams(dbUserId: string, timestamp: number): string {
  const payload = `portal:${dbUserId}:${timestamp}`;
  return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

export function verifyPortalParams(dbUserId: string, timestamp: number, signature: string): boolean {
  if (Date.now() - timestamp > URL_EXPIRY_MS) return false;
  const expected = signPortalParams(dbUserId, timestamp);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
