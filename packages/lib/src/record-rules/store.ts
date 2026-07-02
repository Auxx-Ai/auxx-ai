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
  /** Managed-feature marker. Set (non-null) ⇔ the row is feature-provisioned + native-capable. */
  managed?: 'inventory' | null
}

/**
 * Validate a user/DB rule's shape before it is persisted (the tRPC create/update path).
 * Invariant: fieldId IS NULL ⇔ on ∈ ('created','deleted'). `native` actions are allowed
 * ONLY on MANAGED rows (`managed != null`) — those are provisioned by a feature flow, never
 * from user input; user rules can neither declare native actions nor mix them with others.
 * The tRPC `actionSchema` has no native variant, keeping the public router doubly-safe.
 */
export function assertRuleShape(
  input: Pick<RecordRuleInput, 'fieldId' | 'on' | 'actions'> & { managed?: 'inventory' | null }
): void {
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
  if (hasNativeAction(input.actions) && !input.managed) {
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

/** Load one rule by id (org-scoped). Returns undefined when absent. */
export async function getRecordRuleById(db: Database, organizationId: string, ruleId: string) {
  const [row] = await db
    .select()
    .from(schema.RecordRule)
    .where(
      and(eq(schema.RecordRule.id, ruleId), eq(schema.RecordRule.organizationId, organizationId))
    )
    .limit(1)
  return row
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

export interface ManagedRecordRuleInput {
  entityDefinitionId: string
  fieldId: string | null
  name: string
  on: RecordRuleOn
  condition?: unknown[]
  actions: RecordRuleAction[]
  managed: 'inventory'
  enabled?: boolean
}

/**
 * Server-only: create a MANAGED rule (native-capable, edit/delete-locked in the UI). Bypasses
 * the public zod `actionSchema` (which has no native variant) by construction — only feature
 * flows call this. `assertRuleShape` is invoked WITH the managed marker so native actions pass.
 */
export async function createManagedRecordRule(
  db: Database,
  organizationId: string,
  input: ManagedRecordRuleInput
) {
  assertRuleShape({
    fieldId: input.fieldId,
    on: input.on,
    actions: input.actions,
    managed: input.managed,
  })
  const [row] = await db
    .insert(schema.RecordRule)
    .values({
      organizationId,
      entityDefinitionId: input.entityDefinitionId,
      fieldId: input.fieldId,
      name: input.name,
      on: input.on,
      condition: input.condition ?? [],
      actions: input.actions,
      managed: input.managed,
      enabled: input.enabled ?? true,
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
    // Managed rows carry native actions; preserve the marker so re-validation (e.g. a
    // `setEnabled`-only update) doesn't reject their existing native actions.
    managed: existing.managed as 'inventory' | null,
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

/**
 * Find the managed rule for a `(def, field)` source under a given feature marker, if any.
 * Used by feature flows to make provisioning idempotent (ensure-once).
 */
export async function findManagedRecordRule(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string,
  managed: 'inventory'
) {
  const [row] = await db
    .select()
    .from(schema.RecordRule)
    .where(
      and(
        eq(schema.RecordRule.organizationId, organizationId),
        eq(schema.RecordRule.entityDefinitionId, entityDefinitionId),
        eq(schema.RecordRule.fieldId, fieldId),
        eq(schema.RecordRule.managed, managed)
      )
    )
    .limit(1)
  return row
}

/** Delete every managed rule for a def under a feature marker (feature teardown). */
export async function deleteManagedRecordRulesForDef(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  managed: 'inventory'
): Promise<number> {
  const rows = await db
    .delete(schema.RecordRule)
    .where(
      and(
        eq(schema.RecordRule.organizationId, organizationId),
        eq(schema.RecordRule.entityDefinitionId, entityDefinitionId),
        eq(schema.RecordRule.managed, managed)
      )
    )
    .returning({ id: schema.RecordRule.id })
  return rows.length
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
  managed?: string | null
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
    managed: (row.managed as 'inventory' | null | undefined) ?? null,
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
