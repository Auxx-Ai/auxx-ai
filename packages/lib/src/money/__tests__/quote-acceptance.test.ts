// packages/lib/src/money/__tests__/quote-acceptance.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import { validateSelectedLineIds } from '../quote-acceptance'

describe('validateSelectedLineIds (money plan 18 §5 step 2)', () => {
  it('returns a selection set when every submitted id is one of the optional lines', () => {
    const result = validateSelectedLineIds(['opt-1', 'opt-2', 'opt-3'], ['opt-1', 'opt-3'])
    expect(result).toEqual(new Set(['opt-1', 'opt-3']))
  })

  it('treats an empty submission as deselecting every optional line (not an error)', () => {
    const result = validateSelectedLineIds(['opt-1', 'opt-2'], [])
    expect(result.size).toBe(0)
  })

  it("rejects an id that is not one of the quote's optional lines (unknown id)", () => {
    expect(() => validateSelectedLineIds(['opt-1', 'opt-2'], ['not-a-real-line'])).toThrow(
      BadRequestError
    )
  })

  it('rejects an id belonging to a required (non-optional) line rather than silently ignoring it', () => {
    // required-line-9 is a real line instance id, but it's not in the optional-lines list —
    // the caller must reject it, not drop it, per plan 18 §5 step 2.
    expect(() => validateSelectedLineIds(['opt-1'], ['opt-1', 'required-line-9'])).toThrow(
      /required-line-9/
    )
  })

  it('is order-independent and de-duplicates the returned set', () => {
    const result = validateSelectedLineIds(['opt-1', 'opt-2'], ['opt-2', 'opt-1', 'opt-2'])
    expect(result).toEqual(new Set(['opt-1', 'opt-2']))
  })
})
