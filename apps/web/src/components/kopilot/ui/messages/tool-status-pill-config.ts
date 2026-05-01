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
  /** Lucide icon name — resolved to component in the pill */
  icon: string
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

/** Returns config for a tool, or a generic fallback */
export function getToolPillConfig(toolName: string): ToolPillConfig {
  return (
    configs[toolName] ?? {
      icon: 'Wrench',
      labels: {
        running: () => ({ label: formatToolName(toolName) }),
        completed: (_args, summary) => ({
          label: `${formatToolName(toolName)} completed`,
          secondary: summary,
        }),
        error: () => ({ label: `Failed: ${formatToolName(toolName)}` }),
      },
    }
  )
}
