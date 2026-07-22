// packages/lib/src/money/auto-invoice.ts
//
// Automated draft-invoice generation (money MI2 build spec §C-§H) — the automated twin of
// `createInvoiceFromWorkOrder` (gather.ts), sharing its shell/copy machinery instead of
// duplicating it. Three triggers all funnel through `generateInvoiceDraft`:
// `per_visit_completed` (§D, called from `dispatch/visit-mutations.ts`'s `setVisitStatus`),
// `on_completion` (§E, an entity field-change hook on `work-orders`), and `custom_schedule`
// (§F, a `RecurrenceRule` cursor materializer/sweep on the M2c pattern). Drafts never
// auto-send (README.md:45) — every generated invoice sits at `status: 'draft'`.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { fromZonedTime } from 'date-fns-tz'
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import {
  getWorkOrderStatus,
  systemActorUserId,
  todayLocalDate,
} from '../dispatch/recurring/materialize'
import { BadRequestError } from '../errors'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { FieldValueService } from '../field-values/field-value-service'
import { expandOccurrences, type RecurrencePattern, recurrencePatternSchema } from '../recurrence'
import { UnifiedCrudHandler } from '../resources/crud'
import { getOrganizationSetting } from '../settings/settings-service'
import {
  createFixedContractInvoice,
  createRecurringCharge,
  createVisitInvoice,
} from './billing-commands'
import { syncWorkOrderBillingProjection } from './billing-projection'
import type {
  GenerateInvoiceDraftInput,
  GenerateInvoiceDraftResult,
  InvoiceScheduleQueryInput,
  SetInvoiceScheduleInput,
} from './types'

const logger = createScopedLogger('money:auto-invoice')

type RecurrenceRuleRow = typeof schema.RecurrenceRule.$inferSelect
type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Local calendar date (`YYYY-MM-DD`, local midnight in `timezone`) as a UTC instant — the
 * same local-date/UTC-instant convention `recurrence/expand.ts` and M2c's materializer use.
 * Duplicated locally (not imported) because `dispatch/recurring/materialize.ts` doesn't
 * export it — the M2c files are a pattern to copy, not modify. */
function localDateStartUtc(dateIso: string, timezone: string): Date {
  const parts = dateIso.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return fromZonedTime(new Date(year, month - 1, day), timezone)
}

/** Read `work_order_job_type` — unwraps the SINGLE_SELECT array-return convention. Mirrors
 * `getWorkOrderStatus` (dispatch/recurring/materialize.ts), for the same field on the same
 * entity, since that module only exports the status reader. */
async function getWorkOrderJobType(
  organizationId: string,
  userId: string,
  workOrderInstanceId: string
): Promise<string | undefined> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_job_type'] as const)
  if (!cf.work_order_job_type) return undefined

  const fieldValueService = new FieldValueService(organizationId, userId)
  const typed = await fieldValueService.getValue({
    recordId: toRecordId('work_order', workOrderInstanceId),
    fieldId: cf.work_order_job_type.id,
  })
  const first = Array.isArray(typed) ? typed[0] : typed
  return first ? (extractValue(first) as string) : undefined
}

const TRIGGER_TO_TIMING: Record<GenerateInvoiceDraftInput['trigger'], string> = {
  per_visit: 'per_visit_completed',
  on_completion: 'on_completion',
  custom_schedule: 'custom_schedule',
}

/**
 * Generate one automated draft invoice (money MI2 build spec §C) — the automated twin of
 * `createInvoiceFromWorkOrder`. All three triggers (§D/§E/§F) call this; it never throws for
 * expected "nothing to do" outcomes (disabled/not-found/timing-mismatch/no-contact/duplicate/
 * empty — all returned as `{ created: false, reason }`), so callers only need try/catch for
 * genuinely unexpected failures. Acting user is always the org system user (public-token.ts
 * precedent) — automated writes must not impersonate a member.
 */
