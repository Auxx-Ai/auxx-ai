// packages/lib/src/agents/restrictions/__tests__/project-schema.test.ts

import { describe, expect, it } from 'vitest'
import type { ArgRestriction } from '../client'
import { projectToolSchema } from '../project-schema'

const params = {
  type: 'object',
  properties: {
    contactId: { type: 'string', description: 'The contact to scope to.' },
    q: { type: 'string' },
  },
  required: ['contactId', 'q'],
}

describe('projectToolSchema', () => {
  it('returns the input unchanged when there are no restrictions', () => {
    expect(projectToolSchema(params, undefined)).toBe(params)
    expect(projectToolSchema(params, {})).toBe(params)
  })

  it('drops a constant-bound arg from required and annotates its description', () => {
    const restrictions: Record<string, ArgRestriction> = {
      contactId: { source: 'constant', value: 'x' },
    }
    const out = projectToolSchema(params, restrictions)
    expect(out.required).toEqual(['q'])
    const props = out.properties as Record<string, { description?: string }>
    expect(props.contactId.description).toBe(
      'The contact to scope to. Automatically set by the workspace; any value you provide is ignored.'
    )
    // contactId stays visible in properties.
    expect(props.contactId).toBeDefined()
  })

  it('does not mutate the input schema', () => {
    const restrictions: Record<string, ArgRestriction> = {
      contactId: { source: 'constant', value: 'x' },
    }
    projectToolSchema(params, restrictions)
    expect(params.required).toEqual(['contactId', 'q'])
    expect((params.properties.contactId as { description: string }).description).toBe(
      'The contact to scope to.'
    )
  })

  it('drops from required but does NOT annotate for a plain model/required-only restriction', () => {
    const restrictions: Record<string, ArgRestriction> = {
      contactId: { source: 'model', required: true },
    }
    const out = projectToolSchema(params, restrictions)
    expect(out.required).toEqual(['q'])
    const props = out.properties as Record<string, { description?: string }>
    expect(props.contactId.description).toBe('The contact to scope to.')
  })

  it('removes the required array entirely when all required args are bound', () => {
    const restrictions: Record<string, ArgRestriction> = {
      contactId: { source: 'constant', value: 'x' },
      q: { source: 'constant', value: 'y' },
    }
    const out = projectToolSchema(params, restrictions)
    expect(out.required).toBeUndefined()
  })
})
