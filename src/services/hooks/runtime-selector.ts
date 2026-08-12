// SPDX-License-Identifier: Apache-2.0
//
// Phase 7 — Runtime selector for hook subcommands.
//
// The Postgres/BullMQ server runtime has been removed. We always resolve to
// the worker runtime so hooks take the worker fallback path unconditionally.
// The legacy `selectRuntime` / `resolveRuntimeContext` contract is preserved
// for back-compat with callers (CLI handlers, mcp-server) — they never see
// 'server' and never branch into server-only code.

import { logger } from '../../utils/logger.js';

export type SelectedRuntime = string;

export interface ServerRuntimeContext {
  runtime: 'server';
  client: any;
  projectId: string;
  serverBaseUrl: string;
}

export interface WorkerRuntimeContext {
  runtime: 'worker';
}

export type RuntimeContext = ServerRuntimeContext | WorkerRuntimeContext;

export function selectRuntime(): SelectedRuntime {
  return 'worker';
}

export function buildServerContext(): ServerRuntimeContext | null {
  logger.warn('HOOK', '[server-fallback] reason=runtime_removed (server mode no longer supported)');
  return null;
}

export function resolveRuntimeContext(): RuntimeContext {
  return { runtime: 'worker' };
}

export function logServerFallback(_reason: string, _details?: Record<string, unknown>): void {
  // no-op — server mode no longer exists; nothing to fall back from.
}
