import type {
  ApplicationLifecycleEvent,
  AutomationEvent,
  ModelsEvent,
  OffGridApplication,
  OffGridApplicationSnapshot,
  RagEvent,
  SpeechEvent,
  SyncEvent,
  UseEvent,
  WorkflowEvent,
} from '@offgrid/application';
import logger from '../../utils/logger';

/**
 * Every domain failure, observable, with the identity that correlates it to the command that caused
 * it.
 *
 * The defect this file exists to remove: the root observer admitted only `rag` and `sync`, and only
 * their `operation_failed`, so Models, Speech, Automation, Use and the cross-domain Workflow
 * failures reached it and were dropped. It rotted because the filter was a hand-written condition
 * that nothing checked against the contracts.
 *
 * The domains genuinely do NOT share one failure event, so this is a set of per-domain branches
 * rather than a widened condition. Flattening them would throw away the correlation identity, which
 * is the only thing that makes a line useful: `operationId` for Models and Speech transcription,
 * `messageId` for a retry, `entityId` for Sync, `taskId` for Automation, `actionId` for Use.
 */

/** What one failure becomes: a line, plus the identity that ties it to a command. */
interface FailureReport {
  readonly summary: string;
  readonly detail: Record<string, unknown>;
}

/**
 * Every event of a domain that carries a typed `failure`, DERIVED from the contract rather than
 * listed here. This is what makes the exhaustiveness guard at the bottom of each switch real: a new
 * failure-carrying event added in shared joins this union automatically, and the switch that does
 * not name it stops compiling.
 */
type FailureEvent<Event> = Extract<Event, {readonly failure: unknown}>;

const report = (
  summary: string,
  detail: Record<string, unknown>,
): FailureReport => ({summary, detail});

function modelsFailure(event: ModelsEvent): FailureReport | null {
  switch (event.type) {
    case 'model_load_failed':
    case 'model_prepare_failed':
    case 'model_unload_failed':
      return report(event.type, {
        operationId: event.operationId,
        modality: event.modality,
        failure: event.failure,
      });
    case 'model_eject_failed':
    case 'settings_save_failed':
      return report(event.type, {
        operationId: event.operationId,
        failure: event.failure,
      });
    case 'residency_reclaim_failed':
      // Caught by the derived guard, not by hand: `ResidentReclaimFailure` is a different shape
      // from `ModelsFailure`, but the field is still called `failure`, so `FailureEvent<ModelsEvent>`
      // included it and this switch stopped compiling until it was named. Which is the guard
      // working - this event did not exist when the switch was written.
      //
      // The correlation identity is the resident KEY and the reclaim PATH, not an operation id:
      // the sweeps that reclaim (a memory warning, an admission eviction) have no caller to
      // report to. `reclaimed: false` means residency is STILL counting that memory, so the line
      // names an overcommit risk rather than a completed failure.
      return report(event.type, {
        resident: event.failure.key,
        path: event.failure.path,
        reason: event.failure.reason,
      });
    case 'generation_failed':
      return report(event.type, {
        operationId: event.operationId,
        failure: event.failure,
        // Whether partial output was retained, never the output itself: this is a log line, and the
        // partial state holds what the model wrote for the user.
        partialOutput: event.partial ? 'retained' : 'none',
      });
    case 'settings_launch_restart':
      // Outside the derived guarantee: ONE event type carries started, completed, failed and
      // superseded, so the failure is a `status`, not a `failure` field. This is the bare `failed`.
      return event.status === 'failed'
        ? report('settings_launch_restart_failed', {
            operationId: event.operationId,
            reason: event.message,
          })
        : null;
    case 'download':
      // Outside the derived guarantee too: the failure is NESTED in the download event's own union.
      return event.event.status === 'failed'
        ? report('model_download_failed', {
            modelId: event.event.modelId,
            reason: event.event.reason,
            reasonCode: event.event.reasonCode,
          })
        : null;
    default: {
      const _notAFailureEvent: Exclude<ModelsEvent, FailureEvent<ModelsEvent>> =
        event;
      return null;
    }
  }
}

