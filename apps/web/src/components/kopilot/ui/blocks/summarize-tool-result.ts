// apps/web/src/components/kopilot/ui/blocks/summarize-tool-result.ts

export interface ToolSummary {
  /** Human-readable one-liner */
  summary: string
  /** Optional entity references for inline badges */
  entities?: Array<{ recordId: string }>
}

/**
 * Render a ToolSummary from a tool's typed digest. Returns null if the digest
 * shape isn't recognized — callers fall back to the legacy output sniffer.
 */
function summaryFromDigest(toolName: string, digest: unknown): ToolSummary | null {
  if (!digest || typeof digest !== 'object') return null
  const d = digest as Record<string, any>
  switch (toolName) {
    case 'find_threads': {
      const count = typeof d.count === 'number' ? d.count : 0
      const subject = d.sample?.[0]?.subject
      if (count === 0) return { summary: 'No threads found' }
      if (count === 1 && typeof subject === 'string') {
        return { summary: `Thread found: "${truncate(subject, 50)}"` }
      }
      return { summary: `${count} threads found` }
    }
    case 'list_drafts': {
      const count = typeof d.count === 'number' ? d.count : 0
      const subject = d.sample?.[0]?.subject
      if (count === 0) return { summary: 'No drafts found' }
      if (count === 1 && typeof subject === 'string') {
        return { summary: `Draft found: "${truncate(subject, 50)}"` }
      }
      return { summary: `${count} drafts found` }
    }
    case 'get_thread_detail': {
      const subject = typeof d.subject === 'string' ? d.subject : undefined
      const msgCount = typeof d.messageCount === 'number' ? d.messageCount : undefined
      if (subject) {
        return {
          summary: `Thread fetched: "${truncate(subject, 50)}"${msgCount ? ` (${msgCount} messages)` : ''}`,
        }
      }
      return { summary: 'Thread details fetched' }
    }
    case 'reply_to_thread':
    case 'start_new_conversation': {
      const mode = d.mode === 'send' ? 'send' : 'draft'
      const verb = toolName === 'reply_to_thread' ? 'Reply' : 'Message'
      if (mode === 'draft') return { summary: `Draft ${verb.toLowerCase()} saved` }
      return { summary: d.status === 'sent' ? `${verb} sent` : `${verb} queued` }
    }
    case 'update_thread': {
      const changes = Array.isArray(d.changes) ? d.changes.join(', ') : ''
      return { summary: changes ? `Thread updated: ${changes}` : 'Thread updated' }
    }
    case 'search_docs':
    case 'search_knowledge': {
      const count = typeof d.articleCount === 'number' ? d.articleCount : 0
      return {
        summary:
          count === 0 ? 'No articles found' : `${count} article${count === 1 ? '' : 's'} found`,
      }
    }
    case 'list_entities': {
      const count = Array.isArray(d.entityTypes) ? d.entityTypes.length : 0
      return { summary: `${count} entity type${count === 1 ? '' : 's'} found` }
    }
    case 'list_entity_fields': {
      const count = typeof d.fieldCount === 'number' ? d.fieldCount : 0
      return { summary: `${count} field${count === 1 ? '' : 's'} listed` }
    }
    case 'search_entities':
    case 'query_records': {
      const count = typeof d.count === 'number' ? d.count : 0
      const sample = Array.isArray(d.sample) ? d.sample : []
      const entities = sample
        .map((s: any) => (typeof s.recordId === 'string' ? { recordId: s.recordId } : null))
        .filter((e: any): e is { recordId: string } => Boolean(e))
      if (count === 0) return { summary: 'No records found', entities: undefined }
      if (count === 1) {
        const name = sample[0]?.displayName ?? '(record)'
        return { summary: `Record found: "${truncate(name, 50)}"`, entities }
      }
      return { summary: `${count} records found`, entities }
    }
    case 'get_entity': {
      const name = typeof d.displayName === 'string' ? d.displayName : ''
      return {
        summary: name ? `Record fetched: "${truncate(name, 50)}"` : 'Record details fetched',
        entities: d.recordId ? [{ recordId: d.recordId }] : undefined,
      }
    }
    case 'update_entity': {
      const fields = Array.isArray(d.updatedFields) ? d.updatedFields.join(', ') : ''
      return {
        summary: fields ? `Record updated: ${fields}` : 'Record updated',
        entities: d.recordId ? [{ recordId: d.recordId }] : undefined,
      }
    }
    case 'create_entity': {
      const name = typeof d.displayName === 'string' ? d.displayName : ''
      return {
        summary: name ? `Record created: "${truncate(name, 50)}"` : 'Record created',
        entities: d.recordId ? [{ recordId: d.recordId }] : undefined,
      }
    }
    case 'create_task': {
      const title = typeof d.title === 'string' ? d.title : ''
      return { summary: title ? `Task created: "${truncate(title, 50)}"` : 'Task created' }
    }
  }
  return null
}

