// packages/lib/src/ai/agent-framework/context/__tests__/context-store.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../tool-context'

const EMAIL = 'contact:primary_email' as ResourceFieldId

import {
  CONTEXT_SLICE_KEY,
  KopilotContextStore,
  readContextSlice,
  syncContextSlice,
} from '../context-store'

// Stub the v8 field resolver so field reads are deterministic and call-counted.
const { resolveSpy } = vi.hoisted(() => ({ resolveSpy: vi.fn() }))
vi.mock('../../../../agents/bindings/resolve', () => ({
  buildResolveVarSource: () => resolveSpy,
}))

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: 'org1',
    userId: 'user1',
    sessionId: 'sess1',
    db: {} as never,
    agentName: 'Aux',
    now: 1_700_000_000_000,
    subject: { anchors: { contact: 'contact:c1' }, identityVerified: true },
    ...overrides,
  } as unknown as ToolContext
}

beforeEach(() => {
  resolveSpy.mockReset()
})

describe('KopilotContextStore', () => {
  describe('sys:*', () => {
    it('reads system values off the ctx', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      expect(await store.read('sys:userId')).toBe('user1')
      expect(await store.read('sys:organizationId')).toBe('org1')
      expect(await store.read('sys:agentName')).toBe('Aux')
      expect(await store.read('sys:now')).toBe(1_700_000_000_000)
    })

    it('falls back to capture-time for sys:now when ctx.now is absent', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx({ now: undefined }) })
      const now = await store.read('sys:now')
      expect(typeof now).toBe('number')
    })
  })

  describe('field source (v8)', () => {
    it('resolves a FieldReference off the subject and memoizes', async () => {
      resolveSpy.mockResolvedValue('a@b.c')
      const store = new KopilotContextStore({ ctx: makeCtx() })

      expect(await store.read(EMAIL)).toBe('a@b.c')
      expect(await store.read(EMAIL)).toBe('a@b.c')
      // Second read hits the memo — resolver invoked exactly once.
      expect(resolveSpy).toHaveBeenCalledTimes(1)
    })

    it('gates to undefined when there is no subject', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx({ subject: undefined }) })
      expect(await store.read(EMAIL)).toBeUndefined()
      expect(resolveSpy).not.toHaveBeenCalled()
    })
  })

  describe('var:*', () => {
    it('writes a whole value and reads a nested path back', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:cart', { total: 5, items: [{ id: 'a' }] })
      expect(await store.read('var:cart.total')).toBe(5)
      expect(await store.read('var:cart.items[0].id')).toBe('a')
    })

    it('sets a nested var path, creating intermediate objects', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:a.b.c', 1)
      expect(await store.read('var:a')).toEqual({ b: { c: 1 } })
    })

    it('rejects sys:* / tool:* writes (read-only / engine-owned)', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await expect(store.write('sys:userId', 'x')).rejects.toThrow(/var:\*/)
    })

    it('rejects field write-back with an explicit not-enabled error', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await expect(store.write(EMAIL, 'x')).rejects.toThrow(/Phase 5/)
    })

    it('hydrates var:* from an initial SerializedContext', async () => {
      const store = new KopilotContextStore({
        ctx: makeCtx(),
        initial: { vars: { plan: { step: 1 } } },
      })
      expect(await store.read('var:plan.step')).toBe(1)
    })
  })

  describe('interpolate', () => {
    it('replaces {{ref}} with display-formatted values', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:name', 'World')
      expect(await store.interpolate('hi {{sys:agentName}}, {{var:name}}')).toBe('hi Aux, World')
    })

    it('replaces a missing ref with empty string', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      expect(await store.interpolate('x={{var:nope}}')).toBe('x=')
    })
  })

  describe('tool:* / call:* capture views', () => {
    it('addresses latest / all / indexed / by-call-id without clobbering', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      store.captureToolResult('id1', 'get_order', { orders: [{ id: 'a' }] })
      store.captureToolResult('id2', 'get_order', { orders: [{ id: 'b' }] })
      store.captureToolResult('id3', 'get_order', { orders: [{ id: 'c' }] })

      expect(await store.read('tool:get_order')).toEqual({ orders: [{ id: 'c' }] }) // latest
      expect(await store.read('tool:get_order[0]')).toEqual({ orders: [{ id: 'a' }] }) // indexed
      expect(await store.read('call:id2')).toEqual({ orders: [{ id: 'b' }] }) // exact
      expect((await store.read('tool:get_order[]')) as unknown[]).toHaveLength(3) // all
      expect(await store.read('tool:get_order.orders[*].id')).toEqual(['c']) // walk latest
    })
  })

  describe('serialize / round-trip / resetTurn', () => {
    it('round-trips var:* and the turn sub-slice through serialize', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:keep', 1)
      store.captureToolResult('id1', 'foo', { ok: true })

      const restored = new KopilotContextStore({ ctx: makeCtx(), initial: store.serialize() })
      expect(await restored.read('var:keep')).toBe(1)
      expect(await restored.read('call:id1')).toEqual({ ok: true })
    })

    it('resetTurn clears captures but keeps var:*', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:keep', 1)
      store.captureToolResult('id1', 'foo', { ok: true })

      store.resetTurn()
      expect(await store.read('var:keep')).toBe(1)
      expect(await store.read('call:id1')).toBeUndefined()
    })
  })

  describe('persistence helpers', () => {
    it('syncContextSlice writes under __context and readContextSlice reads it back', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:a', 1)
      const domainState: Record<string, unknown> = {}

      syncContextSlice(domainState, store)
      expect(domainState[CONTEXT_SLICE_KEY]).toBeDefined()

      const slice = readContextSlice(domainState)
      expect(slice?.vars).toEqual({ a: 1 })
    })

    it('readContextSlice returns undefined for an absent/garbage slice', () => {
      expect(readContextSlice(undefined)).toBeUndefined()
      expect(readContextSlice({})).toBeUndefined()
      expect(readContextSlice({ [CONTEXT_SLICE_KEY]: 'nope' })).toBeUndefined()
    })
  })

  describe('list', () => {
    it('enumerates var keys, tool names, and call ids', async () => {
      const store = new KopilotContextStore({ ctx: makeCtx() })
      await store.write('var:x', 1)
      store.captureToolResult('id1', 'foo', {})

      const refs = store.list().map((e) => e.ref)
      expect(refs).toContain('var:x')
      expect(refs).toContain('tool:foo')
      expect(refs).toContain('call:id1')
    })
  })
})
