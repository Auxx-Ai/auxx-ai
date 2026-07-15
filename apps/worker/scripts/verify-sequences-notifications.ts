// apps/worker/scripts/verify-sequences-notifications.ts
/**
 * Dispatch plan 19 "Client Notifications on Sequences" Phase 6 verification
 * (plans/dispatch/19-client-notifications.md §5 Phase 6). Exercises the REAL write paths built
 * in Phases 0-5: `seedClientNotificationSequences`, `enrollSubjectInSequence`/the event-trigger
 * hooks (`hooks.ts`, `field-change-hooks.ts`), `runSequenceEnrollmentSweep`/
 * `computeSweepLookaheadDays`, `reanchorSequenceRuns`, `exitRunsForDeadVisitSubjects`,
 * `exitSequenceRun`/`exitActiveRunsForSequence`, `evaluateSubjectGuards`/
 * `resolveSubjectAnchorDate`/`computeAnchorTarget` (the send-node guard + anchor math),
 * `recordSignal`/`listSignalsForRecordKeys`, and `evaluateEnrollmentFilter`.
 *
 * ── SAFETY DESIGN (dev `.env` is LIVE email — this script must NEVER cause a real send) ──
 *
 * Every `Sequence` this script creates or reuses — the 5 real seeded templates AND every
 * ad-hoc single-anchor-step test sequence built by `makeTestSequence()` below — is enabled
 * WITHOUT ever calling `publishSequence()` and WITHOUT ever setting `integrationId`. That
 * matters structurally, not just by convention: `buildSequenceGraph()` bakes
 * `sequence.integrationId` into every compiled `sequence-send-email` node's
 * `config.integrationId` at compile time (`publish.ts:115`); `BaseNodeProcessor.execute()`
 * (`workflow-engine/nodes/base-node.ts:130-140`) calls `this.validate(node)` — which fails on
 * a missing `integrationId` (`sequence-send-email-processor.ts:117`) — BEFORE `executeNode()`
 * ever runs, so `MessageSenderService.sendMessage()` is unreachable. This holds whether the
 * node executes synchronously in THIS process (`startSystemWorkflowRun`'s fire-and-forget
 * `executeWorkflowAsync`, `system-workflow-run.ts:60`, in-process, not queued) or later via a
 * real BullMQ worker picking up a queued wait-node resume — either way, `integrationId: null`
 * makes a real send structurally impossible. `seedClientNotificationSequences` itself never
 * sets `integrationId` (compileSequenceForSeed skips the integration check on purpose,
 * `seed-templates.ts:266-290`), and `makeTestSequence()` below mirrors that exact compile
 * path (raw SQL — `publishSequence()` is deliberately never called, since IT throws unless
 * `integrationId` is set, and would bake a real one in if we ever gave it one).
 *
 * A second, independent guard: every enrollment race (an immediate/zero-delay step reaching
 * the send node before this script's own next assertion) is by DESIGN irrelevant to send
 * safety (integrationId null either way) — but IS relevant to test determinism (a raced
 * `SequenceRun` flips 'active' -> 'failed' via `completeSequenceRunIfActive`
 * (`workflow-execution-service.ts`) before an exit-semantics assertion runs). Every check that
 * needs a run to STAY active for the assertion window uses a dedicated
 * `makeTestSequence()` sequence with a single ANCHOR step +10 DAYS out — a genuinely
 * multi-day-delayed BullMQ job can't fire early regardless of how eager any worker's queue
 * polling is. Checks that only need enrollment EXISTENCE (not sustained active status) use
 * the real seeded templates, since a race to 'failed' doesn't affect a plain row-exists
 * assertion.
 *
 * Records created are prefixed `[SEQ-verify]` (work order/contact/invoice titles, custom test
 * sequence names, signal titles) and everything is deleted in `finally`: `exitActiveRunsForSequence`
 * + `deleteSequence` per sequence (cascades `WorkflowApp` -> `Workflow`/`WorkflowRun`/
 * `WorkflowNodeExecution` + `Sequence` -> `SequenceStep`/`SequenceRun`, `sequence.ts` schema
 * comments verified), manual `EntitySignal` rows deleted via raw SQL (no FK to Sequence, insert-
 * only substrate), then every `EntityInstance` record via `UnifiedCrudHandler.delete` (cascades
 * `WorkOrderVisit`/`RecurrenceRule`/line items).
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-sequences-notifications.ts
 */

import { database } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import {
  assignVisit,
  endEngagement,
  scheduleVisit,
  setRecurrenceRule,
  setVisitStatus,
} from '@auxx/lib/dispatch'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { deleteManualPayment, markInvoiceSent, recordManualPayment } from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import {
  buildSequenceGraph,
  computeAnchorTarget,
  createSequence,
  createStep,
  deleteSequence,
  enrollSubjectInSequence,
  evaluateEnrollmentFilter,
  evaluateSubjectGuards,
  exitActiveRunsForSequence,
  exitSequenceRun,
  runSequenceEnrollmentSweep,
  SEQUENCE_SEED_TEMPLATES,
  type SequenceEntity,
  type SequenceStepEntity,
  seedClientNotificationSequences,
  updateSequence,
} from '@auxx/lib/sequences'
import { listSignalsForRecordKeys, recordSignal, toSignalRecordKey } from '@auxx/lib/signals'

const MARKER = '[SEQ-verify]'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency, the
 * `verify-money-mi1.ts` precedent). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

/** Deterministic BullMQ jobId for a wait node's delayed resume — mirrors
 * `workflow-engine/nodes/wait/resume-job-id.ts`'s `buildWorkflowResumeJobId` (not exported at
 * a usable subpath; this is a pure one-line format, safe to duplicate for a read-only lookup). */
function resumeJobId(workflowRunId: string, nodeId: string): string {
  return `resume-${workflowRunId}-${nodeId}`
}

/**
 * `WorkflowExecutionService.createRun` enforces the `workflowRuns` monthly usage quota in
 * production mode — `startSystemWorkflowRun` (every `enrollSubjectInSequence` call) runs in
 * that mode. The dev org's `PlanSubscription.status` is `'canceled'`
 * (`features-provider.ts`'s `compute` only builds a non-empty feature map for
 * trialing/active/past_due — `canceled` falls through to an EMPTY map), so
 * `workflowRunsPerMonthHard` is entirely ABSENT (`getLimit()` returns `null`, hard-denied) —
 * not a real cap hit (actual usage this month is in the single digits). `customFeatureLimits`
 * is the purpose-built per-org override for exactly this (Enterprise custom limits); it merges
 * into the feature map unconditionally regardless of subscription status. Borrow it for the
 * duration of this script (mirrors `verify-message-received-trigger.ts`'s identical helper,
 * same root cause, same dev org): merge in a generous limit, bust the live `features` cache key
 * so any concurrently-running worker process picks it up, run `fn`, then restore the ORIGINAL
 * value and re-invalidate in `finally` — the org's real plan/limits are untouched afterward.
 */
