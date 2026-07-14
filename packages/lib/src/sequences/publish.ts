// packages/lib/src/sequences/publish.ts
// Compile `SequenceStep` rows into the hidden `Workflow.graph` (Sequences plan
// §3.3/§3.4, Phase 2). Validates the draft, builds a linear
// start -> (wait -> sequence-send-email)* -> end graph, writes it to the
// sequence's hidden `Workflow` row, and flips `publishedAt`/
// `hasUnpublishedChanges`/`status`.
//
// Node/edge shape verified against `workflow-graph-builder.ts`: entry-node
// detection reads `data.type || type` (so both are set on every node here),
// edges default `sourceHandle` to `'source'` when omitted.

import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import type { SequenceEntity, SequenceStepEntity } from './types'

interface GraphNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

interface GraphEdge {
  id: string
  source: string
  target: string
}

/**
 * Compile the linear step list into a workflow graph:
 * `[start] -> (wait Δ -> sequence-send-email)* -> [end]`.
 * `delaySeconds = delayDays*86400 + delayHours*3600`; step 1's wait carries a
 * `durationAmount` of `0` but still snapshots the delivery window so an
 * off-hours enrollment still snaps forward to the next in-window moment.
 */
export function buildSequenceGraph(
  sequence: SequenceEntity,
  steps: SequenceStepEntity[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let x = 0

  const pushNode = (id: string, type: string, data: Record<string, unknown>) => {
    nodes.push({ id, type, data: { type, ...data }, position: { x, y: 0 } })
    x += 300
  }
  const connect = (source: string, target: string) => {
    edges.push({ id: `e-${source}-${target}`, source, target })
  }

  pushNode('start', 'manual', { title: 'Start' })
  let prevNodeId = 'start'

  // Only compile a window when fully configured — a partial window (nulls) would
  // reach the wait processor as a truthy object and break the snap math.
  const deliveryWindow =
    sequence.deliveryStartTime && sequence.deliveryEndTime && sequence.deliveryTimezone
      ? {
          startTime: sequence.deliveryStartTime,
          endTime: sequence.deliveryEndTime,
          timezone: sequence.deliveryTimezone,
          businessDaysOnly: sequence.deliveryBusinessDaysOnly,
        }
      : undefined

  steps.forEach((step, index) => {
    const stepIndex = index + 1
    const delaySeconds = step.delayDays * 86400 + step.delayHours * 3600
    const waitId = `wait-${step.id}`
    const sendId = `send-${step.id}`

    // A zero-delay wait exists only to carry the delivery window (step 1 snaps an
    // off-hours enrollment forward). Without a window it would fail the engine's
    // min-duration validation — skip it and send immediately.
    const needsWait = delaySeconds > 0 || deliveryWindow !== undefined
    if (needsWait) {
      pushNode(waitId, 'wait', {
        waitType: 'duration',
        durationAmount: delaySeconds,
        isDurationConstant: true,
        durationUnit: 'seconds',
        ...(deliveryWindow ? { deliveryWindow } : {}),
        title: `Wait before step ${stepIndex}`,
      })
      connect(prevNodeId, waitId)
      prevNodeId = waitId
    }

    pushNode(sendId, 'sequence-send-email', {
      sequenceId: sequence.id,
      stepId: step.id,
      stepIndex,
      subject: step.subject ?? null,
      bodyHtml: step.bodyHtml ?? '',
      attachmentIds: step.attachmentIds ?? [],
      integrationId: sequence.integrationId,
      signatureId: sequence.signatureEntityInstanceId ?? null,
      title: `Step ${stepIndex} email`,
    })
    connect(prevNodeId, sendId)

    prevNodeId = sendId
  })

  pushNode('end', 'end', {})
  connect(prevNodeId, 'end')

  return { nodes, edges }
}

export interface PublishSequenceInput {
  sequenceId: string
  organizationId: string
}

/**
 * Validate (>=1 step, mailbox set, step-1 subject non-empty) -> compile the
 * graph -> write it to the hidden `Workflow.graph` -> mark published.
 * Republishing a `disabled` sequence leaves it disabled (pause is a separate
 * concern from publish); only `draft` flips to `enabled`.
 */
export async function publishSequence(
  db: Database,
  input: PublishSequenceInput
): Promise<Result<SequenceEntity, Error>> {
  const { sequenceId, organizationId } = input

  const sequence = await db.query.Sequence.findFirst({
    where: and(
      eq(schema.Sequence.id, sequenceId),
      eq(schema.Sequence.organizationId, organizationId)
    ),
  })
  if (!sequence) return err(new NotFoundError('Sequence not found'))

  if (!sequence.integrationId) {
    return err(new BadRequestError('Sequence must have a sending mailbox configured'))
  }

  const steps = await db.query.SequenceStep.findMany({
    where: and(
      eq(schema.SequenceStep.sequenceId, sequenceId),
      eq(schema.SequenceStep.organizationId, organizationId)
    ),
    orderBy: asc(schema.SequenceStep.sortOrder),
  })
  if (steps.length === 0) {
    return err(new BadRequestError('Sequence must have at least one step to publish'))
  }

  const firstStep = steps[0]!
  if (!firstStep.subject || !firstStep.subject.trim()) {
    return err(new BadRequestError('The first step must have a subject — it opens the thread'))
  }

  const workflowApp = await db.query.WorkflowApp.findFirst({
    where: eq(schema.WorkflowApp.id, sequence.workflowAppId),
  })
  if (!workflowApp?.workflowId) {
    return err(new ConflictError('Sequence is missing its hidden workflow'))
  }

  const graph = buildSequenceGraph(sequence, steps)
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(schema.Workflow)
      .set({ graph: graph as unknown as Record<string, unknown>, updatedAt: now })
      .where(eq(schema.Workflow.id, workflowApp.workflowId!))

    await tx
      .update(schema.Sequence)
      .set({
        publishedAt: now,
        hasUnpublishedChanges: false,
        status: sequence.status === 'draft' ? 'enabled' : sequence.status,
      })
      .where(eq(schema.Sequence.id, sequenceId))
  })

  const updated = await db.query.Sequence.findFirst({
    where: eq(schema.Sequence.id, sequenceId),
  })

  return ok(updated!)
}
