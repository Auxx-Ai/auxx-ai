// packages/lib/src/seed/ai-category-tags.test.ts
//
// The starter mail categories are the vocabulary the classifier will be given, so the shape
// of the seeded rows is the contract:
//
//  1. **Exactly five, and no `Spam`** (C6) — a Spam tag beside a spam *status* is two ways to
//     say one thing, and it was the only category where ordering vs the agent mattered.
//  2. **Ordinary tags** (C4) — `is_system_tag: false` explicitly. A system tag's description
//     cannot be edited, and the description IS the classifier's instruction (C3), so seeding
//     these as system tags would freeze the feature's only tuning surface.
//  3. **Every starter carries a real description** — it is prompt text, not decoration.
//  4. **Idempotent by title.** A second pass creates nothing. A title the org already uses is
//     left exactly as it is — UNLESS it is a legacy tag WE seeded as a system tag, which is
//     adopted in place (see the adoption block at the bottom). The discriminator is
//     `is_system_tag`, never the title.
//  5. **Nothing becomes classifiable by accident** — the parent group is NOT eligible, and
//     seeding writes no inbox opt-in of any kind.
//
// `UnifiedCrudHandler` is stubbed (a lib-internal module, not one of the shared
// `@auxx/database` / `@auxx/logger` / `drizzle-orm` mocks), so the assertions are about the
// values this module hands the write path.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  creates: [] as { entityType: string; values: Record<string, unknown> }[],
  constructorOptions: [] as unknown[],
  createImpl: null as null | ((values: Record<string, unknown>) => void),
  /** Every `update` in call order, each tagged with the bypass set its handler carried. */
  updates: [] as {
    recordId: string
    values: Record<string, unknown>
    bypass: string[]
    modes?: Record<string, 'set' | 'add' | 'remove'>
    options?: Record<string, unknown>
  }[],
}))

vi.mock('../resources/crud', () => ({
  UnifiedCrudHandler: class {
    private bypass: string[]
    constructor(
      _orgId: string,
      _userId: string,
      _db: unknown,
      _socketId: unknown,
      options?: { bypassFieldGuards?: Set<string> }
    ) {
      h.constructorOptions.push(options)
      this.bypass = [...(options?.bypassFieldGuards ?? [])]
    }
    async create(entityType: string, values: Record<string, unknown>) {
      h.creates.push({ entityType, values })
      h.createImpl?.(values)
      return {
        instance: { id: `inst_${h.creates.length}` },
        recordId: `${TAG_DEF_ID}:inst_${h.creates.length}`,
        values,
      }
    }
    // Mirrors the REAL signature — (recordId, values, MODES, options). Getting
    // this wrong is how `seedOpts` silently lands in the array-mode map, which a
    // loose `(recordId, values)` stub would have accepted without complaint.
    async update(
      recordId: string,
      values: Record<string, unknown>,
      modes?: Record<string, 'set' | 'add' | 'remove'>,
      options?: Record<string, unknown>
    ) {
      h.updates.push({ recordId, values, bypass: this.bypass, modes, options })
      return { instance: { id: recordId }, recordId, values }
    }
  },
}))

import {
  AI_CATEGORY_PARENT_TAG,
  AI_CATEGORY_STARTER_TAGS,
  seedAiCategoryTags,
} from './ai-category-tags'

const ORG = 'org_1'
const TAG_DEF_ID = 'def_tag'

/** Chainable fake resolving the next queued result set per `await`. */
function makeDb(results: unknown[][]) {
  const queue = [...results]
  const updates: unknown[] = []
  const chain = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(queue.shift() ?? []).then(resolve, reject)
          }
          return () => chain()
        },
      }
    )
  const db = {
    select: () => chain(),
    update: (table: unknown) => {
      updates.push(table)
      return { set: () => ({ where: async () => undefined }) }
    },
    insert: (table: unknown) => {
      updates.push(table)
      return { values: async () => undefined }
    },
  }
  return { db: db as never, updates }
}

const TAG_DEF = [{ id: TAG_DEF_ID }]
const ELIGIBILITY_FIELD = [{ id: 'cf_ai_classify' }]

/** The three selects the seed makes: tag def, eligibility field, existing tag instances. */
function queue(existingTitles: { id: string; displayName: string }[] = []): unknown[][] {
  return [TAG_DEF, ELIGIBILITY_FIELD, existingTitles]
}

const titlesCreated = () => h.creates.map((c) => c.values.title)
const createdByTitle = (title: string) => h.creates.find((c) => c.values.title === title)?.values

