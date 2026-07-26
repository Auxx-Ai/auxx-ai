// apps/web/src/server/api/routers/sequence.ts
// tRPC surface for Sequences (outbound email cadences — Sequences plan Phase 3).
// Thin, validated edge over @auxx/lib/sequences: every procedure resolves org via
// ctx.session, unwraps the domain layer's neverthrow Results into TRPCErrors, and
// enforces per-sequence ResourceAccess (plan §10 — reads need 'view', step/settings
// mutations 'edit', delete 'admin'; only the org OWNER short-circuits, inside
// checkSequenceAccess/hasPermission; `create` is open to all members).

import { type Database, schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { getOrgCache } from '@auxx/lib/cache'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import { AuxxError } from '@auxx/lib/errors'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import {
  checkSequenceAccess,
  createSequence,
  createStep,
  deleteSequence,
  deleteStep,
  deriveSubjectKindFromTrigger,
  enrollRecipients,
  getSequence,
  getSequenceStats,
  listRuns,
  listSequences,
  manualExitRun,
  publishSequence,
  reorderStep,
  SEQUENCE_ENROLL_MAX_RECIPIENTS,
  SEQUENCE_SEED_TEMPLATES,
  SEQUENCE_TRIGGER_TYPES,
  type SequenceEntity,
  updateSequence,
  updateStep,
} from '@auxx/lib/sequences'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/** Protected procedure that requires the organization to have Sequences enabled. */
const sequenceProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.sequences
  )
  return next()
})

// ── Shared zod shapes ─────────────────────────────────────────────────────────

/** `HH:MM` 24h delivery-window bound. */
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM')

const triggerTypeSchema = z.enum(SEQUENCE_TRIGGER_TYPES)

const updateSequenceFieldsSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  integrationId: z.string().min(1).optional(),
  signatureEntityInstanceId: z.string().nullable().optional(),
  deliveryStartTime: timeOfDaySchema.nullable().optional(),
  deliveryEndTime: timeOfDaySchema.nullable().optional(),
  deliveryTimezone: z.string().nullable().optional(),
  deliveryBusinessDaysOnly: z.boolean().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  // Client-notifications plan §4.7 — `subjectKind` is intentionally NOT accepted here; the
  // router re-derives it from `triggerType` (see `update` below) so the two columns can never
  // desync from a client-supplied mismatch.
  triggerType: triggerTypeSchema.optional(),
  exitOnReply: z.boolean().optional(),
  respectSuppression: z.boolean().optional(),
  includeUnsubscribeFooter: z.boolean().optional(),
  enrollmentFilter: conditionGroupsSchema.nullable().optional(),
})

const updateStepFieldsSchema = z.object({
  subject: z.string().nullable().optional(),
  bodyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  delayDays: z.number().int().min(0).optional(),
  delayHours: z.number().int().min(0).optional(),
  attachmentIds: z.array(z.string()).optional(),
  timingMode: z.enum(['relative', 'anchor']).optional(),
  // Signed day offset from the subject's anchor date — negative = before (§4.2). No min/max.
  anchorOffsetDays: z.number().int().optional(),
  anchorTimeOfDay: timeOfDaySchema.nullable().optional(),
})

const runStatusSchema = z.enum(['active', 'completed', 'exited', 'failed'])

/** Canonical row order for the seeded templates (§4.6) — drives `listTemplates`'s sort so the
 * "Client notifications" settings page always lists them in the plan's documented order. */
const SEEDED_TEMPLATE_ORDER = SEQUENCE_SEED_TEMPLATES.map((t) => t.templateKey)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Unwrap a neverthrow `Result` from the sequences domain layer — AuxxError
 * causes keep their status-derived code via `auxxErrorMiddleware` (rethrown),
 * anything else becomes a BAD_REQUEST with the domain message.
 */
function unwrap<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    if (result.error instanceof AuxxError) throw result.error
    throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message })
  }
  return result.value
}

type SequenceSessionCtx = {
  db: Database
  session: { organizationId: string; userId: string }
}

/** Throw FORBIDDEN unless the user holds `required` on the sequence (org admins pass). */
async function requireSequenceAccess(
  ctx: SequenceSessionCtx,
  sequenceId: string,
  required: ResourcePermission
): Promise<void> {
  const allowed = await checkSequenceAccess(
    { db: ctx.db, organizationId: ctx.session.organizationId },
    sequenceId,
    ctx.session.userId,
    required
  )
  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this sequence',
    })
  }
}

/** Resolve a step to its parent sequence id (org-scoped) — the access anchor for step mutations. */
async function getStepSequenceId(ctx: SequenceSessionCtx, stepId: string): Promise<string> {
  const step = await ctx.db.query.SequenceStep.findFirst({
    where: and(
      eq(schema.SequenceStep.id, stepId),
      eq(schema.SequenceStep.organizationId, ctx.session.organizationId)
    ),
    columns: { sequenceId: true },
  })
  if (!step) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sequence step not found' })
  return step.sequenceId
}

