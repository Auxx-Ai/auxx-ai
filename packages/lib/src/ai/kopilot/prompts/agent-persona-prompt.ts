// packages/lib/src/ai/kopilot/prompts/agent-persona-prompt.ts

/**
 * Renderer for user-authored agents. Takes a name, optional description,
 * and the author-authored instructions body, and emits the persona slot
 * of the system prompt.
 *
 * The shared `## House rules` scope guard (in `sections/house-rules.ts`)
 * runs ahead of every agent — master and user-authored — so author-written
 * guards stack on top of the house rules, not in place of them.
 */
export function buildAgentPersonaPrompt(args: {
  agentName: string
  description?: string
  /** The user-authored system prompt body (already flattened to text). */
  instructions: string
}): string {
  const { agentName, description, instructions } = args
  const descriptionLine = description?.trim() ? ` ${description.trim()}` : ''
  const header = `You are ${agentName}.${descriptionLine}`
  const body = instructions.trim()
  return body ? `${header}\n\n${body}` : header
}
