// packages/lib/src/postings/__tests__/accounting-enabled.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isSelfHosted: vi.fn(() => false),
  getOrRecompute: vi.fn(),
}))

vi.mock('@auxx/deployment', () => ({ isSelfHosted: h.isSelfHosted }))
vi.mock('../../cache', () => ({ getOrgCache: () => ({ getOrRecompute: h.getOrRecompute }) }))

import { FeatureKey } from '../../permissions/types'
import { isAccountingEnabled } from '../accounting-enabled'

const ORG = 'org_1'
const db = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.isSelfHosted.mockReturnValue(false)
})

describe('isAccountingEnabled', () => {
  it('is true when the cached feature map carries accounting: true', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: true } })
    expect(await isAccountingEnabled(db, ORG)).toBe(true)
  })

  it('is false when the feature map says accounting: false', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: false } })
    expect(await isAccountingEnabled(db, ORG)).toBe(false)
  })

  it('is false when the feature map says accounting: 0', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: 0 } })
    expect(await isAccountingEnabled(db, ORG)).toBe(false)
  })

  it('is false when the feature is absent from the map', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { mail: '+' } })
    expect(await isAccountingEnabled(db, ORG)).toBe(false)
  })

  it('is false when there is no feature map at all', async () => {
    h.getOrRecompute.mockResolvedValue({ features: null })
    expect(await isAccountingEnabled(db, ORG)).toBe(false)
  })

  it('is true on a self-hosted install regardless of the feature map', async () => {
    h.isSelfHosted.mockReturnValue(true)
    expect(await isAccountingEnabled(db, ORG)).toBe(true)
  })
})
