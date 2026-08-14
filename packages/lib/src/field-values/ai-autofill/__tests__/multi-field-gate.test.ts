// packages/lib/src/field-values/ai-autofill/__tests__/multi-field-gate.test.ts
//
// B5/B6 (multi-email plan): AI autofill is GATED OFF multi-value scalar fields
// (`options.multi`) — the commit path is a whole-field replace, so a generated
// value would wipe the stored alias list. `isAiField` gates the whole pipeline
// (enqueue short-circuit, worker generation, reference resolution);
// `buildJsonSchema` throws as defense in depth for callers that skip the gate.

import type { CustomFieldEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { isAiField } from '../../../custom-fields/ai'
import { BadRequestError } from '../../../errors'
import { buildJsonSchema } from '../json-schema-builder'

function field(overrides: Partial<CustomFieldEntity>): CustomFieldEntity {
  return {
    id: 'fld_1',
    type: 'EMAIL',
    options: {},
    ...overrides,
  } as CustomFieldEntity
}

describe('isAiField — multi-value gate', () => {
  it('gates an ai-enabled field OFF once it is flagged multi', async () => {
    const single = field({ options: { ai: { enabled: true } } })
    const multi = field({ options: { ai: { enabled: true }, multi: true } })

    expect(isAiField(single)).toBe(true)
    expect(isAiField(multi)).toBe(false)
  })

  it('keeps MULTI_SELECT eligible — inherently multi via TYPE, not options.multi', async () => {
    const multiSelect = field({
      type: 'MULTI_SELECT',
      options: { ai: { enabled: true }, options: [{ id: 'a', value: 'a', label: 'A' }] },
    })
    expect(isAiField(multiSelect)).toBe(true)
  })
})

describe('buildJsonSchema — multi-value defense in depth', () => {
  it('throws for a multi-value scalar field even when a caller skipped the gate', async () => {
    expect(() => buildJsonSchema(field({ options: { multi: true } }))).toThrow(BadRequestError)
  })

  it('still builds the scalar schema for single-value fields', async () => {
    expect(buildJsonSchema(field({}))).toMatchObject({
      schema: { properties: { value: { type: 'string' } } },
    })
  })
})
