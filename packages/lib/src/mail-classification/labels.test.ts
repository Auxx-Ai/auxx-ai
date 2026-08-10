// packages/lib/src/mail-classification/labels.test.ts
// Q3 is the trap here: an `article`-scoped tag whose `tag_ai_classify` toggle is
// ON must never reach the prompt. Article tags exist for KB content; offering
// them to a mail classifier is a category error.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  getCachedCustomFields: vi.fn(),
}))

vi.mock('../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getCachedCustomFields: h.getCachedCustomFields,
}))

import { getEligibleClassificationTags } from './labels'

const FIELDS = [
  { id: 'fld_ai', systemAttribute: 'tag_ai_classify' },
  { id: 'fld_title', systemAttribute: 'title' },
  { id: 'fld_desc', systemAttribute: 'tag_description' },
  { id: 'fld_scope', systemAttribute: 'tag_scope' },
]

/** `db` whose `select()` chain resolves the next queued row set. */
function createDb(rowSets: unknown[][]) {
  let index = 0
  const select = vi.fn(() => {
    const result = Promise.resolve(rowSets[index++] ?? [])
    const step: Record<string, unknown> = {}
    step.from = () => step
    step.where = () => step
    step.limit = () => result
    step.then = (onOk: unknown, onErr: unknown) => result.then(onOk as never, onErr as never)
    return step
  })
  return { select } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue('def_tag')
  h.getCachedCustomFields.mockResolvedValue(FIELDS)
})

describe('getEligibleClassificationTags — scope (Q3)', () => {
  it('⚠️ an ARTICLE-scoped eligible tag never reaches the prompt', async () => {
    const db = createDb([
      [{ tagId: 'tag_thread' }, { tagId: 'tag_article' }],
      [
        { id: 'tag_thread', displayName: 'Billing' },
        { id: 'tag_article', displayName: 'How-to' },
      ],
      [
        { entityId: 'tag_thread', fieldId: 'fld_title', valueText: 'Billing', optionId: null },
        { entityId: 'tag_thread', fieldId: 'fld_scope', valueText: null, optionId: 'thread' },
        { entityId: 'tag_article', fieldId: 'fld_title', valueText: 'How-to', optionId: null },
        { entityId: 'tag_article', fieldId: 'fld_scope', valueText: null, optionId: 'article' },
      ],
    ])

    const labels = await getEligibleClassificationTags(db, 'org_1')

    expect(labels.map((l) => l.tagId)).toEqual(['tag_thread'])
  })

  it('a SINGLE_SELECT value arriving as an ARRAY still compares (invariant 13)', async () => {
    const db = createDb([
      [{ tagId: 'tag_thread' }],
      [{ id: 'tag_thread', displayName: 'Billing' }],
      [
        { entityId: 'tag_thread', fieldId: 'fld_title', valueText: 'Billing', optionId: null },
        {
          entityId: 'tag_thread',
          fieldId: 'fld_scope',
          valueText: null,
          optionId: ['thread'] as never,
        },
      ],
    ])

    expect((await getEligibleClassificationTags(db, 'org_1')).map((l) => l.tagId)).toEqual([
      'tag_thread',
    ])
  })

  it('a tag with no scope row is treated as thread-scoped (pre-019 data)', async () => {
    const db = createDb([
      [{ tagId: 'tag_old' }],
      [{ id: 'tag_old', displayName: 'Legacy' }],
      [{ entityId: 'tag_old', fieldId: 'fld_title', valueText: 'Legacy', optionId: null }],
    ])

    expect((await getEligibleClassificationTags(db, 'org_1')).map((l) => l.tagId)).toEqual([
      'tag_old',
    ])
  })
})

describe('getEligibleClassificationTags — the label payload', () => {
  it('carries title + description, and keeps a description-less tag (Q5)', async () => {
    const db = createDb([
      [{ tagId: 'tag_a' }, { tagId: 'tag_b' }],
      [
        { id: 'tag_a', displayName: 'Billing' },
        { id: 'tag_b', displayName: 'Sales' },
      ],
      [
        { entityId: 'tag_a', fieldId: 'fld_title', valueText: 'Billing', optionId: null },
        { entityId: 'tag_a', fieldId: 'fld_desc', valueText: 'Invoices', optionId: null },
        { entityId: 'tag_b', fieldId: 'fld_title', valueText: 'Sales', optionId: null },
      ],
    ])

    expect(await getEligibleClassificationTags(db, 'org_1')).toEqual([
      { tagId: 'tag_a', title: 'Billing', description: 'Invoices' },
      { tagId: 'tag_b', title: 'Sales', description: null },
    ])
  })

  it('falls back to displayName when the title FieldValue is missing', async () => {
    const db = createDb([[{ tagId: 'tag_a' }], [{ id: 'tag_a', displayName: 'Fallback' }], []])

    expect((await getEligibleClassificationTags(db, 'org_1'))[0]?.title).toBe('Fallback')
  })
})

describe('getEligibleClassificationTags — the empty answers', () => {
  it('returns [] when the tag_ai_classify field is not materialized yet (§2.1)', async () => {
    h.getCachedCustomFields.mockResolvedValue(FIELDS.filter((f) => f.id !== 'fld_ai'))
    const db = createDb([])

    expect(await getEligibleClassificationTags(db, 'org_1')).toEqual([])
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled()
  })

  it('returns [] when the org has no tag entity def', async () => {
    h.getCachedEntityDefId.mockResolvedValue(undefined)

    expect(await getEligibleClassificationTags(createDb([]), 'org_1')).toEqual([])
  })

  it('drops an archived tag — the instance query filters it out', async () => {
    const db = createDb([[{ tagId: 'tag_gone' }], []])

    expect(await getEligibleClassificationTags(db, 'org_1')).toEqual([])
  })
})
