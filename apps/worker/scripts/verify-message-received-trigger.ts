// apps/worker/scripts/verify-message-received-trigger.ts
/**
 * plans/events/01-expose-hidden-events.md work stream 1 — MESSAGE_RECEIVED workflow
 * trigger end-to-end verification.
 *
 * SCOPE — what this script exercises for real (no mocking):
 *   real inbound ingest (`storeMessage`) → real `message:received` bus event
 *   (`publisher.publishLater`) → real BullMQ hop through `eventsQueue` → `publishEventJob`
 *   → `eventHandlersQueue` → `createTimelineEvent` + `triggerMessageWorkflows`
 *   → `workflowDelayQueue` → `executeMessageTrigger` → `WorkflowExecutionService.createRun`
 *   + `executeWorkflowAsync` → the real `MessageReceivedProcessor` node.
 *
 * This script does NOT run its own worker — it relies on the live `apps/worker` dev
 * process (started by `pnpm dev`, running `--conditions source --watch`) to actually
 * consume the queues, and polls the DB for the resulting `WorkflowRun` row. If no worker
 * is running, the positive-assertion scenario will time out and fail — that itself is
 * informative (dispatch never reaching a live consumer).
 *
 * SCENARIOS:
 *  (a) inbound + genuinely new message ⇒ a WorkflowRun IS created for the published
 *      MESSAGE_RECEIVED workflow, `inputs.trigger_type`/`inputs.message_id`/
 *      `inputs.message.id` hydrated correctly, run reaches a terminal status, and the
 *      trigger node's recorded output/participant data shows the TO recipient.
 *  (b) outbound message (`isInbound: false`) ⇒ NO WorkflowRun created (loop-guard —
 *      a workflow that sends mail must not re-trigger itself).
 *  (c) `isInitialSync: true` ctx (simulates a Gmail/Outlook first-connect backfill)
 *      ⇒ NO WorkflowRun created (a backfill must not fire thousands of workflow runs).
 *
 * NOT COVERED: `message.attachments` URL resolution against a real storage backend — no
 * MediaAsset/Attachment fixture is created, so `loadMessageAttachments`'s
 * `getDownloadInfo` call is never exercised by this script (it lazily short-circuits to
 * `[]` on `hasAttachments: false`, which IS exercised). Also not covered: the timeline
 * handler's actual DB write (`createTimelineEvent`) — only the workflow-trigger fan-out
 * is asserted.
 *
 * Run (from repo root, worker runtime — pulls file-type/ESM deps):
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-message-received-trigger.ts
 */

import { database } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import type { MessageData } from '@auxx/lib/ingest'
import { createIngestContext, storeMessage } from '@auxx/lib/ingest'
import { WorkflowService, WorkflowTriggerType, WorkflowVersionService } from '@auxx/lib/workflows'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `WorkflowExecutionService.createRun` enforces the `workflowRuns` monthly usage quota in
 * production mode (by design — see plan §"Quota"). Root-caused during this script's
 * development: the dev org's `PlanSubscription.status` is `'canceled'`
 * (`packages/lib/src/cache/providers/features-provider.ts`'s `compute` only builds a
 * non-empty feature map for `trialing`/`active`/`past_due` — `canceled` falls through to
 * an EMPTY map), so `workflowRunsPerMonthHard` is entirely ABSENT (not numerically
 * exceeded — confirmed a Redis usage-counter headroom trick had zero effect, since
 * `UsageGuard.consume` rejects at the `getLimit() === null` check before ever touching
 * the counter). `PlanSubscription.customFeatureLimits` is the purpose-built per-org
 * override for exactly this (used for Enterprise custom limits) — it merges into the
 * feature map unconditionally, regardless of subscription status. Borrow it temporarily:
 * merge in a generous `workflowRunsPerMonthHard`/`Soft`, invalidate the live `features`
 * cache key so the already-running worker process picks it up (`onCacheEvent`
 * ('plan.changed', ...) — same live-cache-bust pattern `verify-dispatch-times-sync.ts`
 * uses for org settings), then restore the ORIGINAL value and re-invalidate in `finally`.
 */
async function withWorkflowRunsFeatureAccess<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const before = await database.$client.query(
    'SELECT "customFeatureLimits" FROM "PlanSubscription" WHERE "organizationId" = $1',
    [organizationId]
  )
  const originalRaw = before.rows[0]?.customFeatureLimits ?? null
  if (before.rows.length === 0) {
    console.log('  (org has no PlanSubscription row — skipping feature-access override)')
    return fn()
  }
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

