// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/graph-tool-helpers.test.ts

/**
 * `mutationToToolResult` — the refusal message.
 *
 * Severity is not causality. A refused mutation reports the WHOLE draft's
 * issues, and several `severity: 'error'` entries block nothing: an app block
 * whose app has no workspace connection is an error because the block cannot
 * RUN, never a reason the edit cannot be AUTHORED. `runGraphMutation` blocks on
 * exactly one thing — the ref errors the call INTRODUCED — and now says so via
 * `blockedBy`.
 *
 * These tests pin the consequence, not the wording. In the logged 2026-08-18
 * turn the renderer printed the co-reported FedEx connection error under
 * "blocking issues"; the model believed it, abandoned the carrier routing, and
 * told the user the workflow was blocked on connections. It was blocked on a
 * bad upstream reference, and the connection was never the reason.
 */

import { err, ok } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../../../../errors'
import type { GraphMutationResult, Issue } from '../../../../../../workflows/graph-edit/types'
import { mutationToToolResult } from '../graph-tool-helpers'

const REF_ERROR: Issue = {
  severity: 'error',
  nodeRef: 'Track FedEx',
  message:
    'Reference "{{Tracking Number.value}}" reads node Tracking Number, which is not upstream of Track FedEx.',
}

const CONNECTION_ERROR: Issue = {
  severity: 'error',
  nodeRef: 'Track FedEx',
  field: 'connectionId',
  message: 'Fedex has no workspace connection, so this block cannot run.',
}

const graphSummary = { nodeCount: 2 } as unknown as GraphMutationResult['graphSummary']

function refused(overrides: Partial<GraphMutationResult> = {}) {
  return mutationToToolResult(
    ok({ applied: false, issues: [], graphSummary, ...overrides }),
    () => 'Add block'
  )
}

describe('mutationToToolResult — refusal message', () => {
  it('names only what blocked, and files the rest under a heading that is not the cause', () => {
    const result = refused({
      issues: [CONNECTION_ERROR, REF_ERROR],
      blockedBy: [REF_ERROR],
    })

    expect(result.success).toBe(false)
    const message = result.error ?? ''
    const [cause, alsoPresent] = message.split('Also present')

    // The ref error is the cause and appears above the split.
    expect(cause).toContain('not upstream of Track FedEx')
    // The connection error must NOT be readable as the reason — that is the
    // whole defect. It appears only below the split.
    expect(cause).not.toContain('no workspace connection')
    expect(alsoPresent).toBeDefined()
    expect(alsoPresent).toContain('no workspace connection')
    expect(alsoPresent).toContain('will not make the edit apply')
  })

  it('omits the "also present" section when the blockers are the only errors', () => {
    const result = refused({ issues: [REF_ERROR], blockedBy: [REF_ERROR] })

    expect(result.error).toContain('not upstream of Track FedEx')
    expect(result.error).not.toContain('Also present')
  })

  it('falls back to severity when the mutation did not say what blocked', () => {
    // The structural / normalize / mail-trigger path returns exactly its own
    // blockers and sets no `blockedBy` — there, severity IS causality, and the
    // old behaviour is correct.
    const result = refused({ issues: [CONNECTION_ERROR] })

    expect(result.error).toContain('no workspace connection')
    expect(result.error).not.toContain('Also present')
  })

  it('still labels a pre-existing blocker as not-your-damage', () => {
    const inherited: Issue = { ...REF_ERROR, preExisting: true }
    const result = refused({ issues: [inherited], blockedBy: [inherited] })

    expect(result.error).toContain('pre-existing')
  })

  it('passes an AuxxError through untouched', () => {
    const result = mutationToToolResult(
      err(new BadRequestError('Ticket Subject is an input node')),
      () => 'Add block'
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Ticket Subject is an input node')
  })

  it('reports success without any of this when the edit applied', () => {
    const result = mutationToToolResult(
      ok({ applied: true, issues: [CONNECTION_ERROR], graphSummary }),
      () => 'Added Track FedEx'
    )

    expect(result.success).toBe(true)
    expect((result.output as { summary: string }).summary).toBe('Added Track FedEx')
  })
})
