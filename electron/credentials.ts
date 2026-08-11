import { safeStorage } from 'electron';
import type { CredentialStatus } from '../src/shared/types';
import type { ResearchDatabase } from './database';

export class CredentialStore {
  constructor(private readonly db: ResearchDatabase) {}

  status(): CredentialStatus {
    const value = this.db.getSecret();
    return {
      configured: Boolean(value),
      masked: value ? '••••••••' : '',
      secureStorage: safeStorage.isEncryptionAvailable(),
    };
  }

  save(apiKey: string): CredentialStatus {
    const clean = apiKey.trim();
    if (!clean) throw new Error('API key is required.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable. The key was not saved.');
    this.db.setSecret(safeStorage.encryptString(clean).toString('base64'));
    return this.status();
  }

  read(): string | null {
    const encrypted = this.db.getSecret();
    if (!encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  remove(): CredentialStatus {
    this.db.removeSecret();
    return this.status();
  }
}
