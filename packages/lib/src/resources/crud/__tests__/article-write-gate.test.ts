// packages/lib/src/resources/crud/__tests__/article-write-gate.test.ts
//
// Plan v3/06 §7.2 — **the article write gate is judged per ROW, both directions**.
//
// The two-row table below IS the regression baseline for this carve-out. Both
// rows were broken, in opposite directions, and the interesting part is that
// they cannot both be fixed on the def axis:
//
//   | member                                 | before        | required |
//   |----------------------------------------|---------------|----------|
//   | `knowledgeBase: Edit`, `records: None` | DENIED always | allowed on KBs they hold |
//   | `records: Edit`, `knowledgeBase: None` | ALLOWED on EVERY article | denied |
//
// Row 1 was closed by the `_access` stamp (P2). Row 2 needed the carve-out:
// `canEditEntity('article')` resolves to `PermissionKey.recordsEdit` (no
// `article` entry in `ENTITY_WRITE_KEYS`), so a `records: Edit` member was
// def-ALLOWED and their rows were therefore never read back at all — the stamp
// existed and was never consulted.
//
// 🔴 The counterfactual is pinned at the bottom, because it is the thing a
// future reader will want to "simplify" to: setting
// `ENTITY_WRITE_KEYS['article'] = knowledgeBaseEdit` fixes row 2 and breaks row
// 1, because whichever area you point the def gate at becomes a def-level "yes"
// that skips the row judgement. An article's authority is non-local — one hop
// away, on its KB — so no def-level key can express it.

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilitySet } from '../../../permissions/capabilities/capability-set'
import { buildDefIdToSlug } from '../../../permissions/capabilities/resolve-capability-inputs'
import { ENTITY_WRITE_KEYS } from '../../../permissions/capabilities/seat-policy'
import type { RecordId } from '../../resource-id'
import { assertRecordRowsEditable, defDeniedRecordIds } from '../record-row-access'

/** The org's `article` EntityDefinition — a CUID, as the records table mints it. */
const ARTICLE_DEF = 'qkmgvfi61m4ubmfrxg7y3mzc'
const ARTICLE = 'em0s33wstyynminepz1zkq8t'
const CUID_RECORD = `${ARTICLE_DEF}:${ARTICLE}` as RecordId
/** The SLUG form, which `toRecordId('article', id)` and the records table mint. */
const SLUG_RECORD = `article:${ARTICLE}` as RecordId
/** An ordinary record def, to prove the fast path is untouched. */
const CONTACT_DEF = 'edf_contact00000000000000000'
const CONTACT_RECORD = `${CONTACT_DEF}:ins_a0000000000000000000` as RecordId

/** The resolver the two production entry points build from the org cache. */
const defIdToSlug = (id: string) => (id === ARTICLE_DEF ? 'article' : id)

function member(levels: Partial<Record<Area, Level>>) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys(levels as never)),
    {},
    'USER',
    'full',
    defIdToSlug,
    new Set<string>(),
    (id) => id
  )
}

const KB_EDITOR = () => member({ [Area.knowledgeBase]: Level.Edit })
const RECORDS_EDITOR = () => member({ [Area.records]: Level.Edit })

