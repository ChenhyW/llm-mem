
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, hostname } from 'os';
import { HOOK_TIMEOUTS, getTimeout } from './hook-constants.js';
import { parseJsonWithBom, writeJsonFileAtomic } from './atomic-json.js';

export interface SettingsDefaults {
  LLM_MEM_MODEL: string;
  LLM_MEM_CONTEXT_OBSERVATIONS: string;
  LLM_MEM_WORKER_PORT: string;
  LLM_MEM_WORKER_HOST: string;
  LLM_MEM_API_TIMEOUT_MS: string;
  LLM_MEM_SKIP_TOOLS: string;
  LLM_MEM_PROVIDER: string;  
  LLM_MEM_CLAUDE_AUTH_METHOD: string;  
  LLM_MEM_GEMINI_API_KEY: string;
  LLM_MEM_GEMINI_MODEL: string;  
  LLM_MEM_GEMINI_RATE_LIMITING_ENABLED: string;
  LLM_MEM_OPENROUTER_API_KEY: string;
  LLM_MEM_OPENROUTER_MODEL: string;
  LLM_MEM_OPENROUTER_BASE_URL: string;
  LLM_MEM_OPENROUTER_SITE_URL: string;
  LLM_MEM_OPENROUTER_APP_NAME: string;
  LLM_MEM_DATA_DIR: string;
  LLM_MEM_LOG_LEVEL: string;
  LLM_MEM_PYTHON_VERSION: string;
  CLAUDE_CODE_PATH: string;
  LLM_MEM_MODE: string;
  LLM_MEM_CONTEXT_SHOW_READ_TOKENS: string;
  LLM_MEM_CONTEXT_SHOW_WORK_TOKENS: string;
  LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: string;
  LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: string;
  LLM_MEM_CONTEXT_FULL_COUNT: string;
  LLM_MEM_CONTEXT_FULL_FIELD: string;
  LLM_MEM_CONTEXT_SESSION_COUNT: string;
  LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY: string;
  LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE: string;
  LLM_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: string;
  LLM_MEM_WELCOME_HINT_ENABLED: string;
  LLM_MEM_FOLDER_CLAUDEMD_ENABLED: string;
  LLM_MEM_FOLDER_USE_LOCAL_MD: string;  
  LLM_MEM_TRANSCRIPTS_ENABLED: string;  
  LLM_MEM_TRANSCRIPTS_CONFIG_PATH: string;  
  LLM_MEM_CODEX_TRANSCRIPT_INGESTION: string;
  LLM_MEM_MAX_CONCURRENT_AGENTS: string;  
  LLM_MEM_HOOK_FAIL_LOUD_THRESHOLD: string;  
  LLM_MEM_EXCLUDED_PROJECTS: string;  
  LLM_MEM_FOLDER_MD_EXCLUDE: string;
  LLM_MEM_FOLDER_MD_SKELETON_DENYLIST: string;
  LLM_MEM_SEMANTIC_INJECT: string;        
  LLM_MEM_SEMANTIC_INJECT_LIMIT: string;  
  LLM_MEM_SEMANTIC_INJECT_MIN_SCORE: string;  
  LLM_MEM_SEMANTIC_INJECT_MIN_CHARS: string;
  LLM_MEM_TIER_ROUTING_ENABLED: string;
  LLM_MEM_TIER_SIMPLE_MODEL: string;
  LLM_MEM_TIER_SUMMARY_MODEL: string;
  LLM_MEM_TIER_FAST_MODEL: string;        // #2289 — resolved by $TIER:fast in LLM_MEM_MODEL
  LLM_MEM_TIER_SMART_MODEL: string;       // #2289 — resolved by $TIER:smart in LLM_MEM_MODEL
  LLM_MEM_CHROMA_ENABLED: string;   
  LLM_MEM_CHROMA_MODE: string;      
  LLM_MEM_CHROMA_HOST: string;
  LLM_MEM_CHROMA_PORT: string;
  LLM_MEM_CHROMA_SSL: string;
  LLM_MEM_CHROMA_API_KEY: string;
  LLM_MEM_CHROMA_TENANT: string;
  LLM_MEM_CHROMA_DATABASE: string;
  LLM_MEM_CHROMA_PREWARM_TIMEOUT_MS: string;
  // Worker-native cloud sync. Active ⇔ TOKEN, USER_ID, and HUB_URL are all
  // non-empty — there is no separate enabled flag. HUB_URL points at the
  // two-lane sync hub (workers/sync-hub); while it is empty, sync is OFF
  // entirely (the old per-kind cmem.ai lane was deleted in the hub cutover).
  LLM_MEM_CLOUD_SYNC_TOKEN: string;
  LLM_MEM_CLOUD_SYNC_USER_ID: string;
  LLM_MEM_CLOUD_SYNC_HUB_URL: string;
  LLM_MEM_CLOUD_SYNC_DEVICE_ID: string;
  LLM_MEM_CLOUD_SYNC_DEVICE_NAME: string;
  LLM_MEM_OUTPUT_LANGUAGE: string;  // 'zh' | 'en' — language for observation/summary output
  // Observation batching (per-invocation billing optimization): collect N
  // observations (or until the timeout elapses) and compress them into a
  // single LLM call. 1 = disabled (byte-identical to non-batched behaviour).
  LLM_MEM_OBS_BATCH_SIZE: string;           // default '1' — disabled
  LLM_MEM_OBS_BATCH_TIMEOUT_MS: string;     // default '15000' — 15s flush window
  LLM_MEM_CLOUD_SYNC_WS: string;    // advisory WebSocket speed layer (Phase 4) — 'false' = HTTP polling only
  LLM_MEM_TELEGRAM_ENABLED: string;
  LLM_MEM_TELEGRAM_BOT_TOKEN: string;
  LLM_MEM_TELEGRAM_CHAT_ID: string;
  LLM_MEM_TELEGRAM_TRIGGER_TYPES: string;
  LLM_MEM_TELEGRAM_TRIGGER_CONCEPTS: string;
  LLM_MEM_QUEUE_ENGINE: string;
  LLM_MEM_REDIS_URL: string;
  LLM_MEM_REDIS_HOST: string;
  LLM_MEM_REDIS_PORT: string;
  LLM_MEM_REDIS_MODE: string;
  LLM_MEM_QUEUE_REDIS_PREFIX: string;
  LLM_MEM_AUTH_MODE: string;
  LLM_MEM_RUNTIME: string;
  LLM_MEM_OLLAMA_URL: string;
  LLM_MEM_VECTOR_EMBEDDING_MODEL: string;
  LLM_MEM_DISABLE_VECTOR_SEARCH: string;
  // Phase 1a (cmem-sdk rename): canonical server settings keys. Hooks read
  // these first and fall back to the legacy `*_BETA_*` keys below.
  LLM_MEM_SERVER_URL: string;
  LLM_MEM_SERVER_API_KEY: string;
  LLM_MEM_SERVER_PROJECT_ID: string;
  // Legacy keys retained for back-compat with existing settings.json files.
  LLM_MEM_SERVER_BETA_URL: string;
  LLM_MEM_SERVER_BETA_API_KEY: string;
  LLM_MEM_SERVER_BETA_PROJECT_ID: string;
}