export async function generateInvoiceDraft(
  input: GenerateInvoiceDraftInput
): Promise<GenerateInvoiceDraftResult> {
  const { organizationId, workOrderInstanceId, trigger, visitId, occurrenceDate } = input

  // ─── Step 1a: master switch (FIRST check) ───────────────────────────────────
  const autoEnabled = await getOrganizationSetting({
    organizationId,
    key: 'documents.invoice.autoEnabled',
  })
  if (autoEnabled === false) {
    return { created: false, reason: 'disabled' }
  }

  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)

  // ─── Step 1b: WO exists ──────────────────────────────────────────────────────
  const woExists = await database.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, workOrderInstanceId),
      eq(schema.EntityInstance.organizationId, organizationId)
    ),
    columns: { id: true },
  })
  if (!woExists) {
    logger.warn('Skipping auto-invoice draft — work order not found', {
      organizationId,
      workOrderInstanceId,
      trigger,
    })
    return { created: false, reason: 'not_found' }
  }

  // ─── Step 1c: invoice_timing matches the trigger (re-read at fire time) ────
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'work_order_invoice_timing',
      'work_order_pricing_model',
      'work_order_contact',
    ] as const)
  const woFieldIds = [
    cf.work_order_invoice_timing,
    cf.work_order_pricing_model,
    cf.work_order_contact,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const woValues = await handler.getFieldValues(workOrderRecordId, woFieldIds)

  const invoiceTimingTyped = cf.work_order_invoice_timing
    ? firstTyped(woValues.get(cf.work_order_invoice_timing.id))
    : undefined
  const invoiceTiming = invoiceTimingTyped
    ? (extractValue(invoiceTimingTyped) as string)
    : undefined
  if (invoiceTiming !== TRIGGER_TO_TIMING[trigger]) {
    return { created: false, reason: 'timing_mismatch' }
  }

  // ─── Step 1d: contact present (Q5 — an automated job can't throw at 3 AM) ──
  const contactTyped = cf.work_order_contact
    ? firstTyped(woValues.get(cf.work_order_contact.id))
    : undefined
  const hasContact = contactTyped?.type === 'relationship' && !!contactTyped.recordId
  if (!hasContact) {
    logger.warn('Skipping auto-invoice draft — work order has no contact', {
      organizationId,
      workOrderInstanceId,
      trigger,
    })
    return { created: false, reason: 'no_contact' }
  }

  // ─── Step 1e: per_visit dedup (Q6a) ─────────────────────────────────────────
  if (trigger === 'per_visit' && visitId) {
    const existing = await database.query.InvoiceVisitAllocation.findFirst({
      where: and(
        eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
        eq(schema.InvoiceVisitAllocation.visitId, visitId),
        eq(schema.InvoiceVisitAllocation.kind, 'base'),
        eq(schema.InvoiceVisitAllocation.status, 'active')
      ),
      columns: { id: true },
    })
    if (existing) return { created: false, reason: 'duplicate' }
  }

  const pricingModelTyped = cf.work_order_pricing_model
    ? firstTyped(woValues.get(cf.work_order_pricing_model.id))
    : undefined
  const pricingModel = pricingModelTyped ? (extractValue(pricingModelTyped) as string) : 'per_visit'

  // Allocation-backed command routing. Manual and automated creation now share the same
  // serializable builders; allocation uniqueness is the final idempotency boundary.
  if (pricingModel === 'per_visit') {
    let visitIds = visitId ? [visitId] : []
    if (visitIds.length === 0) {
      const cutoff = occurrenceDate ?? '9999-12-31'
      const visits = await database.query.WorkOrderVisit.findMany({
        where: and(
          eq(schema.WorkOrderVisit.organizationId, organizationId),
          eq(schema.WorkOrderVisit.workOrderId, workOrderInstanceId),
          eq(schema.WorkOrderVisit.status, 'done')
        ),
      })
      const allocated = await database.query.InvoiceVisitAllocation.findMany({
        where: and(
          eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
          eq(schema.InvoiceVisitAllocation.workOrderId, workOrderInstanceId),
          eq(schema.InvoiceVisitAllocation.kind, 'base'),
          eq(schema.InvoiceVisitAllocation.status, 'active')
        ),
        columns: { visitId: true },
      })
      const claimed = new Set(allocated.map((row) => row.visitId))
      visitIds = visits
        .filter((visit) => {
          const date =
            visit.occurrenceDate ?? visit.startTime?.toISOString().split('T')[0] ?? '9999-12-31'
          return date <= cutoff && !claimed.has(visit.id)
        })
        .map((visit) => visit.id)
    }
    if (visitIds.length === 0) return { created: false, reason: 'empty' }
    const created = await createVisitInvoice({
      organizationId,
      userId,
      workOrderInstanceId,
      visitIds,
    })
    return { created: true, ...created }
  }

  if (pricingModel === 'fixed_contract') {
    const pendingInstallments = await database.query.WorkOrderBillingInstallment.findMany({
      where: and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        eq(schema.WorkOrderBillingInstallment.workOrderId, workOrderInstanceId),
        eq(schema.WorkOrderBillingInstallment.status, 'pending')
      ),
      orderBy: [asc(schema.WorkOrderBillingInstallment.sortOrder)],
    })
    const pendingInstallment = pendingInstallments.find((installment) => {
      if (trigger === 'on_completion') return installment.trigger === 'work_order_completion'
      if (trigger !== 'custom_schedule') return installment.trigger === 'manual'
      return (
        installment.trigger === 'date' &&
        !!installment.scheduledDate &&
        !!occurrenceDate &&
        installment.scheduledDate <= occurrenceDate
      )
    })
    if (trigger === 'custom_schedule' && !pendingInstallment) {
      return { created: false, reason: 'empty' }
    }
    const created = await createFixedContractInvoice({
      organizationId,
      userId,
      workOrderInstanceId,
      amount: pendingInstallment
        ? { type: 'installment', installmentId: pendingInstallment.id }
        : { type: 'remaining' },
    })
    return { created: true, ...created }
  }

  if (pricingModel === 'recurring_flat' && occurrenceDate) {
    const created = await createRecurringCharge({
      organizationId,
      userId,
      workOrderInstanceId,
      occurrenceDate,
    })
    return { created: true, ...created }
  }

  return { created: false, reason: 'empty' }
}

