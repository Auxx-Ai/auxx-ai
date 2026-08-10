// packages/lib/src/data-migrations/migrations/076-mail-category-rework.test.ts
//
// Migration 076 is the only DESTRUCTIVE step of the mail-category rework
// (plan 06 §8), so its tests are about the five things the plan marks ⚠️:
//
//  1. a tuned description is never overwritten (§5.3, invariant 6);
//  2. the unfreeze is its own write and lands FIRST (invariant 4);
//  3. the discriminator is `is_system_tag`, never the title (invariant 5);
//  4. ids are preserved — adopt and rename, never delete-and-recreate
//     (invariant 3);
//  5. every step is idempotent on its own terms, because the migration is
//     REPLAYED if it is invoked through the entity-migration runner
//     (05 §12.2).
//
// `UnifiedCrudHandler`, the seeder, the org cache and the system-user lookup are
// stubbed (all lib-internal modules, not the shared `@auxx/database` /
// `@auxx/logger` / `drizzle-orm` mocks), so the assertions are about the values
// and the ORDER this migration hands the write path.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `update`/`delete`, in call order, tagged with its handler's bypass. */
  calls: [] as {
    op: 'update' | 'delete'
    recordId: string
    values?: Record<string, unknown>
    bypass: string[]
    modes?: Record<string, 'set' | 'add' | 'remove'>
    options?: Record<string, unknown>
  }[],
  seedCalls: [] as { organizationId: string; options?: { packs?: readonly string[] } }[],
  seedResult: { created: [] as string[], skipped: [] as string[], adopted: [] as string[] },
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    private bypass: string[]
    constructor(
      _orgId: string,
      _userId: string,
      _db: unknown,
      _socketId?: unknown,
      options?: { bypassFieldGuards?: Set<string> }
    ) {
      this.bypass = [...(options?.bypassFieldGuards ?? [])]
    }
    // Mirrors the REAL signature — (recordId, values, MODES, options). A loose
    // (recordId, values) stub would accept `SEED_OPTS` silently landing in the
    // array-mode map.
    async update(
      recordId: string,
      values: Record<string, unknown>,
      modes?: Record<string, 'set' | 'add' | 'remove'>,
      options?: Record<string, unknown>
    ) {
      h.calls.push({ op: 'update', recordId, values, bypass: this.bypass, modes, options })
      return { instance: { id: recordId }, recordId, values }
    }
    async delete(recordId: string, options?: Record<string, unknown>) {
      h.calls.push({ op: 'delete', recordId, bypass: this.bypass, options })
    }
  },
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ invalidateAndRecompute: async () => undefined }),
}))

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'user_system' },
}))

vi.mock('../../seed/ai-category-tags', async (importOriginal) => {
  // Partial mock: the taxonomy constants ARE the contract under test (the
  // never-clobber rule compares against `LEGACY_STARTER_DESCRIPTIONS`), so only
  // the write function is replaced.
  const actual = await importOriginal<typeof import('../../seed/ai-category-tags')>()
  return {
    ...actual,
    seedAiCategoryTags: async (
      _db: unknown,
      organizationId: string,
      _userId: string,
      options?: { packs?: readonly string[] }
    ) => {
      h.seedCalls.push({ organizationId, options })
      return { ...h.seedResult }
    },
  }
})

import {
  AI_CATEGORY_CORE_TAGS,
  AI_CATEGORY_PARENT_TAG,
  AI_CATEGORY_PARENT_TEMPLATE_KEY,
  AI_CATEGORY_STARTER_TAGS,
  LEGACY_STARTER_DESCRIPTIONS,
} from '../../seed/ai-category-tags'
import {
  findCategoryContainer,
  inferAiCategoryPacks,
  isSeededCategory,
  LEGACY_PARENT_TITLE,
  LEGACY_SYSTEM_ADOPTIONS,
  LEGACY_SYSTEM_TAG_TITLES,
  migrateOrganizationTaxonomy,
  migration076MailCategoryRework,
  PRESERVED_SYSTEM_TAG_TITLES,
  planDescriptionWrite,
  planStarterPatch,
  RETIRED_LABEL_TITLES,
  RETIRED_SYSTEM_TAG_TITLES,
  type TagCensusRow,
} from './076-mail-category-rework'

const ORG = 'org_1'
const TAG_DEF_ID = 'def_tag'

