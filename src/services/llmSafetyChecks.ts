import { LlamaContext } from 'llama.rn';
import {
  estimateTextLoadMemory,
  isNativeInferenceFailure,
  modelMemoryFit,
  planSafeContext,
} from '@offgrid/models';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import logger from '../utils/logger';
import { OverridableMemoryError } from '../utils/modelLoadErrors';

/**
 * GGUF magic number — first 4 bytes of every valid GGUF file.
 * Used to detect corrupted or truncated model files before loading.
 */
const GGUF_MAGIC = 'GGUF';

/** Minimum plausible GGUF file size (header + at least some tensors) */
const MIN_GGUF_FILE_SIZE = 1024; // 1 KB

function decodeLittleEndianUint32(bytes: string): number | null {
  if (bytes.length < 4) return null;
  const byteValues = Array.from(bytes)
    .slice(0, 4)
    .map(char => char.charCodeAt(0));
  return byteValues.reduce(
    (sum, value, index) => sum + value * 256 ** index,
    0,
  );
}

/**
 * Validate that a model file is a plausible GGUF file.
 * Checks magic bytes and minimum file size to catch corrupted/truncated downloads.
 */
export async function validateModelFile(
  modelPath: string,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const facts = await statFile(modelPath);
    if (!facts) {
      return { valid: false, reason: `Model file not found at: ${modelPath}` };
    }
    if (!facts.isFile) {
      return { valid: false, reason: `Model path is not a file: ${modelPath}` };
    }
    const fileSize = facts.size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    logger.log(`[LLM] Validating model: ${modelPath}`);
    logger.log(`[LLM] Model file size: ${fileSizeMB}MB (${fileSize} bytes)`);
    if (fileSize < MIN_GGUF_FILE_SIZE) {
      return {
        valid: false,
        reason: `Model file too small (${fileSize} bytes) — likely corrupted or incomplete download`,
      };
    }
    // Read first 4 bytes to check GGUF magic number.
    // RNFS.read() has an iOS bridging bug with NSInteger arguments on
    // react-native-fs 2.x, so we catch and skip the magic check if it fails.
    // llama.rn will still validate the file format natively on load.
    let header: string | undefined;
    try {
      header = await RNFS.read(modelPath, 4, 0, 'ascii');
    } catch (readErr) {
      logger.warn(
        '[LLM] RNFS.read() failed for magic check, skipping header validation:',
        readErr,
      );
    }
    if (header !== undefined && !header.startsWith(GGUF_MAGIC)) {
      return {
        valid: false,
        reason: `Invalid model file — not a GGUF file (header: ${header})`,
      };
    }
    if (header !== undefined) {
      logger.log(`[LLM] GGUF magic OK`);
    }
    // Try to read GGUF version (bytes 4-7, little-endian uint32)
    try {
      const versionBytes = await RNFS.read(modelPath, 4, 4, 'ascii');
      if (versionBytes) {
        const version = decodeLittleEndianUint32(versionBytes);
        if (version !== null) logger.log(`[LLM] GGUF version: ${version}`);
      }
    } catch (_e) {
      // Non-critical, just skip
    }
    // Log the model filename for easier identification
    const filename = modelPath.split('/').pop() || modelPath;
    logger.log(`[LLM] Model filename: ${filename}`);
    return { valid: true };
  } catch (e: any) {
    return {
      valid: false,
      reason: `Failed to validate model file: ${e?.message || e}`,
    };
  }
}

export interface MemoryCheckArgs {
  modelFileSize: number;
  contextLength: number;
  getAvailableMemory: () => Promise<{ available: number; total: number }>;
  quantizedCache?: boolean;
}

export async function checkMemoryForModel(
  args: MemoryCheckArgs,
): Promise<{
  safe: boolean;
  reason?: string;
  estimatedMB: number;
  availableMB: number;
}> {
  const { contextLength, getAvailableMemory } = args;
  try {
    const { available, total } = await getAvailableMemory();
    const availableMB = available / (1024 * 1024);
    const totalMB = total / (1024 * 1024);
    const fit = modelMemoryFit(memoryEstimate(args, contextLength), {
      availableMB,
      totalMB,
    });
    logger.log(
      `[MEM-SM] checkMemoryForModel estMB=${Math.round(
        fit.estimatedMB,
      )} availMB=${Math.round(availableMB)} ctx=${contextLength} safe=${fit.safe}`,
    );
    if (!fit.safe) {
      return {
        safe: false,
        reason: `Not enough memory: model needs ~${Math.round(
          fit.estimatedMB,
        )}MB but only ${Math.round(
          availableMB,
        )}MB available (device total: ${Math.round(
          totalMB,
        )}MB). Try closing other apps or using a smaller model.`,
        estimatedMB: fit.estimatedMB,
        availableMB,
      };
    }
    return { safe: true, estimatedMB: fit.estimatedMB, availableMB };
  } catch (e: any) {
    // If we can't check memory, proceed anyway but log a warning
    logger.warn('[LLM] Could not check available memory:', e?.message || e);
    return { safe: true, estimatedMB: 0, availableMB: 0 };
  }
}

