// packages/utils/src/__tests__/name-case.test.ts

import { describe, expect, it } from 'vitest'
import { toDisplayCase } from '../name-case'

describe('toDisplayCase', () => {
  describe('the core rule: only all-upper or all-lower input is touched', () => {
    it.each([
      ['MacIver', 'MacIver'],
      ["d'Artagnan", "d'Artagnan"],
      ['eBay', 'eBay'],
      ['DeAngelo', 'DeAngelo'],
      ['van der Berg', 'van der Berg'],
      ['McDonald', 'McDonald'],
      // A human typed this and got it wrong; we have no evidence of that, so it stands.
      ['Mcdonald', 'Mcdonald'],
    ])('leaves mixed-case %j alone', (input, expected) => {
      expect(toDisplayCase(input)).toBe(expected)
    })

    it('returns the identical string when nothing changes', () => {
      const input = 'MacIver'
      expect(toDisplayCase(input)).toBe(input)
    })
  })

  describe('casing repair', () => {
    it.each([
      ['BRUCE', 'Bruce'],
      ['regina', 'Regina'],
      ['kopseng', 'Kopseng'],
      ['MACIVER', 'MacIver'],
      ['MCDONALD', 'McDonald'],
      ["O'BRIEN", "O'Brien"],
      ['CREIGHTON-TAYLOR', 'Creighton-Taylor'],
      ['VAN DER BERG', 'van der Berg'],
      ['VAN', 'Van'],
      ['FRIENDS II', 'Friends II'],
      ['L. ALLEN', 'L. Allen'],
    ])('%j -> %j', (input, expected) => {
      expect(toDisplayCase(input)).toBe(expected)
    })
  })

  describe('Mac is an allowlist, never a rule', () => {
    it('expands an allowlisted surname', () => {
      expect(toDisplayCase('MACIVER')).toBe('MacIver')
      expect(toDisplayCase('MACDONALD')).toBe('MacDonald')
    })

    it.each([
      // Every one of these is a real surname in the sample data. Inventing a capital
      // here would be worse than leaving the plain form.
      ['MACHADO', 'Machado'],
      ['MACK', 'Mack'],
      ['MACKAY', 'Mackay'],
      ['MACOLINO', 'Macolino'],
      ['MACON', 'Macon'],
    ])('does NOT split %j', (input, expected) => {
      expect(toDisplayCase(input)).toBe(expected)
    })
  })

  describe('Mc needs no allowlist', () => {
    it.each([
      ['MCALLISTER', 'McAllister'],
      ['MCBRYDE', 'McBryde'],
      ['MCCANDLESS', 'McCandless'],
      ['MCCORMICK', 'McCormick'],
      ['MCCOY', 'McCoy'],
      ['MCDANIEL', 'McDaniel'],
      ['MCELHANY', 'McElhany'],
      ['MCGARRY', 'McGarry'],
    ])('%j -> %j', (input, expected) => {
      expect(toDisplayCase(input)).toBe(expected)
    })

    it('leaves a bare MC alone rather than producing "Mc"', () => {
      expect(toDisplayCase('MC')).toBe('MC')
    })
  })

  describe('initials and acronyms keep their shape', () => {
    it.each([
      // Two letters: initials outnumber names 22:5 in the sample.
      'AJ',
      'CJ',
      'CR',
      'DJ',
      'GB',
      'JC',
      'JD',
      'JF',
      'JJ',
      'JM',
      'JP',
      'JT',
      'JW',
      'LK',
      'MJ',
      'OJ',
      'PJ',
      'RR',
      'TJ',
      'TS',
      'VJ',
      // Three-plus letters with no vowel.
      'BBH',
      'CSH',
      'CSJ',
      'HHH',
      'RMR',
      'SVR',
      'VPT',
      'LLC',
    ])('leaves %j untouched', (input) => {
      expect(toDisplayCase(input)).toBe(input)
    })

    it.each([
      // Three letters WITH a vowel are names, and do get repaired.
      ['AMY', 'Amy'],
      ['BEN', 'Ben'],
      ['GUY', 'Guy'],
      ['JAY', 'Jay'],
      ['KIM', 'Kim'],
      ['LEE', 'Lee'],
      ['PAT', 'Pat'],
      ['RAY', 'Ray'],
      ['TOM', 'Tom'],
      ['YAO', 'Yao'],
    ])('still repairs the real name %j', (input, expected) => {
      expect(toDisplayCase(input)).toBe(expected)
    })

    it('accepts that two-letter names stay shouting — the documented trade', () => {
      expect(toDisplayCase('ED')).toBe('ED')
    })

    it('does not treat a lowercase short token as initials', () => {
      // No evidence of initials in lower-case input, so it is cased normally.
      expect(toDisplayCase('jp')).toBe('Jp')
    })

    it('keeps an initial inside a longer name', () => {
      expect(toDisplayCase('A ANDERSON')).toBe('A Anderson')
      expect(toDisplayCase('JUDY G')).toBe('Judy G')
    })
  })

  describe('particles', () => {
    it('lowers a particle that has something after it', () => {
      expect(toDisplayCase('VAN DER BERG')).toBe('van der Berg')
      expect(toDisplayCase('DE LA CRUZ')).toBe('de la Cruz')
    })

    it('capitalizes a particle that is the whole value', () => {
      expect(toDisplayCase('VAN')).toBe('Van')
      expect(toDisplayCase('DER')).toBe('Der')
    })

    it('leaves a two-letter particle alone when it stands on its own', () => {
      // `DE` mid-name is a particle (see above), but alone it is two upper-case
      // letters with nothing to disambiguate it from initials, so it is kept.
      expect(toDisplayCase('DE')).toBe('DE')
    })

    it('capitalizes a particle in final position', () => {
      // Trailing `DELLA` is the surname here, not a particle before something.
      expect(toDisplayCase('MARIA DELLA')).toBe('Maria Della')
    })

    it('does not treat a name that merely looks like a particle as one', () => {
      // `les` is excluded from PARTICLES — as a particle it would lower to
      // `les Moore`; as a name it title-cases. The exclusion is what makes it a name.
      expect(toDisplayCase('LES MOORE')).toBe('Les Moore')
      // `al` is likewise excluded, so it is never lowered to `al Smith`. It stays
      // upper-case rather than becoming `Al` only because two upper-case letters
      // read as initials (`A.L. Smith`) just as readily as they read as `Al`.
      expect(toDisplayCase('AL SMITH')).toBe('AL Smith')
    })

    it('fixes the one real particle case in the sample data', () => {
      expect(toDisplayCase('van ruler')).toBe('van Ruler')
    })
  })

  describe('punctuation survives', () => {
    // The regression guard for the deleted `formatComplexName`, which split on
    // [\s-'] and joined on ' ', deleting every hyphen and apostrophe.
    it('keeps hyphens', () => {
      expect(toDisplayCase('CREIGHTON-TAYLOR')).toBe('Creighton-Taylor')
      expect(toDisplayCase('MARC-HENRY')).toBe('Marc-Henry')
      expect(toDisplayCase('RILEY-FISCHER')).toBe('Riley-Fischer')
      expect(toDisplayCase('F-EMCH')).toBe('F-Emch')
    })

    it('keeps apostrophes', () => {
      expect(toDisplayCase("O'BRIEN")).toBe("O'Brien")
      expect(toDisplayCase("O'CULL")).toBe("O'Cull")
      expect(toDisplayCase("D'ANGELO")).toBe("D'Angelo")
    })

    it('keeps a typographic apostrophe', () => {
      expect(toDisplayCase('O’BRIEN')).toBe('O’Brien')
    })

    it('keeps periods and multiple spaces', () => {
      expect(toDisplayCase('L. ALLEN')).toBe('L. Allen')
      expect(toDisplayCase('JOHN  SMITH')).toBe('John  Smith')
    })
  })

  describe('refuses input that is not a casing problem', () => {
    it('leaves an email address alone', () => {
      const email = 'ALANNACONNER@COOPERCARRY.COM'
      expect(toDisplayCase(email)).toBe(email)
      expect(toDisplayCase('mikedavidson@live.com')).toBe('mikedavidson@live.com')
    })

    it('leaves uncased script alone', () => {
      expect(toDisplayCase('李')).toBe('李')
      expect(toDisplayCase('محمد')).toBe('محمد')
      expect(toDisplayCase('山田 太郎')).toBe('山田 太郎')
    })

    it('handles empty and nullish input without throwing', () => {
      expect(toDisplayCase('')).toBe('')
      expect(toDisplayCase(null)).toBe(null)
      expect(toDisplayCase(undefined)).toBe(undefined)
      expect(toDisplayCase('   ')).toBe('   ')
    })

    it('does not throw on emoji or digits', () => {
      expect(toDisplayCase('TACO🌴🌮')).toBe('Taco🌴🌮')
      expect(toDisplayCase('(OSV)')).toBe('(Osv)')
      expect(toDisplayCase('123')).toBe('123')
    })
  })

  describe('idempotence', () => {
    it.each([
      'BRUCE',
      'regina',
      'MACIVER',
      'MCDONALD',
      "O'BRIEN",
      'CREIGHTON-TAYLOR',
      'VAN DER BERG',
      'FRIENDS II',
      'L. ALLEN',
      'JP',
      'AMY',
    ])('running twice over %j changes nothing the second time', (input) => {
      const once = toDisplayCase(input) as string
      expect(toDisplayCase(once)).toBe(once)
    })
  })
})
