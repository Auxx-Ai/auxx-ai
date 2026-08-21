// packages/lib/src/field-values/ai-autofill/type-specs.ts

import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { minorUnitExponent } from '@auxx/utils/currency'
import { parseTimeOfDay } from '@auxx/utils/date'
import type { FieldOptions } from '../../custom-fields/field-options'
import { withOrgCurrency } from '../org-currency'
import { mintOrMatchTagOptions } from './tag-minting'

/**
 * Permissive JSON-schema shape — the LLM orchestrator passes this through
 * to the provider verbatim, so we only need enough typing to construct it.
 */
export type JsonSchema = Record<string, unknown>

/**
 * Read-only context threaded into schema + prompt construction.
 *
 * Only carries values that cannot be derived from the `CustomFieldEntity`
 * alone — today that is the org rung of the CURRENCY denomination chain.
 */
export interface AiFieldContext {
  /** Org's `organization.currency`, the middle rung of field → org → USD. */
  orgCurrencyCode?: string
}

/** Context for the post-generation {@link AiTypeSpec.normalize} step. */
export interface AiNormalizeContext extends AiFieldContext {
  organizationId: string
  /**
   * True for the create/edit dialog's preview. Normalizers that would write
   * outside `FieldValue` (open TAGS minting) must be inert in this mode —
   * a dry run may not grow the field's taxonomy.
   */
  dryRun?: boolean
}

/**
 * Everything the three coupled knobs need for one AI-eligible field type,
 * colocated so they cannot silently disagree:
 *
 *  1. `schema`    — the machine contract the provider enforces.
 *  2. `shapeHint` — the natural-language contract in the system prompt.
 *  3. `normalize` — the bridge between the LLM's output space and the
 *                   strict validator a human edit hits.
 *
 * Plus `nullable`, which lets the model decline instead of inventing a value.
 */
export interface AiTypeSpec {
  /** Value schema (the `{ value: … }` envelope is added by `buildJsonSchema`). */
  schema: (field: CustomFieldEntity, ctx?: AiFieldContext) => JsonSchema
  /** One sentence appended to the system prompt describing the expected shape. */
  shapeHint: (field: CustomFieldEntity, ctx?: AiFieldContext) => string
  /**
   * Map raw LLM output onto what `validateSingleValue` accepts. Returning
   * `null` clears the value — always preferable to letting the strict
   * validator throw, which surfaces as a red error cell.
   */
  normalize?: (
    value: unknown,
    field: CustomFieldEntity,
    ctx: AiNormalizeContext
  ) => unknown | Promise<unknown>
  /**
   * When true the schema admits `null` and the system prompt tells the model
   * to decline rather than fabricate. Reserved for types where a plausible
   * invented value is indistinguishable from a real one.
   */
  nullable?: boolean
}

/**
 * Pull option ids out of a SELECT/TAGS field's options. Falls back to `value`
 * when an option was defined without a stable `id` (older data shapes).
 */
export function selectOptionIds(options: FieldOptions): string[] {
  const opts = options.options
  if (!Array.isArray(opts)) return []
  return opts.map((o) => o.id ?? o.value).filter((id): id is string => Boolean(id))
}

/** Human-readable option labels, for prompts that name the existing taxonomy. */
function selectOptionLabels(options: FieldOptions): string[] {
  const opts = options.options
  if (!Array.isArray(opts)) return []
  return opts.map((o) => o.label ?? o.value).filter((label): label is string => Boolean(label))
}

/** Field options, narrowed from the untyped jsonb column. */
function fieldOptions(field: CustomFieldEntity): FieldOptions {
  return (field.options ?? {}) as FieldOptions
}

/** Whether a TAGS field is allowed to grow its own taxonomy (default off). */
export function allowsNewTagOptions(field: CustomFieldEntity): boolean {
  const options = field.options as { ai?: { allowNewOptions?: boolean } } | null | undefined
  return options?.ai?.allowNewOptions === true
}

/** Trimmed non-empty string, or null. */
function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Drop null/empty members from a generated object and return `null` when
 * nothing survives.
 *
 * Strict mode forces every property into `required`, so "this member is
 * unknown" can only be expressed as an explicit `null` — but the NAME and
 * ADDRESS_STRUCT zod schemas use `.optional()` (which rejects `null`) and
 * `.refine()` an at-least-one rule. Without this step a partially-known
 * address throws instead of storing the part that IS known.
 */
function compactObject(value: unknown, keys: readonly string[]): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of keys) {
    const str = toTrimmedString(source[key])
    if (str !== null) out[key] = str
  }
  return Object.keys(out).length > 0 ? out : null
}

const ADDRESS_KEYS = ['street1', 'street2', 'city', 'state', 'zipCode', 'country'] as const
const NAME_KEYS = ['firstName', 'lastName'] as const

/** `{ type: ['string', 'null'] }` member of a strict-mode object schema. */
function nullableString(description: string): JsonSchema {
  return { type: ['string', 'null'], description }
}