export class SettingsDefaultsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    LLM_MEM_MODEL: 'claude-haiku-4-5-20251001',
    LLM_MEM_CONTEXT_OBSERVATIONS: '50',
    LLM_MEM_WORKER_PORT: String(37700 + ((process.getuid?.() ?? 77) % 100)),
    LLM_MEM_WORKER_HOST: '127.0.0.1',
    LLM_MEM_API_TIMEOUT_MS: String(getTimeout(HOOK_TIMEOUTS.API_REQUEST)),
    LLM_MEM_SKIP_TOOLS: 'ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion',
    LLM_MEM_PROVIDER: 'claude',  // Default to Claude
    LLM_MEM_CLAUDE_AUTH_METHOD: 'subscription',  // Default to logged-in Claude SDK auth (not API key)
    LLM_MEM_GEMINI_API_KEY: '',  // Empty by default, can be set via UI or env
    LLM_MEM_GEMINI_MODEL: 'gemini-flash-latest',  // Google-maintained alias → current GA Flash model (stays valid for new API keys)
    LLM_MEM_GEMINI_RATE_LIMITING_ENABLED: 'true',  // Rate limiting ON by default for free tier users
    LLM_MEM_OPENROUTER_API_KEY: '',  // Empty by default, can be set via UI or env
    LLM_MEM_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',  // Default OpenRouter model (free tier)
    LLM_MEM_OPENROUTER_BASE_URL: '',  // #2382/#2590/#2622/#2393 — optional OpenAI-compatible base URL (e.g. https://api.deepseek.com, http://localhost:1234/v1). Empty = default OpenRouter endpoint.
    LLM_MEM_OPENROUTER_SITE_URL: '',  // Optional: for OpenRouter analytics
    LLM_MEM_OPENROUTER_APP_NAME: 'llm-mem',  // App name for OpenRouter analytics
    LLM_MEM_DATA_DIR: join(homedir(), '.llm-mem'),
    LLM_MEM_LOG_LEVEL: 'INFO',
    LLM_MEM_PYTHON_VERSION: '3.13',
    CLAUDE_CODE_PATH: '', // Empty means auto-detect via 'which claude'
    LLM_MEM_MODE: 'code', // Default mode profile
    LLM_MEM_CONTEXT_SHOW_READ_TOKENS: 'false',
    LLM_MEM_CONTEXT_SHOW_WORK_TOKENS: 'false',
    LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: 'false',
    LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: 'true',
    LLM_MEM_CONTEXT_FULL_COUNT: '0',
    LLM_MEM_CONTEXT_FULL_FIELD: 'narrative',
    LLM_MEM_CONTEXT_SESSION_COUNT: '10',
    LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY: 'true',
    LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE: 'false',
    LLM_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: 'true',
    LLM_MEM_WELCOME_HINT_ENABLED: 'true',
    LLM_MEM_FOLDER_CLAUDEMD_ENABLED: 'false',
    LLM_MEM_FOLDER_USE_LOCAL_MD: 'false',  // When true, writes to CLAUDE.local.md instead of CLAUDE.md
    LLM_MEM_TRANSCRIPTS_ENABLED: 'true',
    LLM_MEM_TRANSCRIPTS_CONFIG_PATH: join(homedir(), '.llm-mem', 'transcript-watch.json'),
    LLM_MEM_CODEX_TRANSCRIPT_INGESTION: 'false',
    LLM_MEM_MAX_CONCURRENT_AGENTS: '2',  // Max concurrent Claude SDK agent subprocesses
    LLM_MEM_HOOK_FAIL_LOUD_THRESHOLD: '3',  // Plan 05 Phase 8 — escalate to exit code 2 after N consecutive worker-unreachable hook invocations
    LLM_MEM_EXCLUDED_PROJECTS: '',  // Comma-separated glob patterns for excluded project paths
    LLM_MEM_FOLDER_MD_EXCLUDE: '[]',  // JSON array of folder paths to exclude from CLAUDE.md generation
    LLM_MEM_FOLDER_MD_SKELETON_DENYLIST: '[]',  // #2400 — JSON array of glob patterns; when a folder matches AND its generated CLAUDE.md would be empty/skeleton, skip injection (avoids polluting non-content dirs with empty skeletons). Default [] preserves existing behavior.
    LLM_MEM_SEMANTIC_INJECT: 'false',             // Inject relevant past observations on every UserPromptSubmit (experimental, disabled by default)
    LLM_MEM_SEMANTIC_INJECT_LIMIT: '5',           // Top-N most relevant observations to inject per prompt
    LLM_MEM_SEMANTIC_INJECT_MIN_SCORE: '0.75',    // Minimum similarity score (0-1) for injected results
    LLM_MEM_SEMANTIC_INJECT_MIN_CHARS: '20',    // Minimum prompt character count before semantic injection
    LLM_MEM_TIER_ROUTING_ENABLED: 'true',         // Route observations to models by complexity
    LLM_MEM_TIER_SIMPLE_MODEL: 'haiku', // Portable tier alias — works across Direct API, Bedrock, Vertex, Azure (see #1463)
    LLM_MEM_TIER_SUMMARY_MODEL: '',                // Empty = use default model for summaries
    LLM_MEM_TIER_FAST_MODEL: 'haiku',              // #2289 — $TIER:fast resolves here (portable alias)
    LLM_MEM_TIER_SMART_MODEL: 'sonnet',            // #2289 — $TIER:smart resolves here (portable alias)
    LLM_MEM_CHROMA_ENABLED: 'true',         // Set to 'false' to disable Chroma and use SQLite-only search
    LLM_MEM_CHROMA_MODE: 'local',           // 'local' uses persistent chroma-mcp via uvx, 'remote' connects to existing server
    LLM_MEM_CHROMA_HOST: '127.0.0.1',
    LLM_MEM_CHROMA_PORT: '8000',
    LLM_MEM_CHROMA_SSL: 'false',
    LLM_MEM_CHROMA_API_KEY: '',
    LLM_MEM_CHROMA_TENANT: 'default_tenant',
    LLM_MEM_CHROMA_DATABASE: 'default_database',
    LLM_MEM_CHROMA_PREWARM_TIMEOUT_MS: '120000',
    // Worker-native cloud sync: credentials come from cmem.ai → Connect.
    LLM_MEM_CLOUD_SYNC_TOKEN: '',
    LLM_MEM_CLOUD_SYNC_USER_ID: '',
    LLM_MEM_CLOUD_SYNC_HUB_URL: '',  // sync-hub base URL (e.g. https://sync.cmem.ai). Empty = sync OFF
    LLM_MEM_CLOUD_SYNC_DEVICE_ID: '',      // Minted at first CloudSync start, then persisted back here
    LLM_MEM_CLOUD_SYNC_DEVICE_NAME: hostname(),  // Human-readable label for the cmem.ai Devices panel
    LLM_MEM_OUTPUT_LANGUAGE: 'zh',
    // Observation batching (per-invocation billing optimization). '1' = disabled
    // (byte-identical to the pre-batching behaviour). Raise LLM_MEM_OBS_BATCH_SIZE
    // to N>=2 to collect N observations (bounded by the timeout) into one LLM call.
    LLM_MEM_OBS_BATCH_SIZE: '1',
    LLM_MEM_OBS_BATCH_TIMEOUT_MS: '15000',
    LLM_MEM_CLOUD_SYNC_WS: 'true',
    LLM_MEM_TELEGRAM_ENABLED: 'true',
    LLM_MEM_TELEGRAM_BOT_TOKEN: '',
    LLM_MEM_TELEGRAM_CHAT_ID: '',
    LLM_MEM_TELEGRAM_TRIGGER_TYPES: 'security_alert',
    LLM_MEM_TELEGRAM_TRIGGER_CONCEPTS: '',
    LLM_MEM_QUEUE_ENGINE: 'sqlite',
    LLM_MEM_REDIS_URL: '',
    LLM_MEM_REDIS_HOST: '127.0.0.1',
    LLM_MEM_REDIS_PORT: '6379',
    LLM_MEM_REDIS_MODE: 'external',
    LLM_MEM_QUEUE_REDIS_PREFIX: `claude_mem_${process.env.LLM_MEM_WORKER_PORT ?? String(37700 + ((process.getuid?.() ?? 77) % 100))}`,
    LLM_MEM_AUTH_MODE: 'api-key',
    LLM_MEM_RUNTIME: 'worker',
    LLM_MEM_OLLAMA_URL: 'http://127.0.0.1:11434',       // Ollama server base URL for vector search
    LLM_MEM_VECTOR_EMBEDDING_MODEL: 'qwen3-embedding:0.6b', // Embedding model used by hnswlib (multi-language, 1024-dim)
    LLM_MEM_DISABLE_VECTOR_SEARCH: 'false',              // 'true' to disable vector/hnsw search
    // Phase 1a (cmem-sdk rename): canonical server settings keys. Hooks read
    // these first; the legacy `*_BETA_*` defaults below remain so existing
    // settings.json files still resolve correctly.
    LLM_MEM_SERVER_URL: `http://127.0.0.1:${process.env.LLM_MEM_SERVER_PORT ?? String(37877 + ((process.getuid?.() ?? 77) % 100))}`,  // Default server runtime URL — UID-derived for multi-account isolation
    LLM_MEM_SERVER_API_KEY: '',                          // Local hook API key, populated by installer when runtime=server
    LLM_MEM_SERVER_PROJECT_ID: '',                       // Default Postgres project_id used by hooks when runtime=server
    LLM_MEM_SERVER_BETA_URL: `http://127.0.0.1:${process.env.LLM_MEM_SERVER_PORT ?? String(37877 + ((process.getuid?.() ?? 77) % 100))}`,  // Legacy server-beta runtime URL — UID-derived for multi-account isolation
    LLM_MEM_SERVER_BETA_API_KEY: '',                     // Legacy local hook API key (read as fallback when LLM_MEM_SERVER_API_KEY unset)
    LLM_MEM_SERVER_BETA_PROJECT_ID: '',                  // Legacy Postgres project_id (read as fallback when LLM_MEM_SERVER_PROJECT_ID unset)
  };

  static getAllDefaults(): SettingsDefaults {
    return { ...this.DEFAULTS };
  }

  static get(key: keyof SettingsDefaults): string {
    return process.env[key] ?? this.DEFAULTS[key];
  }

  static getInt(key: keyof SettingsDefaults): number {
    const value = this.get(key);
    return parseInt(value, 10);
  }

  private static applyEnvOverrides(settings: SettingsDefaults): SettingsDefaults {
    const result = { ...settings };
    for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
      if (process.env[key] !== undefined) {
        result[key] = process.env[key]!;
      }
    }
    return result;
  }

  static loadFromFile(settingsPath: string, applyEnvOverrides = true): SettingsDefaults {
    try {
      if (!existsSync(settingsPath)) {
        const defaults = this.getAllDefaults();
        try {
          writeJsonFileAtomic(settingsPath, defaults);
          // stderr, never stdout: this fires on the first boot in a fresh data
          // dir, and CLI commands like `start` promise machine-readable JSON
          // on stdout to the hook framework.
          console.warn('[SETTINGS] Created settings file with defaults:', settingsPath);
        } catch (error: unknown) {
          console.warn('[SETTINGS] Failed to create settings file, using in-memory defaults:', settingsPath, error instanceof Error ? error.message : String(error));
        }
        return applyEnvOverrides ? this.applyEnvOverrides(defaults) : defaults;
      }

      const settingsData = readFileSync(settingsPath, 'utf-8');
      const settings = parseJsonWithBom<Record<string, any>>(settingsData);

      let flatSettings = settings;
      if (settings.env && typeof settings.env === 'object') {
        flatSettings = settings.env;

        try {
          writeJsonFileAtomic(settingsPath, flatSettings);
          // stderr, never stdout — same JSON-on-stdout contract as above.
          console.warn('[SETTINGS] Migrated settings file from nested to flat schema:', settingsPath);
        } catch (error: unknown) {
          console.warn('[SETTINGS] Failed to auto-migrate settings file:', settingsPath, error instanceof Error ? error.message : String(error));
          // Continue with in-memory migration even if write fails
        }
      }

      const result: SettingsDefaults = { ...this.DEFAULTS };
      for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
        if (flatSettings[key] !== undefined) {
          result[key] = flatSettings[key];
        }
      }

      return applyEnvOverrides ? this.applyEnvOverrides(result) : result;
    } catch (error: unknown) {
      console.warn('[SETTINGS] Failed to load settings, using defaults:', settingsPath, error instanceof Error ? error.message : String(error));
      const defaults = this.getAllDefaults();
      return applyEnvOverrides ? this.applyEnvOverrides(defaults) : defaults;
    }
  }
}
