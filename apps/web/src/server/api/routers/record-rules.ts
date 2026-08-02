// apps/web/src/server/api/routers/record-rules.ts
// tRPC surface for record rules ("when field X changes / record created/deleted →
// conditions → actions"). Thin validated edge over @auxx/lib/record-rules; rule CRUD is
// admin-gated. Mutations bust the `recordRules` org cache via `record-rule.changed`.

import type { Database } from '@auxx/database'
import { getCachedCustomFields, onCacheEvent } from '@auxx/lib/cache'
import { ForbiddenError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  assertRecordRuleDefSupported,
  createRecordRule,
  deleteRecordRule,
  getRecordRuleById,
  LIFECYCLE_TRANSITIONS,
  listRecordRuleRuns,
  listRecordRules,
  type RecordRuleAction,
  type RecordRuleOn,
  resolveFieldRefToId,
  updateRecordRule,
} from '@auxx/lib/record-rules'
// Server-only tRPC router — safe to import the full `@auxx/lib/signals` barrel (not
// `/client`); the client-vs-server import rule only gates client components.
import { SIGNAL_KIND_LIST } from '@auxx/lib/signals'
import { assertWorkflowAppNotSystemOwned } from '@auxx/lib/workflows'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure, protectedProcedure } from '~/server/api/trpc'

/** Managed rules (inventory-source setup, …) are edit/delete-locked; only `enabled` toggles. */
async function assertNotManaged(
  db: Parameters<typeof getRecordRuleById>[0],
  organizationId: string,
  ruleId: string
): Promise<void> {
  const rule = await getRecordRuleById(db, organizationId, ruleId)
  if (rule?.managed) {
    throw new ForbiddenError(
      'This rule is managed by a feature setup and cannot be edited or deleted here.'
    )
  }
}

const onSchema = z.enum([
  'changed',
  'increased',
  'decreased',
  'set',
  'cleared',
  'created',
  'deleted',
  'signal',
])

const signalKindSchema = z.enum(SIGNAL_KIND_LIST as [string, ...string[]])

/** Mirrors the task router's `prioritySchema` (`apps/web/src/server/api/routers/task.ts`). */
const taskPrioritySchema = z.enum(['low', 'medium', 'high'])

/**
 * Structural validation only for the token-bearing action fields (Tiptap docs with
 * `placeholder` nodes — plans/signals/07-action-placeholders.md). The deep walk happens
 * in the lib resolver at execution; mirrors `promptDocSchema` (promptTemplate router).
 */
const actionDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.unknown()).optional(),
})

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set-field'), fieldRef: z.string().min(1), value: z.unknown() }),
  z.object({ type: z.literal('enqueue-workflow'), workflowAppId: z.string().min(1) }),
  z.object({
    type: z.literal('notify'),
    userIds: z.array(z.string().min(1)).min(1),
    message: actionDocSchema,
  }),
  z.object({
    type: z.literal('create-task'),
    title: actionDocSchema,
    assigneeIds: z.array(z.string().min(1)).optional(),
    deadlineDays: z.number().int().positive().max(365).optional(),
    priority: taskPrioritySchema.optional(),
    autoCompleteOn: z.literal('contact_reply').optional(),
  }),
])

const ruleInputSchema = z.object({
  entityDefinitionId: z.string().min(1),
  /** Field row id OR systemAttribute — normalized to the row id server-side. */
  fieldRef: z.string().min(1).nullable(),
  name: z.string().min(1).max(200),
  on: onSchema,
  /** The watched signal kind, e.g. `'email:opened'`. Required ⇔ `on === 'signal'`. */
  signalKind: signalKindSchema.nullable().optional(),
  condition: z.array(z.record(z.string(), z.unknown())).default([]),
  actions: z.array(actionSchema).min(1),
  enabled: z.boolean().default(true),
})

/**
 * `enqueue-workflow` actions reference a `workflowAppId` picked from a
 * (filtered) dropdown, but the id is still user-supplied input — reject any
 * that resolve to a system-owned app (Sequences plan §3.4) as defense in depth.
 */
async function assertActionsWorkflowsAccessible(
  db: Database,
  organizationId: string,
  actions: readonly { type: string; workflowAppId?: string }[]
): Promise<void> {
  for (const action of actions) {
    if (action.type === 'enqueue-workflow' && action.workflowAppId) {
      await assertWorkflowAppNotSystemOwned(db, {
        workflowAppId: action.workflowAppId,
        organizationId,
      })
    }
  }
}

