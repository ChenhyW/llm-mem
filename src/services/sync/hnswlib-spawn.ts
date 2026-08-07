/**
 * Spawns the hnswlib-vector-search.py helper (a node-friendly wrapper around
 * `node:child_process.spawn`). This keeps the worker bundle free of native
 * bindings while still speaking hnswlib + Ollama embeddings.
 */
import type { Buffer as NodeBuffer } from 'node:buffer';

export async function spawnHnswHelper(
  args: string[],
  envOverrides?: Record<string, string | undefined>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const scriptPath = resolveScriptPath();
    const { spawn } = require('child_process');
    const child = spawn('python3', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...filterEnv(envOverrides),
      },
      shell: false,
      timeout: 0,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: NodeBuffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: NodeBuffer | string) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on('error', (err: Error) => {
      resolve({ stdout, stderr: String(err), exitCode: -1 });
    });
  });
}

function filterEnv(
  envOverrides?: Record<string, string | undefined>,
): Record<string, string> {
  if (!envOverrides) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function resolveScriptPath(): string {
  // At runtime the helper ships next to the worker bundle inside plugin/scripts.
  const candidate = resolveSiblingScriptPath('hnswlib-vector-search.py');
  if (candidate) return candidate;
  throw new Error(
    'hnswlib-vector-search.py helper script not found on PATH/PLUGIN_ROOT. ' +
      'Ensure it is shipped inside plugin/scripts/.'
  );
}

function resolveSiblingScriptPath(scriptName: string): string | undefined {
  const { PluginRoot } = tryResolvePluginRoot();
  if (PluginRoot) return require('path').join(PluginRoot, 'scripts', scriptName);
  return undefined;
}

function tryResolvePluginRoot(): { PluginRoot: string | undefined } {
  const envPaths = [
    process.env.LLM_MEM_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    process.env.PLUGIN_ROOT,
  ].filter(Boolean) as string[];

  for (const p of envPaths) {
    try {
      const { existsSync } = require('fs');
      if (existsSync(p) && existsSync(require('path').join(p, 'scripts'))) {
        return { PluginRoot: p };
      }
    } catch {
      // continue
    }
  }

  // Walk up from the currently running script file to find the plugin root
  // containing plugin/scripts.
  try {
    const { fileURLToPath } = require('url');
    const { dirname, join, basename } = require('path');
    const { existsSync } = require('fs');
    let dir = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    while (dir && dir !== '/') {
      if (existsSync(join(dir, 'plugin', 'scripts', 'worker-service.cjs')) ||
          existsSync(join(dir, 'plugin', 'scripts', 'worker-service.js')) ||
          (existsSync(join(dir, 'scripts')) && basename(dir) === 'plugin')) {
        return { PluginRoot: dir === '/' ? dir : dir };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { PluginRoot: undefined };
  } catch {
    return { PluginRoot: undefined };
  }
}

export function getHnswDir(): string {
  const base = resolveDataDir();
  return require('path').join(base, 'hnswlib');
}

function resolveDataDir(): string {
  const { expandHome } = tryRequireSharedPaths();
  const fromEnv = (process.env.LLM_MEM_DATA_DIR || '').trim();
  if (fromEnv) return typeof expandHome === 'function' ? expandHome(fromEnv) : fromEnv;
  const { resolveDataDir: sharedResolve } = tryRequireSharedPaths();
  if (typeof sharedResolve === 'function') return sharedResolve();
  const { join } = require('path');
  const { homedir } = require('os');
  return join(homedir(), '.llm-mem');
}

function tryRequireSharedPaths() {
  try {
    return require('../shared/paths.js');
  } catch {
    return {};
  }
}
