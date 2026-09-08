// packages/lib/src/dashboards/draft-edit/normalize/field-refs.ts

/**
 * Field-reference normalization for dashboard widgets. SERVER-ONLY (reads the
 * org cache; never export through a client barrel).
 *
 * A `WidgetFieldRef` is a BRANDED `ResourceFieldId` (`defId:fieldId`) or a
 * one-hop `FieldPath` of them. It is never a bare field name, and both halves
 * of the pair are per-org ids a model cannot know. Written by hand it comes out
 * as `"status"`, which parses as a `ResourceFieldId` with an EMPTY def part and
 * therefore either fails the doc refinement or resolves to nothing at query
 * time.
 *
 * THE LOAD-BEARING DESIGN POINT: every resolution here is scoped to the
 * WIDGET'S OWN SOURCE, so `dashboardLayoutDocSchema`'s `layoutDocRefine` cannot
 * be violated by construction. That refinement rejects the WHOLE document when
 * any field ref's root def differs from its widget's
 * `source.entityDefinitionId`, which means one stray ref refuses an entire
 * write rather than degrading one widget. Because the def part of every ref
 * produced here IS the source's own id, the check it has to pass is the check
 * that produced it. A "validate the model's ref" design would only ever tell
 * the model it got it wrong again; this one removes the way to get it wrong.
 *
 * The same scoping is what makes the group-by and metric refs resolvable at
 * render time: `prepareAggregate` looks fields up with
 * `getCachedResourceFields(org, rootDefId)` where `rootDefId` is the source id,
 * so a ref scoped to anything else finds no field.
 */

