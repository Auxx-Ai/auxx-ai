// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/trigger-examples.test.ts

import { describe, expect, it } from 'vitest'
import { validateTriggerExamples } from '../trigger-examples'

describe('validateTriggerExamples', () => {
  it('accepts an empty array and well-formed entries', () => {
    expect(validateTriggerExamples([])).toBeNull()
    expect(
      validateTriggerExamples([
        { text: 'I want a refund', behavior: 'use' },
        { text: 'where is my order', behavior: 'avoid' },
      ])
    ).toBeNull()
  })

  it('rejects a non-array', () => {
    expect(validateTriggerExamples('nope')).toMatch(/must be an array/)
  })

  it('rejects a null element (the case that throws in the runtime classifier)', () => {
    expect(validateTriggerExamples([null])).toMatch(/triggerExamples\[0\]/)
  })

  it('rejects a missing/empty text', () => {
    expect(validateTriggerExamples([{ behavior: 'use' }])).toMatch(/text/)
    expect(validateTriggerExamples([{ text: '  ', behavior: 'use' }])).toMatch(/text/)
  })

  it('rejects an invalid behavior', () => {
    expect(validateTriggerExamples([{ text: 'x', behavior: 'maybe' }])).toMatch(/behavior/)
  })
})
