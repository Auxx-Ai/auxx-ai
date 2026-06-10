// packages/lib/src/evals/diff.ts
//
// Suite verdict diff (phase 5B): compare two terminal EvalSuiteRuns over the
// same case set and bucket per-case transitions, with assertion-level flips and
// the deterministic-vs-judge classification that operationalizes the LLM-judge
// noise caveat. Pure read-side — computed on request, nothing persisted.
// `diffChildRuns` is the DB-free core; `compareSuiteRuns` is the loading wrapper.

import type {
  AssertionResult,
  SuiteDiffBucket,
  SuiteDiffEntry,
  SuiteDiffFlipDriver,
  SuiteDiffSummary,
} from '@auxx/types/evals'
import { err, ok, type Result } from 'neverthrow'
import { getEvalSuiteRun, listSuiteChildRunSummaries, type SuiteChildRunSummary } from './queries'
import type { EvalServiceError } from './types'

/** Suite statuses a diff may read — orchestration is over, the children are settled. */
const TERMINAL_SUITE_STATUSES = new Set(['completed', 'cancelled'])

type AssertionFlip = NonNullable<SuiteDiffEntry['assertionFlips']>[number]

export interface DiffChildRunsOptions {
  /**
   * Phase-4 seam: how runs pair up across the two suites. Defaults to
   * `run.caseId`; recorded-ticket suites join by ticket id instead. Runs whose
   * key is null land in `uncompared`.
   */
  joinKey?: (run: SuiteChildRunSummary) => string | null
}

export interface DiffChildRunsResult {
  counts: Record<SuiteDiffBucket, number>
  passRateDelta: number | null
  judgeOnlyFlips: number
  entries: SuiteDiffEntry[]
}

/**
 * Join two suites' child runs and bucket every transition. Pure — fully
 * unit-testable without a DB. Differing case sets degrade into `uncompared`
 * (the honest answer when cases were added/removed mid-loop), never an error.
 */
export function diffChildRuns(
  baseline: SuiteChildRunSummary[],
  candidate: SuiteChildRunSummary[],
  options?: DiffChildRunsOptions
): DiffChildRunsResult {
  const joinKey = options?.joinKey ?? ((run: SuiteChildRunSummary) => run.caseId)

  const entries: SuiteDiffEntry[] = []
  const candidateByKey = new Map<string, SuiteChildRunSummary>()
  const candidateUnkeyed: SuiteChildRunSummary[] = []
  for (const run of candidate) {
    const key = joinKey(run)
    if (key == null) candidateUnkeyed.push(run)
    else candidateByKey.set(key, run)
  }

  for (const baseRun of baseline) {
    const key = joinKey(baseRun)
    const candRun = key == null ? undefined : candidateByKey.get(key)
    if (key == null || !candRun) {
      entries.push(uncomparedEntry(baseRun, 'baseline'))
      continue
    }
    candidateByKey.delete(key)
    entries.push(pairedEntry(baseRun, candRun))
  }
  for (const candRun of [...candidateByKey.values(), ...candidateUnkeyed]) {
    entries.push(uncomparedEntry(candRun, 'candidate'))
  }

  const counts: Record<SuiteDiffBucket, number> = {
    fixed: 0,
    regressed: 0,
    still_failing: 0,
    still_passing: 0,
    incomparable: 0,
    uncompared: 0,
  }
  for (const entry of entries) counts[entry.bucket]++

  const comparable = counts.fixed + counts.regressed + counts.still_failing + counts.still_passing
  const passRateDelta =
    comparable === 0
      ? null
      : (counts.still_passing + counts.fixed) / comparable -
        (counts.still_passing + counts.regressed) / comparable

  const judgeOnlyFlips = entries.filter((e) => e.flipDriver === 'judge').length

  return { counts, passRateDelta, judgeOnlyFlips, entries }
}

function uncomparedEntry(
  run: SuiteChildRunSummary,
  side: 'baseline' | 'candidate'
): SuiteDiffEntry {
  return {
    caseId: run.caseId ?? '',
    caseName: run.caseName,
    bucket: 'uncompared',
    [side]: { runId: run.id, status: run.status },
  }
}

function pairedEntry(baseRun: SuiteChildRunSummary, candRun: SuiteChildRunSummary): SuiteDiffEntry {
  const entry: SuiteDiffEntry = {
    caseId: baseRun.caseId ?? candRun.caseId ?? '',
    caseName: candRun.caseName || baseRun.caseName,
    bucket: bucketPair(baseRun.status, candRun.status),
    baseline: { runId: baseRun.id, status: baseRun.status },
    candidate: { runId: candRun.id, status: candRun.status },
  }
  if (entry.bucket !== 'fixed' && entry.bucket !== 'regressed') return entry

  const { flips, forcedMixed } = collectAssertionFlips(
    baseRun.assertionResults,
    candRun.assertionResults
  )
  entry.assertionFlips = flips
  entry.flipDriver = classifyFlipDriver(flips, forcedMixed)
  return entry
}

