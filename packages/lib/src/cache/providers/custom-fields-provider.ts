// packages/lib/src/cache/providers/custom-fields-provider.ts

import { schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import { ArrayAccessor, NestedRecordAccessor } from '../accessors'
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

  createAccessor(dataFn: () => Promise<Record<string, CustomFieldEntity[]>>) {
    const accessor = new NestedRecordAccessor(dataFn)

    return Object.assign(accessor, {
      // Override .in() to return enhanced group accessor with bySystemAttribute
      in(entityDefId: string) {
        const groupAccessor = new ArrayAccessor<CustomFieldEntity>(async () => {
          const data = await dataFn()
          return data[entityDefId] ?? []
        })
        return Object.assign(groupAccessor, {
          async bySystemAttribute(attr: string): Promise<CustomFieldEntity | null> {
            const fields = await groupAccessor.all()
            return fields.find((f) => f.systemAttribute === attr) ?? null
          },
        })
      },
      // Deep sugar: search by systemAttribute across all entities
      async bySystemAttribute(attr: string): Promise<CustomFieldEntity | null> {
        const data = await dataFn()
        for (const fields of Object.values(data)) {
          const found = fields.find((f) => f.systemAttribute === attr)
          if (found) return found
        }
        return null
      },
      // Batch resolve: single pass through all fields for multiple attributes
      async bySystemAttributes<T extends string>(
        attrs: T[]
      ): Promise<Record<T, CustomFieldEntity | null>> {
        const data = await dataFn()
        const remaining = new Set<T>(attrs)
        const result = Object.fromEntries(attrs.map((a) => [a, null])) as Record<
          T,
          CustomFieldEntity | null
        >
        for (const fields of Object.values(data)) {
          if (remaining.size === 0) break
          for (const f of fields) {
            if (f.systemAttribute && remaining.has(f.systemAttribute as T)) {
              result[f.systemAttribute as T] = f
              remaining.delete(f.systemAttribute as T)
            }
          }
        }
        return result
      },
      // Deep sugar: search by field ID across all entities
      async byId(fieldId: string): Promise<CustomFieldEntity | null> {
        const data = await dataFn()
        for (const fields of Object.values(data)) {
          const found = fields.find((f) => f.id === fieldId)
          if (found) return found
        }
        return null
      },
    })
  },
}