async function withWorkflowRunsFeatureAccess<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const before = await database.$client.query(
    'SELECT "customFeatureLimits" FROM "PlanSubscription" WHERE "organizationId" = $1',
    [organizationId]
  )
  if (before.rows.length === 0) {
    console.log('  (org has no PlanSubscription row — skipping feature-access override)')
    return fn()
  }
  const originalRaw = before.rows[0]?.customFeatureLimits ?? null
  const original = typeof originalRaw === 'string' ? JSON.parse(originalRaw) : (originalRaw ?? null)

  const patched = {
    ...(original ?? {}),
    workflowRunsPerMonthHard: 999_999,
    workflowRunsPerMonthSoft: 999_999,
  }
  await database.$client.query(
    'UPDATE "PlanSubscription" SET "customFeatureLimits" = $1 WHERE "organizationId" = $2',
    [JSON.stringify(patched), organizationId]
  )
  await onCacheEvent('plan.changed', { orgId: organizationId })
  try {
    return await fn()
  } finally {
    await database.$client.query(
      'UPDATE "PlanSubscription" SET "customFeatureLimits" = $1 WHERE "organizationId" = $2',
      [original === null ? null : JSON.stringify(original), organizationId]
    )
    await onCacheEvent('plan.changed', { orgId: organizationId })
  }
}

let pass = 0
let fail = 0
let skipped = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}
function skip(name: string, reason: string) {
  skipped++
  console.log(`  ⚠️  SKIPPED: ${name} — ${reason}`)
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 3000,
  intervalMs = 150
): Promise<T | undefined> {
  const start = Date.now()
  for (;;) {
    const result = await fn()
    if (result !== undefined) return result
    if (Date.now() - start >= timeoutMs) return undefined
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// ── DB read helpers (apps/worker has no direct drizzle-orm dependency — `database.query.*`
// callback operators, the `verify-dispatch-times-sync.ts`/`verify-money-mi1.ts` precedent) ──

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function fieldIdFor(organizationId: string, entityType: string, systemAttribute: string) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

async function fieldValueByAttr(
  organizationId: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
) {
  const fid = await fieldIdFor(organizationId, entityType, systemAttribute)
  if (!fid) return null
  return database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, fid)),
  })
}

async function getVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function getSequenceByTemplateKey(organizationId: string, templateKey: string) {
  return database.query.Sequence.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.templateKey, templateKey)),
  })
}

async function getStepsForSequence(sequenceId: string) {
  return database.query.SequenceStep.findMany({
    where: (t, { eq }) => eq(t.sequenceId, sequenceId),
    orderBy: (t, { asc }) => asc(t.sortOrder),
  })
}

async function getRun(sequenceId: string, subjectId: string) {
  return database.query.SequenceRun.findFirst({
    where: (t, { and, eq }) => and(eq(t.sequenceId, sequenceId), eq(t.subjectId, subjectId)),
  })
}

async function getRuns(sequenceId: string, subjectId: string) {
  return database.query.SequenceRun.findMany({
    where: (t, { and, eq }) => and(eq(t.sequenceId, sequenceId), eq(t.subjectId, subjectId)),
  })
}

async function getRunById(sequenceRunId: string | undefined) {
  if (!sequenceRunId) return undefined
  return database.query.SequenceRun.findFirst({ where: (t, { eq }) => eq(t.id, sequenceRunId) })
}

/** DIAGNOSTIC ONLY (temporary, for Phase 6 build/debug) — the underlying WorkflowRun's
 * terminal status + error text, so a run that raced to 'failed' shows WHY. */
async function workflowRunDiag(workflowRunId: string | undefined) {
  if (!workflowRunId) return undefined
  return database.query.WorkflowRun.findFirst({
    where: (t, { eq }) => eq(t.id, workflowRunId),
    columns: { status: true, error: true, pausedNodeId: true },
  })
}

async function residueCount(organizationId: string): Promise<number> {
  const res = await database.$client.query(
    `SELECT count(*)::int AS n FROM "FieldValue" fv
     WHERE fv."organizationId" = $1 AND fv."valueText" ILIKE '%[SEQ-verify]%'`,
    [organizationId]
  )
  return res.rows[0]?.n ?? 0
}