/**
 * Per-type AI generation contract, keyed by native field type.
 *
 * There are exactly TWO sources of AI eligibility and they are joined by an
 * exact-set-equality test (`__tests__/type-specs.test.ts`):
 *
 *  - the plain name Set `AI_ELIGIBLE_FIELD_TYPES` in `@auxx/types/custom-field`,
 *    which `@auxx/services` gates saves on and cannot import from `@auxx/lib`;
 *  - this table, which stays in lib because CURRENCY's denomination resolves
 *    through `getOrgCurrencyCode` — async, org-cache-backed, lib-only — and
 *    open TAGS mints options against the database.
 *
 * Adding a type is therefore always a two-file change, and the test enforces it.
 *
 * 🛑 Do NOT hang this off `fieldTypeOptions` (`custom-fields/types.ts`): that
 * record is imported directly by client components, and pulling the org cache
 * into it would break the web bundle.
 *
 * A `normalize` entry is a last resort, not the default. The commit path runs
 * `validateSingleValue` — the same strict validator a human edit hits — so the
 * schema and the shape hint should already emit what it accepts. Every
 * normalizer below carries the reason its type cannot.
 */
export const AI_TYPE_SPECS: Partial<Record<FieldType, AiTypeSpec>> = {
  TEXT: {
    schema: () => ({ type: 'string' }),
    shapeHint: () =>
      'Produce concise plain text. No markdown, no quotation marks around the whole value.',
  },

  RICH_TEXT: {
    schema: () => ({ type: 'string' }),
    shapeHint: () =>
      'Produce a fragment of simple HTML using only <p>, <br>, <strong>, <em>, <u>, <s>, ' +
      '<ul>/<ol>/<li>, <blockquote>, <code> and <a href> tags. No <html>, <head>, <body>, ' +
      '<script> or <style>, no markdown, no code fences.',
  },

  NUMBER: {
    schema: () => ({ type: 'number' }),
    shapeHint: () => 'Produce a numeric value. No units, no thousands separators.',
  },

  CURRENCY: {
    // Integer, not number: since #1782 a CURRENCY value is an integer count of
    // minor units and `validateSingleValue` hard-rejects anything fractional.
    // Strict mode enforcing `integer` is most of the fix; the prompt supplies
    // the denomination the model needs to do the conversion itself.
    //
    // 🛑 Deliberately no scaling normalizer. Given `600` the server cannot know
    // whether that is $6.00 or $600 — the undecidable guess that produced
    // 100×-wrong stored data. The integrality check is the safety net.
    schema: () => ({ type: 'integer' }),
    shapeHint: (field, ctx) => {
      const resolved = withOrgCurrency(fieldOptions(field), 'CURRENCY', ctx?.orgCurrencyCode)
      const code = resolved?.currencyCode ?? 'USD'
      const exponent = minorUnitExponent(code)
      const unitNote =
        exponent === 0
          ? `${code} has no minor unit, so the integer IS the whole-unit amount`
          : `1 ${code} = ${10 ** exponent} minor units, so 19.99 ${code} is ${Math.round(
              19.99 * 10 ** exponent
            )}`
      return (
        `Produce the amount in MINOR UNITS of ${code} as an integer (${unitNote}). ` +
        'Do the conversion yourself: no decimal point, no thousands separators, no currency symbol.'
      )
    },
  },

  CHECKBOX: {
    schema: () => ({ type: 'boolean' }),
    shapeHint: () => 'Produce a boolean: true or false.',
  },

  DATE: {
    schema: () => ({ type: 'string', format: 'date' }),
    shapeHint: () => 'Produce an ISO calendar date in YYYY-MM-DD form.',
  },

  DATETIME: {
    schema: () => ({ type: 'string', format: 'date-time' }),
    shapeHint: () =>
      'Produce an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-08-20T14:30:00Z.',
  },

  TIME: {
    // `dateSchema` is `new Date(String(v))` and `new Date('14:30')` is Invalid
    // Date, so a bare clock time cannot reach storage unanchored. The pattern
    // is `HH:MM` exactly (no seconds) because that is what `parseTimeOfDay`
    // accepts — the same helper the human time picker anchors through.
    schema: () => ({ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    shapeHint: () => 'Produce a 24-hour clock time in HH:MM form, e.g. 14:30.',
    normalize: (value) => {
      const raw = toTrimmedString(value)
      if (raw === null) return null
      // Mirrors `createDateWithTime` on the human path: today's date in the
      // writer's local zone, local hour/minute setters, seconds+ms zeroed.
      // 🛑 The writer here is the worker process, not the browser — a TIME
      // generated server-side is anchored in the SERVER's timezone.
      return parseTimeOfDay(raw)?.toISOString() ?? null
    },
  },

  URL: {
    schema: () => ({ type: 'string' }),
    shapeHint: () =>
      'Produce a fully-qualified URL including the https:// scheme, or null if the ' +
      'instructions do not contain one — never invent a URL.',
    nullable: true,
  },

  EMAIL: {
    schema: () => ({ type: 'string' }),
    shapeHint: () =>
      'Produce a single RFC-5322 email address, or null if the instructions do not ' +
      'contain one — never invent an address.',
    nullable: true,
  },

  PHONE_INTL: {
    schema: () => ({ type: 'string' }),
    shapeHint: () =>
      'Produce a phone number in E.164 form with a leading + and country code, or null ' +
      'if the instructions do not contain a phone number — never invent one.',
    nullable: true,
    // No normalizer: `validateSingleValue`'s PHONE_INTL arm already runs the
    // shared `formatPhoneNumber` E.164 normalization (#1629) and rejects what
    // it cannot parse, exactly as it does for a human edit. Nullability — not
    // a second coercion pass — is what stops the model inventing a number.
  },

  NAME: {
    schema: () => ({
      type: 'object',
      additionalProperties: false,
      required: [...NAME_KEYS],
      properties: {
        firstName: nullableString('Given name, or null if unknown.'),
        lastName: nullableString('Family name, or null if unknown.'),
      },
    }),
    shapeHint: () =>
      'Produce an object with firstName and lastName. Use null for a part the ' +
      'instructions do not state — never invent a name.',
    nullable: true,
    normalize: (value) => compactObject(value, NAME_KEYS),
  },

  ADDRESS_STRUCT: {
    schema: () => ({
      type: 'object',
      additionalProperties: false,
      required: [...ADDRESS_KEYS],
      properties: {
        street1: nullableString('Street address line 1, or null if unknown.'),
        street2: nullableString('Street address line 2 (unit, suite), or null if unknown.'),
        city: nullableString('City or locality, or null if unknown.'),
        state: nullableString('State, province or region, or null if unknown.'),
        zipCode: nullableString('Postal or ZIP code, or null if unknown.'),
        country: nullableString('Country name or ISO code, or null if unknown.'),
      },
    }),
    shapeHint: () =>
      'Produce a structured address. Use null for any component the instructions do not ' +
      'state — a partial address is useful, an invented one is not.',
    nullable: true,
    normalize: (value) => compactObject(value, ADDRESS_KEYS),
  },

  SINGLE_SELECT: {
    schema: (field) => ({ type: 'string', enum: selectOptionIds(fieldOptions(field)) }),
    shapeHint: () => 'Choose exactly one option id from the enumerated set in the schema.',
  },

  MULTI_SELECT: {
    schema: (field) => ({
      type: 'array',
      items: { type: 'string', enum: selectOptionIds(fieldOptions(field)) },
    }),
    shapeHint: () => 'Choose zero or more option ids from the enumerated set in the schema.',
  },

  TAGS: {
    // Two halves. Constrained (the default) is byte-for-byte MULTI_SELECT.
    // Open (`ai.allowNewOptions`) drops the enum and takes free-text labels —
    // strict mode cannot express "one of these ids OR any new string", so the
    // existing labels go in the prompt and `mintOrMatchTagOptions` maps the
    // answer back onto option ids, minting only what genuinely does not exist.
    schema: (field) =>
      allowsNewTagOptions(field)
        ? { type: 'array', items: { type: 'string' } }
        : { type: 'array', items: { type: 'string', enum: selectOptionIds(fieldOptions(field)) } },
    shapeHint: (field) => {
      if (!allowsNewTagOptions(field)) {
        return 'Choose zero or more option ids from the enumerated set in the schema.'
      }
      const labels = selectOptionLabels(fieldOptions(field))
      const existing =
        labels.length > 0
          ? ` Reuse an existing tag verbatim whenever one fits: ${labels.join(', ')}.`
          : ''
      return `Produce an array of short tag labels (1-3 words each).${existing}`
    },
    normalize: (value, field, ctx) => {
      if (!allowsNewTagOptions(field)) return value
      return mintOrMatchTagOptions({
        organizationId: ctx.organizationId,
        field,
        labels: Array.isArray(value) ? value : [],
        dryRun: ctx.dryRun === true,
      })
    },
  },
}

/** Whether a field type has an AI generation contract in {@link AI_TYPE_SPECS}. */
export function getAiTypeSpec(type: FieldType | string): AiTypeSpec | undefined {
  return AI_TYPE_SPECS[type as FieldType]
}

/**
 * Run the per-type normalize step on raw LLM output.
 *
 * Called from `generation-service` (worker commit) and `preview-service`
 * (dialog dry run) right after the `{ value }` envelope is unwrapped, so both
 * surfaces see the same value the strict validator will.
 */
export async function normalizeGeneratedValue(
  value: unknown,
  field: CustomFieldEntity,
  ctx: AiNormalizeContext
): Promise<unknown> {
  if (value === null || value === undefined) return null
  const spec = getAiTypeSpec(field.type)
  if (!spec?.normalize) return value
  return await spec.normalize(value, field, ctx)
}