function syncFailure(event: SyncEvent): FailureReport | null {
  switch (event.type) {
    case 'operation_failed':
      return report(event.type, {
        operation: event.operation,
        entityId: event.entityId,
        failure: event.failure,
      });
    case 'transfer_failed':
      // Outside the derived guarantee: it carries `reason` and the transfer, not a `failure`.
      return report(event.type, {
        transferId: event.transfer.requestId,
        fileName: event.transfer.fileName,
        deviceId: event.transfer.deviceId,
        reason: event.reason,
      });
    default: {
      const _notAFailureEvent: Exclude<SyncEvent, FailureEvent<SyncEvent>> =
        event;
      return null;
    }
  }
}

function ragFailure(event: RagEvent): FailureReport | null {
  if (event.type === 'operation_failed') {
    return report(event.type, {
      operation: event.operation,
      failure: event.failure,
    });
  }
  const _notAFailureEvent: Exclude<RagEvent, FailureEvent<RagEvent>> = event;
  return null;
}

function useFailure(event: UseEvent): FailureReport | null {
  if (event.type === 'operation_failed') {
    return report(event.type, {
      operation: event.operation,
      actionId: event.actionId,
      failure: event.failure,
    });
  }
  const _notAFailureEvent: Exclude<UseEvent, FailureEvent<UseEvent>> = event;
  return null;
}

function automationFailure(event: AutomationEvent): FailureReport | null {
  if (event.type === 'operation_failed') {
    return report(event.type, {
      operation: event.operation,
      taskId: event.taskId,
      failure: event.failure,
    });
  }
  const _notAFailureEvent: Exclude<
    AutomationEvent,
    FailureEvent<AutomationEvent>
  > = event;
  return null;
}

/** Speak outcomes that are failures. The rest - spoken, busy, interrupted - are not. */
const FAILED_SPEECH_OUTCOMES = new Set([
  'no-audio',
  'engine-unavailable',
  'synthesis-failed',
  'engine-stuck',
]);

function speechFailure(event: SpeechEvent): FailureReport | null {
  switch (event.type) {
    case 'transcription_failed':
      return report(event.type, {
        operationId: event.operationId,
        failure: event.failure,
      });
    case 'transcription_retry_failed':
      // The retry is correlated by the MESSAGE it is retrying, not by an operation id.
      return report(event.type, {
        messageId: event.messageId,
        failure: event.failure,
      });
    case 'engine_release_failed':
      return report(event.type, {failure: event.failure});
    case 'speech_finished':
      // Outside the derived guarantee: a failed speak is an OUTCOME on the ordinary finish event.
      return FAILED_SPEECH_OUTCOMES.has(event.outcome.kind)
        ? report('speech_failed', {
            operationId: event.operationId,
            outcome: event.outcome.kind,
            detail:
              event.outcome.kind === 'synthesis-failed'
                ? event.outcome.detail
                : undefined,
          })
        : null;
    default: {
      const _notAFailureEvent: Exclude<SpeechEvent, FailureEvent<SpeechEvent>> =
        event;
      return null;
    }
  }
}

function workflowFailure(event: WorkflowEvent): FailureReport | null {
  switch (event.type) {
    case 'bridge_failed':
      return report(event.type, {
        bridge: event.bridge,
        failure: event.failure,
      });
    case 'workflow_failed':
      return report(event.type, {
        workflow: event.workflow,
        operationId: event.operationId,
        failure: event.failure,
      });
    default: {
      const _notAFailureEvent: Exclude<
        WorkflowEvent,
        FailureEvent<WorkflowEvent>
      > = event;
      return null;
    }
  }
}

