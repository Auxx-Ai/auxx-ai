// apps/web/src/components/kopilot/ui/blocks/summarize-tool-result.ts

export interface ToolSummary {
  /** Human-readable one-liner */
  summary: string
  /** Optional entity references for inline badges */
  entities?: Array<{ recordId: string }>
}

export function summarizeToolResult(toolName: string, result: unknown): ToolSummary {
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

    case 'get_thread_detail': {
      const subject = data.thread?.subject
      const msgCount = data.totalMessages ?? data.messages?.length
      return {
        summary: subject
          ? `Thread fetched: "${truncate(subject, 50)}" (${msgCount} messages)`
          : 'Thread details fetched',
      }
    }

    case 'draft_reply': {
      const subject = data.subject
      return {
        summary: subject ? `Draft saved: "${truncate(subject, 50)}"` : 'Draft reply saved',
      }
    }

    case 'send_reply': {
      return {
        summary: data.status === 'sent' ? 'Reply sent' : 'Reply queued',
      }
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