function memoryEstimate(
  args: Pick<MemoryCheckArgs, 'modelFileSize' | 'quantizedCache'>,
  contextLength: number,
) {
  const cacheType = args.quantizedCache ? 'q8_0' : 'f16';
  return estimateTextLoadMemory({
    weightsBytes: args.modelFileSize,
    contextLength,
    batchSize: 512,
    keyCacheType: cacheType,
    valueCacheType: cacheType,
  });
}

/**
 * Find the largest context that fits available memory, stepping down from the
 * requested size. Throws only when the model weights alone exceed available RAM
 * (a load that would certainly crash the allocator); otherwise proceeds at the
 * smallest context, since the estimate is intentionally conservative.
 *
 * Extracted from LLMService to keep llm.ts under the max-lines limit; behavior is
 * unchanged. `getAvailableMemory` is passed in so this stays free of the hardware dep.
 */
export async function resolveSafeContext(args: {
  fileSize: number;
  requestedCtx: number;
  quantizedCache: boolean;
  override?: boolean;
  getAvailableMemory: () => Promise<{ available: number; total: number }>;
}): Promise<{
  ctxLen: number;
  memCheck: Awaited<ReturnType<typeof checkMemoryForModel>>;
}> {
  const {
    fileSize,
    requestedCtx,
    quantizedCache,
    override = false,
    getAvailableMemory: getMem,
  } = args;
  let memory: { available: number; total: number };
  try {
    memory = await getMem();
  } catch (error: any) {
    logger.warn('[LLM] Could not check available memory:', error?.message || error);
    return {
      ctxLen: requestedCtx,
      memCheck: { safe: true, estimatedMB: 0, availableMB: 0 },
    };
  }
  const plan = planSafeContext({
    estimate: contextLength => memoryEstimate(
      { modelFileSize: fileSize, quantizedCache },
      contextLength,
    ),
    memory: {
      availableMB: memory.available / (1024 * 1024),
      totalMB: memory.total / (1024 * 1024),
    },
    requestedContextLength: requestedCtx,
  });
  const finalCheck = {
    safe: plan.fit.safe,
    estimatedMB: plan.fit.estimatedMB,
    availableMB: plan.fit.availableMB,
  };
  if (plan.fit.safe) {
    logger.warn(
      `[LLM] Memory tight — reducing context ${requestedCtx} → ${plan.contextLength} (~${finalCheck.estimatedMB.toFixed(
        0,
      )}MB of ${finalCheck.availableMB.toFixed(0)}MB available)`,
    );
    return { ctxLen: plan.contextLength, memCheck: finalCheck };
  }
  logger.log(
    `[MEM-SM] resolveSafeContext gate availMB=${Math.round(
      finalCheck.availableMB,
    )} override=${override} weightsExceedAvail=${plan.weightsExceedAvailable}`,
  );
  if (plan.weightsExceedAvailable && !override) {
    throw new OverridableMemoryError(
      `Not enough memory to load this model: it needs ~${Math.round(
        fileSize * 1.2 / (1024 * 1024),
      )}MB but only ${Math.round(
        finalCheck.availableMB,
      )}MB is available. Close other apps or choose a smaller model.`,
    );
  }
  if (override && plan.weightsExceedAvailable) {
    logger.warn(
      `[LLM] OVERRIDE — proceeding despite tight memory (~${Math.round(
        fileSize * 1.2 / (1024 * 1024),
      )}MB needed, ${Math.round(finalCheck.availableMB)}MB free)`,
    );
  }
  logger.warn(
    `[LLM] Memory very tight — proceeding at minimum context ${plan.contextLength} (estimate may be conservative)`,
  );
  return { ctxLen: plan.contextLength, memCheck: finalCheck };
}

/**
 * Wraps a llama.rn completion call with error handling for native crashes.
 * Catches ggml_abort and OOM-style errors and returns a structured error
 * instead of letting the app crash unrecoverably.
 */
export async function safeCompletion<T>(
  context: LlamaContext,
  completionFn: () => Promise<T>,
  label: string = 'completion',
): Promise<T> {
  try {
    return await completionFn();
  } catch (error: any) {
    const msg = error?.message || String(error) || '';
    const isNativeCrash = isNativeInferenceFailure(error);
    if (isNativeCrash) {
      logger.error(`[LLM] Native crash during ${label}: ${msg}`);
      // Try to recover the context by clearing KV cache
      try {
        await (context as any).clearCache(true);
        logger.log(`[LLM] KV cache cleared after native error in ${label}`);
      } catch (clearError) {
        logger.warn(
          `[LLM] Failed to clear KV cache after crash: ${clearError}`,
        );
      }
      throw new Error(
        `Model inference failed (native error). The model's KV cache has been cleared. Please try again, or use a smaller model/context size. (${msg})`,
      );
    }
    throw error;
  }
}
