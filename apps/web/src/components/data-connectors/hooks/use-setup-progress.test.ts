// apps/web/src/components/data-connectors/hooks/use-setup-progress.test.ts

import { describe, expect, it } from 'vitest'
import type { RouterOutputs } from '~/trpc/react'
import { deriveStreamReadiness } from './use-setup-progress'

type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** Minimal stream factory — only the mapping shape `deriveStreamReadiness` reads. */
function stream(mappings: Array<{ targetFieldRefs: Array<string | null> }>): Stream {
  return {
    mappings: mappings.map((m) => ({
      fieldMappings: m.targetFieldRefs.map((ref) => ({ targetFieldRef: ref })),
    })),
  } as unknown as Stream
}

describe('deriveStreamReadiness', () => {
  it('is ready when any mapping has a bound targetFieldRef', () => {
    expect(deriveStreamReadiness(stream([{ targetFieldRefs: ['def:field'] }]))).toBe('ready')
  })

  it('needs mapping when every binding is an unbound draft', () => {
    expect(deriveStreamReadiness(stream([{ targetFieldRefs: [null] }]))).toBe('needs-mapping')
  })

  it('needs mapping when a stream has no mappings at all', () => {
    expect(deriveStreamReadiness(stream([]))).toBe('needs-mapping')
  })

  it('is ready when a later mapping is bound even if an earlier one is a draft', () => {
    expect(
      deriveStreamReadiness(
        stream([{ targetFieldRefs: [null] }, { targetFieldRefs: [null, 'def:field'] }])
      )
    ).toBe('ready')
  })
})
