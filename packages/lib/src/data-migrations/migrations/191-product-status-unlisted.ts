// packages/lib/src/data-migrations/migrations/191-product-status-unlisted.ts
// see plans/apps/shopify/shopify-v3-graphql-plan.md §0 D10, §6.3

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:191')

const PRODUCT_STATUS_ATTRIBUTE = 'product_status'

/** A literal, not `ProductStatus`: this is what the migration writes, whatever the registry says later. */
const UNLISTED_OPTION = { value: 'unlisted', label: 'Unlisted', color: 'blue' }

/** The direct `CustomField` write bypasses the org cache, and `up()` also runs outside the adapter. */
const CACHE_KEYS = ['customFields', 'resources'] as const

interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** `stored` with `unlisted` placed after `active` (appended if absent), or `null` when present. Pure. */
export function withUnlistedOption(stored: readonly StoredOption[]): StoredOption[] | null {
  if (stored.some((option) => option.value === UNLISTED_OPTION.value)) return null
  const activeIndex = stored.findIndex((option) => option.value === 'active')
  const at = activeIndex === -1 ? stored.length : activeIndex + 1
  return [...stored.slice(0, at), { ...UNLISTED_OPTION }, ...stored.slice(at)]
}

/** Migration 191: the `unlisted` product status (Shopify `UNLISTED`) on every org's stored options. */
export const migration191ProductStatusUnlisted: PerOrgMigration = {
  id: '191-product-status-unlisted',
  description:
    "Adds the 'unlisted' option to product_status, so Shopify UNLISTED products land (D10)",

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const field = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.modelType, 'product'),
        eq(schema.CustomField.systemAttribute, PRODUCT_STATUS_ATTRIBUTE)
      ),
      columns: { id: true, options: true },
    })
    if (!field) return { ...state, alreadyUpToDate: true }

    const stored = (field.options as { options?: StoredOption[] } | null)?.options
    if (!Array.isArray(stored)) return { ...state, alreadyUpToDate: true }

    const next = withUnlistedOption(stored)
    if (!next) return { ...state, alreadyUpToDate: true }

    await db
      .update(schema.CustomField)
      .set({
        options: { ...(field.options as Record<string, unknown>), options: next },
        updatedAt: new Date(),
      })
      .where(eq(schema.CustomField.id, field.id))

    await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
    logger.info('Migration 191 applied', { organizationId })

    return { ...state, alreadyUpToDate: false }
  },
}
