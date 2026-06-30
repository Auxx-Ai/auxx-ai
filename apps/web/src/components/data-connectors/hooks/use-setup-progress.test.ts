// apps/web/src/components/data-connectors/hooks/use-setup-progress.test.ts

import { describe, expect, it } from 'vitest'
import type { RouterOutputs } from '~/trpc/react'
import {
  type ConnectRequirements,
  deriveSetupProgress,
  deriveStreamReadiness,
  type ProgressConnectorRow,
  type ProgressStreamRow,
} from './use-setup-progress'

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

  it('is ready for a lazy owned mapping whose entries carry a provision spec (null ref)', () => {
    // 05e: an owned def is provisioned lazily, so its fields have null refs + a provision
    // hint until first sync. That still counts as bound (else setup would be blocked).
    const s = {
      mappings: [{ fieldMappings: [{ targetFieldRef: null, provision: { name: 'Order Name' } }] }],
    } as unknown as Stream
    expect(deriveStreamReadiness(s)).toBe('ready')
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

describe('deriveSetupProgress — map gate filters by enabled', () => {
  // A generic-rest connector with an endpoint satisfies Connect, isolating the map gate.
  const connector: ProgressConnectorRow = {
    definitionKind: 'rest',
    config: { endpoint: { baseUrl: 'https://api.example.com' } },
    credentialId: null,
  }
  const reqs: ConnectRequirements = {
    requiresConnection: false,
    hasConfigForm: false,
    requiredConfigSatisfied: true,
  }
  const ready = (enabled: boolean): ProgressStreamRow => ({
    enabled,
    sourceSchema: { type: 'object' },
    mappings: [{ fieldMappings: [{ targetFieldRef: 'def:field' }] }],
  })
  const notReady = (enabled: boolean): ProgressStreamRow => ({
    enabled,
    sourceSchema: { type: 'object' },
    mappings: [{ fieldMappings: [{ targetFieldRef: null }] }],
  })

  it('passes when an enabled stream is ready and a disabled one is not', () => {
    expect(deriveSetupProgress(connector, [ready(true), notReady(false)], reqs).map).toBe(true)
  })

  it('passes when the only not-ready stream is disabled', () => {
    expect(deriveSetupProgress(connector, [ready(true), notReady(false)], reqs).map).toBe(true)
  })

  it('blocks when a not-ready stream is enabled', () => {
    expect(deriveSetupProgress(connector, [ready(true), notReady(true)], reqs).map).toBe(false)
  })

  it('blocks (map:false) when every stream is disabled', () => {
    expect(deriveSetupProgress(connector, [ready(false), ready(false)], reqs).map).toBe(false)
  })
})
