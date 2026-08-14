// packages/lib/src/workflow-engine/core/__tests__/interpolate-multi-scalar.test.ts
//
// Multi-value scalar fields (`options.multi` on EMAIL/URL/PHONE/…) resolve as
// arrays through the record-field lane (plan 04-multi-email B4):
//   1. Exact `{{path}}` resolution keeps the ARRAY shape — the server-side
//      output resolution a downstream multi-field write consumes.
//   2. String interpolation is a SCALAR context — the array interpolates as the
//      primary (first) value via `primaryValue`, never a joined list (a
//      send-email recipient of "a@x.com, b@x.com" is not an address).
//   3. Genuine array variables (tags, actionsPerformed, …) keep joining.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../execution-context'

vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResourceFields: vi.fn(async (_organizationId: string, resourceType: string) =>
    resourceType === 'def_contact'
      ? [
          {
            id: 'cf_email',
            key: 'email',
            label: 'Email',
            type: 'string',
            fieldType: 'EMAIL',
            options: { multi: true },
            capabilities: {},
          },
          {
            id: 'cf_name',
            key: 'name',
            label: 'Name',
            type: 'string',
            fieldType: 'TEXT',
            capabilities: {},
          },
        ]
      : []
  ),
}))

vi.mock('../../../field-values/field-value-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../field-values/field-value-queries')>()),
  batchGetValues: vi.fn(async (_ctx: unknown, params: any) => {
    const fieldRef = params.fieldReferences[0] as string
    if (fieldRef.includes('cf_email')) {
      return {
        values: [
          {
            recordId: params.recordIds[0],
            fieldRef,
            value: [
              { type: 'text', value: 'primary@x.com' },
              { type: 'text', value: 'alias@x.com' },
            ],
            fieldType: 'EMAIL',
            fieldOptions: { multi: true },
          },
        ],
      }
    }
    return {
      values: [
        {
          recordId: params.recordIds[0],
          fieldRef,
          value: { type: 'text', value: 'Ada' },
          fieldType: 'TEXT',
        },
      ],
    }
  }),
}))

describe('multi-value scalar fields in variable resolution', () => {
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    contextManager = new ExecutionContextManager(
      'test-workflow',
      'test-exec',
      'org_test',
      'user_test',
      'test@example.com',
      'Test User',
      'Test Org',
      'test-org'
    )
    // A record-shaped value, exactly what find/crud store for entity results.
    contextManager.setVariable('find1.contact', { id: 'rec_1', entityDefinitionId: 'def_contact' })
  })

  it('exact path resolution returns the ARRAY shape for a multi field', async () => {
    const value = await contextManager.resolveVariablePath('find1.contact.email')
    expect(value).toEqual(['primary@x.com', 'alias@x.com'])
  })

  it('string interpolation substitutes the PRIMARY value, not a joined list', async () => {
    const text = await contextManager.interpolateVariables('To: {{find1.contact.email}}')
    expect(text).toBe('To: primary@x.com')
  })

  it('single-value fields interpolate unchanged', async () => {
    const text = await contextManager.interpolateVariables('Hi {{find1.contact.name}}')
    expect(text).toBe('Hi Ada')
  })

  it('genuine array variables still join — the unwrap is field-scoped', async () => {
    contextManager.setVariable('n1.actionsPerformed', ['tagged', 'assigned'])
    const text = await contextManager.interpolateVariables('Did: {{n1.actionsPerformed}}')
    expect(text).toBe('Did: tagged, assigned')
  })

  it('an explicit index accessor bypasses the primary unwrap', async () => {
    const text = await contextManager.interpolateVariables('Alt: {{find1.contact.email[1]}}')
    expect(text).toBe('Alt: alias@x.com')
  })
})
