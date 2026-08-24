// packages/lib/src/import/resolution/resolvers/currency.ts

import { minorUnitExponent } from '@auxx/utils/currency'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Grouping characters that are never a decimal separator anywhere. JS `\s` already
 * covers the non-breaking and narrow spaces used by fr-FR/ru-RU; the apostrophes
 * are the Swiss convention (`1'234.56`).
 */
const GROUPING_NOISE = /[\s'\u2019]/g

/** A parsed money cell, in integer minor units. */
export interface CurrencyParseSuccess {
  ok: true
  minorUnits: number
}

/** Why a money cell could not be read, phrased for a row error. */
export interface CurrencyParseFailure {
  ok: false
  reason: string
}

export type CurrencyParseResult = CurrencyParseSuccess | CurrencyParseFailure

/** Options for {@link parseCurrencyMajorToMinor} */
export interface CurrencyParseOptions {
  /**
   * ISO 4217 code of the TARGET FIELD, already resolved through the
   * field → org → USD chain (`resolveCurrencyCode`). It decides the exponent,
   * and nothing else: USD/EUR 2, JPY 0, KWD 3.
   */
  currencyCode?: string
  /**
   * Explicit decimal separator for the column, from
   * `ResolutionConfig.numberDecimalSeparator`. When set it settles every
   * ambiguity below; when absent the parser must decide from the cell alone.
   */
  decimalSeparator?: string
}

function fail(reason: string): CurrencyParseFailure {
  return { ok: false, reason }
}

/**
 * True when `intPart` uses `groupSep` in legal thousands positions.
 *
 * `1,234,567` passes; `1,23,4` and `,234` do not. This is the check that turns
 * "looks like a number" into "is actually grouped", and it is what makes
 * rejecting garbage cheap.
 */
function hasValidGrouping(intPart: string, groupSep: string): boolean {
  if (!intPart.includes(groupSep)) return true
  const groups = intPart.split(groupSep)
  const first = groups[0] ?? ''
  if (first.length < 1 || first.length > 3) return false
  return groups.slice(1).every((group) => group.length === 3)
}

/**
 * Read a human-written MAJOR-unit money string as integer MINOR units.
 *
 * The exponent comes from `currencyCode` via `minorUnitExponent` — never a
 * hardcoded 100. `12.34` is 1234 for USD, 1234 for EUR, and a rejection for JPY
 * (whose minor unit IS the yen, so ".34 yen" cannot be stored).
 *
 * 🛑 This deliberately does NOT use `parseMajorToMinor` from `@auxx/utils`.
 * That helper strips every `,` as a thousands separator and multiplies in
 * floating point, so `1.234,56` reads as `1.234` → `123` — a 1000× silent error
 * in the exact European price list this resolver exists for. It also cannot
 * report *why* a cell was unreadable, and the importer needs a row error.
 *
 * ### Accepted
 * `12.34`, `12`, `$12.34`, `12.34 USD`, `USD 12.34`, `1,234.56`, `1.234,56`,
 * `1 234,56`, `1'234.56`, `-12.34`, `12.34-`, `(12.34)`, `.50`, `12.3400`
 * (excess zeros are lossless), leading/trailing whitespace.
 *
 * ### Rejected (as a row error, never a guess)
 * - A currency code in the cell that disagrees with the field's
 *   (`12.34 EUR` into a USD field) — importing euros as dollars is silent.
 * - More non-zero decimals than the currency has (`12.3456` for USD). Rounding
 *   a unit cost loses money that no downstream sum can recover.
 * - `1.234` — a lone DOT with three digits behind it. `.` is the en-US decimal
 *   point, so that is plausibly a three-decimal unit cost, and it is equally
 *   plausibly `1,234`. The readings differ by 1000×, so it refuses. Same for
 *   `1,234` under a three-decimal currency, where both readings are valid.
 * - Malformed grouping (`1,23,4`), a bare separator (`12.`), stray text, an
 *   amount too large to be an exact integer.
 *
 * ### The one convention it applies
 * A lone COMMA with exactly three digits behind it (`1,234`) is GROUPING, for a
 * currency with fewer than three decimals. That is not a coin flip: `,` is the
 * en-US thousands separator, and the competing European decimal reading needs
 * three decimal places the currency does not have. Exactly one reading
 * survives. `ResolutionConfig.numberDecimalSeparator` overrides all of this and
 * settles every case above.
 */
export function parseCurrencyMajorToMinor(
  rawValue: string,
  options: CurrencyParseOptions = {}
): CurrencyParseResult {
  const fieldCode = (options.currencyCode || 'USD').trim().toUpperCase()
  const exponent = minorUnitExponent(fieldCode)

  let text = rawValue.trim()
  if (!text) return fail(`Invalid currency amount: "${rawValue}" is empty`)

  // Currency symbols carry no information the field does not already assert.
  text = text.replace(/\p{Sc}/gu, ' ')

  // A written-out code is checked against the field's, then dropped. Anything
  // else alphabetic is text in a money column and must not be silently ignored.
  const letterRuns = text.match(/\p{L}+/gu)
  if (letterRuns) {
    if (letterRuns.length > 1 || (letterRuns[0]?.length ?? 0) !== 3) {
      return fail(
        `Invalid currency amount: "${rawValue}" contains text that is not a currency code`
      )
    }
    const declared = (letterRuns[0] ?? '').toUpperCase()
    if (declared !== fieldCode) {
      return fail(
        `Currency mismatch: "${rawValue}" is in ${declared}, but this field stores ${fieldCode}. ` +
          'Convert the column, or map it to a field in that currency.'
      )
    }
    text = text.replace(/\p{L}+/gu, ' ')
  }

  text = text.replace(GROUPING_NOISE, '')

  // Sign. Accounting parentheses and a trailing minus (common in ERP exports)
  // both mean negative; combining them is a malformed cell, not a double negative.
  let negative = false
  const parenthesised = text.startsWith('(') && text.endsWith(')')
  if (parenthesised) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-') || text.startsWith('+')) {
    if (parenthesised) return fail(`Invalid currency amount: "${rawValue}" has two signs`)
    negative = text.startsWith('-')
    text = text.slice(1)
  } else if (text.endsWith('-')) {
    if (parenthesised) return fail(`Invalid currency amount: "${rawValue}" has two signs`)
    negative = true
    text = text.slice(0, -1)
  }

  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) {
    return fail(`Invalid currency amount: "${rawValue}"`)
  }

  const dots = (text.match(/\./g) ?? []).length
  const commas = (text.match(/,/g) ?? []).length
  const configured =
    options.decimalSeparator === '.' || options.decimalSeparator === ','
      ? options.decimalSeparator
      : null

  /** The separator that splits units from sub-units, or null for an integer cell */
  let decSep: '.' | ',' | null = null
  /**
   * The separator that only groups thousands. It must be tracked ALONGSIDE
   * `decSep` rather than derived from it: for `1,234,567` there is no decimal
   * separator at all, and assuming the other character would leave the commas
   * in the digit string and reject a perfectly good cell.
   */
  let groupSep: '.' | ',' = ','

  if (configured) {
    // An explicitly configured column has no ambiguity left to resolve: the
    // configured character marks decimals (when it appears at all) and the
    // other one can then only be grouping.
    decSep = (configured === '.' ? dots : commas) > 0 ? configured : null
    groupSep = configured === '.' ? ',' : '.'
  } else if (dots > 0 && commas > 0) {
    // Mixed: the LAST separator is the decimal one in every real convention.
    decSep = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ','
    groupSep = decSep === '.' ? ',' : '.'
  } else if (dots > 0 || commas > 0) {
    const sep: '.' | ',' = dots > 0 ? '.' : ','
    const occurrences = dots > 0 ? dots : commas
    const rightDigits = text.length - text.lastIndexOf(sep) - 1

    if (occurrences > 1) {
      // `1.234.567` — repeated separators can only be grouping.
      decSep = null
      groupSep = sep
    } else if (rightDigits === 3) {
      // Three digits after a lone separator is the one genuinely undecidable
      // shape, and the two readings differ by 1000x. The separator settles it
      // only for a comma under a currency with fewer than three decimals:
      //
      //   `1,234` — `,` is the en-US THOUSANDS separator, and the European
      //             decimal reading needs three decimals USD/EUR do not have.
      //             One reading survives, so there is nothing to guess.
      //   `1.234` — `.` is the en-US DECIMAL point, so this may well be a
      //             three-decimal unit cost (a vendor price list is full of
      //             them). Calling it grouping would silently turn $1.234 into
      //             $1,234.00 on exactly the files this resolver exists for.
      //   KWD     — with three minor digits BOTH readings are valid whichever
      //             separator is used.
      if (sep !== ',' || exponent >= 3) {
        return fail(
          `Ambiguous currency amount: "${rawValue}" — "${sep}" could separate thousands or ` +
            "mark decimals, and the two readings differ by 1000x. Set the column's decimal " +
            'separator, or reformat the file.'
        )
      }
      decSep = null
      groupSep = sep
    } else {
      decSep = sep
      groupSep = sep === '.' ? ',' : '.'
    }
  }

  const splitAt = decSep ? text.lastIndexOf(decSep) : -1
  const intPart = splitAt >= 0 ? text.slice(0, splitAt) : text
  const fracPart = splitAt >= 0 ? text.slice(splitAt + 1) : ''

  if (splitAt >= 0 && fracPart.length === 0) {
    return fail(`Invalid currency amount: "${rawValue}" ends with a separator`)
  }
  if (fracPart.includes(groupSep) || fracPart.includes(decSep ?? ' ')) {
    return fail(`Invalid currency amount: "${rawValue}" has more than one decimal separator`)
  }
  if (!hasValidGrouping(intPart, groupSep)) {
    return fail(`Invalid currency amount: "${rawValue}" has malformed thousands grouping`)
  }
  // Only the grouping separator may remain in the integer part.
  const intDigits = intPart.split(groupSep).join('')
  if (intDigits !== '' && !/^[0-9]+$/.test(intDigits)) {
    return fail(`Invalid currency amount: "${rawValue}"`)
  }

  let fraction = fracPart
  if (fraction.length > exponent) {
    const dropped = fraction.slice(exponent)
    if (/[^0]/.test(dropped)) {
      return fail(
        `"${rawValue}" has more decimals than ${fieldCode} supports (${exponent}). ` +
          'Rounding it here would silently lose money — round it in the file instead.'
      )
    }
    fraction = fraction.slice(0, exponent)
  }
  fraction = fraction.padEnd(exponent, '0')

  // String concatenation, not `major * 10 ** exponent`: 1.005 * 100 is
  // 100.49999999999999 in binary floating point, and `Math.round` of that is a
  // cent short.
  const digits = `${intDigits || '0'}${fraction}`
  const minorUnits = Number(digits)
  if (!Number.isSafeInteger(minorUnits)) {
    return fail(`Invalid currency amount: "${rawValue}" is too large to store exactly`)
  }

  return { ok: true, minorUnits: negative && minorUnits !== 0 ? -minorUnits : minorUnits }
}

/**
 * Resolve a `currency:major` cell — a human-written money amount — into the
 * integer minor units a CURRENCY field stores.
 *
 * This is the resolver a CURRENCY field gets by default. `number:decimal` used
 * to be, which meant `12.34` reached the write path as `12.34` and threw
 * ("CURRENCY values are integer minor units"), while `12` imported silently as
 * 12 cents. Files already holding minor units keep `number:integer`.
 *
 * @param rawValue - The raw cell text
 * @param config - Column config; `currencyCode` decides the exponent
 * @returns The resolved minor-unit integer, `null` for a blank cell, or an error
 */
export function resolveCurrencyMajor(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const parsed = parseCurrencyMajorToMinor(trimmed, {
    currencyCode: config.currencyCode,
    decimalSeparator: config.numberDecimalSeparator,
  })

  if (!parsed.ok) {
    return { type: 'error', error: parsed.reason }
  }

  return { type: 'value', value: parsed.minorUnits }
}
