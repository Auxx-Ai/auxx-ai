// apps/web/src/server/lib/return-intake-draft-asset-access.test.ts
//
// The preview scope's refusals (plans/money/tasks/57 §7.2). The scope exists so
// a dock account with returns access and no Files app can see the photograph it
// just took — so the thing worth pinning is that it does not hand out MORE than
// that: it authorizes against `return`, and only for an asset the named draft
// actually holds.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  drafts: new Map<string, { payload: { labels: { fileRef: string }[] } }>(),
  defId: 'edf_return0000000000000000000' as string | null,
  viewed: [] as string[],
  denyView: false,
}))

vi.mock('@auxx/lib/returns/intake', () => ({
  getReturnIntakeDraft: vi.fn(async (organizationId: string, draftId: string) => {
    // The org id is IN THE KEY — there is no row predicate behind it, so this
    // fake has to be keyed the same way or it would test nothing.
    const draft = h.drafts.get(`${organizationId}:${draftId}`)
    return draft ? ok(draft) : err(new NotFoundError('This label drop is no longer available'))
  }),
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedEntityDefId: vi.fn(async () => h.defId),
}))

import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import { assertReturnIntakeDraftAssetAccess } from './return-intake-draft-asset-access'

const capabilities = {
  assertViewEntity: (defId: string) => {
    h.viewed.push(defId)
    if (h.denyView) throw new ForbiddenError('Not allowed to view returns')
  },
} as unknown as CapabilitySet

function seed(organizationId: string, draftId: string, fileRefs: string[]) {
  h.drafts.set(`${organizationId}:${draftId}`, {
    payload: { labels: fileRefs.map((fileRef) => ({ fileRef })) },
  })
}

beforeEach(() => {
  h.drafts = new Map()
  h.defId = 'edf_return0000000000000000000'
  h.viewed = []
  h.denyView = false
})

describe('assertReturnIntakeDraftAssetAccess', () => {
  it('allows a label photo the draft holds, against viewing returns', async () => {
    seed('org_1', 'drf_1', ['asset:ast_1', 'asset:ast_2'])

    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_2',
        organizationId: 'org_1',
      })
    ).resolves.toBeUndefined()

    // 🛑 `return`, never `files`: that is the whole point of the scope.
    expect(h.viewed).toEqual(['edf_return0000000000000000000'])
  })

  it('🛑 refuses an asset the draft does not hold', async () => {
    seed('org_1', 'drf_1', ['asset:ast_1'])

    // Without this check, anyone who can view returns could name any draft in
    // the org and inherit its authorization for an unrelated asset.
    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_someone_elses',
        organizationId: 'org_1',
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('🛑 refuses a file ref that is not an asset ref at all', async () => {
    // The draft stores `asset:<id>`; a `file:<id>` that happened to share an id
    // must not match, which is why the whole ref is compared rather than the id.
    seed('org_1', 'drf_1', ['file:ast_1'])

    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_1',
        organizationId: 'org_1',
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('🛑 a draft in another org resolves to nothing, before any capability is read', async () => {
    seed('org_1', 'drf_1', ['asset:ast_1'])

    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_1',
        organizationId: 'org_2',
      })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(h.viewed).toEqual([])
  })

  it('still asserts view on returns, so the scope grants nothing on its own', async () => {
    seed('org_1', 'drf_1', ['asset:ast_1'])
    h.denyView = true

    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_1',
        organizationId: 'org_1',
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('says so plainly when the org has no return definition yet', async () => {
    seed('org_1', 'drf_1', ['asset:ast_1'])
    h.defId = null

    await expect(
      assertReturnIntakeDraftAssetAccess(capabilities, {
        draftId: 'drf_1',
        assetId: 'ast_1',
        organizationId: 'org_1',
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
