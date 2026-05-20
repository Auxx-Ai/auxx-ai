// apps/web/src/components/kopilot/ui/messages/tool-status-pill-config.ts

export interface ToolPillLabels {
  running: (args: Record<string, unknown>) => { label: string; secondary?: string }
  completed: (
    args: Record<string, unknown>,
    summary?: string
  ) => { label: string; secondary?: string }
  error: () => { label: string }
}

export interface ToolPillConfig {
  /**
   * Lucide icon name for built-in tools that have a per-tool entry below.
   * App-backed tools get their icon from the cached app catalog via the
   * pill's `iconId` prop instead, so this field is optional and unused for
   * the fallback config.
   */
  icon?: string
  labels: ToolPillLabels
}

const configs: Record<string, ToolPillConfig> = {
  find_threads: {
    icon: 'Mail',
    labels: {
      running: (args) => ({
        label: 'Searching threads',
        secondary: args.query ? `"${args.query}"` : undefined,
      }),
      completed: (_args, summary) => ({
        label: 'Threads found',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to search threads' }),
    },
  },
  list_drafts: {
    icon: 'FileEdit',
    labels: {
      running: (args) => ({
        label: 'Listing drafts',
        secondary: args.query ? `"${args.query}"` : undefined,
      }),
      completed: (_args, summary) => ({
        label: 'Drafts listed',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to list drafts' }),
    },
  },
  get_thread_detail: {
    icon: 'MailOpen',
    labels: {
      running: () => ({ label: 'Reading thread' }),
      completed: (_args, summary) => ({
        label: 'Thread fetched',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to read thread' }),
    },
  },
  reply_to_thread: {
    icon: 'PenTool',
    labels: {
      running: (args) => ({
        label: args?.mode === 'send' ? 'Sending reply' : 'Drafting reply',
      }),
      completed: (args, summary) => ({
        label: args?.mode === 'send' ? 'Reply sent' : 'Draft ready',
        secondary: summary,
      }),
      error: () => ({ label: 'Reply failed' }),
    },
  },
  start_new_conversation: {
    icon: 'Send',
    labels: {
      running: (args) => ({
        label: args?.mode === 'send' ? 'Sending message' : 'Drafting message',
      }),
      completed: (args, summary) => ({
        label: args?.mode === 'send' ? 'Message sent' : 'Draft ready',
        secondary: summary,
      }),
      error: () => ({ label: 'Send failed' }),
    },
  },
  update_thread: {
    icon: 'MailCheck',
    labels: {
      running: () => ({ label: 'Updating thread' }),
      completed: (_args, summary) => ({
        label: 'Thread updated',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to update thread' }),
    },
  },
  search_docs: {
    icon: 'BookOpen',
    labels: {
      running: (args) => ({
        label: 'Searching help center',
        secondary: args.objective ? `"${args.objective}"` : undefined,
      }),
      completed: (_args, summary) => ({
        label: 'Help center searched',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to search help center' }),
    },
  },
  search_kb: {
    icon: 'BookOpen',
    labels: {
      running: (args) => ({
        label: 'Searching knowledge base',
        secondary: args.query ? `"${args.query}"` : undefined,
      }),
      completed: (_args, summary) => ({
        label: 'KB searched',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to search knowledge base' }),
    },
  },
  list_entities: {
    icon: 'LayoutGrid',
    labels: {
      running: () => ({ label: 'Listing entity types' }),
      completed: () => ({ label: 'Entity types listed' }),
      error: () => ({ label: 'Failed to list entity types' }),
    },
  },
  list_entity_fields: {
    icon: 'Columns3',
    labels: {
      running: () => ({ label: 'Listing fields' }),
      completed: (_args, summary) => ({
        label: 'Fields listed',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to list fields' }),
    },
  },
  search_entities: {
    icon: 'Search',
    labels: {
      running: (args) => ({
        label: 'Searching records',
        secondary: args.query ? `"${args.query}"` : undefined,
      }),
      completed: (_args, summary) => ({
        label: 'Records found',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to search records' }),
    },
  },
  query_records: {
    icon: 'Database',
    labels: {
      running: () => ({ label: 'Querying records' }),
      completed: (_args, summary) => ({
        label: 'Records queried',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to query records' }),
    },
  },
  get_entity: {
    icon: 'FileText',
    labels: {
      running: () => ({ label: 'Retrieving record' }),
      completed: (_args, summary) => ({
        label: 'Record fetched',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to retrieve record' }),
    },
  },
  create_entity: {
    icon: 'Plus',
    labels: {
      running: () => ({ label: 'Creating record' }),
      completed: (_args, summary) => ({
        label: 'Record created',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to create record' }),
    },
  },
  update_entity: {
    icon: 'Pencil',
    labels: {
      running: () => ({ label: 'Updating record' }),
      completed: (_args, summary) => ({
        label: 'Record updated',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to update record' }),
    },
  },
  bulk_update_entity: {
    icon: 'PencilLine',
    labels: {
      running: () => ({ label: 'Updating records' }),
      completed: (_args, summary) => ({
        label: 'Records updated',
        secondary: summary,
      }),
      error: () => ({ label: 'Failed to update records' }),
    },
  },
}

/** Convert snake_case tool name to a readable label */
function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns config for a tool, or a generic fallback. When the caller passes a
 * `displayName` (resolved via `useToolAppResolver` for app-backed tools), the
 * fallback uses it verbatim — so an app tool like
 * `gog_contacts_search_google_contacts` renders as "Search Google Contacts",
 * not "Gog Contacts Search Google Contacts". The app prefix is conveyed
 * visually by the `<AppIcon>` next to the label.
 */
export function getToolPillConfig(
  toolName: string,
  options?: { displayName?: string }
): ToolPillConfig {
  const existing = configs[toolName]
  if (existing) return existing
  const label = options?.displayName ?? formatToolName(toolName)
  return {
    labels: {
      running: () => ({ label }),
      // Bare `label` here; the secondary slot already carries "Completed"
      // (or a richer per-tool summary) from `summarizeToolResult`, so a
      // `${label} completed` headline would just stack a duplicate.
      completed: (_args, summary) => ({ label, secondary: summary }),
      error: () => ({ label: `Failed: ${label}` }),
    },
  }
}