/** Poll for a WorkflowRun whose `inputs.message_id` matches, up to `timeoutMs`. */
async function waitForRunByMessageId(
  organizationId: string,
  workflowAppId: string,
  messageId: string,
  timeoutMs: number
): Promise<{ id: string; inputs: any; status: string } | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await database.$client.query(
      `SELECT id, inputs, status FROM "WorkflowRun"
       WHERE "organizationId" = $1 AND "workflowAppId" = $2 AND inputs->>'message_id' = $3
       ORDER BY "createdAt" DESC LIMIT 1`,
      [organizationId, workflowAppId, messageId]
    )
    if (res.rows[0]) return res.rows[0] as { id: string; inputs: any; status: string }
    await sleep(750)
  }
  return null
}

/** Poll for a WorkflowRun to leave the RUNNING/PENDING state. */
async function waitForTerminalStatus(runId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await database.$client.query('SELECT status FROM "WorkflowRun" WHERE id = $1', [
      runId,
    ])
    const status = res.rows[0]?.status as string | undefined
    // WorkflowRunStatus (packages/database/src/enums.ts): RUNNING | SUCCEEDED |
    // FAILED | STOPPED | WAITING — uppercase, no 'pending'/'completed'.
    if (status && status !== 'RUNNING' && status !== 'WAITING') return status
    await sleep(500)
  }
  return null
}

