// packages/lib/src/record-rules/store.ts
// Drizzle queries for RecordRule + RecordRuleRun. Functional module — no model class.
// Reads on the hot path go through the org cache (`recordRules` key), not these queries.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { collectConditionFieldIds } from '../conditions/collect-field-ids'
import type { ConditionGroup } from '../conditions/types'
import { BadRequestError, NotFoundError } from '../errors'
import { isMailLensTableId } from '../resources/picker/mail-lens-tables'
import { isSignalKind, isSignalPseudoFieldId } from '../signals/client'
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
  /** The watched signal kind, e.g. `'email:opened'`. Required ⇔ `on === 'signal'`. */
  signalKind?: string | null
  condition: unknown[]
  actions: RecordRuleAction[]
  enabled?: boolean
  /** Managed-feature marker. Set (non-null) ⇔ the row is feature-provisioned + native-capable. */
  managed?: 'inventory' | null
}

/**
 * Reject a rule aimed at mail content (`thread` / `message`).
 *
 * Both are registered system resource TABLES, not `EntityDefinition`s — they have
 * no `EntityInstance` rows, so neither record-rule door can ever reach them: the
 * field-change hook fires from `EntityInstance` field writes, and the lifecycle
 * consumer keys off `<def>:created|deleted` bus events. A rule saved against one
 * is permanently silent — no error, just nothing.
 *
 * The record-type picker already refuses them (they are `type: 'system'` resources
 * and the picker runs with `entityDefinedOnly`), but a picker is not a gate: the
 * router's `entityDefinitionId` is a bare `z.string()`, so this is the only thing
 * standing between a hand-made call and a dead rule. Mail-side automation is what
 * mail filters are for.
 */
export function assertRecordRuleDefSupported(entityDefinitionId: string): void {
  if (isMailLensTableId(entityDefinitionId)) {
    throw new BadRequestError(
      `Record rules cannot target '${entityDefinitionId}' — threads and messages are not records, so the rule could never fire. Use a mail filter instead.`
    )
  }
}

/**
 * Validate a user/DB rule's shape before it is persisted (the tRPC create/update path).
 * Invariants:
 * - fieldId IS NULL ⇔ on ∈ ('created','deleted','signal').
 * - on = 'signal' ⇔ signalKind NOT NULL (and a recognized `SignalKind`) AND fieldId IS NULL.
 * - `native` actions are allowed ONLY on MANAGED rows (`managed != null`) — those are
 *   provisioned by a feature flow, never from user input; user rules can neither declare
 *   native actions nor mix them with others. The tRPC `actionSchema` has no native variant,
 *   keeping the public router doubly-safe.
 * - Conditions referencing a `signal:*` pseudo-field (decision 6) are rejected on any rule
 *   that isn't `on === 'signal'` (decision 15) — they'd resolve `undefined` there, silently
 *   making "is empty" match and firing unexpectedly.
 */
export function assertRuleShape(
  input: Pick<RecordRuleInput, 'fieldId' | 'on' | 'actions' | 'signalKind'> & {
    managed?: 'inventory' | null
    /** Optional here (some server-only callers, e.g. `createManagedRecordRule`, omit it). */
    condition?: RecordRuleInput['condition']
  }
): void {
  const isSignal = input.on === 'signal'
  const isLifecycle = LIFECYCLE_TRANSITIONS.includes(input.on)

  if (isSignal) {
    if (input.fieldId) {
      throw new BadRequestError("A 'signal' rule must not have a fieldId")
    }
    if (!input.signalKind) {
      throw new BadRequestError("A 'signal' rule requires a signalKind")
    }
    if (!isSignalKind(input.signalKind)) {
      throw new BadRequestError(`Unknown signal kind '${input.signalKind}'`)
    }
  } else {
    if (input.signalKind) {
      throw new BadRequestError("signalKind is only valid on a 'signal' rule")
    }
    if (isLifecycle && input.fieldId) {
      throw new BadRequestError(`A '${input.on}' rule must not have a fieldId`)
    }
    if (!isLifecycle && !input.fieldId) {
      throw new BadRequestError(`A '${input.on}' rule requires a fieldId`)
    }
    if (!FIELD_TRANSITIONS.includes(input.on) && !isLifecycle) {
      throw new BadRequestError(`Unknown transition '${input.on}'`)
    }
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new BadRequestError('A rule needs at least one action')
  }
  if (hasNativeAction(input.actions) && !input.managed) {
    throw new BadRequestError('Native actions are server-declared only')
  }

  if (!isSignal && input.condition && input.condition.length > 0) {
    const { fieldRefs } = collectConditionFieldIds(input.condition as ConditionGroup[])
    const staleRef = fieldRefs.find((ref) => isSignalPseudoFieldId(ref))
    if (staleRef) {
      throw new BadRequestError(
        `Condition references signal field '${staleRef}' on a non-signal rule`
      )
    }
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
  assertRecordRuleDefSupported(input.entityDefinitionId)
  assertRuleShape(input)
  const [row] = await db
    .insert(schema.RecordRule)
    .values({
      organizationId,
      entityDefinitionId: input.entityDefinitionId,
      fieldId: input.fieldId,
      name: input.name,
      on: input.on,
      signalKind: input.signalKind ?? null,
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
  // Only the INCOMING def is validated: re-pointing a rule at mail content is the
  // write this closes. Validating `existing` too would strand a legacy row — a
  // plain `setEnabled` (which sends no def) could no longer even disable it.
  if (input.entityDefinitionId !== undefined) {
    assertRecordRuleDefSupported(input.entityDefinitionId)
  }

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
    signalKind: input.signalKind !== undefined ? input.signalKind : existing.signalKind,
    condition: (input.condition ?? existing.condition) as unknown[],
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
      ...(input.signalKind !== undefined && { signalKind: input.signalKind }),
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
  signalKind?: string | null
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
    signalKind: row.signalKind ?? null,
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
  await insertRecordRuleRuns(db, [input])
}

/** Batch variant: one INSERT for a whole native-rule firing (one row per record). */
export async function insertRecordRuleRuns(db: Database, inputs: RecordRuleRunInput[]) {
  if (inputs.length === 0) return
  await db.insert(schema.RecordRuleRun).values(
    inputs.map((input) => ({
      organizationId: input.organizationId,
      ruleId: input.ruleId,
      entityInstanceId: input.entityInstanceId,
      source: input.source,
      fieldId: input.fieldId ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      outcomes: input.outcomes,
      status: input.status,
    }))
  )
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
