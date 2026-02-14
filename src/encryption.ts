import * as CryptoJS from 'crypto-js';
import * as dotenv from 'dotenv';

dotenv.config();

export class EncryptionService {
  private encryptionKey: string;

  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    if (this.encryptionKey === 'default-key-change-in-production') {
      console.warn('Using default encryption key. Set ENCRYPTION_KEY environment variable for production!');
    }
  }

  encrypt(text: string): string {
    try {
      return CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
    } catch (error) {
      throw new Error('Encryption failed');
    }
  }

  decrypt(encryptedText: string): string {
    try {
      let processedText = encryptedText;

      if (encryptedText.startsWith('\\x')) {
        const hexString = encryptedText.replace(/\\x/g, '');
        const bytes = Buffer.from(hexString, 'hex');
        processedText = bytes.toString('base64');
      } else if (encryptedText.startsWith('VTJG')) {
        throw new Error('Corrupted token - please re-authenticate');
      }

      const decrypted = CryptoJS.AES.decrypt(processedText, this.encryptionKey);
      const result = decrypted.toString(CryptoJS.enc.Utf8);

      if (!result) {
        throw new Error('Decryption resulted in empty string');
      }

      return result;
    } catch (error) {
      throw new Error('Decryption failed');
    }
  }

  static generateKey(): string {
    return CryptoJS.lib.WordArray.random(256 / 8).toString();
  }
}
