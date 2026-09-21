// packages/lib/src/resources/merge/__tests__/merge-guest-contact.test.ts
//
// Task 79 §4.1: merge archives the source and repoints FieldValues and
// RecordIdentities, but `MoneyTransaction.partyInstanceId` is a COLUMN it knows
// nothing about — merging the guest away strands every guest movement and
// dangles the setting. Duplicate detection can propose it on its own.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationSetting = vi.fn()
vi.mock('../../../settings', () => ({
  getOrganizationSetting: (...args: unknown[]) => getOrganizationSetting(...args),
}))

import type { RecordId } from '../../resource-id'
import { EntityMergeService } from '../merge-service'

const ORG_ID = 'org1'
const GUEST = 'contact-guest'
const TARGET = 'contact-real'
const OTHER = 'contact-other'

/** Every id resolves to a live instance in this org. */
function buildDb(ids: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => ids.map((id) => ({ id, organizationId: ORG_ID, archivedAt: null })),
      }),
    }),
  } as never
}

function validate(ids: string[], sources: string[], target: string) {
  const service = new EntityMergeService(buildDb(ids), ORG_ID, 'user1')
  // biome-ignore lint/suspicious/noExplicitAny: the assertions are private
  return (service as any).validateMergeInput({
    sourceRecordIds: sources.map((id) => `contact:${id}`) as RecordId[],
    targetRecordId: `contact:${target}` as RecordId,
  })
}

beforeEach(() => {
  getOrganizationSetting.mockReset().mockResolvedValue(GUEST)
})

describe('merging the guest customer', () => {
  it('is refused', async () => {
    await expect(validate([GUEST, TARGET], [GUEST], TARGET)).rejects.toThrow(
      /guest customer cannot be merged/
    )
  })

  it('is refused when the guest is one source among several', async () => {
    await expect(validate([OTHER, GUEST, TARGET], [OTHER, GUEST], TARGET)).rejects.toThrow(
      /guest customer cannot be merged/
    )
  })

  it('leaves an ordinary merge alone', async () => {
    await expect(validate([OTHER, TARGET], [OTHER], TARGET)).resolves.toBeUndefined()
  })

  it('leaves every merge alone in an org with no guest', async () => {
    getOrganizationSetting.mockResolvedValue(null)

    await expect(validate([GUEST, TARGET], [GUEST], TARGET)).resolves.toBeUndefined()
  })
})
