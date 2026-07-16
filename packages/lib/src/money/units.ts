// packages/lib/src/money/units.ts

/**
 * Canonical line-item units of measure (money plan 13 §1) — the single source of truth for
 * catalog default units, line-item units, the smart quantity editor's parser, and every
 * customer-facing document renderer. Client-safe: zero server-only imports. Do not duplicate
 * this list or its alias parsing anywhere else (settings selectors, PDFs, document payloads);
 * import from here.
 *
 * Units are a fixed product list (README decision #10) — organizations cannot add custom units
 * in v1. A unit is descriptive pricing context only: parsing and re-labelling never convert
 * quantity or price (decision #6).
 */
interface LineItemUnitDefinition {
  /** Stable stored value — persisted on catalog items and line items. */
  readonly value: string
  /** Label shown in settings selectors and registry SINGLE_SELECT option lists. */
  readonly label: string
  /** Abbreviation shown in the compact line-builder quantity cell, e.g. `12 hr`. */
  readonly compact: string
  /** Abbreviation shown on customer-facing quotes/invoices, e.g. `12 hr × $85.00/hr`. */
  readonly document: string
  /**
   * Minimum recognized input aliases for the smart quantity parser, lowercase and free of
   * punctuation (see `normalizeAliasKey`). Includes the compact abbreviation itself.
   */
  readonly aliases: readonly string[]
}

/**
 * The 14 canonical units (money plan 13 §1). `ft` is an alias of `linear_foot`, not a separate
 * stored unit — it prices the same length, just written differently.
 */
const LINE_ITEM_UNITS = [
  {
    value: 'each',
    label: 'Each',
    compact: 'ea',
    document: 'ea',
    aliases: ['ea', 'each', 'item', 'piece', 'pc'],
  },
  {
    value: 'minute',
    label: 'Minute',
    compact: 'min',
    document: 'min',
    aliases: ['min', 'mins', 'minute', 'minutes'],
  },
  {
    value: 'hour',
    label: 'Hour',
    compact: 'hr',
    document: 'hr',
    aliases: ['h', 'hr', 'hrs', 'hour', 'hours'],
  },
  { value: 'day', label: 'Day', compact: 'day', document: 'day', aliases: ['d', 'day', 'days'] },
  {
    value: 'week',
    label: 'Week',
    compact: 'wk',
    document: 'wk',
    aliases: ['wk', 'wks', 'week', 'weeks'],
  },
  {
    value: 'linear_foot',
    label: 'Linear foot',
    compact: 'lf',
    document: 'lf',
    aliases: ['lf', 'lft', 'ft', 'foot', 'feet', 'linear foot', 'linear feet'],
  },
  {
    value: 'square_foot',
    label: 'Square foot',
    compact: 'sf',
    document: 'sq ft',
    aliases: ['sf', 'sqft', 'sq ft', 'square foot', 'square feet'],
  },
  {
    value: 'cubic_foot',
    label: 'Cubic foot',
    compact: 'cf',
    document: 'cu ft',
    aliases: ['cf', 'cuft', 'cu ft', 'cubic foot', 'cubic feet'],
  },
  {
    value: 'cubic_yard',
    label: 'Cubic yard',
    compact: 'cy',
    document: 'cu yd',
    aliases: ['cy', 'cuyd', 'cu yd', 'cubic yard', 'cubic yards'],
  },
  {
    value: 'gallon',
    label: 'Gallon',
    compact: 'gal',
    document: 'gal',
    aliases: ['gal', 'gals', 'gallon', 'gallons'],
  },
  {
    value: 'pound',
    label: 'Pound',
    compact: 'lb',
    document: 'lb',
    aliases: ['lb', 'lbs', 'pound', 'pounds'],
  },
  { value: 'mile', label: 'Mile', compact: 'mi', document: 'mi', aliases: ['mi', 'mile', 'miles'] },
  { value: 'ton', label: 'Ton', compact: 'ton', document: 'ton', aliases: ['t', 'ton', 'tons'] },
  { value: 'acre', label: 'Acre', compact: 'ac', document: 'ac', aliases: ['ac', 'acre', 'acres'] },
] as const satisfies readonly LineItemUnitDefinition[]

/** Stable stored unit value, derived from the canonical list — never maintained separately. */
export type LineItemUnit = (typeof LINE_ITEM_UNITS)[number]['value']

/** Display mode for `formatLineItemUnit` — compact editor cell vs customer-facing document. */
export type LineItemUnitDisplayMode = 'compact' | 'document'

/**
 * Options for registry SINGLE_SELECT field definitions (e.g. `LINE_ITEM_FIELDS.unit`,
 * `CATALOG_ITEM_FIELDS.defaultUnit`) and plain settings selectors. Mirrors the minimal shape
 * `CATALOG_CATEGORY_OPTIONS` uses — units don't need a `color`.
 */
export const LINE_ITEM_UNIT_OPTIONS: ReadonlyArray<{ label: string; value: LineItemUnit }> =
  LINE_ITEM_UNITS.map(({ label, value }) => ({ label, value }))

