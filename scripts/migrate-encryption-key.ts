#!/usr/bin/env npx ts-node
/**
 * One-time migration script to re-encrypt all OAuth tokens with a new encryption key.
 *
 * Usage:
 *   DATABASE_URL=postgres://... OLD_ENCRYPTION_KEY=<old-64-char-hex> NEW_ENCRYPTION_KEY=<new-64-char-hex> npx ts-node scripts/migrate-encryption-key.ts
 *
 * IMPORTANT: Test against a database snapshot first, NOT production directly.
 *
 * What it does:
 *   1. Connects to the database
 *   2. Reads all oauth_tokens rows
 *   3. Decrypts access_token and refresh_token with the OLD key
 *   4. Re-encrypts with the NEW key
 *   5. Updates the row — all within a single transaction
 *
 * Handles both v2 (AES-256-GCM) and legacy CryptoJS formats.
 */

import * as crypto from 'crypto';
import { Pool } from 'pg';

// --- Encryption helpers (inline to avoid importing app code with side effects) ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const FORMAT_PREFIX = 'v2:';

function parseKey(rawKey: string): Buffer {
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptWithKey(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptV2(encryptedText: string, key: Buffer): string {
  const payload = encryptedText.slice(FORMAT_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid v2 ciphertext format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function evpBytesToKey(passphrase: Buffer, salt: Buffer, keyLen: number, ivLen: number): { key: Buffer; iv: Buffer } {
  const totalLen = keyLen + ivLen;
  let derivedBytes = Buffer.alloc(0);
  let lastHash = Buffer.alloc(0);
  while (derivedBytes.length < totalLen) {
    const hash = crypto.createHash('md5');
    if (lastHash.length > 0) hash.update(lastHash);
    hash.update(passphrase);
    hash.update(salt);
    lastHash = Buffer.from(hash.digest());
    derivedBytes = Buffer.concat([derivedBytes, lastHash]);
  }
  return {
    key: derivedBytes.subarray(0, keyLen),
    iv: derivedBytes.subarray(keyLen, keyLen + ivLen),
  };
}

function decryptLegacyCryptoJS(encryptedText: string, rawKey: string): string {
  let processed = encryptedText;
  if (processed.startsWith('\\x')) {
    const hexString = processed.replace(/\\x/g, '');
    processed = Buffer.from(hexString, 'hex').toString('base64');
  }
  const rawData = Buffer.from(processed, 'base64');
  const header = rawData.slice(0, 8).toString('utf8');
  if (header !== 'Salted__') throw new Error('Unrecognized legacy ciphertext format');
  const salt = rawData.slice(8, 16);
  const ciphertext = rawData.slice(16);
  const passphrase = Buffer.from(rawKey, 'utf8');
  const { key, iv } = evpBytesToKey(passphrase, salt, 32, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function decryptWithKey(encryptedText: string, key: Buffer, rawKey: string): string {
  if (encryptedText.startsWith(FORMAT_PREFIX)) {
    return decryptV2(encryptedText, key);
  }
  return decryptLegacyCryptoJS(encryptedText, rawKey);
}

// --- Main migration ---

async function main() {
  const oldRawKey = process.env.OLD_ENCRYPTION_KEY;
  const newRawKey = process.env.NEW_ENCRYPTION_KEY;
  const dbUrl = process.env.DATABASE_URL;

  if (!oldRawKey || !newRawKey) {
    console.error('Usage: OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> DATABASE_URL=<url> npx ts-node scripts/migrate-encryption-key.ts');
    process.exit(1);
  }
  if (!dbUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (oldRawKey === newRawKey) {
    console.error('OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY must be different');
    process.exit(1);
  }

  const oldKey = parseKey(oldRawKey);
  const newKey = parseKey(newRawKey);

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  let migrated = 0;
  let failed = 0;

  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT id, user_id, provider, access_token, refresh_token FROM oauth_tokens');
    console.log(`Found ${rows.length} token row(s) to migrate`);

    for (const row of rows) {
      try {
        // Decrypt with old key
        const plainAccess = decryptWithKey(row.access_token, oldKey, oldRawKey);

        // Re-encrypt with new key
        const newAccess = encryptWithKey(plainAccess, newKey);

        let newRefresh: string | null = null;
        if (row.refresh_token) {
          const plainRefresh = decryptWithKey(row.refresh_token, oldKey, oldRawKey);
          newRefresh = encryptWithKey(plainRefresh, newKey);
        }

        await client.query(
          `UPDATE oauth_tokens SET access_token = $1, refresh_token = $2, updated_at = NOW() WHERE id = $3`,
          [newAccess, newRefresh, row.id]
        );

        migrated++;
        console.log(`  [${migrated}/${rows.length}] Migrated token for user=${row.user_id} provider=${row.provider}`);
      } catch (err: any) {
        failed++;
        console.error(`  FAILED token id=${row.id} user=${row.user_id} provider=${row.provider}: ${err.message}`);
      }
    }

    if (failed > 0) {
      console.error(`\n${failed} token(s) failed to migrate. Rolling back transaction.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');
    console.log(`\nSuccessfully migrated ${migrated} token(s). Update ENCRYPTION_KEY in ECS + Lambda to the new key.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
