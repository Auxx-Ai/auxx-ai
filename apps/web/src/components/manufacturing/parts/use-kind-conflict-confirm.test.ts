// apps/web/src/components/manufacturing/parts/use-kind-conflict-confirm.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [vi.fn(), () => null] }))

const { kindConflictPrompt } = await import('./use-kind-conflict-confirm')

const part = (partId: string, facts: { isSubpartOfAssembly?: boolean; hasBom?: boolean } = {}) => ({
  partId,
  title: `Part ${partId}`,
  isSubpartOfAssembly: facts.isSubpartOfAssembly ?? false,
  hasBom: facts.hasBom ?? false,
})

describe('kindConflictPrompt', () => {
  it('asks nothing when no part conflicts', () => {
    expect(kindConflictPrompt([part('a'), part('b')], 'finished_good')).toBeNull()
    expect(kindConflictPrompt([part('a', { isSubpartOfAssembly: true })], 'component')).toBeNull()
  })

  it('offers skip or set-all for a mixed selection', () => {
    const parts = [part('a', { isSubpartOfAssembly: true }), part('b'), part('c')]
    const prompt = kindConflictPrompt(parts, 'finished_good')
    expect(prompt?.conflicting.map((p) => p.partId)).toEqual(['a'])
    expect(prompt?.description).toBe(
      '1 of these is used inside other parts and is usually a Component.'
    )
    expect(prompt?.confirmText).toBe('Set 2, skip this one')
    expect(prompt?.alternateText).toBe('Set all 3 anyway')
  })

  it('asks one question for a single part', () => {
    const prompt = kindConflictPrompt([part('a', { hasBom: true })], 'component')
    expect(prompt?.title).toBe('Set Part a to Component?')
    expect(prompt?.confirmText).toBe('Set Component anyway')
    expect(prompt?.alternateText).toBeUndefined()
  })
})
