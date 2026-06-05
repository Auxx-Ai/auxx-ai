// packages/lib/src/agents/procedures/__tests__/turn-wiring.test.ts

import { describe, expect, it } from 'vitest'
import type { CachedAgentProcedure } from '../../../cache/org-cache-keys'
import type { SelectionResult } from '../select'
import { emptyStack, push, top } from '../stack'
import { applySelection, buildActiveStepInput, resolveCandidatesFromCache } from '../turn-wiring'
import type { CompiledProcedure, ProcedureFrame } from '../types'

const compiled: CompiledProcedure = {
  entryStepId: 's1',
  steps: { s1: { id: 's1', kind: 'instruction', doc: { t: 'hi' }, next: null } },
  codeBlocks: { c1: { language: 'javascript', code: '', inputs: [], outputs: [] } },
  subProcedures: { sub1: { id: 'sub1', name: 'Refund flow', entryStepId: 's1' } },
  localAttributes: [],
}

const projection: CachedAgentProcedure = {
  linkId: 'link1',
  procedureId: 'proc1',
  enabled: true,
  priority: 5,
  whenToUse: 'use for refunds',
  triggerExamples: [{ text: 'I want a refund', behavior: 'use' }],
  ruleset: [],
  activeVersionId: 'ver1',
  compiled,
}

const frame: ProcedureFrame = {
  procedureId: 'proc1',
  procedureVersionId: 'ver1',
  cursor: 's1',
  status: 'running',
  history: [],
  pushedBy: 'selection',
}

describe('resolveCandidatesFromCache', () => {
  it('maps the projection onto the ResolvedCandidate shape selection reads', () => {
    const [candidate] = resolveCandidatesFromCache([projection])
    expect(candidate!.link.enabled).toBe(true)
    expect(candidate!.link.priority).toBe(5)
    expect(candidate!.procedure.id).toBe('proc1')
    expect(candidate!.activeVersion.id).toBe('ver1')
    expect(candidate!.activeVersion.compiled).toBe(compiled)
    expect(candidate!.resolved).toEqual({
      whenToUse: 'use for refunds',
      triggerExamples: [{ text: 'I want a refund', behavior: 'use' }],
      ruleset: [],
    })
  })

  it('returns [] for no procedures (zero-procedure agents)', () => {
    expect(resolveCandidatesFromCache([])).toEqual([])
  })
})

describe('applySelection', () => {
  it('pushes the frame on a fresh selection', () => {
    const selection: SelectionResult = { kind: 'selected', frame }
    const next = applySelection(emptyStack(), selection)
    expect(top(next)).toEqual(frame)
  })

  it('leaves the stack unchanged on resume (top is already the frame)', () => {
    const stack = push(emptyStack(), frame)
    const next = applySelection(stack, { kind: 'resume', frame })
    expect(next).toBe(stack)
  })

  it('leaves the stack unchanged on none (free-form)', () => {
    const stack = emptyStack()
    expect(applySelection(stack, { kind: 'none' })).toBe(stack)
  })
})

describe('buildActiveStepInput', () => {
  it('maps the active step + compiled maps + depth + breadcrumb', () => {
    const stack = push(emptyStack(), frame)
    const input = buildActiveStepInput({
      activeStep: { doc: { t: 'do the thing' } },
      compiled,
      stack,
      breadcrumb: 'Back to refunds',
    })
    expect(input.activeStep.doc).toEqual({ t: 'do the thing' })
    expect(input.procedureMaps?.subProcedures).toEqual([{ id: 'sub1', name: 'Refund flow' }])
    expect(input.procedureMaps?.codeBlocks).toEqual([{ id: 'c1', name: 'c1' }])
    expect(input.depth).toBe(1)
    expect(input.breadcrumb).toBe('Back to refunds')
  })
})
