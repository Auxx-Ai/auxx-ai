// packages/lib/src/field-values/display-field-service.test.ts

import type { Database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { ok } from 'neverthrow'

// Mock the cache barrel WHOLESALE, listing every name the static import
// graph of display-field-service pulls (helpers, mutations, queries,
// timeline-snapshot, resolvers). Do NOT partial-mock via `importOriginal`
// here: loading the real barrel inside the factory walks its own import
// graph before the mock exists, and modules loaded during that walk capture
// the REAL `getCachedResource` — the mock then silently never applies.
vi.mock('../cache', () => ({
  getCachedResource: vi.fn(),
  findCachedResource: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  getOrgCache: vi.fn(),
  getCachedResourceFields: vi.fn(),
  getCachedFieldMap: vi.fn(),
  getAllCachedCustomFields: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  getCachedAgents: vi.fn(),
  getCachedGroups: vi.fn(),
  getCachedMembersByUserIds: vi.fn(),
  getCachedResources: vi.fn(),
  getCachedAgentsByUserIds: vi.fn(),
}))

// Wholesale, for the same reason as the cache barrel above: since the module
// moved into lib, the real `../entity-instances` barrel re-exports `activity`,
// whose graph reaches back into the cache — walking it inside an
// `importOriginal` factory loads display-field-service with the REAL
// `batchUpdateDisplayValues` before the mock exists.
vi.mock('../entity-instances', () => ({
  batchUpdateDisplayValues: vi.fn(),
  clearDisplayValues: vi.fn(),
}))

// The searchText refresh runs raw SQL against the db — out of scope here.
vi.mock('./search-text', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./search-text')>()),
  updateSearchTextForEntityDefinition: vi.fn(),
}))

import { getCachedResource } from '../cache'
import { batchUpdateDisplayValues } from '../entity-instances'
import { DisplayFieldService } from './display-field-service'
import { FieldValueService } from './field-value-service'

const mockedGetCachedResource = vi.mocked(getCachedResource)
const mockedBatchUpdate = vi.mocked(batchUpdateDisplayValues)

const ORG_ID = 'org-1'
const EMAIL_FIELD_ID = 'field-email'

const emailField = {
  id: EMAIL_FIELD_ID,
  fieldType: 'EMAIL',
  options: { multi: true },
} as any

const contactResource = {
  id: 'contact',
  type: 'custom',
  fields: [emailField],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: { id: EMAIL_FIELD_ID },
    avatarField: null,
  },
} as any

const email = (id: string, value: string): TypedFieldValue => ({ id, type: 'text', value }) as any

function createService(instances: Array<{ id: string }>) {
  const db = {
    query: {
      EntityInstance: {
        findMany: vi.fn().mockResolvedValue(instances),
      },
    },
  } as unknown as Database
  return new DisplayFieldService(ORG_ID, db)
}

describe('DisplayFieldService.computeDisplayValue (via recalculateDisplayField)', () => {
  beforeEach(() => {
    mockedGetCachedResource.mockResolvedValue(contactResource)
    mockedBatchUpdate.mockImplementation(async ({ updates }) => ok({ updated: updates.size }))
  })

  it('renders the primary (first) value as the subtitle for a multi email field', async () => {
    const service = createService([{ id: 'inst-1' }])
    vi.spyOn(FieldValueService.prototype, 'batchGetValues').mockResolvedValue({
      values: [
        {
          recordId: 'contact:inst-1',
          fieldRef: `contact:${EMAIL_FIELD_ID}`,
          value: [email('v1', 'primary@example.com'), email('v2', 'alias@example.com')],
        } as any,
      ],
    })

    const result = await service.recalculateDisplayField('contact', 'secondary')

    expect(mockedBatchUpdate).toHaveBeenCalledTimes(1)
    const { updates, column } = mockedBatchUpdate.mock.calls[0]?.[0] as {
      updates: Map<string, string | null>
      column: string
    }
    expect(column).toBe('secondaryDisplayValue')
    // Pre-fix behavior: the `typeof === 'string'` guard nulled the array and
    // the batch recalc WIPED the subtitle. It must be the primary value.
    expect(updates.get('inst-1')).toBe('primary@example.com')
    expect(result).toEqual({ displayFieldType: 'secondary', processed: 1, updated: 1 })
  })

  it('does not null subtitles across a batch recalc mixing multi, single and empty values', async () => {
    const service = createService([{ id: 'inst-1' }, { id: 'inst-2' }, { id: 'inst-3' }])
    vi.spyOn(FieldValueService.prototype, 'batchGetValues').mockResolvedValue({
      values: [
        {
          recordId: 'contact:inst-1',
          fieldRef: `contact:${EMAIL_FIELD_ID}`,
          value: [email('v1', 'a@example.com'), email('v2', 'b@example.com')],
        } as any,
        {
          recordId: 'contact:inst-2',
          fieldRef: `contact:${EMAIL_FIELD_ID}`,
          value: email('v3', 'single@example.com'),
        } as any,
        // inst-3 has no value row at all — its subtitle legitimately clears.
      ],
    })

    await service.recalculateDisplayField('contact', 'secondary')

    const { updates } = mockedBatchUpdate.mock.calls[0]?.[0] as {
      updates: Map<string, string | null>
    }
    expect(updates.get('inst-1')).toBe('a@example.com')
    expect(updates.get('inst-2')).toBe('single@example.com')
    expect(updates.get('inst-3')).toBeNull()
  })

  it('nulls the subtitle for an empty array value', async () => {
    const service = createService([{ id: 'inst-1' }])
    vi.spyOn(FieldValueService.prototype, 'batchGetValues').mockResolvedValue({
      values: [
        {
          recordId: 'contact:inst-1',
          fieldRef: `contact:${EMAIL_FIELD_ID}`,
          value: [],
        } as any,
      ],
    })

    await service.recalculateDisplayField('contact', 'secondary')

    const { updates } = mockedBatchUpdate.mock.calls[0]?.[0] as {
      updates: Map<string, string | null>
    }
    expect(updates.get('inst-1')).toBeNull()
  })
})
