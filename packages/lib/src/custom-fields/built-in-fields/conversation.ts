// packages/lib/src/custom-fields/built-in-fields/conversation.ts

import { FieldType } from '@auxx/database/enums'
import type { BuiltInFieldRegistry } from './types'

/**
 * Built-in field handlers for Conversation model
 */
export const conversationBuiltInFields: BuiltInFieldRegistry = {
  subject: {
    id: 'subject',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      // TODO: Implement when ConversationService is ready
    },
  },

  status: {
    id: 'status',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      // TODO: Implement when ConversationService is ready
    },
  },
}
