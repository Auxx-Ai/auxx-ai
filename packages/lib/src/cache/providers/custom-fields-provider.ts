// packages/lib/src/cache/providers/custom-fields-provider.ts

import { schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes custom fields grouped by entityDefId for an organization */
export const customFieldsProvider: CacheProvider<Record<string, CustomFieldEntity[]>> = {
  async compute(orgId, db) {
    // Get all entity definition IDs for this org
    const entityDefs = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, orgId))

    const entityDefIds = entityDefs.map((e) => e.id)
    if (entityDefIds.length === 0) return {}

    // Fetch all custom fields for these entity definitions
    const fields = await db
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, orgId))

    // Group by entityDefinitionId
    const grouped: Record<string, CustomFieldEntity[]> = {}
    for (const field of fields) {
      const edId = field.entityDefinitionId
      if (!edId) continue
      if (!grouped[edId]) grouped[edId] = []
      grouped[edId].push(field)
    }

    return grouped
  },
}
