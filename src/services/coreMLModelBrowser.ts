export interface CoreMLModelFile {
  path: string;
  relativePath: string;
  size: number;
  downloadUrl: string;
}

export interface CoreMLImageModel {
  id: string;
  name: string;
  displayName: string;
  backend: 'coreml';
  downloadUrl: string;
  fileName: string;
  size: number;
  repo: string;
  /** For multi-file models (no zip), individual files to download */
  files?: CoreMLModelFile[];
}

interface HFTreeEntry {
  type: string;
  path: string;
  size: number;
  lfs?: { oid: string; size: number; pointerSize: number };
}

// All Apple Core ML Stable Diffusion repos.
// Palettized = 6-bit quantized, ~50% smaller, have ZIP downloads.
// Full precision = larger but higher quality, multi-file download required.
// SDXL iOS = 4-bit mixed-bit palettized, 768×768, ANE-optimized.
const REPOS: { repo: string; name: string; description: string }[] = [
  {
    repo: 'apple/coreml-stable-diffusion-v1-5-palettized',
    name: 'SD 1.5 Palettized',
    description: '6-bit quantized, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-2-1-base-palettized',
    name: 'SD 2.1 Palettized',
    description: '6-bit quantized, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-xl-base-ios',
    name: 'SDXL (iOS)',
    description: '4-bit quantized, 768×768, ANE-optimized',
  },
  {
    repo: 'apple/coreml-stable-diffusion-v1-5',
    name: 'SD 1.5',
    description: 'Full precision, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-2-1-base',
    name: 'SD 2.1 Base',
    description: 'Full precision, 512×512',
  },
];

let cachedModels: CoreMLImageModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchRepoTree(repo: string, path = ''): Promise<HFTreeEntry[]> {
  const url = path
    ? `https://huggingface.co/api/models/${repo}/tree/main/${path}`
    : `https://huggingface.co/api/models/${repo}/tree/main`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${repo}: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Finds a zip archive in the repo that contains compiled split_einsum models.
 * Palettized repos have: *_split_einsum_v2_compiled.zip
 * SDXL iOS has: *_split_einsum_compiled.zip
 * Returns the zip entry or null.
 */
function findCompiledZip(entries: HFTreeEntry[]): HFTreeEntry | null {
  // Prefer split_einsum_v2 (palettized), then split_einsum (SDXL iOS)
  const v2Zip = entries.find(
    (e) =>
      e.type === 'file' &&
      e.path.endsWith('.zip') &&
      e.path.includes('split_einsum') &&
      e.path.includes('compiled'),
  );
  return v2Zip || null;
}

/**
 * Recursively enumerate all files under a path. Subdirectories fetched in parallel.
 */
async function enumerateFiles(
  repo: string,
  dirPath: string,
  basePath: string,
  maxDepth = 4,
): Promise<CoreMLModelFile[]> {
  if (maxDepth <= 0) return [];
  const entries = await fetchRepoTree(repo, dirPath);
  const files: CoreMLModelFile[] = [];
  const dirPromises: Promise<CoreMLModelFile[]>[] = [];

  for (const entry of entries) {
    if (entry.type === 'file') {
      const relativePath = entry.path.startsWith(basePath + '/')
        ? entry.path.slice(basePath.length + 1)
        : entry.path;
      files.push({
        path: entry.path,
        relativePath,
        size: entry.lfs?.size ?? entry.size ?? 0,
        downloadUrl: `https://huggingface.co/${repo}/resolve/main/${entry.path}`,
      });
    } else if (entry.type === 'directory') {
      if (entry.path.endsWith('/analytics')) continue;
      dirPromises.push(enumerateFiles(repo, entry.path, basePath, maxDepth - 1));
    }
  }

  const subResults = await Promise.all(dirPromises);
  for (const sub of subResults) {
    files.push(...sub);
  }
  return files;
}

async function fetchModelFromRepo(
  repoInfo: (typeof REPOS)[number],
): Promise<CoreMLImageModel | null> {
  const { repo, name } = repoInfo;
  const topLevel = await fetchRepoTree(repo);
  const id = `coreml_${repo.replace(/\//g, '_')}`;

  // Strategy 1: Look for a zip archive (palettized + SDXL iOS repos)
  const zipEntry = findCompiledZip(topLevel);
  if (zipEntry) {
    const size = zipEntry.lfs?.size ?? zipEntry.size ?? 0;
    return {
      id,
      name,
      displayName: `${name} (Core ML)`,
      backend: 'coreml',
      downloadUrl: `https://huggingface.co/${repo}/resolve/main/${zipEntry.path}`,
      fileName: zipEntry.path,
      size,
      repo,
    };
  }

  // Strategy 2: Multi-file download from split_einsum/compiled directory
  const variantDir = topLevel.find(
    (e) => e.type === 'directory' && e.path === 'split_einsum',
  );
  if (!variantDir) return null;

  const subEntries = await fetchRepoTree(repo, variantDir.path);
  const compiledDir = subEntries.find(
    (e) => e.type === 'directory' && e.path === 'split_einsum/compiled',
  );
  if (!compiledDir) return null;

  const files = await enumerateFiles(repo, compiledDir.path, compiledDir.path);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    id,
    name,
    displayName: `${name} (Core ML)`,
    backend: 'coreml',
    downloadUrl: `https://huggingface.co/${repo}/tree/main/${compiledDir.path}`,
    fileName: compiledDir.path,
    size: totalSize,
    repo,
    files,
  };
}

export async function fetchAvailableCoreMLModels(
  forceRefresh = false,
): Promise<CoreMLImageModel[]> {
  if (!forceRefresh && cachedModels && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedModels;
  }

  const models: CoreMLImageModel[] = [];

  const results = await Promise.allSettled(
    REPOS.map(async (repoInfo) => {
      const model = await fetchModelFromRepo(repoInfo);
      if (model) {
        models.push(model);
      }
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[CoreMLBrowser] Failed to fetch ${REPOS[i].repo}:`, r.reason);
    }
  });

  cachedModels = models;
  cacheTimestamp = Date.now();
  return models;
}
