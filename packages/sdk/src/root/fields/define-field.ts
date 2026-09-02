// packages/sdk/src/root/fields/define-field.ts

import type { EntityRefKind } from '../tools/types.js'
import type { FieldCapabilities, FieldScope, FieldSelectOption, FieldType } from './field-types.js'

/** Field key regex — stable id used for provisioning + reverse lookup, unique
 *  per entity (an owned `EntityDecl`'s own field list, or per `targetEntity`
 *  for a `defineFields` manifest field). */
const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

/** Field types that take select options. */
type SelectFieldType = 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TAGS'

/**
 * Scalar field types — no `options`/`addressComponents`/`relationship`/`calc`
 * payload. `ACTOR` is deliberately excluded: it has no author-declarable form
 * (it identifies a platform actor — user or agent — not something an
 * installed app provisions).
 */
type ScalarFieldType = Exclude<
  FieldType,
  SelectFieldType | 'RELATIONSHIP' | 'CALC' | 'ADDRESS_STRUCT' | 'ACTOR'
>

/**
 * One field declaration — the single shape used on all three author surfaces:
 * `defineFields` (a manifest field on an existing entity), `defineEntity` (a
 * field on an entity the app owns) and a connector mapping's owned field
 * (normalized with type/name/options/identity copied from the entity at
 * extract time). Discriminated over `type` exactly as the platform's
 * `createCustomField` validates at runtime, so a misconfig (select without
 * options, relationship without a target) is a *type error*, not a
 * provisioning failure. See docs/app-fields-and-entities-guide.md.
 */
export type FieldDecl =
  | ScalarFieldDecl
  | AddressStructFieldDecl
  | SelectFieldDecl
  | RelationshipFieldDecl
  | CalcFieldDecl

/** Fields common to every `FieldDecl` variant. */
interface BaseFieldDecl {
  /** Stable id (e.g. `'customerId'`). Distinct from the display `name`. The DB
   *  column this provisions stays `appFieldKey` — only the author-facing name
   *  changed. */
  readonly key: string
  readonly name: string
  readonly description?: string
  readonly capabilities?: FieldCapabilities
  /**
   * This value IS the external-system id of the record (e.g. Shopify
   * `customerId`), not a plain attribute. On a `defineFields` field, a
   * contributing binding that targets it auto-stamps
   * `identityRole: { kind: 'externalId' }` on its `FieldMapping`. On an
   * `EntityDecl` field, it is the record's external id: the connector seeder
   * stamps `identityRole: externalId` on its owned mapping, the installer
   * stamps `isIdentity` + `appSlug` on the column, and the sink mirrors it
   * into `RecordIdentity`. Scalar single-value fields only — see
   * `defineField`'s validation.
   */
  readonly identity?: boolean
  /**
   * Flag PII. Carried into the catalog; no platform consumer yet — see
   * docs/app-fields-and-entities-guide.md §8 (the flag is inert until a
   * consumer reads it).
   */
  readonly pii?: boolean
}

/** Scalar field — `options`/`addressComponents`/`relationship`/`calc` are forbidden. */
interface ScalarFieldDecl extends BaseFieldDecl {
  readonly type: ScalarFieldType
  readonly options?: never
  readonly addressComponents?: never
  readonly relationship?: never
  readonly calc?: never
}

/** Address field — `addressComponents` is optional, everything else forbidden. */
interface AddressStructFieldDecl extends BaseFieldDecl {
  readonly type: 'ADDRESS_STRUCT'
  /** Sub-field set surfaced on the field, e.g. `['street', 'city', 'state', 'country']`.
   *  The synced/set value must be shaped `{ street1, street2, city, state, zipCode, country }`. */
  readonly addressComponents?: readonly string[]
  readonly options?: never
  readonly relationship?: never
  readonly calc?: never
}

/** Select field — `options` is REQUIRED (omitting is a compile error). */
interface SelectFieldDecl extends BaseFieldDecl {
  readonly type: SelectFieldType
  readonly options: readonly FieldSelectOption[]
  readonly addressComponents?: never
  readonly relationship?: never
  readonly calc?: never
}

