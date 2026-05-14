// packages/lib/src/ai/kopilot/prompts/agent-persona-prompt.ts

/**
 * Renderer for user-authored agents. Takes a name, optional description,
 * and the author-authored instructions body, and emits the persona slot
 * of the system prompt.
 *
 * No default scope-guard is injected — if the prompt author wants "only
 * help with X", they write it themselves. This keeps Phase 1 from having
 * to undo policy baked in here.
 *
 * Phase 0 ships this module with no live caller (master Kopilot uses
 * `buildKopilotMasterPersona` instead). Phase 1 wires it up against
 * `AgentConfig`.
 */
export function buildAgentPersonaPrompt(args: {
  agentName: string
  description?: string
  /** The user-authored system prompt body (already flattened to text). */
  instructions: string
}): string {
  const { agentName, description, instructions } = args
  const descriptionLine = description?.trim() ? ` ${description.trim()}` : ''
  return `You are ${agentName}.${descriptionLine}

${instructions.trim()}`
}