function bucketPair(
  baselineStatus: SuiteChildRunSummary['status'],
  candidateStatus: SuiteChildRunSummary['status']
): SuiteDiffBucket {
  // Only settled verdicts compare; anything else (error/cancelled/timed_out —
  // or a queued/running straggler in a cancelled suite) is incomparable.
  const settled = (s: SuiteChildRunSummary['status']) => s === 'passed' || s === 'failed'
  if (!settled(baselineStatus) || !settled(candidateStatus)) return 'incomparable'
  if (baselineStatus === 'failed' && candidateStatus === 'passed') return 'fixed'
  if (baselineStatus === 'passed' && candidateStatus === 'failed') return 'regressed'
  return baselineStatus === 'passed' ? 'still_passing' : 'still_failing'
}

function collectAssertionFlips(
  baseline: AssertionResult[],
  candidate: AssertionResult[]
): { flips: AssertionFlip[]; forcedMixed: boolean } {
  const baseById = new Map(baseline.map((r) => [r.assertionId, r]))
  const candById = new Map(candidate.map((r) => [r.assertionId, r]))
  const flips: AssertionFlip[] = []
  let forcedMixed = false

  for (const base of baseline) {
    const cand = candById.get(base.assertionId)
    if (!cand) {
      // Assertion removed between runs (cases are mutable) — record the missing
      // side as 'error' and treat the flip set as mixed: it is not attributable.
      flips.push({ assertionId: base.assertionId, type: base.type, from: base.status, to: 'error' })
      forcedMixed = true
      continue
    }
    if (cand.status !== base.status) {
      flips.push({
        assertionId: base.assertionId,
        type: cand.type,
        from: base.status,
        to: cand.status,
      })
    }
  }
  for (const cand of candidate) {
    if (baseById.has(cand.assertionId)) continue
    flips.push({ assertionId: cand.assertionId, type: cand.type, from: 'error', to: cand.status })
    forcedMixed = true
  }

  return { flips, forcedMixed }
}

function classifyFlipDriver(flips: AssertionFlip[], forcedMixed: boolean): SuiteDiffFlipDriver {
  if (forcedMixed) return 'mixed'
  const hasJudge = flips.some((f) => f.type === 'response_criteria')
  const hasDeterministic = flips.some((f) => f.type !== 'response_criteria')
  if (hasJudge && hasDeterministic) return 'mixed'
  return hasJudge ? 'judge' : 'deterministic'
}

/**
 * Load two org-scoped terminal suites and diff their child runs. Accepts ANY
 * two suite ids — the persisted `baselineSuiteRunId` is navigation metadata,
 * not a constraint.
 */
export async function compareSuiteRuns(input: {
  organizationId: string
  baselineSuiteRunId: string
  candidateSuiteRunId: string
}): Promise<Result<SuiteDiffSummary, EvalServiceError>> {
  const { organizationId } = input

  const [baselineSuite, candidateSuite] = await Promise.all([
    getEvalSuiteRun({ organizationId, suiteRunId: input.baselineSuiteRunId }),
    getEvalSuiteRun({ organizationId, suiteRunId: input.candidateSuiteRunId }),
  ])
  if (baselineSuite.isErr()) return err(baselineSuite.error)
  if (candidateSuite.isErr()) return err(candidateSuite.error)
  const baseline = baselineSuite.value
  const candidate = candidateSuite.value

  if (!baseline) {
    return err({
      code: 'EVAL_SUITE_RUN_NOT_FOUND',
      message: `Eval suite run not found: ${input.baselineSuiteRunId}`,
    })
  }
  if (!candidate) {
    return err({
      code: 'EVAL_SUITE_RUN_NOT_FOUND',
      message: `Eval suite run not found: ${input.candidateSuiteRunId}`,
    })
  }
  for (const suite of [baseline, candidate]) {
    if (!TERMINAL_SUITE_STATUSES.has(suite.status)) {
      return err({
        code: 'SUITE_NOT_TERMINAL',
        message: `Suite run is not terminal: ${suite.id} (${suite.status})`,
      })
    }
  }

  const [baselineRuns, candidateRuns] = await Promise.all([
    listSuiteChildRunSummaries({ organizationId, suiteRunId: input.baselineSuiteRunId }),
    listSuiteChildRunSummaries({ organizationId, suiteRunId: input.candidateSuiteRunId }),
  ])
  if (baselineRuns.isErr()) return err(baselineRuns.error)
  if (candidateRuns.isErr()) return err(candidateRuns.error)

  const diff = diffChildRuns(baselineRuns.value, candidateRuns.value)
  return ok({
    baselineSuiteRunId: input.baselineSuiteRunId,
    candidateSuiteRunId: input.candidateSuiteRunId,
    baselineRunMode: baseline.runMode,
    candidateRunMode: candidate.runMode,
    ...diff,
  })
}
