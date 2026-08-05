export const API_ENDPOINTS = {
  OBSERVATIONS: '/api/observations',
  SUMMARIES: '/api/summaries',
  PROMPTS: '/api/prompts',
  SETTINGS: '/api/settings',
  STREAM: '/stream',
  RESTART: '/api/restart',
  DEPENDENCY_HEALTH: '/api/settings/dependency-health',
  MCP_STATUS: '/api/mcp/status',
  SEMANTIC_CONTEXT: '/api/context/semantic',
  PROMPT_SEMANTIC_CONTEXT: '/api/prompts/semantic-context',
} as const;
