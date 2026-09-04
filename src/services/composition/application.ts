/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  type ApplicationLifecycleEvent,
  type OffGridApplication,
  type OffGridApplicationSnapshot,
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
 * The root's own failure stream, and the reason this observer exists at all: a lifecycle failure
 * must reach the app through a TYPED event, never through console output and never by polling the
 * snapshot. Nothing here renders.
 *
 * `recovered` is the one that is easy to report wrongly. `degraded` and `lifecycleFailure` are two
 * filters over ONE list of reports keyed by REPORTER - `(scope, source)`, never the domain - so a
 * retraction clears exactly one owner's entry. Another owner may still be reporting the same
 * domain, and there is deliberately no domain-level clear, because an owner that recovered has no
 * standing to declare another owner's failure over. So this is logged as one REPORTER standing
 * down, and whether the DOMAIN is now well is read from the `degraded` projection instead of being
 * inferred from the event.
 */
function reportLifecycleEvent(
  event: ApplicationLifecycleEvent,
  snapshot: () => OffGridApplicationSnapshot,
): void {
  if (event.type === 'degraded') {
    logger.error('[Application] Domain degraded', {
      domain: event.report.domain,
      source: event.report.source,
      reason: event.report.reason,
      lifecycleFailure: event.lifecycleFailure,
    });
    return;
  }
  if (event.type === 'recovered') {
    const stillReporting = snapshot()
      .degraded.filter(report => report.domain === event.domain)
      .map(report => report.source);
    logger.warn('[Application] A degradation reporter stood down', {
      domain: event.domain,
      source: event.source,
      // NOT "the domain recovered": while this list is non-empty the domain is still degraded.
      stillDegradedBy: stillReporting,
      lifecycleFailure: event.lifecycleFailure,
    });
    return;
  }
  logger.error('[Application] Lifecycle failed', {
    phase: event.failure.phase,
    message: event.failure.message,
    causes: event.failure.causes,
  });
}

function observeApplicationFailures(value: OffGridApplication): void {
  releaseFailureObserver ??= value.events(({domain, event}) => {
    if (domain === 'lifecycle') {
      reportLifecycleEvent(event, () => value.snapshot());
      return;
    }
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

/**
 * Kept ALONGSIDE the observer, deliberately, and not a duplicate of it: the domains the app
 * composed no ports for are recorded at construction as `unavailable` reports and emit NO event, so
 * they reach `result.degraded` and nothing else. One summary line rather than one error per entry,
 * because everything in here that IS a failure has already been reported per-event above.
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
