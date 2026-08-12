// packages/lib/src/workflow-engine/core/__tests__/approval-outcome-vocabulary.test.ts

import { ApprovalActionValues, ApprovalStatusValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_OUTCOMES,
  type ApprovalOutcome,
  isApprovalOutcome,
  outcomeForAction,
} from '../../../approval-requests/client'
import {
  approvalDecisionVariablesFromResume,
  buildApprovalDecisionVariables,
  getHumanConfirmationNextNodes,
  handleForApprovalOutcome,
} from '../pause-resume'
import type { WorkflowNode } from '../types'
import { WorkflowNodeType } from '../types'
import type { NodeRouteInfo, WorkflowGraph } from '../workflow-graph-builder'

/**
 * ONE approval-outcome vocabulary, asserted in ONE place.
 *
 * There used to be three, and they disagreed:
 *
 * | producer | sent | router matched |
 * |---|---|---|
 * | a reviewer's decision (`approval-requests/registry.ts`) | `'approve'` / `'deny'` | ✅ |
 * | the expiry job (`jobs/workflow/approval-timeout-job.ts`) | `'timeout'` | ✅ |
 * | an administrative cancel (`cancelApprovalRequest`) | `'denied'` | ❌ → `source` |
 *
 * …while `buildApprovalDecisionVariables`, the node's three canvas handles and
 * `ApprovalRequest.status` all spoke the past tense. So a cancel took the wrong
 * branch, and every production approval would have produced empty
 * `approved_by` / `denied_by`.
 *
 * The canonical vocabulary is `ApprovalOutcome` — the terminal
 * `ApprovalStatusValues` a workflow can route on. The verbs `approve`/`deny`
 * remain `ApprovalAction`: the API input and the `ApprovalResponse.action`
 * column, converted exactly once, by `outcomeForAction`.
 */

// ── the vocabulary itself ────────────────────────────────────────────────────

describe('the approval outcome vocabulary', () => {
  it('is a subset of the ApprovalStatus values the DB column stores', () => {
    // A fourth spelling ('rejected', 'expired', 'approve') fails HERE, before it
    // can reach a branch handle or a status write.
    for (const outcome of APPROVAL_OUTCOMES) {
      expect(ApprovalStatusValues as readonly string[]).toContain(outcome)
    }
  })

  it('names exactly the three terminal states a workflow branch exists for', () => {
    expect([...APPROVAL_OUTCOMES]).toEqual(['approved', 'denied', 'timeout'])
  })

  it('is NOT the reviewer verb vocabulary', () => {
    for (const action of ApprovalActionValues) {
      expect(isApprovalOutcome(action)).toBe(false)
    }
  })

  it('converts every reviewer verb to an outcome, and only to an outcome', () => {
    for (const action of ApprovalActionValues) {
      expect(isApprovalOutcome(outcomeForAction(action))).toBe(true)
    }
    expect(outcomeForAction('approve')).toBe('approved')
    expect(outcomeForAction('deny')).toBe('denied')
  })

  it("names the node's canvas handles identically", () => {
    // `nodes/core/human/node.tsx` renders handles 'approved' / 'denied' /
    // 'timeout'. Identity is the point: no translation layer to drift.
    for (const outcome of APPROVAL_OUTCOMES) {
      expect(handleForApprovalOutcome(outcome)).toBe(outcome)
    }
  })

  it('sends anything else to the source handle rather than guessing', () => {
    for (const notAnOutcome of ['approve', 'deny', 'rejected', 'expired', '', undefined, null]) {
      expect(handleForApprovalOutcome(notAnOutcome)).toBe('source')
    }
  })
})

// ── the three producers ──────────────────────────────────────────────────────

/**
 * The literal payloads the three producers hand to `resumeWorkflow`. Each is
 * pinned at its source too — `registry.ts` and `cancelApprovalRequest` in
 * `approval-requests/__tests__/resolve-approval-request.test.ts`, the expiry job
 * at `jobs/workflow/approval-timeout-job.ts:53`.
 */
const REQUESTED_AT = '2026-01-01T00:00:00.000Z'
const PRODUCERS = {
  reviewer_approved: {
    outcome: 'approved',
    approvalRequestId: 'ar1',
    respondedBy: 'user_1',
    respondedAt: '2026-01-01T00:02:30.000Z',
    comment: 'ship it',
  },
  reviewer_denied: {
    outcome: 'denied',
    approvalRequestId: 'ar1',
    respondedBy: 'user_1',
    respondedAt: '2026-01-01T00:00:45.000Z',
    comment: 'not yet',
  },
  expiry_job: {
    outcome: 'timeout',
    approvalRequestId: 'ar1',
    timedOutAt: '2026-01-01T01:00:00.000Z',
  },
  administrative_cancel: {
    outcome: 'denied',
    approvalRequestId: 'ar1',
    cancelledBy: 'admin_1',
    cancelledAt: '2026-01-01T00:05:00.000Z',
    cancelReason: 'workflow retired',
  },
} as const

