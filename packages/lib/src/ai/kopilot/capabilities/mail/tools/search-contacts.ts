// packages/lib/src/ai/kopilot/capabilities/mail/tools/search-contacts.ts

import { RecordPickerService } from '../../../../../resources/picker'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

export function createSearchContactsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_contacts',
    description:
      'Search contacts by name or email address. Returns matching contacts with display name and secondary info.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search by name or email',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const query = args.query as string
      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const pickerService = new RecordPickerService(agentDeps.organizationId, agentDeps.userId, db)

      // Search scoped to contact entity type via apiSlug
      const result = await pickerService.search({
        query,
        limit,
      })

      // Filter to contact-like results and map to simple output
      const contacts = result.items.map((item) => ({
        id: item.id,
        recordId: item.recordId,
        displayName: item.displayName,
        secondaryInfo: item.secondaryInfo ?? null,
        avatarUrl: item.avatarUrl ?? null,
      }))

      return {
        success: true,
        output: { contacts, count: contacts.length },
      }
    },
  }
}
