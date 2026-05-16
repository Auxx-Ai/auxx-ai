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
  const override = process.env.BUILDER_MODEL_OVERRIDE
  if (override && override.includes(':')) {
    const [provider, ...modelParts] = override.split(':')
    return { provider, model: modelParts.join(':') }
  }
  return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
}
