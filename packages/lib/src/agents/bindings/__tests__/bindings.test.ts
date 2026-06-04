// packages/lib/src/agents/bindings/__tests__/bindings.test.ts

import type { ResourceFieldId, VarSource } from '@auxx/types/field'
import { describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'
import type { AgentToolDefinition } from '../../../ai/agent-framework/types'
import { computeEffectiveBindings } from '../effective'
import { projectBindingSchemas } from '../project-schema'

// Mock the resolver so the clamp test stays pure (no FieldValueService / cache).
const resolveVarSource = vi.fn()
vi.mock('../resolve', () => ({
  buildResolveVarSource: () => resolveVarSource,
}))

import { buildApplyBindings } from '../apply'

const tool = (
  name: string,
  inputBindings?: AgentToolDefinition['inputBindings']
): Pick<AgentToolDefinition, 'name' | 'inputBindings'> => ({ name, inputBindings })

describe('computeEffectiveBindings', () => {
  it('uses author defaults when there are no overrides', () => {
    const def: VarSource = { kind: 'var', ref: 'contact:self' as ResourceFieldId }
    const effective = computeEffectiveBindings([
      tool('find_contact', [{ name: 'contactId', default: def }]),
    ])
    expect(effective).toEqual({ find_contact: { contactId: def } })
  })

  it('override wins over the author default (override ?? default)', () => {
    const def: VarSource = {
      kind: 'var',
      ref: 'contact:@app:shopify:customerId' as ResourceFieldId,
    }
    const override: VarSource = { kind: 'const', value: 'EU' }
    const effective = computeEffectiveBindings(
      [tool('orders', [{ name: 'region', default: def }])],
      { orders: { region: override } }
    )
    expect(effective).toEqual({ orders: { region: override } })
  })

  it('a model override is carried through (un-binds the default)', () => {
    const def: VarSource = {
      kind: 'var',
      ref: 'contact:@app:shopify:customerId' as ResourceFieldId,
    }
    const effective = computeEffectiveBindings(
      [tool('orders', [{ name: 'customerId', default: def }])],
      { orders: { customerId: { kind: 'model' } } }
    )
    expect(effective).toEqual({ orders: { customerId: { kind: 'model' } } })
  })

  it('omits tools with no bindings', () => {
    expect(computeEffectiveBindings([tool('noop')])).toEqual({})
  })
})

describe('projectBindingSchemas', () => {
  const params = () => ({
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Shopify customer id' },
      q: { type: 'string' },
    },
    required: ['customerId', 'q'],
  })

  it('keeps a required `var`-bound input in required[] (so the engine refuses on undefined)', () => {
    const [t] = projectBindingSchemas([{ name: 'orders', parameters: params() }], {
      orders: {
        customerId: { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
      },
    })
    const p = t!.parameters as {
      required: string[]
      properties: Record<string, { description?: string }>
    }
    expect(p.required).toContain('customerId')
    // ...and annotates the description so the model knows it's managed.
    expect(p.properties.customerId!.description).toMatch(/Automatically set by the workspace/)
  })

  it('drops a `const`-bound input from required[] (it always resolves)', () => {
    const [t] = projectBindingSchemas([{ name: 'orders', parameters: params() }], {
      orders: { customerId: { kind: 'const', value: 'X' } },
    })
    const p = t!.parameters as { required: string[] }
    expect(p.required).not.toContain('customerId')
    expect(p.required).toContain('q')
  })

  it('leaves a model-bound input untouched (not annotated, stays required)', () => {
    const [t] = projectBindingSchemas([{ name: 'orders', parameters: params() }], {
      orders: { customerId: { kind: 'model' } },
    })
    const p = t!.parameters as {
      required: string[]
      properties: Record<string, { description?: string }>
    }
    expect(p.required).toContain('customerId')
    expect(p.properties.customerId!.description).toBe('Shopify customer id')
  })
})

describe('buildApplyBindings (clamp)', () => {
  const subjectCtx = { subject: { anchors: {}, identityVerified: true } } as unknown as ToolContext

  it('passes args through untouched for a tool with no bindings', async () => {
    const apply = buildApplyBindings({})
    expect(await apply('t', { a: 1 }, subjectCtx)).toEqual({ ok: true, args: { a: 1 } })
  })

  it('overwrites a model-supplied value with the resolved binding', async () => {
    resolveVarSource.mockReset().mockResolvedValue('6789012345')
    const apply = buildApplyBindings({
      orders: {
        customerId: { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
      },
    })
    const result = await apply('orders', { customerId: 'spoofed-9999', status: 'any' }, subjectCtx)
    expect(result).toEqual({ ok: true, args: { customerId: '6789012345', status: 'any' } })
  })

  it('DELETES the input when the binding resolves to undefined (missing-input gate)', async () => {
    resolveVarSource.mockReset().mockResolvedValue(undefined)
    const apply = buildApplyBindings({
      orders: {
        customerId: { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
      },
    })
    const result = await apply('orders', { customerId: 'spoofed', status: 'any' }, subjectCtx)
    expect(result).toEqual({ ok: true, args: { status: 'any' } })
  })

  it('leaves a model-bound input to the LLM', async () => {
    resolveVarSource.mockReset()
    const apply = buildApplyBindings({ orders: { customerId: { kind: 'model' } } })
    const result = await apply('orders', { customerId: 'chosen' }, subjectCtx)
    expect(result).toEqual({ ok: true, args: { customerId: 'chosen' } })
    expect(resolveVarSource).not.toHaveBeenCalled()
  })

  it('falls through to the model on a turn with no subject (internal run)', async () => {
    resolveVarSource.mockReset()
    const apply = buildApplyBindings({
      orders: { customerId: { kind: 'var', ref: 'contact:self' as ResourceFieldId } },
    })
    const noSubject = {} as unknown as ToolContext
    const result = await apply('orders', { customerId: 'x' }, noSubject)
    expect(result).toEqual({ ok: true, args: { customerId: 'x' } })
    expect(resolveVarSource).not.toHaveBeenCalled()
  })

  it('does not mutate the input args object', async () => {
    resolveVarSource.mockReset().mockResolvedValue('v')
    const apply = buildApplyBindings({
      t: { a: { kind: 'var', ref: 'contact:self' as ResourceFieldId } },
    })
    const input = { a: 99 }
    await apply('t', input, subjectCtx)
    expect(input).toEqual({ a: 99 })
  })
})
