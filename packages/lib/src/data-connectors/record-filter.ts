// packages/lib/src/data-connectors/record-filter.ts
// Per-stream record filter (v11). Decides whether ONE fetched connector record is
// allowed to reach the mapping layer, by evaluating the stream's `recordFilter`
// condition groups against the RAW source payload. Sits below the connector
// contract, so it works identically for generic-rest, template and app connectors.

import { type ConditionDiagnostic, evaluateConditionsWithDiagnostics } from '../conditions/evaluate'
import type { Condition, ConditionGroup } from '../conditions/types'
import { BadRequestError } from '../errors'
import type { ConnectorRecord } from './connectors/types'
import { getByPath } from './map-record'

/** The verdict for one record, plus why the filter could not be honoured as written. */
export interface RecordFilterVerdict {
  /** True ⇒ sink the record. A filter that could not compile always answers true. */
  matched: boolean
  /**
   * Conditions the evaluator could not evaluate as written. NON-EMPTY means the
   * filter did not apply at all — see the fail-open note on {@link recordMatchesFilter}.
   */
  diagnostics: ConditionDiagnostic[]
}

/**
 * Does this raw source record pass the stream's record filter?
 *
 * The condition `fieldId`s are SOURCE PATHS into `source.fields` — `orders_count`,
 * `customer.email`, `line_items[0].sku` — resolved with the mapping layer's own
 * {@link getByPath}, so the filter and the mapping can never read the same path two
 * different ways.
 *
 * 🔴 **This filter fails OPEN.** `conditions/evaluate.ts` makes an unrecognised
 * operator evaluate FALSE, and tells mutating callers to use the diagnostics variant
 * and refuse to act when `diagnostics` is non-empty. Refusing to act HERE means
 * refusing to sink — i.e. one typo'd or retired operator would silently drop every
 * record in the stream and report a clean run with 13,637 skips. So a filter that
 * does not fully compile is treated as ABSENT: every record is sunk and the caller
 * records a warning. This is the deliberate opposite of the mail-filters rule
 * (`assertFilterConditionsCompile`), where the dangerous direction is a filter that
 * widens to match the whole inbox; here the dangerous direction is one that narrows
 * to nothing. Save-time validation ({@link assertRecordFilterCompiles}) is what keeps
 * this path from being reached in the first place.
 *
 * An empty / null / undefined filter matches everything — today's behavior.
 */
export function recordMatchesFilter(
  source: ConnectorRecord,
  groups: ConditionGroup[] | null | undefined
): RecordFilterVerdict {
  if (!groups?.length) return { matched: true, diagnostics: [] }

  const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
    source,
    groups,
    (record, path) => getByPath(record.fields, String(path))
  )

  // Fail open — see the 🔴 note above.
  if (diagnostics.length > 0) return { matched: true, diagnostics }
  return { matched, diagnostics }
}

/**
 * Reject a record filter that does not compile — the SAVE-TIME half of the rule, and
 * the only half the author ever sees. Discovering a broken filter at sync time means
 * discovering it in a log line at 3am; the run itself will have quietly imported
 * everything (fail-open) rather than nothing, which is the safe outcome but not the
 * one the author asked for.
 *
 * Evaluated against a bare record with no `ConditionContext`: which conditions
 * compile is a property of the operator/value-source triple, not of the payload, and
 * a record filter runs on a background sync where there is no current user for a
 * `valueSource: 'currentUser'` placeholder to resolve against — so that is genuinely
 * unusable here, not merely unresolved-right-now.
 *
 * @throws BadRequestError naming every offending field and operator.
 */
export function assertRecordFilterCompiles(groups: ConditionGroup[] | null | undefined): void {
  if (!groups?.length) return

  // 🔴 A FAN-OUT path can never resolve here, and fails in the DANGEROUS direction.
  //
  // `line_items[].sku` is the mapping tree's fan-out selector: it means "every element",
  // and `extractSubtrees` expands it into one subtree per element. `getByPath` has no
  // such concept — `INDEXED_SEGMENT` requires digits, so a bare `[]` matches nothing and
  // the condition resolves `undefined`. The operators still compile, so this produces NO
  // diagnostics, which means the fail-open rule above does not catch it: the filter would
  // look correct, report a clean run, and silently drop every record in the stream.
  //
  // It is rejected rather than repaired because there is no honest repair. Filtering a
  // parent record on a repeated child's value needs an any/all quantifier the condition
  // vocabulary does not have, and picking `[0]` on the author's behalf would silently
  // mean "the first line item", which nobody asked for.
  //
  // The picker excludes these paths too (`buildSourceFieldDefinitions`); this is the
  // write-boundary half, so an SDK or API caller cannot store one either.
  const fanOut = collectFanOutFieldIds(groups)
  if (fanOut.length > 0) {
    throw new BadRequestError(
      `This record filter can’t be saved because ${fanOut
        .map((id) => `“${id}”`)
        .join(', ')} ${fanOut.length === 1 ? 'points' : 'point'} at a repeated field. ` +
        'A filter runs once per record, so it can only read fields the record has one of.'
    )
  }

  const { diagnostics } = evaluateConditionsWithDiagnostics(
    { streamKey: '', fields: {} } as ConnectorRecord,
    groups,
    (record, path) => getByPath(record.fields, String(path))
  )
  if (diagnostics.length === 0) return

  const reasons = diagnostics
    .map((d) =>
      d.reason === 'unresolved-value-source'
        ? `“${d.fieldId}” uses a dynamic value a background sync cannot resolve`
        : `“${d.fieldId}” does not support the “${d.operator}” operator`
    )
    .join('; ')
  throw new BadRequestError(
    `This record filter can’t be saved because ${reasons}. Pick a different field or operator.`
  )
}

/**
 * Every condition `fieldId` in `groups` that carries a `[]` fan-out segment.
 *
 * Walks `subConditions` too: a nested condition is still evaluated by
 * `evaluateConditionsWithDiagnostics`, so a fan-out path hidden one level down would
 * be just as inert as a top-level one.
 */
function collectFanOutFieldIds(groups: ConditionGroup[]): string[] {
  const found = new Set<string>()

  const visit = (conditions: Condition[] | undefined): void => {
    for (const condition of conditions ?? []) {
      // `fieldId` is a source path here, but the shared `Condition` type also allows an
      // array (a relationship hop). Neither form is expected to fan out; stringify both
      // rather than trusting the single-string case.
      const ids = Array.isArray(condition.fieldId) ? condition.fieldId : [condition.fieldId]
      for (const id of ids) {
        if (typeof id === 'string' && id.includes('[]')) found.add(id)
      }
      visit(condition.subConditions)
    }
  }

  for (const group of groups) visit(group.conditions)
  return [...found]
}
