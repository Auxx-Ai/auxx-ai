// packages/lib/src/data-migrations/migrations/190-parts-and-services.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { PartKind } from '../../resources/registry/enum-values'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:190')

const CACHE_KEYS = ['customFields', 'resources'] as const

/** Held as literals: these are the values matched on, not whatever the registry says later. */
const OLD_LABELS = { singular: 'Part', plural: 'Parts' } as const
const NEW_LABELS = { singular: 'Item', plural: 'Parts & Services' } as const

interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** `stored` with the `service` option appended, or `null` when it is already there. Pure. */
export function withServiceOption(stored: readonly StoredOption[]): StoredOption[] | null {
  if (stored.some((option) => option.value === PartKind.SERVICE)) return null
  const service = PartKind.values.find((option) => option.value === PartKind.SERVICE)
  if (!service) throw new Error('registry is missing part_kind.service')
  return [...stored, { ...service }]
}

/** The label patch for a part def, or `null`. A label an org renamed itself is kept. */
export function partLabelPatch(current: {
  singular: string
  plural: string
}): Partial<Record<'singular' | 'plural', string>> | null {
  const patch: Partial<Record<'singular' | 'plural', string>> = {}
  if (current.singular === OLD_LABELS.singular) patch.singular = NEW_LABELS.singular
  if (current.plural === OLD_LABELS.plural) patch.plural = NEW_LABELS.plural
  return Object.keys(patch).length > 0 ? patch : null
}

export interface Migration190Result extends PerOrgMigrationResult {
  labelsRenamed: boolean
  serviceOptionAdded: boolean
}

/**
 * Migration 190: the part def becomes "Parts & Services" / "Item", and `part_kind` gains
 * `service` (plans/accounting/tasks/107-parts-and-services.md D1, D2). `ensureCustomFields`
 * never rewrites an existing field's options, so the option is appended here.
 *
 * Idempotent: both halves compare before writing.
 */
export const migration190PartsAndServices: PerOrgMigration = {
  id: '190-parts-and-services',
  description:
    'Relabels the part definition "Parts & Services" (singular "Item") and adds the ' +
    '`service` option to part_kind (107 D1, D2).',

  async up(db: Database, organizationId: string): Promise<Migration190Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const [def] = await db
      .select({
        id: schema.EntityDefinition.id,
        singular: schema.EntityDefinition.singular,
        plural: schema.EntityDefinition.plural,
      })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'part')
        )
      )
      .limit(1)
    if (!def) {
      return { ...state, alreadyUpToDate: true, labelsRenamed: false, serviceOptionAdded: false }
    }

    let labelsRenamed = false
    const patch = partLabelPatch(def)
    if (patch) {
      await db
        .update(schema.EntityDefinition)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(schema.EntityDefinition.id, def.id),
            eq(schema.EntityDefinition.organizationId, organizationId)
          )
        )
      labelsRenamed = true
    }

    let serviceOptionAdded = false
    const kindField = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, def.id),
        eq(schema.CustomField.systemAttribute, 'part_kind')
      ),
      columns: { id: true, options: true },
    })
    const stored = (kindField?.options as { options?: StoredOption[] } | null)?.options
    if (kindField && Array.isArray(stored)) {
      const next = withServiceOption(stored)
      if (next) {
        await db
          .update(schema.CustomField)
          .set({
            options: { ...(kindField.options as Record<string, unknown>), options: next },
            updatedAt: new Date(),
          })
          .where(eq(schema.CustomField.id, kindField.id))
        serviceOptionAdded = true
      }
    }

    const changed = labelsRenamed || serviceOptionAdded
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 190 applied', { organizationId, labelsRenamed, serviceOptionAdded })
    }

    return { ...state, alreadyUpToDate: !changed, labelsRenamed, serviceOptionAdded }
  },
}
