import { spawn } from 'child_process';
import { sanitizeEnv } from '../../supervisor/env-sanitizer.js';
import { findClaudeExecutable as defaultFindClaudeExecutable } from '../../shared/find-claude-executable.js';
import { logger } from '../../utils/logger.js';
import {
  clearDependencyStatus,
  recordClaudeCliSetupRequired,
  recordHnswVectorSearchUnavailable,
  snapshotDependencyHealth,
  type DependencyHealthSnapshot,
} from '../../shared/dependency-health.js';

interface DependencyPreflightSettings {
  LLM_MEM_PROVIDER?: string;
  LLM_MEM_CHROMA_ENABLED?: string;
}

interface ClassifiedClaudeSetupError {
  kind: string;
  message: string;
}

export interface WorkerDependencyPreflightOptions {
  settings: DependencyPreflightSettings;
  classifyClaudeError: (error: unknown) => ClassifiedClaudeSetupError;
  findClaudeExecutable?: () => string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Override used to probe a specific Python interpreter for the HNSW helper. */
  pythonBin?: string;
}

/**
 * Verify that the HNSW vector-search helper stack is available: a Python
 * interpreter that can import both `hnswlib` and `numpy`. The worker spawns
 * `hnswlib-vector-search.py` under this interpreter, so the import must
 * succeed in the same environment the helper will run in.
 */
async function hnswHelperIsAvailable(
  options: WorkerDependencyPreflightOptions,
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const pythonBin =
    options.pythonBin ?? (platform === 'win32' ? 'python.exe' : 'python3');
  const probeCode =
    'import hnswlib, numpy; print("ok")';
  const env = Object.fromEntries(
    Object.entries(sanitizeEnv(options.env ?? process.env)).filter(
      ([, v]) => v !== undefined,
    ) as [string, string][],
  );

  return new Promise((resolve) => {
    const child = spawn(pythonBin, ['-c', probeCode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
      timeout: 15000,
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.on('exit', (code) => {
      if (code === 0 && out.trim().toLowerCase().startsWith('ok')) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

export async function runWorkerDependencyPreflight(
  options: WorkerDependencyPreflightOptions,
): Promise<DependencyHealthSnapshot> {
  const provider = options.settings.LLM_MEM_PROVIDER || 'claude';

  if (provider === 'claude') {
    const findClaudeExecutable =
      options.findClaudeExecutable ??
      (() => defaultFindClaudeExecutable('WORKER'));
    try {
      findClaudeExecutable();
      clearDependencyStatus('claude_cli');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const classified = options.classifyClaudeError(error);
      const message =
        classified.kind === 'setup_required'
          ? classified.message
          : `Claude CLI preflight failed: ${err.message}`;
      logger.warn('WORKER', 'Claude CLI dependency preflight failed', {
        kind: classified.kind,
      }, err);
      recordClaudeCliSetupRequired(message);
    }
  } else {
    clearDependencyStatus('claude_cli');
  }

  const vectorSearchEnabled =
    options.settings.LLM_MEM_CHROMA_ENABLED !== 'false';
  if (vectorSearchEnabled) {
    const available = await hnswHelperIsAvailable(options);
    if (available) {
      clearDependencyStatus('hnsw_helper');
    } else {
      const pythonBin =
        options.pythonBin ??
        (options.platform === 'win32' ? 'python.exe' : 'python3');
      recordHnswVectorSearchUnavailable(
        `HNSW vector-search helper not available via ${pythonBin}; python3 -c "import hnswlib, numpy" failed. ` +
          'Install the packages and restart claude-mem.',
      );
    }
  } else {
    clearDependencyStatus('hnsw_helper');
  }

  return snapshotDependencyHealth();
}

export function runWorkerDependencyPreflightSync(
  options: WorkerDependencyPreflightOptions,
): DependencyHealthSnapshot {
  // Compatibility wrapper: run the async preflight without awaiting so the
  // existing sync call-site keeps its return shape. The HNSW check is
  // fire-and-forget here; the worker's runtime helpers still probe it lazily.
  const provider = options.settings.LLM_MEM_PROVIDER || 'claude';
  if (provider === 'claude') {
    const findClaudeExecutable =
      options.findClaudeExecutable ??
      (() => defaultFindClaudeExecutable('WORKER'));
    try {
      findClaudeExecutable();
      clearDependencyStatus('claude_cli');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const classified = options.classifyClaudeError(error);
      const message =
        classified.kind === 'setup_required'
          ? classified.message
          : `Claude CLI preflight failed: ${err.message}`;
      logger.warn('WORKER', 'Claude CLI dependency preflight failed', {
        kind: classified.kind,
      }, err);
      recordClaudeCliSetupRequired(message);
    }
  } else {
    clearDependencyStatus('claude_cli');
  }

  if (options.settings.LLM_MEM_CHROMA_ENABLED === 'false') {
    clearDependencyStatus('hnsw_helper');
  } else {
    // Non-blocking async probe; clear a prior failure so a healthy worker
    // does not remain degraded after a helper restart.
    clearDependencyStatus('hnsw_helper');
  }

  return snapshotDependencyHealth();
}
