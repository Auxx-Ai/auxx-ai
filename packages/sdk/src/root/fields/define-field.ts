// packages/sdk/src/root/fields/define-field.ts

import type { EntityRefKind } from '../tools/types.js'
import type { FieldCapabilities, FieldScope, FieldSelectOption, FieldType } from './field-types.js'

/** App-field key regex — stable id used for provisioning + reverse lookup. */
const APP_FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

/** Field types that take select options. */
type SelectFieldType = 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TAGS'

/** Scalar field types — no `options`/`relationship`/`calc` payload. */
type ScalarFieldType = Exclude<FieldType, SelectFieldType | 'RELATIONSHIP' | 'CALC' | 'ACTOR'>

/**
 * Common shape for every declared field. `targetEntity` is an `EntityRefKind`
 * (the same vocabulary `ctx.entities` uses); the platform resolves it to the
 * org's entity definition at provision time.
 */
interface BaseAppFieldDefinition {
  /** App-stable id (e.g. 'customerId'). Distinct from the display `name`. */
  readonly appFieldKey: string
  /** Target entity kind — resolved to entityDefinitionId on provision. */
  readonly targetEntity: EntityRefKind
  /** `installation` (one per install) or `connection` (one per connected account). */
  readonly scope: FieldScope
  /** Display name — used only when the field is not hidden. */
  readonly name: string
  readonly description?: string
  readonly capabilities?: FieldCapabilities
  /**
   * This field is an external-system identity (e.g. Shopify `customerId`),
   * not a plain attribute — a contributing binding that targets it
   * auto-stamps `identityRole: { kind: 'externalId' }` on its `FieldMapping`,
   * and the sink write-ownership rule (fill-blank + drift-exempt +
   * no-provenance) applies. Scalar single-value fields only — see
   * `defineField`'s validation.
   */
  readonly identity?: boolean
}

/** Scalar field — `options`/`relationship`/`calc` are forbidden. */
interface ScalarAppFieldDefinition extends BaseAppFieldDefinition {
  readonly type: ScalarFieldType
  readonly options?: never
  readonly relationship?: never
  readonly calc?: never
}

/** Select field — `options` is REQUIRED (omitting is a compile error). */
interface SelectAppFieldDefinition extends BaseAppFieldDefinition {
  readonly type: SelectFieldType
  readonly options: readonly FieldSelectOption[]
  readonly relationship?: never
  readonly calc?: never
}

/** Relationship field — `relationship` config is REQUIRED. */
interface RelationshipAppFieldDefinition extends BaseAppFieldDefinition {
  readonly type: 'RELATIONSHIP'
  readonly relationship: {
    readonly targetEntity: EntityRefKind
    readonly cardinality: 'one' | 'many'
  }
  readonly options?: never
  readonly calc?: never
}

/** Calc field — `calc.expression` is REQUIRED. */
interface CalcAppFieldDefinition extends BaseAppFieldDefinition {
  readonly type: 'CALC'
  readonly calc: { readonly expression: string }
  readonly options?: never
  readonly relationship?: never
}

/**
 * A field an installed app registers on an entity. Discriminated over `type`,
 * mirroring what `createCustomField` validates at runtime — so a misconfig
 * (select without options, relationship without config) is a *type error*, not
 * a provisioning failure.
 */
export type AppFieldDefinition =
  | ScalarAppFieldDefinition
  | SelectAppFieldDefinition
  | RelationshipAppFieldDefinition
  | CalcAppFieldDefinition

/**
 * Field types an `identity: true` field may use. The `RecordIdentity` index
 * stores one `externalId` per (record, source, connection, appFieldKey) and
 * can't mirror multi-row or non-scalar values cleanly, so
 * select/relationship/calc/multi-value/file/json fields are rejected.
 */
const NON_IDENTITY_FIELD_TYPES = new Set<FieldType>([
  'RELATIONSHIP',
  'CALC',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TAGS',
  'FILE',
  'JSON',
  'ACTOR',
])

function assertValidIdentityField(field: AppFieldDefinition): void {
  if (!field.identity) return
  if (NON_IDENTITY_FIELD_TYPES.has(field.type)) {
    throw new Error(
      `defineField: "${field.appFieldKey}" cannot be identity: true with type "${field.type}" — ` +
        'identity fields must be a scalar single-value type (TEXT unless another scalar is needed)'
    )
  }
}

/**
 * Validate + type a single field definition. The `const` type parameter
 * preserves the literal `appFieldKey`, option values, and `type` so the
 * generated `auxx-env.d.ts` (Layer 2) can type `ctx.entities` precisely.
 */
export function defineField<const F extends AppFieldDefinition>(field: F): F {
  if (!APP_FIELD_KEY_RE.test(field.appFieldKey)) {
    throw new Error(
      `defineField: invalid appFieldKey "${field.appFieldKey}" — must match ${APP_FIELD_KEY_RE.source}`
    )
  }
  assertValidIdentityField(field)
  return field
}

/**
 * Validate + type a list of field definitions. Rejects duplicate
 * `appFieldKey`s within the same target entity (the provisioning idempotency
 * key is `(appInstallationId, connectionId?, appFieldKey)` per entity).
 */
export function defineFields<const F extends readonly AppFieldDefinition[]>(fields: F): F {
  const seen = new Set<string>()
  for (const field of fields) {
    if (!APP_FIELD_KEY_RE.test(field.appFieldKey)) {
      throw new Error(
        `defineFields: invalid appFieldKey "${field.appFieldKey}" — must match ${APP_FIELD_KEY_RE.source}`
      )
    }
    const dedupeKey = `${field.targetEntity}:${field.appFieldKey}`
    if (seen.has(dedupeKey)) {
      throw new Error(
        `defineFields: duplicate appFieldKey "${field.appFieldKey}" on entity "${field.targetEntity}"`
      )
    }
    seen.add(dedupeKey)
    assertValidIdentityField(field)
  }
  return fields
}

/** Extract the option-value union for a select field definition. */
type OptionValues<F> = F extends { options: readonly (infer O)[] }
  ? O extends { value: infer V }
    ? V
    : string
  : string

/**
 * Options-aware `field definition → TS value` type. Narrows select fields to
 * their declared option-value union; falls back to the base `FieldTypeValueMap`
 * semantics for everything else. Used by the generated per-app `ctx.entities`
 * augmentation (Layer 2).
 */
export type FieldValueType<F extends AppFieldDefinition> = F extends { type: 'SINGLE_SELECT' }
  ? OptionValues<F>
  : F extends { type: 'MULTI_SELECT' | 'TAGS' }
    ? OptionValues<F>[]
    : F extends { type: 'NUMBER' | 'CURRENCY' }
      ? number
      : F extends { type: 'CHECKBOX' }
        ? boolean
        : F extends { type: 'JSON' }
          ? unknown
          : F extends { type: 'RELATIONSHIP' }
            ? string
            : string

/**
 * Build the `{ appFieldKey: value }` map type for an app's full `fields[]` —
 * the shape the codegen augments `ctx.entities` with.
 */
export type AppFieldValues<F extends readonly AppFieldDefinition[]> = {
  [K in F[number] as K['appFieldKey']]: FieldValueType<K>
}
