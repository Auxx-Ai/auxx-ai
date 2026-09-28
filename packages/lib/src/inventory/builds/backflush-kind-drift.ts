// packages/lib/src/inventory/builds/backflush-kind-drift.ts

/**
 * Parts whose standing backflush build legs carry an inventory account their current kind no
 * longer maps to (plans/mrp/13 §7, 17 §5.2): the legs froze the kind when written, so the fix is
 * undo and record again.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { BuildSource } from '../../resources/registry/enum-values'
import { optionalFieldId, systemFields, systemValueJoin } from '../../resources/system-records'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { loadBuildContext, readPartKinds } from './build-queries'
import { guard } from './guard'

const MOVEMENT_PICK = [
  'stock_movement_build',
  'stock_movement_part',
  'stock_movement_gl_account',
] as const

/** How many parts drifted, and which. Reversed builds and reversals are not counted. */
export async function readBackflushKindDrift(
  db: Database,
  organizationId: string
): Promise<Result<{ partCount: number; partIds: string[] }, Error>> {
  return guard(
    async () => {
      const [buildCtx, movementCtx] = await Promise.all([
        loadBuildContext(organizationId),
        systemFields(undefined, organizationId, 'stock_movement', MOVEMENT_PICK),
      ])
      const sourceField = buildCtx?.fields.build_source
      const runField = buildCtx?.fields.build_batch_run
      const legBuild = movementCtx?.fields.stock_movement_build
      const legPart = movementCtx?.fields.stock_movement_part
      const legAccount = movementCtx?.fields.stock_movement_gl_account
      if (!buildCtx || !movementCtx || !sourceField || !runField) return empty()
      if (!legBuild || !legPart || !legAccount) return empty()

      const buildValue = alias(schema.FieldValue, 'drift_leg_build_v')
      const partValue = alias(schema.FieldValue, 'drift_leg_part_v')
      const accountValue = alias(schema.FieldValue, 'drift_leg_account_v')
      const build = alias(schema.EntityInstance, 'drift_build')
      const sourceValue = alias(schema.FieldValue, 'drift_build_source_v')
      const runValue = alias(schema.FieldValue, 'drift_build_run_v')
      const reversalValue = alias(schema.FieldValue, 'drift_reversal_v')
      const reversal = alias(schema.EntityInstance, 'drift_reversal')

      const reversedBy = db
        .select({ one: sql`1` })
        .from(reversalValue)
        .innerJoin(
          reversal,
          and(eq(reversal.id, reversalValue.entityId), isNull(reversal.archivedAt))
        )
        .where(
          and(
            eq(reversalValue.organizationId, organizationId),
            eq(reversalValue.fieldId, optionalFieldId(buildCtx.fields.build_reversal_of)),
            eq(reversalValue.relatedEntityId, build.id)
          )
        )

      const rows = await db
        .selectDistinct({ partId: partValue.relatedEntityId, account: accountValue.valueText })
        .from(schema.EntityInstance)
        .innerJoin(buildValue, systemValueJoin(buildValue, legBuild.id))
        .innerJoin(
          build,
          and(
            eq(build.id, buildValue.relatedEntityId),
            eq(build.organizationId, organizationId),
            isNull(build.archivedAt)
          )
        )
        .innerJoin(
          sourceValue,
          and(
            systemValueJoin(sourceValue, sourceField.id, build),
            eq(sourceValue.optionId, BuildSource.BACKFLUSH)
          )
        )
        // A reversal carries the source but never the run number (45 §4.1).
        .innerJoin(
          runValue,
          and(systemValueJoin(runValue, runField.id, build), isNotNull(runValue.valueNumber))
        )
        .innerJoin(partValue, systemValueJoin(partValue, legPart.id))
        .innerJoin(
          accountValue,
          and(systemValueJoin(accountValue, legAccount.id), isNotNull(accountValue.valueText))
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, movementCtx.defId),
            isNull(schema.EntityInstance.archivedAt),
            notExists(reversedBy)
          )
        )

      const partIds = [...new Set(rows.map((row) => row.partId).filter((id): id is string => !!id))]
      const kinds = await readPartKinds(db, organizationId, partIds)
      const drifted = new Set<string>()
      for (const row of rows) {
        if (!row.partId || !row.account) continue
        const expected = expectedRole(kinds.get(row.partId) ?? null)
        if (expected && expected !== row.account) drifted.add(row.partId)
      }
      return { partCount: drifted.size, partIds: [...drifted] }
    },
    'Failed to read backflush kind drift',
    { organizationId }
  )
}

/** A part now marked `service` has no inventory role; it is not drift this undo can fix. */
function expectedRole(kind: string | null): string | null {
  try {
    return resolveInventoryRoleForPartKind(kind)
  } catch {
    return null
  }
}

function empty() {
  return { partCount: 0, partIds: [] as string[] }
}
