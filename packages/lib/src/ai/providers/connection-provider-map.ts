// packages/lib/src/ai/providers/connection-provider-map.ts
// Single source of truth mapping the AI system's short provider id
// ('anthropic') to the unified Connections blueprint providerKey ('anthropicApi').
// Used at seed time (to set ProviderConfiguration.connectionDefinitionId) and at
// resolve time (to find the org's BYO Credential rows).

/** AI short provider id → Connections blueprint providerKey. */
export const AI_PROVIDER_CONNECTION_KEY: Record<string, string> = {
  openai: 'openaiApi',
  anthropic: 'anthropicApi',
  google: 'googleAiApi',
  groq: 'groqApi',
  deepseek: 'deepseekApi',
  qwen: 'qwenApi',
  kimi: 'kimiApi',
  cohere: 'cohereApi',
}

/** Connections blueprint providerKey → AI short provider id (inverse). */
export const CONNECTION_KEY_AI_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(AI_PROVIDER_CONNECTION_KEY).map(([provider, key]) => [key, provider])
)

/** Resolve the blueprint providerKey for an AI provider, or undefined if unmapped. */
export function aiProviderConnectionKey(provider: string): string | undefined {
  return AI_PROVIDER_CONNECTION_KEY[provider]
}

/**
 * Canonical credential field → environment/config key, per AI provider. Replaces
 * the old `field.variable.toUpperCase()` shortcut (which broke once the canonical
 * field became `apiKey`, not `openai_api_key`). Keys match the names configService
 * already resolves (DB override → process.env → SST → registry default), so the
 * SYSTEM credential path is unchanged.
 */
export const AI_SYSTEM_ENV_MAP: Record<string, Record<string, string>> = {
  openai: {
    apiKey: 'OPENAI_API_KEY',
    organization: 'OPENAI_ORGANIZATION',
    apiBase: 'OPENAI_API_BASE',
  },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', voyageApiKey: 'VOYAGE_API_KEY' },
  google: { apiKey: 'GOOGLE_API_KEY' },
  groq: { apiKey: 'GROQ_API_KEY' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY' },
  qwen: { apiKey: 'QWEN_API_KEY', apiBase: 'QWEN_API_BASE' },
  kimi: { apiKey: 'KIMI_API_KEY' },
  cohere: { apiKey: 'COHERE_API_KEY' },
}
