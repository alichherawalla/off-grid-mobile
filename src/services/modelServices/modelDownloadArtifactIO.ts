import type {
  DownloadFilePort,
  DownloadFinalizationTransaction,
  DownloadTransferPort,
  PersistedModelDownload,
} from '@offgrid/models';

type TransferStart = Parameters<DownloadTransferPort['start']>[0];
type TransferAttach = Parameters<NonNullable<DownloadTransferPort['attach']>>[0];

/**
 * One optional platform-managed artifact strategy, supplied before application composition.
 * It owns only native I/O. Queueing, retry, persistence, and projection stay in ModelsFacade.
 */
export interface MobileManagedArtifactIO {
  ownsArtifact(id: string): boolean;
  ownsTransfer(transferId: string): boolean;
  ownsPath(path: string): boolean;
  ownsModel(modelId: string): boolean;
  start(input: TransferStart): Promise<{ transferId?: string }>;
  attach?(input: TransferAttach): Promise<void>;
  isActive?(transferId: string): Promise<boolean>;
  cancel?(transferId: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  remove(path: string): Promise<void>;
  removeModel(modelId: string): Promise<void>;
  beginFinalization(download: Readonly<PersistedModelDownload>): Promise<DownloadFinalizationTransaction>;
  recoverFinalization(input: {
    download: Readonly<PersistedModelDownload>;
    state: string;
    disposition: 'rollback' | 'commit';
  }): Promise<void>;
}

export function compositeDownloadTransferPort(
  native: DownloadTransferPort,
  managed?: MobileManagedArtifactIO,
): DownloadTransferPort {
  return {
    start: input => managed?.ownsArtifact(input.id)
      ? managed.start(input)
      : native.start(input),
    attach: async input => {
      if (managed?.ownsTransfer(input.transferId)) {
        if (!managed.attach) throw new Error('This managed download cannot attach after restart.');
        await managed.attach(input);
        return;
      }
      if (!native.attach) throw new Error('This native download cannot attach after restart.');
      await native.attach(input);
    },
    isActive: transferId => managed?.ownsTransfer(transferId)
      ? managed.isActive?.(transferId) ?? Promise.resolve(false)
      : native.isActive?.(transferId) ?? Promise.resolve(false),
    cancel: async transferId => {
      if (managed?.ownsTransfer(transferId)) {
        if (!managed.cancel) throw new Error('This managed download cannot be cancelled.');
        await managed.cancel(transferId);
        return;
      }
      if (native.cancel) await native.cancel(transferId);
    },
  };
}

export function compositeDownloadFilePort(
  native: DownloadFilePort,
  managed?: MobileManagedArtifactIO,
): DownloadFilePort {
  return {
    pathFor: localName => native.pathFor(localName),
    exists: path => managed?.ownsPath(path) ? managed.exists(path) : native.exists(path),
    size: path => managed?.ownsPath(path) ? managed.size(path) : native.size(path),
    readPrefix: native.readPrefix
      ? (path, bytes) => native.readPrefix!(path, bytes)
      : undefined,
    sha256: native.sha256
      ? path => native.sha256!(path)
      : undefined,
    remove: path => managed?.ownsPath(path) ? managed.remove(path) : native.remove(path),
  };
}
