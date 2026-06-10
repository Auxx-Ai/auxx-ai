// packages/lib/src/ai/kopilot/task-notifications/kinds/eval-suite.ts

import type { EvalSuiteRunEntity } from '@auxx/database'
import { getEvalSuiteRun } from '../../../../evals/queries'
import type { TaskNotificationKindHandler, TaskSnapshot } from '../types'

export const EVAL_SUITE_TASK_KIND = 'eval-suite'

/** Suite `status` describes orchestration; any of these means "stop watching". */
const TERMINAL_STATUSES: ReadonlySet<EvalSuiteRunEntity['status']> = new Set([
  'completed',
  'cancelled',
  'error',
])

function asSuite(task: TaskSnapshot): EvalSuiteRunEntity {
  return task as unknown as EvalSuiteRunEntity
}

/**
 * Task-notification handler for eval suite runs (`run_eval_suite`).
 * Summaries come from the suite counters; detail stays behind the eval read
 * tools (pointer, not payload).
 */
export const evalSuiteTaskNotificationHandler: TaskNotificationKindHandler = {
  kind: EVAL_SUITE_TASK_KIND,

  async load(ref, organizationId) {
    const result = await getEvalSuiteRun({ organizationId, suiteRunId: ref })
    if (result.isErr()) {
      throw new Error(`Failed to load eval suite run ${ref}: ${result.error.message}`)
    }
    return (result.value as TaskSnapshot | null) ?? null
  },

  isTerminal(task) {
    return TERMINAL_STATUSES.has(asSuite(task).status)
  },

  summarize(task) {
    const suite = asSuite(task)
    const counts = [`${suite.passedCount} passed`, `${suite.failedCount} failed`]
    if (suite.errorCount > 0) counts.push(`${suite.errorCount} errored`)
    if (suite.cancelledCount > 0) counts.push(`${suite.cancelledCount} cancelled`)
    if (suite.timedOutCount > 0) counts.push(`${suite.timedOutCount} timed out`)

    return {
      status: suite.status,
      summary: `${suite.requestedCount} run${suite.requestedCount === 1 ? '' : 's'}: ${counts.join(' · ')}`,
      instruction:
        'The eval suite has finished. Report the outcome to the user and propose next steps. ' +
        'Do not re-run the suite unless the user asks.',
    }
  },
}
