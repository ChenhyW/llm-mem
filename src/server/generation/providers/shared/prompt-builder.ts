// SPDX-License-Identifier: Apache-2.0
//
// buildServerGenerationPrompt — prompt construction for the server (Postgres/
// BullMQ) generation mode providers.
//
// NOTE (placeholder): the server-generation mode is being retired. The original
// implementation of this file was never committed to git (the module was always
// referenced by Claude/Gemini/OpenRouter ObservationProviders but never
// present), so the build previously failed with a missing-module error. This
// file exists solely to resolve that orphan import so `npm run build` succeeds
// for the worker bundle. Server-mode generation is inert in production: it
// returns an empty prompt so no provider call is billed. Restore a real
// implementation only if server-mode is revived.

import type { ServerGenerationContext } from './types.js';

interface BuildServerGenerationPromptResult {
  prompt: string;
  skippedAll: boolean;
}

export function buildServerGenerationPrompt(
  _context: ServerGenerationContext
): BuildServerGenerationPromptResult {
  return { prompt: '', skippedAll: false };
}