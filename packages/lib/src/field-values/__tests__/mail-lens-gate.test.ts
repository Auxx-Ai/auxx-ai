// packages/lib/src/field-values/__tests__/mail-lens-gate.test.ts

import type { FieldReference, ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'

const { findCachedResource, getCachedUserInstanceGrants, getThreadLensBatch } = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
  getThreadLensBatch: vi.fn(),
}))

vi.mock('../../cache', () => ({ findCachedResource, getCachedUserInstanceGrants }))
vi.mock('../../permissions/visibility/thread-lens', () => ({ getThreadLensBatch }))

import type { Lens } from '../../permissions/visibility/lens'
import type { FieldValueContext } from '../field-value-helpers'
import { resolveMailLensGate, threadFieldMinLens } from '../mail-lens-gate'
import type { TypedFieldValueResult } from '../types'

const ORG = 'org_1'
const USER = 'user_1'

/** Minimal resource shapes — the gate only reads `id` and `fields[].id/key`. */
const RESOURCES: Record<string, { id: string; fields: Array<{ id: string; key: string }> }> = {
  thread: {
    id: 'thread',
    fields: [
      { id: 'subject', key: 'subject' },
      { id: 'status', key: 'status' },
      { id: 'body', key: 'body' },
      { id: 'fv_tags', key: 'tags' },
      { id: 'visitIp', key: 'visitIp' },
      { id: 'ticket', key: 'ticket' },
    ],
  },
  threads: { id: 'thread', fields: [{ id: 'visitIp', key: 'visitIp' }] },
  message: { id: 'message', fields: [{ id: 'textPlain', key: 'textPlain' }] },
  contact: { id: 'contact', fields: [{ id: 'email', key: 'email' }] },
}

function context(overrides: Partial<FieldValueContext> = {}): FieldValueContext {
  return {
    db: {} as FieldValueContext['db'],
    organizationId: ORG,
    userId: USER,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
    capabilities: {} as FieldValueContext['capabilities'],
    ...overrides,
  }
}

/** A resolved value for `recordId`/`fieldRef`; the gate ignores the payload. */
function value(recordId: RecordId, fieldRef: FieldReference): TypedFieldValueResult {
  return { recordId, fieldRef, value: null, fieldType: 'TEXT' as never }
}

const THREAD_A = toRecordId('thread', 'thr_a')
const THREAD_B = toRecordId('thread', 'thr_b')
const CONTACT = toRecordId('contact', 'con_1')

beforeEach(() => {
  findCachedResource.mockReset().mockImplementation(async (_org: string, key: string) => {
    return RESOURCES[key] ?? null
  })
  getCachedUserInstanceGrants.mockReset().mockResolvedValue({ userId: USER })
  getThreadLensBatch.mockReset().mockResolvedValue(new Map<string, Lens>())
})

describe('threadFieldMinLens', () => {
  it('classifies thread fields against mail’s own tiers', () => {
    expect(threadFieldMinLens('status')).toBe('metadata')
    expect(threadFieldMinLens('tags')).toBe('metadata')
    expect(threadFieldMinLens('subject')).toBe('identity')
    expect(threadFieldMinLens('body')).toBe('read')
  })

  it('defaults an unclassified field to identity, not metadata', () => {
    expect(threadFieldMinLens('someFieldAddedTomorrow')).toBe('identity')
  })
})