import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  type FieldPath,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResourceFields } from '../../../cache'
import {
  type AuxxError,
  BadRequestError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../../errors'
import { isValidTableId } from '../../../resources/registry/field-registry'
import { getFieldOutputKey, type ResourceField } from '../../../resources/registry/field-types'
import type { WidgetFieldRef, WidgetSource } from '../../client'
import { closestMatches } from '../refs'

/**
 * The resource id a source points at: the value `getCachedResourceFields`,
 * `prepareAggregate` and `layoutDocRefine` all key on. Same shape for both
 * source kinds, matching the picker's `sourceResourceId`.
 */
export function sourceResourceId(source: WidgetSource): string {
  return source.kind === 'system' ? source.tableId : source.entityDefinitionId
}

/** The fields of a widget's own source, from the org cache. No query of its own. */
export async function loadSourceFields(
  orgId: string,
  source: WidgetSource
): Promise<ResourceField[]> {
  return getCachedResourceFields(orgId, sourceResourceId(source))
}

/** A resolved ref together with the field it landed on, which callers need next. */
export interface ResolvedFieldTarget {
  /** The scoped ref to persist. */
  ref: WidgetFieldRef
  /** The leaf field: what `resolveOptionValue` and label rendering read. */
  field: ResourceField
  /** The def the leaf field belongs to (the source itself, or a hop target). */
  entityDefinitionId: string
}

/** Every string a field answers to, for matching and for error candidates. */
function fieldAliases(field: ResourceField): string[] {
  return [field.label, field.key, getFieldOutputKey(field)].filter(
    (alias): alias is string => typeof alias === 'string' && alias !== ''
  )
}

/**
 * One field by any name it answers to: its id, its `resourceFieldId`, its key
 * or output key, or its label. Exact before case-insensitive, and ids and keys
 * before labels, so a field whose label happens to equal another field's key
 * cannot shadow it.
 */
function findField(fields: ResourceField[], name: string): ResourceField | undefined {
  const needle = name.toLowerCase()
  return (
    fields.find((f) => f.id === name) ??
    fields.find((f) => f.resourceFieldId === name) ??
    fields.find((f) => getFieldOutputKey(f) === name) ??
    fields.find((f) => f.key === name) ??
    fields.find((f) => f.label === name) ??
    fields.find((f) => f.key.toLowerCase() === needle) ??
    fields.find((f) => getFieldOutputKey(f).toLowerCase() === needle) ??
    fields.find((f) => f.label.toLowerCase() === needle)
  )
}

function unknownFieldError(name: string, sourceLabel: string, fields: ResourceField[]): AuxxError {
  const near = closestMatches(name, fields.flatMap(fieldAliases))
  const available = fields
    .filter((f) => f.capabilities?.hidden !== true)
    .map((f) => f.label)
    .slice(0, 20)
  const hint =
    near.length > 0
      ? ` Closest: ${near.join(', ')}.`
      : available.length > 0
        ? ` Available: ${available.join(', ')}.`
        : ''
  return new NotFoundError(`No field "${name}" on ${sourceLabel}.${hint}`, { closestMatches: near })
}

/**
 * Split a friendly ref into path segments.
 *
 * An array is already segmented (a stored `FieldPath` fed straight back in). A
 * string splits on `.`, EXCEPT when it carries a `:` — an already-canonical
 * `ResourceFieldId` is one segment, so a tool result round-tripped verbatim is
 * never re-read as a traversal.
 */
function splitPath(name: string | readonly string[]): string[] {
  if (Array.isArray(name)) return name.map((segment) => String(segment).trim())
  const single = String(name).trim()
  if (single.includes(':')) return [single]
  return single.split('.').map((segment) => segment.trim())
}

/**
 * Strip an already-scoped `defId:fieldId` segment down to its field part.
 *
 * When the def part names something OTHER than `expectedDefId` this is exactly
 * the trap `layoutDocRefine` refuses the whole document for, so it is refused
 * here with the reason spelled out rather than passed on to fail as a zod
 * issue on a path nobody can read.
 */
function segmentFieldName(
  segment: string,
  expectedDefId: string | undefined,
  sourceLabel: string
): Result<string, AuxxError> {
  if (!segment.includes(':')) return ok(segment)
  const { entityDefinitionId, fieldId } = parseResourceFieldId(segment as ResourceFieldId)
  if (!fieldId) return err(new BadRequestError(`Field reference "${segment}" names no field.`))
  if (entityDefinitionId && expectedDefId && entityDefinitionId !== expectedDefId) {
    return err(
      new BadRequestError(
        `Field reference "${segment}" belongs to "${entityDefinitionId}", but this widget's ` +
          `source is ${sourceLabel} ("${expectedDefId}"). A widget may only reference fields ` +
          'of its own source. Name the field by label and it will be scoped correctly.'
      )
    )
  }
  return ok(fieldId)
}

/**
 * Resolve a human field name against a widget's OWN source, returning both the
 * scoped ref and the field it landed on.
 *
 * Accepts a label, a key / apiSlug, a raw field id, an already-canonical
 * `ResourceFieldId`, a stored `FieldPath` array, and a one-hop dotted path
 * (`"company.name"`) whose first segment names a relationship field on the
 * source. Deeper paths, and any path at all on a system source, are refused
 * with the reason rather than guessed at: `prepareAggregate` refuses both, so
 * a silently accepted ref would only fail later where nobody is reading.
 *
 * `sourceLabel` is what the errors call the source ("Ticket"); pass
 * `describeSource(source, resources)`. It defaults to the raw id, which is
 * unhelpful but never wrong.
 */
export async function resolveFieldTarget(
  orgId: string,
  source: WidgetSource,
  name: string | readonly string[],
  sourceLabel?: string
): Promise<Result<ResolvedFieldTarget, AuxxError>> {
  const rootId = sourceResourceId(source)
  const label = sourceLabel ?? rootId

  const segments = splitPath(name).filter((segment) => segment !== '')
  if (segments.length === 0) return err(new BadRequestError('Field reference is empty.'))
  if (segments.length > 2) {
    return err(
      new UnprocessableEntityError(
        `"${segments.join('.')}" traverses ${segments.length - 1} relationships. Dashboard ` +
          'widgets support one hop at most.'
      )
    )
  }

  // Checked before the field lookup, so a path on a system source reports the
  // reason it is refused rather than "no field named the first segment".
  if (segments.length > 1 && source.kind === 'system') {
    return err(
      new UnprocessableEntityError(
        `"${segments.join('.')}" traverses a relationship, which system sources such as ` +
          `${label} do not support. Name a field on the source itself.`
      )
    )
  }

  const rootFields = await loadSourceFields(orgId, source)
  if (rootFields.length === 0) {
    return err(new UnprocessableEntityError(`Source "${label}" has no readable fields.`))
  }

  const firstName = segmentFieldName(segments[0] as string, rootId, label)
  if (firstName.isErr()) return err(firstName.error)
  const hopField = findField(rootFields, firstName.value)
  if (!hopField) return err(unknownFieldError(firstName.value, label, rootFields))

  if (segments.length === 1) {
    if (source.kind === 'system' && !hopField.dbColumn) {
      return err(
        new UnprocessableEntityError(
          `Field "${hopField.label}" on ${label} is not column-backed, so it cannot be ` +
            'aggregated on a system source.'
        )
      )
    }
    return ok({
      ref: toResourceFieldId(rootId, hopField.id) as WidgetFieldRef,
      field: hopField,
      entityDefinitionId: rootId,
    })
  }

  // ── one hop ──
  if (!hopField.relationship) {
    return err(
      new UnprocessableEntityError(
        `"${firstName.value}" on ${label} is not a relationship, so "${segments.join('.')}" ` +
          'cannot be traversed.'
      )
    )
  }
  const targetDefId = getRelatedEntityDefinitionId(hopField.relationship as RelationshipConfig)
  if (!targetDefId) {
    return err(
      new UnprocessableEntityError(`Relationship "${hopField.label}" has no resolvable target.`)
    )
  }
  if (isValidTableId(targetDefId)) {
    return err(
      new UnprocessableEntityError(
        `Relationship "${hopField.label}" targets a system resource. A hop supports entity ` +
          'targets only.'
      )
    )
  }

  const targetFields = await getCachedResourceFields(orgId, targetDefId)
  const leafName = segmentFieldName(segments[1] as string, targetDefId, hopField.label)
  if (leafName.isErr()) return err(leafName.error)
  const leaf = findField(targetFields, leafName.value)
  if (!leaf) return err(unknownFieldError(leafName.value, hopField.label, targetFields))

  const path: FieldPath = [
    toResourceFieldId(rootId, hopField.id),
    toResourceFieldId(targetDefId, leaf.id),
  ]
  return ok({ ref: path as WidgetFieldRef, field: leaf, entityDefinitionId: targetDefId })
}

/**
 * {@link resolveFieldTarget}, projected down to the ref. This is the function
 * every widget-config key goes through; see the file docblock for why scoping
 * it to the source is what makes trap 3 unreachable.
 */
export async function resolveFieldRef(
  orgId: string,
  source: WidgetSource,
  name: string | readonly string[],
  sourceLabel?: string
): Promise<Result<WidgetFieldRef, AuxxError>> {
  const target = await resolveFieldTarget(orgId, source, name, sourceLabel)
  return target.map((resolved) => resolved.ref)
}

/**
 * Map a select field's option LABEL to the KEY that is actually stored.
 *
 * Filter values on a select field are option keys (`"ACTIVE"`), not the labels
 * a person reads (`"Active"`). A model writes the label, the condition compiles
 * cleanly, matches nothing, and the widget renders zero rather than an error.
 * That is indistinguishable from a genuinely empty result, which is why it is
 * worth refusing rather than passing through.
 *
 * Passes through untouched for a field with no option list and for non-string
 * values (an `empty` / `not empty` condition carries none). An unmatched value
 * on a field that HAS options is an error listing the keys: on such a field a
 * value that is neither a key nor a label can never match a row.
 */
export function resolveOptionValue(
  field: ResourceField,
  value: unknown
): Result<unknown, AuxxError> {
  const options = field.options?.options
  if (!options || options.length === 0) return ok(value)

  if (Array.isArray(value)) {
    const mapped: unknown[] = []
    for (const item of value) {
      const one = resolveOptionValue(field, item)
      if (one.isErr()) return err(one.error)
      mapped.push(one.value)
    }
    return ok(mapped)
  }

  if (typeof value !== 'string' || value === '') return ok(value)

  const byKey = options.find((option) => option.value === value)
  if (byKey) return ok(byKey.value)

  const needle = value.toLowerCase()
  const byLabel = options.filter((option) => option.label.toLowerCase() === needle)
  if (byLabel.length === 1) return ok((byLabel[0] as { value: string }).value)
  const byKeyCi = options.filter((option) => option.value.toLowerCase() === needle)
  if (byKeyCi.length === 1) return ok((byKeyCi[0] as { value: string }).value)

  const near = closestMatches(
    value,
    options.flatMap((option) => [option.value, option.label])
  )
  const hint = near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''
  return err(
    new NotFoundError(
      `"${value}" is not an option of "${field.label}". Its options are ` +
        `${options.map((option) => `${option.value} (${option.label})`).join(', ')}.${hint}`,
      { closestMatches: near }
    )
  )
}

/**
 * Render a `WidgetFieldRef` back as the name a model should see, so nothing
 * leaving this module carries a raw per-org id. Pass the source's fields to get
 * a real label; without them the ref's own field-id segment passes through,
 * which is still honest rather than wrong.
 */
export function describeFieldRef(ref: WidgetFieldRef, fields?: ResourceField[]): string {
  if (isFieldPath(ref)) {
    return (ref as FieldPath).map((segment) => describeFieldRef(segment, fields)).join('.')
  }
  const { fieldId } = parseResourceFieldId(ref as ResourceFieldId)
  const field = fields?.find((f) => f.id === fieldId)
  return field ? field.label : fieldId
}

/** {@link describeFieldRef} with the source's fields loaded for you. */
export async function describeFieldRefForSource(
  orgId: string,
  source: WidgetSource,
  ref: WidgetFieldRef
): Promise<string> {
  return describeFieldRef(ref, await loadSourceFields(orgId, source))
}
