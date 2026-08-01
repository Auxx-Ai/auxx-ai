// packages/lib/src/ai/agent-framework/builder-model.ts

/**
 * Pinned model for `domain: 'builder'` agent runs. Always paired with
 * `forceSystem: true` (platform-managed SYSTEM credentials, regardless
 * of the org's provider-type preference). The org is still billed via
 * the standard SYSTEM credit pool. Bump in lockstep with the broader
 * Anthropic model rotation.
 */
export const BUILDER_MODEL = resolveBuilderModel()

function resolveBuilderModel(): { provider: string; model: string } {
  const [provider, ...modelParts] = process.env.BUILDER_MODEL_OVERRIDE?.split(':') ?? []
  const model = modelParts.join(':')
  if (provider && model) return { provider, model }
  return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
}