const UNIT_BY_VALUE: ReadonlyMap<LineItemUnit, LineItemUnitDefinition> = new Map(
  LINE_ITEM_UNITS.map((unit) => [unit.value, unit])
)

/**
 * Normalizes free-typed unit text for alias lookup: lowercase, periods/commas stripped, and
 * runs of whitespace/hyphens collapsed to a single space. Tolerant of `sq.ft.`, `sq-ft`, `SQ FT`
 * all resolving the same way, without treating arbitrary punctuation as matchable content.
 */
function normalizeAliasKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/[\s-]+/g, ' ')
    .trim()
}

const UNIT_ALIAS_MAP: ReadonlyMap<string, LineItemUnit> = new Map(
  LINE_ITEM_UNITS.flatMap((unit) =>
    unit.aliases.map((alias) => [normalizeAliasKey(alias), unit.value] as const)
  )
)

/**
 * Resolves free-typed unit text to a canonical unit. Matches only the complete normalized text
 * against the alias table — never an arbitrary trailing substring — so `sq ft` and `ft` can
 * never be confused with each other regardless of match order.
 */
function lookupUnitAlias(text: string): LineItemUnit | null {
  const key = normalizeAliasKey(text)
  return key.length > 0 ? (UNIT_ALIAS_MAP.get(key) ?? null) : null
}

/**
 * Formats a unit for display. Returns `''` for `null`/`undefined` (unitless lines render with no
 * suffix at all).
 */
export function formatLineItemUnit(
  unit: LineItemUnit | null | undefined,
  mode: LineItemUnitDisplayMode
): string {
  if (!unit) return ''
  const definition = UNIT_BY_VALUE.get(unit)
  if (!definition) return ''
  return mode === 'compact' ? definition.compact : definition.document
}

/** Current committed quantity/unit state the smart quantity parser preserves fields against. */
export interface LineItemQuantityState {
  quantity: number | null
  unit: LineItemUnit | null
}

/** Result of `parseQuantityWithUnit` — a plain discriminated union, not `TypedResult`.
 *
 * This is UI input validation running on every Enter/Tab/blur, not a domain/DB operation, so an
 * error is a plain display string rather than an `Error` instance — see money plan 13 §2.
 */
export type ParseLineItemQuantityResult =
  | { ok: true; quantity: number | null; unit: LineItemUnit | null }
  | { ok: false; error: string }

/**
 * Extracts a leading numeric token from `text` (mixed fraction, simple fraction, decimal, or
 * integer — tried in that order so `1 1/2` is not mistaken for the integer `1`). Returns
 * `[value, remainder]`, or `null` if no numeric token starts the string.
 */
function extractLeadingNumber(text: string): [number, string] | null {
  const match = text.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+\.\d+|\.\d+|\d+)/)
  if (!match) return null

  const token = match[1]
  const remainder = text.slice(token.length).trim()

  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    const denominator = Number(mixed[3])
    if (denominator === 0) return null
    return [Number(mixed[1]) + Number(mixed[2]) / denominator, remainder]
  }

  const fraction = token.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    if (denominator === 0) return null
    return [Number(fraction[1]) / denominator, remainder]
  }

  const value = Number(token)
  return Number.isFinite(value) ? [value, remainder] : null
}

/**
 * Parses the smart quantity editor's free-typed input (money plan 13 §2). Accepted forms:
 * a bare number (preserves `current.unit`, including `null`); a bare recognized unit alias
 * (preserves `current.quantity`, including `null`); or a number immediately followed by a
 * recognized unit suffix, with optional whitespace and simple/mixed fractions
 * (`5`, `5sf`, `5 sq ft`, `1.5hr`, `1 1/2hr`, `3/4 cy`, `hr`).
 *
 * Deterministic and side-effect free: never converts units, never guesses at an unknown suffix
 * by discarding it and keeping only the numeric prefix, and treats a zero denominator, malformed
 * number, unknown suffix, or leftover text as fully invalid. Empty input is invalid — clearing a
 * unit is a job for the fixed-unit selector's `No unit` option, not this parser.
 */
export function parseQuantityWithUnit(
  input: string,
  current: LineItemQuantityState
): ParseLineItemQuantityResult {
  const collapsed = input.trim().replace(/\s+/g, ' ')
  if (collapsed.length === 0) {
    return { ok: false, error: 'Enter a quantity, a unit, or both.' }
  }

  const leading = extractLeadingNumber(collapsed)

  if (!leading) {
    // Unit-only form, e.g. `hr`.
    const unit = lookupUnitAlias(collapsed)
    if (!unit) {
      return { ok: false, error: `Unrecognized unit "${collapsed}".` }
    }
    return { ok: true, quantity: current.quantity, unit }
  }

  const [quantity, suffix] = leading
  if (suffix.length === 0) {
    // Number-only form, e.g. `5`.
    return { ok: true, quantity, unit: current.unit }
  }

  const unit = lookupUnitAlias(suffix)
  if (!unit) {
    return { ok: false, error: `Unrecognized unit "${suffix}".` }
  }
  return { ok: true, quantity, unit }
}
