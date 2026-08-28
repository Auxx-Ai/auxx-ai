// packages/lib/src/builds/__tests__/auto-build-rule.test.ts
//
// The two system-rule declarations and their native handlers
// (plans/products/12-order-triggered-build.md §5.1, §6.2). Asserts the shape
// `assertSystemRuleShape` enforces, that they resolve against a real org's def
// and field maps, and — the load-bearing one — that neither handler can throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const ORDER_DEF = 'def_orders'
const CANCELLED_FIELD = 'fld_order_cancelled_at'

const h = vi.hoisted(() => ({
  autoBuildCalls: [] as { orgId: string; orderIds: string[] }[],
  cancelCalls: [] as { orgId: string; orderIds: string[] }[],
  autoBuildThrows: false,
  autoBuildErrs: false,
  cancelThrows: false,
}))

vi.mock('../auto-build', () => ({
  runAutoBuildForOrders: vi.fn(async (_db: unknown, orgId: string, orderIds: string[]) => {
    h.autoBuildCalls.push({ orgId, orderIds })
    if (h.autoBuildThrows) throw new Error('handler blew up')
    const { err, ok } = await import('neverthrow')
    if (h.autoBuildErrs) return err(new Error('orchestrator refused'))
    return ok({ ordersConsidered: orderIds.length, created: [], skipped: [], failed: [] })
  }),
}))

vi.mock('../auto-build-cancel', () => ({
  cancelAutoBuildsForOrders: vi.fn(async (_db: unknown, orgId: string, orderIds: string[]) => {
    h.cancelCalls.push({ orgId, orderIds })
    if (h.cancelThrows) throw new Error('cancel blew up')
    const { ok } = await import('neverthrow')
    return ok({ ordersCancelled: orderIds.length, outcomes: [], failed: [], deleted: 0 })
  }),
}))

import { __clearNativeRuleHandlers, getNativeRuleHandler } from '../../record-rules/actions'
import {
  __clearSystemRules,
  getSystemRuleDeclarations,
  resolveSystemRules,
} from '../../record-rules/system-rules'
import {
  __resetAutoBuildRulesLatch,
  AUTO_BUILD_FROM_ORDER,
  CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED,
  registerAutoBuildRules,
} from '../auto-build-rule'

beforeEach(() => {
  vi.clearAllMocks()
  h.autoBuildCalls = []
  h.cancelCalls = []
  h.autoBuildThrows = false
  h.autoBuildErrs = false
  h.cancelThrows = false
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetAutoBuildRulesLatch()
  registerAutoBuildRules()
})

afterEach(() => {
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetAutoBuildRulesLatch()
})

const decl = (key: string) => getSystemRuleDeclarations().find((d) => d.key === key)!

describe('the declarations', () => {
  it('declares exactly two rules, both all-native, both on the native order def', () => {
    const decls = getSystemRuleDeclarations()
    expect(decls).toHaveLength(2)
    expect(decls.map((d) => d.key).sort()).toEqual([
      'auto-build-cancel-on-order-cancelled',
      'auto-build-from-order',
    ])
    // 🛑 AB3 — the native `order`, never `shopify_orders`. Only a native
    // `line_item` carries `line_item_part`.
    expect(decls.every((d) => d.defSlug === 'orders')).toBe(true)
    expect(decls.every((d) => d.actions.every((a) => a.type === 'native'))).toBe(true)
  })

  it('the create rule is a LIFECYCLE rule with no fieldRef', () => {
    const rule = decl('auto-build-from-order')
    expect(rule.on).toBe('created')
    expect(rule.fieldRef).toBeUndefined()
    expect(rule.actions).toEqual([{ type: 'native', handler: AUTO_BUILD_FROM_ORDER }])
  })

  it('the cancellation rule watches `order_cancelled_at` being set (AB6/AB9)', () => {
    const rule = decl('auto-build-cancel-on-order-cancelled')
    expect(rule.on).toBe('set')
    expect(rule.fieldRef).toEqual({ systemAttribute: 'order_cancelled_at' })
    expect(rule.actions).toEqual([
      { type: 'native', handler: CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED },
    ])
  })

  it('is idempotent — a second registration does not duplicate anything', () => {
    __resetAutoBuildRulesLatch()
    registerAutoBuildRules()
    expect(getSystemRuleDeclarations()).toHaveLength(2)
  })

  it('registers both native handlers under the keys the declarations name', () => {
    expect(getNativeRuleHandler(AUTO_BUILD_FROM_ORDER)).toBeTypeOf('function')
    expect(getNativeRuleHandler(CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED)).toBeTypeOf('function')
  })
})

