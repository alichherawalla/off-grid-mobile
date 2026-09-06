/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  modelsFailureMessage,
  observeApplicationFailures,
  type NormalizedFailure,
  type OffGridApplication,
  type OffGridPlatformPorts,
} from '@offgrid/application';
import { generateId } from '../../utils/generateId';
import logger from '../../utils/logger';
import {
  mobileRagEmbeddings,
  mobileRagExtraction,
  mobileRagStore,
  prepareMobileRagDocument,
} from '../adapters/rag/mobileRagPorts';
import { mobileModelWorkspacePorts } from '../modelServices/workspace';
import { mobileModelEjectionPorts } from '../modelServices/ejectModelsForUser';
import { mobileModelSettingsPorts } from '../modelServices/modelSettingsPorts';
import { mobileModelActivationHostPort } from '../modelServices/modelActivationHostPort';
import { createMobileModelLibraryFacadePorts } from '../modelServices/modelLibraryFacadePorts';
import { createMobileApplicationDownloadPorts } from '../modelServices/applicationDownloadPorts';
import { createMobileModelControlPort } from '../adapters/models/modelControlCatalogPort';
import { autoSetupImageCatalogProvider } from '../autoSetupImageCatalogProvider';
import type { MobileManagedArtifactIO } from '../modelServices/modelDownloadArtifactIO';
import { modelsChatPort } from './chat';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { mobileCoreSpeechPorts } from '../adapters/speech/mobileSpeechInputPorts';

type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
> & { readonly modelDownloads?: MobileManagedArtifactIO };

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
  const { modelDownloads, ...extensionPorts } = extensionPortsFactory?.() ?? {};
  return createOffGridApplication({
    models: {
      // The workspace's own I/O, not a workspace: shared composes the single one from these. See
      // `mobileModelWorkspacePorts` for why this app no longer holds the instance.
      ...mobileModelWorkspacePorts,
      chat: modelsChatPort,
      ejection: mobileModelEjectionPorts(),
      library: createMobileModelLibraryFacadePorts(modelDownloads),
      downloads: createMobileApplicationDownloadPorts(modelDownloads),
      control: createMobileModelControlPort(() => autoSetupImageCatalogProvider.load()),
      settings: mobileModelSettingsPorts,
      activation: mobileModelActivationHostPort,
    },
    rag: {
      store: mobileRagStore,
      embeddings: mobileRagEmbeddings,
      extraction: mobileRagExtraction,
      prepareDocument: prepareMobileRagDocument,
    },
    speech: mobileCoreSpeechPorts,
    ...extensionPorts,
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

let starting: ReturnType<OffGridApplication['start']> | null = null;

function mobileModelServices(): Pick<
  typeof import('../modelServices'),
  | 'startMobileModelServices'
  | 'stopMobileModelServices'
  | 'refreshMobileModelServices'
> {
  // Deferred because modelServices resolves this composition root through applicationFacade().
  // getMobileApplication() has created the root before this function is called, so both sides use
  // the same application instead of depending on an App.tsx import side effect.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../modelServices') as typeof import('../modelServices');
}

/**
 * Recover the durable download journal once per application lifetime.
 *
 * A download interrupted by an app kill is only re-observed when something calls the PUBLIC
 * inventory refresh: shared's `refresh` awaits its own private `hydrateDownloads()` before
 * reconciling (`packages/application/src/models/projector-repair-facade.ts`). Hydration is a
 * durable-recovery concern for the whole app lifetime, so the STARTUP LIFECYCLE owns it here -
 * not a component effect, which would tie recovery to a render tree.
 *
 * Deliberately NOT awaited by `startMobileApplication`. It reads the native download database,
 * which contends with in-flight writes, and the first screen must never wait on it.
 *
 * A refusal is reported, never dropped: the domain emits its own typed failure event (which the
 * failure observer writes), and this adds the one fact the event cannot carry - that the missing
 * work was cold-start recovery - as a late degradation on the snapshot, cleared on success so a
 * later retry is not shadowed by a stale entry.
 */
function recoverDownloadJournal(current: OffGridApplication): void {
  const report = (reason: string | null) =>
    current.reportDegraded({
      domain: 'models',
      source: 'download recovery',
      reason,
    });
  current.models
    .refresh()
    .then(outcome => {
      if (outcome.ok) return report(null);
      logger.error(
        '[Application] Cold-start download recovery failed',
        outcome.failure,
      );
      report(modelsFailureMessage(outcome.failure));
    })
    .catch(error => {
      logger.error(
        '[Application] Cold-start download recovery threw',
        error,
      );
      report(error instanceof Error ? error.message : String(error));
    });
}

export function startMobileApplication(): ReturnType<
  OffGridApplication['start']
> {
  const current = getMobileApplication();
  starting ??= (async () => {
    const modelServices = mobileModelServices();
    modelServices.startMobileModelServices();
    await modelServices.refreshMobileModelServices();
    try {
      const result = await current.start();
      await callHook<Promise<void>>(HOOKS.applicationStarted);
      recoverDownloadJournal(current);
      return reportDegradedStart(result);
    } catch (error) {
      modelServices.stopMobileModelServices();
      logger.error('[Application] Startup failed', error);
      throw error;
    }
  })();
  return starting;
}

export async function stopMobileApplication(): Promise<void> {
  try {
    await callHook<Promise<void>>(HOOKS.applicationStopping);
    mobileModelServices().stopMobileModelServices();
    await application?.stop();
  } finally {
    // Releasing the subscription drops the amplification cap with it, so a new session starts
    // counting from zero without this file owning a reset.
    releaseFailureObserver?.();
    releaseFailureObserver = null;
    starting = null;
    // The memo must never outlive the application it holds. `stop()` is terminal - a stopped
    // download coordinator refuses every later call - so keeping the instance here handed the next
    // `getMobileApplication()` a dead root that no `start()` could revive. Dropping it restores the
    // module invariant: the memo either holds a live application or holds nothing.
    application = null;
  }
}

/**
 * Stop the running application and compose a fresh one.
 *
 * The lifecycle completion of `start`/`stop`: `stop()` is terminal, so any caller that must run the
 * app again after tearing it down - a session or workspace change, a recovery from a failed start,
 * a re-registration of extension ports - needs a NEW root, and only the module that owns the memo
 * can supply one. Returns the fresh application so the caller never re-resolves a stale reference.
 */
export async function resetMobileApplication(): Promise<OffGridApplication> {
  await stopMobileApplication();
  return getMobileApplication();
}
