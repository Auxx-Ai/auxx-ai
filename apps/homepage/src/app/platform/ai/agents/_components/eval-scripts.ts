// apps/homepage/src/app/platform/ai/agents/_components/eval-scripts.ts

/**
 * The eval suite the illustration runs twice, with a Kopilot fix in between.
 *
 * The amber row is deliberate: it did not fail, it errored, because a tool call
 * had no stub. `error` and `failed` are different states in the real grader and
 * the distinction is the most credible thing on this section.
 */

export type CaseStatus = 'passed' | 'failed' | 'error'

export interface EvalAssertion {
  label: string
  /** Judged assertions get a distinct tint, so the split reads without a legend. */
  judged?: boolean
}

export interface EvalCase {
  id: string
  name: string
  assertions: EvalAssertion[]
  before: CaseStatus
  after: CaseStatus
  /** Shown beside the status chip when the run errored. */
  errorCode?: string
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'inside',
    name: 'Refund inside window',
    assertions: [{ label: 'tool_called update_entity' }, { label: 'terminal_outcome finished' }],
    before: 'passed',
    after: 'passed',
  },
  {
    id: 'outside',
    name: 'Refund outside window',
    assertions: [
      { label: 'tool_not_called update_entity' },
      { label: 'response_criteria "offers store credit"', judged: true },
    ],
    before: 'failed',
    after: 'passed',
  },
  {
    id: 'angry',
    name: 'No order id, angry customer',
    assertions: [{ label: 'terminal_outcome handoff' }],
    before: 'passed',
    after: 'passed',
  },
  {
    id: 'shipping',
    name: 'Asks about shipping mid-flow',
    assertions: [{ label: 'local_variable step = 2' }],
    before: 'passed',
    after: 'passed',
  },
  {
    id: 'duplicate',
    name: 'Duplicate refund request',
    assertions: [{ label: 'crm_field Status is Refunded' }],
    before: 'error',
    after: 'passed',
    errorCode: 'UNMATCHED_MOCK',
  },
]

export const KOPILOT_FIX = {
  message:
    "Refund outside window issued a refund it shouldn't have. The condition only checks final-sale, never the delivery date. I've added the 30-day check, and stubbed get_entity for the duplicate case. Re-running the suite.",
  tools: ['set_procedure_body', 'update_eval_case_mock', 'run_eval_suite'],
}

export const SUITE_DIFF = {
  fixed: 2,
  stillPassing: 3,
  regressed: 0,
  passRateBefore: 60,
  passRateAfter: 100,
}

export const RUN_LABELS = { before: 'Run 12', after: 'Run 13' }
