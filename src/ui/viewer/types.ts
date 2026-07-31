export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project?: string | null;
  platform_source: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface Summary {
  id: number;
  session_id: string;
  project: string;
  platform_source: string;
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  next_steps?: string;
  created_at_epoch: number;
}

export interface UserPrompt {
  id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

export type FeedItem =
  | (Observation & { itemType: 'observation' })
  | (Summary & { itemType: 'summary' })
  | (UserPrompt & { itemType: 'prompt' });

export interface StreamEvent {
  type: 'initial_load' | 'new_observation' | 'new_summary' | 'new_prompt' | 'processing_status';
  observations?: Observation[];
  summaries?: Summary[];
  prompts?: UserPrompt[];
  projects?: string[];
  observation?: Observation;
  summary?: Summary;
  prompt?: UserPrompt;
  isProcessing?: boolean;
  queueDepth?: number;
}

export interface ProjectCatalog {
  projects: string[];
  sources: string[];
  projectsBySource: Record<string, string[]>;
}

export interface Settings {
  LLM_MEM_MODEL: string;
  LLM_MEM_CONTEXT_OBSERVATIONS: string;
  LLM_MEM_WORKER_PORT: string;
  LLM_MEM_WORKER_HOST: string;

  LLM_MEM_PROVIDER?: string;
  LLM_MEM_CLAUDE_AUTH_METHOD?: string;
  LLM_MEM_GEMINI_API_KEY?: string;
  LLM_MEM_GEMINI_MODEL?: string;
  LLM_MEM_GEMINI_RATE_LIMITING_ENABLED?: string;
  LLM_MEM_OPENROUTER_API_KEY?: string;
  LLM_MEM_OPENROUTER_MODEL?: string;
  LLM_MEM_OPENROUTER_SITE_URL?: string;
  LLM_MEM_OPENROUTER_APP_NAME?: string;
  LLM_MEM_DATA_DIR?: string;
  LLM_MEM_LOG_LEVEL?: string;
  LLM_MEM_PYTHON_VERSION?: string;
  LLM_MEM_OLLAMA_URL?: string;
  LLM_MEM_VECTOR_EMBEDDING_MODEL?: string;
  LLM_MEM_DISABLE_VECTOR_SEARCH?: string;

  LLM_MEM_CONTEXT_SHOW_READ_TOKENS?: string;
  LLM_MEM_CONTEXT_SHOW_WORK_TOKENS?: string;
  LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT?: string;
  LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT?: string;
  LLM_MEM_CONTEXT_FULL_COUNT?: string;
  LLM_MEM_CONTEXT_FULL_FIELD?: string;
  LLM_MEM_CONTEXT_SESSION_COUNT?: string;
  LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY?: string;
  LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE?: string;
  LLM_MEM_FOLDER_CLAUDEMD_ENABLED?: string;
  LLM_MEM_WELCOME_HINT_ENABLED?: string;
  LLM_MEM_TELEGRAM_ENABLED?: string;
  LLM_MEM_TELEGRAM_BOT_TOKEN?: string;
  LLM_MEM_TELEGRAM_CHAT_ID?: string;
}

export interface DependencyStatus {
  name: string;
  kind: 'ok' | 'setup_required' | 'vector_search_unavailable' | 'vector_helper_unavailable';
  message?: string;
}