export function summarizeToolResult(
  toolName: string,
  result: unknown,
  digest?: unknown
): ToolSummary {
  if (digest !== undefined) {
    const fromDigest = summaryFromDigest(toolName, digest)
    if (fromDigest) return fromDigest
  }
  const data = result as Record<string, any>
  if (!data || typeof data !== 'object') return { summary: 'Completed' }

  switch (toolName) {
    case 'find_threads': {
      const count = data.count ?? data.threads?.length ?? 0
      const subject = data.threads?.[0]?.subject
      return {
        summary:
          count === 0
            ? 'No threads found'
            : count === 1
              ? `Thread found: "${truncate(subject, 50)}"`
              : `${count} threads found`,
      }
    }

    case 'list_drafts': {
      const count = data.count ?? data.drafts?.length ?? 0
      const subject = data.drafts?.[0]?.subject
      return {
        summary:
          count === 0
            ? 'No drafts found'
            : count === 1
              ? `Draft found: "${truncate(subject, 50)}"`
              : `${count} drafts found`,
      }
    }

    case 'get_thread_detail': {
      const subject = data.thread?.subject
      const msgCount = data.totalMessages ?? data.messages?.length
      return {
        summary: subject
          ? `Thread fetched: "${truncate(subject, 50)}" (${msgCount} messages)`
          : 'Thread details fetched',
      }
    }

    case 'reply_to_thread': {
      const mode = data.mode
      if (mode === 'draft') {
        return { summary: 'Draft reply saved' }
      }
      return { summary: data.status === 'sent' ? 'Reply sent' : 'Reply queued' }
    }

    case 'start_new_conversation': {
      const mode = data.mode
      if (mode === 'draft') {
        return { summary: 'Draft message saved' }
      }
      return { summary: data.status === 'sent' ? 'Message sent' : 'Message queued' }
    }

    case 'update_thread': {
      const changes = Object.keys(data.changes ?? {}).join(', ')
      return {
        summary: changes ? `Thread updated: ${changes}` : 'Thread updated',
      }
    }

    case 'search_kb': {
      const count = data.count ?? data.articles?.length ?? 0
      return {
        summary:
          count === 0 ? 'No articles found' : `${count} article${count > 1 ? 's' : ''} found`,
      }
    }

    case 'list_entities': {
      const count = data.count ?? data.entities?.length ?? 0
      return {
        summary: `${count} entity type${count !== 1 ? 's' : ''} found`,
      }
    }

    case 'list_entity_fields': {
      const count = data.fields?.length ?? 0
      return {
        summary: `${count} field${count !== 1 ? 's' : ''} listed`,
      }
    }

    case 'search_entities': {
      const count = data.count ?? data.items?.length ?? 0
      const items = data.items ?? []
      return {
        summary:
          count === 0
            ? 'No records found'
            : count === 1
              ? `Record found: "${items[0]?.displayName}"`
              : `${count} records found`,
        entities: items.slice(0, 3).map((item: any) => ({
          recordId: item.recordId,
        })),
      }
    }

    case 'get_entity': {
      const name = data.displayName
      return {
        summary: name ? `Record fetched: "${truncate(name, 50)}"` : 'Record details fetched',
        entities: data.recordId ? [{ recordId: data.recordId }] : undefined,
      }
    }

    case 'update_entity': {
      const fields = data.updatedFields?.join(', ')
      return {
        summary: fields ? `Record updated: ${fields}` : 'Record updated',
        entities: data.recordId ? [{ recordId: data.recordId }] : undefined,
      }
    }

    case 'create_entity': {
      const name = data.displayName
      return {
        summary: name ? `Record created: "${truncate(name, 50)}"` : 'Record created',
        entities: data.recordId ? [{ recordId: data.recordId }] : undefined,
      }
    }

    default:
      return { summary: 'Completed' }
  }
}

function truncate(str: string | undefined, max: number): string {
  if (!str) return ''
  return str.length > max ? `${str.slice(0, max)}…` : str
}
