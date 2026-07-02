// packages/lib/src/data-connectors/inventory-bridge-rule-action.test.ts
// The `deductInventory` native handler: fires the shared deduction core per LINKED variant,
// no-ops unlinked variants, and never throws on a bad link. Heavy deps are mocked; the fake db
// answers the cell + linked-part reads (drizzle column refs are undefined under vitest).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    cell: null as number | null,
    linkedPart: null as string | null,
    getLink: vi.fn(),
    deduct: vi.fn(async () => ({ outcome: 'movement', delta: 3 })),
    getSystemUser: vi.fn(async () => 'sys_user'),
    getCachedEntityDefId: vi.fn(async (_org: string, slug: string) =>
      slug === 'part' ? 'def_part' : slug === 'stock_movement' ? 'def_mv' : undefined
    ),
    getCachedRecordRules: vi.fn(async () => [
      { entityDefinitionId: 'def_variants', fieldId: 'fld_qty', managed: 'inventory' },
    ]),
    db: null as unknown,
  }
  state.db = {
    select(projection: Record<string, unknown>) {
      const isCell = 'value' in projection
      const chain: Record<string, unknown> = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () =>
          Promise.resolve(
            isCell
              ? state.cell != null
                ? [{ value: state.cell }]
                : []
              : state.linkedPart != null
                ? [{ relatedEntityId: state.linkedPart }]
                : []
          ),
      }
      return chain
    },
  }
  return state
})

vi.mock('@auxx/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/database')>()
  return { ...actual, database: h.db }
})
vi.mock('../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getCachedRecordRules: h.getCachedRecordRules,
}))
vi.mock('./inventory-bridge-store', () => ({ getInventoryBridgeLink: h.getLink }))
vi.mock('./inventory-bridge-pass', () => ({ deductVariantInventory: h.deduct }))
vi.mock('../resources/crud/unified-handler', () => ({ UnifiedCrudHandler: class {} }))
vi.mock('../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: h.getSystemUser },
}))

import { getNativeRuleHandler } from '../record-rules'
import { registerInventoryDeductionRule } from './inventory-bridge-rule-action'

registerInventoryDeductionRule()
const handler = getNativeRuleHandler('deductInventory')!

function link(over: Record<string, unknown> = {}) {
  return {
    id: 'lnk_1',
    organizationId: 'org_1',
    dataConnectorId: 'dc_1',
    sourceDefId: 'def_variants',
    variantInstanceId: 'var_1',
    partInstanceId: 'part_1',
    lastSeenQuantity: 10,
    mode: 'auto',
    ...over,
  }
}

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  h.cell = 7
  h.linkedPart = 'part_1'
  h.getCachedEntityDefId.mockImplementation(async (_org: string, slug: string) =>
    slug === 'part' ? 'def_part' : slug === 'stock_movement' ? 'def_mv' : undefined
  )
  h.getCachedRecordRules.mockResolvedValue([
    { entityDefinitionId: 'def_variants', fieldId: 'fld_qty', managed: 'inventory' },
  ])
})

describe('deductInventory native handler', () => {
  it('fires the deduction core for a linked variant with the current cell + edge part', async () => {
    h.getLink.mockResolvedValue(link())

    await handler({ recordIds: ['def_variants:var_1'], organizationId: ORG })

    expect(h.deduct).toHaveBeenCalledTimes(1)
    const [, arg] = h.deduct.mock.calls[0]
    expect(arg).toMatchObject({
      organizationId: ORG,
      dataConnectorId: 'dc_1',
      sourceDefId: 'def_variants',
      cell: 7,
      currentPart: 'part_1',
      partDefId: 'def_part',
      movementDefId: 'def_mv',
    })
  })

  it('no-ops an unlinked variant (no InventoryBridgeLink)', async () => {
    h.getLink.mockResolvedValue(undefined)
    await handler({ recordIds: ['def_variants:var_1'], organizationId: ORG })
    expect(h.deduct).not.toHaveBeenCalled()
  })

  it('early-returns when the org has no part/movement def', async () => {
    h.getCachedEntityDefId.mockResolvedValue(undefined)
    h.getLink.mockResolvedValue(link())
    await handler({ recordIds: ['def_variants:var_1'], organizationId: ORG })
    expect(h.deduct).not.toHaveBeenCalled()
  })

  it('never throws when the deduction core fails for one record', async () => {
    h.getLink.mockResolvedValue(link())
    h.deduct.mockRejectedValue(new Error('boom'))
    await expect(
      handler({ recordIds: ['def_variants:var_1'], organizationId: ORG })
    ).resolves.toBeUndefined()
  })
})
