import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeEnv } from '../../supervisor/env-sanitizer.js';
import { findClaudeExecutable as defaultFindClaudeExecutable } from '../../shared/find-claude-executable.js';
import { logger } from '../../utils/logger.js';
import { DATA_DIR } from '../../shared/paths.js';
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
): Promise<{ available: boolean; reason?: string }> {
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
    let err = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      err += chunk.toString();
    });
    const extractReason = (stderr: string): string => {
      // Take the last non-empty stderr line; it usually carries the actual
      // exception message (e.g. "ModuleNotFoundError: No module named 'hnswlib'",
      // "Connection refused / unable to connect to Ollama", etc.).
      const lines = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^\d+$/.test(l));
      if (lines.length === 0) {
        return '';
      }
      return lines[lines.length - 1];
    };
    child.on('exit', (code, signal) => {
      if (code === 0 && out.trim().toLowerCase().startsWith('ok')) {
        resolve({ available: true });
      } else {
        const stderr = err.trim();
        const reason = stderr ? extractReason(stderr) : undefined;
        resolve({
          available: false,
          reason: reason
            ? `${pythonBin} -c "import hnswlib, numpy" failed: ${reason}`
            : undefined,
        });
        if (signal) {
          logger.warn('WORKER', 'HNSW helper probe terminated by signal', {
            signal,
          });
        }
      }
    });
    child.on('error', (error: Error) => {
      resolve({
        available: false,
        reason: `Failed to spawn ${pythonBin}: ${error.message}`,
      });
    });
  });
}

/**
 * Read the global helper-unavailable status file the Python helper writes when
 * it can't even load its own imports (top-level import failure). Returns a
 * short human reason, or undefined if the helper is healthy / no marker exists.
 */
function readHnswHelperGlobalFailure(): string | undefined {
  const statusPath = join(DATA_DIR, 'hnswlib', 'hnswlib-helper-unavailable.json');
  if (!existsSync(statusPath)) {
    return undefined;
  }
  try {
    const payload = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
      reason?: string;
      stderr_tail?: string;
    };
    return payload.reason || payload.stderr_tail || 'helper unavailable';
  } catch {
    return undefined;
  }
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
    const result = await hnswHelperIsAvailable(options);
    if (result.available) {
      clearDependencyStatus('hnsw_helper');
    } else {
      const pythonBin =
        options.pythonBin ??
        (options.platform === 'win32' ? 'python.exe' : 'python3');
      // The helper writes a global status file when it can't even load its
      // own imports (top-level import failure) — an all-or-nothing failure
      // affecting every record, not just one sqlite_id. Surface it explicitly
      // so the diagnostics tab says "index build cannot run" rather than the
      // misleading "未向量化" badge on every record.
      const globalFail = readHnswHelperGlobalFailure();
      const buildBlocker = globalFail
        ? ` ⚠️ index build cannot run: ${globalFail}`
        : '';
      const reasonPart = result.reason
        ? ` ${result.reason}.`
        : ` ${pythonBin} -c "import hnswlib, numpy" failed.`;
      recordHnswVectorSearchUnavailable(
        `HNSW vector-search helper not available via ${pythonBin};` +
          reasonPart +
          buildBlocker +
          ' Install the packages and restart llm-mem.',
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
