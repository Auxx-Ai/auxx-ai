// packages/lib/src/ai/kopilot/prompts/trigger-context.ts

/**
 * Trigger-run section of the system prompt. Rendered only when the run was
 * kicked off by an AgentTrigger; chat runs render exactly what they used to.
 *
 * Slotted between the persona and the core runtime. Three sub-sections:
 * 1. Kind-specific context block (what fired this run)
 * 2. Operator instructions (verbatim from AgentTrigger.instructions)
 * 3. Run-mode banner (autonomous framing, authority hierarchy)
 *
 * See plans/kopilot/agents/trigger-instructions.md for the design.
 */

export type TriggerKind = 'scheduled' | 'event' | 'app' | 'mention' | 'assignment'

export interface TriggerContext {
  kind: TriggerKind
  /** Pre-rendered text of AgentTrigger.instructions (Tiptap → text). Null when unset. */
  instructions: string | null
  /** Kind-specific payload — shape matches AiAgentSession.triggerContext for the kind. */
  payload: Record<string, unknown>
}

export function renderTriggerSection(triggerContext: TriggerContext | undefined): string {
  if (!triggerContext) return ''

  const blocks: string[] = []
  blocks.push(renderKindBlock(triggerContext))

  if (triggerContext.instructions?.trim()) {
    blocks.push(`## Trigger instructions\n\n${triggerContext.instructions.trim()}`)
  }

  blocks.push(renderRunModeBanner(triggerContext.kind))

  return `\n${blocks.join('\n\n')}\n`
}

function renderKindBlock(triggerContext: TriggerContext): string {
  const { kind, payload } = triggerContext
  switch (kind) {
    case 'scheduled':
      return renderScheduledBlock(payload)
    case 'event':
      return renderEventBlock(payload)
    case 'app':
      return renderAppBlock(payload)
    case 'mention':
      return renderMentionBlock(payload)
    case 'assignment':
      return renderAssignmentBlock(payload)
  }
}

function renderScheduledBlock(payload: Record<string, unknown>): string {
  const firedAt = asString(payload.firedAt) ?? new Date().toISOString()
  const schedulerId = asString(payload.schedulerId)
  const lines = [
    '## Trigger fired',
    '',
    'Kind: `scheduled`',
    `Fired at: ${firedAt}`,
    schedulerId ? `Scheduler: \`${schedulerId}\`` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function renderEventBlock(payload: Record<string, unknown>): string {
  const eventType = asString(payload.eventType) ?? 'unknown'
  const recordId = asString(payload.recordId)
  const firedAt = asString(payload.firedAt) ?? new Date().toISOString()
  const lines = [
    '## Trigger fired',
    '',
    'Kind: `event`',
    `Event type: \`${eventType}\``,
    recordId ? `Triggering record: \`${recordId}\`` : '',
    `Fired at: ${firedAt}`,
    '',
    'The triggering resource payload is in domain state under `triggerResource`.',
  ].filter(Boolean)
  return lines.join('\n')
}

function renderAppBlock(payload: Record<string, unknown>): string {
  const appId = asString(payload.appId)
  const triggerId = asString(payload.triggerId)
  const installationId = asString(payload.installationId)
  const eventId = asString(payload.eventId)
  const firedAt = asString(payload.firedAt) ?? new Date().toISOString()
  const lines = [
    '## Trigger fired',
    '',
    'Kind: `app`',
    appId ? `App: \`${appId}\`` : '',
    triggerId ? `Trigger id: \`${triggerId}\`` : '',
    installationId ? `Installation: \`${installationId}\`` : '',
    eventId ? `Event id: \`${eventId}\`` : '',
    `Fired at: ${firedAt}`,
  ].filter(Boolean)
  return lines.join('\n')
}

function renderMentionBlock(payload: Record<string, unknown>): string {
  const commentId = asString(payload.commentId)
  const parentRecordId = asString(payload.parentRecordId)
  const mentionerUserId = asString(payload.mentionerUserId)
  const firedAt = asString(payload.firedAt) ?? new Date().toISOString()
  const lines = [
    '## Trigger fired',
    '',
    'Kind: `mention`',
    commentId ? `Comment id: \`${commentId}\`` : '',
    parentRecordId ? `Mentioned in: \`${parentRecordId}\`` : '',
    mentionerUserId ? `Mentioner: \`user:${mentionerUserId}\`` : '',
    `Fired at: ${firedAt}`,
    '',
    'Sibling references and the full mention payload are in domain state under `mention`.',
    '',
    'Copy the `Mentioned in:` id verbatim when calling tools that take a recordId — do not prepend an entity slug or guess a prefix.',
  ].filter(Boolean)
  return lines.join('\n')
}

function renderAssignmentBlock(payload: Record<string, unknown>): string {
  const threadRecordId = asString(payload.threadRecordId)
  const assignerUserId = asString(payload.assignerUserId)
  const firedAt = asString(payload.firedAt) ?? new Date().toISOString()
  const lines = [
    '## Trigger fired',
    '',
    'Kind: `assignment`',
    threadRecordId ? `Assigned thread: \`${threadRecordId}\`` : '',
    assignerUserId ? `Assigner: \`user:${assignerUserId}\`` : '',
    `Fired at: ${firedAt}`,
    '',
    'Copy the `Assigned thread:` id verbatim when calling tools that take a recordId.',
  ].filter(Boolean)
  return lines.join('\n')
}

function renderRunModeBanner(kind: TriggerKind): string {
  return `## Run mode

You are running autonomously, fired by a \`${kind}\` trigger. No human is reading this turn. The user message ("Trigger fired. Follow your trigger instructions.") is a system nudge — your real intent is the **Trigger instructions** section above (or, if none were configured, infer from the **Trigger fired** context).

Approval-gated tools that were enabled on this agent at setup time will execute without confirmation. User-scope tools (anything that needs a human in the loop) are not registered for this run — if you can't see a tool you expect, that's why.

The tools available to you for this run are listed under "How tools surface results" below. The set is already filtered to this agent's enabled toolsets; no need to ask permission to call any of them.

When the trigger instructions are complete, end the turn with a short prose summary — the summary is your audit trail, not a reply to a user. No \`?\` questions back to the caller; there is no caller. If you cannot complete the work, explain briefly in the final answer and stop.`
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
