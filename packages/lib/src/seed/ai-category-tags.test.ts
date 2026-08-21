// packages/lib/src/seed/ai-category-tags.test.ts
//
// The starter mail categories are the vocabulary the classifier is given, so the shape of the
// seeded rows is the contract (plans/mail-filter/06-mail-categories-rework-plan.md §2):
//
//  1. **Core is four, packs are opt-in** (06 D3) — and `Newsletter`/`Notification` are gone as
//     labels (D2), because both are answerable from headers and `machineMailTier` and paying a
//     model to read a header is the anti-pattern 05 §3.1.1 was written against. No `Spam`
//     (05 C6), no catch-all (06 §2.4).
//  2. **Ordinary tags** (05 C4) — `is_system_tag: false` explicitly. A system tag's description
//     cannot be edited, and the description IS the classifier's instruction (05 C3), so seeding
//     these as system tags would freeze the feature's only tuning surface.
//  3. **Undeletable via `tag_template_key`, written only through the bypass** (06 invariant 2) —
//     a user who can set that field can make any tag of their own undeletable.
//  4. **Idempotent by title.** A second pass creates nothing. A title the org already uses is
//     left exactly as it is — UNLESS it is a legacy tag WE seeded as a system tag, which is
//     adopted in place. The discriminator is `is_system_tag`, never the title (06 invariant 5).
//  5. **Nothing becomes classifiable by accident** — the parent group is NOT eligible, and
//     seeding writes no inbox opt-in of any kind.
//  6. **The pre-rework descriptions survive as a constant** (06 §5.3) — data migration `076`
//     compares against them to tell "still our default" from "the customer tuned it".
//
// `UnifiedCrudHandler` is stubbed (a lib-internal module, not one of the shared
// `@auxx/database` / `@auxx/logger` / `drizzle-orm` mocks), so the assertions are about the
// values this module hands the write path.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type StubSession = { origin: { kind: string; reason?: string }; depth: number }

const h = vi.hoisted(() => ({
  creates: [] as { entityType: string; values: Record<string, unknown> }[],
  constructorOptions: [] as unknown[],
  createImpl: null as null | ((values: Record<string, unknown>) => void),
  /**
   * Every `update` in call order, each tagged with the bypass set AND the write
   * session its handler carried — suppression now rides the session, not a
   * per-call flag.
   */
  updates: [] as {
    recordId: string
    values: Record<string, unknown>
    bypass: string[]
    session?: { origin: { kind: string; reason?: string }; depth: number }
    modes?: Record<string, 'set' | 'add' | 'remove'>
    options?: Record<string, unknown>
  }[],
}))

vi.mock('../resources/crud', () => ({
  // Mirrors the real helper: a seed session's lane is 'silent', which is what
  // replaced the per-call `skipEvents: true`.
  seedSession: (reason: string) => ({ origin: { kind: 'seed', reason }, depth: 0 }),
  UnifiedCrudHandler: class {
    private bypass: string[]
    private session?: StubSession
    constructor(
      _orgId: string,
      _userId: string,
      _db: unknown,
      _socketId: unknown,
      options?: { bypassFieldGuards?: Set<string>; session?: StubSession }
    ) {
      h.constructorOptions.push(options)
      this.bypass = [...(options?.bypassFieldGuards ?? [])]
      this.session = options?.session
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
      h.updates.push({
        recordId,
        values,
        bypass: this.bypass,
        session: this.session,
        modes,
        options,
      })
      return { instance: { id: recordId }, recordId, values }
    }
  },
}))