/**
 * `per_visit_completed` trigger (money MI2 build spec §D, Q1a) — called from
 * `dispatch/visit-mutations.ts`'s `setVisitStatus` when a visit lands on `done`. Never throws:
 * a billing failure must never fail the field tech's status tap.
 */
export async function maybeGenerateVisitInvoiceDraft(visit: WorkOrderVisitRow): Promise<void> {
  try {
    const cache = getOrgCache()
    const cf = await cache
      .from(visit.organizationId, 'customFields')
      .bySystemAttributes(['work_order_invoice_timing'] as const)
    if (!cf.work_order_invoice_timing) return

    const userId = await cache.get(visit.organizationId, 'systemUser')
    const handler = new UnifiedCrudHandler(visit.organizationId, userId)
    const workOrderRecordId = toRecordId('work_order', visit.workOrderId)
    const values = await handler.getFieldValues(workOrderRecordId, [
      cf.work_order_invoice_timing.id,
    ])
    const typed = firstTyped(values.get(cf.work_order_invoice_timing.id))
    const timing = typed ? (extractValue(typed) as string) : undefined
    if (timing !== 'per_visit_completed') return

    const visitDate =
      visit.occurrenceDate ??
      (visit.startTime ? visit.startTime.toISOString().split('T')[0] : undefined)

    await generateInvoiceDraft({
      organizationId: visit.organizationId,
      workOrderInstanceId: visit.workOrderId,
      trigger: 'per_visit',
      visitId: visit.id,
      visitDate,
    })
  } catch (error) {
    logger.error('Failed to generate per-visit invoice draft', {
      visitId: visit.id,
      workOrderId: visit.workOrderId,
      organizationId: visit.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * `on_completion` trigger (money MI2 build spec §E, Q3a+Q3i) — an entity field-change hook on
 * `work-orders` watching `work_order_status` land on `completed` or `ended`. Fires on EVERY
 * completion door (the visit roll-up, M2c's `endEngagement`, kanban drags, manual drawer
 * edits) because field-change hooks fire on every `FieldValueService` write. No recursion risk
 * — this handler never writes `work_order_status`. Dedup is free: gather-based content
 * self-dedups (stamped lines don't re-gather), so a WO completed twice with nothing new is an
 * empty-skip.
 */
export const generateDraftOnCompletion: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'work_order_status') return

  const newTyped = firstTyped(event.newValue as TypedFieldValue | TypedFieldValue[] | undefined)
  const newStatus = newTyped ? (extractValue(newTyped) as string) : undefined
  if (newStatus !== 'completed' && newStatus !== 'ended') return

  const { entityInstanceId: workOrderInstanceId } = parseRecordId(event.recordId)

  try {
    const cache = getOrgCache()
    const cf = await cache
      .from(event.organizationId, 'customFields')
      .bySystemAttributes(['work_order_invoice_timing'] as const)
    if (!cf.work_order_invoice_timing) return

    const handler = new UnifiedCrudHandler(event.organizationId, event.userId)
    const values = await handler.getFieldValues(event.recordId, [cf.work_order_invoice_timing.id])
    const typed = firstTyped(values.get(cf.work_order_invoice_timing.id))
    const timing = typed ? (extractValue(typed) as string) : undefined
    if (timing !== 'on_completion') return

    await generateInvoiceDraft({
      organizationId: event.organizationId,
      workOrderInstanceId,
      trigger: 'on_completion',
    })
  } catch (error) {
    logger.error('Failed to generate on-completion invoice draft', {
      workOrderInstanceId,
      organizationId: event.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Create or edit a work order's invoice-draft schedule (money MI2 build spec §F.1) — the
 * `RecurrenceRule` row (`subjectType: 'invoice_drafts'`), mirroring M2c's `setRecurrenceRule`
 * upsert shape without its visit-template columns (they stay null — non-visit subject).
 * Edits are whole-rule (`effectiveFrom = today` on every save, §F.1 — invoice drafts have no
 * per-occurrence rows to freeze, so 06 §4.3's three-way machinery does not apply).
 * User-facing: throws normally (unlike the triggers, which never throw).
 *
 * @throws {BadRequestError} when the pattern fails validation, or the work order's
 *   `work_order_invoice_timing` isn't `custom_schedule`.
 */
export async function setInvoiceSchedule(
  input: SetInvoiceScheduleInput
): Promise<RecurrenceRuleRow> {
  const { organizationId, userId, workOrderInstanceId, pattern, timezone } = input

  const parsed = recurrencePatternSchema.safeParse(pattern)
  if (!parsed.success) {
    throw new BadRequestError(`Invalid recurrence pattern: ${parsed.error.message}`)
  }

  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_invoice_timing'] as const)
  if (cf.work_order_invoice_timing) {
    const handler = new UnifiedCrudHandler(organizationId, userId)
    const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)
    const values = await handler.getFieldValues(workOrderRecordId, [
      cf.work_order_invoice_timing.id,
    ])
    const typed = firstTyped(values.get(cf.work_order_invoice_timing.id))
    const timing = typed ? (extractValue(typed) as string) : undefined
    if (timing !== 'custom_schedule') {
      throw new BadRequestError('Set invoice timing to Custom schedule first')
    }
  }

  const todayIso = todayLocalDate(timezone)

  const existing = await database.query.RecurrenceRule.findFirst({
    where: and(
      eq(schema.RecurrenceRule.organizationId, organizationId),
      eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
      eq(schema.RecurrenceRule.subjectId, workOrderInstanceId)
    ),
  })

  const [rule] = existing
    ? await database
        .update(schema.RecurrenceRule)
        .set({
          pattern: pattern as unknown as Record<string, unknown>,
          timezone,
          effectiveFrom: todayIso,
        })
        .where(eq(schema.RecurrenceRule.id, existing.id))
        .returning()
    : await database
        .insert(schema.RecurrenceRule)
        .values({
          organizationId,
          subjectType: 'invoice_drafts',
          subjectId: workOrderInstanceId,
          pattern: pattern as unknown as Record<string, unknown>,
          timezone,
          anchor: todayIso,
          effectiveFrom: todayIso,
          startMinute: null,
          durationMinutes: null,
          defaultAssigneeWorkerId: null,
        })
        .returning()
  if (!rule) throw new Error('Failed to upsert invoice schedule rule')

  await materializeInvoiceDrafts(rule)
  return rule
}

/**
 * Delete a work order's invoice-draft schedule (§F.1) — existing generated drafts are
 * untouched (it's declarative config, not materialized state, §H).
 */
export async function clearInvoiceSchedule(input: InvoiceScheduleQueryInput): Promise<void> {
  const { organizationId, workOrderInstanceId } = input
  await database
    .delete(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.organizationId, organizationId),
        eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
        eq(schema.RecurrenceRule.subjectId, workOrderInstanceId)
      )
    )
}

/** Read a work order's invoice-draft schedule rule, or `null` if none is set (§F.1/§J). */
export async function getInvoiceSchedule(
  input: InvoiceScheduleQueryInput
): Promise<RecurrenceRuleRow | null> {
  const { organizationId, workOrderInstanceId } = input
  const rule = await database.query.RecurrenceRule.findFirst({
    where: and(
      eq(schema.RecurrenceRule.organizationId, organizationId),
      eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
      eq(schema.RecurrenceRule.subjectId, workOrderInstanceId)
    ),
  })
  return rule ?? null
}

/**
 * Materialize an `invoice_drafts` `RecurrenceRule` (money MI2 build spec §F.2/§F.3) — the M2c
 * cursor pattern with generation instead of row-insertion, and one deliberate divergence:
 * the window is `(materializedUntil ?? anchor) → now`, NEVER now + horizon (Q9b — a draft for
 * an occurrence weeks out must not exist yet).
 *
 * Pause gate (§F.3, Q8a) runs first: a recurring engagement that's `paused`/`ended`/
 * `canceled`, or a one_off engagement that's `canceled`, advances the cursor WITHOUT
 * generating (resume-from-today, no backfill — advancing while paused IS the no-backfill
 * mechanic). A one_off engagement that's `completed` keeps generating (Q8's carve-out —
 * final scheduled invoices usually come after the work).
 *
 * Each occurrence is generated in its own try/catch (logged, not rethrown) so one bad
 * occurrence can't leave the cursor stuck re-processing (and re-drafting) the same slot on
 * every future sweep — `materializedUntil` always advances to `now` once the pass completes.
 */
export async function materializeInvoiceDrafts(rule: RecurrenceRuleRow): Promise<void> {
  const userId = await systemActorUserId(rule.organizationId)
  const [status, jobType] = await Promise.all([
    getWorkOrderStatus(rule.organizationId, userId, rule.subjectId),
    getWorkOrderJobType(rule.organizationId, userId, rule.subjectId),
  ])

  const now = new Date()
  const isRecurring = jobType === 'recurring'
  const skipGeneration =
    (isRecurring && (status === 'paused' || status === 'ended' || status === 'canceled')) ||
    (!isRecurring && status === 'canceled')

  if (skipGeneration) {
    await database
      .update(schema.RecurrenceRule)
      .set({ materializedUntil: now })
      .where(eq(schema.RecurrenceRule.id, rule.id))
    await repairBillingProjection(rule, userId)
    return
  }

  const pattern = rule.pattern as unknown as RecurrencePattern
  const anchorStart = localDateStartUtc(rule.anchor, rule.timezone)
  const boundary = rule.materializedUntil ?? anchorStart

  // countConsumed (§F.2): count of prior occurrences expanded from anchor → strictly before
  // the boundary — derived from the cursor, not a counter column (06 §4.4 principle).
  const countConsumed = expandOccurrences(pattern, {
    anchor: rule.anchor,
    timezone: rule.timezone,
    from: anchorStart,
    to: new Date(boundary.getTime() - 1),
    startMinute: 0,
  }).length

  const occurrences = expandOccurrences(pattern, {
    anchor: rule.anchor,
    timezone: rule.timezone,
    from: boundary,
    to: now,
    startMinute: 0,
    countConsumed,
  })

  // Plan §4.8: the daily sweep must repair projections for every work order it evaluates, even
  // when it creates no invoice. `generateInvoiceDraft`'s `created: true` path already runs the
  // post-commit projector (`projectCommittedInvoice` in billing-commands.ts) — this only covers
  // the "evaluated but nothing generated" outcome (empty/duplicate/timing-mismatch/no-contact, or
  // a failed occurrence) so a stale projection can't linger between sweeps.
  let createdAny = false
  for (const occurrence of occurrences) {
    try {
      const result = await generateInvoiceDraft({
        organizationId: rule.organizationId,
        workOrderInstanceId: rule.subjectId,
        trigger: 'custom_schedule',
        occurrenceDate: occurrence.occurrenceDate,
      })
      if (result.created) createdAny = true
    } catch (error) {
      logger.error('Failed to generate scheduled invoice draft', {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        workOrderInstanceId: rule.subjectId,
        occurrenceDate: occurrence.occurrenceDate,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await database
    .update(schema.RecurrenceRule)
    .set({ materializedUntil: now })
    .where(eq(schema.RecurrenceRule.id, rule.id))

  if (!createdAny) {
    await repairBillingProjection(rule, userId)
  }
}

/** Plan §4.8 sweep repair — logged/swallowed, never blocks the cursor advance above. */
async function repairBillingProjection(rule: RecurrenceRuleRow, userId: string): Promise<void> {
  try {
    await syncWorkOrderBillingProjection({
      organizationId: rule.organizationId,
      userId,
      workOrderInstanceId: rule.subjectId,
      bumpRevision: false,
    })
  } catch (error) {
    logger.error('Failed to repair billing projection after invoice draft sweep', {
      ruleId: rule.id,
      organizationId: rule.organizationId,
      workOrderInstanceId: rule.subjectId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Daily sweep (money MI2 build spec §G) for every `invoice_drafts` `RecurrenceRule` whose
 * horizon has fallen behind. Per-rule try/catch — one broken org must not stall the sweep
 * (unlike M2c's visit sweep, which has no such guard because it never generates money).
 */
export async function sweepInvoiceDrafts(): Promise<void> {
  const now = new Date()
  const rules = await database.query.RecurrenceRule.findMany({
    where: and(
      eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
      or(
        isNull(schema.RecurrenceRule.materializedUntil),
        lt(schema.RecurrenceRule.materializedUntil, now)
      )
    ),
  })

  for (const rule of rules) {
    try {
      await materializeInvoiceDrafts(rule)
    } catch (error) {
      logger.error('Failed to materialize invoice drafts for rule', {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        workOrderInstanceId: rule.subjectId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
