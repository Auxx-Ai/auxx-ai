// packages/lib/src/builds/__tests__/auto-build-rule.test.ts
//
// The ONE surviving system-rule declaration and its native handler
// (plans/products/12-order-triggered-build.md §6.2, AB6/AB9). Asserts the shape
// `assertSystemRuleShape` enforces, that it resolves against a real org's def
// and field maps, and — the load-bearing one — that the handler cannot throw.
//
// 🛑 It also asserts that the RAISE rule is gone (plans/products/13 Q13). That
// is a guard, not a formality: a second declaration here is a second raise door.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const ORDER_DEF = 'def_orders'
const CANCELLED_FIELD = 'fld_order_cancelled_at'

const h = vi.hoisted(() => ({
  cancelCalls: [] as { orgId: string; orderIds: string[] }[],
  cancelThrows: false,
  cancelErrs: false,
}))

vi.mock('../auto-build-cancel', () => ({
  cancelAutoBuildsForOrders: vi.fn(async (_db: unknown, orgId: string, orderIds: string[]) => {
    h.cancelCalls.push({ orgId, orderIds })
    if (h.cancelThrows) throw new Error('cancel blew up')
    const { err, ok } = await import('neverthrow')
    if (h.cancelErrs) return err(new Error('orchestrator refused'))
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
  CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED,
  registerAutoBuildRules,
} from '../auto-build-rule'

beforeEach(() => {
  vi.clearAllMocks()
  h.cancelCalls = []
  h.cancelThrows = false
  h.cancelErrs = false
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

describe('the declaration', () => {
  it('🛑 Q13 — declares EXACTLY ONE rule, and it is the cancellation rule', () => {
    const keys = getSystemRuleDeclarations().map((d) => d.key)
    expect(
      keys,
      'plans/products/13 Q13: convergence (`reconcileOrderBuilds`) is the ONLY door that ' +
        "raises an order's builds. A second declaration here — in particular a revived " +
        '`auto-build-from-order` on `created` — is a SECOND raise door: it dispatches at sync ' +
        'finalize while the drain runs post-commit of the same write, both read "no build ' +
        'exists for this part", and both raise. `planOrderBuildConvergence` then amends only ' +
        'the oldest planned build per pair and marks the rest `duplicate-build`, which is a ' +
        'skip and never a cancel — so the extra build is permanent until a person cancels it ' +
        'by hand. Do not reintroduce one; see plan 13 §1.6 and events/08 R6(c).'
    ).toEqual(['auto-build-cancel-on-order-cancelled'])
  })

  it('is all-native and on the native order def', () => {
    const decls = getSystemRuleDeclarations()
    // 🛑 AB3 — the native `order`, never `shopify_orders`. Only a native
    // `line_item` carries `line_item_part`.
    expect(decls.every((d) => d.defSlug === 'orders')).toBe(true)
    expect(decls.every((d) => d.actions.every((a) => a.type === 'native'))).toBe(true)
  })

  it('watches `order_cancelled_at` being set (AB6/AB9)', () => {
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
    expect(getSystemRuleDeclarations()).toHaveLength(1)
  })

  it('registers the native handler under the key the declaration names', () => {
    expect(getNativeRuleHandler(CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED)).toBeTypeOf('function')
  })
})

describe('resolution against an org', () => {
  const lookup = {
    defIdBySlug: (slug: string) => (slug === 'orders' ? ORDER_DEF : undefined),
    fieldIdBySystemAttribute: (defId: string, attr: string) =>
      defId === ORDER_DEF && attr === 'order_cancelled_at' ? CANCELLED_FIELD : undefined,
  }

  it('resolves for an org that has the def and the field', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), lookup)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.id).toBe('system:auto-build-cancel-on-order-cancelled')
    expect(resolved[0]!.entityDefinitionId).toBe(ORDER_DEF)
    expect(resolved[0]!.isSystem).toBe(true)
    expect(resolved[0]!.fieldId).toBe(CANCELLED_FIELD)
  })

  it('drops the rule for an org with no orders def', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), {
      ...lookup,
      defIdBySlug: () => undefined,
    })
    expect(resolved).toEqual([])
  })

  it('drops the rule for an org missing `order_cancelled_at`', () => {
    const resolved = resolveSystemRules(ORG, getSystemRuleDeclarations(), {
      ...lookup,
      fieldIdBySystemAttribute: () => undefined,
    })
    expect(resolved).toEqual([])
  })
})

describe('the native handler', () => {
  const handler = () => getNativeRuleHandler(CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED)!

  it('turns record ids into instance ids and hands them to the orchestrator', async () => {
    // Field firings carry no `action`; the cancellation handler must not gate on one.
    await handler()({
      recordIds: [`${ORDER_DEF}:ord_1`, `${ORDER_DEF}:ord_2`],
      organizationId: ORG,
    } as never)
    expect(h.cancelCalls).toEqual([{ orgId: ORG, orderIds: ['ord_1', 'ord_2'] }])
  })

  it('🛑 never throws when the orchestrator returns an err', async () => {
    h.cancelErrs = true
    await expect(
      handler()({ recordIds: [`${ORDER_DEF}:ord_1`], organizationId: ORG } as never)
    ).resolves.toBeUndefined()
  })

  it('🛑 never throws when the orchestrator throws outright', async () => {
    h.cancelThrows = true
    await expect(
      handler()({ recordIds: [`${ORDER_DEF}:ord_1`], organizationId: ORG } as never)
    ).resolves.toBeUndefined()
  })
})
