// apps/extension/src/iframe/routes/root/lookups.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ParsedPerson } from '../../../lib/parsers/types'
import { lookupByField } from '../../trpc'
import { findExistingInEntity } from './lookups'

/**
 * Regression guard for the multi-value email rollout: once contact
 * `primary_email` is `options.multi`, `EntityInstance.secondaryDisplayValue`
 * may surface as a `string[]`. The lookup schema must tolerate that shape —
 * a failed Zod parse is swallowed by lookups.ts as "no match", and the user
 * saves a duplicate contact.
 */

function trpcQueryResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { data: { json: payload } } }),
  } as Response
}

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => trpcQueryResponse(payload))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const person: ParsedPerson = {
  externalId: 'linkedin:jane-doe',
  primaryEmail: 'jane@example.com',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lookupByField parse', () => {
  it('survives an array subtitle (multi-value email display column)', async () => {
    stubFetch({
      items: [
        {
          recordId: 'contact:inst-1',
          displayName: 'Jane Doe',
          secondaryDisplayValue: ['jane@example.com', 'jd@alias.com'],
          avatarUrl: null,
        },
      ],
      hasMore: false,
    })

    const result = await lookupByField({
      entityDefinitionId: 'contact',
      candidates: [{ systemAttribute: 'primary_email', value: 'jane@example.com' }],
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.secondaryDisplayValue).toEqual(['jane@example.com', 'jd@alias.com'])
  })

  it('still accepts a scalar subtitle', async () => {
    stubFetch({
      items: [
        {
          recordId: 'contact:inst-1',
          displayName: 'Jane Doe',
          secondaryDisplayValue: 'jane@example.com',
          avatarUrl: null,
        },
      ],
      hasMore: false,
    })

    const result = await lookupByField({
      entityDefinitionId: 'contact',
      candidates: [{ systemAttribute: 'primary_email', value: 'jane@example.com' }],
    })

    expect(result.items[0]?.secondaryDisplayValue).toBe('jane@example.com')
  })
})

describe('findExistingInEntity', () => {
  it('returns the match (not "no match") when the subtitle is an array, normalized to the primary', async () => {
    stubFetch({
      items: [
        {
          recordId: 'contact:inst-1',
          displayName: 'Jane Doe',
          secondaryDisplayValue: ['jane@example.com', 'jd@alias.com'],
          avatarUrl: null,
        },
      ],
      hasMore: false,
    })

    const matches = await findExistingInEntity('contact', person, null)

    // The pre-loosening behavior: Zod parse failure → catch → [] → the user
    // is offered Save and creates a duplicate. This must stay a real match.
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({
      recordId: 'contact:inst-1',
      entityType: 'contact',
      displayName: 'Jane Doe',
      secondaryDisplayValue: 'jane@example.com',
      avatarUrl: null,
    })
  })

  it('passes scalar subtitles through unchanged', async () => {
    stubFetch({
      items: [
        {
          recordId: 'contact:inst-2',
          displayName: 'John Doe',
          secondaryDisplayValue: 'john@example.com',
          avatarUrl: null,
        },
      ],
      hasMore: false,
    })

    const matches = await findExistingInEntity('contact', person, null)
    expect(matches[0]?.secondaryDisplayValue).toBe('john@example.com')
  })

  it('normalizes an empty array subtitle to null', async () => {
    stubFetch({
      items: [
        {
          recordId: 'contact:inst-3',
          displayName: 'Empty Subtitle',
          secondaryDisplayValue: [],
          avatarUrl: null,
        },
      ],
      hasMore: false,
    })

    const matches = await findExistingInEntity('contact', person, null)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.secondaryDisplayValue).toBeNull()
  })
})
