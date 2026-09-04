import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  createKnowledgeDocumentStateFields,
  createSharedFileStateFields,
  isRuntimeOnlyMessage,
  type SharedFileDescriptor,
  type CoreSyncEntity,
  type SyncMutation,
} from '@offgrid/sync';
import {
  decodeModelSettingPatch,
  encodeChangedModelSettings,
  type EncodedModelSetting,
} from '@offgrid/models';
import {
  CORE_SYNC_ENTITIES,
  type KnowledgeDocumentSnapshot,
} from '@offgrid/application';
import type { Conversation, Message, Project } from '../../types';
import { serializeMessageContext } from './messageContext';

// The committed-mutation contract (entity table in wire order, mutation shape) is shared with
// Off Grid Desktop through @offgrid/sync; this module keeps only the Mobile record builders.
export type { CoreSyncEntity, SyncMutation } from '@offgrid/sync';

function modelSettingMutation(setting: EncodedModelSetting): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.modelSetting,
    entityId: setting.wireKey,
    kind: 'put',
    fields: { version: setting.version, value_json: setting.valueJson },
  };
}

export function modelSettingMutations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SyncMutation[] {
  return encodeChangedModelSettings('mobile', before, after).map(modelSettingMutation);
}

export function mobileModelSettingPatch(
  wireKey: string,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  return decodeModelSettingPatch('mobile', wireKey, fields);
}

export function conversationPutMutation(
  conversation: Conversation,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.conversation,
    entityId: conversation.id,
    kind: 'put',
    fields: {
      title: conversation.title,
      project_id: conversation.projectId ?? null,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt,
    },
  };
}

export function messagePutMutation(
  conversationId: string,
  message: Message,
): SyncMutation | null {
  if (
    !message.uuid ||
    // A thinking row is live UI state, not a completed chat turn. Image prompt enhancement creates
    // one with "Enhancing your prompt..." and later either replaces it with the labelled,
    // supporting-context message or deletes it. Publishing this intermediate row made peers render
    // it as a normal assistant answer, complete with reply actions, until the later mutation arrived.
    message.isThinking === true ||
    isRuntimeOnlyMessage({
      role: message.role,
      content: message.content,
      notice: message.isSystemInfo,
    })
  ) {
    return null;
  }
  return {
    entity: CORE_SYNC_ENTITIES.message,
    entityId: message.uuid,
    kind: 'put',
    fields: {
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      context: serializeMessageContext(message),
      created_at: new Date(message.timestamp).toISOString(),
    },
  };
}

export function projectPutMutation(project: Project): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.project,
    entityId: project.id,
    kind: 'put',
    fields: {
      name: project.name,
      description: project.description,
      system_prompt: project.systemPrompt,
      icon: project.icon ?? null,
      include_memory: 1,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    },
  };
}

export function knowledgeDocumentPutMutation(
  document: KnowledgeDocumentSnapshot,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.knowledgeDocument,
    entityId: document.syncId,
    kind: 'put',
    fields: { ...createKnowledgeDocumentStateFields(document) },
  };
}

export function sharedFilePutMutation(
  file: SharedFileDescriptor,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.sharedFile,
    entityId: file.syncId,
    kind: 'put',
    fields: { ...createSharedFileStateFields(file) },
  };
}

export function deleteSyncMutation(
  entity: CoreSyncEntity,
  entityId: string,
): SyncMutation {
  return { entity, entityId, kind: 'delete' };
}

/** Core commits first; Pro optionally records the resulting canonical mutation. */
export function emitSyncMutation(mutation: SyncMutation | null): void {
  if (!mutation) return;
  try {
    callHook(HOOKS.syncRecordLocalMutation, mutation);
  } catch {
    // Sync is additive. A Pro integration failure must not roll back local data.
  }
}

export function emitChangedModelSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  for (const mutation of modelSettingMutations(before, after)) {
    emitSyncMutation(mutation);
  }
}

/**
 * Publish the mutations a COMMITTED settings save planned. Shared decided which portable keys moved
 * and encoded them once, so nothing is re-diffed here - this is the publish half of the settings
 * command's port, not a store subscriber.
 */
export function emitCommittedModelSettings(
  mutations: readonly EncodedModelSetting[],
): void {
  for (const setting of mutations) emitSyncMutation(modelSettingMutation(setting));
}
