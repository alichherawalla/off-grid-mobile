/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  observeApplicationFailures,
  type NormalizedFailure,
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
import { mobileModelSettingsPorts } from '../modelServices/modelSettingsPorts';
import { modelsChatPort } from './chat';

export type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
>;

export type MobileApplicationPortsFactory =
  () => MobileApplicationExtensionPorts;

let extensionPortsFactory: MobileApplicationPortsFactory | null = null;
let application: OffGridApplication | null = null;
let releaseFailureObserver: (() => void) | null = null;

/**
 * The ONLY thing this app still owns about failure reporting: where the line goes.
 *
 * Everything else - which streams carry failures, the four events whose failure is a status or an
 * outcome rather than a field, each domain's correlation identity, the amplification cap and the
 * exhaustiveness that stops a new failure event being dropped - is `@offgrid/application`'s, and is
 * now shared with desktop instead of written twice. This replaced 358 lines here.
 */
const writeFailure = (failure: NormalizedFailure): void => {
  logger.error(`[${failure.domain}] ${failure.summary}`, {
    ...failure.fields,
    event: failure.event,
    operation: failure.operation,
    identity: failure.identity,
    identityKind: failure.identityKind,
  });
};

/**
 * Kept ALONGSIDE the observer, deliberately, and not a duplicate of it: the domains the app
 * composed no ports for are recorded at construction as `unavailable` reports and emit NO event, so
 * they reach `result.degraded` and nothing else. One summary line rather than one error per entry,
 * because everything in here that IS a failure is already reported per event by the observer.
 */
function reportDegradedStart(
  result: Awaited<ReturnType<OffGridApplication['start']>>,
): Awaited<ReturnType<OffGridApplication['start']>> {
  if (result.degraded.length > 0) {
    logger.warn('[Application] Domains running but not whole', {
      degraded: result.degraded.map(
        ({domain, source, reason}) => `${domain} (${source}): ${reason}`,
      ),
    });
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
      settings: mobileModelSettingsPorts,
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
  releaseFailureObserver ??= observeApplicationFailures(
    application,
    writeFailure,
  );
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
    // Releasing the subscription drops the amplification cap with it, so a new session starts
    // counting from zero without this file owning a reset.
    releaseFailureObserver?.();
    releaseFailureObserver = null;
    starting = null;
  }
}