/**
 * Filter an org's sequences down to what `userId` may view. The org OWNER sees
 * everything (cached role map, no ResourceAccess query — the §0.10 recovery
 * bypass); everyone else sees sequences they hold any instance/type grant on
 * (view is the hierarchy floor, so any grant qualifies).
 *
 * ADMIN was narrowed out here in doc 19 step 10 to match the per-sequence gate:
 * `checkSequenceAccess` → `hasPermission` → `checkAccess` is already OWNER-only
 * (§5.3 piece 2), so an admin who kept the list bypass would see rows that every
 * `get`/`update`/`delete` then refused. The profile-side remedy is one row —
 * `resourceAccess.grantType({ entityDefinitionId: 'sequence', granteeType:
 * 'profile', granteeId: <admin profile>, permission: 'admin' })` — which
 * `getUserAccessibleInstances` reads as `hasTypeAccess` here and `checkAccess`
 * honours on the enforcement path.
 */
async function filterViewableSequences(
  ctx: SequenceSessionCtx,
  sequences: SequenceEntity[]
): Promise<SequenceEntity[]> {
  const { organizationId, userId } = ctx.session

  const memberRoleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  if (memberRoleMap[userId]?.role === 'OWNER') return sequences

  const { getUserAccessibleInstances } = await import('@auxx/lib/resource-access')
  const { parseRecordId } = await import('@auxx/types/resource')

  const access = await getUserAccessibleInstances(
    { db: ctx.db, organizationId, userId },
    userId,
    'sequence'
  )
  if (access.hasTypeAccess) return sequences

  const accessibleIds = new Set(
    access.instances.map((i) => parseRecordId(i.recordId).entityInstanceId)
  )
  return sequences.filter((s) => accessibleIds.has(s.id))
}

// ── Router ────────────────────────────────────────────────────────────────────

