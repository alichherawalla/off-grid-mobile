import * as Keychain from 'react-native-keychain';

const SERVICE_NAME = 'ai.offgridmobile.auth';
const PASSPHRASE_KEY = 'passphrase_hash';

class AuthService {
  private hashPassphrase(passphrase: string): string {
    // Simple hash - in production, consider using bcrypt via native module
    // We use a deterministic hash since we're comparing hashes
    let hash = 0;
    for (let i = 0; i < passphrase.length; i++) {
      const char = passphrase.charCodeAt(i);
      hash = ((hash << 5) - hash) + char; // eslint-disable-line no-bitwise
      hash = hash & hash; // eslint-disable-line no-bitwise
    }
    // Add some complexity with multiple rounds
    const baseHash = Math.abs(hash).toString(16);
    let extendedHash = baseHash;
    for (let i = 0; i < 1000; i++) {
      let tempHash = 0;
      for (let j = 0; j < extendedHash.length; j++) {
        const char = extendedHash.charCodeAt(j);
        tempHash = ((tempHash << 5) - tempHash) + char; // eslint-disable-line no-bitwise
        tempHash = tempHash & tempHash; // eslint-disable-line no-bitwise
      }
      extendedHash = Math.abs(tempHash).toString(16) + extendedHash.slice(0, 8);
    }
    return extendedHash;
  }

  async setPassphrase(passphrase: string): Promise<boolean> {
    try {
      const hash = this.hashPassphrase(passphrase);
      await Keychain.setGenericPassword(PASSPHRASE_KEY, hash, {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      return true;
    } catch (error) {
      console.error('Failed to set passphrase:', error);
      return false;
    }
  }

  async verifyPassphrase(passphrase: string): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SERVICE_NAME,
      });

      if (!credentials) {
        return false;
      }

      const inputHash = this.hashPassphrase(passphrase);
      return inputHash === credentials.password;
    } catch (error) {
      console.error('Failed to verify passphrase:', error);
      return false;
    }
  }

  async hasPassphrase(): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SERVICE_NAME,
      });
      return credentials !== false;
    } catch (error) {
      console.error('Failed to check passphrase:', error);
      return false;
    }
  }

  async removePassphrase(): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: SERVICE_NAME,
      });
      return true;
    } catch (error) {
      console.error('Failed to remove passphrase:', error);
      return false;
    }
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    const isValid = await this.verifyPassphrase(oldPassphrase);
    if (!isValid) {
      return false;
    }
    return this.setPassphrase(newPassphrase);
  }
}

export const authService = new AuthService();
