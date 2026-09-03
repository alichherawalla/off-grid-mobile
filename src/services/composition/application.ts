/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  type OffGridApplication,
  type OffGridPlatformPorts,
} from '@offgrid/application';
import {
  isLocalRagMutation,
  knowledgeDocumentSnapshot,
  type RagEvent,
} from '@offgrid/rag';
import { generateId } from '../../utils/generateId';
import { emitKnowledgeDocumentMutation } from '../sync/knowledgeDocument';
import { registerApplicationFacade } from '../applicationFacade';
import { mobileRagEmbeddings, mobileRagExtraction, mobileRagStore, prepareMobileRagDocument } from '../adapters/rag/mobileRagPorts';
import { mobileWorkspace } from '../modelServices/workspace';

export type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
>;

export type MobileApplicationPortsFactory = () => MobileApplicationExtensionPorts;

let extensionPortsFactory: MobileApplicationPortsFactory | null = null;
let application: OffGridApplication | null = null;

/** Register optional paid-domain ports before any consumer starts the application. */
export function registerMobileApplicationPorts(factory: MobileApplicationPortsFactory): void {
  if (extensionPortsFactory === factory) return;
  if (application) {
    throw new Error('Mobile application ports must be registered before application startup.');
  }
  extensionPortsFactory = factory;
}

/** Project local RAG mutations to the optional Sync adapter. RAG owns origin and document shape. */
function forwardRagMutation(event: RagEvent): void {
  if (!isLocalRagMutation(event)) return;
  if (event.type === 'document_indexed') {
    emitKnowledgeDocumentMutation({
      kind: 'indexed',
      document: knowledgeDocumentSnapshot(event.document),
    });
  } else if (event.type === 'document_enabled') {
    emitKnowledgeDocumentMutation({
      kind: 'enabled',
      syncId: event.document.syncId,
      enabled: event.enabled,
    });
  } else if (event.type === 'document_removed') {
    emitKnowledgeDocumentMutation({
      kind: 'deleted',
      syncId: event.document.syncId,
    });
  } else if (event.type === 'project_documents_removed') {
    for (const document of event.documents) {
      emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.syncId });
    }
  }
}

function createMobileApplication(): OffGridApplication {
  const instance = createOffGridApplication({
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
  instance.rag.events(forwardRagMutation);
  return instance;
}

export function getMobileApplication(): OffGridApplication {
  application ??= createMobileApplication();
  return application;
}

registerApplicationFacade(getMobileApplication);

let starting: ReturnType<OffGridApplication['start']> | null = null;

export function startMobileApplication(): ReturnType<OffGridApplication['start']> {
  starting ??= getMobileApplication().start();
  return starting;
}

export function stopMobileApplication(): void {
  application?.stop().catch(() => undefined);
  starting = null;
}