export const sequenceRouter = createTRPCRouter({
  /** Sequences the current user can view, newest first, with run counts per status. */
  list: sequenceProcedure.query(async ({ ctx }) => {
    const all = unwrap(await listSequences(ctx.db, { organizationId: ctx.session.organizationId }))
    const visible = await filterViewableSequences(ctx, all)
    if (visible.length === 0) return []

    // One query across all visible sequences — cheap run-count enrichment.
    const countRows = await ctx.db
      .select({
        sequenceId: schema.SequenceRun.sequenceId,
        status: schema.SequenceRun.status,
      })
      .from(schema.SequenceRun)
      .where(
        and(
          eq(schema.SequenceRun.organizationId, ctx.session.organizationId),
          inArray(
            schema.SequenceRun.sequenceId,
            visible.map((s) => s.id)
          )
        )
      )

    const counts = new Map<string, { enrolled: number; active: number }>()
    for (const row of countRows) {
      const entry = counts.get(row.sequenceId) ?? { enrolled: 0, active: 0 }
      entry.enrolled += 1
      if (row.status === 'active') entry.active += 1
      counts.set(row.sequenceId, entry)
    }

    return visible.map((sequence) => ({
      ...sequence,
      runCounts: counts.get(sequence.id) ?? { enrolled: 0, active: 0 },
    }))
  }),

  /** A sequence + its ordered steps in one payload. */
  get: sequenceProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await requireSequenceAccess(ctx, input.id, ResourcePermission.view)

    const sequence = unwrap(
      await getSequence(ctx.db, {
        sequenceId: input.id,
        organizationId: ctx.session.organizationId,
      })
    )
    const steps = await ctx.db.query.SequenceStep.findMany({
      where: and(
        eq(schema.SequenceStep.sequenceId, input.id),
        eq(schema.SequenceStep.organizationId, ctx.session.organizationId)
      ),
      orderBy: asc(schema.SequenceStep.sortOrder),
    })

    return { sequence, steps }
  }),

  /**
   * Create a draft sequence — open to all members (plan §10); the domain layer
   * grants the creator admin ResourceAccess. `Sequence.integrationId` is NOT
   * NULL, so creation defaults to the org's first usable mailbox integration
   * (the Settings tab lets the user change it before publish).
   * `triggerType` (plan §4.7 — defaults to `'manual'` at the schema level when
   * omitted) drives `subjectKind`, derived here so the two columns never desync.
   */
  create: sequenceProcedure
    .input(z.object({ name: z.string().min(1), triggerType: triggerTypeSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      // integrationId stays null while drafting — the settings drawer sets the
      // mailbox and publish refuses to compile without one.
      return unwrap(
        await createSequence(ctx.db, {
          organizationId: ctx.session.organizationId,
          name: input.name,
          createdById: ctx.session.userId,
          triggerType: input.triggerType,
          subjectKind: input.triggerType ? deriveSubjectKindFromTrigger(input.triggerType) : null,
        })
      )
    }),

  /**
   * Patch draft/settings fields. `status: 'enabled'` requires a prior publish AND a pinned
   * sending mailbox (plan §4.7/decision #3 — enabling with no mailbox would silently never
   * send). `triggerType` re-derives `subjectKind` server-side (never trusts a client-supplied
   * value) and is locked once a sequence carries a `templateKey` — a seeded sequence's trigger
   * identity must stay stable (plan §4.7).
   */
  update: sequenceProcedure
    .input(z.object({ id: z.string(), fields: updateSequenceFieldsSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.id, ResourcePermission.edit)

      const needsSequenceRead = input.fields.status === 'enabled' || input.fields.triggerType
      const existing = needsSequenceRead
        ? unwrap(
            await getSequence(ctx.db, {
              sequenceId: input.id,
              organizationId: ctx.session.organizationId,
            })
          )
        : null

      // updateSequence doesn't validate the enabled↔publishedAt/mailbox invariant (its status
      // path is a raw column write) — enforce it here at the edge.
      if (input.fields.status === 'enabled') {
        if (!existing!.publishedAt) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Publish the sequence before enabling it',
          })
        }
        if (!existing!.integrationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Choose a sending mailbox before enabling it',
          })
        }
      }

      if (input.fields.triggerType && existing!.templateKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The trigger for a built-in template cannot be changed',
        })
      }

      const fields = {
        ...input.fields,
        ...(input.fields.triggerType
          ? { subjectKind: deriveSubjectKindFromTrigger(input.fields.triggerType) }
          : {}),
      }

      return unwrap(
        await updateSequence(ctx.db, {
          sequenceId: input.id,
          organizationId: ctx.session.organizationId,
          fields,
        })
      )
    }),

  /** Delete a sequence (and its hidden workflow) — admin grant required, no active runs. */
  delete: sequenceProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await requireSequenceAccess(ctx, input.id, ResourcePermission.admin)
    unwrap(
      await deleteSequence(ctx.db, {
        sequenceId: input.id,
        organizationId: ctx.session.organizationId,
      })
    )
    return { success: true }
  }),

  /**
   * Add an empty step. The domain layer appends at the end; when `afterStepId`
   * is given the new step is immediately reordered to sit right after it.
   */
  createStep: sequenceProcedure
    .input(z.object({ sequenceId: z.string(), afterStepId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.sequenceId, ResourcePermission.edit)

      const created = unwrap(
        await createStep(ctx.db, {
          sequenceId: input.sequenceId,
          organizationId: ctx.session.organizationId,
        })
      )
      if (!input.afterStepId || input.afterStepId === created.id) return created

      // Find the step that currently follows `afterStepId` to slot between them.
      const steps = await ctx.db.query.SequenceStep.findMany({
        where: and(
          eq(schema.SequenceStep.sequenceId, input.sequenceId),
          eq(schema.SequenceStep.organizationId, ctx.session.organizationId)
        ),
        orderBy: asc(schema.SequenceStep.sortOrder),
        columns: { id: true },
      })
      const remaining = steps.filter((s) => s.id !== created.id)
      const afterIndex = remaining.findIndex((s) => s.id === input.afterStepId)
      if (afterIndex === -1) return created // afterStepId vanished — keep appended position
      const nextStepId = remaining[afterIndex + 1]?.id ?? null
      if (nextStepId === null) return created // already at the end

      return unwrap(
        await reorderStep(ctx.db, {
          stepId: created.id,
          organizationId: ctx.session.organizationId,
          sequenceId: input.sequenceId,
          previousStepId: input.afterStepId,
          nextStepId,
        })
      )
    }),

  /** Patch a step's content/delays. */
  updateStep: sequenceProcedure
    .input(z.object({ stepId: z.string(), fields: updateStepFieldsSchema }))
    .mutation(async ({ ctx, input }) => {
      const sequenceId = await getStepSequenceId(ctx, input.stepId)
      await requireSequenceAccess(ctx, sequenceId, ResourcePermission.edit)

      return unwrap(
        await updateStep(ctx.db, {
          stepId: input.stepId,
          organizationId: ctx.session.organizationId,
          fields: input.fields,
        })
      )
    }),

  /** Remove a step. */
  deleteStep: sequenceProcedure
    .input(z.object({ stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sequenceId = await getStepSequenceId(ctx, input.stepId)
      await requireSequenceAccess(ctx, sequenceId, ResourcePermission.edit)

      unwrap(
        await deleteStep(ctx.db, {
          stepId: input.stepId,
          organizationId: ctx.session.organizationId,
        })
      )
      return { success: true }
    }),

  /** Move a step between two neighbors (fractional sortOrder). */
  reorderStep: sequenceProcedure
    .input(
      z.object({
        stepId: z.string(),
        sequenceId: z.string(),
        previousStepId: z.string().nullish(),
        nextStepId: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.sequenceId, ResourcePermission.edit)

      return unwrap(
        await reorderStep(ctx.db, {
          stepId: input.stepId,
          organizationId: ctx.session.organizationId,
          sequenceId: input.sequenceId,
          previousStepId: input.previousStepId ?? null,
          nextStepId: input.nextStepId ?? null,
        })
      )
    }),

  /** Validate + compile the step list into the hidden workflow graph. */
  publish: sequenceProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.id, ResourcePermission.edit)

      return unwrap(
        await publishSequence(ctx.db, {
          sequenceId: input.id,
          organizationId: ctx.session.organizationId,
        })
      )
    }),

  /** Enroll up to 50 contacts — returns per-recipient enrolled/skipped outcomes. */
  enroll: sequenceProcedure
    .input(
      z.object({
        sequenceId: z.string(),
        recipientEntityInstanceIds: z.array(z.string()).min(1).max(SEQUENCE_ENROLL_MAX_RECIPIENTS),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.sequenceId, ResourcePermission.edit)

      return unwrap(
        await enrollRecipients(ctx.db, {
          sequenceId: input.sequenceId,
          organizationId: ctx.session.organizationId,
          recipientEntityInstanceIds: input.recipientEntityInstanceIds,
          enrolledById: ctx.session.userId,
        })
      )
    }),

  /** Runs (enrollments) for the Recipients tab, optionally filtered by status. */
  listRuns: sequenceProcedure
    .input(z.object({ sequenceId: z.string(), status: runStatusSchema.optional() }))
    .query(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.sequenceId, ResourcePermission.view)

      return unwrap(
        await listRuns(ctx.db, {
          sequenceId: input.sequenceId,
          organizationId: ctx.session.organizationId,
          status: input.status,
        })
      )
    }),

  /** Manually remove a recipient from a sequence (exit reason 'manual'). */
  exitRun: sequenceProcedure
    .input(z.object({ sequenceRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.SequenceRun.findFirst({
        where: and(
          eq(schema.SequenceRun.id, input.sequenceRunId),
          eq(schema.SequenceRun.organizationId, ctx.session.organizationId)
        ),
        columns: { sequenceId: true },
      })
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sequence run not found' })
      await requireSequenceAccess(ctx, run.sequenceId, ResourcePermission.edit)

      unwrap(
        await manualExitRun(ctx.db, {
          sequenceRunId: input.sequenceRunId,
          organizationId: ctx.session.organizationId,
        })
      )
      return { success: true }
    }),

  /** Header stats: enrolled/active/completed/exited/failed, per-step sent, reply/bounce rates. */
  stats: sequenceProcedure
    .input(z.object({ sequenceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireSequenceAccess(ctx, input.sequenceId, ResourcePermission.view)

      return unwrap(
        await getSequenceStats(ctx.db, {
          sequenceId: input.sequenceId,
          organizationId: ctx.session.organizationId,
        })
      )
    }),

  /**
   * The 5 seeded client-notification sequences (`templateKey` non-null) + their ordered steps,
   * for the "Client notifications" settings page (plan §4.7) — one query instead of a
   * `sequence.get` per row. Org-wide admin view, same visibility as `list` (no per-sequence
   * ResourceAccess check — every member with dispatch settings access already sees the whole
   * template set). Ordered per §4.6's documented table, not `createdAt`.
   */
  listTemplates: sequenceProcedure.query(async ({ ctx }) => {
    const all = unwrap(await listSequences(ctx.db, { organizationId: ctx.session.organizationId }))
    const templated = all.filter((s): s is SequenceEntity & { templateKey: string } =>
      Boolean(s.templateKey)
    )
    if (templated.length === 0) return []

    const stepRows = await ctx.db.query.SequenceStep.findMany({
      where: and(
        inArray(
          schema.SequenceStep.sequenceId,
          templated.map((s) => s.id)
        ),
        eq(schema.SequenceStep.organizationId, ctx.session.organizationId)
      ),
      orderBy: asc(schema.SequenceStep.sortOrder),
    })

    const stepsBySequence = new Map<string, typeof stepRows>()
    for (const step of stepRows) {
      const list = stepsBySequence.get(step.sequenceId)
      if (list) list.push(step)
      else stepsBySequence.set(step.sequenceId, [step])
    }

    const sorted = [...templated].sort(
      (a, b) =>
        SEEDED_TEMPLATE_ORDER.indexOf(a.templateKey) - SEEDED_TEMPLATE_ORDER.indexOf(b.templateKey)
    )

    return sorted.map((sequence) => ({
      sequence,
      steps: stepsBySequence.get(sequence.id) ?? [],
    }))
  }),
})