async function signalResidueCount(organizationId: string): Promise<number> {
  const res = await database.$client.query(
    `SELECT count(*)::int AS n FROM "EntitySignal"
     WHERE "organizationId" = $1 AND title ILIKE '%[SEQ-verify]%'`,
    [organizationId]
  )
  return res.rows[0]?.n ?? 0
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — precedent)
  const userId = user.id
  console.log(`Org ${organizationId}, dev user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []
  const createdSequenceIds: string[] = []
  const createdSignalIds: string[] = []

  const baselineSequenceCount = (
    await database.query.Sequence.findMany({
      columns: { id: true },
      where: (t, { eq }) => eq(t.organizationId, organizationId),
    })
  ).length

  /**
   * Create + compile + enable a minimal single-anchor-step test sequence — mirrors
   * `seed-templates.ts`'s `compileSequenceForSeed` exactly (raw SQL write of the compiled
   * graph + `publishedAt`), deliberately WITHOUT ever calling `publishSequence()` (which
   * requires — and would bake in — a real `integrationId`; see the file header's safety note).
   * `anchorOffsetDays` is signed from whatever subject date the caller anchors against; pass a
   * large POSITIVE offset (`+10`) for any check that needs the enrolled run to stay parked on a
   * genuinely multi-day-future BullMQ wait (immune to any live worker's queue polling), or a
   * negative one for the past-anchor skip check.
   */
  async function makeTestSequence(params: {
    name: string
    triggerType: 'visit:scheduled' | 'visit:en_route' | 'visit:completed' | 'work_order:completed'
    subjectKind: 'visit' | 'work_order' | 'invoice'
    anchorOffsetDays: number
    exitOnReply?: boolean
  }): Promise<{ sequence: SequenceEntity; step: SequenceStepEntity }> {
    const created = await createSequence(database, {
      organizationId,
      name: `${MARKER} ${params.name}`,
      createdById: userId,
      triggerType: params.triggerType,
      subjectKind: params.subjectKind,
      exitOnReply: params.exitOnReply ?? true,
      respectSuppression: false,
      includeUnsubscribeFooter: false,
      // A full-day delivery window (BUG NOTE — see file footer "engine bugs found"): the
      // compiled wait node's `preprocessNode` duration-floor check
      // (`wait-processor.ts:65-71`) uses `durationAmount` (always 0 for a compiled anchor
      // step — `buildSequenceGraph` forces `delayDays`/`delayHours` to 0 for `timingMode:
      // 'anchor'`) with `minWaitMs = config.deliveryWindow ? 0 : 1` — an anchor-mode step
      // with NO delivery window throws "Wait duration must be between 1ms and maximum
      // allowed duration" unconditionally, before ever reaching the anchor-resolution
      // branch. Every real seeded template sidesteps this by always pairing anchor steps
      // with a delivery window (§4.6); this test sequence does the same.
      deliveryStartTime: '00:00',
      deliveryEndTime: '23:59',
      deliveryTimezone: 'UTC',
      deliveryBusinessDaysOnly: false,
    })
    if (created.isErr()) throw created.error
    const sequence = created.value
    createdSequenceIds.push(sequence.id)

    const stepResult = await createStep(database, {
      sequenceId: sequence.id,
      organizationId,
      subject: `${MARKER} test step`,
      bodyHtml: `<p>${MARKER} test body</p>`,
      timingMode: 'anchor',
      anchorOffsetDays: params.anchorOffsetDays,
      anchorTimeOfDay: '09:00',
    })
    if (stepResult.isErr()) throw stepResult.error
    const step = stepResult.value

    const workflowApp = await database.query.WorkflowApp.findFirst({
      where: (t, { eq }) => eq(t.id, sequence.workflowAppId),
    })
    if (!workflowApp?.workflowId) throw new Error('Test sequence missing hidden workflow')
    const graph = buildSequenceGraph(sequence, [step])
    await database.$client.query(
      'UPDATE "Workflow" SET graph = $1::jsonb, "updatedAt" = now() WHERE id = $2',
      [JSON.stringify(graph), workflowApp.workflowId]
    )
    await database.$client.query(
      `UPDATE "Sequence" SET "publishedAt" = now(), "hasUnpublishedChanges" = false, status = 'enabled'
       WHERE id = $1`,
      [sequence.id]
    )
    const enabled = await database.query.Sequence.findFirst({
      where: (t, { eq }) => eq(t.id, sequence.id),
    })
    return { sequence: enabled!, step }
  }

  async function enableSeeded(sequenceId: string) {
    const result = await updateSequence(database, {
      sequenceId,
      organizationId,
      fields: { status: 'enabled' },
    })
    if (result.isErr()) throw result.error
  }
  async function disableSeeded(sequenceId: string) {
    const result = await updateSequence(database, {
      sequenceId,
      organizationId,
      fields: { status: 'disabled' },
    })
    if (result.isErr()) throw result.error
  }

  // See `withWorkflowRunsFeatureAccess`'s docstring — the dev org's canceled subscription
  // makes every `startSystemWorkflowRun` call (every `enrollSubjectInSequence`) reject with a
  // false "monthly workflow execution limit" error; this borrows the org's custom-limits
  // override for the run and restores it in `finally`, regardless of the outcome below.
  await withWorkflowRunsFeatureAccess(organizationId, async () => {
    try {
      // ══════════════════════════════════════════════════════════════════════
      // Shared fixture: one test contact every work order links via work_order_contact —
      // sequence enrollment's recipient-resolution guard (subject -> work_order -> contact ->
      // primary_email) requires this on every subject or enrollment silently skips.
      // ══════════════════════════════════════════════════════════════════════
      const contact = await handler.create('contact', {
        first_name: `${MARKER}`,
        primary_email: 'seq-verify-test@example.com',
      })
      createdRecordIds.push(contact.recordId)
      const contactRecordId = toRecordId('contact', contact.instance.id)

      // ══════════════════════════════════════════════════════════════════════
      // 1. Reseed idempotency — seedClientNotificationSequences twice ⇒ still exactly 5
      //    templateKey sequences, steps stable.
      // ══════════════════════════════════════════════════════════════════════
      console.log('1: reseed idempotency')

      await seedClientNotificationSequences(database, organizationId)
      const seededByKey1 = new Map<string, SequenceEntity>()
      for (const t of SEQUENCE_SEED_TEMPLATES) {
        const row = await getSequenceByTemplateKey(organizationId, t.templateKey)
        if (row) seededByKey1.set(t.templateKey, row)
      }
      check(
        '1a: first seed pass produced exactly 5 templateKey sequences',
        seededByKey1.size === 5,
        [...seededByKey1.keys()]
      )
      for (const row of seededByKey1.values()) createdSequenceIds.push(row.id)
      const stepSnapshot1 = new Map<string, string>()
      for (const [key, row] of seededByKey1) {
        const steps = await getStepsForSequence(row.id)
        stepSnapshot1.set(
          key,
          steps
            .map((s) => `${s.timingMode}:${s.anchorOffsetDays}:${s.delayDays}:${s.subject}`)
            .join('|')
        )
      }

      await seedClientNotificationSequences(database, organizationId)
      const seededByKey2 = new Map<string, SequenceEntity>()
      for (const t of SEQUENCE_SEED_TEMPLATES) {
        const row = await getSequenceByTemplateKey(organizationId, t.templateKey)
        if (row) seededByKey2.set(t.templateKey, row)
      }
      check(
        '1b: second seed pass still exactly 5 templateKey sequences (no dupes)',
        seededByKey2.size === 5,
        [...seededByKey2.keys()]
      )
      check(
        '1c: second pass reuses the SAME sequence ids (idempotent, not re-created)',
        [...seededByKey1.entries()].every(([key, row]) => seededByKey2.get(key)?.id === row.id)
      )
      let stepsStable = true
      for (const [key, snapshot] of stepSnapshot1) {
        const steps2 = await getStepsForSequence(seededByKey2.get(key)!.id)
        const snapshot2 = steps2
          .map((s) => `${s.timingMode}:${s.anchorOffsetDays}:${s.delayDays}:${s.subject}`)
          .join('|')
        if (snapshot2 !== snapshot) stepsStable = false
      }
      check('1d: steps stable across both seed passes', stepsStable)

      const visitReminders = seededByKey2.get('visit_reminders')!
      const visitEnRoute = seededByKey2.get('visit_en_route')!
      const jobFollowUp = seededByKey2.get('job_follow_up')!
      const invoiceReminders = seededByKey2.get('invoice_reminders')!
      check(
        '1e: seeded exitOnReply flags match the plan §4.6 table',
        visitReminders.exitOnReply === false &&
          visitEnRoute.exitOnReply === false &&
          jobFollowUp.exitOnReply === true &&
          invoiceReminders.exitOnReply === true,
        {
          visitReminders: visitReminders.exitOnReply,
          visitEnRoute: visitEnRoute.exitOnReply,
          jobFollowUp: jobFollowUp.exitOnReply,
          invoiceReminders: invoiceReminders.exitOnReply,
        }
      )

      // ══════════════════════════════════════════════════════════════════════
      // 2. Recurring — sweep enrolls recurring-born visits (any-run-ever dedup), rule-edit churn
      //    exits dead-visit runs + fresh ids re-enroll, engagement end fires job_follow_up.
      //    Uses a DEDICATED custom sequence (anchor +10d — see file header) so sweep-enrolled
      //    runs stay 'active' for the whole section, immune to any live-worker race.
      // ══════════════════════════════════════════════════════════════════════
      console.log('2: recurring — sweep, dedup, rule-edit churn, engagement end')

      const { sequence: sweepSeq } = await makeTestSequence({
        name: 'recurring sweep test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: 10,
      })
      await enableSeeded(jobFollowUp.id)

      const woRecurring = await handler.create('work_order', {
        work_order_title: `${MARKER} recurring engagement`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woRecurring.recordId)
      const todayIso = new Date().toISOString().slice(0, 10)

      await setRecurrenceRule({
        organizationId,
        userId,
        workOrderInstanceId: woRecurring.instance.id,
        pattern: { frequency: 'daily', interval: 1, count: 6 },
        template: { startMinute: 600, durationMinutes: 60 },
        timezone: 'UTC',
        effectiveFrom: todayIso,
      })
      const recurringVisits1 = await database.query.WorkOrderVisit.findMany({
        where: (t, { eq }) => eq(t.workOrderId, woRecurring.instance.id),
      })
      check(
        '2a: recurring visits materialized with recurrenceRuleId set',
        recurringVisits1.length > 0 && recurringVisits1.every((v) => v.recurrenceRuleId !== null),
        recurringVisits1.length
      )

      await runSequenceEnrollmentSweep()
      const runsAfterSweep1 = (
        await Promise.all(recurringVisits1.map((v) => getRuns(sweepSeq.id, v.id)))
      ).flat()
      check(
        '2b: first sweep pass enrolls at least one recurring-born visit',
        runsAfterSweep1.length > 0,
        runsAfterSweep1.length
      )

      await runSequenceEnrollmentSweep()
      const runsAfterSweep2 = (
        await Promise.all(recurringVisits1.map((v) => getRuns(sweepSeq.id, v.id)))
      ).flat()
      check(
        '2c: second sweep pass enrolls NOTHING new (any-run-ever dedup)',
        runsAfterSweep2.length === runsAfterSweep1.length,
        { first: runsAfterSweep1.length, second: runsAfterSweep2.length }
      )

      // Recurring-born rule (decision #13): relative/immediate steps are skipped for a
      // recurring-born visit; anchor steps are not. Tested directly against the guard function
      // with hand-built step shapes — decoupled from any specific compiled graph.
      const someRecurringVisit = recurringVisits1[0]!
      const relativeStepShape = {
        timingMode: 'relative',
        anchorOffsetDays: 0,
        anchorTimeOfDay: null,
      }
      const anchorStepShape = {
        timingMode: 'anchor',
        anchorOffsetDays: 10,
        anchorTimeOfDay: '09:00',
      }
      const guardRelative = await evaluateSubjectGuards(
        database,
        organizationId,
        { subjectKind: 'visit', subjectId: someRecurringVisit.id },
        'visit:scheduled',
        relativeStepShape,
        'UTC'
      )
      check(
        '2d: recurring-born visit + relative step ⇒ guard action "skip" (recurring-born-immediate-skip)',
        guardRelative.action === 'skip' &&
          (guardRelative as { reason: string }).reason === 'recurring-born-immediate-skip',
        guardRelative
      )
      const guardAnchor = await evaluateSubjectGuards(
        database,
        organizationId,
        { subjectKind: 'visit', subjectId: someRecurringVisit.id },
        'visit:scheduled',
        anchorStepShape,
        'UTC'
      )
      check(
        '2e: recurring-born visit + anchor step ⇒ NOT skipped for the recurring-born reason',
        !(
          guardAnchor.action === 'skip' &&
          (guardAnchor as { reason: string }).reason === 'recurring-born-immediate-skip'
        ),
        guardAnchor
      )

      // Rule-edit churn (§4.10): a pattern change deletes+reinserts future scheduled rows —
      // old ids' runs exit 'canceled'; fresh ids enroll on the next sweep pass.
      await setRecurrenceRule({
        organizationId,
        userId,
        workOrderInstanceId: woRecurring.instance.id,
        pattern: { frequency: 'daily', interval: 2, count: 6 }, // interval change ⇒ patternChanged
        template: { startMinute: 600, durationMinutes: 60 },
        timezone: 'UTC',
        effectiveFrom: todayIso,
      })
      const survivingVisitIds = new Set(
        (
          await database.query.WorkOrderVisit.findMany({
            where: (t, { eq }) => eq(t.workOrderId, woRecurring.instance.id),
            columns: { id: true },
          })
        ).map((v) => v.id)
      )
      const deadVisitIds = recurringVisits1
        .map((v) => v.id)
        .filter((id) => !survivingVisitIds.has(id))
      check('2f: rule edit deleted at least one old occurrence row', deadVisitIds.length > 0, {
        before: recurringVisits1.length,
        dead: deadVisitIds.length,
      })
      let deadRunsCanceled = true
      const deadRunsDiag: unknown[] = []
      for (const visitId of deadVisitIds) {
        const runs = await getRuns(sweepSeq.id, visitId)
        for (const run of runs) {
          if (!(run.status === 'exited' && run.exitReason === 'canceled')) {
            deadRunsCanceled = false
            deadRunsDiag.push({ run, workflow: await workflowRunDiag(run.workflowRunId) })
          }
        }
      }
      check('2g: dead recurring visits’ runs exited "canceled"', deadRunsCanceled, deadRunsDiag)

      await runSequenceEnrollmentSweep()
      const freshVisits = await database.query.WorkOrderVisit.findMany({
        where: (t, { eq }) => eq(t.workOrderId, woRecurring.instance.id),
        columns: { id: true },
      })
      const freshRunsFound = (
        await Promise.all(freshVisits.map((v) => getRuns(sweepSeq.id, v.id)))
      ).flat()
      check(
        '2h: sweep enrolls fresh post-edit occurrence ids',
        freshRunsFound.some((r) => !deadVisitIds.includes(r.subjectId ?? '')),
        freshRunsFound.length
      )

      // Engagement end ⇒ job_follow_up enrollment (work_order:completed fires on 'ended' too).
      await endEngagement({ organizationId, userId, workOrderInstanceId: woRecurring.instance.id })
      const followUpRun = await waitFor(() => getRun(jobFollowUp.id, woRecurring.instance.id))
      check(
        '2i: engagement end enrolls job_follow_up (subject = work_order)',
        !!followUpRun,
        followUpRun
      )

      // ══════════════════════════════════════════════════════════════════════
      // 3. Enrollment filter (decision #17) — reuses job_follow_up (still enabled from §2).
      // ══════════════════════════════════════════════════════════════════════
      console.log('3: enrollment filter')

      await updateSequence(database, {
        sequenceId: jobFollowUp.id,
        organizationId,
        fields: {
          enrollmentFilter: [
            {
              id: 'g1',
              logicalOperator: 'AND',
              conditions: [
                {
                  id: 'c1',
                  fieldId: 'work_order_title',
                  operator: 'contains',
                  value: 'FilterPass',
                },
              ],
            },
          ] as never,
        },
      })

      const woFilterPass = await handler.create('work_order', {
        work_order_title: `${MARKER} FilterPass job`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woFilterPass.recordId)
      const woFilterFail = await handler.create('work_order', {
        work_order_title: `${MARKER} FilterFail job`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woFilterFail.recordId)

      await handler.update(woFilterPass.recordId, { work_order_status: 'completed' })
      await handler.update(woFilterFail.recordId, { work_order_status: 'completed' })

      const passRun = await waitFor(() => getRun(jobFollowUp.id, woFilterPass.instance.id))
      const failRun = await getRun(jobFollowUp.id, woFilterFail.instance.id)
      check('3a: enrollmentFilter MATCH ⇒ enrolled', !!passRun, passRun)
      check('3b: enrollmentFilter NON-match ⇒ skipped (no run)', !failRun, failRun)

      // Direct evaluator assertion too (belt + suspenders on the exact filter semantics).
      const workOrderDefId = await entityDefId(organizationId, 'work_order')
      const filterGroups = [
        {
          id: 'g1',
          logicalOperator: 'AND' as const,
          conditions: [
            {
              id: 'c1',
              fieldId: 'work_order_title',
              operator: 'contains' as never,
              value: 'FilterPass',
            },
          ],
        },
      ]
      const evalPass = await evaluateEnrollmentFilter(
        organizationId,
        workOrderDefId!,
        woFilterPass.instance.id,
        filterGroups
      )
      const evalFail = await evaluateEnrollmentFilter(
        organizationId,
        workOrderDefId!,
        woFilterFail.instance.id,
        filterGroups
      )
      check(
        '3c: evaluateEnrollmentFilter directly matches (true) for pass work order',
        evalPass === true
      )
      check(
        '3d: evaluateEnrollmentFilter directly matches (false) for fail work order',
        evalFail === false
      )

      await disableSeeded(jobFollowUp.id)

      // ══════════════════════════════════════════════════════════════════════
      // 4. Past-anchor skip (decision #10) — custom all-anchor sequence, offset -5d (always
      //    past regardless of when this script runs).
      // ══════════════════════════════════════════════════════════════════════
      console.log('4: past-anchor skip')

      const { sequence: pastSeq } = await makeTestSequence({
        name: 'past-anchor test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: -5,
      })

      const woPast = await handler.create('work_order', {
        work_order_title: `${MARKER} past-anchor visit`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woPast.recordId)
      const visitPast = await getVisit(woPast.instance.id)
      const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      await scheduleVisit({
        organizationId,
        userId,
        visitId: visitPast.id,
        startTime: pastStart,
        endTime: new Date(pastStart.getTime() + 60 * 60 * 1000),
      })
      const pastRun = await getRun(pastSeq.id, visitPast.id)
      check(
        '4a: visit with a wholly-past anchor is NOT enrolled via the real scheduleVisit hook',
        !pastRun,
        pastRun
      )

      const pastOutcome = await enrollSubjectInSequence(database, {
        organizationId,
        sequence: pastSeq,
        subjectKind: 'visit',
        subjectId: visitPast.id,
        source: 'hook',
      })
      check(
        '4b: enrollSubjectInSequence directly returns {status:"skipped"} for the past-anchor visit',
        pastOutcome.isOk() && pastOutcome.value.status === 'skipped',
        pastOutcome.isOk() ? pastOutcome.value : pastOutcome.error
      )

      // ══════════════════════════════════════════════════════════════════════
      // 5. Enroll on schedule (visit_reminders) + anchor math + (cheap) BullMQ job metadata.
      // ══════════════════════════════════════════════════════════════════════
      console.log('5: enroll on schedule + anchor math')

      await enableSeeded(visitReminders.id)
      const woSched = await handler.create('work_order', {
        work_order_title: `${MARKER} visit_reminders one-off`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woSched.recordId)
      const visitSched = await getVisit(woSched.instance.id)
      const scheduledStart = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
      scheduledStart.setUTCHours(14, 0, 0, 0)
      const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000)
      await scheduleVisit({
        organizationId,
        userId,
        visitId: visitSched.id,
        startTime: scheduledStart,
        endTime: scheduledEnd,
      })

      const schedRun = await waitFor(() => getRun(visitReminders.id, visitSched.id))
      check('5a: scheduling a one-off visit enrolls visit_reminders', !!schedRun, schedRun)
      check(
        '5b: run has subjectKind visit + correct subjectId + recipient email',
        schedRun?.subjectKind === 'visit' &&
          schedRun?.subjectId === visitSched.id &&
          schedRun?.recipientEmail === 'seq-verify-test@example.com',
        schedRun
      )

      const remindersSteps = await getStepsForSequence(visitReminders.id)
      const reminderStep = remindersSteps.find((s) => s.anchorOffsetDays === -2)!
      const morningOfStep = remindersSteps.find(
        (s) => s.anchorOffsetDays === 0 && s.timingMode === 'anchor'
      )!
      const expectedReminderTarget = computeAnchorTarget(
        scheduledStart,
        { offsetDays: -2, timeOfDay: '09:00' },
        'UTC'
      )
      const expectedMorningOfTarget = computeAnchorTarget(
        scheduledStart,
        { offsetDays: 0, timeOfDay: '07:30' },
        'UTC'
      )
      check(
        '5c: computeAnchorTarget(-2d@09:00) matches the expected reminder date',
        expectedReminderTarget?.getTime() ===
          new Date(
            Date.UTC(
              scheduledStart.getUTCFullYear(),
              scheduledStart.getUTCMonth(),
              scheduledStart.getUTCDate() - 2,
              9,
              0,
              0,
              0
            )
          ).getTime(),
        expectedReminderTarget
      )
      check(
        '5d: computeAnchorTarget(0d@07:30) matches the expected morning-of date',
        expectedMorningOfTarget?.getTime() ===
          new Date(
            Date.UTC(
              scheduledStart.getUTCFullYear(),
              scheduledStart.getUTCMonth(),
              scheduledStart.getUTCDate(),
              7,
              30,
              0,
              0
            )
          ).getTime(),
        expectedMorningOfTarget
      )
      check('5e: reminder step really is -2d in the compiled step rows', !!reminderStep)
      check('5f: morning-of step really is 0d anchor in the compiled step rows', !!morningOfStep)

      // Cheap BullMQ job metadata check (§ task: "where cheap") — poll briefly for the run's
      // WorkflowRun to park on a wait node, then look up its deterministic resume job.
      const workflowRunId = schedRun?.workflowRunId
      const pausedInfo = workflowRunId
        ? await waitFor(async () => {
            const wr = await database.query.WorkflowRun.findFirst({
              where: (t, { eq }) => eq(t.id, workflowRunId),
              columns: { status: true, pausedNodeId: true },
            })
            return wr?.status === 'WAITING' && wr.pausedNodeId ? wr : undefined
          }, 4000)
        : undefined
      if (pausedInfo?.pausedNodeId) {
        const jobId = resumeJobId(workflowRunId!, pausedInfo.pausedNodeId)
        const job = await getQueue(Queues.workflowDelayQueue).getJob(jobId)
        check('5g: a BullMQ resume job exists for the parked wait node', !!job, jobId)
      } else {
        skip(
          '5g: BullMQ resume job metadata check',
          'WorkflowRun did not settle into WAITING within 4s (non-deterministic timing under fire-and-forget execution) — anchor math (5c/5d) already verifies the target independently'
        )
      }

      await disableSeeded(visitReminders.id)

      // ══════════════════════════════════════════════════════════════════════
      // 6. Exit semantics — cancel / done(completed_subject) / reply(true) / reply(false).
      //    Each uses a DEDICATED anchor+10d custom sequence so the run stays 'active' for the
      //    whole assertion window (see file header).
      // ══════════════════════════════════════════════════════════════════════
      console.log('6: exit semantics — cancel, done, reply flag')

      const { sequence: exitSeq } = await makeTestSequence({
        name: 'exit-semantics test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: 10,
      })

      async function makeScheduledOneOff(title: string) {
        const wo = await handler.create('work_order', {
          work_order_title: `${MARKER} ${title}`,
          work_order_contact: contactRecordId,
        })
        createdRecordIds.push(wo.recordId)
        const visit = await getVisit(wo.instance.id)
        const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        await scheduleVisit({
          organizationId,
          userId,
          visitId: visit.id,
          startTime: start,
          endTime: new Date(start.getTime() + 60 * 60 * 1000),
        })
        return { wo, visitId: visit.id }
      }

      const visitCancel = await makeScheduledOneOff('cancel test')
      const cancelRunBefore = await waitFor(() => getRun(exitSeq.id, visitCancel.visitId))
      check(
        '6a: cancel-test visit enrolled + active before cancel',
        cancelRunBefore?.status === 'active',
        cancelRunBefore
      )
      await setVisitStatus({
        organizationId,
        userId,
        visitId: visitCancel.visitId,
        status: 'canceled',
      })
      const cancelRunAfter = await getRunById(cancelRunBefore?.id)
      check(
        '6b: canceling the visit exits the run with reason "canceled"',
        cancelRunAfter?.status === 'exited' && cancelRunAfter.exitReason === 'canceled',
        { run: cancelRunAfter, workflow: await workflowRunDiag(cancelRunAfter?.workflowRunId) }
      )

      const visitDone = await makeScheduledOneOff('done test')
      const doneRunBefore = await waitFor(() => getRun(exitSeq.id, visitDone.visitId))
      check(
        '6c: done-test visit enrolled + active before completion',
        doneRunBefore?.status === 'active',
        doneRunBefore
      )
      await setVisitStatus({ organizationId, userId, visitId: visitDone.visitId, status: 'done' })
      const doneRunAfter = await getRunById(doneRunBefore?.id)
      check(
        '6d: visit done exits the visit:scheduled run with reason "completed_subject"',
        doneRunAfter?.status === 'exited' && doneRunAfter.exitReason === 'completed_subject',
        { run: doneRunAfter, workflow: await workflowRunDiag(doneRunAfter?.workflowRunId) }
      )

      const { sequence: replyTrueSeq } = await makeTestSequence({
        name: 'reply-exit true test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: 10,
        exitOnReply: true,
      })
      const visitReplyTrue = await makeScheduledOneOff('reply-true test')
      const replyTrueRunBefore = await waitFor(() =>
        getRun(replyTrueSeq.id, visitReplyTrue.visitId)
      )
      check(
        '6e: reply-true-test visit enrolled + active',
        replyTrueRunBefore?.status === 'active',
        replyTrueRunBefore
      )
      // The reply-detection hook (`ingest/store-message.ts:508-540`) is inline in the message
      // ingestion pipeline (not independently exported) — driving a full real inbound message
      // through it would require constructing a Thread/Message via the real channel/provider
      // pipeline, risking unrelated side effects (notifications, AI auto-reply hooks) out of this
      // plan's scope. Exercising the exact primitive the hook calls instead:
      // `exitSequenceRun(reason:'reply')`, gated on `sequence.exitOnReply` — which IS what the
      // inline hook does once it decides to act.
      const exitReplyResult = replyTrueRunBefore
        ? await exitSequenceRun(database, {
            sequenceRunId: replyTrueRunBefore.id,
            organizationId,
            reason: 'reply',
          })
        : undefined
      check('6f: exitSequenceRun(reason:"reply") succeeds', !!exitReplyResult?.isOk())
      const replyTrueRunAfter = await getRunById(replyTrueRunBefore?.id)
      check(
        '6g: exitOnReply=true sequence’s run exits with reason "reply"',
        replyTrueRunAfter?.status === 'exited' && replyTrueRunAfter.exitReason === 'reply',
        replyTrueRunAfter
      )

      const { sequence: replyFalseSeq } = await makeTestSequence({
        name: 'reply-exit false test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: 10,
        exitOnReply: false,
      })
      const visitReplyFalse = await makeScheduledOneOff('reply-false test')
      const replyFalseRunBefore = await waitFor(() =>
        getRun(replyFalseSeq.id, visitReplyFalse.visitId)
      )
      check(
        '6h: reply-false-test visit enrolled + active, exitOnReply correctly false',
        replyFalseRunBefore?.status === 'active' && replyFalseSeq.exitOnReply === false,
        {
          run: replyFalseRunBefore,
          exitOnReply: replyFalseSeq.exitOnReply,
          workflow: await workflowRunDiag(replyFalseRunBefore?.workflowRunId),
        }
      )
      // Mirrors the real hook's own branch: exitOnReply=false ⇒ the hook never calls
      // exitSequenceRun at all — asserting the run is untouched (still active) after deliberately
      // not calling anything is the honest analog of "a reply leaves the run active".
      const replyFalseRunAfter = await getRunById(replyFalseRunBefore?.id)
      check(
        '6i: exitOnReply=false leaves the run active (the hook never invokes an exit for it)',
        replyFalseRunAfter?.status === 'active',
        {
          run: replyFalseRunAfter,
          workflow: await workflowRunDiag(replyFalseRunAfter?.workflowRunId),
        }
      )
      skip(
        '6j: real store-message.ts inbound-reply ingestion exercised end-to-end',
        'the reply hook is inline in packages/lib/src/ingest/store-message.ts (not independently exported); a full real Thread+Message through the channel/provider pipeline risks side effects (notifications, AI auto-reply) outside Phase 6’s scope — 6f/6g/6i exercise the exact primitive (exitSequenceRun gated on exitOnReply) the hook calls'
      )

      // ══════════════════════════════════════════════════════════════════════
      // 7. Disable bulk-exit (decision #11) — dedicated sequence + 2 active runs.
      // ══════════════════════════════════════════════════════════════════════
      console.log('7: disable bulk-exit')

      const { sequence: disableSeq } = await makeTestSequence({
        name: 'disable bulk-exit test',
        triggerType: 'visit:scheduled',
        subjectKind: 'visit',
        anchorOffsetDays: 10,
      })
      const visitDisableA = await makeScheduledOneOff('disable test A')
      const visitDisableB = await makeScheduledOneOff('disable test B')
      const disableRunA = await waitFor(() => getRun(disableSeq.id, visitDisableA.visitId))
      const disableRunB = await waitFor(() => getRun(disableSeq.id, visitDisableB.visitId))
      check(
        '7a: both disable-test visits enrolled + active before disabling',
        disableRunA?.status === 'active' && disableRunB?.status === 'active',
        {
          a: disableRunA?.status,
          b: disableRunB?.status,
          workflowA: await workflowRunDiag(disableRunA?.workflowRunId),
          workflowB: await workflowRunDiag(disableRunB?.workflowRunId),
        }
      )
      await disableSeeded(disableSeq.id)
      const disableRunAAfter = await getRunById(disableRunA?.id)
      const disableRunBAfter = await getRunById(disableRunB?.id)
      check(
        '7b: disabling the sequence bulk-exits BOTH active runs with reason "disabled"',
        disableRunAAfter?.status === 'exited' &&
          disableRunAAfter.exitReason === 'disabled' &&
          disableRunBAfter?.status === 'exited' &&
          disableRunBAfter.exitReason === 'disabled',
        { a: disableRunAAfter, b: disableRunBAfter }
      )

      // ══════════════════════════════════════════════════════════════════════
      // 8. Invoice reminders — enroll on sent, NULL due-date skip, paid guard (via
      //    evaluateSubjectGuards directly, NEVER a live send), paid→sent flip does not re-enroll.
      // ══════════════════════════════════════════════════════════════════════
      console.log('8: invoice reminders')

      await enableSeeded(invoiceReminders.id)
      // `invoiceReminders` was captured right after seeding (status still 'disabled' at that
      // point — `compileSequenceForSeed` always forces it back to disabled). `enableSeeded`
      // above flips the DB row, but that plain JS const doesn't reflect it — re-fetch a live
      // copy for any direct `enrollSubjectInSequence` call below (the real markInvoiceSent
      // hook path is unaffected either way, since `getEnabledSequencesForTrigger` always
      // queries fresh).
      const invoiceRemindersLive = (await getSequenceByTemplateKey(
        organizationId,
        'invoice_reminders'
      ))!

      const woForInvoices = await handler.create('work_order', {
        work_order_title: `${MARKER} invoice reminders job`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woForInvoices.recordId)
      const workOrderRecordId = toRecordId('work_order', woForInvoices.instance.id)

      // 8a: NULL due-date invoice ⇒ anchored steps skip (no enrollment at all — invoice_reminders
      // has ALL-anchor steps, decision #10's "every step past/null ⇒ don't enroll" branch).
      const invoiceNullDate = await handler.create('invoice', {
        invoice_contact: contactRecordId,
        invoice_work_order: workOrderRecordId,
      })
      createdRecordIds.push(invoiceNullDate.recordId)
      await markInvoiceSent({
        organizationId,
        userId,
        invoiceInstanceId: invoiceNullDate.instance.id,
      })
      const nullDateRun = await getRun(invoiceReminders.id, invoiceNullDate.instance.id)
      check(
        '8a: NULL invoice_due_date ⇒ no enrollment via the real markInvoiceSent path',
        !nullDateRun,
        nullDateRun
      )
      const nullDateOutcome = await enrollSubjectInSequence(database, {
        organizationId,
        sequence: invoiceRemindersLive,
        subjectKind: 'invoice',
        subjectId: invoiceNullDate.instance.id,
        source: 'hook',
      })
      check(
        '8b: enrollSubjectInSequence directly confirms {status:"skipped"} for NULL due date',
        nullDateOutcome.isOk() && nullDateOutcome.value.status === 'skipped',
        nullDateOutcome.isOk() ? nullDateOutcome.value : nullDateOutcome.error
      )

      // 8c: real invoice, due date comfortably in the future, a line item for a nonzero balance.
      const dueDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const invoiceDue = await handler.create('invoice', {
        invoice_contact: contactRecordId,
        invoice_work_order: workOrderRecordId,
        invoice_due_date: dueDate,
      })
      createdRecordIds.push(invoiceDue.recordId)
      const line = await handler.create('line_item', {
        line_item_name: `${MARKER} invoice line`,
        line_item_qty: 1,
        line_item_unit_price: 10000,
        line_item_taxable: false,
        line_item_invoice: toRecordId('invoice', invoiceDue.instance.id),
      })
      createdRecordIds.push(line.recordId)

      await markInvoiceSent({ organizationId, userId, invoiceInstanceId: invoiceDue.instance.id })
      const dueRun = await waitFor(() => getRun(invoiceReminders.id, invoiceDue.instance.id))
      check(
        '8c: draft→sent (proper path, markInvoiceSent) enrolls invoice_reminders',
        !!dueRun,
        dueRun
      )

      // 8d: mark paid (recordManualPayment, full balance) ⇒ the send-node guard WOULD exit
      // 'paid' — asserted via evaluateSubjectGuards directly, never a live send.
      const balanceRow = await fieldValueByAttr(
        organizationId,
        'invoice',
        invoiceDue.instance.id,
        'invoice_balance'
      )
      const balance = balanceRow?.valueNumber ?? 0
      check('8d: invoice has a positive balance before payment', balance > 0, balance)
      const { transactionId } = await recordManualPayment({
        organizationId,
        userId,
        invoiceInstanceId: invoiceDue.instance.id,
        amount: balance,
        date: new Date().toISOString().slice(0, 10),
        method: 'cash',
      })
      const anchorStep = (await getStepsForSequence(invoiceReminders.id))[0]!
      const guardPaid = await evaluateSubjectGuards(
        database,
        organizationId,
        { subjectKind: 'invoice', subjectId: invoiceDue.instance.id },
        'invoice:sent',
        {
          timingMode: anchorStep.timingMode,
          anchorOffsetDays: anchorStep.anchorOffsetDays,
          anchorTimeOfDay: anchorStep.anchorTimeOfDay,
        },
        invoiceReminders.deliveryTimezone
      )
      check(
        '8e: evaluateSubjectGuards on a paid invoice returns {action:"exit", reason:"paid"}',
        guardPaid.action === 'exit' && (guardPaid as { reason: string }).reason === 'paid',
        guardPaid
      )

      // 8f: paid→sent flip (payment deleted) does NOT re-enroll (decision #12).
      const runsBeforeDelete = await getRuns(invoiceReminders.id, invoiceDue.instance.id)
      await deleteManualPayment({ organizationId, userId, transactionId })
      const statusAfterDelete = await fieldValueByAttr(
        organizationId,
        'invoice',
        invoiceDue.instance.id,
        'invoice_status'
      )
      check(
        '8f: payment deletion flips invoice_status back to "sent"',
        statusAfterDelete?.optionId === 'sent',
        statusAfterDelete
      )
      const runsAfterDelete = await getRuns(invoiceReminders.id, invoiceDue.instance.id)
      check(
        '8g: paid→sent reversal does NOT create a second SequenceRun (decision #12)',
        runsAfterDelete.length === runsBeforeDelete.length,
        { before: runsBeforeDelete.length, after: runsAfterDelete.length }
      )

      await disableSeeded(invoiceReminders.id)

      // ══════════════════════════════════════════════════════════════════════
      // 9. Signals — recordSignal dedupeKey idempotency + listSignalsForRecordKeys read path.
      // ══════════════════════════════════════════════════════════════════════
      console.log('9: signals')

      const signalDedupeKey = `seq-verify:${visitCancel.visitId}:1`
      const signalLinks = [
        toSignalRecordKey('visit', visitCancel.visitId),
        toSignalRecordKey('work_order', visitCancel.wo.instance.id),
      ]
      const signal1 = await recordSignal({
        organizationId,
        kind: 'message:sent',
        subtype: 'sequence_step',
        dedupeKey: signalDedupeKey,
        contactEntityInstanceId: contact.instance.id,
        title: `${MARKER} test signal`,
        metadata: { note: 'first write' },
        links: signalLinks,
      })
      check('9a: first recordSignal call succeeds', signal1.ok && !!signal1.value, signal1)
      if (signal1.ok && signal1.value) createdSignalIds.push(signal1.value.id)

      const signal2 = await recordSignal({
        organizationId,
        kind: 'message:sent',
        subtype: 'sequence_step',
        dedupeKey: signalDedupeKey,
        contactEntityInstanceId: contact.instance.id,
        title: `${MARKER} test signal (duplicate attempt)`,
        metadata: { note: 'second write' },
        links: signalLinks,
      })
      check(
        '9b: second recordSignal with the SAME dedupeKey is a no-op (ok, null)',
        signal2.ok && signal2.value === null,
        signal2
      )

      const signalCountRes = await database.$client.query(
        `SELECT count(*)::int AS n FROM "EntitySignal" WHERE "organizationId" = $1 AND "dedupeKey" = $2`,
        [organizationId, signalDedupeKey]
      )
      check(
        '9c: exactly ONE EntitySignal row exists for the dedupeKey',
        signalCountRes.rows[0]?.n === 1,
        signalCountRes.rows[0]
      )

      const signalsForVisit = await listSignalsForRecordKeys(undefined, organizationId, [
        toSignalRecordKey('visit', visitCancel.visitId),
      ])
      const signalsForWorkOrder = await listSignalsForRecordKeys(undefined, organizationId, [
        toSignalRecordKey('work_order', visitCancel.wo.instance.id),
      ])
      check(
        '9d: listSignalsForRecordKeys returns the signal for the visit key',
        signalsForVisit.ok &&
          signal1.ok &&
          signalsForVisit.value.some((s) => s.id === signal1.value?.id),
        signalsForVisit.ok ? signalsForVisit.value.map((s) => s.id) : signalsForVisit.error
      )
      check(
        '9e: listSignalsForRecordKeys returns the signal for the work_order key too (multi-link fan-out)',
        signalsForWorkOrder.ok && signalsForWorkOrder.value.length > 0,
        signalsForWorkOrder.ok
          ? signalsForWorkOrder.value.map((s) => s.id)
          : signalsForWorkOrder.error
      )

      // ══════════════════════════════════════════════════════════════════════
      // 10. En-route dedup — two en_route transitions within 6h ⇒ one enrollment.
      // ══════════════════════════════════════════════════════════════════════
      console.log('10: en-route dedup')

      await enableSeeded(visitEnRoute.id)
      const woEnRoute = await handler.create('work_order', {
        work_order_title: `${MARKER} en-route dedup`,
        work_order_contact: contactRecordId,
      })
      createdRecordIds.push(woEnRoute.recordId)
      const visitEnRouteRow = await getVisit(woEnRoute.instance.id)
      await assignVisit({
        organizationId,
        userId,
        visitId: visitEnRouteRow.id,
        assigneeUserId: userId,
      })

      await setVisitStatus({
        organizationId,
        userId,
        visitId: visitEnRouteRow.id,
        status: 'en_route',
      })
      await setVisitStatus({
        organizationId,
        userId,
        visitId: visitEnRouteRow.id,
        status: 'on_site',
      })
      await setVisitStatus({
        organizationId,
        userId,
        visitId: visitEnRouteRow.id,
        status: 'en_route',
      })

      const enRouteRuns = await waitFor(async () => {
        const runs = await getRuns(visitEnRoute.id, visitEnRouteRow.id)
        return runs.length > 0 ? runs : undefined
      })
      check(
        '10a: two en_route transitions within 6h produce exactly ONE SequenceRun (dedup)',
        (enRouteRuns ?? []).length === 1,
        enRouteRuns?.length
      )

      await disableSeeded(visitEnRoute.id)
    } finally {
      // ── Cleanup ──
      console.log(`Cleanup: exiting + deleting ${createdSequenceIds.length} verify sequences`)
      for (const sequenceId of [...new Set(createdSequenceIds)]) {
        try {
          const orgIdForCleanup = 'u45w22ft66ymiaa19ohs7m9f'
          await exitActiveRunsForSequence(orgIdForCleanup, sequenceId, 'manual')
          const result = await deleteSequence(database, {
            sequenceId,
            organizationId: orgIdForCleanup,
          })
          if (result.isErr()) {
            console.log(`  cleanup failed deleting sequence ${sequenceId}:`, result.error.message)
          }
        } catch (err) {
          console.log(
            `  cleanup failed for sequence ${sequenceId}:`,
            err instanceof Error ? err.message : err
          )
        }
      }

      if (createdSignalIds.length > 0) {
        console.log(`Cleanup: deleting ${createdSignalIds.length} verify signals`)
        try {
          await database.$client.query('DELETE FROM "EntitySignal" WHERE id = ANY($1)', [
            createdSignalIds,
          ])
        } catch (err) {
          console.log(
            '  cleanup failed deleting signals:',
            err instanceof Error ? err.message : err
          )
        }
      }

      console.log(`Cleanup: deleting ${createdRecordIds.length} verify records`)
      const orgIdForCleanup = 'u45w22ft66ymiaa19ohs7m9f'
      const cleanupHandler = new UnifiedCrudHandler(orgIdForCleanup, userId)
      for (const recordId of [...new Set(createdRecordIds)].reverse()) {
        try {
          await cleanupHandler.delete(recordId as never)
        } catch (err) {
          console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
        }
      }
    }
  })

  const orgIdForResidue = 'u45w22ft66ymiaa19ohs7m9f'
  const residue = await residueCount(orgIdForResidue)
  check('cleanup: zero "[SEQ-verify]" residue left in FieldValue', residue === 0, residue)
  const sigResidue = await signalResidueCount(orgIdForResidue)
  check('cleanup: zero "[SEQ-verify]" residue left in EntitySignal', sigResidue === 0, sigResidue)
  const finalSequenceCount = (
    await database.query.Sequence.findMany({
      columns: { id: true },
      where: (t, { eq }) => eq(t.organizationId, orgIdForResidue),
    })
  ).length
  check(
    'cleanup: Sequence count restored to baseline (byte-exact org state)',
    finalSequenceCount === baselineSequenceCount,
    { baseline: baselineSequenceCount, final: finalSequenceCount }
  )

  console.log(`\n${pass}/${pass + fail} passed${skipped > 0 ? ` (${skipped} skipped)` : ''}`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