async function normalizeFieldRef(
  organizationId: string,
  input: { entityDefinitionId: string; fieldRef: string | null; on: RecordRuleOn }
): Promise<string | null> {
  // Signal-door rules (like lifecycle rules) have no watched field.
  if (input.on === 'signal' || LIFECYCLE_TRANSITIONS.includes(input.on)) return null
  if (!input.fieldRef) return null // store-level validation rejects with a clear error
  return resolveFieldRefToId(organizationId, input.entityDefinitionId, input.fieldRef)
}

export const recordRulesRouter = createTRPCRouter({
  /**
   * All rules for the org (settings list), enriched with a UI-friendly field ref
   * (`systemAttribute ?? id` — round-trips through the edit dialog's field select)
   * and the field's display name.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.organizationId
    const rules = await listRecordRules(ctx.db, organizationId)
    return Promise.all(
      rules.map(async (rule) => {
        if (!rule.fieldId) return { ...rule, fieldRef: null, fieldLabel: null }
        const fields = await getCachedCustomFields(organizationId, rule.entityDefinitionId)
        const field = fields.find((f) => f.id === rule.fieldId)
        return {
          ...rule,
          fieldRef: field ? (field.systemAttribute ?? field.id) : rule.fieldId,
          fieldLabel: field?.name ?? null,
        }
      })
    )
  }),

  /** Recent runs for one rule (debugging view). */
  runs: protectedProcedure
    .input(z.object({ ruleId: z.string(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) =>
      listRecordRuleRuns(ctx.db, ctx.session.organizationId, input.ruleId, input.limit)
    ),

  create: permissionProcedure(PermissionKey.automationRulesManage)
    .input(ruleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      // Ahead of `normalizeFieldRef`, which would otherwise resolve a field ref
      // against mail content and report the wrong reason for the refusal. The
      // store re-asserts this — the picker's exclusion is not the gate.
      assertRecordRuleDefSupported(input.entityDefinitionId)
      await assertActionsWorkflowsAccessible(ctx.db, organizationId, input.actions)
      const fieldId = await normalizeFieldRef(organizationId, input)
      const rule = await createRecordRule(
        ctx.db,
        organizationId,
        {
          entityDefinitionId: input.entityDefinitionId,
          fieldId,
          name: input.name,
          on: input.on,
          signalKind: input.signalKind ?? null,
          condition: input.condition,
          actions: input.actions as RecordRuleAction[],
          enabled: input.enabled,
        },
        ctx.session.userId
      )
      await onCacheEvent('record-rule.changed', { orgId: organizationId })
      return rule
    }),

  update: permissionProcedure(PermissionKey.automationRulesManage)
    .input(ruleInputSchema.partial().extend({ ruleId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const { ruleId, fieldRef, actions, ...rest } = input
      if (rest.entityDefinitionId !== undefined) {
        assertRecordRuleDefSupported(rest.entityDefinitionId)
      }
      await assertNotManaged(ctx.db, organizationId, ruleId)
      if (actions) {
        await assertActionsWorkflowsAccessible(ctx.db, organizationId, actions)
      }
      const fieldId =
        fieldRef !== undefined && rest.entityDefinitionId && rest.on
          ? await normalizeFieldRef(organizationId, {
              entityDefinitionId: rest.entityDefinitionId,
              fieldRef,
              on: rest.on,
            })
          : undefined
      const rule = await updateRecordRule(ctx.db, organizationId, ruleId, {
        ...rest,
        ...(fieldId !== undefined && { fieldId }),
        ...(actions && { actions: actions as RecordRuleAction[] }),
      })
      await onCacheEvent('record-rule.changed', { orgId: organizationId })
      return rule
    }),

  /** Quick enable/disable without touching the rest of the rule. */
  setEnabled: permissionProcedure(PermissionKey.automationRulesManage)
    .input(z.object({ ruleId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const rule = await updateRecordRule(ctx.db, organizationId, input.ruleId, {
        enabled: input.enabled,
      })
      await onCacheEvent('record-rule.changed', { orgId: organizationId })
      return rule
    }),

  delete: permissionProcedure(PermissionKey.automationRulesManage)
    .input(z.object({ ruleId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      await assertNotManaged(ctx.db, organizationId, input.ruleId)
      await deleteRecordRule(ctx.db, organizationId, input.ruleId)
      await onCacheEvent('record-rule.changed', { orgId: organizationId })
    }),
})
