// packages/lib/src/dashboards/draft-edit/__tests__/persist.test.ts
//
// The write seam and the CAS that `saveDraft` never had. Three properties:
// an ABSENT token behaves exactly as the function always did (so no existing
// caller had to migrate), a MATCHING token proceeds, and a STALE token is
// refused with an actionable ConflictError instead of silently overwriting the
// newer draft. The dashboard page auto-saves the WHOLE document every 800ms,
// so "silently overwriting" here means losing everything, not merging badly.

import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { hashLayoutDoc } from '../../config-hash'
import { saveDraft } from '../../version-mutations'
import { persistLayout } from '../persist'
import { loadDraftContext } from '../read'
import { configuredBarChart, doc, makeDb, tab, widget } from './support/fixtures'

const SCOPE = { dashboardId: 'dash_1', organizationId: 'org_1' }

const before = doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])])
const after = doc([
  tab('tab_1', 'Overview', [widget('w1', 'Note'), widget('w2', 'Revenue', configuredBarChart())]),
])

describe('persistLayout', () => {
  it('writes and returns the new layout hash, chainable into the next CAS', async () => {
    const { db, row } = makeDb({ draftLayout: before })
    const result = await persistLayout(db, SCOPE, { doc: after })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().layoutHash).toBe(hashLayoutDoc(after))
    expect(row.draftLayout).toEqual(after)
  })

  it('proceeds with NO token: the un-migrated path is untouched', async () => {
    const { db, row } = makeDb({ draftLayout: before })
    expect((await persistLayout(db, SCOPE, { doc: after })).isOk()).toBe(true)
    expect(row.draftLayout).toEqual(after)
  })

  it('proceeds when the token matches the stored draft', async () => {
    const { db, row } = makeDb({ draftLayout: before })
    const loaded = await loadDraftContext(db, SCOPE)
    const token = loaded._unsafeUnwrap().layoutHash
    expect(token).toBe(hashLayoutDoc(before))
    const result = await persistLayout(db, SCOPE, { doc: after, expectedLayoutHash: token })
    expect(result.isOk()).toBe(true)
    expect(row.draftLayout).toEqual(after)
  })

  // THE bug this closes: a browser auto-save landing between the agent's read
  // and its write would otherwise win, wholesale and without a trace.
  it('refuses a stale token and leaves the stored draft alone', async () => {
    const { db, row } = makeDb({ draftLayout: before })
    const result = await persistLayout(db, SCOPE, {
      doc: after,
      expectedLayoutHash: 'a-hash-from-a-draft-that-has-since-moved',
    })
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.details.reason).toBe('draft-changed-since-read')
    // The message is what a model acts on, so it has to say what to do next.
    expect(error.message).toContain('Re-read')
    expect(row.draftLayout).toEqual(before)
  })

  it('refuses a token against a row that has never held a draft', async () => {
    const { db } = makeDb({ draftLayout: null })
    const result = await persistLayout(db, SCOPE, { doc: after, expectedLayoutHash: 'anything' })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })

  it('proceeds without a token against a row that has never held a draft', async () => {
    const { db, row } = makeDb({ draftLayout: null })
    expect((await persistLayout(db, SCOPE, { doc: after })).isOk()).toBe(true)
    expect(row.draftLayout).toEqual(after)
  })

  it('surfaces a missing dashboard as a typed NotFoundError', async () => {
    const { db } = makeDb({ draftLayout: before, archivedAt: new Date() })
    expect((await persistLayout(db, SCOPE, { doc: after }))._unsafeUnwrapErr()).toBeInstanceOf(
      NotFoundError
    )
  })

  it('surfaces a doc the draft schema rejects', async () => {
    const { db } = makeDb({ draftLayout: before })
    const result = await persistLayout(db, SCOPE, { doc: doc([]) })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('saveDraft keeps its two hashes apart', () => {
  // `configHash` answers "does the draft differ from what is published".
  // `layoutHash` answers "did the draft move under me". Same function,
  // different documents, and breaking one silently breaks the other.
  it('still reconciles hasUnpublishedChanges against the ACTIVE version', async () => {
    const { db } = makeDb(
      { draftLayout: before, activeVersionId: 'ver_1' },
      { configHash: hashLayoutDoc(after) }
    )
    const clean = await saveDraft(db, 'org_1', 'dash_1', after)
    expect(clean._unsafeUnwrap().hasUnpublishedChanges).toBe(false)
    expect(clean._unsafeUnwrap().layoutHash).toBe(hashLayoutDoc(after))
  })

  it('flags dirty when the draft diverges from the active version', async () => {
    const { db } = makeDb(
      { draftLayout: before, activeVersionId: 'ver_1' },
      { configHash: hashLayoutDoc(before) }
    )
    const dirty = await saveDraft(db, 'org_1', 'dash_1', after)
    expect(dirty._unsafeUnwrap().hasUnpublishedChanges).toBe(true)
  })

  it('treats no active version as dirty, as it always did', async () => {
    const { db } = makeDb({ draftLayout: before })
    expect(
      (await saveDraft(db, 'org_1', 'dash_1', after))._unsafeUnwrap().hasUnpublishedChanges
    ).toBe(true)
  })
})

describe('loadDraftContext', () => {
  it('is the row, the parsed doc, its hash and the linked def, and nothing else', async () => {
    const { db } = makeDb({ draftLayout: before, entityDefinitionId: 'def_1' })
    const ctx = (await loadDraftContext(db, SCOPE))._unsafeUnwrap()
    expect(ctx.doc).toEqual(before)
    expect(ctx.layoutHash).toBe(hashLayoutDoc(before))
    expect(ctx.entityDefinitionId).toBe('def_1')
    expect(ctx.row.id).toBe('dash_1')
  })

  it('reads a row with no stored draft as an empty doc with NO CAS token', async () => {
    const { db } = makeDb({ draftLayout: null })
    const ctx = (await loadDraftContext(db, SCOPE))._unsafeUnwrap()
    expect(ctx.doc).toEqual({ tabs: [] })
    expect(ctx.layoutHash).toBeUndefined()
  })

  // Writing over an unreadable draft would destroy whatever the row holds.
  it('refuses an unparseable draft rather than silently resetting it', async () => {
    const { db } = makeDb({ draftLayout: { tabs: 'not an array' } })
    expect((await loadDraftContext(db, SCOPE))._unsafeUnwrapErr()).toBeInstanceOf(
      UnprocessableEntityError
    )
  })
})
