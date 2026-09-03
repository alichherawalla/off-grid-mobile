/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  type OffGridApplication,
  type OffGridPlatformPorts,
} from '@offgrid/application';
import { generateId } from '../../utils/generateId';
import { registerApplicationFacade } from '../applicationFacade';
import {
  mobileRagEmbeddings,
  mobileRagExtraction,
  mobileRagStore,
  prepareMobileRagDocument,
} from '../adapters/rag/mobileRagPorts';
import { mobileWorkspace } from '../modelServices/workspace';

export type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
>;

export type MobileApplicationPortsFactory =
  () => MobileApplicationExtensionPorts;

let extensionPortsFactory: MobileApplicationPortsFactory | null = null;
let application: OffGridApplication | null = null;

/** Register optional paid-domain ports before any consumer starts the application. */
export function registerMobileApplicationPorts(
  factory: MobileApplicationPortsFactory,
): void {
  if (extensionPortsFactory === factory) return;
  if (application) {
    throw new Error(
      'Mobile application ports must be registered before application startup.',
    );
  }
  extensionPortsFactory = factory;
}

function createMobileApplication(): OffGridApplication {
  return createOffGridApplication({
    models: { workspace: mobileWorkspace },
    rag: {
      store: mobileRagStore,
      embeddings: mobileRagEmbeddings,
      extraction: mobileRagExtraction,
      prepareDocument: prepareMobileRagDocument,
    },
    ...extensionPortsFactory?.(),
    newId: generateId,
  });
}

export function getMobileApplication(): OffGridApplication {
  application ??= createMobileApplication();
  return application;
}

registerApplicationFacade(getMobileApplication);

let starting: ReturnType<OffGridApplication['start']> | null = null;

export function startMobileApplication(): ReturnType<
  OffGridApplication['start']
> {
  starting ??= getMobileApplication().start();
  return starting;
}

export function stopMobileApplication(): void {
  application?.stop().catch(() => undefined);
  starting = null;
}
