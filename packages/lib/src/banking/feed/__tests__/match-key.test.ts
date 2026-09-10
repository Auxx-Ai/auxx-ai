// packages/lib/src/banking/feed/__tests__/match-key.test.ts
//
// The match key is the PRIMARY categorisation signal in this subsystem, not a
// supplement: Stripe Financial Connections ships no merchant name and no categories,
// so "the last six lines matching this key went to 6100" is the best evidence a
// suggestion will ever have (plans/bank-connection/01 §4.2 (3)).
//
// Every rule in the normaliser is a judgement about what varies between two
// occurrences of the SAME merchant, so each one is pinned here. Two properties matter
// more than any individual case and both are asserted directly at the bottom:
//   - two occurrences of one merchant collapse to one key
//   - two different merchants do not

import { describe, expect, it } from 'vitest'
import { normalizeMatchKey } from '../match-key'

describe('normalizeMatchKey', () => {
  it('answers the empty string for nothing at all', () => {
    // 🛑 '' is "no key", never a key that groups. A statement line whose whole
    // description was a trace number must not be matched against every other one.
    expect(normalizeMatchKey('')).toBe('')
    expect(normalizeMatchKey(null)).toBe('')
    expect(normalizeMatchKey(undefined)).toBe('')
    expect(normalizeMatchKey('   ')).toBe('')
    expect(normalizeMatchKey('0000123456789')).toBe('')
  })

  it('lowercases', () => {
    expect(normalizeMatchKey('AMAZON WEB SERVICES')).toBe('amazon web services')
  })

  it('collapses punctuation and whitespace', () => {
    expect(normalizeMatchKey('SQ *COFFEE  BAR')).toBe('sq coffee bar')
    expect(normalizeMatchKey('sq*coffee bar')).toBe('sq coffee bar')
    expect(normalizeMatchKey('  UBER   \t EATS \n ')).toBe('uber eats')
  })

  it('strips masked card suffixes without leaving the mask behind', () => {
    // This is why the card rules run BEFORE the bare digit-run rule. Strip the digits
    // first and every card in the org collapses onto the key `xxxx`.
    expect(normalizeMatchKey('SHELL OIL XXXX4321')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL ****4321')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL X4321')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL ...4321')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL CARD 4321')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL ENDING IN 4321')).toBe('shell oil')
    expect(normalizeMatchKey('PAYMENT ACCT #5381')).toBe('payment')
  })

  it('strips every date shape a US bank prints', () => {
    expect(normalizeMatchKey('ACH DEBIT 2026-01-31 PAYROLL')).toBe('ach debit payroll')
    expect(normalizeMatchKey('POS PURCHASE 01/31 STAPLES')).toBe('pos purchase staples')
    expect(normalizeMatchKey('POS PURCHASE 01/31/26 STAPLES')).toBe('pos purchase staples')
    expect(normalizeMatchKey('POS PURCHASE 1.31.2026 STAPLES')).toBe('pos purchase staples')
    expect(normalizeMatchKey('STAPLES 31 JAN')).toBe('staples')
    expect(normalizeMatchKey('STAPLES JAN 31')).toBe('staples')
    expect(normalizeMatchKey('STAPLES SEPT 3 2026')).toBe('staples')
  })

  it('strips times off card-present lines', () => {
    expect(normalizeMatchKey('SHELL OIL 14:32')).toBe('shell oil')
    expect(normalizeMatchKey('SHELL OIL 02:15:09')).toBe('shell oil')
  })

  it('strips digit runs longer than three, anchored or not', () => {
    expect(normalizeMatchKey('ACH CREDIT PPD ID 1234567890')).toBe('ach credit ppd id')
    // Not word-anchored on the left on purpose: `ppd1234567` is one token, and leaving
    // the digits in makes every occurrence of that merchant a unique key.
    expect(normalizeMatchKey('ACH CREDIT PPD1234567')).toBe('ach credit ppd')
    expect(normalizeMatchKey('WIRE REF 998877665544 ACME')).toBe('wire acme')
    expect(normalizeMatchKey('ACH TRACE 889900112 ACME')).toBe('ach acme')
    // Without the lookbehind on the mask rule the trailing x of a name eats itself.
    expect(normalizeMatchKey('MAX HARDWARE 1234')).toBe('max hardware')
  })

  it('KEEPS runs of three digits or fewer, because they identify the merchant', () => {
    // A store number and a highway number are part of the name; a trace number is not.
    expect(normalizeMatchKey('HOME DEPOT 442')).toBe('home depot 442')
    expect(normalizeMatchKey('EXXON I 95 NORTH')).toBe('exxon i 95 north')
    expect(normalizeMatchKey('7 ELEVEN 22')).toBe('7 eleven 22')
  })

  it('strips the mixed letter-and-digit token banks use as a per-payment reference', () => {
    // The single highest-value rule in the normaliser. Every shape below was a
    // SINGLETON key on the measured feed (task 11's LANDED block), which is why the
    // suggestion engine had never fired: 68 Shopify payouts worth $2.29M were 68
    // separate decisions, none of them able to reach MIN_HISTORY_MATCHES.
    expect(
      normalizeMatchKey(
        'SHOPIFY DES:TRANSFER ID:ST-F1K0R8X3L3D5 INDN:LFK ENGINEERING CO ID:XXXXX48598 CCD'
      )
    ).toBe('shopify des transfer id st indn lfk engineering co id ccd')
    expect(normalizeMatchKey('AMAZON MKTPL*5Q9S115H0')).toBe('amazon mktpl')
    expect(normalizeMatchKey('ZELLE PAYMENT TO JOHN DOE Conf# avnwsy251')).toBe(
      'zelle payment to john doe conf'
    )
  })

  it('collapses two payouts that differ only in their reference onto one key', () => {
    // The property the rule was added for, stated as the function's own contract.
    const a = normalizeMatchKey('SHOPIFY DES:TRANSFER ID:ST-F1K0R8X3L3D5 INDN:LFK ENG CCD')
    const b = normalizeMatchKey('SHOPIFY DES:TRANSFER ID:ST-Q7M2W9B4N1H8 INDN:LFK ENG CCD')
    expect(a).toBe(b)
  })

  it('KEEPS a mixed token that is a name rather than a reference', () => {
    // Under six characters, or fewer than two digits, or fewer than two letters. A
    // brand with a number in it identifies the merchant exactly as a word would.
    expect(normalizeMatchKey('WD40 COMPANY')).toBe('wd40 company')
    expect(normalizeMatchKey('LEVEL3 COMMUNICATIONS')).toBe('level3 communications')
    expect(normalizeMatchKey('1STDIBS')).toBe('1stdibs')
  })

  it('leaves the letter stem of a token whose digits are a run of four or more', () => {
    // ⚠️ This is why the reference rule runs AFTER the digit-run rule and not before,
    // against the brief's follow-up (1). `PPD` is a NACHA class code and `ADS` an
    // advertiser stream; both group correctly once only the digits are gone, and
    // stripping the whole token would throw away the stable part.
    expect(normalizeMatchKey('ACH CREDIT PPD1234567')).toBe('ach credit ppd')
    expect(normalizeMatchKey('GOOGLE *ADS3197812385')).toBe('google ads')
  })

  it('answers no key for a bare check number', () => {
    // 🛑 All eleven checks in the measured feed shared the key `check`, to eleven
    // different payees. At eleven lines that is task 11 §4's `strong` band, default
    // selected for bulk accept, so the first coded check would propose its account for
    // ten unrelated ones. A check number identifies nothing.
    expect(normalizeMatchKey('Check 1660')).toBe('')
    expect(normalizeMatchKey('CHECK 1660')).toBe('')
    // ⚠️ Three digits survive the digit-run rule, so a short check number reaches the
    // key intact. It has to answer the same as a long one or the fix is half a fix.
    expect(normalizeMatchKey('Check 220')).toBe('')
    expect(normalizeMatchKey('CHECKS 220')).toBe('')
    // Only as the WHOLE key. A descriptor that says more than "a check happened" keeps
    // everything it says.
    expect(normalizeMatchKey('CHECK CARD PURCHASE SHELL OIL')).toBe('check card purchase shell oil')
  })

  it('is idempotent - normalising a key again changes nothing', () => {
    // The review queue groups on stored keys, so a re-run over already-normalised
    // values (a backfill, a reprocess) must not drift them into a second bucket.
    const once = normalizeMatchKey('POS PURCHASE 01/31 SHELL OIL XXXX4321 REF 998877')
    expect(normalizeMatchKey(once)).toBe(once)
  })

  it('collapses two occurrences of the same merchant onto one key', () => {
    // The property the whole function exists for.
    const a = normalizeMatchKey('POS PURCHASE 01/31 SHELL OIL 57 XXXX4321 TRACE 889900112')
    const b = normalizeMatchKey('POS PURCHASE 02/14 SHELL OIL 57 XXXX4321 TRACE 445566778')
    expect(a).toBe(b)
    expect(a).toBe('pos purchase shell oil 57')
  })

  it('keeps two different merchants apart', () => {
    const shell = normalizeMatchKey('POS PURCHASE 01/31 SHELL OIL 57 XXXX4321')
    const staples = normalizeMatchKey('POS PURCHASE 01/31 STAPLES 118 XXXX4321')
    expect(shell).not.toBe(staples)
  })

  it('survives a description that is nothing but noise', () => {
    expect(normalizeMatchKey('***** 12/31 REF 9988776655 ****1234')).toBe('')
  })
})