import {
  AI_CATEGORY_COMMERCE_TAGS,
  AI_CATEGORY_CORE_TAGS,
  AI_CATEGORY_PARENT_TAG,
  AI_CATEGORY_PARENT_TEMPLATE_KEY,
  AI_CATEGORY_PARTNER_TAGS,
  AI_CATEGORY_STARTER_TAGS,
  aiCategoryTagsForPacks,
  LEGACY_STARTER_DESCRIPTIONS,
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
/** One select covers all three guarded attributes — see the comment on `fieldIdByAttribute`. */
const FIELDS = [
  { id: 'cf_ai_classify', systemAttribute: 'tag_ai_classify' },
  { id: 'cf_template_key', systemAttribute: 'tag_template_key' },
  { id: 'cf_is_system_tag', systemAttribute: 'is_system_tag' },
]

/** The three selects the seed makes: tag def, guarded fields, existing tag instances. */
function queue(existingTitles: { id: string; displayName: string }[] = []): unknown[][] {
  return [TAG_DEF, FIELDS, existingTitles]
}

const titlesCreated = () => h.creates.map((c) => c.values.title)
const createdByTitle = (title: string) => h.creates.find((c) => c.values.title === title)?.values

beforeEach(() => {
  h.creates.length = 0
  h.constructorOptions.length = 0
  h.updates.length = 0
  h.createImpl = null
})

/** The single select `adoptLegacySystemStarter` makes per existing title. */
const ADOPT_PROBE = (isSystem: boolean) => [[{ valueBoolean: isSystem }]]

const ALL_PACKS = ['commerce', 'partner'] as const

describe('the taxonomy', () => {
  it('is core four, commerce two, partner one — and nothing else', () => {
    expect(AI_CATEGORY_CORE_TAGS.map((t) => t.title)).toEqual([
      'Sales',
      'Support',
      'Billing',
      'Account',
    ])
    expect(AI_CATEGORY_COMMERCE_TAGS.map((t) => t.title)).toEqual([
      'Order Status',
      'Returns & Refunds',
    ])
    expect(AI_CATEGORY_PARTNER_TAGS.map((t) => t.title)).toEqual(['Partners & Dealers'])
  })

  // D2: both are answerable from `machineMailTier` and `List-Unsubscribe` for free. They ship
  // as seeded FILTERS now; an inference to conclude "this is a notification" is the exact
  // anti-pattern 05 §3.1.1 rejects.
  it('has retired Newsletter and Notification as labels', () => {
    const titles = AI_CATEGORY_STARTER_TAGS.map((t) => t.title)
    expect(titles).not.toContain('Newsletter')
    expect(titles).not.toContain('Notification')
  })

  // 05 C6 + 06 §2.4: `set-status: SPAM` and `MAIL_CLASSIFY_NO_CATEGORY` already exist, and a
  // catch-all label would be reached for INSTEAD of abstaining.
  it('has no Spam and no catch-all', () => {
    const titles = AI_CATEGORY_STARTER_TAGS.map((t) => t.title)
    for (const banned of ['Spam', 'Other', 'General', 'Uncategorized']) {
      expect(titles).not.toContain(banned)
    }
  })

  // 06 Q10: the revisit trigger is ~10 ELIGIBLE leaves, and one further pack reaches it.
  it('stays under the ~10-leaf revisit trigger', () => {
    expect(AI_CATEGORY_STARTER_TAGS).toHaveLength(7)
  })

  // The model reads these verbatim as the label's definition (05 C3). A bare title classifies
  // measurably worse, so an empty one is a silent quality regression.
  it('gives every category a real classifier instruction', () => {
    for (const tag of [AI_CATEGORY_PARENT_TAG, ...AI_CATEGORY_STARTER_TAGS]) {
      expect(tag.description.trim().length).toBeGreaterThan(40)
      expect(tag.emoji).toBeTruthy()
      expect(tag.color).toBeTruthy()
    }
  })

  // ⚠️ Returns & Refunds overlaps Billing by design, so the precedence has to live IN the two
  // descriptions — one label per message means the model has nowhere else to read it from.
  it('spells out the Returns-vs-Billing precedence in the descriptions themselves', () => {
    const returns = AI_CATEGORY_COMMERCE_TAGS.find((t) => t.title === 'Returns & Refunds')
    const billing = AI_CATEGORY_CORE_TAGS.find((t) => t.title === 'Billing')
    expect(returns?.description).toMatch(/completed purchase/i)
    expect(billing?.description).toMatch(/money owed or paid/i)
  })

  // The template key is the identity "reset to default" and the undeletable guard resolve on.
  // A duplicate would make two categories indistinguishable to both.
  it('gives every category a unique, stable template key', () => {
    const keys = AI_CATEGORY_STARTER_TAGS.map((t) => t.templateKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^category:[a-z0-9-]+$/)
    expect(keys).toEqual([
      'category:sales',
      'category:support',
      'category:billing',
      'category:account',
      'category:order-status',
      'category:returns-refunds',
      'category:partners-dealers',
    ])
  })

  // The container carries a key too (so it cannot be deleted out from under its children), but
  // it is deliberately not one of the category keys — anything enumerating shipped CATEGORIES
  // excludes it by identity rather than by title.
  it('keeps the container’s key out of the category keyspace', () => {
    expect(AI_CATEGORY_PARENT_TAG.templateKey).toBe(AI_CATEGORY_PARENT_TEMPLATE_KEY)
    expect(AI_CATEGORY_STARTER_TAGS.map((t) => t.templateKey)).not.toContain(
      AI_CATEGORY_PARENT_TEMPLATE_KEY
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY DESCRIPTIONS — the input to migration 076's never-clobber rule (§5.3)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ These literals are duplicated here ON PURPOSE. The constant is the only
// record of what the five pre-rework starters shipped with, and migration 076
// overwrites a description ONLY when it is empty or byte-identical to one of
// them. Reformat, re-wrap or "tidy" a string in the source and the migration
// silently starts classifying an untouched default as a customer edit (leaving
// stale prompt text forever) — or, if someone loosens the comparison to
// compensate, clobbers real customer tuning that cannot be recovered.

describe('LEGACY_STARTER_DESCRIPTIONS', () => {
  it('is frozen and holds exactly the five pre-rework titles', () => {
    expect(Object.isFrozen(LEGACY_STARTER_DESCRIPTIONS)).toBe(true)
    expect(Object.keys(LEGACY_STARTER_DESCRIPTIONS)).toEqual([
      'Sales',
      'Support',
      'Billing',
      'Newsletter',
      'Notification',
    ])
  })

  it('preserves each shipped default byte for byte', () => {
    expect(LEGACY_STARTER_DESCRIPTIONS.Sales).toBe(
      'A prospective or existing customer with buying intent: pricing, quotes, plans, stock or availability, product fit, a demo, or expanding an existing order. Pre-purchase interest, not a problem with something already bought.'
    )
    expect(LEGACY_STARTER_DESCRIPTIONS.Support).toBe(
      'The sender needs help with something they already have: a fault, an error, a how-to question, a delivery or order-status chase, a return or a complaint. Something is broken, missing, or not understood.'
    )
    expect(LEGACY_STARTER_DESCRIPTIONS.Billing).toBe(
      'Anything about money owed or paid: invoices, charges, refunds, payment methods, subscription or plan fees, failed payments, dunning, receipts and tax documents.'
    )
    expect(LEGACY_STARTER_DESCRIPTIONS.Newsletter).toBe(
      'Bulk marketing or editorial mail broadcast to a list — product news, promotions, offers, digests, event invitations. Written for many recipients rather than for us, and needs no reply.'
    )
    expect(LEGACY_STARTER_DESCRIPTIONS.Notification).toBe(
      'Automated machine mail generated by a system rather than written by a person: service alerts, account and security notices, monitoring or build results, calendar and shipping updates, confirmations of an automated action. If it is about money owed or paid, prefer Billing; if it is bulk marketing, prefer Newsletter.'
    )
  })

  // If a new description equalled the legacy one there would be nothing to migrate for that
  // label — and the assertion above would be the only thing left proving the constant is real.
  it('differs from the shipped text for every surviving title', () => {
    for (const title of ['Sales', 'Support', 'Billing']) {
      const current = AI_CATEGORY_CORE_TAGS.find((t) => t.title === title)
      expect(current).toBeDefined()
      expect(current?.description).not.toBe(LEGACY_STARTER_DESCRIPTIONS[title])
    }
  })
})

describe('aiCategoryTagsForPacks', () => {
  // 06 Q3: pack selection is the CALLER's to infer (Shopify → commerce). Assuming it here would
  // push two extra labels into every org's prompt — 06 invariant 12.
  it('is core-only by default', () => {
    expect(aiCategoryTagsForPacks().map((t) => t.title)).toEqual([
      'Sales',
      'Support',
      'Billing',
      'Account',
    ])
  })

  it('adds only the packs asked for', () => {
    expect(aiCategoryTagsForPacks(['commerce']).map((t) => t.title)).toEqual([
      'Sales',
      'Support',
      'Billing',
      'Account',
      'Order Status',
      'Returns & Refunds',
    ])
    expect(aiCategoryTagsForPacks(['partner']).map((t) => t.title)).toContain('Partners & Dealers')
    expect(aiCategoryTagsForPacks(['partner']).map((t) => t.title)).not.toContain('Order Status')
  })

  it('is unaffected by duplicates or a redundant core request', () => {
    expect(aiCategoryTagsForPacks(['commerce', 'commerce', 'core'])).toEqual(
      aiCategoryTagsForPacks(['commerce'])
    )
  })

  it('returns the whole taxonomy when every pack is on', () => {
    expect(aiCategoryTagsForPacks(ALL_PACKS)).toEqual(AI_CATEGORY_STARTER_TAGS)
  })
})

describe('seedAiCategoryTags', () => {
  it('creates the parent group and the four core categories on a fresh org', async () => {
    const { db } = makeDb(queue())

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.created).toEqual(['Mail Categories', 'Sales', 'Support', 'Billing', 'Account'])
    expect(result.skipped).toEqual([])
    expect(titlesCreated()).toHaveLength(5)
  })

  it('seeds the pack categories when the caller opts in', async () => {
    const { db } = makeDb(queue())

    const result = await seedAiCategoryTags(db, ORG, 'user_1', { packs: ALL_PACKS })

    expect(result.created).toEqual([
      'Mail Categories',
      'Sales',
      'Support',
      'Billing',
      'Account',
      'Order Status',
      'Returns & Refunds',
      'Partners & Dealers',
    ])
  })

  it('marks every category eligible, ordinary, thread-scoped, parented and template-keyed', async () => {
    const { db } = makeDb(queue())

    await seedAiCategoryTags(db, ORG, 'user_1', { packs: ALL_PACKS })

    const parentRecordId = `${TAG_DEF_ID}:inst_1`
    for (const tag of AI_CATEGORY_STARTER_TAGS) {
      expect(createdByTitle(tag.title)).toMatchObject({
        tag_ai_classify: true,
        // 05 C4 / 06 D5: system tags cannot be edited, and the description is the tuning surface.
        is_system_tag: false,
        // 06 D4: undeletable and resettable, without freezing anything.
        tag_template_key: tag.templateKey,
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
      tag_template_key: AI_CATEGORY_PARENT_TEMPLATE_KEY,
      tag_scope: 'thread',
    })
    expect(createdByTitle('Mail Categories')).not.toHaveProperty('tag_parent')
  })

  // Both fields are `creatable: false` and their pre-hooks drop unauthorized writes, so these
  // values only land with the bypass. ⚠️ A user who can write `tag_template_key` can make any
  // tag of their own undeletable (06 invariant 2) — the bypass is the whole enforcement.
  it('writes the guarded fields through one scoped bypass', () => {
    const { db } = makeDb(queue())
    return seedAiCategoryTags(db, ORG, 'user_1').then(() => {
      expect(h.constructorOptions).toHaveLength(1)
      const options = h.constructorOptions[0] as {
        bypassFieldGuards: Set<string>
        session?: StubSession
      }
      expect([...options.bypassFieldGuards].sort()).toEqual(['is_system_tag', 'tag_template_key'])
      // The handler is constructed under a seed session — the silent lane that
      // replaced the per-call `skipEvents: true`.
      expect(options.session).toEqual({
        origin: { kind: 'seed', reason: 'ai category tag seeding' },
        depth: 0,
      })
    })
  })

  it('is a no-op on a second pass — nothing is created twice', async () => {
    const existing = [
      { id: 'inst_parent', displayName: 'Mail Categories' },
      ...AI_CATEGORY_STARTER_TAGS.map((t, i) => ({ id: `inst_${i}`, displayName: t.title })),
    ]
    const { db, updates } = makeDb([
      ...queue(existing),
      // Each existing starter is probed once; none of them is a system tag.
      ...AI_CATEGORY_STARTER_TAGS.flatMap(() => ADOPT_PROBE(false)),
    ])

    const result = await seedAiCategoryTags(db, ORG, 'user_1', { packs: ALL_PACKS })

    expect(h.creates).toEqual([])
    expect(result.created).toEqual([])
    expect(result.skipped).toHaveLength(8)
    // Rule 6: no re-parenting, no description overwrite, no flag flip.
    expect(updates).toEqual([])
    expect(h.updates).toEqual([])
  })

  // The org already calls something `Billing`. It keeps its own — untouched — and gets no
  // duplicate: two tags with one name is worse than one imperfect one.
  it('skips a title the org already uses and never modifies it', async () => {
    const { db, updates } = makeDb([
      ...queue([{ id: 'inst_billing', displayName: 'Billing' }]),
      ...ADOPT_PROBE(false),
    ])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.skipped).toEqual(['Billing'])
    expect(titlesCreated()).not.toContain('Billing')
    expect(titlesCreated()).toContain('Sales')
    expect(updates).toEqual([])
    expect(h.updates).toEqual([])
  })

  // Re-uses the existing group rather than creating "Mail Categories" twice.
  it('parents new categories under an existing group', async () => {
    const { db } = makeDb(queue([{ id: 'inst_parent', displayName: 'Mail Categories' }]))

    await seedAiCategoryTags(db, ORG, 'user_1')

    expect(titlesCreated()).not.toContain('Mail Categories')
    expect(createdByTitle('Sales')).toMatchObject({ tag_parent: `${TAG_DEF_ID}:inst_parent` })
  })

  // Without the CustomField the flag would be dropped, the tags would look seeded, and every
  // later pass would skip them — an org with zero eligible labels and no error anywhere.
  it('seeds nothing when the tag_ai_classify field is missing', async () => {
    const { db } = makeDb([
      TAG_DEF,
      FIELDS.filter((f) => f.systemAttribute !== 'tag_ai_classify'),
      [],
    ])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(h.creates).toEqual([])
    expect(result).toEqual({ created: [], skipped: [], adopted: [] })
  })

  // Same failure shape for the newer field (entity migration 075): categories written without a
  // template key would be deletable, unresettable, and invisible to migration 076 — while
  // looking seeded, so no later pass would ever fix them.
  it('seeds nothing when the tag_template_key field is missing', async () => {
    const { db } = makeDb([
      TAG_DEF,
      FIELDS.filter((f) => f.systemAttribute !== 'tag_template_key'),
      [],
    ])

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
// ADOPTION — converting a legacy SYSTEM starter into a tunable one
// ═══════════════════════════════════════════════════════════════════════════
//
// `seedTags` historically created Billing/Sales/Support as SYSTEM tags, which
// `rejectIfSystemTag` freezes — description included. Under 05 C3 that
// description IS the classifier's instruction, so an org created before mail
// classification would carry starters it could never tune, with no UI able to
// fix it.
//
// The discriminator is the FLAG, never the title: a user's own tag called
// `Sales` is theirs, and a title collision is not consent (06 invariant 5).
//
// Adoption never renames. `Orders` → `Order Status` and `Account Management` →
// `Account` are data migration 076's job (06 §5.1 step 3).

describe('seedAiCategoryTags — adopting legacy system starters', () => {
  const legacySales = [{ id: 'inst_sales', displayName: 'Sales' }]

  it('converts a legacy SYSTEM starter in place instead of skipping it', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.adopted).toEqual(['Sales'])
    expect(result.skipped).not.toContain('Sales')
    // Not recreated — the id is preserved, so every filter referencing it still resolves
    // (06 invariant 3).
    expect(titlesCreated()).not.toContain('Sales')
  })

  it('unfreezes BEFORE writing the description, in its own write', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    await seedAiCategoryTags(db, ORG, 'user_1')

    // Ordering is load-bearing (06 invariant 4): `rejectIfSystemTag` reads the
    // CURRENT flag at hook time, so clearing it first is what lets the
    // description through. Both fields in one call would trip the guard.
    expect(h.updates).toHaveLength(2)
    const [unfreeze, retune] = h.updates as [(typeof h.updates)[number], (typeof h.updates)[number]]
    expect(unfreeze.values).toEqual({ is_system_tag: false })
    expect(unfreeze.bypass).toEqual(['is_system_tag'])

    expect(retune.values).toMatchObject({ tag_ai_classify: true, tag_scope: 'thread' })
    expect(retune.values.tag_description).toBe(
      AI_CATEGORY_CORE_TAGS.find((t) => t.title === 'Sales')?.description
    )
    // Suppression rides the handler's seed session now — no per-call flags at
    // all: the array-mode map stays empty and no options object is passed.
    for (const call of [unfreeze, retune]) {
      expect(call.modes).toBeUndefined()
      expect(call.options).toBeUndefined()
      expect(call.session).toEqual({
        origin: { kind: 'seed', reason: 'ai category tag seeding' },
        depth: 0,
      })
    }
  })

  // The retune needs a bypass only because `tag_template_key` is `updatable: false`. Re-granting
  // `is_system_tag` there would reopen the exact hole the two-write split closes — the
  // description would then pass the guard without the flag ever having been cleared.
  it('scopes the retune bypass to tag_template_key alone', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    await seedAiCategoryTags(db, ORG, 'user_1')

    const retune = h.updates[1]
    expect(retune?.bypass).toEqual(['tag_template_key'])
    expect(retune?.values.tag_template_key).toBe('category:sales')
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

  // No `is_system_tag` field at all (an org predating it) means nothing can be proven ours, and
  // "unprovable" must read as the user's — never as consent.
  it('leaves everything alone when the is_system_tag field does not exist', async () => {
    const { db } = makeDb([
      TAG_DEF,
      FIELDS.filter((f) => f.systemAttribute !== 'is_system_tag'),
      legacySales,
    ])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.skipped).toContain('Sales')
    expect(result.adopted).toEqual([])
    expect(h.updates).toEqual([])
  })

  it('still creates the categories the org does not have', async () => {
    const { db } = makeDb([...queue(legacySales), ...ADOPT_PROBE(true)])

    const result = await seedAiCategoryTags(db, ORG, 'user_1')

    expect(result.created).toEqual(['Mail Categories', 'Support', 'Billing', 'Account'])
  })
})