function baseMessageData(params: {
  organizationId: string
  integrationId: string
  externalId: string
  isInbound: boolean
  fromEmail: string
  toEmail: string
}): MessageData {
  const now = new Date()
  return {
    externalId: params.externalId,
    externalThreadId: `${params.externalId}-thread`,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    isInbound: params.isInbound,
    // MUST be distinct per scenario: MessageReconcilerService's "Strategy 2"
    // (message-reconciler.service.ts) matches on EXACT subject equality within
    // a 5-minute window + `sendStatus IN (PENDING, SENT)` — and `Message.
    // sendStatus` DEFAULTS to 'SENT' at the DB level for every insert (no
    // sendStatus set here), so two scenarios sharing one subject string get
    // silently merged into the same Message row (`isNew: false`) regardless of
    // sender/externalId. Each call site below passes a unique `externalId`,
    // which the subject embeds to guarantee no collision.
    subject: `[MRT-verify] MESSAGE_RECEIVED trigger test (${params.externalId})`,
    textPlain: 'Verify script body',
    snippet: 'Verify script body',
    createdTime: now,
    sentAt: now,
    receivedAt: now,
    from: { identifier: params.fromEmail, name: 'Verify Sender' },
    to: [{ identifier: params.toEmail, name: 'Verify Recipient' }],
    hasAttachments: false,
  }
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

  // Reuse a real Integration row from the dev org if one exists (keeps ingest's
  // inbox-resolution path realistic); fall back to a synthetic id otherwise — ingest
  // tolerates a missing Integration row (non-fatal log, `inboxId` stays null).
  const existingIntegration = await database.query.Integration.findFirst({
    columns: { id: true },
    where: (t, { eq, and, isNull }) =>
      and(eq(t.organizationId, organizationId), isNull(t.deletedAt)),
  })
  const integrationId = existingIntegration?.id ?? `mrt-verify-integration-${Date.now()}`
  console.log(`Using integrationId ${integrationId} (reused: ${!!existingIntegration})`)

  const runTag = Date.now()
  const workflowAppIds: string[] = []
  const threadIdsToClean = new Set<string>()
  const participantIdentifiersToClean = new Set<string>()

  try {
    // ══════════════════════════════════════════════════════════════════════
    // Fixture: publish a real MESSAGE_RECEIVED-trigger workflow via the real
    // create+publish lib API (WorkflowService/WorkflowVersionService) — this
    // exercises the same publish-validation + cache-invalidation path the
    // builder UI uses, so `getCachedWorkflowAppsByTrigger` sees it for real.
    // ══════════════════════════════════════════════════════════════════════
    console.log('Setup: creating + publishing a MESSAGE_RECEIVED workflow')

    const nodeId = 'trigger-1'
    const graph = {
      nodes: [
        {
          id: nodeId,
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { id: nodeId, type: 'message-received', title: 'Message Received' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const workflowService = new WorkflowService(database)
    const versionService = new WorkflowVersionService(database)

    const created = await workflowService.create(organizationId, userId, {
      name: `[MRT-verify] ${runTag}`,
      enabled: false,
      triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
      graph: graph as any,
    })
    const workflowAppId: string = created.id
    workflowAppIds.push(workflowAppId)
    console.log(`  Created WorkflowApp ${workflowAppId}`)

    await versionService.publish(workflowAppId, organizationId)
    console.log('  Published')

    // ══════════════════════════════════════════════════════════════════════
    // (a) inbound + new message ⇒ workflow run created, inputs.message hydrated
    // ══════════════════════════════════════════════════════════════════════
    console.log('(a) inbound new message')
    const ctxA = await createIngestContext(organizationId, {
      // 'none' — no Contact gets auto-created for the synthetic participants
      // below, keeping this script's cleanup footprint to Thread/Message/
      // Participant rows only.
      integrationSettings: { recordCreation: { mode: 'none' } },
    })
    const msgDataA = baseMessageData({
      organizationId,
      integrationId,
      externalId: `mrt-verify-a-${runTag}`,
      isInbound: true,
      fromEmail: `mrt-verify-from-a-${runTag}@example-verify.test`,
      toEmail: `mrt-verify-to-a-${runTag}@example-verify.test`,
    })

    // Grant temporary workflowRuns feature access for this scenario BEFORE
    // storing the message — the async dispatch chain (publisher → eventsQueue
    // → eventHandlersQueue → workflowDelayQueue → executeMessageTrigger's
    // `createRun` quota check) can reach `createRun` within milliseconds of
    // `storeMessage` returning, so access must already be in place before
    // `storeMessage` is called, not after. (b)/(c) assert NO run is created,
    // so quota availability is irrelevant there — only (a) needs this.
    const { storedA, runA } = await withWorkflowRunsFeatureAccess(organizationId, async () => {
      const stored = await storeMessage(ctxA, msgDataA)
      const run = await waitForRunByMessageId(
        organizationId,
        workflowAppId,
        stored.messageId,
        20_000
      )
      return { storedA: stored, runA: run }
    })
    check('(a) storeMessage reports isNew', storedA.isNew === true, storedA)

    const threadA = await database.query.Message.findFirst({
      columns: { threadId: true },
      where: (t, { eq }) => eq(t.id, storedA.messageId),
    })
    if (threadA) threadIdsToClean.add(threadA.threadId)
    participantIdentifiersToClean.add(msgDataA.from.identifier)
    for (const to of msgDataA.to) participantIdentifiersToClean.add(to.identifier)

    check('(a) a WorkflowRun was created for the new inbound message', !!runA, runA)
    if (runA) {
      check(
        '(a) inputs.trigger_type === message-received',
        runA.inputs?.trigger_type === WorkflowTriggerType.MESSAGE_RECEIVED,
        runA.inputs?.trigger_type
      )
      check(
        '(a) inputs.message_id matches the stored message',
        runA.inputs?.message_id === storedA.messageId,
        runA.inputs?.message_id
      )
      check(
        '(a) inputs.message (hydrated ProcessedMessage) has the right id',
        runA.inputs?.message?.id === storedA.messageId,
        runA.inputs?.message?.id
      )
      check(
        '(a) inputs.message.from.identifier matches the sender',
        runA.inputs?.message?.from?.identifier === msgDataA.from.identifier,
        runA.inputs?.message?.from
      )
      check(
        '(a) inputs.message.participants includes a TO row for the recipient',
        Array.isArray(runA.inputs?.message?.participants) &&
          runA.inputs.message.participants.some(
            (p: any) => p.role === 'TO' && p.participant?.identifier === msgDataA.to[0]!.identifier
          ),
        runA.inputs?.message?.participants
      )

      const finalStatus = await waitForTerminalStatus(runA.id, 20_000)
      check(
        '(a) the run reaches a terminal status (SUCCEEDED)',
        finalStatus === 'SUCCEEDED',
        finalStatus
      )
    }

    // ══════════════════════════════════════════════════════════════════════
    // (b) outbound message ⇒ no workflow run (loop-guard)
    // ══════════════════════════════════════════════════════════════════════
    console.log('(b) outbound message (loop-guard)')
    const ctxB = await createIngestContext(organizationId, {
      integrationSettings: { recordCreation: { mode: 'none' } },
    })
    const msgDataB = baseMessageData({
      organizationId,
      integrationId,
      externalId: `mrt-verify-b-${runTag}`,
      isInbound: false,
      fromEmail: `mrt-verify-from-b-${runTag}@example-verify.test`,
      toEmail: `mrt-verify-to-b-${runTag}@example-verify.test`,
    })
    const storedB = await storeMessage(ctxB, msgDataB)
    check('(b) storeMessage reports isNew', storedB.isNew === true, storedB)

    const threadB = await database.query.Message.findFirst({
      columns: { threadId: true },
      where: (t, { eq }) => eq(t.id, storedB.messageId),
    })
    if (threadB) threadIdsToClean.add(threadB.threadId)
    participantIdentifiersToClean.add(msgDataB.from.identifier)
    for (const to of msgDataB.to) participantIdentifiersToClean.add(to.identifier)

    const runB = await waitForRunByMessageId(
      organizationId,
      workflowAppId,
      storedB.messageId,
      12_000
    )
    check('(b) NO WorkflowRun created for the outbound message', runB === null, runB)

    // ══════════════════════════════════════════════════════════════════════
    // (c) initial-sync-flagged store ⇒ no workflow run (backfill guard)
    // ══════════════════════════════════════════════════════════════════════
    console.log('(c) initial-sync-flagged store (backfill guard)')
    const ctxC = await createIngestContext(organizationId, {
      isInitialSync: true,
      integrationSettings: { recordCreation: { mode: 'none' } },
    })
    check('(c) ctx.isInitialSync is true (sanity)', ctxC.isInitialSync === true)
    const msgDataC = baseMessageData({
      organizationId,
      integrationId,
      externalId: `mrt-verify-c-${runTag}`,
      isInbound: true,
      fromEmail: `mrt-verify-from-c-${runTag}@example-verify.test`,
      toEmail: `mrt-verify-to-c-${runTag}@example-verify.test`,
    })
    const storedC = await storeMessage(ctxC, msgDataC)
    check('(c) storeMessage reports isNew', storedC.isNew === true, storedC)

    const threadC = await database.query.Message.findFirst({
      columns: { threadId: true },
      where: (t, { eq }) => eq(t.id, storedC.messageId),
    })
    if (threadC) threadIdsToClean.add(threadC.threadId)
    participantIdentifiersToClean.add(msgDataC.from.identifier)
    for (const to of msgDataC.to) participantIdentifiersToClean.add(to.identifier)

    const runC = await waitForRunByMessageId(
      organizationId,
      workflowAppId,
      storedC.messageId,
      12_000
    )
    check('(c) NO WorkflowRun created for the initial-sync-flagged message', runC === null, runC)
  } finally {
    // ── Cleanup ──
    console.log(`Cleanup: ${threadIdsToClean.size} threads, ${workflowAppIds.length} workflow apps`)

    // Threads cascade Message/MessageParticipant/ThreadParticipant.
    for (const threadId of threadIdsToClean) {
      try {
        await database.$client.query('DELETE FROM "Thread" WHERE id = $1', [threadId])
      } catch (err) {
        console.log(
          `  cleanup failed for thread ${threadId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    // Participant rows are now unreferenced (Message.fromId is onDelete:restrict,
    // but the referencing Message rows are gone via the Thread cascade above).
    for (const identifier of participantIdentifiersToClean) {
      try {
        await database.$client.query(
          'DELETE FROM "Participant" WHERE "organizationId" = $1 AND identifier = $2',
          [organizationId, identifier]
        )
      } catch (err) {
        console.log(
          `  cleanup failed for participant ${identifier}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    // WorkflowRun/WorkflowNodeExecution rows cascade from WorkflowApp deletion;
    // Workflow rows (draft + published) also cascade from WorkflowApp (workflowAppId
    // is onDelete:cascade on Workflow, but WorkflowApp.workflowId/draftWorkflowId
    // point AT Workflow rows without cascade — clear those pointers first).
    for (const workflowAppId of workflowAppIds) {
      try {
        await database.$client.query(
          'UPDATE "WorkflowApp" SET "workflowId" = NULL, "draftWorkflowId" = NULL WHERE id = $1',
          [workflowAppId]
        )
        await database.$client.query('DELETE FROM "WorkflowApp" WHERE id = $1', [workflowAppId])
      } catch (err) {
        console.log(
          `  cleanup failed for workflow app ${workflowAppId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    if (!existingIntegration) {
      console.log('  (synthetic integrationId used — no Integration row to clean up)')
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