describe('a production resume writes all five decision variables', () => {
  const ADVERTISED = [
    'outcome',
    'approved_by',
    'denied_by',
    'response_time',
    'response_message',
  ] as const

  it.each(
    Object.keys(PRODUCERS) as Array<keyof typeof PRODUCERS>
  )('from the %s payload', (producer) => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS[producer], REQUESTED_AT)

    expect(vars).not.toBeNull()
    for (const path of ADVERTISED) {
      expect(vars, `${path} was never written`).toHaveProperty(path)
    }
  })

  it('names the approver on an approval, and nobody else', () => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS.reviewer_approved, REQUESTED_AT)
    expect(vars).toMatchObject({
      outcome: 'approved',
      approved_by: 'user_1',
      denied_by: '',
      response_message: 'ship it',
      response_time: 150,
    })
  })

  it('names the denier on a denial', () => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS.reviewer_denied, REQUESTED_AT)
    expect(vars).toMatchObject({
      outcome: 'denied',
      approved_by: '',
      denied_by: 'user_1',
      response_time: 45,
    })
  })

  it('carries no responder on a timeout, but still a real elapsed time', () => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS.expiry_job, REQUESTED_AT)
    expect(vars).toMatchObject({
      outcome: 'timeout',
      approved_by: '',
      denied_by: '',
      response_time: 3600,
    })
  })

  it('reads the canceller and the reason off the cancel payload', () => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS.administrative_cancel, REQUESTED_AT)
    expect(vars).toMatchObject({
      outcome: 'denied',
      denied_by: 'admin_1',
      response_message: 'workflow retired',
      response_time: 300,
    })
  })

  it('derives response_time as a real number of seconds, never null', () => {
    for (const payload of Object.values(PRODUCERS)) {
      const vars = approvalDecisionVariablesFromResume(payload, REQUESTED_AT)
      expect(typeof vars?.response_time).toBe('number')
      expect(vars?.response_time).toBeGreaterThan(0)
    }
  })

  it('falls back to 0 rather than NaN when the node never recorded requested_at', () => {
    const vars = approvalDecisionVariablesFromResume(PRODUCERS.reviewer_approved, undefined)
    expect(vars?.response_time).toBe(0)
  })

  it('writes nothing for a payload that carries no outcome (a wait resume)', () => {
    expect(
      approvalDecisionVariablesFromResume({ status: 'completed' } as never, REQUESTED_AT)
    ).toBe(null)
    expect(approvalDecisionVariablesFromResume(undefined, REQUESTED_AT)).toBeNull()
  })

  it('writes nothing for a fourth spelling instead of half-filling the variables', () => {
    // The pre-fix reviewer payload. It must not quietly produce
    // `outcome: 'approve'` with empty `approved_by`.
    expect(approvalDecisionVariablesFromResume({ outcome: 'approve' }, REQUESTED_AT)).toBeNull()
  })
})

describe('buildApprovalDecisionVariables', () => {
  it('derives response_time in whole seconds from the two timestamps', () => {
    expect(
      buildApprovalDecisionVariables({
        outcome: 'approved',
        respondedBy: 'u1',
        requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        respondedAt: new Date('2026-01-01T00:02:30.000Z'),
        comment: 'looks good',
      })
    ).toEqual({
      outcome: 'approved',
      approved_by: 'u1',
      denied_by: '',
      response_time: 150,
      response_message: 'looks good',
    })
  })

  it('never leaves a key unwritten when timestamps are missing', () => {
    expect(buildApprovalDecisionVariables({ outcome: 'timeout' })).toEqual({
      outcome: 'timeout',
      approved_by: '',
      denied_by: '',
      response_time: 0,
      response_message: '',
    })
  })
})

// ── branch routing ───────────────────────────────────────────────────────────

/** A human-confirmation node wired to one target per outcome branch. */
function graphWithBranches(): WorkflowGraph {
  const route = (handleId: string, targetId: string) => ({
    handleId,
    targetNodes: [
      {
        nodeId: targetId,
        nodeType: WorkflowNodeType.END,
        targetHandle: 'target',
        edge: {} as never,
      },
    ],
    isParallel: false,
  })
  const routes = new Map<string, ReturnType<typeof route>>([
    ['approved', route('approved', 'after_approve')],
    ['denied', route('denied', 'after_deny')],
    ['timeout', route('timeout', 'after_timeout')],
  ])
  const nodeRoutes = new Map<string, NodeRouteInfo>([
    [
      'human_1',
      {
        nodeId: 'human_1',
        routes,
        hasMultipleOutputs: true,
        hasParallelOutputs: false,
        hasConditionalOutputs: true,
      } as unknown as NodeRouteInfo,
    ],
  ])
  return { nodeRoutes } as unknown as WorkflowGraph
}

const humanNode = {
  nodeId: 'human_1',
  type: WorkflowNodeType.HUMAN_CONFIRMATION,
} as unknown as WorkflowNode

describe('branch routing follows the same vocabulary', () => {
  it.each([
    ['reviewer_approved', 'after_approve'],
    ['reviewer_denied', 'after_deny'],
    ['expiry_job', 'after_timeout'],
  ] as const)('routes the %s payload to %s', (producer, expected) => {
    expect(
      getHumanConfirmationNextNodes(humanNode, PRODUCERS[producer], graphWithBranches())
    ).toEqual([expected])
  })

  it('routes an administrative cancel to the DENIED branch', () => {
    // The regression: `cancelApprovalRequest` sent past tense while the router
    // matched the verb, so this fell through to the `source` handle — and a
    // human node has no `source` edge, so the run simply stopped.
    expect(
      getHumanConfirmationNextNodes(humanNode, PRODUCERS.administrative_cancel, graphWithBranches())
    ).toEqual(['after_deny'])
  })

  it('takes no outcome branch at all for a fourth spelling', () => {
    expect(
      getHumanConfirmationNextNodes(humanNode, { outcome: 'approve' }, graphWithBranches())
    ).toEqual([])
  })

  it('covers every outcome with a branch — no outcome is unroutable', () => {
    const graph = graphWithBranches()
    for (const outcome of APPROVAL_OUTCOMES satisfies readonly ApprovalOutcome[]) {
      expect(getHumanConfirmationNextNodes(humanNode, { outcome }, graph)).toHaveLength(1)
    }
  })
})
