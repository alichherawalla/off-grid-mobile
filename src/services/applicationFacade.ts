import type { OffGridApplication } from '@offgrid/application';

let resolveApplication: (() => OffGridApplication) | null = null;

/** Composition-root registration. Production consumers only read the closed application facade. */
export function registerApplicationFacade(
  resolve: () => OffGridApplication,
): void {
  resolveApplication = resolve;
}

export function applicationFacade(): OffGridApplication {
  if (!resolveApplication) {
    throw new Error('The mobile application facade is not configured.');
  }
  return resolveApplication();
}