/** Run the composed gate and report the verdict plus how many reads it cost. */
async function judge(
  capabilities: CapabilitySet | undefined,
  recordIds: RecordId[],
  stamps: Record<string, { _access?: string }>
) {
  // Typed parameter, not `async () => …`: an inferred zero-arg mock gives
  // `mock.calls[0]` the tuple type `[]`, so reading the argument is a tsc error.
  const stampRows = vi.fn(async (_ids: RecordId[]) => stamps as never)
  let verdict: 'ALLOWED' | 'DENIED' = 'ALLOWED'
  try {
    await assertRecordRowsEditable(capabilities, recordIds, stampRows, defIdToSlug)
  } catch {
    verdict = 'DENIED'
  }
  return { verdict, stampReads: stampRows.mock.calls.length, stampRows }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('§7.2 row 2 — a `records: Edit` member is NOT trusted with every article', () => {
  it('forces the row to be read back even though the def gate allows it', async () => {
    // The whole carve-out in one assertion: before it, `defDenied` was empty and
    // the row was never read.
    expect(RECORDS_EDITOR().canEditEntity(ARTICLE_DEF)).toBe(true)
    expect(defDeniedRecordIds(RECORDS_EDITOR(), [CUID_RECORD], defIdToSlug)).toEqual([CUID_RECORD])
  })

  it('DENIES when the read path hid the article (no stamp) — KB they cannot open', async () => {
    const { verdict, stampReads } = await judge(RECORDS_EDITOR(), [CUID_RECORD], {})

    expect(verdict).toBe('DENIED')
    expect(stampReads).toBe(1)
  })

  it('DENIES a `read`-stamped article — the `edit` floor still holds', async () => {
    // e.g. an article homed in a `source` KB but linked into one they can see:
    // readable, and home-strict says not writable (§7.3).
    const { verdict } = await judge(RECORDS_EDITOR(), [CUID_RECORD], {
      [CUID_RECORD]: { _access: 'read' },
    })

    expect(verdict).toBe('DENIED')
  })

  it('ALLOWS an `edit`-stamped article — this is not a blanket refusal', async () => {
    const { verdict } = await judge(RECORDS_EDITOR(), [CUID_RECORD], {
      [CUID_RECORD]: { _access: 'edit' },
    })

    expect(verdict).toBe('ALLOWED')
  })
})

describe('§7.2 row 1 — a `knowledgeBase: Edit` member keeps what P2 gave them', () => {
  it('is def-DENIED and judged on the stamp, exactly as before the carve-out', async () => {
    expect(KB_EDITOR().canEditEntity(ARTICLE_DEF)).toBe(false)

    const { verdict } = await judge(KB_EDITOR(), [CUID_RECORD], {
      [CUID_RECORD]: { _access: 'edit' },
    })

    expect(verdict).toBe('ALLOWED')
  })

  it('is still DENIED on an article whose KB they do not hold', async () => {
    const { verdict } = await judge(KB_EDITOR(), [CUID_RECORD], {})

    expect(verdict).toBe('DENIED')
  })
})

describe('both RecordId keyspaces are covered', () => {
  it('catches the SLUG form through the raw arm, even if the resolver cannot map it', async () => {
    // `buildDefIdToSlug` falls back to identity for a key it cannot resolve — an
    // org whose `resources` cache is cold or incomplete. The raw arm is what
    // keeps `article:<id>` covered through that window, so it is belt-and-braces
    // rather than the safety net it was while the parameter was optional.
    const coldCache = buildDefIdToSlug([] as never)

    expect(defDeniedRecordIds(RECORDS_EDITOR(), [SLUG_RECORD], coldCache)).toEqual([SLUG_RECORD])
  })

  it('catches the CUID form via the resolver', async () => {
    expect(defDeniedRecordIds(RECORDS_EDITOR(), [CUID_RECORD], defIdToSlug)).toEqual([CUID_RECORD])
  })

  it('catches the CUID form through a REAL org-cache resolver, not a hand-written one', async () => {
    // `buildDefIdToSlug` is what every production caller passes, so the mapping
    // under test is the shipped one rather than this file's two-line stub. The
    // resource shape is the org's real article row: a CUID `id`, the same value
    // as `entityDefinitionId`, and `entityType: 'article'`.
    const resolver = buildDefIdToSlug([
      {
        id: ARTICLE_DEF,
        entityDefinitionId: ARTICLE_DEF,
        apiSlug: 'articles',
        entityType: 'article',
      },
    ] as never)

    expect(defDeniedRecordIds(RECORDS_EDITOR(), [CUID_RECORD], resolver)).toEqual([CUID_RECORD])
  })

  it('the resolver is REQUIRED, so a caller cannot opt out of the carve-out', () => {
    // Two guarantees in one assertion.
    //
    // COMPILE time: the `@ts-expect-error` is the real subject. If the parameter
    // ever goes back to optional the directive becomes unused, which is itself a
    // tsc error — so this assertion self-verifies rather than silently passing.
    //
    // RUN time: and it throws rather than degrading. That matters because the
    // previous optional signature failed SILENTLY — a caller that omitted the
    // resolver got a weaker gate and no signal at all.
    expect(() =>
      // @ts-expect-error - `defIdToSlug` is required; omitting it must not compile.
      defDeniedRecordIds(RECORDS_EDITOR(), [CUID_RECORD])
    ).toThrow(TypeError)
  })
})

describe('the fast path and the batch shape are unchanged for everything else', () => {
  it('an ordinary def the member can edit is still never read', async () => {
    const { verdict, stampReads } = await judge(RECORDS_EDITOR(), [CONTACT_RECORD], {})

    expect(verdict).toBe('ALLOWED')
    expect(stampReads).toBe(0)
  })

  it('a mixed batch costs ONE stamped read, carrying both the forced and the denied ids', async () => {
    // The cost claim, asserted rather than asserted-in-prose: the carve-out joins
    // the SAME `stampRows` call, so N articles cost one round trip, not N.
    const articles = Array.from(
      { length: 50 },
      (_, i) => `${ARTICLE_DEF}:art${String(i).padStart(21, '0')}` as RecordId
    )
    const stamps = Object.fromEntries(articles.map((id) => [id, { _access: 'edit' }]))

    const { verdict, stampReads, stampRows } = await judge(
      RECORDS_EDITOR(),
      [CONTACT_RECORD, ...articles],
      stamps
    )

    expect(verdict).toBe('ALLOWED')
    expect(stampReads).toBe(1)
    // The def-editable contact is NOT in the read; only the carved-out ids are.
    expect(stampRows.mock.calls[0]?.[0]).toEqual(articles)
  })

  it('an internal caller takes no carve-out and pays no read', async () => {
    // `capabilities: undefined` has no member to judge a stamp against, so the
    // carve-out must not override the unenforced convention.
    expect(defDeniedRecordIds(undefined, [CUID_RECORD], defIdToSlug)).toEqual([])
    const { verdict, stampReads } = await judge(undefined, [CUID_RECORD], {})
    expect(verdict).toBe('ALLOWED')
    expect(stampReads).toBe(0)
  })
})

describe('🔴 why the def axis cannot fix this — the rejected counterfactual', () => {
  it('`ENTITY_WRITE_KEYS[article]` would swap which member is wronged', () => {
    // Pinned rather than described: the next reader WILL reach for this.
    expect(ENTITY_WRITE_KEYS.article).toBeUndefined()

    const before = {
      recordsEditor: RECORDS_EDITOR().canEditEntity(ARTICLE_DEF),
      kbEditor: KB_EDITOR().canEditEntity(ARTICLE_DEF),
    }
    expect(before).toEqual({ recordsEditor: true, kbEditor: false })

    try {
      ;(ENTITY_WRITE_KEYS as Record<string, string>).article = 'knowledgeBase.edit'
      const after = {
        recordsEditor: RECORDS_EDITOR().canEditEntity(ARTICLE_DEF),
        kbEditor: KB_EDITOR().canEditEntity(ARTICLE_DEF),
      }
      // Exactly inverted. Whichever area the def gate points at becomes a
      // def-level "yes" that would skip the row judgement — so on the def axis
      // alone, one of the two rows is always wrong.
      expect(after).toEqual({ recordsEditor: false, kbEditor: true })
    } finally {
      delete (ENTITY_WRITE_KEYS as Record<string, string>).article
    }
  })
})
