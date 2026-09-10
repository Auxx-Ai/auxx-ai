// packages/lib/src/banking/feed/__tests__/descriptor.test.ts
//
// Every fixture here is a REAL Bank of America line, taken from a 489-line
// production feed. That matters more than usual: the parser's whole job is to
// know where a bank puts the seams, and a made-up descriptor would only pin
// what its author already believed.
//
// The two properties that carry the feature are asserted directly at the
// bottom: a reference value is recognised as one, and the parts a person would
// build a rule from survive intact.

import { describe, expect, it } from 'vitest'
import { displayDescription, findDescriptorTag, parseBankDescriptor } from '../descriptor'

/** Column padding included, exactly as the bank prints it. */
const SHOPIFY_PAYOUT =
  'shopify          DES:TRANSFER   ID:ST-S4W6Z4N9S0E5           INDN:LFK ENGINEERING         CO ID:XXXXX65600 CCD'
const SHOPIFY_PMT =
  'SHOPIFY          DES:TRANSFER   ID:SHOPIFY                   INDN:UNKNOWN                 CO ID:SHOPIFYPMT WEB'
const FEDEX =
  'FEDERAL EXPRESS  DES:DEBIT      ID:EPA59327850               INDN:LFK Machinery LLC       CO ID:XXXXX27007 WEB'
const ADP_TAX =
  'ADP Tax          DES:ADP Tax    ID:L5GVU 090418A01           INDN:LFK ENGINEERING         CO ID:XXXXX11111 CCD'
const WIRE =
  'WIRE TYPE:INTL OUT DATE:260908 TIME:1255 ET                 TRN:XXXXXXXXXX763339 SERVICE REF::55:20                     BNF:1/HDMANN INDUSTRY CO., LIM ID:XXXXXXXXXX19472           BNF BK:OCBC BANK LIMITED ID:XXXXX0090638 PMT DET:630761374 LFK INVOICE'

describe('parseBankDescriptor', () => {
  it('reads an ACH descriptor into its parts', () => {
    const parsed = parseBankDescriptor(SHOPIFY_PAYOUT)
    expect(parsed.kind).toBe('ach')
    expect(parsed.lead).toBe('shopify')
    expect(parsed.sec).toBe('CCD')
    expect(findDescriptorTag(parsed, 'DES')?.value).toBe('TRANSFER')
    expect(findDescriptorTag(parsed, 'ID')?.value).toBe('ST-S4W6Z4N9S0E5')
    expect(findDescriptorTag(parsed, 'INDN')?.value).toBe('LFK ENGINEERING')
    // 🛑 The SEC code came off the CO ID's value, not out of the middle of the
    // string. Leaving `XXXXX65600 CCD` here would make the originator id differ
    // from the same originator's next line whenever the entry class changed.
    expect(findDescriptorTag(parsed, 'CO ID')?.value).toBe('XXXXX65600')
  })

  it('prefers CO ID over a bare ID at the same position', () => {
    // ⚠️ Alternation is leftmost-first, so `CO ID` has to precede `ID` in the
    // label list. Get this wrong and an ACH originator id parses as a trace
    // number and the one stable identifier on the line is lost.
    const parsed = parseBankDescriptor(SHOPIFY_PMT)
    expect(findDescriptorTag(parsed, 'CO ID')?.value).toBe('SHOPIFYPMT')
    expect(findDescriptorTag(parsed, 'ID')?.value).toBe('SHOPIFY')
    expect(parsed.sec).toBe('WEB')
  })

  it('keeps a wire’s two ID tags apart, in order', () => {
    // A wire carries the beneficiary's id and then the beneficiary BANK's. A
    // record would silently drop the second; the array keeps both.
    const parsed = parseBankDescriptor(WIRE)
    expect(parsed.kind).toBe('wire')
    expect(parsed.tags.filter((tag) => tag.label === 'ID')).toHaveLength(2)
    expect(findDescriptorTag(parsed, 'BNF')?.value).toBe('1/HDMANN INDUSTRY CO., LIM')
    expect(findDescriptorTag(parsed, 'BNF BK')?.value).toBe('OCBC BANK LIMITED')
    expect(findDescriptorTag(parsed, 'WIRE TYPE')?.value).toBe('INTL OUT')
  })

  it('collapses the bank’s column padding without reordering anything', () => {
    const parsed = parseBankDescriptor(FEDEX)
    expect(parsed.text).not.toMatch(/ {2}/)
    expect(parsed.text.startsWith('FEDERAL EXPRESS DES:DEBIT')).toBe(true)
  })

  it('parses an untagged merchant line to a lead and nothing else', () => {
    // 43% of the real feed. One lead, no tags, and that is a complete answer.
    const parsed = parseBankDescriptor('TABOOLA.COM LTD')
    expect(parsed.lead).toBe('TABOOLA.COM LTD')
    expect(parsed.tags).toEqual([])
    expect(parsed.sec).toBeNull()
    expect(parsed.kind).toBe('plain')
  })

  it('classifies the non-ACH shapes', () => {
    expect(parseBankDescriptor('Check 1660').kind).toBe('check')
    expect(parseBankDescriptor('Zelle payment to Carolin Klooth Conf# i9xceggk3').kind).toBe(
      'zelle'
    )
    expect(parseBankDescriptor('Wire Transfer Fee').kind).toBe('fee')
    expect(parseBankDescriptor('CHECKCARD 0912 AMZN MKTP US*2Y4XK9').kind).toBe('card')
  })

  it('never throws on nothing', () => {
    for (const input of ['', '   ', null, undefined]) {
      const parsed = parseBankDescriptor(input)
      expect(parsed.tags).toEqual([])
      expect(parsed.lead).toBe('')
    }
  })

  it('marks per-payment references as varying and payee names as not', () => {
    // 🛑 The property the UI depends on. A reviewer who builds a pattern out of
    // `ID:ST-S4W6Z4N9S0E5` gets a rule that matches exactly one line forever,
    // and this flag is the only warning before that happens.
    const parsed = parseBankDescriptor(SHOPIFY_PAYOUT)
    expect(findDescriptorTag(parsed, 'ID')?.isReference).toBe(true)
    expect(findDescriptorTag(parsed, 'CO ID')?.isReference).toBe(false)
    expect(findDescriptorTag(parsed, 'INDN')?.isReference).toBe(false)
    expect(findDescriptorTag(parsed, 'DES')?.isReference).toBe(false)
  })
})

describe('displayDescription', () => {
  it('names the originator and what the entry was', () => {
    expect(displayDescription(FEDEX)).toBe('FEDERAL EXPRESS · DEBIT')
    expect(displayDescription(SHOPIFY_PAYOUT)).toBe('shopify · TRANSFER')
  })

  it('does not repeat an entry description that is just the payee again', () => {
    expect(displayDescription(ADP_TAX)).toBe('ADP Tax')
  })

  it('names a wire by its type and beneficiary', () => {
    expect(displayDescription(WIRE)).toBe('Intl out · 1/HDMANN INDUSTRY CO., LIM')
  })

  it('returns null when the bank’s own string is already the best label', () => {
    // 🛑 Callers render `displayDescription(d) ?? d`. Returning a mangled
    // version of `TABOOLA.COM LTD` would be strictly worse than returning the
    // line itself.
    expect(displayDescription('TABOOLA.COM LTD')).toBeNull()
    expect(displayDescription('Check 1660')).toBeNull()
    expect(displayDescription('')).toBeNull()
    expect(displayDescription(null)).toBeNull()
  })
})
