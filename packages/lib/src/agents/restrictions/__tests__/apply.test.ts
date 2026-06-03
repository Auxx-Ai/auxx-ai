// packages/lib/src/agents/restrictions/__tests__/apply.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'
import { buildApplyToolRestrictions } from '../apply'
import type { ToolRestrictionMap } from '../client'

// Minimal ToolContext stub — the hook only forwards it to `resolveVar`.
const ctx = {} as ToolContext

// Visitor turn: `ctx.invocation` present → author-floor fail-closed check runs.
const visitorCtx = {
  invocation: { threadId: 't_1', contactId: 'c_1' },
} as unknown as ToolContext

describe('buildApplyToolRestrictions', () => {
  it('passes through untouched when the tool has no restrictions', async () => {
    const apply = buildApplyToolRestrictions({})
    const result = await apply('find_contact', { email: 'a@b.com' }, ctx)
    expect(result).toEqual({ ok: true, args: { email: 'a@b.com' } })
  })

  it('constant override wins over the model-supplied arg', async () => {
    const restrictions: ToolRestrictionMap = {
      find_contact: { contactId: { source: 'constant', value: 'verified-123' } },
    }
    const apply = buildApplyToolRestrictions(restrictions)
    const result = await apply('find_contact', { contactId: 'spoofed', q: 'hi' }, ctx)
    expect(result).toEqual({ ok: true, args: { contactId: 'verified-123', q: 'hi' } })
  })

  it('does not mutate the input args object', async () => {
    const restrictions: ToolRestrictionMap = {
      t: { a: { source: 'constant', value: 1 } },
    }
    const apply = buildApplyToolRestrictions(restrictions)
    const input = { a: 99 }
    await apply('t', input, ctx)
    expect(input).toEqual({ a: 99 })
  })

  it('refuses with arg_not_bound when a required arg resolves null/undefined', async () => {
    const restrictions: ToolRestrictionMap = {
      list_orders: { customerId: { source: 'var', var: 'visitor.customerId', required: true } },
    }
    // No resolveVar → var source is a no-op, so the required arg stays unset.
    const apply = buildApplyToolRestrictions(restrictions)
    const result = await apply('list_orders', {}, ctx)
    expect(result).toEqual({
      ok: false,
      error: 'arg_not_bound: "customerId" required for list_orders',
    })
  })

  it('leaves a model-source arg untouched', async () => {
    const restrictions: ToolRestrictionMap = {
      t: { a: { source: 'model' } },
    }
    const apply = buildApplyToolRestrictions(restrictions)
    const result = await apply('t', { a: 'model-chose-this' }, ctx)
    expect(result).toEqual({ ok: true, args: { a: 'model-chose-this' } })
  })

  it('resolves a var source via the provided resolveVar', async () => {
    const restrictions: ToolRestrictionMap = {
      list_orders: { customerId: { source: 'var', var: 'visitor.customerId', required: true } },
    }
    const resolveVar = vi.fn().mockResolvedValue('cust-789')
    const apply = buildApplyToolRestrictions(restrictions, resolveVar)
    const result = await apply('list_orders', { customerId: 'ignored' }, ctx)
    expect(resolveVar).toHaveBeenCalledWith('visitor.customerId', ctx)
    expect(result).toEqual({ ok: true, args: { customerId: 'cust-789' } })
  })

  it('refuses when a required var resolves to null', async () => {
    const restrictions: ToolRestrictionMap = {
      list_orders: { customerId: { source: 'var', var: 'visitor.customerId', required: true } },
    }
    const resolveVar = vi.fn().mockResolvedValue(null)
    const apply = buildApplyToolRestrictions(restrictions, resolveVar)
    const result = await apply('list_orders', {}, ctx)
    expect(result).toEqual({
      ok: false,
      error: 'arg_not_bound: "customerId" required for list_orders',
    })
  })

  describe('author-floor fail-closed', () => {
    const idScoped = {
      list_orders: [{ name: 'customerId', suggestedVar: 'visitor.shopify.customerId' }],
    }

    it('refuses (visitor_not_identified) on a visitor turn when an identity arg is unbound', async () => {
      // Tool declares an identity-scoped arg but the admin set no restriction.
      const apply = buildApplyToolRestrictions({}, undefined, idScoped)
      const result = await apply('list_orders', { customerId: 'spoofed' }, visitorCtx)
      expect(result).toEqual({ ok: false, error: 'visitor_not_identified' })
    })

    it('refuses on a visitor turn with ZERO restriction entries (forgot-to-bind)', async () => {
      // Restriction map has no entry for the tool at all → perTool undefined.
      const apply = buildApplyToolRestrictions({}, undefined, idScoped)
      const result = await apply('list_orders', {}, visitorCtx)
      expect(result).toEqual({ ok: false, error: 'visitor_not_identified' })
    })

    it('allows when the identity arg is bound via a var that resolves non-null', async () => {
      const restrictions: ToolRestrictionMap = {
        list_orders: {
          customerId: { source: 'var', var: 'visitor.shopify.customerId', required: true },
        },
      }
      const resolveVar = vi.fn().mockResolvedValue('cust-789')
      const apply = buildApplyToolRestrictions(restrictions, resolveVar, idScoped)
      const result = await apply('list_orders', {}, visitorCtx)
      expect(result).toEqual({ ok: true, args: { customerId: 'cust-789' } })
    })

    it('allows on an internal turn (no ctx.invocation) even when the identity arg is unbound', async () => {
      // Fail-open: internal runs skip the author-floor check entirely.
      const apply = buildApplyToolRestrictions({}, undefined, idScoped)
      const result = await apply('list_orders', { q: 'hi' }, ctx)
      expect(result).toEqual({ ok: true, args: { q: 'hi' } })
    })

    it('allows when the identity arg is bound to a constant (platform value)', async () => {
      // A constant is a platform-owned value, so it satisfies the floor and
      // overrides whatever the model supplied.
      const restrictions: ToolRestrictionMap = {
        list_orders: { customerId: { source: 'constant', value: 'cust-const' } },
      }
      const apply = buildApplyToolRestrictions(restrictions, undefined, idScoped)
      const result = await apply('list_orders', { customerId: 'spoofed' }, visitorCtx)
      expect(result).toEqual({ ok: true, args: { customerId: 'cust-const' } })
    })

    it('refuses when ANY of several identity args is left unbound', async () => {
      const multiIdScoped = {
        list_orders: [
          { name: 'customerId', suggestedVar: 'visitor:app:shopify:customerId' },
          { name: 'storeId', suggestedVar: 'visitor:app:shopify:storeId' },
        ],
      }
      // Only customerId is bound; storeId is left to the model.
      const restrictions: ToolRestrictionMap = {
        list_orders: { customerId: { source: 'var', var: 'visitor:app:shopify:customerId' } },
      }
      const resolveVar = vi.fn().mockResolvedValue('cust-789')
      const apply = buildApplyToolRestrictions(restrictions, resolveVar, multiIdScoped)
      const result = await apply('list_orders', { storeId: 'spoofed' }, visitorCtx)
      expect(result).toEqual({ ok: false, error: 'visitor_not_identified' })
    })

    // SECURITY BOUNDARY: a `model`-source binding clamps nothing, so it must NOT
    // satisfy the author-floor — the LLM could otherwise supply someone else's
    // id. Only a `constant` or a resolved `var` counts as a platform binding.
    it('refuses a model-bound identity arg on a visitor turn', async () => {
      const restrictions: ToolRestrictionMap = {
        list_orders: { customerId: { source: 'model' } },
      }
      const apply = buildApplyToolRestrictions(restrictions, undefined, idScoped)
      const result = await apply(
        'list_orders',
        { customerId: 'orders-for-someone-else' },
        visitorCtx
      )
      expect(result).toEqual({ ok: false, error: 'visitor_not_identified' })
    })

    // A malformed `var` binding with no var id can't resolve to a platform
    // value, so it must not satisfy the floor either (the UI blocks saving this,
    // but the warn-not-reject API setter doesn't).
    it('refuses a var-source identity binding that has no var id', async () => {
      const restrictions: ToolRestrictionMap = {
        list_orders: { customerId: { source: 'var' } },
      }
      const apply = buildApplyToolRestrictions(restrictions, vi.fn(), idScoped)
      const result = await apply('list_orders', { customerId: 'spoofed' }, visitorCtx)
      expect(result).toEqual({ ok: false, error: 'visitor_not_identified' })
    })
  })
})