describe('resolveMailLensGate', () => {
  it('does not apply without capabilities — internal callers stay unenforced', async () => {
    const gate = await resolveMailLensGate(context({ capabilities: undefined }), [THREAD_A], [
      'thread:subject',
    ] as FieldReference[])

    expect(gate).toBeNull()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('does not apply to a batch with no mail host', async () => {
    const gate = await resolveMailLensGate(context(), [CONTACT], [
      'contact:email',
    ] as FieldReference[])

    expect(gate).toBeNull()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('reads every thread lens in ONE batched call', async () => {
    getThreadLensBatch.mockResolvedValue(
      new Map<string, Lens>([
        ['thr_a', 'read'],
        ['thr_b', 'metadata'],
      ])
    )

    await resolveMailLensGate(context(), [THREAD_A, THREAD_B, CONTACT], [
      'thread:subject',
    ] as FieldReference[])

    expect(getThreadLensBatch).toHaveBeenCalledTimes(1)
    expect(getThreadLensBatch).toHaveBeenCalledWith({}, ORG, { userId: USER }, ['thr_a', 'thr_b'])
  })

  it('withholds the subject below identity and keeps metadata fields', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>([['thr_a', 'metadata']]))

    const gate = await resolveMailLensGate(context(), [THREAD_A], [
      'thread:subject',
      'thread:status',
    ] as FieldReference[])

    const kept = gate!.filterValues([
      value(THREAD_A, 'thread:subject' as ResourceFieldId),
      value(THREAD_A, 'thread:status' as ResourceFieldId),
    ])

    expect(kept.map((v) => v.fieldRef)).toEqual(['thread:status'])
    expect(gate!.visibleRecordIds).toEqual([THREAD_A])
  })

  it('withholds the latest-message body below read', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>([['thr_a', 'identity']]))

    const gate = await resolveMailLensGate(context(), [THREAD_A], [
      'thread:subject',
      'thread:body',
    ] as FieldReference[])

    const kept = gate!.filterValues([
      value(THREAD_A, 'thread:subject' as ResourceFieldId),
      value(THREAD_A, 'thread:body' as ResourceFieldId),
    ])

    expect(kept.map((v) => v.fieldRef)).toEqual(['thread:subject'])
  })

  it('changes nothing for a read-lens viewer', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>([['thr_a', 'read']]))

    const refs = [
      'thread:subject',
      'thread:status',
      'thread:body',
      'thread:visitIp',
    ] as FieldReference[]
    const gate = await resolveMailLensGate(context(), [THREAD_A], refs)
    const values = refs.map((ref) => value(THREAD_A, ref))

    expect(gate!.visibleRecordIds).toEqual([THREAD_A])
    expect(gate!.filterValues(values)).toEqual(values)
  })

  it('drops an invisible thread from the anchors entirely', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>([['thr_a', 'read']]))

    const gate = await resolveMailLensGate(context(), [THREAD_A, THREAD_B, CONTACT], [
      'thread:status',
    ] as FieldReference[])

    // `thr_b` has no lens entry — invisible, and the contact is untouched.
    expect(gate!.visibleRecordIds).toEqual([THREAD_A, CONTACT])
    expect(
      gate!.filterValues([
        value(THREAD_B, 'thread:status' as ResourceFieldId),
        value(CONTACT, 'contact:email' as ResourceFieldId),
      ])
    ).toEqual([value(CONTACT, 'contact:email' as ResourceFieldId)])
  })

  it('gates the apiSlug form of the thread def too', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>())

    const gate = await resolveMailLensGate(context(), [toRecordId('threads', 'thr_a')], [
      'threads:visitIp',
    ] as FieldReference[])

    expect(gate!.visibleRecordIds).toEqual([])
  })

  it('withholds message hosts outright — no legitimate request-path reader', async () => {
    const gate = await resolveMailLensGate(context(), [toRecordId('message', 'msg_1')], [
      'message:textPlain',
    ] as FieldReference[])

    expect(gate!.visibleRecordIds).toEqual([])
    expect(
      gate!.filterValues([
        value(toRecordId('message', 'msg_1'), 'message:textPlain' as ResourceFieldId),
      ])
    ).toEqual([])
  })

  it('gates a traversal path on its first hop, not its terminal field', async () => {
    getThreadLensBatch.mockResolvedValue(new Map<string, Lens>([['thr_a', 'metadata']]))

    const path: FieldReference = [
      'thread:ticket' as ResourceFieldId,
      'ticket:name' as ResourceFieldId,
    ]
    const gate = await resolveMailLensGate(context(), [THREAD_A], [path])

    // `thread:ticket` is metadata-tier, so the hop survives at `metadata`.
    expect(gate!.filterValues([value(THREAD_A, path)])).toHaveLength(1)
  })

  it('fails closed when enforcement is on but no viewer is resolvable', async () => {
    const gate = await resolveMailLensGate(context({ userId: undefined }), [THREAD_A], [
      'thread:status',
    ] as FieldReference[])

    expect(getThreadLensBatch).not.toHaveBeenCalled()
    expect(gate!.visibleRecordIds).toEqual([])
  })
})
