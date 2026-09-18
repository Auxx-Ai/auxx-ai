// packages/lib/src/accounting/ledger/chart/__tests__/next-account-code.test.ts
//
// The allocator behind the rail mint (brief 26 §7.1, test 5 of §12).
//
// Three properties, and the third is the one the brief singles out:
//
//  1. FIRST FREE in the band, not highest plus one. A chart that once minted
//     `1249` and later removed `1205` must reuse `1205` rather than walk out of
//     the band into somebody else's numbering.
//  2. A FULL band refuses, and says so. There is no overflow.
//  3. 🛑 A chart with NO CODES AT ALL mints with a null code. `gl_account_code`
//     became optional in task 15 §5 and a QuickBooks chart shipped with account
//     numbering off carries none; inventing `1200` for that org would put the
//     one numbered account in a chart of named ones.
//
// Pure: no database, no mocks, no doubles of any kind.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import {
  type AccountCodeBand,
  CLEARING_ACCOUNT_CODE_BAND,
  MERCHANT_FEE_ACCOUNT_CODE_BAND,
} from '../default-chart'
import { type CodedAccount, nextAccountCode } from '../next-account-code'

/** A chart of nothing but codes. The allocator reads no other field. */
function chart(...codes: (string | null)[]): CodedAccount[] {
  return codes.map((code) => ({ code }))
}

/** Every code in a band, so the band is full. */
function fullBand(band: AccountCodeBand): CodedAccount[] {
  const codes: CodedAccount[] = []
  for (let code = band.start; code <= band.end; code++) codes.push({ code: String(code) })
  return codes
}

describe('nextAccountCode', () => {
  describe('a chart with no codes at all (§12 test 5)', () => {
    it('mints a null code and does not invent one', () => {
      const result = nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart(null, null, null))

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBeNull()
    })

    it('reads a blank or whitespace code as no code', () => {
      const result = nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart('', '   ', null))

      expect(result._unsafeUnwrap()).toBeNull()
    })

    it('reads an empty chart the same way', () => {
      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, [])._unsafeUnwrap()).toBeNull()
    })

    it('allocates as soon as ONE account carries a code, wherever it sits', () => {
      // A numbered chart with nothing yet in 1200-1249 is still a numbered
      // chart, and its first clearing account belongs at the floor of the band.
      const result = nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart('1000', '1100', '1400'))

      expect(result._unsafeUnwrap()).toBe('1200')
    })
  })

  describe('first free in the band', () => {
    it('starts at the floor when the band is empty', () => {
      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart('1000'))._unsafeUnwrap()).toBe(
        '1200'
      )
      expect(nextAccountCode(MERCHANT_FEE_ACCOUNT_CODE_BAND, chart('1000'))._unsafeUnwrap()).toBe(
        '6100'
      )
    })

    it('takes the gap, not the top plus one', () => {
      // The whole reason this is not `max + 1`: 1205 is free and 1250 is out of
      // the band entirely.
      const held = chart('1200', '1201', '1202', '1203', '1204', '1206', '1249')

      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, held)._unsafeUnwrap()).toBe('1205')
    })

    it('never leaves the band, even when only the ceiling is free', () => {
      const held = fullBand(CLEARING_ACCOUNT_CODE_BAND).filter((row) => row.code !== '1249')

      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, held)._unsafeUnwrap()).toBe('1249')
    })

    it('ignores codes outside the band', () => {
      const held = chart('1100', '1199', '1250', '6100', '9999')

      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, held)._unsafeUnwrap()).toBe('1200')
    })

    it('ignores a non-numeric code, which occupies no slot', () => {
      // It still counts as the chart using codes - so this allocates rather
      // than returning null - but it blocks nothing.
      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart('CASH'))._unsafeUnwrap()).toBe(
        '1200'
      )
    })

    it('compares codes as trimmed strings, the way the uniqueness gate does', () => {
      // `assertCodeIsFree` matches `FieldValue.valueText` with `eq`, so '01200'
      // is a different code from '1200' there and must be here too.
      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart('01200'))._unsafeUnwrap()).toBe(
        '1200'
      )
      expect(nextAccountCode(CLEARING_ACCOUNT_CODE_BAND, chart(' 1200 '))._unsafeUnwrap()).toBe(
        '1201'
      )
    })

    it('allocates the two bands independently', () => {
      const held = fullBand(CLEARING_ACCOUNT_CODE_BAND)

      expect(nextAccountCode(MERCHANT_FEE_ACCOUNT_CODE_BAND, held)._unsafeUnwrap()).toBe('6100')
    })
  })

  describe('a full band refuses', () => {
    it('returns an UnprocessableEntityError naming the band', () => {
      const result = nextAccountCode(
        CLEARING_ACCOUNT_CODE_BAND,
        fullBand(CLEARING_ACCOUNT_CODE_BAND)
      )

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(UnprocessableEntityError)
      expect(error.message).toContain(CLEARING_ACCOUNT_CODE_BAND.label)
    })

    it('does not overflow into the next band', () => {
      const result = nextAccountCode(
        MERCHANT_FEE_ACCOUNT_CODE_BAND,
        fullBand(MERCHANT_FEE_ACCOUNT_CODE_BAND)
      )

      expect(result.isErr()).toBe(true)
    })
  })

  describe('the declared bands', () => {
    it('are the ones §7.1 names', () => {
      expect(CLEARING_ACCOUNT_CODE_BAND.start).toBe(1200)
      expect(CLEARING_ACCOUNT_CODE_BAND.end).toBe(1249)
      expect(MERCHANT_FEE_ACCOUNT_CODE_BAND.start).toBe(6100)
      expect(MERCHANT_FEE_ACCOUNT_CODE_BAND.end).toBe(6149)
    })

    it('do not overlap', () => {
      expect(CLEARING_ACCOUNT_CODE_BAND.end).toBeLessThan(MERCHANT_FEE_ACCOUNT_CODE_BAND.start)
    })
  })
})
