// packages/lib/src/ai/agent-framework/trigger-seed-message.ts

/**
 * Seed user message for any triggered agent run. The operator's intent and
 * the trigger-fire context now live in the **system prompt** via
 * `renderTriggerSection` — the user-message slot is reduced to a thin nudge
 * whose only job is to terminate the system prompt and yield the turn.
 *
 * See plans/kopilot/agents/trigger-instructions.md §5.
 */
export function buildTriggerSeedMessage(): string {
  return 'Trigger fired. Follow your trigger instructions.'
}
