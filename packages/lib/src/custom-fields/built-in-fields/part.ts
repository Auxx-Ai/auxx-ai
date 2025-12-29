// packages/lib/src/custom-fields/built-in-fields/part.ts

import { FieldType } from '@auxx/database/enums'
import type { BuiltInFieldRegistry } from './types'

/**
 * Built-in field handlers for Part model
 */
export const partBuiltInFields: BuiltInFieldRegistry = {
  title: {
    id: 'title',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { updatePart } = await import('@auxx/services/parts')
      await updatePart({ id: entityId, organizationId, title: value })
    },
  },

  sku: {
    id: 'sku',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { updatePart } = await import('@auxx/services/parts')
      await updatePart({ id: entityId, organizationId, sku: value })
    },
  },

  description: {
    id: 'description',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { updatePart } = await import('@auxx/services/parts')
      await updatePart({ id: entityId, organizationId, description: value })
    },
  },

  category: {
    id: 'category',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { updatePart } = await import('@auxx/services/parts')
      await updatePart({ id: entityId, organizationId, category: value })
    },
  },

  hsCode: {
    id: 'hsCode',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { updatePart } = await import('@auxx/services/parts')
      await updatePart({ id: entityId, organizationId, hsCode: value })
    },
  },
}
