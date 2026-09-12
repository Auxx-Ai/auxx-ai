// packages/lib/src/returns/__tests__/status.test.ts

/**
 * `status.ts` re-declares four closed vocabularies the resource registry also
 * declares, because it has to stay loadable in a browser bundle while the
 * registry reaches `@auxx/database`. These tests are what stop the duplication
 * from drifting: a value added to the registry and not here would be stored
 * happily and then read as `null` by every consumer of these unions.
 */

import { describe, expect, it } from 'vitest'
import {
  RETURN_ORIGIN_OPTIONS,
  RETURN_STATUS_OPTIONS,
} from '../../resources/registry/resources/return-fields'
import {
  RETURN_LINE_CONDITION_GRADE_OPTIONS,
  RETURN_LINE_LIABILITY_OPTIONS,
} from '../../resources/registry/resources/return-line-fields'
import {
  isPreInspectionStatus,
  PRE_INSPECTION_RETURN_STATUSES,
  RETURN_LINE_CONDITION_GRADES,
  RETURN_LINE_LIABILITIES,
  RETURN_ORIGINS,
  RETURN_STATUSES,
  type ReturnStatus,
  toReturnStatus,
} from '../status'

describe('the vocabularies match the resource registry', () => {
  it('return_status', () => {
    expect([...RETURN_STATUSES]).toEqual(RETURN_STATUS_OPTIONS.map((option) => option.value))
  })

  it('return_origin', () => {
    expect([...RETURN_ORIGINS]).toEqual(RETURN_ORIGIN_OPTIONS.map((option) => option.value))
  })

  it('return_line_condition_grade', () => {
    expect([...RETURN_LINE_CONDITION_GRADES]).toEqual(
      RETURN_LINE_CONDITION_GRADE_OPTIONS.map((option) => option.value)
    )
  })

  it('return_line_liability', () => {
    expect([...RETURN_LINE_LIABILITIES]).toEqual(
      RETURN_LINE_LIABILITY_OPTIONS.map((option) => option.value)
    )
  })
})

describe('toReturnStatus', () => {
  it('narrows a stored option id', () => {
    expect(toReturnStatus('in_transit')).toBe('in_transit')
  })

  it('rejects anything else, including the shapes a missing value takes', () => {
    expect(toReturnStatus('resolved')).toBeNull()
    expect(toReturnStatus(null)).toBeNull()
    expect(toReturnStatus(undefined)).toBeNull()
    expect(toReturnStatus(4)).toBeNull()
  })
})

describe('isPreInspectionStatus', () => {
  it('is true for every status short of an inspection', () => {
    expect(RETURN_STATUSES.filter(isPreInspectionStatus)).toEqual([
      'requested',
      'approved',
      'in_transit',
      'received',
    ])
  })

  it('is false once the goods have been looked at, and on both exits', () => {
    for (const status of ['inspected', 'closed', 'declined', 'cancelled'] as const) {
      expect(isPreInspectionStatus(status)).toBe(false)
    }
  })

  /**
   * The risk badge says "money is gone and nothing has been inspected". Fail
   * CLOSED on a value the union does not cover: inventing a risk state from
   * something we do not understand is the worse of the two errors.
   */
  it('fails closed on a value outside the union', () => {
    expect(isPreInspectionStatus('resolved' as ReturnStatus)).toBe(false)
  })

  it('exports the same set as a list the SQL filter can use', () => {
    expect([...PRE_INSPECTION_RETURN_STATUSES]).toEqual(
      RETURN_STATUSES.filter(isPreInspectionStatus)
    )
  })
})
