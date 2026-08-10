
import express, { Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import { readFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { getPackageRoot, paths, expandTilde } from '../../../../shared/paths.js';
import { logger } from '../../../../utils/logger.js';
import { SettingsManager } from '../../SettingsManager.js';
import { ModeManager } from '../../../domain/ModeManager.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { clearPortCache } from '../../../../shared/worker-utils.js';
import { snapshotDependencyHealth } from '../../../../shared/dependency-health.js';
import { parseJsonWithBom, writeJsonFileAtomic, readJsonFileWithBom } from '../../../../shared/atomic-json.js';
import { spawnHnswHelper, getHnswDir } from '../../../sync/hnswlib-spawn.js';
import { promises as fs } from 'fs';

const toggleMcpSchema = z.object({
  enabled: z.boolean(),
}).passthrough();

const vectorRebuildSchema = z.object({
  force: z.boolean().optional(),
}).passthrough();

export class SettingsRoutes extends BaseRouteHandler {
  constructor(
    private settingsManager: SettingsManager
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/settings', this.handleGetSettings.bind(this));
    app.post('/api/settings', this.handleUpdateSettings.bind(this));
    app.get('/api/settings/dependency-health', this.handleGetDependencyHealth.bind(this));

    app.post('/api/vector/rebuild', validateBody(vectorRebuildSchema), this.handleVectorRebuild.bind(this));
    app.get('/api/vector/rebuild/status', this.handleVectorRebuildStatus.bind(this));
    app.get('/api/vector/stats', this.handleVectorStats.bind(this));

    app.get('/api/mcp/status', this.handleGetMcpStatus.bind(this));
    app.post('/api/mcp/toggle', validateBody(toggleMcpSchema), this.handleToggleMcp.bind(this));
  }

  private handleGetSettings = this.wrapHandler((req: Request, res: Response): void => {
    const settingsPath = paths.settings();
    this.ensureSettingsFile(settingsPath);
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
    res.json(settings);
  });

  private handleGetDependencyHealth = this.wrapHandler((_req: Request, res: Response): void => {
    res.json(snapshotDependencyHealth());
  });

  private handleVectorRebuild = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const settingsPath = paths.settings();
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
    const model = settings.LLM_MEM_VECTOR_EMBEDDING_MODEL
      ?? SettingsDefaultsManager.getAllDefaults().LLM_MEM_VECTOR_EMBEDDING_MODEL;
    const ollamaUrl = settings.LLM_MEM_VECTOR_EMBEDDING_MODEL
      ? settings.LLM_MEM_OLLAMA_URL ?? SettingsDefaultsManager.getAllDefaults().LLM_MEM_OLLAMA_URL
      : SettingsDefaultsManager.getAllDefaults().LLM_MEM_OLLAMA_URL;
    const modelDim = this.getModelDimension(model);
    const hnswDir = getHnswDir();
    const { DATA_DIR, DB_PATH } = await import('../../../../shared/paths.js');
    const statusPath = path.join(DATA_DIR, 'vector-rebuild-status.json');
    const started = Date.now();

    const writeStatus = (status: 'running' | 'done' | 'failed', payload?: object) => {
      const out = { status, started_at: started, ...payload };
      try { writeJsonFileAtomic(statusPath, out); } catch { /* ignore */ }
    };

    try {
      // --- synchronous pre-flight: clear old index + write "running" ---
      const existing = await this.listHnswIndexFiles(hnswDir);
      const removed = existing.length;
      if (existing.length > 0) {
        logger.info('WORKER', 'Clearing existing hnsw index files before rebuild', { files: existing, model });
        await Promise.all(existing.map(f => fs.unlink(f).catch((e) => {
          logger.warn('WORKER', 'Failed to remove index file', { file: f, error: String(e) });
        })));
      }
      writeStatus('running', { model, removed });

      // --- fire-and-forget: spawn the slow build in the background ---
      const env: Record<string, string> = { EMBED_MODEL: model, EMBED_DIM: modelDim, OLLAMA_URL: ollamaUrl };
      const startedAt = Date.now();

      // Run spawnHnswHelper in background; once done, persist final status.
      spawnHnswHelper(['build', DB_PATH, hnswDir], env).then((result) => {
        const duration = Date.now() - startedAt;
        if (result.exitCode !== 0) {
          logger.warn('WORKER', 'vector index build failed', { stderr: result.stderr, model });
          writeStatus('failed', { model, error: result.stderr || 'build failed', duration_ms: duration });
          return;
        }
        let elements = 0;
        try {
          const out = JSON.parse(result.stdout.trim()) as { built: boolean; elements: number };
          if (out.built) elements = out.elements;
        } catch { /* ignore parse errors */ }
        logger.info('WORKER', 'Vector index rebuilt', { model, elements, duration });
        writeStatus('done', { model, elements, duration_ms: duration });
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('WORKER', 'Vector index rebuild threw', { model }, new Error(msg));
        writeStatus('failed', { model, error: msg, duration_ms: Date.now() - startedAt });
      });

      res.json({ success: true, model, removed, message: 'Rebuild started in background' });
    } catch (err) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      logger.error('WORKER', 'Vector index rebuild pre-flight failed', { model }, normalizedError);
      res.status(500).json({
        success: false,
        model,
        error: normalizedError.message,
      });
    }
  });

  /** Read the latest rebuild status written by handleVectorRebuild. */
  private handleVectorRebuildStatus = this.wrapHandler((_req: Request, res: Response): void => {
    const { DATA_DIR } = require('../../../../shared/paths.js');
    const statusPath = path.join(DATA_DIR, 'vector-rebuild-status.json');
    if (!existsSync(statusPath)) {
      res.json({ status: 'idle' });
      return;
    }
    try {
      const status = readJsonFileWithBom(statusPath);
      res.json(status);
    } catch {
      res.json({ status: 'failed', error: 'could not read status file' });
    }
  });

  /** Return vector index stats: total indexed, model, dim, indexed sqlite_ids. */
  private handleVectorStats = this.wrapHandler((_req: Request, res: Response): void => {
    try {
      const settingsPath = paths.settings();
      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const model = settings.LLM_MEM_VECTOR_EMBEDDING_MODEL
        ?? SettingsDefaultsManager.getAllDefaults().LLM_MEM_VECTOR_EMBEDDING_MODEL;
      const hnswDir = getHnswDir();
      const idMapPath = path.join(hnswDir, 'id-map.json');

      if (!existsSync(idMapPath)) {
        res.json({ indexed: 0, model, indexed_ids: [], healthy: false });
        return;
      }

      const idMap = readJsonFileWithBom<Record<string, any>>(idMapPath);
      const ids = Object.values(idMap).map((v: any) => v.sqlite_id as number);
      res.json({
        indexed: ids.length,
        model,
        indexed_ids: ids,
        healthy: true,
      });
    } catch (err) {
      res.json({
        indexed: 0,
        model: 'unknown',
        indexed_ids: [],
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * Embedding dimensions for the models we offer. hnswlib needs the dimension
   * to match what the embedding model emits; wrong dimension -> garbage vectors.
   */
  private getModelDimension(model: string): string {
    const lower = model.toLowerCase();
    if (lower.includes('qwen')) return '1024';
    if (lower.includes('bge')) return '1024';
    if (lower.includes('mxbai')) return '1024';
    if (lower.includes('minilm')) return '384';
    if (lower.includes('snowflake')) return '1024';
    if (lower.includes('nomic')) return '768';
    return '';
  }

  private async listHnswIndexFiles(dir: string): Promise<string[]> {
    try {
      const files = await fs.readdir(dir);
      return files
        .filter(f => f === 'index.bin' || f === 'vectors.npy' || f === 'id-map.json' || f === 'id_map.json')
        .map(f => dir + '/' + f);
    } catch {
      return [];
    }
  }

  private handleUpdateSettings = this.wrapHandler((req: Request, res: Response): void => {
    const validation = this.validateSettings(req.body);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error
      });
      return;
    }

    const settingsPath = paths.settings();
    this.ensureSettingsFile(settingsPath);
    let settings: any = {};

    if (existsSync(settingsPath)) {
      const settingsData = readFileSync(settingsPath, 'utf-8');
      try {
        settings = parseJsonWithBom(settingsData);
      } catch (parseError) {
        const normalizedParseError = parseError instanceof Error ? parseError : new Error(String(parseError));
        logger.error('HTTP', 'Failed to parse settings file', { settingsPath }, normalizedParseError);
        res.status(500).json({
          success: false,
          error: `Settings file is corrupted. Delete ${settingsPath} to reset.`
        });
        return;
      }
    }

    const settingKeys = [
      'LLM_MEM_MODEL',
      'LLM_MEM_CONTEXT_OBSERVATIONS',
      'LLM_MEM_WORKER_PORT',
      'LLM_MEM_WORKER_HOST',
      'LLM_MEM_PROVIDER',
      'LLM_MEM_CLAUDE_AUTH_METHOD',
      'LLM_MEM_GEMINI_API_KEY',
      'LLM_MEM_GEMINI_MODEL',
      'LLM_MEM_GEMINI_RATE_LIMITING_ENABLED',
      'LLM_MEM_OPENROUTER_API_KEY',
      'LLM_MEM_OPENROUTER_MODEL',
      'LLM_MEM_OPENROUTER_BASE_URL',
      'LLM_MEM_OPENROUTER_APP_NAME',
      'LLM_MEM_DATA_DIR',
      'LLM_MEM_LOG_LEVEL',
      'LLM_MEM_PYTHON_VERSION',
      'CLAUDE_CODE_PATH',
      'LLM_MEM_CONTEXT_SHOW_READ_TOKENS',
      'LLM_MEM_CONTEXT_SHOW_WORK_TOKENS',
      'LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT',
      'LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT',
      'LLM_MEM_CONTEXT_OBSERVATION_TYPES',
      'LLM_MEM_CONTEXT_OBSERVATION_CONCEPTS',
      'LLM_MEM_CONTEXT_FULL_COUNT',
      'LLM_MEM_CONTEXT_FULL_FIELD',
      'LLM_MEM_CONTEXT_SESSION_COUNT',
      'LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY',
      'LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE',
      'LLM_MEM_OUTPUT_LANGUAGE',
      'LLM_MEM_FOLDER_CLAUDEMD_ENABLED',
      'LLM_MEM_OLLAMA_URL',
      'LLM_MEM_VECTOR_EMBEDDING_MODEL',
      'LLM_MEM_DISABLE_VECTOR_SEARCH',
      'LLM_MEM_FOLDER_USE_LOCAL_MD',
      'LLM_MEM_TRANSCRIPTS_ENABLED',
      'LLM_MEM_TRANSCRIPTS_CONFIG_PATH',
      'LLM_MEM_CODEX_TRANSCRIPT_INGESTION',
      'LLM_MEM_MAX_CONCURRENT_AGENTS',
      'LLM_MEM_EXCLUDED_PROJECTS',
      'LLM_MEM_SEMANTIC_INJECT',
      'LLM_MEM_SEMANTIC_INJECT_LIMIT',
      'LLM_MEM_SEMANTIC_INJECT_MIN_SCORE',
      'LLM_MEM_SEMANTIC_INJECT_MIN_CHARS',
      'LLM_MEM_TELEGRAM_ENABLED',
      'LLM_MEM_TELEGRAM_BOT_TOKEN',
      'LLM_MEM_TELEGRAM_CHAT_ID',
    ];

    for (const key of settingKeys) {
      if (req.body[key] !== undefined) {
        settings[key] = req.body[key];
      }
    }

    // Persist CLAUDE_CODE_PATH with any leading `~` expanded: it's fed straight
    // to existsSync/posix_spawn (no shell), where a literal `~` fails with
    // ENOENT and silently breaks all memory capture. Store the resolved path so
    // the resolver never sees the tilde.
    if (typeof settings.CLAUDE_CODE_PATH === 'string' && settings.CLAUDE_CODE_PATH) {
      settings.CLAUDE_CODE_PATH = expandTilde(settings.CLAUDE_CODE_PATH);
    }

    writeJsonFileAtomic(settingsPath, settings);

    clearPortCache();

    logger.info('WORKER', 'Settings updated');
    res.json({ success: true, message: 'Settings updated successfully' });
  });

  private handleGetMcpStatus = this.wrapHandler((req: Request, res: Response): void => {
    const enabled = this.isMcpEnabled();
    res.json({ enabled });
  });

  private handleToggleMcp = this.wrapHandler((req: Request, res: Response): void => {
    const { enabled } = req.body as z.infer<typeof toggleMcpSchema>;

    this.toggleMcp(enabled);
    res.json({ success: true, enabled: this.isMcpEnabled() });
  });

  private validateSettings(settings: any): { valid: boolean; error?: string } {
    if (settings.LLM_MEM_PROVIDER) {
    const validProviders = ['claude', 'gemini', 'openrouter'];
    if (!validProviders.includes(settings.LLM_MEM_PROVIDER)) {
      return { valid: false, error: 'LLM_MEM_PROVIDER must be "claude", "gemini", or "openrouter"' };
      }
    }

    if (settings.LLM_MEM_CLAUDE_AUTH_METHOD) {
      const validClaudeAuthMethods = ['subscription', 'api-key', 'gateway', 'cli'];
      if (!validClaudeAuthMethods.includes(settings.LLM_MEM_CLAUDE_AUTH_METHOD)) {
        return { valid: false, error: 'LLM_MEM_CLAUDE_AUTH_METHOD must be "subscription", "api-key", "gateway", or "cli"' };
      }
    }

    if (settings.LLM_MEM_GEMINI_MODEL) {
      const validGeminiModels = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
      if (!validGeminiModels.includes(settings.LLM_MEM_GEMINI_MODEL)) {
        return { valid: false, error: 'LLM_MEM_GEMINI_MODEL must be one of: gemini-flash-latest, gemini-flash-lite-latest, gemini-3.5-flash, gemini-3.1-flash-lite, gemini-3-flash-preview' };
      }
    }

    if (settings.LLM_MEM_CONTEXT_OBSERVATIONS) {
      const obsCount = parseInt(settings.LLM_MEM_CONTEXT_OBSERVATIONS, 10);
      if (isNaN(obsCount) || obsCount < 1 || obsCount > 200) {
        return { valid: false, error: 'LLM_MEM_CONTEXT_OBSERVATIONS must be between 1 and 200' };
      }
    }

    if (settings.LLM_MEM_WORKER_PORT) {
      const port = parseInt(settings.LLM_MEM_WORKER_PORT, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return { valid: false, error: 'LLM_MEM_WORKER_PORT must be between 1024 and 65535' };
      }
    }

    if (settings.LLM_MEM_WORKER_HOST) {
      const host = settings.LLM_MEM_WORKER_HOST;
      const validHostPattern = /^(127\.0\.0\.1|0\.0\.0\.0|localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
      if (!validHostPattern.test(host)) {
        return { valid: false, error: 'LLM_MEM_WORKER_HOST must be a valid IP address (e.g., 127.0.0.1, 0.0.0.0)' };
      }
    }

    if (settings.LLM_MEM_LOG_LEVEL) {
      const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'];
      if (!validLevels.includes(settings.LLM_MEM_LOG_LEVEL.toUpperCase())) {
        return { valid: false, error: 'LLM_MEM_LOG_LEVEL must be one of: DEBUG, INFO, WARN, ERROR, SILENT' };
      }
    }

    if (settings.LLM_MEM_PYTHON_VERSION) {
      const pythonVersionRegex = /^3\.\d{1,2}$/;
      if (!pythonVersionRegex.test(settings.LLM_MEM_PYTHON_VERSION)) {
        return { valid: false, error: 'LLM_MEM_PYTHON_VERSION must be in format "3.X" or "3.XX" (e.g., "3.13")' };
      }
    }

    const booleanSettings = [
      'LLM_MEM_CONTEXT_SHOW_READ_TOKENS',
      'LLM_MEM_CONTEXT_SHOW_WORK_TOKENS',
      'LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT',
      'LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT',
      'LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY',
      'LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE',
    ];

    for (const key of booleanSettings) {
      if (settings[key] && !['true', 'false'].includes(settings[key])) {
        return { valid: false, error: `${key} must be "true" or "false"` };
      }
    }

    if (settings.LLM_MEM_CONTEXT_FULL_COUNT) {
      const count = parseInt(settings.LLM_MEM_CONTEXT_FULL_COUNT, 10);
      if (isNaN(count) || count < 0 || count > 20) {
        return { valid: false, error: 'LLM_MEM_CONTEXT_FULL_COUNT must be between 0 and 20' };
      }
    }

    if (settings.LLM_MEM_CONTEXT_SESSION_COUNT) {
      const count = parseInt(settings.LLM_MEM_CONTEXT_SESSION_COUNT, 10);
      if (isNaN(count) || count < 1 || count > 50) {
        return { valid: false, error: 'LLM_MEM_CONTEXT_SESSION_COUNT must be between 1 and 50' };
      }
    }

    if (settings.LLM_MEM_CONTEXT_FULL_FIELD) {
      if (!['narrative', 'facts'].includes(settings.LLM_MEM_CONTEXT_FULL_FIELD)) {
        return { valid: false, error: 'LLM_MEM_CONTEXT_FULL_FIELD must be "narrative" or "facts"' };
      }
    }

    if (settings.LLM_MEM_OPENROUTER_BASE_URL) {
      try {
        new URL(settings.LLM_MEM_OPENROUTER_BASE_URL);
      } catch (error) {
        logger.debug('SETTINGS', 'Invalid URL format', { url: settings.LLM_MEM_OPENROUTER_BASE_URL, error: error instanceof Error ? error.message : String(error) });
        return { valid: false, error: 'LLM_MEM_OPENROUTER_BASE_URL 必须是有效的 URL' };
      }
    }

    if (settings.LLM_MEM_OLLAMA_URL) {
      try {
        new URL(settings.LLM_MEM_OLLAMA_URL);
      } catch {
        return { valid: false, error: 'LLM_MEM_OLLAMA_URL 必须是有效的 URL（例如 http://192.168.1.2:11434）' };
      }
    }

    if (settings.LLM_MEM_DISABLE_VECTOR_SEARCH) {
      if (!['true', 'false'].includes(settings.LLM_MEM_DISABLE_VECTOR_SEARCH)) {
        return { valid: false, error: 'LLM_MEM_DISABLE_VECTOR_SEARCH 必须为 "true" 或 "false"' };
      }
    }

    return { valid: true };
  }

  private isMcpEnabled(): boolean {
    const packageRoot = getPackageRoot();
    const mcpPath = path.join(packageRoot, 'plugin', '.mcp.json');
    return existsSync(mcpPath);
  }

  private toggleMcp(enabled: boolean): void {
    const packageRoot = getPackageRoot();
    const mcpPath = path.join(packageRoot, 'plugin', '.mcp.json');
    const mcpDisabledPath = path.join(packageRoot, 'plugin', '.mcp.json.disabled');

    if (enabled && existsSync(mcpDisabledPath)) {
      renameSync(mcpDisabledPath, mcpPath);
      logger.info('WORKER', 'MCP search server enabled');
    } else if (!enabled && existsSync(mcpPath)) {
      renameSync(mcpPath, mcpDisabledPath);
      logger.info('WORKER', 'MCP search server disabled');
    } else {
      logger.debug('WORKER', 'MCP toggle no-op (already in desired state)', { enabled });
    }
  }

  private ensureSettingsFile(settingsPath: string): void {
    if (!existsSync(settingsPath)) {
      const defaults = SettingsDefaultsManager.getAllDefaults();

      const dir = path.dirname(settingsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeJsonFileAtomic(settingsPath, defaults);
      logger.info('SETTINGS', 'Created settings file with defaults', { settingsPath });
    }
  }
}
