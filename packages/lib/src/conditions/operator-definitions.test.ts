// packages/lib/src/conditions/operator-definitions.test.ts

import { FieldType, FieldTypeValues } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'
import { BaseType } from '../workflow-engine/core/types'
import { mapFieldTypeToBaseType as mapFieldTypeToBaseTypeForWorkflow } from '../workflow-engine/utils/field-type-mapper'
import { mapFieldTypeToBaseType as mapFieldTypeToBaseTypeForConditions } from './operator-definitions'

/**
 * Two independent `mapFieldTypeToBaseType` copies exist — this one
 * (`conditions/operator-definitions.ts`) and
 * `workflow-engine/utils/field-type-mapper.ts`. Both are now exhaustive
 * switches over every `FieldType` member (a new member fails to compile in
 * either file, via a `const _exhaustive: never` guard), but they are
 * deliberately NOT unified: `ADDRESS`, `CALC`, and the unknown/default
 * fallback diverge on purpose (see the comment above each function). This
 * table pins those divergences AS divergences — if either function's output
 * for a shared case ever drifts apart from this table, that's a real
 * regression; if `ADDRESS`/`CALC`/default ever start agreeing, that's fine,
 * but this test should be updated deliberately, not by an unrelated change.
 */
const EXPECTED: Record<
  (typeof FieldTypeValues)[number],
  { workflow: BaseType; conditions: BaseType }
> = {
  TEXT: { workflow: BaseType.STRING, conditions: BaseType.STRING },
  NAME: { workflow: BaseType.STRING, conditions: BaseType.STRING },
  RICH_TEXT: { workflow: BaseType.STRING, conditions: BaseType.STRING },
  NUMBER: { workflow: BaseType.NUMBER, conditions: BaseType.NUMBER },
  EMAIL: { workflow: BaseType.EMAIL, conditions: BaseType.EMAIL },
  URL: { workflow: BaseType.URL, conditions: BaseType.URL },
  PHONE_INTL: { workflow: BaseType.PHONE, conditions: BaseType.PHONE },
  DATE: { workflow: BaseType.DATE, conditions: BaseType.DATE },
  DATETIME: { workflow: BaseType.DATETIME, conditions: BaseType.DATETIME },
  TIME: { workflow: BaseType.TIME, conditions: BaseType.TIME },
  CHECKBOX: { workflow: BaseType.BOOLEAN, conditions: BaseType.BOOLEAN },
  TAGS: { workflow: BaseType.TAGS, conditions: BaseType.TAGS },
  SINGLE_SELECT: { workflow: BaseType.ENUM, conditions: BaseType.ENUM },
  MULTI_SELECT: { workflow: BaseType.ARRAY, conditions: BaseType.ARRAY },
  // Intentional divergence: free-text address (workflow) vs. structured
  // address operator set (conditions).
  ADDRESS: { workflow: BaseType.STRING, conditions: BaseType.ADDRESS },
  ADDRESS_STRUCT: { workflow: BaseType.ADDRESS, conditions: BaseType.ADDRESS },
  CURRENCY: { workflow: BaseType.CURRENCY, conditions: BaseType.CURRENCY },
  FILE: { workflow: BaseType.FILE, conditions: BaseType.FILE },
  RELATIONSHIP: { workflow: BaseType.RELATION, conditions: BaseType.RELATION },
  // Intentional divergence: workflow treats an unrecognized CALC as its
  // generic unknown-type fallback (STRING, with a console warning) because a
  // CALC field reaching a workflow node is unexpected; conditions maps CALC
  // to ANY on purpose so every operator stays a candidate for it.
  CALC: { workflow: BaseType.STRING, conditions: BaseType.ANY },
  ACTOR: { workflow: BaseType.ACTOR, conditions: BaseType.ACTOR },
  JSON: { workflow: BaseType.JSON, conditions: BaseType.JSON },
}

describe('mapFieldTypeToBaseType — workflow vs. conditions', () => {
  it('covers every FieldType member (guards the pinned table above against enum drift)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...FieldTypeValues].sort())
  })

  it.each(FieldTypeValues)('%s', (fieldType) => {
    const expected = EXPECTED[fieldType]
    expect(mapFieldTypeToBaseTypeForWorkflow(fieldType)).toBe(expected.workflow)
    expect(mapFieldTypeToBaseTypeForConditions(fieldType)).toBe(expected.conditions)
  })

  it('falls back — workflow warns and defaults to STRING, conditions fails open to ANY', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(mapFieldTypeToBaseTypeForWorkflow('NOT_A_REAL_FIELD_TYPE')).toBe(BaseType.STRING)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }

    expect(mapFieldTypeToBaseTypeForConditions('NOT_A_REAL_FIELD_TYPE')).toBe(BaseType.ANY)
  })

  it('sanity: FieldType is still a real member of the const object used in switches', () => {
    for (const fieldType of FieldTypeValues) {
      expect(FieldType).toHaveProperty(fieldType, fieldType)
    }
  })
})
