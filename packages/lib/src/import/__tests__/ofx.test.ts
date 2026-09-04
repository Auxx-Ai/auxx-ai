// packages/lib/src/import/__tests__/ofx.test.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuxxError } from '../../errors'
import {
  isOfxContent,
  OFX_COLUMNS,
  parseOfx,
  parseOfxAmountToMinor,
  parseOfxDate,
  toOfxImportRows,
} from '../ofx'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const BOA = fixture('boa-checking.ofx')
const WELLS = fixture('wells-fargo.qfx')
const CARD = fixture('credit-card.qbo')

describe('isOfxContent', () => {
  it('accepts an OFXHEADER line', () => {
    expect(isOfxContent(BOA)).toBe(true)
    expect(isOfxContent(WELLS)).toBe(true)
  })

  it('accepts an XML document with no OFXHEADER line', () => {
    expect(isOfxContent(CARD)).toBe(true)
  })

  it('rejects a CSV, whatever it is named', () => {
    expect(isOfxContent('Date,Description,Amount\n01/15/2026,ACME,-124.50\n')).toBe(false)
  })

  it('rejects an empty file', () => {
    expect(isOfxContent('')).toBe(false)
  })
})

describe('parseOfx: SGML (OFX 1.x)', () => {
  const doc = parseOfx(BOA)

  it('reads the form, currency and account block', () => {
    expect(doc.form).toBe('sgml')
    expect(doc.currency).toBe('USD')
    expect(doc.account).toEqual({
      kind: 'bank',
      accountId: '0000045381',
      routingNumber: '121000248',
      accountType: 'CHECKING',
      last4: '5381',
    })
  })

  it('reads every STMTTRN in file order', () => {
    expect(doc.transactions).toHaveLength(6)
    expect(doc.transactions.map((tx) => tx.fitId)).toEqual([
      '202601150001',
      '202601160001',
      '202601310001',
      '202601310002',
      '202602010001',
      '202603070001',
    ])
    expect(doc.transactions.map((tx) => tx.ordinal)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('keeps the sign the bank wrote', () => {
    expect(doc.transactions.map((tx) => tx.amountMinor)).toEqual([
      -12450, 250000, -5000, -5000, -1201, -125075,
    ])
  })

  it('drops the timezone suffix and keeps the wall-clock date', () => {
    // 20260131235900[-5:EST] is 31 January at the bank, and 1 February in UTC.
    // Converting would move it into the next accounting PERIOD.
    expect(doc.transactions[2]?.postedAt).toBe('2026-01-31')
    expect(doc.transactions[0]?.postedAt).toBe('2026-01-15')
    expect(doc.transactions[1]?.postedAt).toBe('2026-01-16')
  })

  it('answers null for a missing MEMO rather than an empty string', () => {
    expect(doc.transactions[0]?.memo).toBe('INVOICE 4432')
    expect(doc.transactions[1]?.memo).toBeNull()
    expect(doc.transactions[4]?.memo).toBeNull()
  })

  it('reads the ledger balance and its as-of date', () => {
    expect(doc.ledgerBalance).toEqual({ amountMinor: 1523422, asOf: '2026-03-07' })
  })

  it('reads two identical same-day rows as two rows', () => {
    const [, , third, fourth] = doc.transactions
    expect(third?.amountMinor).toBe(fourth?.amountMinor)
    expect(third?.postedAt).toBe(fourth?.postedAt)
    expect(third?.name).toBe(fourth?.name)
    expect(third?.fitId).not.toBe(fourth?.fitId)
  })

  it('reports no duplicate FITIDs and flags the file as identifiable', () => {
    expect(doc.duplicateFitIds).toEqual([])
    expect(doc.hasFitIds).toBe(true)
  })
})

describe('parseOfx: a second SGML dialect, tags on one line', () => {
  const doc = parseOfx(WELLS)

  it('parses unclosed leaves packed onto a single line', () => {
    expect(doc.transactions).toHaveLength(3)
    expect(doc.transactions[0]?.name).toBe('PURCHASE AUTHORIZED ON 02/01 SHELL OIL')
    expect(doc.transactions[0]?.amountMinor).toBe(-8999)
  })

  it('parses a whole-dollar amount with no decimal point', () => {
    expect(doc.transactions[1]?.amountMinor).toBe(120000)
  })

  it('parses a trailing minus sign', () => {
    expect(doc.transactions[2]?.amountMinor).toBe(-25000)
  })

  it('reads a mix of closed and unclosed MEMO tags', () => {
    expect(doc.transactions[1]?.memo).toBe('REF 55231')
    expect(doc.transactions[2]?.memo).toBeNull()
  })

  it('reports a FITID reused inside one file without merging the rows', () => {
    expect(doc.duplicateFitIds).toEqual(['WF-0002'])
    expect(doc.transactions).toHaveLength(3)
  })

  it('ignores the QFX-only INTU.BID tag', () => {
    expect(doc.account?.routingNumber).toBe('121042882')
    expect(doc.account?.last4).toBe('6670')
  })
})

describe('parseOfx: XML (OFX 2.x) credit card', () => {
  const doc = parseOfx(CARD)

  it('detects the XML form', () => {
    expect(doc.form).toBe('xml')
  })

  it('reads a CCACCTFROM block as a credit card with no routing number', () => {
    expect(doc.account).toEqual({
      kind: 'creditcard',
      accountId: '4111111111111234',
      routingNumber: null,
      accountType: null,
      last4: '1234',
    })
  })

  it('normalises a lower-case CURDEF', () => {
    expect(doc.currency).toBe('USD')
  })

  it('does NOT flip the sign for a card: the row mirrors the statement', () => {
    expect(doc.transactions.map((tx) => tx.amountMinor)).toEqual([-4299, 50000])
    expect(doc.ledgerBalance?.amountMinor).toBe(-104318)
  })

  it('decodes XML entities in a memo', () => {
    expect(doc.transactions[0]?.memo).toBe('PAPER & TONER')
  })

  it('reads a fractional-second timestamp with an offset', () => {
    expect(doc.transactions.map((tx) => tx.postedAt)).toEqual(['2026-02-05', '2026-02-20'])
  })
})

describe('parseOfx: refusals', () => {
  it('refuses a file that is not OFX at all', () => {
    expect(() => parseOfx('Date,Amount\n2026-01-01,5\n')).toThrow(AuxxError)
    expect(() => parseOfx('Date,Amount\n2026-01-01,5\n')).toThrow(/not an OFX/i)
  })

  it('refuses an OFX file with no transactions', () => {
    const empty = BOA.replace(/<STMTTRN>[\s\S]*<\/STMTTRN>/, '')
    expect(() => parseOfx(empty)).toThrow(/no <STMTTRN>/i)
  })

  it('keeps a row whose FITID is missing and says the file is not identifiable', () => {
    const doc = parseOfx(BOA.replace('<FITID>202601150001', '<FITID>'))
    expect(doc.transactions).toHaveLength(6)
    expect(doc.transactions[0]?.fitId).toBeNull()
    expect(doc.hasFitIds).toBe(false)
  })

  it('survives an aggregate whose closing tag is missing', () => {
    const doc = parseOfx(BOA.replaceAll('</STMTTRN>', ''))
    expect(doc.transactions).toHaveLength(6)
    expect(doc.transactions[0]?.fitId).toBe('202601150001')
  })
})

describe('parseOfxAmountToMinor', () => {
  it.each([
    ['-124.50', -12450],
    ['124.50', 12450],
    ['+124.50', 12450],
    ['124.50-', -12450],
    ['0.00', 0],
    ['0', 0],
    ['-0.01', -1],
    ['.5', 50],
    ['1200', 120000],
    ['-1,250.75', -125075],
    ['-1.250,75', -125075],
    ['-124,50', -12450],
    ['1234567890.12', 123456789012],
  ])('parses %s as %d minor units', (raw, expected) => {
    expect(parseOfxAmountToMinor(raw)).toBe(expected)
  })

  it('rounds half away from zero rather than truncating', () => {
    expect(parseOfxAmountToMinor('-12.005')).toBe(-1201)
    expect(parseOfxAmountToMinor('12.005')).toBe(1201)
    expect(parseOfxAmountToMinor('12.004')).toBe(1200)
  })

  it('never loses a cent to a float', () => {
    // The float route (`Number(x) * 100`) is what this guards.
    for (const cents of [1, 7, 29, 33, 57, 99]) {
      expect(parseOfxAmountToMinor(`0.${String(cents).padStart(2, '0')}`)).toBe(cents)
    }
    expect(parseOfxAmountToMinor('1.005')).toBe(101)
    expect(parseOfxAmountToMinor('1.115')).toBe(112)
  })

  it('answers null for anything that is not a number', () => {
    for (const raw of ['', '   ', 'N/A', '12abc', '--5', null, undefined]) {
      expect(parseOfxAmountToMinor(raw)).toBeNull()
    }
  })

  it('answers null rather than an inexact integer for an absurd amount', () => {
    expect(parseOfxAmountToMinor('99999999999999999999.00')).toBeNull()
  })

  it('honours a non-2 precision', () => {
    expect(parseOfxAmountToMinor('1.2345', 4)).toBe(12345)
    expect(parseOfxAmountToMinor('1.5', 0)).toBe(2)
  })
})

describe('parseOfxDate', () => {
  it.each([
    ['20260115', '2026-01-15'],
    ['20260115120000', '2026-01-15'],
    ['20260115120000.000', '2026-01-15'],
    ['20260115120000[-5:EST]', '2026-01-15'],
    ['20260115000000.000[+5.5:IST]', '2026-01-15'],
    ['2026-01-15', '2026-01-15'],
    ['2026-01-15T12:00:00Z', '2026-01-15'],
  ])('reads %s as %s', (raw, expected) => {
    expect(parseOfxDate(raw)).toBe(expected)
  })

  it('keeps a late-evening transaction on the bank calendar day', () => {
    // The UTC instant is 1 February; the statement says 31 January.
    expect(parseOfxDate('20260131235900[-5:EST]')).toBe('2026-01-31')
  })

  it('keeps an early-morning transaction on the bank calendar day', () => {
    expect(parseOfxDate('20260201000100[+13:NZDT]')).toBe('2026-02-01')
  })

  it('refuses an impossible calendar date rather than rolling it forward', () => {
    expect(parseOfxDate('20260230')).toBeNull()
    expect(parseOfxDate('20261301')).toBeNull()
    expect(parseOfxDate('20260100')).toBeNull()
  })

  it('answers null for junk', () => {
    for (const raw of ['', '   ', 'yesterday', '01/15/2026', null, undefined]) {
      expect(parseOfxDate(raw)).toBeNull()
    }
  })
})

describe('toOfxImportRows', () => {
  it('emits the canonical header row', () => {
    const rows = toOfxImportRows(parseOfx(BOA))
    expect(rows.headers).toEqual([
      { index: 0, name: 'FITID' },
      { index: 1, name: 'DTPOSTED' },
      { index: 2, name: 'TRNAMT' },
      { index: 3, name: 'NAME' },
      { index: 4, name: 'MEMO' },
      { index: 5, name: 'TRNTYPE' },
      { index: 6, name: 'DESCRIPTION' },
    ])
    expect(rows.headers.map((header) => header.name)).toEqual([...OFX_COLUMNS])
  })

  it('emits signed integer minor units, never the decimal the file held', () => {
    const rows = toOfxImportRows(parseOfx(BOA))
    expect(rows.rows[0]).toEqual([
      '202601150001',
      '2026-01-15',
      '-12450',
      'ACME SUPPLY CO',
      'INVOICE 4432',
      'DEBIT',
      'ACME SUPPLY CO INVOICE 4432',
    ])
  })

  it('writes an empty cell rather than dropping a row that failed to parse', () => {
    const doc = parseOfx(BOA.replace('<TRNAMT>-124.50', '<TRNAMT>N/A'))
    const rows = toOfxImportRows(doc)
    expect(rows.rows).toHaveLength(6)
    expect(rows.rows[0]?.[2]).toBe('')
  })

  it('joins NAME and MEMO into the one description a record holds', () => {
    const rows = toOfxImportRows(parseOfx(BOA))
    // No memo: the payee alone.
    expect(rows.rows[1]?.[6]).toBe('DEPOSIT')
    // Both: joined, in the order the bank wrote them.
    expect(rows.rows[2]?.[6]).toBe('FUEL STOP 12 PUMP 3')
  })

  it('drops a memo that only repeats the payee', () => {
    const doc = parseOfx(BOA.replace('<MEMO>INVOICE 4432', '<MEMO>acme supply co'))
    expect(toOfxImportRows(doc).rows[0]?.[6]).toBe('ACME SUPPLY CO')
  })

  it('produces one row per transaction, in file order', () => {
    const rows = toOfxImportRows(parseOfx(CARD))
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.map((row) => row[0])).toEqual(['CC202602050001', 'CC202602200001'])
  })
})
