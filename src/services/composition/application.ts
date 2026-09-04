/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  type OffGridApplication,
  type OffGridPlatformPorts,
} from '@offgrid/application';
import { generateId } from '../../utils/generateId';
import logger from '../../utils/logger';
import { registerApplicationFacade } from '../applicationFacade';
import {
  mobileRagEmbeddings,
  mobileRagExtraction,
  mobileRagStore,
  prepareMobileRagDocument,
} from '../adapters/rag/mobileRagPorts';
import { mobileWorkspace } from '../modelServices/workspace';
import { mobileModelEjectionPorts } from '../modelServices/ejectModelsForUser';
import { modelsChatPort } from './chat';

export type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
>;

export type MobileApplicationPortsFactory =
  () => MobileApplicationExtensionPorts;

let extensionPortsFactory: MobileApplicationPortsFactory | null = null;
let application: OffGridApplication | null = null;
let releaseFailureObserver: (() => void) | null = null;

function observeApplicationFailures(value: OffGridApplication): void {
  releaseFailureObserver ??= value.events(({domain, event}) => {
    if (
      (domain !== 'rag' && domain !== 'sync') ||
      event.type !== 'operation_failed'
    ) {
      return;
    }
    logger.error('[Application] Domain operation failed', {
      domain,
      operation: event.operation,
      failure: event.failure,
    });
  });
}

function reportDegradedStart(
  result: Awaited<ReturnType<OffGridApplication['start']>>,
): Awaited<ReturnType<OffGridApplication['start']>> {
  for (const {domain, reason} of result.degraded) {
    logger.error('[Application] Domain startup degraded', {domain, reason});
  }
  return result;
}

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
    models: {
      workspace: mobileWorkspace,
      chat: modelsChatPort,
      ejection: mobileModelEjectionPorts(),
    },
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
  observeApplicationFailures(application);
  return application;
}

registerApplicationFacade(getMobileApplication);

let starting: ReturnType<OffGridApplication['start']> | null = null;

export function startMobileApplication(): ReturnType<
  OffGridApplication['start']
> {
  const current = getMobileApplication();
  starting ??= current.start().then(reportDegradedStart, error => {
    logger.error('[Application] Startup failed', error);
    throw error;
  });
  return starting;
}

export async function stopMobileApplication(): Promise<void> {
  try {
    await application?.stop();
  } finally {
    releaseFailureObserver?.();
    releaseFailureObserver = null;
    starting = null;
  }
}