/** Relationship field — `relationship` config is REQUIRED. */
interface RelationshipFieldDecl extends BaseFieldDecl {
  readonly type: 'RELATIONSHIP'
  readonly relationship: {
    /** Another entity of the SAME app (resolved to `@template:app:<slug>:<key>`),
     *  or a platform kind (resolved to `@system:<kind>`). */
    readonly target: { readonly entityKey: string } | { readonly entityKind: EntityRefKind }
    readonly cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
    /** Display name for the auto-created inverse field on the target. */
    readonly inverseName?: string
  }
  readonly options?: never
  readonly addressComponents?: never
  readonly calc?: never
}

/** Calc field — `calc.expression` is REQUIRED. */
interface CalcFieldDecl extends BaseFieldDecl {
  readonly type: 'CALC'
  readonly calc: { readonly expression: string }
  readonly options?: never
  readonly addressComponents?: never
  readonly relationship?: never
}

/**
 * A `defineFields` manifest field — a `FieldDecl` plus where it lands.
 * `targetEntity` is an `EntityRefKind` (the platform kind the field is
 * provisioned onto); `scope` is `installation` (one per install) or
 * `connection` (one per connected account).
 */
export type AppFieldDefinition = FieldDecl & {
  /** Target entity kind — resolved to entityDefinitionId on provision. */
  readonly targetEntity: EntityRefKind
  /** `installation` (one per install) or `connection` (one per connected account). */
  readonly scope: FieldScope
}

/**
 * Field types an `identity: true` field may use. The `RecordIdentity` index
 * stores one `externalId` per (record, source, connection, key) and can't
 * mirror multi-row or non-scalar values cleanly, so select/relationship/calc/
 * multi-value/file/json/address/actor fields are rejected.
 */
const NON_IDENTITY_FIELD_TYPES = new Set<FieldType>([
  'RELATIONSHIP',
  'CALC',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TAGS',
  'FILE',
  'JSON',
  'ADDRESS_STRUCT',
  'ACTOR',
])

/**
 * Shared identity-field runtime check, reused by `defineEntity`
 * (`@auxx/sdk/entities`) so an owned entity field is validated the same way a
 * manifest field is. Not part of the public `@auxx/sdk/fields` barrel — an
 * internal cross-module helper.
 */
export function assertValidIdentityField(field: FieldDecl): void {
  if (!field.identity) return
  if (NON_IDENTITY_FIELD_TYPES.has(field.type)) {
    throw new Error(
      `defineField: "${field.key}" cannot be identity: true with type "${field.type}" — ` +
        'identity fields must be a scalar single-value type (TEXT unless another scalar is needed)'
    )
  }
}

/**
 * Validate + type a single manifest field definition. The `const` type
 * parameter preserves the literal `key`, option values, and `type` so the
 * generated `.auxx/app-fields.d.ts` (Layer 2) can type `setFieldValues` /
 * `getFieldValue` precisely.
 */
export function defineField<const F extends AppFieldDefinition>(field: F): F {
  if (!FIELD_KEY_RE.test(field.key)) {
    throw new Error(`defineField: invalid key "${field.key}" — must match ${FIELD_KEY_RE.source}`)
  }
  assertValidIdentityField(field)
  return field
}

/**
 * Validate + type a list of manifest field definitions. Rejects duplicate
 * `key`s within the same target entity (the provisioning idempotency key is
 * `(appInstallationId, connectionId?, appFieldKey)` per entity).
 */
export function defineFields<const F extends readonly AppFieldDefinition[]>(fields: F): F {
  const seen = new Set<string>()
  for (const field of fields) {
    if (!FIELD_KEY_RE.test(field.key)) {
      throw new Error(
        `defineFields: invalid key "${field.key}" — must match ${FIELD_KEY_RE.source}`
      )
    }
    const dedupeKey = `${field.targetEntity}:${field.key}`
    if (seen.has(dedupeKey)) {
      throw new Error(
        `defineFields: duplicate key "${field.key}" on entity "${field.targetEntity}"`
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
 * semantics for everything else. Used by the generated per-app value-I/O
 * augmentation (Layer 2, `.auxx/app-fields.d.ts`).
 */
export type FieldValueType<F extends FieldDecl> = F extends { type: 'SINGLE_SELECT' }
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
 * Build the `{ key: value }` map type for an app's full `fields[]` — the shape
 * `.auxx/app-fields.d.ts` augments `@auxx/sdk/server`'s value-I/O with.
 */
export type AppFieldValues<F extends readonly FieldDecl[]> = {
  [K in F[number] as K['key']]: FieldValueType<K>
}