/**
 * The root's own reports. `recovered` is the one that is easy to log wrongly: `degraded` and
 * `lifecycleFailure` are two filters over ONE list keyed by REPORTER - `(scope, source)`, never the
 * domain - so a retraction clears exactly one owner's entry. Another owner may still be reporting
 * the same domain, and there is deliberately no domain-level clear, because an owner that recovered
 * has no standing to declare another owner's failure over. So it is logged as one reporter standing
 * down, and whether the DOMAIN is well is READ from the `degraded` projection.
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
    logger.warn('[Application] A degradation reporter stood down', {
      domain: event.domain,
      source: event.source,
      // NOT "the domain recovered": while this list is non-empty the domain is still degraded.
      stillDegradedBy: snapshot()
        .degraded.filter(entry => entry.domain === event.domain)
        .map(entry => entry.source),
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

/**
 * Cap a repeating failure instead of amplifying it - and do NOT silence the first ones.
 *
 * Two of these events fire per unit of work rather than per user action: a queued speak publishes
 * `speech_finished` PER SENTENCE while text is still streaming, so a broken voice engine writes one
 * line per sentence, and a device that cannot connect re-reports the same sync `operation_failed`
 * on every retry. Both produce the identical summary.
 *
 * So identical consecutive summaries are published in full up to a small burst and counted after
 * that. The burst matters: the key deliberately EXCLUDES the correlation identity, because the
 * amplifying cases carry a fresh `operationId` per attempt and keying on it would defeat the cap
 * entirely - but that also means three different models failing to load share one key, and each of
 * those first lines must still name its own model. The withheld count is attached to the next
 * distinct failure, so a run never ends with a silent tail.
 *
 * ONE remembered line, never a per-key map: a cache here would be exactly the unbounded growth this
 * program is removing elsewhere.
 */
const IDENTICAL_FAILURE_BURST = 3;

let lastKey: string | null = null;
let published = 0;
let withheld = 0;

function publish(domain: string, failure: FailureReport): void {
  const key = `${domain}:${failure.summary}`;
  const carried = key === lastKey ? 0 : withheld;
  if (key !== lastKey) {
    lastKey = key;
    published = 0;
    withheld = 0;
  }
  if (published >= IDENTICAL_FAILURE_BURST) {
    withheld += 1;
    return;
  }
  published += 1;
  logger.error(`[Application] ${domain} failure: ${failure.summary}`, {
    ...failure.detail,
    ...(carried > 0 ? {furtherRepeatsOfPreviousFailure: carried} : {}),
  });
}

/** Reset the cap so a new session never inherits the previous one's counters. */
export function resetFailureReporting(): void {
  lastKey = null;
  published = 0;
  withheld = 0;
}

function publishIf(domain: string, failure: FailureReport | null): void {
  if (failure) publish(domain, failure);
}

/**
 * The switch is on the event's own discriminant rather than a destructured copy, so each branch
 * hands its domain's handler the exactly-narrowed event and no cast is needed anywhere in this file.
 *
 * The `default` is an exhaustiveness guard at the DOMAIN level, the outer half of the pair: a new
 * domain added to `OffGridApplicationEvent` stops compiling here instead of being silently dropped,
 * which is exactly how five domains came to be dropped by the condition this replaces. The inner
 * half is in each handler, where a new failure-carrying EVENT stops compiling.
 */
export function observeApplicationFailures(
  value: OffGridApplication,
): () => void {
  return value.events(domainEvent => {
    switch (domainEvent.domain) {
      case 'lifecycle':
        reportLifecycleEvent(domainEvent.event, () => value.snapshot());
        return;
      case 'models':
        return publishIf('models', modelsFailure(domainEvent.event));
      case 'sync':
        return publishIf('sync', syncFailure(domainEvent.event));
      case 'rag':
        return publishIf('rag', ragFailure(domainEvent.event));
      case 'speech':
        return publishIf('speech', speechFailure(domainEvent.event));
      case 'automation':
        return publishIf('automation', automationFailure(domainEvent.event));
      case 'use':
        return publishIf('use', useFailure(domainEvent.event));
      case 'workflows':
        return publishIf('workflows', workflowFailure(domainEvent.event));
      default: {
        const _unhandledDomain: never = domainEvent;
        return;
      }
    }
  });
}
