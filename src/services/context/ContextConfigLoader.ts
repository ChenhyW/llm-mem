
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import { ModeManager } from '../domain/ModeManager.js';
import type { ContextConfig } from './types.js';

export function loadContextConfig(): ContextConfig {
  const settingsPath = paths.settings();
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

  const mode = ModeManager.getInstance().getActiveMode();
  const observationTypes = new Set(mode.observation_types.map(t => t.id));
  const observationConcepts = new Set(mode.observation_concepts.map(c => c.id));

  return {
    totalObservationCount: parseInt(settings.LLM_MEM_CONTEXT_OBSERVATIONS, 10),
    fullObservationCount: parseInt(settings.LLM_MEM_CONTEXT_FULL_COUNT, 10),
    sessionCount: parseInt(settings.LLM_MEM_CONTEXT_SESSION_COUNT, 10),
    showReadTokens: settings.LLM_MEM_CONTEXT_SHOW_READ_TOKENS === 'true',
    showWorkTokens: settings.LLM_MEM_CONTEXT_SHOW_WORK_TOKENS === 'true',
    showSavingsAmount: settings.LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT === 'true',
    showSavingsPercent: settings.LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT === 'true',
    observationTypes,
    observationConcepts,
    fullObservationField: settings.LLM_MEM_CONTEXT_FULL_FIELD as 'narrative' | 'facts',
    showLastSummary: settings.LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY === 'true',
    showLastMessage: settings.LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE === 'true',
  };
}
