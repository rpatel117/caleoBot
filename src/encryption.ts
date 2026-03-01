import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
// New format prefix to distinguish from legacy CryptoJS ciphertext
const FORMAT_PREFIX = 'v2:';

export class EncryptionService {
  private key: Buffer;

  constructor() {
    const rawKey = process.env.ENCRYPTION_KEY || '';
    if (!rawKey || rawKey === 'default-key-change-in-production' || rawKey === 'generate-a-64-char-hex-key') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ENCRYPTION_KEY is missing or default — refusing to start in production. Set a 64-char hex string.');
1      }
      console.error('ENCRYPTION_KEY is missing or default — encryption will fail. Set a 64-char hex string.');
    }
    // Key must be 32 bytes (64 hex chars)
    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      this.key = Buffer.from(rawKey, 'hex');
    } else {
      // Derive a 32-byte key via SHA-256 for non-hex keys (fallback)
      this.key = crypto.createHash('sha256').update(rawKey).digest();
    }
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: "v2:<iv-base64>:<authTag-base64>:<ciphertext-base64>"
    return `${FORMAT_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(encryptedText: string): string {
    // New v2 format
    if (encryptedText.startsWith(FORMAT_PREFIX)) {
      return this.decryptV2(encryptedText);
    }
    // Legacy CryptoJS format — attempt backward-compatible decryption
    return this.decryptLegacyCryptoJS(encryptedText);
  }

  private decryptV2(encryptedText: string): string {
    const payload = encryptedText.slice(FORMAT_PREFIX.length);
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Decryption failed: invalid v2 ciphertext format');
    }
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Backward-compatible decryption for tokens encrypted with the old CryptoJS
   * passphrase-based AES. CryptoJS uses OpenSSL's EVP_BytesToKey (MD5-based KDF)
   * with an 8-byte salt embedded in the ciphertext.
   *
   * Format: base64("Salted__" + 8-byte-salt + ciphertext)
   */
  private decryptLegacyCryptoJS(encryptedText: string): string {
    try {
      let processed = encryptedText;

      // Handle hex-escaped format from Postgres bytea columns
      if (processed.startsWith('\\x')) {
        const hexString = processed.replace(/\\x/g, '');
        processed = Buffer.from(hexString, 'hex').toString('base64');
      } else if (processed.startsWith('VTJG')) {
        throw new Error('Corrupted token — please re-authenticate via /caleo-auth');
      }

      const rawData = Buffer.from(processed, 'base64');

      // CryptoJS OpenSSL format: "Salted__" (8 bytes) + salt (8 bytes) + ciphertext
      const header = rawData.slice(0, 8).toString('utf8');
      if (header !== 'Salted__') {
        throw new Error('Unrecognized legacy ciphertext format — re-authenticate via /caleo-auth');
      }

      const salt = rawData.slice(8, 16);
      const ciphertext = rawData.slice(16);

      // Derive key + IV using EVP_BytesToKey (MD5-based, matching CryptoJS)
      const passphrase = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf8');
      const { key, iv } = this.evpBytesToKey(passphrase, salt, 32, 16);

      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const result = decrypted.toString('utf8');

      if (!result) {
        throw new Error('Decryption resulted in empty string');
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('re-authenticate')) {
        throw error;
      }
      throw new Error('Legacy decryption failed — token may be corrupted. Re-authenticate via /caleo-auth');
    }
  }

  /**
   * OpenSSL EVP_BytesToKey derivation (MD5-based).
   * Matches CryptoJS's internal key derivation when a string passphrase is used.
   */
  private evpBytesToKey(
    passphrase: Buffer,
    salt: Buffer,
    keyLen: number,
    ivLen: number
  ): { key: Buffer; iv: Buffer } {
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

  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