const seedFor = (title: string) => {
  const seed = AI_CATEGORY_STARTER_TAGS.find((t) => t.title === title)
  if (!seed) throw new Error(`no seed for ${title}`)
  return seed
}

function row(overrides: Partial<TagCensusRow> & { id: string; title: string }): TagCensusRow {
  return {
    isSystemTag: false,
    templateKey: null,
    description: null,
    parentId: null,
    aiClassify: false,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE CORE
// ═══════════════════════════════════════════════════════════════════════════

// ⚠️ Invariant 6, "the unrecoverable one". The description is the classifier's
// instruction and the one field this whole plan exists to make the business's.
describe('planDescriptionWrite — the never-clobber rule (§5.3)', () => {
  const target = seedFor('Sales').description
  /** The exact string the pre-rework `Sales` starter shipped with. */
  const legacySales = LEGACY_STARTER_DESCRIPTIONS.Sales as string

  it('writes over the PREVIOUSLY shipped default', () => {
    expect(planDescriptionWrite(legacySales, target)).toBe('write')
  })

  it('writes into an empty or whitespace-only description', () => {
    expect(planDescriptionWrite(null, target)).toBe('write')
    expect(planDescriptionWrite(undefined, target)).toBe('write')
    expect(planDescriptionWrite('', target)).toBe('write')
    expect(planDescriptionWrite('   \n ', target)).toBe('write')
  })

  it('leaves a tuned description alone', () => {
    expect(planDescriptionWrite('Only enquiries from our EU resellers.', target)).toBe(
      'user-edited'
    )
  })

  // The comparison is byte-identical on purpose. A trailing space is a keystroke
  // someone made; treating it as "still our default" is how real tuning is lost.
  it('treats a near-miss as an edit, never as our default', () => {
    expect(planDescriptionWrite(`${legacySales} `, target)).toBe('user-edited')
    expect(planDescriptionWrite(legacySales.toLowerCase(), target)).toBe('user-edited')
  })

  // The replay case: already migrated, so there is nothing to write at all.
  it('reports unchanged when the value is already the target', () => {
    expect(planDescriptionWrite(target, target)).toBe('unchanged')
  })

  // A description seeded for a DIFFERENT label is still ours — an org that
  // renamed a category (or 076 mid-run) must not have it read as a user edit.
  it('recognises every shipped default, not just this label’s', () => {
    expect(planDescriptionWrite(LEGACY_STARTER_DESCRIPTIONS.Notification, target)).toBe('write')
    expect(planDescriptionWrite(seedFor('Billing').description, target)).toBe('write')
    expect(planDescriptionWrite(AI_CATEGORY_PARENT_TAG.description, target)).toBe('write')
  })
})

describe('inferAiCategoryPacks — Q3’s recommendation (§5.4)', () => {
  it('turns commerce on for a Shopify org', () => {
    expect(inferAiCategoryPacks({ hasShopify: true })).toEqual(['commerce'])
  })

  it('defaults everything off otherwise', () => {
    expect(inferAiCategoryPacks({ hasShopify: false })).toEqual([])
  })

  // Nothing in the data distinguishes a dealer network, and every extra label is
  // a silent accuracy tax on every classification (invariant 10).
  it('never infers the partner pack', () => {
    expect(inferAiCategoryPacks({ hasShopify: true })).not.toContain('partner')
  })
})

describe('findCategoryContainer', () => {
  it('finds it by template key first', () => {
    const container = row({
      id: 'c1',
      title: 'Anything At All',
      templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY,
    })
    expect(findCategoryContainer([container])?.id).toBe('c1')
  })

  it('finds a pre-rework container by its shipped description', () => {
    const container = row({
      id: 'c1',
      title: AI_CATEGORY_PARENT_TAG.title,
      description: AI_CATEGORY_PARENT_TAG.description,
    })
    expect(findCategoryContainer([container])?.id).toBe('c1')
  })

  it('finds one by the categories hanging under it', () => {
    const container = row({ id: 'c1', title: AI_CATEGORY_PARENT_TAG.title })
    const child = row({ id: 't1', title: 'Billing', parentId: 'c1' })
    expect(findCategoryContainer([container, child])?.id).toBe('c1')
  })

  // ⚠️ Invariant 5. Stamping a user's own group with the container's template key
  // would make it permanently undeletable.
  it('refuses a same-named group with nothing proving it is ours', () => {
    const impostor = row({
      id: 'c1',
      title: AI_CATEGORY_PARENT_TAG.title,
      description: 'my own grouping',
    })
    const unrelated = row({ id: 't1', title: 'Warranty Claims', parentId: 'c1' })
    expect(findCategoryContainer([impostor, unrelated])).toBeNull()
  })

  it('never adopts a SYSTEM tag as the container', () => {
    const systemGroup = row({
      id: 'c1',
      title: AI_CATEGORY_PARENT_TAG.title,
      description: AI_CATEGORY_PARENT_TAG.description,
      isSystemTag: true,
    })
    expect(findCategoryContainer([systemGroup])).toBeNull()
  })
})

describe('isSeededCategory', () => {
  it('accepts a tag already carrying a template key', () => {
    expect(
      isSeededCategory(row({ id: 't1', title: 'Sales', templateKey: 'category:sales' }), null)
    ).toBe(true)
  })

  it('accepts a tag parented under our container', () => {
    expect(isSeededCategory(row({ id: 't1', title: 'Sales', parentId: 'c1' }), 'c1')).toBe(true)
  })

  it('accepts a tag still carrying a description we shipped', () => {
    expect(
      isSeededCategory(
        row({ id: 't1', title: 'Sales', description: LEGACY_STARTER_DESCRIPTIONS.Sales }),
        null
      )
    ).toBe(true)
  })

  // ⚠️ Invariant 5 — a title collision is not consent.
  it('rejects a user’s own same-named tag', () => {
    expect(
      isSeededCategory(row({ id: 't1', title: 'Sales', description: 'leads from the show' }), 'c1')
    ).toBe(false)
  })

  // A system tag goes down the adopt path, which unfreezes FIRST. Treating it as
  // ours here would send a description write at a frozen tag and be rejected.
  it('never claims a system tag', () => {
    expect(
      isSeededCategory(row({ id: 't1', title: 'Sales', isSystemTag: true, parentId: 'c1' }), 'c1')
    ).toBe(false)
  })
})

describe('planStarterPatch', () => {
  const seed = seedFor('Sales')

  it('stamps the key and rewrites an untouched legacy description', () => {
    const patch = planStarterPatch(
      row({ id: 't1', title: 'Sales', description: LEGACY_STARTER_DESCRIPTIONS.Sales }),
      seed
    )
    expect(patch).toEqual({
      tag_template_key: 'category:sales',
      tag_description: seed.description,
    })
  })

  it('stamps the key but keeps a tuned description', () => {
    const patch = planStarterPatch(
      row({ id: 't1', title: 'Sales', description: 'our own wording' }),
      seed
    )
    expect(patch).toEqual({ tag_template_key: 'category:sales' })
  })

  // ⚠️ Step 2 stamps the key and the description, nothing else. An org that
  // switched a category off made a routing decision; flipping it back on would
  // be the migration re-enabling inference nobody asked for.
  it('never touches tag_ai_classify', () => {
    const patch = planStarterPatch(
      row({ id: 't1', title: 'Sales', aiClassify: false, description: '' }),
      seed
    )
    expect(patch).not.toHaveProperty('tag_ai_classify')
  })

  // Replay: nothing left to do, so no write is issued at all.
  it('returns null once the row is already settled', () => {
    expect(
      planStarterPatch(
        row({
          id: 't1',
          title: 'Sales',
          templateKey: 'category:sales',
          description: seed.description,
        }),
        seed
      )
    ).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE TARGET STATE — the 13 legacy system tags are accounted for, exhaustively
// ═══════════════════════════════════════════════════════════════════════════

describe('the legacy taxonomy is fully partitioned (D6)', () => {
  it('assigns every one of the 13 legacy system tags a fate', () => {
    const adopted = LEGACY_SYSTEM_ADOPTIONS.map((a) => a.from)
    const starters = AI_CATEGORY_CORE_TAGS.map((t) => t.title)
    const accounted = new Set([
      ...adopted,
      ...RETIRED_SYSTEM_TAG_TITLES,
      ...PRESERVED_SYSTEM_TAG_TITLES,
      ...starters,
      LEGACY_PARENT_TITLE,
    ])
    const orphans = LEGACY_SYSTEM_TAG_TITLES.filter((title) => !accounted.has(title))
    expect(orphans).toEqual([])
  })

  // ⚠️ Invariant 8. Priority and segment are not intents, and an eligible `VIP`
  // would let classification guard exit 6 suppress categorisation on any thread
  // a filter marked VIP.
  it('leaves Urgent and VIP out of every mutating list', () => {
    for (const title of PRESERVED_SYSTEM_TAG_TITLES) {
      expect(RETIRED_SYSTEM_TAG_TITLES).not.toContain(title)
      expect(RETIRED_LABEL_TITLES).not.toContain(title)
      expect(LEGACY_SYSTEM_ADOPTIONS.map((a) => a.from)).not.toContain(title)
      expect(AI_CATEGORY_STARTER_TAGS.map((t) => t.title)).not.toContain(title)
    }
  })

  // The adoption target is named by template key, so a rename in the taxonomy
  // propagates instead of silently un-adopting the legacy tag.
  it('resolves both adoptions against the live taxonomy', () => {
    const keys = AI_CATEGORY_STARTER_TAGS.map((t) => t.templateKey)
    for (const adoption of LEGACY_SYSTEM_ADOPTIONS) {
      expect(keys).toContain(adoption.templateKey)
    }
    expect(LEGACY_SYSTEM_ADOPTIONS.map((a) => a.from)).toEqual(['Orders', 'Account Management'])
  })

  // D2: both are answerable from headers for free, and they ship as seeded
  // filters now — so they must be gone from the label taxonomy AND cleared on
  // existing orgs.
  it('retires Newsletter and Notification as labels only', () => {
    expect([...RETIRED_LABEL_TITLES]).toEqual(['Newsletter', 'Notification'])
    for (const title of RETIRED_LABEL_TITLES) {
      expect(AI_CATEGORY_STARTER_TAGS.map((t) => t.title)).not.toContain(title)
      // Not deleted, not unflagged as a system tag — they were never system tags.
      expect(RETIRED_SYSTEM_TAG_TITLES).not.toContain(title)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE MIGRATION — order of writes, bypass scoping, idempotency
// ═══════════════════════════════════════════════════════════════════════════

/** Chainable fake resolving the next queued result set per `await`. */
function makeDb(results: unknown[][]) {
  const queue = [...results]
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
  return { select: () => chain() } as never
}

const TAG_DEF = [{ id: TAG_DEF_ID }]
const FIELDS = [
  { id: 'cf_title', systemAttribute: 'title' },
  { id: 'cf_description', systemAttribute: 'tag_description' },
  { id: 'cf_is_system_tag', systemAttribute: 'is_system_tag' },
  { id: 'cf_template_key', systemAttribute: 'tag_template_key' },
  { id: 'cf_ai_classify', systemAttribute: 'tag_ai_classify' },
  { id: 'cf_parent', systemAttribute: 'tag_parent' },
]

/** One tag as the census reads it: an instance row plus its FieldValue rows. */
interface FakeTag {
  id: string
  title: string
  isSystemTag?: boolean
  templateKey?: string | null
  description?: string | null
  parentId?: string | null
  aiClassify?: boolean
}

function instancesOf(tags: FakeTag[]) {
  return tags.map((t) => ({ id: t.id, displayName: t.title }))
}

function valuesOf(tags: FakeTag[]) {
  const out: Record<string, unknown>[] = []
  for (const t of tags) {
    out.push({ entityId: t.id, fieldId: 'cf_title', valueText: t.title })
    if (t.description !== undefined) {
      out.push({ entityId: t.id, fieldId: 'cf_description', valueText: t.description })
    }
    if (t.isSystemTag !== undefined) {
      out.push({ entityId: t.id, fieldId: 'cf_is_system_tag', valueBoolean: t.isSystemTag })
    }
    if (t.templateKey !== undefined) {
      out.push({ entityId: t.id, fieldId: 'cf_template_key', valueText: t.templateKey })
    }
    if (t.aiClassify !== undefined) {
      out.push({ entityId: t.id, fieldId: 'cf_ai_classify', valueBoolean: t.aiClassify })
    }
    if (t.parentId !== undefined) {
      out.push({ entityId: t.id, fieldId: 'cf_parent', relatedEntityId: t.parentId })
    }
  }
  return out
}

/**
 * The queue for one `migrateOrganizationTaxonomy` pass:
 * tag def · fields · instances · values · the Shopify probe · then the step-6
 * re-read (instances · values).
 *
 * The probe short-circuits: an `Integration` hit skips the app-installation
 * query entirely, so a Shopify org consumes ONE slot here and a non-Shopify org
 * consumes two. Getting that wrong silently shifts every later result set.
 */
function queue(before: FakeTag[], after: FakeTag[] = before, shopify = false): unknown[][] {
  return [
    TAG_DEF,
    FIELDS,
    instancesOf(before),
    valuesOf(before),
    ...(shopify ? [[{ id: 'int_1' }]] : [[], []]),
    instancesOf(after),
    valuesOf(after),
  ]
}

const updatesOf = (values: string) => h.calls.filter((c) => c.values && values in c.values)

beforeEach(() => {
  h.calls.length = 0
  h.seedCalls.length = 0
  h.seedResult = { created: [], skipped: [], adopted: [] }
})

describe('migrateOrganizationTaxonomy — prerequisites (§5.1 step 1)', () => {
  // ⚠️ `FieldValue.fieldId` is a real FK and the write path silently ignores an
  // attribute with no CustomField row, so half-migrating would leave categories
  // that LOOK seeded: deletable, unresettable, invisible to a re-run.
  it('aborts with a logged warning when tag_template_key is not materialized', async () => {
    const db = makeDb([TAG_DEF, FIELDS.filter((f) => f.systemAttribute !== 'tag_template_key')])

    const report = await migrateOrganizationTaxonomy(db, ORG)

    expect(report.skipped).toBe('tag_template_key-missing')
    expect(h.calls).toEqual([])
    expect(h.seedCalls).toEqual([])
  })

  it('aborts when tag_ai_classify is not materialized', async () => {
    const db = makeDb([TAG_DEF, FIELDS.filter((f) => f.systemAttribute !== 'tag_ai_classify')])

    const report = await migrateOrganizationTaxonomy(db, ORG)

    expect(report.skipped).toBe('tag_ai_classify-missing')
    expect(h.calls).toEqual([])
  })

  it('skips an org with no tag entity', async () => {
    const report = await migrateOrganizationTaxonomy(makeDb([[]]), ORG)

    expect(report.skipped).toBe('no-tag-entity')
    expect(h.calls).toEqual([])
  })
})

describe('migrateOrganizationTaxonomy — step 2, the existing starters', () => {
  const seededOrg: FakeTag[] = [
    {
      id: 'c1',
      title: 'Mail Categories',
      description: AI_CATEGORY_PARENT_TAG.description,
      isSystemTag: false,
    },
    {
      id: 't_sales',
      title: 'Sales',
      parentId: 'c1',
      description: LEGACY_STARTER_DESCRIPTIONS.Sales,
      aiClassify: true,
      isSystemTag: false,
    },
  ]

  it('stamps the template key and adopts the new description', async () => {
    const report = await migrateOrganizationTaxonomy(makeDb(queue(seededOrg)), ORG)

    const sales = h.calls.find((c) => c.recordId === `${TAG_DEF_ID}:t_sales`)
    expect(sales?.values).toEqual({
      tag_template_key: 'category:sales',
      tag_description: seedFor('Sales').description,
    })
    expect(report.stamped).toContain('Sales')
  })

  // ⚠️ Invariant 2 — anyone who can write this field can make their own tag
  // permanently undeletable, so the bypass is the whole enforcement and it is
  // scoped to that one attribute.
  it('writes tag_template_key through a bypass scoped to that field alone', async () => {
    await migrateOrganizationTaxonomy(makeDb(queue(seededOrg)), ORG)

    const sales = h.calls.find((c) => c.recordId === `${TAG_DEF_ID}:t_sales`)
    expect(sales?.bypass).toEqual(['tag_template_key'])
    // Options ride in the FOURTH arg; the third is the array-mode map.
    expect(sales?.modes).toBeUndefined()
    expect(sales?.options).toEqual({ skipEvents: true })
  })

  // ⚠️ Invariant 6, the unrecoverable one.
  it('never overwrites a tuned description', async () => {
    const tuned = seededOrg.map((t) =>
      t.id === 't_sales' ? { ...t, description: 'Only EU reseller enquiries.' } : t
    )

    const report = await migrateOrganizationTaxonomy(makeDb(queue(tuned)), ORG)

    const sales = h.calls.find((c) => c.recordId === `${TAG_DEF_ID}:t_sales`)
    expect(sales?.values).toEqual({ tag_template_key: 'category:sales' })
    expect(report.userEdits).toContain('Sales')
  })

  // ⚠️ Invariant 5 — the same title, none of the evidence.
  it('leaves a user’s own same-named tag entirely alone', async () => {
    const usersOwn: FakeTag[] = [
      { id: 't_sales', title: 'Sales', description: 'leads from the trade show' },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(usersOwn)), ORG)

    expect(h.calls).toEqual([])
    expect(report.stamped).toEqual([])
  })

  // The container gets a key too, so it cannot be deleted out from under its
  // children — but only when something PROVES it is ours.
  it('stamps the container’s own template key', async () => {
    await migrateOrganizationTaxonomy(makeDb(queue(seededOrg)), ORG)

    const container = h.calls.find((c) => c.recordId === `${TAG_DEF_ID}:c1`)
    expect(container?.values).toMatchObject({
      tag_template_key: AI_CATEGORY_PARENT_TEMPLATE_KEY,
    })
  })

  it('writes nothing at all on a replay', async () => {
    const migrated: FakeTag[] = [
      {
        id: 'c1',
        title: 'Mail Categories',
        templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY,
        description: AI_CATEGORY_PARENT_TAG.description,
        isSystemTag: false,
      },
      {
        id: 't_sales',
        title: 'Sales',
        parentId: 'c1',
        templateKey: 'category:sales',
        description: seedFor('Sales').description,
        aiClassify: true,
        isSystemTag: false,
      },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(migrated)), ORG)

    expect(h.calls).toEqual([])
    expect(report.stamped).toEqual([])
    expect(report.userEdits).toEqual([])
  })
})

describe('migrateOrganizationTaxonomy — step 3, adopt and rename', () => {
  const legacyOrg: FakeTag[] = [
    { id: 'c1', title: 'Mail Categories', description: AI_CATEGORY_PARENT_TAG.description },
    { id: 'p_topic', title: LEGACY_PARENT_TITLE, isSystemTag: true },
    { id: 't_acct', title: 'Account Management', isSystemTag: true, parentId: 'p_topic' },
  ]

  // ⚠️ Invariant 4 — `rejectIfSystemTag` reads the CURRENT flag at hook time, so
  // a combined write is rejected on title, description AND parent.
  it('clears is_system_tag in its own write, before the rename', async () => {
    await migrateOrganizationTaxonomy(makeDb(queue(legacyOrg)), ORG)

    const acct = h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_acct`)
    expect(acct).toHaveLength(2)
    expect(acct[0]?.values).toEqual({ is_system_tag: false })
    expect(acct[0]?.bypass).toEqual(['is_system_tag'])
    expect(acct[1]?.values).toMatchObject({ title: 'Account' })
    // Re-granting `is_system_tag` on the second write would reopen the exact hole
    // the two-write split closes.
    expect(acct[1]?.bypass).toEqual(['tag_template_key'])
  })

  it('renames in place, keeping the id — no delete, no recreate', async () => {
    const report = await migrateOrganizationTaxonomy(makeDb(queue(legacyOrg)), ORG)

    // ⚠️ Invariant 3: filters, mined suggestions and threads all reference this id.
    const retune = h.calls.find(
      (c) => c.recordId === `${TAG_DEF_ID}:t_acct` && c.values?.title !== undefined
    )
    expect(retune?.recordId).toBe(`${TAG_DEF_ID}:t_acct`)
    expect(retune?.values).toMatchObject({
      title: 'Account',
      tag_template_key: 'category:account',
      tag_ai_classify: true,
      tag_scope: 'thread',
      tag_parent: `${TAG_DEF_ID}:c1`,
      tag_description: seedFor('Account').description,
    })
    expect(h.calls.some((c) => c.op === 'delete' && c.recordId === `${TAG_DEF_ID}:t_acct`)).toBe(
      false
    )
    expect(report.adopted).toContain('Account Management → Account')
  })

  // ⚠️ Invariant 5 — a user's own `Account Management` is theirs.
  it('ignores a same-named tag that is not flagged is_system_tag', async () => {
    const usersOwn = legacyOrg.map((t) => (t.id === 't_acct' ? { ...t, isSystemTag: false } : t))

    const report = await migrateOrganizationTaxonomy(makeDb(queue(usersOwn)), ORG)

    expect(h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_acct`)).toEqual([])
    expect(report.adopted).toEqual([])
  })

  it('refuses a rename that would duplicate an existing title', async () => {
    const collision = [...legacyOrg, { id: 't_account', title: 'Account' }]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(collision)), ORG)

    expect(h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_acct`)).toEqual([])
    expect(report.adopted).toEqual([])
  })

  // `Orders` is a COMMERCE label. The legacy tag is adopted wherever it exists —
  // step 3 carries no pack qualifier — but the commerce pack itself is only
  // seeded where a Shopify integration says so.
  it('adopts Orders → Order Status and infers commerce from Shopify', async () => {
    const orders: FakeTag[] = [
      { id: 'c1', title: 'Mail Categories', description: AI_CATEGORY_PARENT_TAG.description },
      { id: 't_orders', title: 'Orders', isSystemTag: true },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(orders, orders, true)), ORG)

    expect(report.adopted).toContain('Orders → Order Status')
    expect(report.packs).toEqual(['commerce'])
    expect(h.seedCalls[0]?.options).toEqual({ packs: ['commerce'] })
  })
})

describe('migrateOrganizationTaxonomy — steps 5 and D2, retirement', () => {
  const retiring: FakeTag[] = [
    { id: 'c1', title: 'Mail Categories', description: AI_CATEGORY_PARENT_TAG.description },
    { id: 'p_topic', title: LEGACY_PARENT_TITLE, isSystemTag: true },
    { id: 't_legal', title: 'Legal', isSystemTag: true, parentId: 'p_topic' },
    { id: 't_urgent', title: 'Urgent', isSystemTag: true },
    {
      id: 't_news',
      title: 'Newsletter',
      parentId: 'c1',
      description: LEGACY_STARTER_DESCRIPTIONS.Newsletter,
      aiClassify: true,
    },
  ]

  it('unflags a retired topic and never deletes it', async () => {
    const report = await migrateOrganizationTaxonomy(makeDb(queue(retiring)), ORG)

    const legal = h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_legal`)
    expect(legal).toHaveLength(1)
    expect(legal[0]?.values).toEqual({ is_system_tag: false })
    expect(legal[0]?.op).toBe('update')
    expect(report.unflagged).toEqual(['Legal'])
    // An org may have applied it by hand, and an unflagged tag costs nothing.
    expect(h.calls.some((c) => c.op === 'delete')).toBe(false)
  })

  // ⚠️ Invariant 8 / §5.1 step 7.
  it('leaves Urgent completely untouched', async () => {
    await migrateOrganizationTaxonomy(makeDb(queue(retiring)), ORG)

    expect(h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_urgent`)).toEqual([])
  })

  // D2 — the label goes, the tag stays: mail already carries it.
  it('clears tag_ai_classify on Newsletter without deleting the tag', async () => {
    const report = await migrateOrganizationTaxonomy(makeDb(queue(retiring)), ORG)

    const news = h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_news`)
    expect(news).toHaveLength(1)
    expect(news[0]?.values).toEqual({ tag_ai_classify: false })
    // No bypass: `tag_ai_classify` is an ordinary updatable field.
    expect(news[0]?.bypass).toEqual([])
    expect(report.labelsRetired).toEqual(['Newsletter'])
  })

  it('leaves a user’s own Newsletter tag eligible', async () => {
    const usersOwn = retiring.map((t) =>
      t.id === 't_news' ? { ...t, parentId: null, description: 'our monthly digest' } : t
    )

    const report = await migrateOrganizationTaxonomy(makeDb(queue(usersOwn)), ORG)

    expect(h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:t_news`)).toEqual([])
    expect(report.labelsRetired).toEqual([])
  })

  it('does not re-clear an already-retired label on a replay', async () => {
    const replayed = retiring.map((t) =>
      t.id === 't_news'
        ? { ...t, aiClassify: false }
        : t.id === 't_legal'
          ? { ...t, isSystemTag: false }
          : t
    )

    const report = await migrateOrganizationTaxonomy(makeDb(queue(replayed)), ORG)

    expect(report.labelsRetired).toEqual([])
    expect(report.unflagged).toEqual([])
  })
})

describe('migrateOrganizationTaxonomy — step 6, collapsing the parents', () => {
  it('keeps Topic Categorization while it still has children', async () => {
    const withChildren: FakeTag[] = [
      { id: 'p_topic', title: LEGACY_PARENT_TITLE, isSystemTag: true },
      { id: 't_legal', title: 'Legal', isSystemTag: false, parentId: 'p_topic' },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(withChildren)), ORG)

    expect(report.legacyParentDeleted).toBe(false)
    expect(h.calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('unflags then deletes an empty Topic Categorization', async () => {
    const empty: FakeTag[] = [{ id: 'p_topic', title: LEGACY_PARENT_TITLE, isSystemTag: true }]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(empty)), ORG)

    // `rejectDeleteIfSystemTag` refuses a system tag's delete, so the flag has to
    // be cleared first — its own write, for the same reason as invariant 4.
    const topic = h.calls.filter((c) => c.recordId === `${TAG_DEF_ID}:p_topic`)
    expect(topic.map((c) => c.op)).toEqual(['update', 'delete'])
    expect(topic[0]?.values).toEqual({ is_system_tag: false })
    expect(topic[0]?.bypass).toEqual(['is_system_tag'])
    expect(report.legacyParentDeleted).toBe(true)
  })

  it('re-parents a category adopted before the container existed', async () => {
    // The org had no `Mail Categories` at census time; step 4's seeder made one.
    const before: FakeTag[] = [{ id: 't_orders', title: 'Orders', isSystemTag: true }]
    const after: FakeTag[] = [
      { id: 'c1', title: 'Mail Categories', templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY },
      { id: 't_orders', title: 'Order Status', templateKey: 'category:order-status' },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(before, after, true)), ORG)

    const reparent = h.calls.find(
      (c) => c.recordId === `${TAG_DEF_ID}:t_orders` && c.values?.tag_parent
    )
    expect(reparent?.values).toEqual({ tag_parent: `${TAG_DEF_ID}:c1` })
    expect(report.reparented).toEqual(['Order Status'])
  })

  it('does not re-parent a category already under the container', async () => {
    const settled: FakeTag[] = [
      { id: 'c1', title: 'Mail Categories', templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY },
      {
        id: 't_sales',
        title: 'Sales',
        parentId: 'c1',
        templateKey: 'category:sales',
        description: seedFor('Sales').description,
      },
    ]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(settled)), ORG)

    expect(report.reparented).toEqual([])
    expect(updatesOf('tag_parent')).toEqual([])
  })

  // The container must never become its own parent.
  it('never re-parents the container itself', async () => {
    const settled: FakeTag[] = [
      { id: 'c1', title: 'Mail Categories', templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY },
    ]

    await migrateOrganizationTaxonomy(makeDb(queue(settled)), ORG)

    expect(h.calls.filter((c) => c.values?.tag_parent)).toEqual([])
  })
})

describe('migrateOrganizationTaxonomy — step 4 delegates to the seeder', () => {
  it('asks the seeder for exactly the inferred packs', async () => {
    const org: FakeTag[] = [{ id: 'c1', title: 'Mail Categories' }]

    await migrateOrganizationTaxonomy(makeDb(queue(org)), ORG)

    expect(h.seedCalls).toHaveLength(1)
    expect(h.seedCalls[0]).toEqual({ organizationId: ORG, options: { packs: [] } })
  })

  it('reports what the seeder created', async () => {
    h.seedResult = { created: ['Returns & Refunds'], skipped: [], adopted: ['Support'] }
    const org: FakeTag[] = [{ id: 'c1', title: 'Mail Categories' }]

    const report = await migrateOrganizationTaxonomy(makeDb(queue(org, org, true)), ORG)

    expect(report.created).toEqual(['Returns & Refunds'])
    expect(report.adopted).toContain('Support')
  })
})

describe('migration076MailCategoryRework', () => {
  it('claims the id 076 in the shared ledger', () => {
    // ⚠️ The `NNN-` space spans data-migrations/ AND seed/entity-migrations/;
    // `075-tag-template-key` is the entity migration this one depends on.
    expect(migration076MailCategoryRework.id).toBe('076-mail-category-rework')
  })

  it('is registered exactly once', async () => {
    const { ALL_DATA_MIGRATIONS } = await import('../registry')
    const matches = ALL_DATA_MIGRATIONS.filter((m) => m.id === migration076MailCategoryRework.id)
    expect(matches).toHaveLength(1)
    // It must sort after the entity migration that materializes the field.
    expect(ALL_DATA_MIGRATIONS.some((m) => m.id === '075-tag-template-key')).toBe(true)
    expect('076-mail-category-rework' > '075-tag-template-key').toBe(true)
  })
})
