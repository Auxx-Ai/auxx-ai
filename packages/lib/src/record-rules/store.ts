// packages/lib/src/record-rules/store.ts
// Drizzle queries for RecordRule + RecordRuleRun. Functional module — no model class.
// Reads on the hot path go through the org cache (`recordRules` key), not these queries.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import type {
  CachedRecordRule,
  RecordRuleAction,
  RecordRuleActionOutcome,
  RecordRuleOn,
} from './types'
import { FIELD_TRANSITIONS, hasNativeAction, LIFECYCLE_TRANSITIONS } from './types'

export interface RecordRuleInput {
  entityDefinitionId: string
  fieldId: string | null
  name: string
  on: RecordRuleOn
  condition: unknown[]
  actions: RecordRuleAction[]
  enabled?: boolean
}

/**
 * Validate a user/DB rule's shape before it is persisted (the tRPC create/update path).
 * Invariant: fieldId IS NULL ⇔ on ∈ ('created','deleted'). Also rejects `native` actions
 * — those are server-declared only (system rules, see `system-rules.ts`); user rules can
 * neither declare them nor mix them with other actions.
 */
export function assertRuleShape(input: Pick<RecordRuleInput, 'fieldId' | 'on' | 'actions'>): void {
  const isLifecycle = LIFECYCLE_TRANSITIONS.includes(input.on)
  if (isLifecycle && input.fieldId) {
    throw new BadRequestError(`A '${input.on}' rule must not have a fieldId`)
  }
  if (!isLifecycle && !input.fieldId) {
    throw new BadRequestError(`A '${input.on}' rule requires a fieldId`)
  }
  if (!FIELD_TRANSITIONS.includes(input.on) && !isLifecycle) {
    throw new BadRequestError(`Unknown transition '${input.on}'`)
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new BadRequestError('A rule needs at least one action')
  }
  if (hasNativeAction(input.actions)) {
    throw new BadRequestError('Native actions are server-declared only')
  }
}

export async function listRecordRules(db: Database, organizationId: string) {
  return db
    .select()
    .from(schema.RecordRule)
    .where(eq(schema.RecordRule.organizationId, organizationId))
    .orderBy(desc(schema.RecordRule.createdAt))
}

export async function createRecordRule(
  db: Database,
  organizationId: string,
  input: RecordRuleInput,
  createdByUserId?: string
) {
  assertRuleShape(input)
  const [row] = await db
    .insert(schema.RecordRule)
    .values({
      organizationId,
      entityDefinitionId: input.entityDefinitionId,
      fieldId: input.fieldId,
      name: input.name,
      on: input.on,
      condition: input.condition,
      actions: input.actions,
      enabled: input.enabled ?? true,
      createdByUserId: createdByUserId ?? null,
    })
    .returning()
  return row
}

export async function updateRecordRule(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: Partial<RecordRuleInput>
) {
  const [existing] = await db
    .select()
    .from(schema.RecordRule)
    .where(
      and(eq(schema.RecordRule.id, ruleId), eq(schema.RecordRule.organizationId, organizationId))
    )
  if (!existing) throw new NotFoundError('Rule not found')

  const next = {
    fieldId: input.fieldId !== undefined ? input.fieldId : existing.fieldId,
    on: input.on ?? (existing.on as RecordRuleOn),
    actions: (input.actions ?? existing.actions) as RecordRuleAction[],
  }
  assertRuleShape(next)

  const [row] = await db
    .update(schema.RecordRule)
    .set({
      ...(input.entityDefinitionId !== undefined && {
        entityDefinitionId: input.entityDefinitionId,
      }),
      ...(input.fieldId !== undefined && { fieldId: input.fieldId }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.on !== undefined && { on: input.on }),
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.actions !== undefined && { actions: input.actions }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.RecordRule.id, ruleId), eq(schema.RecordRule.organizationId, organizationId))
    )
    .returning()
  return row
}

export async function deleteRecordRule(db: Database, organizationId: string, ruleId: string) {
  const rows = await db
    .delete(schema.RecordRule)
    .where(
      and(eq(schema.RecordRule.id, ruleId), eq(schema.RecordRule.organizationId, organizationId))
    )
    .returning({ id: schema.RecordRule.id })
  if (rows.length === 0) throw new NotFoundError('Rule not found')
}

/** Narrow a DB row to the serializable cache shape. */
export function dehydrateRecordRule(row: {
  id: string
  organizationId: string
  entityDefinitionId: string
  fieldId: string | null
  name: string
  on: string
  condition: unknown
  actions: unknown
  enabled: boolean
}): CachedRecordRule {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityDefinitionId: row.entityDefinitionId,
    fieldId: row.fieldId,
    name: row.name,
    on: row.on as RecordRuleOn,
    condition: Array.isArray(row.condition) ? (row.condition as CachedRecordRule['condition']) : [],
    actions: Array.isArray(row.actions) ? (row.actions as RecordRuleAction[]) : [],
    enabled: row.enabled,
  }
}

export interface RecordRuleRunInput {
  organizationId: string
  ruleId: string
  entityInstanceId: string
  source: 'interactive' | 'sync'
  fieldId?: string | null
  oldValue?: unknown
  newValue?: unknown
  outcomes: RecordRuleActionOutcome[]
  status: 'ok' | 'partial' | 'failed'
}

/** Best-effort execution log — a failed insert must never break the firing. */
export async function insertRecordRuleRun(db: Database, input: RecordRuleRunInput) {
  await db.insert(schema.RecordRuleRun).values({
    organizationId: input.organizationId,
    ruleId: input.ruleId,
    entityInstanceId: input.entityInstanceId,
    source: input.source,
    fieldId: input.fieldId ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    outcomes: input.outcomes,
    status: input.status,
  })
}

export async function listRecordRuleRuns(
  db: Database,
  organizationId: string,
  ruleId: string,
  limit = 50
) {
  return db
    .select()
    .from(schema.RecordRuleRun)
    .where(
      and(
        eq(schema.RecordRuleRun.organizationId, organizationId),
        eq(schema.RecordRuleRun.ruleId, ruleId)
      )
    )
    .orderBy(desc(schema.RecordRuleRun.firedAt))
    .limit(limit)
}
