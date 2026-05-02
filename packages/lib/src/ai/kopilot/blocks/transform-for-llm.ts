// packages/lib/src/ai/kopilot/blocks/transform-for-llm.ts

/**
 * Transform `auxx:*` reference-block fences inside an assistant message
 * into a numbered, displayName-paired text representation that small LLMs
 * can index by ordinal without parsing JSON.
 *
 * Used at the LLM-call boundary only — the persisted message content
 * keeps the original fence so the UI renders the rich card unchanged.
 */

const FENCE_RE = /```auxx:([a-z-]+)\n([\s\S]*?)\n```/g

type Transformer = (data: Record<string, unknown>) => string | null

const TRANSFORMERS: Record<string, Transformer> = {
  'entity-list': transformEntityList,
  'entity-card': transformEntityCard,
  'thread-list': transformThreadList,
  'task-list': transformTaskList,
  'draft-list': transformDraftList,
}

export function transformAssistantContentForLLM(content: string): string {
  if (!content || !content.includes('```auxx:')) return content
  return content.replace(FENCE_RE, (match, type: string, body: string) => {
    const fn = TRANSFORMERS[type]
    if (!fn) return match
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      return match
    }
    const transformed = fn(data)
    return transformed ?? match
  })
}

function transformEntityList(data: Record<string, unknown>): string | null {
  const recordIds = Array.isArray(data.recordIds)
    ? (data.recordIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  if (recordIds.length === 0) return null
  const snapshot = (data.snapshot as Record<string, unknown> | undefined) ?? {}
  const lines = recordIds.map((id, i) => {
    const entry = snapshot[id] as Record<string, unknown> | undefined
    const displayName = typeof entry?.displayName === 'string' ? entry.displayName : null
    const summary = typeof entry?.summary === 'string' ? entry.summary : null
    const left = displayName ?? '(unknown record)'
    const middle = summary ? ` — ${summary}` : ''
    return `  ${i + 1}. ${left}${middle} (recordId: ${id})`
  })
  return `[Showed entity-list to user (${recordIds.length} record${recordIds.length === 1 ? '' : 's'}):\n${lines.join('\n')}]`
}

function transformEntityCard(data: Record<string, unknown>): string | null {
  const recordId = typeof data.recordId === 'string' ? data.recordId : null
  if (!recordId) return null
  const snapshot = (data.snapshot as Record<string, unknown> | undefined) ?? {}
  const entry = snapshot[recordId] as Record<string, unknown> | undefined
  const displayName = typeof entry?.displayName === 'string' ? entry.displayName : null
  const summary = typeof entry?.summary === 'string' ? entry.summary : null
  const left = displayName ?? '(unknown record)'
  const middle = summary ? ` — ${summary}` : ''
  return `[Showed entity-card to user: ${left}${middle} (recordId: ${recordId})]`
}

function transformThreadList(data: Record<string, unknown>): string | null {
  const threadIds = Array.isArray(data.threadIds)
    ? (data.threadIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  if (threadIds.length === 0) return null
  const snapshot = (data.snapshot as Record<string, unknown> | undefined) ?? {}
  const lines = threadIds.map((id, i) => {
    const entry = snapshot[id] as Record<string, unknown> | undefined
    const subject = typeof entry?.subject === 'string' ? entry.subject : null
    const sender = typeof entry?.sender === 'string' ? entry.sender : null
    const left = subject ? `"${subject}"` : '(no subject)'
    const middle = sender ? ` — from ${sender}` : ''
    return `  ${i + 1}. ${left}${middle} (threadId: ${id})`
  })
  return `[Showed thread-list to user (${threadIds.length} thread${threadIds.length === 1 ? '' : 's'}):\n${lines.join('\n')}]`
}

function transformTaskList(data: Record<string, unknown>): string | null {
  const taskIds = Array.isArray(data.taskIds)
    ? (data.taskIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  if (taskIds.length === 0) return null
  const snapshot = (data.snapshot as Record<string, unknown> | undefined) ?? {}
  const lines = taskIds.map((id, i) => {
    const entry = snapshot[id] as Record<string, unknown> | undefined
    const title = typeof entry?.title === 'string' ? entry.title : null
    const completedAt = typeof entry?.completedAt === 'string' ? entry.completedAt : null
    const left = title ? `"${title}"` : '(untitled)'
    const middle = completedAt ? ' — done' : ' — open'
    return `  ${i + 1}. ${left}${middle} (taskId: ${id})`
  })
  return `[Showed task-list to user (${taskIds.length} task${taskIds.length === 1 ? '' : 's'}):\n${lines.join('\n')}]`
}

function transformDraftList(data: Record<string, unknown>): string | null {
  const draftIds = Array.isArray(data.draftIds)
    ? (data.draftIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  if (draftIds.length === 0) return null
  const snapshot = (data.snapshot as Record<string, unknown> | undefined) ?? {}
  const lines = draftIds.map((id, i) => {
    const entry = snapshot[id] as Record<string, unknown> | undefined
    const subject = typeof entry?.subject === 'string' ? entry.subject : null
    const recipientSummary =
      typeof entry?.recipientSummary === 'string' ? entry.recipientSummary : null
    const kind = entry?.kind === 'reply' ? 'reply' : 'standalone'
    const scheduledAt = typeof entry?.scheduledAt === 'string' ? entry.scheduledAt : null
    const left = subject ? `"${subject}"` : '(no subject)'
    const middleParts: string[] = [kind]
    if (recipientSummary) middleParts.push(`to ${recipientSummary}`)
    if (scheduledAt) middleParts.push(`scheduled ${scheduledAt}`)
    return `  ${i + 1}. ${left} — ${middleParts.join(', ')} (id: ${id})`
  })
  return `[Showed draft-list to user (${draftIds.length} draft${draftIds.length === 1 ? '' : 's'}):\n${lines.join('\n')}]`
}