beforeEach(() => {
  h.creates.length = 0
  h.constructorOptions.length = 0
  h.updates.length = 0
  h.createImpl = null
})

const SYSTEM_FIELD = [{ id: 'cf_is_system_tag' }]
/** The two selects `adoptLegacySystemStarter` makes per existing title. */
const ADOPT_PROBE = (isSystem: boolean) => [SYSTEM_FIELD, [{ valueBoolean: isSystem }]]

describe('AI_CATEGORY_STARTER_TAGS', () => {
  it('is exactly the five pinned categories, with no Spam', () => {
    expect(AI_CATEGORY_STARTER_TAGS.map((t) => t.title)).toEqual([
      'Sales',
      'Support',
      'Billing',
      'Newsletter',
      'Notification',
    ])
  })

  // The model reads these verbatim as the label's definition (C3). A bare title classifies
  // measurably worse, so an empty one is a silent quality regression.
  it('gives every category a real classifier instruction', () => {
    for (const tag of [AI_CATEGORY_PARENT_TAG, ...AI_CATEGORY_STARTER_TAGS]) {
      expect(tag.description.trim().length).toBeGreaterThan(40)
      expect(tag.emoji).toBeTruthy()
      expect(tag.color).toBeTruthy()
    }
  })
})

describe('seedAiCategoryTags', () => {
  it('creates the parent group and all five starters on a fresh org', async () => {
    const { db } = makeDb(queue())

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.created).toEqual([
      'Mail Categories',
      'Sales',
      'Support',
      'Billing',
      'Newsletter',
      'Notification',
    ])
    expect(result.skipped).toEqual([])
    expect(titlesCreated()).toHaveLength(6)
  })

  it('marks every starter eligible, ordinary, thread-scoped and parented', async () => {
    const { db } = makeDb(queue())

    await seedAiCategoryTags(db, ORG, 'user_1')

    const parentRecordId = `${TAG_DEF_ID}:inst_1`
    for (const tag of AI_CATEGORY_STARTER_TAGS) {
      expect(createdByTitle(tag.title)).toMatchObject({
        tag_ai_classify: true,
        // C4: system tags cannot be edited, and the description is the tuning surface.
        is_system_tag: false,
        tag_scope: 'thread',
        tag_parent: parentRecordId,
        tag_description: tag.description,
      })
    }
  })

  // A container the classifier could apply as a label is a bug, not a grouping.
  it('leaves the parent group itself ineligible', async () => {
    const { db } = makeDb(queue())

    await seedAiCategoryTags(db, ORG, 'user_1')

    expect(createdByTitle('Mail Categories')).toMatchObject({
      tag_ai_classify: false,
      is_system_tag: false,
      tag_scope: 'thread',
    })
    expect(createdByTitle('Mail Categories')).not.toHaveProperty('tag_parent')
  })

  // `is_system_tag` is `creatable: false` and its pre-hook drops unauthorized writes, so the
  // explicit `false` only lands with the bypass.
  it('writes is_system_tag through the scoped bypass', () => {
    const { db } = makeDb(queue())
    return seedAiCategoryTags(db, ORG, 'user_1').then(() => {
      expect(h.constructorOptions).toHaveLength(1)
      const options = h.constructorOptions[0] as { bypassFieldGuards: Set<string> }
      expect([...options.bypassFieldGuards]).toEqual(['is_system_tag'])
    })
  })

  it('is a no-op on a second pass — nothing is created twice', async () => {
    const existing = [
      { id: 'inst_parent', displayName: 'Mail Categories' },
      ...AI_CATEGORY_STARTER_TAGS.map((t, i) => ({ id: `inst_${i}`, displayName: t.title })),
    ]
    const { db, updates } = makeDb(queue(existing))

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(h.creates).toEqual([])
    expect(result.created).toEqual([])
    expect(result.skipped).toHaveLength(6)
    // Rule 5: no re-parenting, no description overwrite, no flag flip.
    expect(updates).toEqual([])
  })

  // The org already calls something `Billing`. It keeps its own — untouched — and gets no
  // duplicate: two tags with one name is worse than one imperfect one.
  it('skips a title the org already uses and never modifies it', async () => {
    const { db, updates } = makeDb(queue([{ id: 'inst_billing', displayName: 'Billing' }]))

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.skipped).toEqual(['Billing'])
    expect(titlesCreated()).not.toContain('Billing')
    expect(titlesCreated()).toContain('Sales')
    expect(updates).toEqual([])
  })

  // Re-uses the existing group rather than creating "Mail Categories" twice.
  it('parents new starters under an existing group', async () => {
    const { db } = makeDb(queue([{ id: 'inst_parent', displayName: 'Mail Categories' }]))

    await seedAiCategoryTags(db, ORG, 'user_1')

    expect(titlesCreated()).not.toContain('Mail Categories')
    expect(createdByTitle('Sales')).toMatchObject({ tag_parent: `${TAG_DEF_ID}:inst_parent` })
  })

  // Without the CustomField the flag would be dropped, the tags would look seeded, and every
  // later pass would skip them — an org with zero eligible labels and no error anywhere.
  it('seeds nothing when the tag_ai_classify field is missing', async () => {
    const { db } = makeDb([TAG_DEF, [], []])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(h.creates).toEqual([])
    expect(result).toEqual({ created: [], skipped: [], adopted: [] })
  })

  it('seeds nothing when the org has no tag entity', async () => {
    const { db } = makeDb([[], [], []])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(h.creates).toEqual([])
    expect(result).toEqual({ created: [], skipped: [], adopted: [] })
  })

  // Org creation must not fail because a starter tag did not land.
  it('never throws, and reports what did land when a write fails', async () => {
    const { db } = makeDb(queue())
    h.createImpl = (values) => {
      if (values.title === 'Billing') throw new Error('write failed')
    }

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.created).toEqual(['Mail Categories', 'Sales', 'Support'])
    expect(result.skipped).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ADOPTION — converting a legacy SYSTEM starter into a tunable one (§12.5.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// `seedTags` historically created Billing/Sales/Support as SYSTEM tags, which
// `rejectIfSystemTag` freezes — description included. Under C3 that description
// IS the classifier's instruction, so an org created before mail classification
// would carry three starters it could never tune, with no UI able to fix it.
//
// The discriminator is the FLAG, never the title: a user's own tag called
// `Sales` is theirs, and a title collision is not consent.

describe('seedAiCategoryTags — adopting legacy system starters', () => {
  const legacySales = [{ id: 'inst_sales', displayName: 'Sales' }]

  it('converts a legacy SYSTEM starter in place instead of skipping it', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.adopted).toEqual(['Sales'])
    expect(result.skipped).not.toContain('Sales')
    // Not recreated — the id is preserved, so every filter referencing it still resolves.
    expect(titlesCreated()).not.toContain('Sales')
  })

  it('unfreezes BEFORE writing the description, and only unfreezing gets the bypass', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    await seedAiCategoryTags(db, ORG, 'user_1')

    // Ordering is load-bearing: `rejectIfSystemTag` reads the CURRENT flag at hook
    // time, so clearing it first is what lets the description through with no
    // bypass. Both fields in one call would trip the guard on the description.
    expect(h.updates).toHaveLength(2)
    const [unfreeze, retune] = h.updates as [(typeof h.updates)[number], (typeof h.updates)[number]]
    expect(unfreeze.values).toEqual({ is_system_tag: false })
    expect(unfreeze.bypass).toEqual(['is_system_tag'])

    expect(retune.values).toMatchObject({ tag_ai_classify: true, tag_scope: 'thread' })
    expect(retune.values.tag_description).toBe(
      AI_CATEGORY_STARTER_TAGS.find((t) => t.title === 'Sales')?.description
    )
    // Options ride in the FOURTH arg; third is the array-mode map and must stay empty.
    for (const call of [unfreeze, retune]) {
      expect(call.modes).toBeUndefined()
      expect(call.options).toEqual({ skipEvents: true })
    }
    // The privilege is scoped to the one write that needs it — a bypass on the
    // retune would be a second hole for no reason.
    expect(retune.bypass).toEqual([])
  })

  it('sets tag_ai_classify, which is what stops migration 014 re-freezing it', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    await seedAiCategoryTags(db, ORG, 'user_1')

    // 014 flags by TITLE and is REPLAYED, not ledger-guarded. Its
    // `excludeAiClassifyTags` skips anything carrying this flag, so adoption
    // without it would silently undo itself on the next migration run.
    const retune = h.updates.find((u) => 'tag_ai_classify' in u.values)
    expect(retune?.values.tag_ai_classify).toBe(true)
  })

  it("leaves a USER's same-named tag completely alone", async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(false)])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.skipped).toContain('Sales')
    expect(result.adopted).toEqual([])
    // No unfreeze, no description overwrite, no eligibility flip. Someone else's
    // taxonomy that happens to share a word with ours.
    expect(h.updates).toEqual([])
  })

  it('still creates the starters the org does not have', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.created).toEqual([
      'Mail Categories',
      'Support',
      'Billing',
      'Newsletter',
      'Notification',
    ])
  })
})
