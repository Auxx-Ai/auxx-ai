// apps/web/src/components/evals/hooks/build-fix-seed.ts
//
// Pure builder for the "Fix with Kopilot" seed message (phase 5D.1). The text
// embeds the references the 5C.5 contract expects — case name(s), case id(s),
// run id(s), suite run id, failed-assertion one-liners — so Kopilot's first
// turn can call `get_eval_run` directly without a `list_eval_cases` round-trip,
// and targeted re-runs can pass the case ids straight to `run_eval_suite`.

const NOTE_MAX = 160

export interface FixSeedRun {
  runId: string
  /** Null when the case was deleted after the run. */
  caseId: string | null
  caseName: string
  /** Non-passed assertions; `note` is the grader's reason when present. */
  failedAssertions: { type: string; note?: string | null }[]
}

export interface FixSeedInput {
  runs: FixSeedRun[]
  suiteRunId?: string | null
}

/** Cap a grader note so a pathological transcript can't blow up the seed. */
function capNote(note: string): string {
  const flat = note.replace(/\s+/g, ' ').trim()
  return flat.length > NOTE_MAX ? `${flat.slice(0, NOTE_MAX)}…` : flat
}

/** A suite child-run summary (`eval.listSuiteChildRuns` row). */
export interface SuiteChildRunLike {
  id: string
  caseId: string | null
  caseName: string
  status: string
  assertionResults: { type: string; status: string; note?: string | null }[]
}

/**
 * Project a suite's child runs into `FixSeedRun[]`, keeping only the failed /
 * errored ones (Phase 2.5). Each run carries its non-passed assertions so the
 * suite-level "Fix N failures with Kopilot" seed covers every failure at once.
 */
export function suiteChildrenToFixRuns(children: SuiteChildRunLike[]): FixSeedRun[] {
  return children
    .filter((c) => c.status !== 'passed')
    .map((c) => ({
      runId: c.id,
      caseId: c.caseId,
      caseName: c.caseName || 'Deleted case',
      failedAssertions: c.assertionResults
        .filter((a) => a.status !== 'passed')
        .map((a) => ({ type: a.type, note: a.note })),
    }))
}

/**
 * Build the seeded builder-chat message for one or more failing runs.
 * Stable, plain-text formatting — the model parses this, not a human.
 */
export function buildFixSeedMessage(input: FixSeedInput): string {
  const lines: string[] = []
  const plural = input.runs.length === 1 ? 'simulation' : 'simulations'
  lines.push(`Help me fix ${input.runs.length} failing ${plural}.`)

  for (const run of input.runs) {
    lines.push('')
    const ids = run.caseId ? `case ${run.caseId}, run ${run.runId}` : `run ${run.runId}`
    lines.push(`Case "${run.caseName}" failed (${ids}):`)
    if (run.failedAssertions.length === 0) {
      lines.push('- execution error (no assertion results)')
    }
    for (const assertion of run.failedAssertions) {
      lines.push(
        assertion.note ? `- ${assertion.type}: ${capNote(assertion.note)}` : `- ${assertion.type}`
      )
    }
  }

  lines.push('')
  if (input.suiteRunId) lines.push(`Suite run: ${input.suiteRunId}`)
  lines.push(
    'Read the failing run(s) with get_eval_run, then propose the smallest build edit that addresses the failure.'
  )
  return lines.join('\n')
}
