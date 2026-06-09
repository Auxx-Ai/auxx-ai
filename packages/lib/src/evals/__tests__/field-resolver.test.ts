// packages/lib/src/evals/__tests__/field-resolver.test.ts
//
// Validation-contract tests for the Simulation field overlay. Subject assembly
// is pure in-memory logic (dup-anchor detection + starting-field anchor checks),
// so these need no DB harness. Org safety is enforced downstream in
// `buildResolveVarSource` (FieldValueService scopes reads to the org); overlay
// precedence + subject delegation are exercised by the 1.12 integration tests.

import type { ResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import { buildSimulationFieldResolver } from '../simulation/field-resolver'

describe('buildSimulationFieldResolver', () => {
  it('rejects two records of the same entity type (one anchor per type)', () => {
    const result = buildSimulationFieldResolver({
      organizationId: 'org_1',
      subject: {
        recordIds: [toRecordId('contact', 'c1'), toRecordId('contact', 'c2')],
        identityVerified: true,
      },
      startingFields: [],
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('EVAL_VALIDATION')
      expect(result.error.message).toMatch(/Duplicate subject anchor/)
    }
  })

  it('rejects a starting field with no matching subject anchor', () => {
    const result = buildSimulationFieldResolver({
      organizationId: 'org_1',
      subject: { recordIds: [], identityVerified: false },
      startingFields: [{ ref: 'contact:email' as ResourceFieldId, value: 'x@y.com' }],
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('EVAL_VALIDATION')
      expect(result.error.message).toMatch(/no matching subject anchor/)
    }
  })

  it('builds an empty subject and a resolver factory for a persona-only run', () => {
    const result = buildSimulationFieldResolver({
      organizationId: 'org_1',
      subject: { recordIds: [], identityVerified: false, claimed: { name: 'Ada' } },
      startingFields: [],
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.subject.anchors).toEqual({})
      expect(result.value.subject.identityVerified).toBe(false)
      expect(result.value.subject.claimed).toEqual({ name: 'Ada' })
      expect(typeof result.value.makeResolver).toBe('function')
    }
  })
})
