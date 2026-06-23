// packages/utils/src/__tests__/csv.test.ts

import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '../csv'

describe('csvCell', () => {
  it('passes simple values through unquoted', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(true)).toBe('true')
  })

  it('renders null/undefined as empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes values containing a comma, quote, or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"')
  })

  it('doubles embedded quotes', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('serializes Date as ISO and objects as JSON', () => {
    expect(csvCell(new Date('2026-06-22T00:00:00.000Z'))).toBe('2026-06-22T00:00:00.000Z')
    // JSON contains a comma → quoted, inner quotes doubled.
    expect(csvCell({ a: 1, b: 2 })).toBe('"{""a"":1,""b"":2}"')
  })
})

describe('toCsv', () => {
  it('emits a header row then one line per row, selecting by column', () => {
    const rows = [
      { tier: 'invalid', externalId: 'cus_1', error: 'bad shape' },
      { tier: 'rejected', externalId: 'cus_2', error: 'write failed' },
    ]
    expect(toCsv(rows, ['tier', 'externalId', 'error'])).toBe(
      'tier,externalId,error\ninvalid,cus_1,bad shape\nrejected,cus_2,write failed'
    )
  })

  it('quotes cells that need it and blanks missing columns', () => {
    const rows = [{ externalId: 'id,1', error: 'a "quoted" reason' }]
    expect(toCsv(rows, ['tier', 'externalId', 'error'])).toBe(
      'tier,externalId,error\n,"id,1","a ""quoted"" reason"'
    )
  })
})
