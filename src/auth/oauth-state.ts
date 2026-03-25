import * as crypto from 'crypto';

/**
 * HMAC-signed OAuth state parameter.
 * Prevents forged state attacks where an attacker crafts a state
 * to link their calendar tokens to another user's account.
 *
 * Format: base64(JSON) + "." + hex(HMAC-SHA256)
 */

function getSigningKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || process.env.OAUTH_STATE_SECRET || '';
  if (!key) {
    throw new Error('ENCRYPTION_KEY or OAUTH_STATE_SECRET must be set for OAuth state signing');
  }
  return crypto.createHash('sha256').update(key).digest();
}

export interface OAuthStateData {
  userId: string;
  workspaceId: string;
  provider: string;
  createdAt?: number;
}

export function createSignedState(data: OAuthStateData): string {
  const stateData = { ...data, createdAt: Date.now() };
  const payload = Buffer.from(JSON.stringify(stateData)).toString('base64');
  const signature = crypto
    .createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

export function verifyAndDecodeState(state: string): OAuthStateData {
  const dotIndex = state.lastIndexOf('.');
  if (dotIndex === -1) {
    throw new Error('Invalid OAuth state: missing signature');
  }

  const payload = state.slice(0, dotIndex);
  const signature = state.slice(dotIndex + 1);

  const expected = crypto
    .createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Invalid OAuth state: signature mismatch');
  }

  const data = JSON.parse(Buffer.from(payload, 'base64').toString());
  if (!data.userId || !data.workspaceId || !data.provider) {
    throw new Error('Invalid OAuth state: missing required fields');
  }

  // Reject expired states (10-minute window)
  const STATE_EXPIRY_MS = 10 * 60 * 1000;
  if (data.createdAt && Date.now() - data.createdAt > STATE_EXPIRY_MS) {
    throw new Error('Invalid OAuth state: expired');
  }

  return data as OAuthStateData;
}
