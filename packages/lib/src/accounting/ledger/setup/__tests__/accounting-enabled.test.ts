// packages/lib/src/accounting/ledger/setup/__tests__/accounting-enabled.test.ts
//
// plans/accounting/tasks/done/17-accounting-is-opt-in.md section 3; 110 G1 for `isAccountingActive`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isSelfHosted: vi.fn(() => false),
  getOrRecompute: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@auxx/deployment', () => ({ isSelfHosted: h.isSelfHosted }))
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ getOrRecompute: h.getOrRecompute, get: h.get }),
}))

import { FeatureKey } from '../../../../permissions/types'
import { isAccountingActive, isAccountingEnabled } from '../accounting-enabled'

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

describe('isAccountingActive', () => {
  const settings = (setupState: string) =>
    h.get.mockResolvedValue({ 'accounting.setupState': setupState })

  it('is false when the feature is off, without reading settings', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: false } })
    settings('finalized')
    expect(await isAccountingActive(ORG)).toBe(false)
    expect(h.get).not.toHaveBeenCalled()
  })

  it('is false when the feature is on and setup is draft', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: true } })
    settings('draft')
    expect(await isAccountingActive(ORG)).toBe(false)
  })

  it('is true when the feature is on and setup is finalized', async () => {
    h.getOrRecompute.mockResolvedValue({ features: { [FeatureKey.accounting]: true } })
    settings('finalized')
    expect(await isAccountingActive(ORG)).toBe(true)
    expect(h.get).toHaveBeenCalledWith(ORG, 'orgSettings')
  })

  it('is false on a self-hosted install whose setup is draft', async () => {
    h.isSelfHosted.mockReturnValue(true)
    settings('draft')
    expect(await isAccountingActive(ORG)).toBe(false)
  })

  it('is false when setupState was never written (catalog default is draft)', async () => {
    h.isSelfHosted.mockReturnValue(true)
    h.get.mockResolvedValue({})
    expect(await isAccountingActive(ORG)).toBe(false)
  })
})
