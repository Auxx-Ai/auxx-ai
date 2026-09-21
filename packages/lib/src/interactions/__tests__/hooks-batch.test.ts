// packages/lib/src/interactions/__tests__/hooks-batch.test.ts
//
// plans/events/10 §4.4: the sync lane's core. Ported from the retired pass 5 of
// `events/handlers/__tests__/finalize-integrity-passes.test.ts` — selection only; what
// `resolveInteractions` then does is covered by its own suite.

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../field-hooks/types'
import type { CachedField } from '../../field-values/types'

vi.mock('../resolve', () => ({ resolveInteractions: vi.fn(async () => ({ contacts: 0 })) }))

import { resolveInteractionsBatch } from '../hooks'
import { resolveInteractions } from '../resolve'

const mockedResolve = resolveInteractions as unknown as ReturnType<typeof vi.fn>

const ORG = 'org_1'
const DB = { tag: 'db' } as never

function target(instanceId: string, systemAttribute: string | null): FieldChangeRef {
  return {
    recordId: toRecordId('contact', instanceId),
    entityDefinitionId: 'def_contact',
    entityType: 'contact',
    entitySlug: 'contacts',
    field: { id: `fld_${systemAttribute}`, systemAttribute } as unknown as CachedField,
    organizationId: ORG,
    userId: 'system',
  } as FieldChangeRef
}

const batch = (targets: FieldChangeRef[]) =>
  resolveInteractionsBatch({ organizationId: ORG, userId: 'system', db: DB, targets })

/** The ids the one call was made with, sorted. */
function selected(): string[] {
  return [...(mockedResolve.mock.calls[0]?.[0]?.recordIds ?? [])].sort()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveInteractionsBatch', () => {
  it('resolves once for the whole run, with distinct instance ids and the sync reason', async () => {
    await batch([
      target('c1', 'primary_email'),
      target('c1', 'phone'),
      target('c2', 'primary_phone'),
    ])

    expect(mockedResolve).toHaveBeenCalledTimes(1)
    expect(selected()).toEqual(['c1', 'c2'])
    expect(mockedResolve.mock.calls[0]![0]).toMatchObject({ reason: 'sync', db: DB })
  })

  it('selects a company domain write', async () => {
    await batch([target('co1', 'company_domain')])

    expect(selected()).toEqual(['co1'])
  })

  it('ignores a target whose attribute cannot move a participant', async () => {
    await batch([target('c1', 'contact_status'), target('c2', null)])

    expect(mockedResolve).not.toHaveBeenCalled()
  })
})
