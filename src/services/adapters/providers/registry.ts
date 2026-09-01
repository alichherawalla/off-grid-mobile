/**
 * Provider Registry
 *
 * Singleton registry that manages LLM providers and routes requests
 * to the correct provider based on provider ID.
 */

import type { LLMProvider } from './types';
import { localProvider } from './localProvider';
import logger from '../../../utils/logger';

class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    // Register the local provider by default
    this.registerProvider('local', localProvider);
  }

  /**
   * Register a new provider
   */
  registerProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
    logger.log('[ProviderRegistry] Registered provider:', id);
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(id: string): void {
    if (id === 'local') {
      logger.warn('[ProviderRegistry] Cannot unregister local provider');
      return;
    }

    this.providers.delete(id);
    logger.log('[ProviderRegistry] Unregistered provider:', id);

  }

  /** Get a provider by its exact registered ID. */
  getProvider(id: string): LLMProvider | undefined {
    const provider = this.providers.get(id);
    logger.log('[ProviderRegistry] getProvider:', id, 'found:', !!provider, 'providerIds:', this.getProviderIds());
    return provider;
  }

  /**
   * Check if a provider exists
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Get all registered provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Clear all providers except local
   */
  clear(): void {
    // Keep only local provider
    const localProv = this.providers.get('local');
    this.providers.clear();
    if (localProv) {
      this.providers.set('local', localProv);
    }
  }
}

/** Singleton instance */
export const providerRegistry = new ProviderRegistry();

/**
 * Get provider for server ID
 *
 * Return only the provider registered for this exact remote server identity.
 */
export function getProviderForServer(serverId: string): LLMProvider | undefined {
  return providerRegistry.getProvider(serverId);
}