describe('resolution against an org', () => {
  const lookup = {
    defIdBySlug: (slug: string) => (slug === 'orders' ? ORDER_DEF : undefined),
    fieldIdBySystemAttribute: (defId: string, attr: string) =>
      defId === ORDER_DEF && attr === 'order_cancelled_at' ? CANCELLED_FIELD : undefined,
  }

  it('resolves both rules for an org that has the def and the field', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), lookup)
    expect(resolved).toHaveLength(2)
    expect(resolved.map((r) => r.id).sort()).toEqual([
      'system:auto-build-cancel-on-order-cancelled',
      'system:auto-build-from-order',
    ])
    expect(resolved.every((r) => r.entityDefinitionId === ORDER_DEF && r.isSystem)).toBe(true)
    // The lifecycle rule keeps `fieldId: null`; the field rule resolves to a row id.
    expect(resolved.find((r) => r.on === 'created')!.fieldId).toBeNull()
    expect(resolved.find((r) => r.on === 'set')!.fieldId).toBe(CANCELLED_FIELD)
  })

  it('drops BOTH rules for an org with no orders def', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), {
      ...lookup,
      defIdBySlug: () => undefined,
    })
    expect(resolved).toEqual([])
  })

  it('drops only the cancellation rule for an org missing `order_cancelled_at`', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), {
      ...lookup,
      fieldIdBySystemAttribute: () => undefined,
    })
    expect(resolved.map((r) => r.on)).toEqual(['created'])
  })
})

describe('the native handlers', () => {
  const event = (recordIds: string[]) =>
    ({ recordIds, organizationId: ORG, action: 'created' }) as never

  it('turns record ids into instance ids and hands them to the orchestrator', async () => {
    await getNativeRuleHandler(AUTO_BUILD_FROM_ORDER)!(
      event([`${ORDER_DEF}:ord_1`, `${ORDER_DEF}:ord_2`])
    )
    expect(h.autoBuildCalls).toEqual([{ orgId: ORG, orderIds: ['ord_1', 'ord_2'] }])
  })

  it('ignores a firing that is not a create', async () => {
    await getNativeRuleHandler(AUTO_BUILD_FROM_ORDER)!({
      recordIds: [`${ORDER_DEF}:ord_1`],
      organizationId: ORG,
      action: 'deleted',
    } as never)
    expect(h.autoBuildCalls).toEqual([])
  })

  it('🛑 never throws when the orchestrator returns an err', async () => {
    h.autoBuildErrs = true
    await expect(
      getNativeRuleHandler(AUTO_BUILD_FROM_ORDER)!(event([`${ORDER_DEF}:ord_1`]))
    ).resolves.toBeUndefined()
  })

  it('🛑 never throws when the orchestrator throws outright', async () => {
    h.autoBuildThrows = true
    await expect(
      getNativeRuleHandler(AUTO_BUILD_FROM_ORDER)!(event([`${ORDER_DEF}:ord_1`]))
    ).resolves.toBeUndefined()
  })

  it('the cancellation handler forwards its instance ids, and never throws', async () => {
    const handler = getNativeRuleHandler(CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED)!
    // Field firings carry no `action`; the cancellation handler must not gate on one.
    await handler({ recordIds: [`${ORDER_DEF}:ord_1`], organizationId: ORG } as never)
    expect(h.cancelCalls).toEqual([{ orgId: ORG, orderIds: ['ord_1'] }])

    h.cancelThrows = true
    await expect(
      handler({ recordIds: [`${ORDER_DEF}:ord_2`], organizationId: ORG } as never)
    ).resolves.toBeUndefined()
  })
})
